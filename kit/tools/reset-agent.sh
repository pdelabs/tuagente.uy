#!/usr/bin/env bash
# Leaves an agent at zero, without touching its keys or the kit.
#
#   ./reset-agent.sh tuagente                    # ssh: alias named like the agent
#   ./reset-agent.sh root@1.2.3.4 east           # ssh: host + slug (/opt/agentes/<slug>)
#   ./reset-agent.sh --local ~/…/agente-acme     # an agent on THIS machine
#   ./reset-agent.sh --local ~/…/agente-acme --delivery
#
# In ssh mode the second argument is the slug: the directory's name on the
# VPS (/opt/agentes/<slug>). By default, the same as the ssh host.
#
# THERE ARE TWO MODES, and the difference is what gets kept:
#
#   full (default) — recycle an agent: takes the SOUL, the flows and the
#     scheduled tasks WITH IT too. Ends up like freshly installed.
#
#   --delivery — the last step of an onboarding: erases the trace of the
#     verification (conversations, usage, board, approvals, deliverables,
#     artifacts, memories, name and the bot's photo) and KEEPS what was
#     written for this client: the SOUL —minus the `portal:identity` block,
#     which the baptism writes—, the flows (`flows/`) and their scheduled
#     tasks (`cron/jobs.json`), without the run history.
#
# Both modes always keep: secrets.env, config.yaml, skills/, scripts/,
# connections/, policy/, kit-skills/ and kit-adapter/.
#
# WHY THE LOCAL MODE EXISTS: the recipe for zeroing out an agent on one's own
# machine lived as eight loose `rm -rf` lines in a document in ANOTHER repo,
# so the last step of an onboarding —making sure the client doesn't open
# their portal and find a conversation of ours and spend in the Usage tab—
# depended on someone remembering to go dig them up. The recipe is this one,
# and it's a single one, wherever the agent lives.
#
# WATCH OUT FOR PERMISSIONS, which is what broke the first time: the agent
# runs as `hermes` (uid 10000) and shares the volume with the adapter. If a
# file the agent writes gets recreated owned by root, the agent can't open it
# — and `kanban.db is not writable` in a loop looks like "the agent is
# throwing errors," not like a permissions problem. That's why this hands
# back ownership, at the end, of whatever the agent needs to write.
set -euo pipefail

MODE=ssh
DELIVERY=0
POS=()
while (( $# )); do
  case "$1" in
    --local)    MODE=local; DIR="${2:-}"; shift $(( $# > 1 ? 2 : 1 )) ;;
    --delivery) DELIVERY=1; shift ;;
    -h|--help)  sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*)         echo "unknown option: $1" >&2; exit 2 ;;
    *)          POS+=("$1"); shift ;;
  esac
done

if [[ "$MODE" == local ]]; then
  [[ -n "${DIR:-}" ]] || { echo 'usage: ./reset-agent.sh --local <agent-path> [--delivery]' >&2; exit 2; }
  DIR="$(cd "$DIR" 2>/dev/null && pwd)" || { echo "that directory doesn't exist" >&2; exit 1; }
  SLUG="$(basename "$DIR")"
else
  HOST="${POS[0]:-}"
  [[ -n "$HOST" ]] || { echo 'usage: ./reset-agent.sh <ssh-host> [slug]   |   --local <path> [--delivery]' >&2; exit 2; }
  SLUG="${POS[1]:-$HOST}"
  DIR="/opt/agentes/$SLUG"
fi

# The one place that decides whether this runs here or on the other side of
# ssh: the commands are the same, so the recipe doesn't fork into two that
# drift apart without anyone noticing.
run() {
  if [[ "$MODE" == ssh ]]; then ssh "$HOST" "$1"; else bash -c "$1"; fi
}

run "[ -d '$DIR/data' ]" || {
  echo "$DIR/data doesn't exist" >&2
  [[ "$MODE" == ssh ]] && {
    echo "if the agent's directory isn't named '$SLUG', pass it as the second" >&2
    echo "argument:  ./reset-agent.sh $HOST <slug>" >&2
  }
  exit 1
}

