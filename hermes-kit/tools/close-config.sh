#!/usr/bin/env bash
# Puts config.yaml read-only, after the first boot.
#
#   ./close-config.sh east                    # on a VPS (over ssh)
#   ./close-config.sh root@1.2.3.4 east       # same, if the host isn't named after the agent
#   ./close-config.sh ~/Projects/agente-x     # on a local agent
#
# The second argument is the slug: the directory name on the VPS
# (/opt/agentes/<slug>), which is also the container prefix. It defaults to
# the same as the ssh host. Not used on a local agent: it comes from the
# directory.
#
# WATCH OUT: the LOCAL branch needs GNU sed, i.e. Linux. On macOS the `sed -i`
# below dies with "invalid command code" because BSD sed requires a suffix
# (-i ''). It doesn't happen over ssh: the other side is always Linux.
#
# WHY: config.yaml lives inside ./data and is owned by the agent's user,
# meaning the agent writes it. That's where `disabled_toolsets` lives —where
# we deliberately turn off `cronjob`— and the MCP server registry. Without
# this lock the agent could turn cronjob back on and register an MCP that
# skips the guard; it just has to wait for a restart.
#
# WHY IT DOESN'T HAPPEN FROM THE START: on the first boot the file doesn't
# EXIST YET, and Docker, when mounting something that doesn't exist, creates a
# DIRECTORY with that name. The agent then fails to start. That's why
# `deploy-remote.sh` uploads it commented out and this closes it afterward.
#
# To open it back up (register an MCP, change a toolset):
#   tools/with-config-open.sh <agent> hermes mcp add ...
set -euo pipefail

. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/compose-container.sh"

DEST="${1:-}"
[[ -n "$DEST" ]] || { echo 'usage: ./close-config.sh <ssh-host|local-dir> [slug]' >&2; exit 1; }
SLUG="${2:-$DEST}"

LINE='      - ./data/config.yaml:/opt/data/config.yaml:ro'
MARKER='# FIRST BOOT: uncomment with tools/close-config.sh'

# WHICH CONTAINER IS THE ENGINE'S. Over ssh the slug is not a guess: the
# operator typed it, `/opt/agentes/$SLUG` is the directory this is about to
# write into, and it is the same variable `deploy-remote.sh` rendered the
# compose from. On a local agent there is no such variable, and this used to
# GUESS the name from the directory's basename with a `sed 's/^agente-//'` --
# left over from when every agent directory was called `agente-<slug>`, and
# wrong for every agent created after that rename: the guess named a container
# that does not exist and the wait loop below then timed out on nothing.
# Whatever the compose says is the answer (5738a0d).
if [[ -d "$DEST" ]]; then
  run() { bash -c "$1"; }
  DIR="$DEST"
  CONTAINER="$(compose_container_or_die "$DIR/docker-compose.yml")"
else
  run() { ssh "$DEST" "$1"; }
  DIR="/opt/agentes/$SLUG"
  CONTAINER="$SLUG-hermes"
  run "[ -d $DIR/data ]" || {
    echo "$DIR/data doesn't exist on $DEST" >&2
    echo "if the agent's directory isn't called '$SLUG', pass it as the second" >&2
    echo "argument:  ./close-config.sh $DEST <slug>" >&2
    exit 1
  }
fi

run "grep -q '$MARKER' $DIR/docker-compose.yml" || {
  echo "The lock is already on (or the compose doesn't have the marker). Nothing to do."
  exit 0
}

# The file has to exist BEFORE it gets mounted, or Docker creates a directory.
run "test -s $DIR/data/config.yaml" || {
  echo "config.yaml doesn't exist or is empty in $DIR/data/ — start the agent first." >&2
  exit 1
}

echo "→ closing config.yaml"
run "sed -i 's|^ *$MARKER|$LINE|' $DIR/docker-compose.yml"
run "cd $DIR && docker compose up -d --force-recreate hermes >/dev/null 2>&1"

# No nested quotes: the output gets pulled and filtered HERE. Passing a
# `sh -c '...'` over ssh inside another quoted string breaks silently, and the
# symptom is a loop that waits forever for something that was already ready.
echo "→ waiting for the gateway"
up=0
for _ in $(seq 1 40); do
  sleep 5
  if run "docker exec $CONTAINER ss -lnt" 2>/dev/null | grep -q 8642; then
    echo "→ gateway is up"
    up=1
    break
  fi
done
[[ $up == 1 ]] || { echo "the gateway never came up — check 'docker compose logs hermes'" >&2; exit 1; }

echo -n "→ can the agent write its config: "
if run "docker exec -u hermes $CONTAINER touch /opt/data/config.yaml" 2>/dev/null; then
  echo "YES — THE LOCK DIDN'T HOLD" >&2
  exit 1
else
  echo "no (good)"
fi
