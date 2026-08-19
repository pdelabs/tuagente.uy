#!/usr/bin/env bash
# Hire a role into an agent: build it, name it, install it, give it its own key,
# serve it.
#
#   ./contratar-rol.sh soporte tuagente              # ssh: alias named like the agent
#   ./contratar-rol.sh soporte root@1.2.3.4 east     # ssh: host + slug
#   ./contratar-rol.sh soporte --local ~/…/agente-lab
#
#   --del-pedido            toma el nombre y la pinta del pedido que dejó el
#                           cliente en el portal (politica/roles/pedidos.jsonl)
#   --nombre "Juana"        se lo pone a mano (pisa el pedido, si había)
#   --pinta-file cara.json  la cara, para un alta a mano; va con --nombre
#
# WHY THIS EXISTS AND IS NOT FOUR COMMANDS IN A RUNBOOK. Hiring a role needs
# several things to happen together, and the one everybody forgets is the third:
#
#   1. build the distribution        roles/build_role.py
#   2. install it                    hermes profile install
#   3. GIVE IT ITS OWN API KEY       <- without this you cannot talk to it
#   4. restart the gateway           <- profiles_to_serve runs only at boot
#   5. leave the baptism             <- the name the client chose, or it is lost
#   6. leave the roster              <- last on purpose: see it, further down
#
# Step 3 is not optional and it is not obvious. The engine resolves
# API_SERVER_KEY inside the profile's own scope and FAILS CLOSED rather than let
# a named profile inherit the listener's key -- correct upstream, and it means a
# role installed without a key is a role the portal gets a 401 from. Measured
# 2026-08-17: `/p/marketing/…` answers 200 with marketing's key, 401 with the
# client's.
#
# Step 4 is the same shape of trap: `profiles_to_serve` reads the profile list
# once, at gateway startup. Install a role and the gateway keeps serving the old
# set until it restarts -- so the role exists, has a key, and still cannot be
# reached.
set -euo pipefail

KIT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Las banderas salen primero y lo posicional queda igual que siempre: bash 3.2
# (el /bin/bash de macOS) no tiene getopt largo y no lo vamos a extrañar.
DEL_PEDIDO=0
NOMBRE=""
PINTA_FILE=""
ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --del-pedido) DEL_PEDIDO=1; shift ;;
    --nombre)     NOMBRE="${2:-}"; shift 2 ;;
    --pinta-file) PINTA_FILE="${2:-}"; shift 2 ;;
    *)            ARGS+=("$1"); shift ;;
  esac
done
set -- ${ARGS[@]+"${ARGS[@]}"}

ROL="${1:-}"; shift || true

MODO=ssh
if [[ "${1:-}" == "--local" ]]; then MODO=local; DIR="${2:-}"; else HOST="${1:-}"; SLUG="${2:-${1:-}}"; fi

if [[ -z "$ROL" ]] || { [[ "$MODO" == local && -z "${DIR:-}" ]]; } || { [[ "$MODO" == ssh && -z "${HOST:-}" ]]; }; then
  echo 'uso: ./contratar-rol.sh <rol> <host-ssh> [slug]   |   ./contratar-rol.sh <rol> --local <ruta>' >&2
  echo '     [--del-pedido] [--nombre "Juana"] [--pinta-file cara.json]' >&2
  exit 2
fi
[[ -d "$KIT/roles/$ROL" ]] || { echo "no existe roles/$ROL" >&2; exit 1; }
[[ -z "$PINTA_FILE" || -f "$PINTA_FILE" ]] || { echo "no existe $PINTA_FILE" >&2; exit 1; }

# Dónde vive cada cosa, en los dos modos. Se resuelve ACÁ ARRIBA porque el
# pedido del cliente hay que leerlo antes de armar nada: el nombre que eligió
# entra en el SOUL, y el SOUL se compone en el build.
if [[ "$MODO" == local ]]; then
  DIR="$(cd "$DIR" && pwd)"; SLUG="$(basename "$DIR")"
  CONT="$(basename "$DIR" | sed 's/^agente-//')-hermes"
  POLITICA="$DIR/politica/roles"
  corre() { docker exec "$CONT" sh -c "$1"; }
else
  CONT="$SLUG-hermes"
  POLITICA="/opt/agentes/$SLUG/politica/roles"
  corre() { ssh "$HOST" "docker exec $CONT sh -c '$1'"; }
fi

