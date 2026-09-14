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

. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/compose-container.sh"

DIR="${1:-}"; shift || true
if [[ -z "$DIR" || $# -eq 0 ]]; then
  echo 'usage: ./with-config-open.sh <agent-dir> <command...>' >&2
  echo 'e.g.:  ./with-config-open.sh ~/Projects/agente-east hermes mcp list' >&2
  exit 1
fi

COMPOSE="$DIR/docker-compose.yml"

# ONE DERIVATION OF THE CONTAINER'S NAME, AND IT IS THE COMPOSE'S. This script
# had two: `docker compose ps -q hermes` piped through `docker inspect` for the
# path below, and `basename "$DIR" | sed 's/^agente-//'` for the shortcut --
# the same guess 5738a0d took out of `hire-role.sh`, left over from when every
# agent directory was called `agente-<slug>`. A directory called `agente-acme`
# holds a container called `acme-hermes` only if it was created before the
# rename, so the shortcut was answering a different question than the four
# lines under it. Resolved once, up here, before either branch can use it --
# and off the file that named the container rather than off a container that
# has to already be running to be asked.
NAME="$(compose_container_or_die "$COMPOSE")"

MARKER="config.yaml:/opt/data/config.yaml:ro"
grep -q "$MARKER" "$COMPOSE" || {
  echo "config.yaml isn't mounted :ro — running the command as-is"
  ( cd "$DIR" && docker exec "$NAME" "$@" )
  exit $?
}

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
