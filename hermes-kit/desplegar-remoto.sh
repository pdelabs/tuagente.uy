#!/usr/bin/env bash
# Prepara una VPS para el agente de un cliente y le sube el kit.
#
#   ./desplegar-remoto.sh east root@1.2.3.4 agentes.tuagente.uy
#                         ^slug ^servidor    ^dominio base
#
# EL AGENTE NO SE NOMBRA ACA. El nombre se lo pone el CLIENTE en el bautizo,
# en el primer paso del onboarding del portal. Hasta entonces dice "Agente".
# (El 10/8 le pase "Washi" —el agente de pdelabs— y quedo con el nombre de
# otro cliente esperando a que Cata lo bautizara.)
#
# Deja el agente ARMADO PERO APAGADO: falta cargar secretos.env con las claves y
# que el DNS resuelva. Arrancar sin DNS quema intentos de Let's Encrypt, que
# tiene tope semanal — por eso no levanta nada solo.
#
# Idempotente: si el directorio ya existe, actualiza el kit y no pisa los secretos.
#
# ESTE SCRIPT YA NO SABE QUE INSTALA EL KIT, y es el cambio importante. Antes
# tenia su propia lista de rsync, paralela a la de install.sh, y las dos listas
# divergieron cuatro veces sin que nada fallara: el catalogo de capacidades no
# llego a NINGUN agente remoto (la feature entera muerta en los clientes de
# verdad), el parche del pairing no llego a los locales (el cliente recibia un
# mensaje en ingles pidiendole que corra un comando de terminal), el
# `.kit_manifest` y las carpetas del workspace salieron en uno solo. Nada
# rompia; el cliente recibia una version peor.
#
# Ahora hay UN instalador. Este script arma un agente de mentira en /tmp
# (staging), le corre el MISMO `install.sh` que a un agente local, y sube eso.
# Lo que instala el kit se decide en un solo lugar; aca solo queda lo que es
# propio de una VPS: docker, ufw, Caddy, el compose, el .env y los permisos.
#
# Para probarlo sin VPS —y el test `tools/comparar-instaladores.sh` lo usa—:
#   ./desplegar-remoto.sh <slug> --destino-local <dir> <dominio-base>
# hace todo contra un directorio local, salteando lo que necesita root o red.
set -euo pipefail

KIT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SLUG="${1:-}"; SERVIDOR="${2:-}"; DOMINIO_BASE="${3:-}"
NOMBRE="Agente"   # placeholder hasta el bautizo; ver la nota de arriba

# Modo simulacion: el "servidor" es un directorio de esta maquina.
LOCAL=""
if [[ "$SERVIDOR" == "--destino-local" ]]; then
  LOCAL="${3:-}"; DOMINIO_BASE="${4:-ejemplo.local}"; SERVIDOR=""
  [[ -n "$LOCAL" ]] || { echo "--destino-local necesita un directorio" >&2; exit 1; }
  mkdir -p "$LOCAL"
  LOCAL="$(cd "$LOCAL" && pwd)"
fi

if [[ -z "$SLUG" || -z "$DOMINIO_BASE" ]] || [[ -z "$SERVIDOR" && -z "$LOCAL" ]]; then
  echo 'uso: ./desplegar-remoto.sh <slug> <usuario@ip> <dominio-base>' >&2
  echo '     ./desplegar-remoto.sh <slug> --destino-local <dir> [dominio-base]' >&2
  echo 'ej:  ./desplegar-remoto.sh east root@1.2.3.4 agentes.tuagente.uy' >&2
  exit 1
fi

[[ "$SLUG" =~ ^[a-z][a-z0-9-]{1,30}$ ]] || { echo "slug inválido: minúsculas, números y guiones" >&2; exit 1; }

if [[ -n "$LOCAL" ]]; then
  REMOTO="$LOCAL/opt/agentes/$SLUG"
  DESTINO=""                       # rsync sin `host:`
else
  REMOTO="/opt/agentes/$SLUG"
  DESTINO="$SERVIDOR:"
fi
DOMINIO_API="$SLUG.$DOMINIO_BASE"
DOMINIO_PORTAL="$SLUG-portal.$DOMINIO_BASE"