# politica/ VIVE EN EL HOST, no adentro del contenedor del motor: ahí está
# montada :ro a propósito (un guardrail que el guardado puede reescribir no es
# un guardrail). Estas tres funciones son la única puerta a esos archivos y
# valen igual en local y por ssh, así que abajo no hay un `if` por cada archivo.
trae() { if [[ "$MODO" == local ]]; then cat "$POLITICA/$1" 2>/dev/null || true
         else ssh "$HOST" "cat '$POLITICA/$1' 2>/dev/null" || true; fi; }
# The remote path runs as root over ssh, and the adapter container runs as
# 10000:10000 with politica/ mounted rw: a root-owned roles/ dir means the
# next pedido from the portal dies on Errno 13. The chown keeps what the hire
# drops writable for the adapter. Locally Docker Desktop virtualises bind-mount
# ownership, so there is nothing to fix on the Mac.
deja() { if [[ "$MODO" == local ]]; then mkdir -p "$POLITICA"; cat > "$POLITICA/$1"
         else ssh "$HOST" "mkdir -p '$POLITICA' && cat > '$POLITICA/$1' && chown -R 10000:10000 '$POLITICA'"; fi; }
suma() { if [[ "$MODO" == local ]]; then mkdir -p "$POLITICA"; cat >> "$POLITICA/$1"
         else ssh "$HOST" "mkdir -p '$POLITICA' && cat >> '$POLITICA/$1' && chown -R 10000:10000 '$POLITICA'"; fi; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# EL PEDIDO DEL CLIENTE. El portal no contrata: escribe una línea en
# pedidos.jsonl con el rol, el nombre que le puso y la cara que le dibujó. El
# pendiente se DERIVA del log (un `atendido` o un `cancelado` lo cierra), igual
# que lo hace el adapter, para que los dos no puedan discrepar sobre qué nombre
# se está instalando.
trae pedidos.jsonl > "$TMP/pedidos.jsonl"
PEDIDO_NOMBRE="$(python3 - "$ROL" "$TMP/pedidos.jsonl" "$TMP/pinta-pedido.json" <<'PY'
import json, sys

rol, log, pinta_out = sys.argv[1], sys.argv[2], sys.argv[3]
pendiente = None
for linea in open(log, encoding="utf-8"):
    try:
        fila = json.loads(linea)
    except ValueError:
        continue                       # una línea a medio escribir cuesta esa línea
    if fila.get("rol") != rol:
        continue
    if fila.get("evento") == "pedido" and pendiente is None:
        pendiente = fila               # el más viejo: es el que el cliente espera
    elif fila.get("evento") in ("atendido", "cancelado"):
        pendiente = None
if pendiente is None:
    raise SystemExit(0)
if pendiente.get("pinta"):
    with open(pinta_out, "w", encoding="utf-8") as fh:
        json.dump(pendiente["pinta"], fh, ensure_ascii=False)
print(pendiente.get("nombre") or "")
PY
)"

if [[ "$DEL_PEDIDO" == 1 ]]; then
  [[ -n "$PEDIDO_NOMBRE" ]] || { echo "no hay ningún pedido pendiente de '$ROL' en $POLITICA/pedidos.jsonl" >&2; exit 1; }
  NOMBRE="$PEDIDO_NOMBRE"
  if [[ -f "$TMP/pinta-pedido.json" ]]; then PINTA_FILE="$TMP/pinta-pedido.json"; fi
  echo "→ pedido del cliente: lo bautizó $NOMBRE"
elif [[ -z "$NOMBRE" && -n "$PEDIDO_NOMBRE" ]]; then
  # Contratar ignorando el pedido es perder el nombre que el cliente eligió, y
  # perderlo callado: el rol entra llamándose Beto y el portal muestra a Beto
  # donde el cliente escribió Juana. Se para acá y se elige a mano.
  echo "hay un pedido pendiente de '$ROL': el cliente lo bautizó $PEDIDO_NOMBRE." >&2
  echo "corré con --del-pedido para contratarlo con ese nombre, o --nombre X para pisarlo." >&2
  exit 1
fi

if [[ -n "$NOMBRE" ]]; then
  # Un solo saneo para los dos destinos: el SOUL y identidades.json tienen que
  # decir el MISMO nombre, o el rol se presenta de una forma y el portal lo
  # dibuja de otra. (El escritor del SOUL vuelve a sacar `<` y `>` igual: ahí
  # vive el invariante del bloque, no acá.)
  NOMBRE="$(python3 -c 'import re,sys; print(re.sub(r"\s+", " ", sys.argv[1]).replace("<","").replace(">","").strip()[:40])' "$NOMBRE")"
  [[ -n "$NOMBRE" ]] || { echo "ese nombre no deja nada utilizable" >&2; exit 1; }
fi

