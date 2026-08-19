#!/usr/bin/env bash
# Hire a role into an agent: build it, install it, give it its own key, serve it.
#
#   ./contratar-rol.sh soporte tuagente              # ssh: alias named like the agent
#   ./contratar-rol.sh soporte root@1.2.3.4 east     # ssh: host + slug
#   ./contratar-rol.sh soporte --local ~/…/agente-lab
#
# WHY THIS EXISTS AND IS NOT FOUR COMMANDS IN A RUNBOOK. Hiring a role needs
# four things to happen together, and the one everybody forgets is the third:
#
#   1. build the distribution        roles/build_role.py
#   2. install it                    hermes profile install
#   3. GIVE IT ITS OWN API KEY       <- without this you cannot talk to it
#   4. restart the gateway           <- profiles_to_serve runs only at boot
#   5. leave the roster              <- last on purpose: see it, further down
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
ROL="${1:-}"; shift || true

MODO=ssh
if [[ "${1:-}" == "--local" ]]; then MODO=local; DIR="${2:-}"; else HOST="${1:-}"; SLUG="${2:-${1:-}}"; fi

if [[ -z "$ROL" ]] || { [[ "$MODO" == local && -z "${DIR:-}" ]]; } || { [[ "$MODO" == ssh && -z "${HOST:-}" ]]; }; then
  echo 'uso: ./contratar-rol.sh <rol> <host-ssh> [slug]   |   ./contratar-rol.sh <rol> --local <ruta>' >&2
  exit 2
fi
[[ -d "$KIT/roles/$ROL" ]] || { echo "no existe roles/$ROL" >&2; exit 1; }

echo "→ armando la distribución"
python3 "$KIT/roles/build_role.py" "$ROL" >/dev/null

# La clave del rol se genera ACA y no se reutiliza ninguna: es lo que separa a un
# rol de otro para el motor, y compartirla seria darle a los cuatro la misma
# puerta.
CLAVE="$(openssl rand -hex 32)"

if [[ "$MODO" == local ]]; then
  DIR="$(cd "$DIR" && pwd)"; SLUG="$(basename "$DIR")"
  CONT="$(basename "$DIR" | sed 's/^agente-//')-hermes"
  docker cp "$KIT/dist/$ROL" "$CONT:/tmp/dist-$ROL" >/dev/null
  corre() { docker exec "$CONT" sh -c "$1"; }
else
  ssh "$HOST" "rm -rf /tmp/dist-$ROL"
  scp -rq "$KIT/dist/$ROL" "$HOST:/tmp/dist-$ROL"
  CONT="$SLUG-hermes"
  ssh "$HOST" "docker cp /tmp/dist-$ROL $CONT:/tmp/dist-$ROL"
  corre() { ssh "$HOST" "docker exec $CONT sh -c '$1'"; }
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
if [[ "$MODO" == local ]]; then
  mkdir -p "$DIR/politica/roles"
  cp "$KIT/roles/catalogo.json" "$DIR/politica/roles/catalogo.json"
else
  ssh "$HOST" "mkdir -p /opt/agentes/$SLUG/politica/roles"
  scp -q "$KIT/roles/catalogo.json" "$HOST:/opt/agentes/$SLUG/politica/roles/catalogo.json"
fi

echo
corre "grep -o \"multiplex: .*\" /opt/data/logs/gateway.log | tail -1" || true
echo
echo "Listo. $ROL contratado en $SLUG."
echo "El portal lo va a mostrar en Equipo — no hace falta pasarle ninguna clave:"
echo "el adapter tiene la del rol y el cliente sigue con la suya."
echo
echo "Si es el primer rol de este agente, corré el instalador una vez más:"
echo "  ./install.sh <agente>/data      (o ./desplegar-remoto.sh, si es remoto)"
echo "Ahora que hay roster, kit-skills/ se queda con las skills compartidas y las"
echo "de oficio dejan de cobrárselas todos los roles en cada pedido."
