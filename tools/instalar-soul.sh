#!/usr/bin/env bash
# Instala el SOUL base del kit en un agente que no lo tiene.
#
#   ./instalar-soul.sh tuagente
#   ./instalar-soul.sh root@1.2.3.4 east   # si el host ssh no se llama como el agente
#   ./instalar-soul.sh --bloque            # imprime lo que instalaria, sin ssh y sin tocar nada
#   ./instalar-soul.sh --reemplazar tuagente   # cambia el bloque viejo por el nuevo
#
# POR QUE EXISTE: `desplegar-remoto.sh` nunca instalaba SOUL. Los agentes
# remotos corrian con los 800 bytes del preambulo de Nous y NADA mas: sin regla
# de aprobacion, sin convenciones de entrega, sin idioma. Por eso contestaban
# como un asistente generico. (Visto el 11/8 con Mr.Wobble: 10 lineas de SOUL.)
#
# QUE INSTALA: los cinco bloques genericos —aprobaciones, entrega, canales,
# lenguaje y precedencia— entre los marcadores `kit:base`, con su version, y con
# <RESPONSABLE> resuelto como "tu cliente", que es exactamente quien tiene el
# portal en la mano.
#
# QUE NO: `00-identidad.md`, que tiene ocho huecos y es la parte artesanal (a
# que se dedica, quien es quien, que jamas puede pasar sin OK). El bloque que
# el portal escribe en el bautizo ya cubre nombre y empresa; el resto lo
# escribe una persona, cliente por cliente.
#
# Es idempotente: si ya hay un bloque —de la version que sea— no lo duplica.
# Para PASAR de una version a otra esta `--reemplazar`, que saca el bloque viejo
# y pone el nuevo conservando todo lo de afuera (la identidad, el bloque que
# escribio el portal en el bautizo) y negandose si adentro del viejo hay algo
# escrito para ese cliente. Antes esto era "saca el bloque viejo a mano", sobre
# un archivo de 15 KB y por ssh.
#
# NECESITA python3 EN TU MAQUINA (no en el servidor): antes de subir nada corre
# `agente-check.py --revisar` sobre el bloque que compuso. Sin python3 no
# instala, y es a proposito — es el unico control que hay entre un bloque roto
# (un hueco sin llenar, un comentario que el motor lee como inyeccion) y el
# prompt de un agente en produccion.
set -euo pipefail

KIT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BLOQUES=(01-aprobaciones 02-entrega 03-canales 04-lenguaje 05-precedencia)
[[ -f "$KIT/soul/VERSION" ]] || {
  echo "falta $KIT/soul/VERSION, que dice qué versión del bloque instala el kit." >&2
  echo "Es una línea con la versión (vN). Crealo y volvé a correr:" >&2
  echo "   echo v2 > $KIT/soul/VERSION" >&2
  exit 1
}
VERSION="$(tr -d '[:space:]' < "$KIT/soul/VERSION")"

# La version tiene forma de version o no se estampa nada. Un "2" o un "v2.1"
# entran igual en el marcador y despues `agente-check.py` los ve como
# marcadores desbalanceados, que manda a buscar el problema a otro lado.
[[ "$VERSION" =~ ^v[0-9]+$ ]] || {
  echo "soul/VERSION dice '$VERSION' y tiene que ser vN (v1, v2, v3…)." >&2
  echo "No instalo nada hasta que eso esté bien." >&2
  exit 1
}

MARCA="<!-- kit:base $VERSION -->"
CIERRE="<!-- /kit:base -->"

# La composicion, aparte del ssh: asi se puede ver y chequear lo que se va a
# instalar sin tener un servidor delante (`--bloque`).
componer() {
  echo "$MARCA"
  echo
  for b in "${BLOQUES[@]}"; do
    sed 's/<RESPONSABLE>/tu cliente/g' "$KIT/soul/$b.md"
    echo
  done
  echo "$CIERRE"
  echo
}

if [[ "${1:-}" == "--bloque" ]]; then
  componer
  exit 0
fi

REEMPLAZAR=0
if [[ "${1:-}" == "--reemplazar" ]]; then
  REEMPLAZAR=1
  shift
fi

HOST="${1:-}"
[[ -n "$HOST" ]] || {
  echo 'uso: ./instalar-soul.sh [--reemplazar] <host-ssh> [slug] | --bloque' >&2
  exit 1
}
# El directorio en la VPS es /opt/agentes/<slug>, y por defecto el slug es el
# mismo nombre del host ssh (asi lo usan observabilidad.sh y resetear-agente.sh).
# Cuando no coinciden —`desplegar-remoto.sh` entra por usuario@ip— va como
# segundo argumento; sin eso el script subia el archivo, fallaba el `cd` y
# terminaba sin instalar nada.
SLUG="${2:-$HOST}"
DIR="/opt/agentes/$SLUG"

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
componer > "$tmp"