if (( DELIVERY )); then
  echo "→ DELIVERY mode: keeping SOUL.md, flows/ and cron/jobs.json"
else
  echo "→ FULL mode: the SOUL, the flows and the tasks go too"
fi

echo "→ backup"
# The timestamp is resolved HERE and not on the other side: stuck inside the
# single quotes that protect the path, `$(date …)` wouldn't expand and the
# backup would end up literally named `agente-$(date +%Y%m%d-%H%M%S).tgz`.
TS="$(date +%Y%m%d-%H%M%S)"
if [[ "$MODE" == ssh ]]; then
  BACKUP_DIR="/root/backups"
else
  # Outside the agent's repo: inside it would dirty its `git status`, which is
  # where "did I touch anything?" gets checked.
  BACKUP_DIR="$(dirname "$DIR")/backups"
fi
run "mkdir -p '$BACKUP_DIR' && tar czf '$BACKUP_DIR/$SLUG-$TS.tgz' -C '$DIR' data 2>/dev/null; ls -l '$BACKUP_DIR/$SLUG-$TS.tgz' | sed 's|^|   |'"

echo "→ shutting down"
run "cd '$DIR' && docker compose stop hermes portal-adapter" >/dev/null 2>&1

echo "→ deleting the client's data"
# The usage trail: what the client should NOT find on day one.
DELETE="portal_identity.json bot_avatar.png \
  sessions kanban kanban.db kanban.db-shm kanban.db-wal \
  kanban.db.dispatch.lock kanban.db.init.lock \
  workspace entregables artifacts \
  pairing platforms state state.db state.db-shm state.db-wal \
  memories memory insights plans pending_messages \
  response_store.db response_store.db-shm response_store.db-wal \
  channel_directory.json gateway_state.json .skills_prompt_snapshot.json \
  logs image_cache audio_cache sandboxes \
  cron/executions.db cron/executions.db-shm cron/executions.db-wal cron/output \
  cron/ticker_heartbeat cron/ticker_last_success"
# THE PREVIOUS CLIENT'S MONEY. `costs.jsonl` is the record of what they
# spent —model by model, call by call— and it wasn't on the list: it survived
# both modes. On an onboarding it means the new client opens their portal and
# sees the previous one's usage; on a recycle, that one company's billing
# ends up on another one's disk.
DELETE="$DELETE costs.jsonl costs.jsonl.1 .portal_notify_session"

# What got written for THIS client. On an onboarding it's the day's work; on
# a recycle it's exactly what has to come out.
(( DELIVERY )) || DELETE="$DELETE SOUL.md flows cron"
# shellcheck disable=SC2086
run "cd '$DIR/data' && rm -rf $DELETE 2>/dev/null || true"

# THE BACKUPS WE LEAVE BEHIND OURSELVES, which is the rest that was left
# over. Every kit tool keeps a copy before touching something —`SOUL.md.v11-…`,
# `config.yaml.antes-de-la-guardia`, `config.yaml.bak-20260812`— and nobody
# was deleting those copies. Measured on 16/8 on Mr.Wobble after a FULL reset:
# the previous client's entire SOUL and four old configs were still there.
#
# Deleting `SOUL.md` and leaving `SOUL.md.v11-…` next to it isn't leaving the
# agent at zero: it's leaving it at zero for the engine, which reads a single
# file, and NOT for the agent, which can read its own directory.
#
# Only in full mode: on a delivery the current config gets kept, and its
# backups are the safety net in case there's a need to roll back that same
# day.
if (( ! DELIVERY )); then
  run "cd '$DIR/data' && rm -f SOUL.md.v*-* SOUL.md.bak* config.yaml.bak-* config.yaml.antes-* 2>/dev/null || true"
fi