# Las dos formas de tocar el destino, para que el resto del script no sepa si
# esta hablando con una VPS o con un directorio de prueba.
alla() {            # correr un comando alla
  if [[ -n "$LOCAL" ]]; then bash -c "$1"; else ssh "$SERVIDOR" "$1"; fi
}
escribir_alla() {   # volcar stdin en un archivo de alla
  if [[ -n "$LOCAL" ]]; then cat > "$1"; else ssh "$SERVIDOR" "cat > $1"; fi
}

echo "→ agente   $SLUG (sin bautizar — lo nombra el cliente)"
echo "→ servidor ${SERVIDOR:-(simulacion local)}:$REMOTO"
echo "→ api      https://$DOMINIO_API"
echo "→ portal   https://$DOMINIO_PORTAL"
echo

if [[ -z "$LOCAL" ]]; then
  ssh -o ConnectTimeout=10 "$SERVIDOR" true || { echo "no llego por ssh a $SERVIDOR" >&2; exit 1; }
fi

# ── 1. Docker y firewall ──────────────────────────────────────────────────
# El firewall se cierra ANTES de que exista nada escuchando, no después.
# Ojo: `docker publish` escribe en iptables por debajo de ufw, así que un
# puerto publicado queda abierto AUNQUE ufw diga que no. Por eso el compose
# remoto no publica nada salvo Caddy: la defensa real es no abrir, no el ufw.
if [[ -z "$LOCAL" ]]; then
  ssh "$SERVIDOR" 'bash -se' <<'REMOTO_SCRIPT'
set -euo pipefail
if ! command -v docker >/dev/null; then
  echo "  instalando docker…"
  curl -fsSL https://get.docker.com | sh >/dev/null
fi
if command -v ufw >/dev/null; then
  ufw --force default deny incoming >/dev/null
  ufw --force default allow outgoing >/dev/null
  for p in 22 80 443; do ufw allow "$p"/tcp >/dev/null; done
  ufw --force enable >/dev/null
  echo "  ufw: 22, 80, 443"
fi
mkdir -p /opt/agentes
REMOTO_SCRIPT
else
  echo "  (simulacion local: no toco docker ni ufw)"
fi

# ── 2. Estructura ─────────────────────────────────────────────────────────
alla "mkdir -p $REMOTO/data"

# ── 3. El kit: UN SOLO INSTALADOR ─────────────────────────────────────────
# Se arma un agente de mentira y se le corre install.sh. Lo que se sube sale de
# ahi, no de una lista escrita a mano en este archivo.
echo "→ armando el kit con install.sh (staging)"
STAGING="$(mktemp -d)"
trap 'rm -rf "$STAGING"' EXIT
mkdir -p "$STAGING/data"
# THE ROSTER FROM OVER THERE TRAVELS INTO THE STAGING BEFORE THE INSTALL.
# `install.sh` decides which skills it ships by looking at
# `politica/roles/catalogo.json` -- the same file the adapter reads to know
# whether this client has a team -- and the staging is a newborn agent: without
# this, a client with a team would get the whole kit in kit-skills/ again, which
# is mounted for the WHOLE installation, so every role would go back to paying
# prompt for the other roles' skills. Same shape as the adapter's old entrypoint
# a few lines below: what decides the install is the state OVER THERE, not the
# state of the fake directory.
if alla "[ -f $REMOTO/politica/roles/catalogo.json ]" 2>/dev/null; then
  mkdir -p "$STAGING/politica/roles"
  alla "cat $REMOTO/politica/roles/catalogo.json" > "$STAGING/politica/roles/catalogo.json"
  echo "   este agente tiene equipo: van solo las skills compartidas"
fi
if ! "$KIT/install.sh" "$STAGING/data" > "$STAGING/salida-install.txt" 2>&1; then
  echo "install.sh falló armando el staging; no subo nada:" >&2
  sed 's/^/   /' "$STAGING/salida-install.txt" >&2
  exit 1
fi

MANIF="$STAGING/.kit-instalado"
[[ -s "$MANIF" ]] || { echo "install.sh no dejó .kit-instalado: no sé qué subir" >&2; exit 1; }