echo "→ armando la distribución"
# Into the temp dir, NOT the repo's dist/: the client's name gets injected into
# this build, and a named build sitting in the working tree is one copy-paste
# of build_role.py's suggested install command away from landing in the next
# client's agent. The repo's dist/ stays nameless.
DIST="$TMP/dist/$ROL"
python3 "$KIT/roles/build_role.py" "$ROL" --out "$TMP/dist" >/dev/null

if [[ -n "$NOMBRE" ]]; then
  echo "→ dejándole su nombre en el SOUL"
  # EL BLOQUE `portal:identidad`, el mismo que escribe el bautizo del agente
  # entero (adapter: escribir_identidad_en_soul). No es una convención de este
  # script: el bloque base del SOUL ya dice que si más adelante aparece un
  # `portal:identidad`, ESE nombre manda sobre cualquier otro del documento.
  # Va acá y no adentro del contenedor porque SOUL.md es `distribution_owned`:
  # lo pisa cada `hermes profile install`, así que el nombre tiene que viajar en
  # la distribución y volver a entrar en cada actualización.
  python3 - "$DIST/SOUL.md" "$NOMBRE" <<'PY'
import re, sys

soul, nombre = sys.argv[1], sys.argv[2]
# Ni `<` ni `>`: el bloque se delimita con comentarios HTML y un nombre con
# esos caracteres lo cierra antes de tiempo (mismo saneo que el adapter).
nombre = re.sub(r"\s+", " ", nombre).replace("<", "").replace(">", "").strip()[:40]
inicio, fin = "<!-- portal:identidad -->", "<!-- /portal:identidad -->"
bloque = "\n".join([
    inicio,
    "## Quién sos",
    "",
    f"Tu cliente te bautizó **{nombre}** desde el portal. Ese es tu nombre:",
    "presentate así cuando saludes, cuando te pregunten quién sos y cuando",
    "firmes lo que entregás. Si el resto de este documento te llama de otra",
    "forma, vale este.",
    fin,
])
texto = open(soul, encoding="utf-8").read()
i, f = texto.find(inicio), texto.find(fin)
nuevo = texto[:i] + bloque + texto[f + len(fin):] if i != -1 and f > i else texto.rstrip() + "\n\n" + bloque + "\n"
open(soul, "w", encoding="utf-8").write(nuevo)
PY
fi

# La clave del rol se genera ACA y no se reutiliza ninguna: es lo que separa a un
# rol de otro para el motor, y compartirla seria darle a los cuatro la misma
# puerta.
CLAVE="$(openssl rand -hex 32)"

echo "→ copiando la distribución"
if [[ "$MODO" == local ]]; then
  docker cp "$DIST" "$CONT:/tmp/dist-$ROL" >/dev/null
else
  ssh "$HOST" "rm -rf /tmp/dist-$ROL"
  scp -rq "$DIST" "$HOST:/tmp/dist-$ROL"
  ssh "$HOST" "docker cp /tmp/dist-$ROL $CONT:/tmp/dist-$ROL"
fi

echo "→ instalando el profile"
corre "hermes profile install /tmp/dist-$ROL -y" | tail -3

echo "→ dándole su propia clave"
corre "echo 'API_SERVER_KEY=$CLAVE' > /opt/data/profiles/$ROL/.env && chown 10000:10000 /opt/data/profiles/$ROL/.env"

echo "→ apuntando su workspace al compartido"
# ONE workspace, the client's. Every profile gets its own workspace dir and the
# portal's Archivos tab reads only the default's -- so a role that "delivered"
# into its private dir delivered into a place no screen shows. A symlink makes
# this a filesystem fact instead of a SOUL instruction someone can forget.
# cp -rn first: never clobber anything the role already wrote.
corre "w=/opt/data/profiles/$ROL/workspace; if [ -d \"\$w\" ] && [ ! -L \"\$w\" ]; then cp -rn \"\$w\"/. /opt/data/workspace/ 2>/dev/null || true; rm -rf \"\$w\"; ln -s /opt/data/workspace \"\$w\"; chown -h 10000:10000 \"\$w\"; fi"

echo "→ reiniciando el gateway para que lo sirva"
if [[ "$MODO" == local ]]; then docker restart "$CONT" >/dev/null; else ssh "$HOST" "docker restart $CONT" >/dev/null; fi

echo "→ esperando"
until corre "hermes profile list" >/dev/null 2>&1; do sleep 5; done
# El gateway contesta antes de escribir la linea del multiplex, asi que la
# espera de arriba no alcanza: sin esto el script mostraba el conjunto VIEJO y
# parecia que el rol no habia entrado.
until corre "grep -q \"multiplex:.*'"'"'$ROL'"'"'\" /opt/data/logs/gateway.log" 2>/dev/null; do sleep 3; done

