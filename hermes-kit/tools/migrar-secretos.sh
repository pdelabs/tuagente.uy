#!/usr/bin/env bash
# Saca las claves del agente de `data/.env` a `<agente>/secretos.env`.
#
#   tools/migrar-secretos.sh <raiz-del-agente>
#
# POR QUE. `data/` es del agente: corre como root adentro de su contenedor y la
# tiene montada rw, asi que puede escribir cualquier archivo de ahi. Y
# `data/.env` era el `env_file` de LOS DOS servicios. Con eso el agente no
# "redirigia directorios": ejecutaba CODIGO ADENTRO DEL ADAPTER. Medido con la
# imagen real, el adapter como uid 10000 y su codigo montado :ro —
#
#   data/.env: PYTHONPATH=/opt/data/evil   →   /opt/data/evil/<modulo>.py tapa
#   un modulo del stdlib   →   "CODIGO DEL AGENTE EJECUTADO ADENTRO DEL ADAPTER"
#
# — y desde ese proceso, que tiene `politica/` en RW, se reescribieron
# `hooks/puerta.py` (la puerta, para que dejara pasar todo) y
# `cont-init-parches.sh`, que hermes monta como `/etc/cont-init.d/03-parches` y
# **s6 corre como root** en cada arranque. Dos saltos y el agente es root en el
# otro contenedor. El archivo de secretos no puede vivir donde el agente escribe.
#
# QUE HACE: mueve `data/.env` → `secretos.env` (root:root 600 cuando se puede).
# En el caso normal lo mueve ENTERO, byte por byte, sin reescribirlo: asi no hay
# forma de partir un valor multilinea ni de perder una variable. Solo filtra si
# encuentra algo de la lista PELIGROSAS de abajo, y en ese caso deja el original
# en `data/.env.sin-migrar` en vez de borrarlo. Es idempotente y NO pisa un
# `secretos.env` que ya exista.
#
# QUE NO HACE, Y ES A PROPOSITO: no mueve nada si el compose del agente todavia
# declara `./data/.env` como env_file. Mover el archivo debajo de un compose que
# lo nombra deja al agente sin arrancar ("env file not found"), y un guardrail
# que apaga al cliente no se instala. En ese caso avisa y se va: el compose se
# actualiza primero (el despliegue remoto lo sube en cada corrida; el local se
# edita a mano) y la proxima pasada migra sola.
set -euo pipefail

RAIZ="${1:-}"
[[ -n "$RAIZ" && -d "$RAIZ" ]] || { echo "uso: $0 <raiz-del-agente>" >&2; exit 2; }
RAIZ="$(cd "$RAIZ" && pwd)"

VIEJO="$RAIZ/data/.env"
NUEVO="$RAIZ/secretos.env"
COMPOSE="$RAIZ/docker-compose.yml"

if [[ -f "$COMPOSE" ]] && grep -qE '^\s*-\s*\./data/\.env\s*$' "$COMPOSE"; then
  if [[ -f "$VIEJO" ]]; then
    cat <<AVISO
OJO: las claves siguen en data/.env, que el agente puede reescribir — y ese
archivo es el env_file de los dos servicios, o sea ejecucion de codigo adentro
del adapter. No las muevo todavia porque $COMPOSE
todavia lo nombra y el agente quedaria sin arrancar. Cambia en LOS DOS servicios:

    env_file:
      - ./secretos.env

y volve a correr esto (o el despliegue, que lo hace solo).
AVISO
  fi
  exit 0
fi

if [[ -f "$NUEVO" && -f "$VIEJO" ]]; then
  echo "OJO: hay claves en secretos.env Y en data/.env. Dejo las dos: revisá cuál"
  echo "     vale y borrá la de data/ a mano (el compose ya solo lee secretos.env,"
  echo "     así que la de data/ no la usa nadie)."
  exit 0
fi