if (( DELIVERY )); then
  # The baptism writes a `portal:identity` block INSIDE the SOUL, on top of
  # portal_identity.json. Without pulling it out, the agent keeps introducing
  # itself with the name we used for testing and the portal asks for the
  # baptism again: two sources of identity saying different things.
  echo "→ pulling the portal:identity block out of the SOUL (if the baptism left one)"
  # BOTH MARKERS ARE REQUIRED, and it's not tidiness: if only the opening one
  # were there, sed's range would delete from there TO THE END OF THE FILE,
  # i.e. the whole onboarding's work. And it looks for the MARKERS, not the
  # word: the kit's block mentions `portal:identity` in prose (v10, line 508),
  # so a plain `grep portal:identity` used to say "removed" on every agent,
  # even the ones that were never baptized.
  open_tag='<!-- *portal:identity *-->'
  close_tag='<!-- */portal:identity *-->'
  run "cd '$DIR/data' && if [ -f SOUL.md ] && grep -q '$open_tag' SOUL.md && grep -q '$close_tag' SOUL.md; then
      sed '/$open_tag/,/${close_tag//\//\\/}/d' SOUL.md > SOUL.new && mv SOUL.new SOUL.md && echo '   removed'
    else echo '   it was not there (this agent was never baptized)'; fi"
fi

echo "→ starting back up"
run "cd '$DIR' && docker compose up -d --force-recreate hermes portal-adapter" >/dev/null 2>&1

echo "→ waiting for the gateway"
# The container gets resolved AFTER the up: with --force-recreate the id changes.
if [[ "$MODE" == ssh ]]; then
  CONT="$SLUG-hermes"
else
  CONT="$(docker compose --project-directory "$DIR" ps -q hermes)"
fi
up=0
for _ in $(seq 1 45); do
  sleep 6
  # Ask the gateway itself, not the system: `ss` isn't always in the image and
  # its absence looks the same as "hasn't come up yet" — the script used to
  # give up with the agent already running.
  if [[ "$(run "docker exec $CONT curl -s -o /dev/null -w '%{http_code}' -m 5 http://127.0.0.1:8642/health" 2>/dev/null)" == "200" ]]; then
    up=1; break
  fi
done
[[ $up == 1 ]] || { echo "the gateway didn't come up — check 'docker compose logs hermes'" >&2; exit 1; }

# Ownership, AFTER starting: only then do the files Hermes recreates exist.
# `hermes` is uid 10000 in the image.
# The workspace folders got DELETED above (they go inside `workspace`) and
# Hermes doesn't recreate them: they're ours, not the engine's. Without them
# the agent tries to save a deliverable and fails, and `agent-check.py` flags
# "missing folders." They get recreated before the chown so they come out
# with the right owner from the start.
echo "→ recreating the workspace"
run "cd '$DIR/data' && mkdir -p \
  workspace/entregables workspace/artifacts workspace/entrada workspace/interno"

# Only root can change ownership TO another uid, so if we're not root here it
# doesn't even try: it would always fail and the warning would turn into
# permanent noise. On the VPS it runs as root and is needed; on a Mac with
# Docker Desktop it isn't (the volume maps to the container's uid regardless).
if [[ "$MODE" == ssh || "$(id -u)" == 0 ]]; then
  echo "→ giving ownership back to the agent"
  run "cd '$DIR/data' && chown -R 10000:10000 \
    kanban.db kanban.db-shm kanban.db-wal state.db response_store.db \
    workspace memories sessions 2>/dev/null || true"
else
  echo "→ permissions: not root, not touching ownership (not needed on Docker Desktop;"
  echo "  on a Linux host, if you see 'not writable' in the log, run the chown with sudo)"
fi
run "cd '$DIR' && docker compose restart hermes" >/dev/null 2>&1

echo "→ checking there are no leftover write errors"
sleep 25
n=$(run "cd '$DIR' && docker compose logs hermes --since 30s 2>&1 | grep -c 'not writable' || true")
if [[ "$n" == "0" ]]; then
  echo "   no permission errors"
else
  echo "   HEADS UP: $n write errors — check ownership in $DIR/data" >&2
fi

echo
echo "Done. The agent has no name yet. Remember to open the portal in an"
echo "incognito window: the browser's localStorage remembers the name and"
echo "the look even after the agent no longer does."
if (( DELIVERY )); then
  echo
  echo "Before sending the link, check that it's really at zero:"
  echo "  python3 tools/portal-check.py --key <API_SERVER_KEY> --delivery \\"
  echo "      --endpoint http://127.0.0.1:<port> --adapter http://127.0.0.1:<port+1>"
fi