# LA VENTANA DE LA MIGRACION DEL ADAPTER. Si el contenedor de allá todavía
# arranca el adapter desde `data/scripts/`, ese archivo se sigue subiendo y se
# deja anotado en el manifiesto: sacarlo ahora no rompe el proceso vivo —tiene
# el archivo abierto— pero un `docker restart` (sin `compose up -d`) arrancaría
# con el entrypoint viejo sobre un archivo que ya no está, y el portal entra en
# crash-loop. Cuando el contenedor ya corra del lugar nuevo, la ruta vieja deja
# de subirse, pasa a ser obsoleta y el limpiador la saca sola.
if alla "docker inspect --format '{{json .Config.Entrypoint}}' ${SLUG}-portal-adapter 2>/dev/null | grep -q '/opt/data/scripts'" 2>/dev/null; then
  mkdir -p "$STAGING/data/scripts"
  cp "$KIT/adapter/portal_adapter.py" "$STAGING/data/scripts/portal_adapter.py"
  printf 'data/scripts/portal_adapter.py\t%s\n' \
    "$(shasum -a 256 "$STAGING/data/scripts/portal_adapter.py" 2>/dev/null | cut -d' ' -f1 ||
       sha256sum "$STAGING/data/scripts/portal_adapter.py" | cut -d' ' -f1)" >> "$MANIF"
  sort -o "$MANIF" "$MANIF"
  echo "   el adapter de allá todavía arranca de data/scripts/: dejo esa copia"
  echo "   (después de 'docker compose up -d portal-adapter', el próximo despliegue la saca)"
fi
echo "   $(wc -l < "$MANIF" | tr -d ' ') archivos del kit"

# CHEQUEO ANTIDERIVA. Lo que se sube es EXACTAMENTE lo que install.sh dice
# haber instalado (su manifiesto). Si install.sh empieza a escribir algo que no
# figura ahi, este script se PLANTA en vez de subir de menos en silencio, que
# es exactamente como se perdieron el catalogo de capacidades y el parche del
# pairing. La lista de abajo son los archivos que install.sh crea pero NO son
# del kit: se nombran de a uno y con el motivo, y cualquier otro es un error.
NO_SE_SUBEN=(
  # Lo escribe el CLIENTE (sus permisos por conexion). install.sh solo lo crea
  # vacio si falta, y eso se hace alla abajo, del lado del agente: subir el
  # `{}` del staging le pisaria la politica al cliente.
  "politica/politica.json"
)
sin_dueno=0
while IFS= read -r rel; do
  grep -qxF "$rel" <(cut -f1 "$MANIF") && continue
  for permitido in "${NO_SE_SUBEN[@]}"; do [[ "$rel" == "$permitido" ]] && continue 2; done
  echo "DERIVA: install.sh escribió '$rel' y no está en su manifiesto." >&2
  sin_dueno=$((sin_dueno+1))
done < <(cd "$STAGING" && find . -type f ! -name '.kit-instalado' ! -name 'salida-install.txt' \
         | sed 's|^\./||' | sort)
if [[ $sin_dueno -gt 0 ]]; then
  echo >&2
  echo "No subo nada. O ese archivo es del kit —y entonces install.sh lo tiene que" >&2
  echo "anotar en el manifiesto— o es del cliente, y va en NO_SE_SUBEN con el motivo." >&2
  exit 1
fi

# Y las carpetas raiz: cada una tiene un dueño distinto alla (data/ es del
# agente, uid 10000; politica/ y kit-skills/ quedan de root porque se montan
# :ro). Una raiz nueva no puede pasar de largo sin que alguien decida de quien es.
CONOCIDAS="data politica kit-skills kit-adapter"
while IFS= read -r raiz; do
  [[ " $CONOCIDAS " == *" $raiz "* ]] && continue
  echo "DERIVA: install.sh creó la carpeta '$raiz/', que este despliegue no sabe" >&2
  echo "de quién es (¿va con permisos del agente o de root?). Decidilo acá." >&2
  exit 1
done < <(cd "$STAGING" && find . -mindepth 1 -maxdepth 1 -type d | sed 's|^\./||' | sort)

echo "→ subiendo el kit"
LISTA="$STAGING/lista-a-subir.txt"
{
  cut -f1 "$MANIF"
  # Las carpetas vacias (workspace/entregables y companeras) no son archivos y
  # no estan en el manifiesto: si no se nombran, no llegan. Las skills las dan
  # por sentadas.
  (cd "$STAGING" && find . -type d -empty | sed 's|^\./||')
} | sort -u > "$LISTA"