# NADA sale de aca sin revisar, y se revisa ANTES de tocar la red: es una
# propiedad del kit, no del servidor. Son las dos fallas mudas del SOUL, con el
# mismo codigo que despues revisa el SOUL ya instalado:
#
#   - un hueco sin llenar: la REGLA DURA llego a produccion diciendo
#     "JAMAS <la accion sensible: ...>", que no prohibe nada;
#   - un comentario HTML con ignore/override/system/secret/hidden: el motor
#     descarta el archivo ENTERO y el agente arranca sin identidad ni reglas.
if ! salida="$(python3 "$KIT/tools/agente-check.py" --revisar "$tmp")"; then
  echo "$salida" >&2
  echo >&2
  echo "No instalo nada: arreglá los bloques de soul/ y volvé a correr." >&2
  exit 1
fi

ssh "$HOST" "[ -d $DIR/data ]" || {
  echo "no existe $DIR/data en $HOST" >&2
  echo "si el directorio del agente no se llama '$SLUG', pasalo como segundo" >&2
  echo "argumento:  ./instalar-soul.sh $HOST <slug>" >&2
  exit 1
}

# Ya instalado: vale cualquier version, pero decimos cual hay. No lo pisamos: si
# quedaran dos bloques, la regla de precedencia haria ganar al de mas abajo, o
# sea al viejo.
puesto="$(ssh "$HOST" "grep -o '<!-- kit:base[^>]*-->' $DIR/data/SOUL.md 2>/dev/null | head -1" || true)"

if [[ $REEMPLAZAR -eq 1 ]]; then
  [[ -n "$puesto" ]] || {
    echo "$HOST no tiene ningun bloque kit:base: esto es una instalacion, no un" >&2
    echo "reemplazo. Corré el mismo comando sin --reemplazar." >&2
    exit 1
  }
  viejo="$(mktemp)"; nuevo="$(mktemp)"
  trap 'rm -f "$tmp" "$viejo" "$nuevo"' EXIT
  ssh "$HOST" "cat $DIR/data/SOUL.md" > "$viejo"
  echo "→ $HOST tiene $puesto · este kit instala $VERSION"
  # El SOUL viejo queda en tu maquina antes de tocar nada: si algo sale mal, el
  # original esta acá y no hay que ir a buscarlo al servidor.
  mkdir -p "$KIT/respaldos-soul"
  respaldo="$KIT/respaldos-soul/$SLUG-$(date +%Y%m%d-%H%M%S).md"
  cp "$viejo" "$respaldo"
  echo "   copia del SOUL viejo: $respaldo"
  if ! python3 "$KIT/tools/reemplazar-bloque.py" "$viejo" "$tmp" > "$nuevo"; then
    echo >&2
    echo "No toqué nada en $HOST." >&2
    exit 1
  fi
  ssh "$HOST" "cat > /tmp/soul-nuevo.md" < "$nuevo"
  ssh "$HOST" "cd $DIR/data && mv /tmp/soul-nuevo.md SOUL.md && chown 10000:10000 SOUL.md"
  echo "→ bloque reemplazado por $VERSION en $HOST"
  ssh "$HOST" "wc -c < $DIR/data/SOUL.md | sed 's/^/   /' ; echo '   bytes'"
  echo
  echo "Revisá que el agente siga sabiendo quién es: el bloque de identidad y el"
  echo "del bautizo quedaron afuera del reemplazo, pero mirarlo cuesta un minuto."
  exit 0
fi

if [[ -n "$puesto" ]]; then
  echo "$HOST ya tiene el bloque base: $puesto"
  echo "Este kit instala $VERSION. Para actualizarlo: ./instalar-soul.sh --reemplazar $HOST${2:+ $2}"
  exit 0
fi

# Se ANTEPONE a lo que ya hay: el preambulo de Nous y, sobre todo, el bloque
# `portal:identidad` que el adapter reescribe en cada bautizo. Pisar el archivo
# entero borraria el nombre y la empresa que el cliente ya cargo.
ssh "$HOST" "cat > /tmp/soul-base.md" < "$tmp"
ssh "$HOST" "cd $DIR/data && \
  { cat /tmp/soul-base.md; [ -f SOUL.md ] && cat SOUL.md; } > SOUL.nuevo && \
  mv SOUL.nuevo SOUL.md && chown 10000:10000 SOUL.md && rm -f /tmp/soul-base.md"

echo "→ SOUL $VERSION instalado en $HOST"
ssh "$HOST" "wc -c < $DIR/data/SOUL.md | sed 's/^/   /' ; echo '   bytes'"
echo
echo "FALTA lo artesanal: 00-identidad.md (a qué se dedica, quién aprueba qué,"
echo "qué jamás puede pasar sin OK). Eso lo escribe una persona, por cliente."
echo
echo "Y después, el chequeo completo sobre el data/ del agente —agarra el SOUL"
echo "sin identidad, las skills mudas y los olvidos de config—:"
echo "   python3 tools/agente-check.py $DIR/data     (en $HOST, o sobre una copia)"
