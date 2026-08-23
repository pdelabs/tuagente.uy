#!/usr/bin/env bash
# Runs an administration command with config.yaml writable, and closes it
# again no matter what happens.
#
#   ./with-config-open.sh <agent-dir> hermes mcp add foo --command /x
#
# WHY THIS EXISTS: config.yaml is mounted :ro so the agent can't turn toolsets
# back on or register MCPs that skip the guard. The price is that WE can't
# either, and `hermes mcp add` dies with "OSError: Read-only file system".
# Before this, the compose had to be edited by hand, and exiting halfway
# through leaves the lock open without anyone noticing — which is the worse
# of the two possible failures.
#
# The trap always closes it: Ctrl-C, a command error, or success.
set -euo pipefail

DIR="${1:-}"; shift || true
if [[ -z "$DIR" || $# -eq 0 ]]; then
  echo 'usage: ./with-config-open.sh <agent-dir> <command...>' >&2
  echo 'e.g.:  ./with-config-open.sh ~/Projects/agente-east hermes mcp list' >&2
  exit 1
fi

COMPOSE="$DIR/docker-compose.yml"
[[ -f "$COMPOSE" ]] || { echo "can't find $COMPOSE" >&2; exit 1; }

MARKER="config.yaml:/opt/data/config.yaml:ro"
grep -q "$MARKER" "$COMPOSE" || {
  echo "config.yaml isn't mounted :ro — running the command as-is"
  ( cd "$DIR" && docker exec "$(basename "$DIR" | sed 's/^agente-//')-hermes" "$@" )
  exit $?
}

CONTAINER="$(cd "$DIR" && docker compose ps -q hermes | head -1)"
NAME="$(docker inspect --format '{{.Name}}' "$CONTAINER" 2>/dev/null | tr -d /)"
BACKUP="$(mktemp)"
cp "$COMPOSE" "$BACKUP"

close() {
  cp "$BACKUP" "$COMPOSE"
  rm -f "$BACKUP"
  ( cd "$DIR" && docker compose up -d --force-recreate hermes >/dev/null 2>&1 )
  echo "→ config.yaml closed again (:ro)"
}
trap close EXIT INT TERM

echo "→ opening config.yaml"
# Comment out the mount line, don't delete it: that way the backup and the
# diff are obvious.
sed -i.bak "s|^\( *\)- \./data/config\.yaml:/opt/data/config\.yaml:ro|\1# TEMPORARILY OPEN by with-config-open.sh|" "$COMPOSE"
rm -f "$COMPOSE.bak"
( cd "$DIR" && docker compose up -d --force-recreate hermes >/dev/null 2>&1 )

echo "→ waiting for the gateway"
for _ in $(seq 1 40); do
  sleep 2
  docker exec "$NAME" sh -c 'test -S /run/hermes.sock || true' >/dev/null 2>&1 && break
done
sleep 6

echo "→ $*"
docker exec -i "$NAME" "$@"