# --files-from Y NADA MAS. En todo este script no hay una sola opcion de borrado
# por espejo (`grep -- '-'-delete desplegar-remoto.sh` no devuelve nada), y no es
# prolijidad: es lo que hace que borrarle el workspace a un cliente sea
# IMPOSIBLE y no improbable. Con --files-from, rsync solo puede tocar lo que
# esta nombrado en la lista; la lista sale del manifiesto, o sea de los archivos
# que escribimos nosotros. Lo que el cliente escribio no esta ahi, asi que no hay
# flag, typo ni origen vacio que lo pueda alcanzar.
# (Lo viejo del kit se saca despues, por manifiesto y verificando el sha256.)
# NO AGREGUES `--no-implied-dirs` ACA. Estuvo puesto un rato para que rsync no
# le reescribiera modo y mtime a `politica/` y `kit-skills/`, y ROMPIA EL
# DESPLIEGUE ENTERO: con `--files-from` esta implicito `--relative`, el flag le
# dice al emisor que no mande los directorios del camino, y el rsync de la VPS
# (GNU 3.4.3) rechaza el archivo — `ABORTING due to invalid path from sender:
# data/connections/catalogo.json`, rc=2, CERO archivos transferidos. El agente
# quedaba con `data/` y nada mas: sin adapter, sin politica/, sin kit-skills.
#
# Y no se vio en las pruebas porque el rsync de la Mac es openrsync, que tolera
# el flag y crea los directorios igual: `comparar-instaladores.sh` daba rc=0 y
# "29 archivos idénticos" con produccion rota. Por eso existe
# `tools/probar-despliegue-ssh.sh`, que corre esto mismo contra un sshd de
# verdad con GNU rsync: cualquier opcion nueva de rsync se prueba AHI.
#
# El dueño de esas dos carpetas se arregla despues, con un chown explicito.
rsync -a --files-from="$LISTA" "$STAGING/" "$DESTINO$REMOTO/"

# El compose y el Caddyfile son de la VPS, no del kit: no salen del staging.
rsync -a "$KIT/compose/docker-compose.remoto.yml" "$DESTINO$REMOTO/docker-compose.yml"
rsync -a "$KIT/compose/Caddyfile"  "$DESTINO$REMOTO/Caddyfile"

# EL config.yaml, QUE FALTABA Y ROMPIA TODO. Sin el, Hermes escribe en el
# primer arranque su config de EJEMPLO (86 KB, todo comentado) y arranca con
# los defaults: sin `api_server.enabled` NUNCA bindea el 8642, asi que Caddy
# devuelve 502 para siempre y el sintoma parece de red. Verificado el 10/8 con
# East: el gateway "arrancaba" y no escuchaba nada.
# No se pisa si ya existe: despues del primer arranque Hermes lo migra solo.
if ! alla "grep -q 'enabled: true' $REMOTO/data/config.yaml 2>/dev/null"; then
  rsync -a "$KIT/compose/config.base.yaml" "$DESTINO$REMOTO/data/config.yaml"
  echo "→ config.yaml base instalado"
else
  echo "→ config.yaml ya configurado, no lo toco"
fi

# ── 3b. Lo que el kit dejó de traer ───────────────────────────────────────
# La contracara de subir: sacar lo viejo. NO se hace espejando carpetas —eso es
# lo que borra el trabajo del cliente— sino comparando el manifiesto nuevo con
# el que quedó de la vez pasada, y solo si el archivo sigue teniendo el sha256
# que escribimos nosotros. Es el MISMO script que corre install.sh en una
# instalación local; acá entra por stdin y no queda en el servidor.
rsync -a "$MANIF" "$DESTINO$REMOTO/.kit-instalado.nuevo"
if [[ -n "$LOCAL" ]]; then
  bash "$KIT/tools/limpiar-obsoletos.sh" "$REMOTO"
else
  ssh "$SERVIDOR" "bash -s -- $REMOTO" < "$KIT/tools/limpiar-obsoletos.sh"
fi

# La política de la guardia se crea VACÍA si no está, y NUNCA se pisa: ahí vive
# lo que este cliente habilitó. Por eso no viaja en el manifiesto (ver
# NO_SE_SUBEN, más arriba): el `{}` del staging le borraría los permisos.
alla "[ -s $REMOTO/politica/politica.json ] || echo '{}' > $REMOTO/politica/politica.json"

