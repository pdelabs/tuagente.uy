#!/usr/bin/env bash
# Corre un comando de administracion con config.yaml escribible, y lo vuelve a
# cerrar pase lo que pase.
#
#   ./con-config-abierta.sh <dir-del-agente> hermes mcp add foo --command /x
#
# POR QUE EXISTE: config.yaml va montado :ro para que el agente no pueda
# devolverse toolsets ni registrar MCPs salteando la guardia. El precio es que
# NOSOTROS tampoco podemos, y `hermes mcp add` muere con
# "OSError: Read-only file system". Antes de esto habia que editar el compose a
# mano, y una salida a mitad de camino te deja el candado abierto sin que nadie
# lo note — que es la peor de las dos fallas posibles.
#
# El trap cierra siempre: Ctrl-C, error del comando, o exito.
set -euo pipefail

DIR="${1:-}"; shift || true
if [[ -z "$DIR" || $# -eq 0 ]]; then
  echo 'uso: ./con-config-abierta.sh <dir-del-agente> <comando...>' >&2
  echo 'ej:  ./con-config-abierta.sh ~/Projects/agente-east hermes mcp list' >&2
  exit 1
fi

COMPOSE="$DIR/docker-compose.yml"
[[ -f "$COMPOSE" ]] || { echo "no encuentro $COMPOSE" >&2; exit 1; }

MARCA="config.yaml:/opt/data/config.yaml:ro"
grep -q "$MARCA" "$COMPOSE" || {
  echo "config.yaml no esta montado :ro — corro el comando tal cual"
  ( cd "$DIR" && docker exec "$(basename "$DIR" | sed 's/^agente-//')-hermes" "$@" )
  exit $?
}

CONTENEDOR="$(cd "$DIR" && docker compose ps -q hermes | head -1)"
NOMBRE="$(docker inspect --format '{{.Name}}' "$CONTENEDOR" 2>/dev/null | tr -d /)"
RESPALDO="$(mktemp)"
cp "$COMPOSE" "$RESPALDO"

cerrar() {
  cp "$RESPALDO" "$COMPOSE"
  rm -f "$RESPALDO"
  ( cd "$DIR" && docker compose up -d --force-recreate hermes >/dev/null 2>&1 )
  echo "→ config.yaml cerrado de nuevo (:ro)"
}
trap cerrar EXIT INT TERM

echo "→ abriendo config.yaml"
# Comentar la linea del montaje, no borrarla: asi el respaldo y el diff son obvios.
sed -i.bak "s|^\( *\)- \./data/config\.yaml:/opt/data/config\.yaml:ro|\1# ABIERTO TEMPORALMENTE por con-config-abierta.sh|" "$COMPOSE"
rm -f "$COMPOSE.bak"
( cd "$DIR" && docker compose up -d --force-recreate hermes >/dev/null 2>&1 )

echo "→ esperando el gateway"
for _ in $(seq 1 40); do
  sleep 2
  docker exec "$NOMBRE" sh -c 'test -S /run/hermes.sock || true' >/dev/null 2>&1 && break
done
sleep 6

echo "→ $*"
docker exec -i "$NOMBRE" "$@"