# DE ACÁ PARA ABAJO SE PERSISTE, y no antes: el rol ya está instalado y el
# gateway ya lo sirve. Un alta que se cayó en `hermes profile install` no deja
# nada escrito (ver el porqué del roster, más abajo).
if [[ -n "$NOMBRE" ]]; then
  echo "→ anotando el bautizo"
  # EL NOMBRE DEL CLIENTE NO VIVE EN EL PROFILE. role.json es
  # `distribution_owned`: el próximo `hermes profile install` lo reemplaza y el
  # bautizo se iría con la primera actualización que el cliente no pidió. Vive
  # en politica/roles/identidades.json, que es del host, y es lo que el adapter
  # lee para servir el nombre y la cara en `GET /portal/roles`.
  trae identidades.json > "$TMP/identidades.json"
  python3 - "$ROL" "$NOMBRE" "$PINTA_FILE" "$TMP/identidades.json" "$TMP/identidades.nueva.json" <<'PY'
import json, sys, time

rol, nombre, pinta_file, actual, salida = sys.argv[1:6]
try:
    with open(actual, encoding="utf-8") as fh:
        datos = json.load(fh)
except (OSError, ValueError):
    datos = {}                          # todavía no bautizó a nadie
if not isinstance(datos, dict):
    datos = {}
pinta = None
if pinta_file:
    with open(pinta_file, encoding="utf-8") as fh:
        pinta = json.load(fh)
datos[rol] = {
    "nombre": nombre,
    "pinta": pinta,
    "bautizado_en": time.strftime("%Y-%m-%dT%H:%M:%S"),
}
with open(salida, "w", encoding="utf-8") as fh:
    json.dump(datos, fh, ensure_ascii=False, indent=2)
    fh.write("\n")
PY
  deja identidades.json < "$TMP/identidades.nueva.json"

  # Y SE CIERRA EL PEDIDO. pedidos.jsonl es append-only —nunca se reescribe una
  # línea— así que "ya está contratado" es un evento más, no un campo que
  # alguien edita. Sin esto el portal le sigue mostrando al cliente "lo pediste,
  # está en camino" a alguien que ya está trabajando.
  python3 -c 'import json,sys,time; print(json.dumps({"evento":"atendido","rol":sys.argv[1],"nombre":sys.argv[2],"atendido_en":time.strftime("%Y-%m-%dT%H:%M:%S")}, ensure_ascii=False))' \
    "$ROL" "$NOMBRE" | suma pedidos.jsonl
fi

echo "→ dejando el roster en politica/"
# THE ROSTER IS WHAT TURNS THIS AGENT INTO A TEAM, for the portal and for the
# installer. The adapter draws the Equipo tab only when `politica/roles/
# catalogo.json` exists, and `install.sh` reads the same file to decide that
# kit-skills/ gets the shared skills and nothing else. Hiring is the moment it
# becomes true, so hiring is what writes it -- until today it was a file
# somebody had to copy by hand, and an agent could have four roles installed
# while the portal still showed the single-agent product.
#
# AND IT IS THE LAST STEP, not the first, because the order IS the safety here.
# Written up front, a hire that failed at `hermes profile install` left behind a
# roster with zero profiles installed: a working single-agent client whose next
# `install.sh` reads that file, believes there is a team, and strips the five
# craft skills out of kit-skills/ -- with nowhere for them to have gone. No
# rollback undoes that (the next installer run is what does the damage, hours
# later); the fix is that the dangerous state never exists. Down here the roster
# is only written once the profile is installed AND the gateway is serving it,
# so "there is a team" and "a teammate answers" become true together.
#
# It goes on the HOST and not through `docker exec`: politica/ is mounted read
# only in the engine's container, on purpose (a guardrail the guarded can
# rewrite is not a guardrail).
deja catalogo.json < "$KIT/roles/catalogo.json"

echo
corre "grep -o \"multiplex: .*\" /opt/data/logs/gateway.log | tail -1" || true
echo
echo "Listo. $ROL contratado en $SLUG${NOMBRE:+, y se llama $NOMBRE}."
echo "El portal lo va a mostrar en Equipo — no hace falta pasarle ninguna clave:"
echo "el adapter tiene la del rol y el cliente sigue con la suya."
echo
echo "Si es el primer rol de este agente, corré el instalador una vez más:"
echo "  ./install.sh <agente>/data      (o ./desplegar-remoto.sh, si es remoto)"
echo "Ahora que hay roster, kit-skills/ se queda con las skills compartidas y las"
echo "de oficio dejan de cobrárselas todos los roles en cada pedido."