# EL SOUL, QUE TAMPOCO SE INSTALABA. Sin el, el agente corre con los ~800 bytes
# del preambulo de Nous y nada mas: sin regla de aprobacion, sin convenciones de
# entrega, sin idioma — y contesta como un asistente generico. Se instalan los
# cinco bloques genericos, que podemos completar solos; `00-identidad.md` queda
# para la persona que da de alta al cliente.
# Los dos argumentos: por donde entra el ssh y como se llama el directorio del
# agente. Aca no coinciden —el ssh va a usuario@ip y el agente vive en
# /opt/agentes/$SLUG— y con uno solo el SOUL no se instalaba.
if [[ -n "$LOCAL" ]]; then
  echo "   (simulacion local: el SOUL se instala por ssh, lo salteo)"
else
  "$KIT/tools/instalar-soul.sh" "$SERVIDOR" "$SLUG" || echo "   (el SOUL no se instalo; revisar a mano)"
fi

# EL CANDADO DEL config.yaml SE QUEDA PUESTO. Aca habia un `sed` que comentaba
# las DOS lineas `- ./data/config.yaml:...:ro` "para el primer arranque", y con
# eso el agente podia escribir su propio config hasta que alguien se acordara de
# correr `cerrar-config.sh` a mano — o sea casi siempre. El compose dice
# exactamente que habilita eso: "podia devolverse cronjob y registrar un MCP
# salteando la guardia; solo tenia que esperar un reinicio". Y ademas es lo que
# le da al agente la palanca de `tools/observabilidad.sh`, que lee el modelo de
# ese archivo.
#
# La precaucion era de un motor viejo: con v2026.7.30 el gateway arranca bien con
# el archivo :ro desde el PRIMER arranque —verificado el 12/8 sobre un agente
# creado de cero— porque el config lo sube este mismo script antes de levantar
# nada. Si algun dia una version nueva necesita migrarlo, esta
# `tools/con-config-abierta.sh`, que lo abre y lo vuelve a cerrar en la misma
# corrida en vez de dejarlo abierto para siempre.

# ── 4. El .env del compose (sin secretos) ─────────────────────────────────
escribir_alla "$REMOTO/.env" <<EOF
CLIENTE=$SLUG
AGENT_NAME=$NOMBRE
DOMINIO_API=$DOMINIO_API
DOMINIO_PORTAL=$DOMINIO_PORTAL
EMAIL_TLS=soporte@tuagente.uy
EOF

# ── 5. Los secretos — plantilla, NUNCA se suben con claves desde acá ───────
# Las claves se cargan a mano en el servidor. Subirlas por rsync las deja en
# el historial del shell local y en cualquier backup del portátil.
#
# Y VAN EN LA RAIZ DEL AGENTE, no en data/. `data/` es del agente (rw, y adentro
# corre como root) y este archivo es el env_file de los DOS servicios: con las
# claves ahi, un `PYTHONPATH=/opt/data/...` le hace ejecutar codigo suyo adentro
# del adapter, y de ahi llega a politica/ —la puerta— y al cont-init que s6
# corre como root. Medido con la imagen real.
if [[ -z "$LOCAL" ]]; then
  ssh "$SERVIDOR" "bash -s -- $REMOTO" < "$KIT/tools/migrar-secretos.sh"
else
  bash "$KIT/tools/migrar-secretos.sh" "$REMOTO"
fi
if alla "[ -s $REMOTO/secretos.env ]"; then
  echo "→ secretos.env ya existe, no lo toco"
else
  escribir_alla "$REMOTO/secretos.env" <<'EOF'
API_SERVER_KEY=
OPENROUTER_API_KEY=
TELEGRAM_BOT_TOKEN=
TELEGRAM_ALLOWED_USERS=
EOF
  alla "chmod 600 $REMOTO/secretos.env"
  echo "→ secretos.env creado VACÍO — hay que completarlo en el servidor"
fi