# Las variables que NO se mueven, y el criterio: no son credenciales, son
# palancas para que un interprete o el loader ejecuten codigo de otro lado. Es
# una lista NEGRA corta a proposito. La primera version de esto era una lista
# blanca de credenciales conocidas, y le destruia la configuracion al cliente:
# descartaba `TELEGRAM_ALLOWED_USERS` —que crea el propio kit, y es la lista
# blanca del bot— y despues borraba el archivo, o sea que el valor no quedaba en
# ningun lado. Sin esa variable el bot no le contesta a nadie (el cliente pierde
# el canal) o le contesta a cualquiera. Un archivo de credenciales tiene que
# poder llevar credenciales que todavia no inventamos: se mueve todo salvo lo
# que sabemos que es peligroso.
PELIGROSAS="PYTHONPATH PYTHONHOME PYTHONSTARTUP LD_PRELOAD LD_LIBRARY_PATH LD_AUDIT
            BASH_ENV ENV SHELLOPTS BASHOPTS PATH IFS PERL5LIB PERL5OPT RUBYOPT
            RUBYLIB NODE_OPTIONS NODE_PATH GCONV_PATH PYTHONWARNINGS"

# El nombre de variable que declara una linea, o vacio si no declara ninguna, o
# "?" si no la entendemos. NORMALIZA ANTES DE COMPARAR, y ese es el punto: el
# parser del consumidor (godotenv, el que usa docker compose) acepta el prefijo
# `export` y espacios alrededor del `=`, y el nuestro no los aceptaba. Con eso,
# `export PYTHONPATH=/opt/data/evil` no matcheaba `^NOMBRE=`, no se comparaba
# nunca contra PELIGROSAS, el archivo se daba por limpio y se movia ENTERO —con
# el payload adentro— al archivo que este script anuncia como "fuera del alcance
# del agente". Verificado con `docker compose config`: la variable llegaba.
# Dos formas se colaban (`export X=` y `X =`) y dos se detectaban (`  X=` y
# `X= `). Ahora las cuatro salen por el mismo lado.
nombre_de() {
  local l="$1"
  l="${l#"${l%%[![:space:]]*}"}"                       # espacios de la izquierda
  if [[ -z "$l" || "$l" == \#* ]]; then printf ''; return; fi
  if [[ "$l" =~ ^(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)[[:space:]]*= ]]; then
    printf '%s' "${BASH_REMATCH[2]}"
  else
    printf '?'
  fi
}

# ¿La linea deja una comilla abierta? Sirve para distinguir una CONTINUACION de
# un valor multilinea (legitima: una clave PEM entre comillas) de una linea que
# no entendemos. Cuenta comillas no escapadas; es una aproximacion, y por eso
# ante la duda se cae al camino conservador en vez de mover a ciegas.
cierra_impar() {  # $1 = texto, $2 = comilla
  local texto="$1" q="$2" n=0 i c prev=""
  for ((i=0; i<${#texto}; i++)); do
    c="${texto:i:1}"
    [[ "$c" == "$q" && "$prev" != "\\" ]] && n=$((n+1))
    prev="$c"
  done
  (( n % 2 ))
}

if [[ -f "$VIEJO" ]]; then
  # Se mira ANTES de tocar nada: que se entienda ENTERO y que no traiga ninguna
  # peligrosa. Solo con las dos cosas se mueve tal cual, sin reescribirlo — asi
  # no hay forma de partir un valor multilinea ni de perder una comilla.
  peligrosas_encontradas=""
  raras=0
  abierta=""
  while IFS= read -r linea || [[ -n "$linea" ]]; do
    if [[ -n "$abierta" ]]; then                        # continuacion conocida
      cierra_impar "$linea" "$abierta" && abierta=""
      continue
    fi
    nombre="$(nombre_de "$linea")"
    if [[ "$nombre" == "?" ]]; then raras=$((raras+1)); continue; fi
    [[ -z "$nombre" ]] && continue
    for mala in $PELIGROSAS; do
      [[ "$nombre" == "$mala" ]] && peligrosas_encontradas="$peligrosas_encontradas $nombre"
    done
    valor="${linea#*=}"
    if cierra_impar "$valor" '"'; then abierta='"'
    elif cierra_impar "$valor" "'"; then abierta="'"; fi
  done < "$VIEJO"
  [[ -n "$abierta" ]] && raras=$((raras+1))             # comilla que nunca cerro

  if [[ -z "$peligrosas_encontradas" && $raras -eq 0 ]]; then
    # El caso de todos los dias: se mueve entero, byte por byte.
    if [[ -f "$NUEVO" ]]; then
      echo "OJO: ya hay un secretos.env. Dejo data/.env como está: revisá cuál vale."
    else
      mv "$VIEJO" "$NUEVO"
      chmod 600 "$NUEVO"
      [[ "$(id -u)" == "0" ]] && chown root:root "$NUEVO"
      echo "movido  data/.env → secretos.env (entero, root:root 600, fuera del alcance del agente)"
    fi
  elif [[ $raras -gt 0 ]]; then
    # No se entiende entero. Filtrar a ciegas parte valores; moverlo entero
    # asciende lo que no se pudo mirar. No se toca y se explica.
    cat <<AVISO
OJO: en data/.env hay $raras línea(s) que no entiendo (ni \`NOMBRE=valor\`, ni
comentario, ni continuación de un valor entre comillas)${peligrosas_encontradas:+, y además
variables que no son credenciales:${peligrosas_encontradas}}. No lo toco: moverlo entero
ascendería lo que no pude mirar, y filtrarlo partiría un valor multilínea.
Copiá las credenciales a secretos.env a mano, dejá afuera lo que no lo sea, y
borrá data/.env.
AVISO
  else
    # Peligrosas, pero el archivo se entiende entero: se mueve todo lo demas y el
    # original queda como .sin-migrar EN LA RAIZ. No adentro de data/: ahi lo
    # alcanza el agente, y el archivo tiene TODAS las credenciales.
    : > "$NUEVO"; chmod 600 "$NUEVO"
    while IFS= read -r linea || [[ -n "$linea" ]]; do
      nombre="$(nombre_de "$linea")"
      salteo=""
      for mala in $PELIGROSAS; do [[ "$nombre" == "$mala" ]] && salteo=1; done
      [[ -n "$salteo" ]] || printf '%s\n' "$linea" >> "$NUEVO"
    done < "$VIEJO"
    [[ "$(id -u)" == "0" ]] && chown root:root "$NUEVO"
    mv "$VIEJO" "$RAIZ/.env.sin-migrar"
    chmod 600 "$RAIZ/.env.sin-migrar"
    [[ "$(id -u)" == "0" ]] && chown root:root "$RAIZ/.env.sin-migrar"
    cat <<AVISO
movido  data/.env → secretos.env (menos${peligrosas_encontradas})
OJO: NO me llevé${peligrosas_encontradas}. No son credenciales: son variables que hacen
     que un intérprete cargue código de otro lado, y data/.env lo puede escribir
     el agente. El original quedó en la raíz del agente como .env.sin-migrar
     (root:root 600, fuera de data/) para que mires qué había y quién lo puso.
AVISO
  fi
fi

# ── Y AHORA LO VERIFICA EL PARSER DEL CONSUMIDOR, NO EL NUESTRO ───────────
# Toda esta funcion es un parser de `.env` escrito por nosotros, y el bug que
# arreglamos arriba fue exactamente eso: el nuestro decia "limpio" y el de
# docker leia `PYTHONPATH`. Asi que despues de mover, se le pregunta AL QUE LO
# VA A LEER: `docker compose config` resuelve el entorno real de los servicios.
# Si aparece una peligrosa, se deshace la mudanza — el archivo vuelve a data/ y
# no queda una bomba en el lugar de confianza.
if [[ -f "$NUEVO" && -f "$RAIZ/docker-compose.yml" ]] && command -v docker >/dev/null 2>&1; then
  resuelto="$(cd "$RAIZ" && docker compose config 2>/dev/null || true)"
  if [[ -z "$resuelto" ]]; then
    echo "(no pude correr \`docker compose config\` acá: la verificación con el"
    echo " parser del consumidor queda pendiente — corréla en el servidor)"
  else
    coladas=""
    for mala in $PELIGROSAS; do
      printf '%s' "$resuelto" | grep -qE "^[[:space:]]+$mala:" && coladas="$coladas $mala"
    done
    if [[ -n "$coladas" ]]; then
      mv "$NUEVO" "$VIEJO"
      echo "FALLA:${coladas} llega igual al entorno de los servicios según"
      echo "  \`docker compose config\`, que es el parser que importa. Deshice la"
      echo "  mudanza: las claves siguen en data/.env. Miralo a mano antes de seguir."
      exit 1
    fi
    echo "verificado con \`docker compose config\`: ninguna variable peligrosa llega a los servicios"
  fi
fi