# ── 6. EL DUEÑO DE data/, QUE ES LO QUE ROMPIO EL PRIMER DESPLIEGUE ────────
# Todo lo de arriba se creo por ssh, o sea COMO ROOT. El agente corre como uid
# 10000 y el primer arranque quiere sembrar las 70 skills del motor en
# data/skills: sin permiso tira ~140 "Permission denied" seguidos, el indice
# queda VACIO y el agente arranca sin una sola skill. No falla el arranque, no
# hay error visible en el portal: simplemente no sabe hacer nada. Visto con
# Mr.Wobble el 12/8/2026.
#
# Va al final, cuando ya se subio todo lo que va adentro de data/.
#
# Y LOS DUEÑOS SE PONEN EXPLICITAMENTE, que hasta hoy no se hacia: `rsync -a`
# implica `-o -g` y les aplicaba el dueño del emisor, o sea que en la VPS
# quedaban `501:staff` — el uid de una Mac, que en el servidor no es nadie.
#
#   kit-skills/ y kit-adapter/  → root. Nadie las escribe nunca: los dos
#                                 servicios las montan :ro.
#   politica/                   → del ADAPTER (uid 10000), y a proposito: ahi
#                                 escribe `politica.json` (los permisos del
#                                 cliente) y `capacidades/pedidos.jsonl`. Lo que
#                                 protege esa carpeta del AGENTE no es el dueño
#                                 sino el montaje :ro de su contenedor —
#                                 verificado: adentro de hermes da "Read-only
#                                 file system" hasta para root.
#                                 (Que el adapter pueda reescribir los hooks que
#                                 estan al lado es un pendiente anotado en
#                                 PENDIENTES.md: se cierra sacando sus dos
#                                 archivos a una carpeta propia. Con el codigo
#                                 del adapter ya fuera del alcance del agente,
#                                 no hay camino para llegar hasta ahi.)
#   .kit-instalado              → de root y 600: es nuestro y no lo lee nadie mas.
if [[ -n "$LOCAL" ]]; then
  echo "→ permisos: (simulacion local: los chown necesitan root, los salteo)"
else
  echo "→ permisos: data/ y politica/ del agente (uid 10000); kit-skills/ y kit-adapter/ de root"
  ssh "$SERVIDOR" "chown -R 10000:10000 $REMOTO/data $REMOTO/politica && \
                   chown -R root:root $REMOTO/kit-skills $REMOTO/kit-adapter && \
                   chown root:root $REMOTO/.kit-instalado $REMOTO/secretos.env && \
                   chmod 600 $REMOTO/.kit-instalado $REMOTO/secretos.env"
fi

cat <<EOF

Listo, y apagado a propósito. Falta:

  1. DNS (en Vercel, tuagente.uy):
       $DOMINIO_API      A  -> la IP de la VPS
       $DOMINIO_PORTAL   A  -> la misma IP
     Verificar que resuelva ANTES de levantar:
       dig +short $DOMINIO_API

  2. Las claves, en el servidor (no desde acá):
       ssh $SERVIDOR
       openssl rand -hex 32          # la API_SERVER_KEY, única de este cliente
       nano $REMOTO/secretos.env

  3. Revisar el data/ ANTES de prender. No es opcional y no lo cubre
     portal-check: agarra el SOUL con huecos, las skills mudas, los olvidos de
     config — y las DOS migraciones que este despliegue no hace, porque
     necesitan el árbol vivo del agente: una skill vieja en data/skills/ que
     tapa a la del kit, y el catálogo de capacidades viejo adentro de data/.
       rsync -a $SERVIDOR:$REMOTO/data/ /tmp/$SLUG-data/
       python3 tools/agente-check.py /tmp/$SLUG-data
     Si reporta alguna de esas dos, se arregla corriendo install.sh sobre esa
     copia y subiendo lo que cambió, o a mano en el servidor.

  4. Levantar:
       ssh $SERVIDOR 'cd $REMOTO && docker compose up -d'

  5. Verificar, y son 0 fallas o no se entrega:
       python3 tools/portal-check.py --key <clave> \\
           --endpoint https://$DOMINIO_API \\
           --adapter  https://$DOMINIO_PORTAL \\
           --origin   https://tuagente.uy

  6. Despues del bautizo, la foto del bot (la Bot API no deja que un bot
     cambie la suya, va por MTProto desde tu Mac). Los dos argumentos: por
     donde entra el ssh y como se llama el agente en /opt/agentes/:
       tools/foto-bot.sh $SERVIDOR $SLUG

  (El candado del config.yaml ya viene puesto: el compose lo monta :ro desde el
   primer arranque. `tools/cerrar-config.sh` queda para los agentes viejos que
   se desplegaron cuando este script lo dejaba abierto — miralo con
   `grep -c 'config.yaml:/opt/data/config.yaml:ro' $REMOTO/docker-compose.yml`,
   tiene que dar 2.)

  7. El link, que ES la credencial:
       https://tuagente.uy/app#endpoint=https://$DOMINIO_API&adapter=https://$DOMINIO_PORTAL&key=<clave>
EOF
