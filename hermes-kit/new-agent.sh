#!/usr/bin/env bash
# Creates the skeleton of an agent for a new client and installs the kit into it.
#
#   ./new-agent.sh acme "Acme SA" ~/Desktop/Luis/Projects/agente-acme [8642]
#                  ^slug ^agent's visible name    ^where to create it  ^port
#
# The fourth argument is the GATEWAY port on the host; the adapter goes on the
# next one. Defaults to 8642/8643, which is right when the client has their
# own VPS. On a host where another agent already lives it has to move: 8742,
# 8842, etc.
#
# Leaves everything ready except the handcrafted part: writing the SOUL and
# loading the secrets.
set -euo pipefail

KIT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SLUG="${1:-}"; NAME="${2:-}"; DEST="${3:-}"; PORT="${4:-8642}"

if [[ -z "$SLUG" || -z "$NAME" || -z "$DEST" ]]; then
  echo 'usage: ./new-agent.sh <slug> "<Agent name>" <path> [base-port]' >&2
  exit 2
fi
if [[ -e "$DEST" ]]; then
  echo "$DEST already exists — not overwriting anything." >&2
  exit 2
fi

# PORTS ARE VALIDATED HERE, BEFORE CREATING ANYTHING, for the same reason as
# the SOUL's version: if the clash shows up at `docker compose up -d` —which
# is where it used to show up, because container names DO carry the slug and
# don't clash— you've already written the SOUL and loaded the keys. The last
# three agents in the lab got edited by hand after being created.
[[ "$PORT" =~ ^[0-9]+$ ]] && (( PORT >= 1024 && PORT <= 65534 )) || {
  echo "the base port has to be a number between 1024 and 65534 (you said '$PORT')." >&2
  exit 2
}
ADAPTER_PORT=$((PORT + 1))

taken() {
  # `lsof` sees any listener on the host, including another agent's
  # docker-proxy; bash's `/dev/tcp` is the fallback for a machine without lsof.
  local p="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1
    return
  fi
  if (exec 3<>"/dev/tcp/127.0.0.1/$p") 2>/dev/null; then
    exec 3<&-
    return 0
  fi
  return 1
}

busy=()
for p in "$PORT" "$ADAPTER_PORT"; do
  if taken "$p"; then busy+=("$p"); fi
done
if (( ${#busy[@]} )); then
  suggested="$PORT"
  for _ in $(seq 1 100); do
    suggested=$((suggested + 100))
    if ! taken "$suggested" && ! taken $((suggested + 1)); then break; fi
  done
  echo "port(s) already taken on this host: ${busy[*]} — is there another agent here already?" >&2
  echo "Each agent needs TWO free, consecutive ports (gateway and adapter)." >&2
  echo "   ./new-agent.sh $SLUG \"$NAME\" $DEST $suggested" >&2
  exit 2
fi

# The SOUL block's version is validated HERE, before creating anything: if it
# doesn't look like a version, the marker comes out wrong and
# `agent-check.py` reports it as unbalanced markers, which sends you looking
# for the problem somewhere else. And if this died after the mkdir, the agent
# would be left half-built.
[[ -f "$KIT/soul/VERSION" ]] || {
  echo "missing $KIT/soul/VERSION, which says which version of the block the kit installs." >&2
  echo "It's one line with the version (vN): echo v2 > $KIT/soul/VERSION" >&2
  exit 2
}
SOUL_VERSION="$(tr -d '[:space:]' < "$KIT/soul/VERSION")"
[[ "$SOUL_VERSION" =~ ^v[0-9]+$ ]] || {
  echo "soul/VERSION says '$SOUL_VERSION' and it has to be vN (v1, v2, v3…)." >&2
  exit 2
}

mkdir -p "$DEST/data"/{skills,scripts,memories,workspace/{entregables,artifacts,entrada,interno}}
cd "$DEST"

# Compose, with the slug, the name and the ports already substituted in.
sed -e "s/\${CLIENT}/$SLUG/g" -e "s/\${AGENT_NAME}/$NAME/g" \
    -e "s/\${GATEWAY_PORT}/$PORT/g" -e "s/\${ADAPTER_PORT}/$ADAPTER_PORT/g" \
    "$KIT/compose/docker-compose.example.yml" > docker-compose.yml
# If any ${…} was left unresolved, the compose won't start and Docker's error
# doesn't say which one: better to find out here.
if grep -n '\${' docker-compose.yml >/dev/null; then
  echo "the generated compose still has unresolved placeholders:" >&2
  grep -n '\${' docker-compose.yml >&2
  exit 2
fi

# THE KEYS GO OUTSIDE data/. `data/` belongs to the agent —it has it rw and
# runs as root inside— and this file is the env_file for both services: with
# the keys in there, the agent could write itself a PYTHONPATH and run its own
# code inside the adapter. Measured. It lives at the agent's root, which
# nothing mounts.
cat > secrets.env <<'ENV'
# The agent's keys. NEVER committed. root:root 600 on the server.
API_SERVER_KEY=          # openssl rand -hex 32 — unique per client
OPENROUTER_API_KEY=      # or whichever model provider's you use
TELEGRAM_BOT_TOKEN=      # from @BotFather
TELEGRAM_ALLOWED_USERS=  # authorized ids; without this anyone can write to it
# SMTP_USER=
# SMTP_APP_PASSWORD=
ENV
chmod 600 secrets.env

# .gitignore GOES BY ALLOWLIST, and it's not tidiness: `data/` belongs to the
# agent and the engine, which write there on every boot (auth.json,
# gateway.pid, gateway-starts.log, cron/, bin/, state/, its 70 stock skills,
# the databases and their -wal/-shm…). With the denylist that used to be here
# —`data/*.db*`, `cache/` and `logs/`— the client's repo's `git status` came
# out with 30 entries after the FIRST boot, almost all of them the engine's,
# and it stopped being useful for the one thing it's for: seeing if you
# touched something. And a denylist is born incomplete: every engine version
# debuts new files and nobody is going to come back to this file to add them.
#
# What gets versioned is what a PERSON writes or what the kit puts there: the
# SOUL, the config, the connections catalog and the kit's skills manifest.
# Everything outside data/ (kit-skills/, kit-adapter/, policy/, the compose)
# already gets versioned whole — that's exactly what an `install.sh` run
# changes and needs to be reviewable.
cat > .gitignore <<'IGNORE'
# The keys, never.
secrets.env
data/.env

# data/ belongs to the agent: ignored whole, and what we DO version is named.
data/*
!data/SOUL.md
!data/config.yaml
!data/connections/
!data/skills/
data/skills/*
!data/skills/.kit_manifest

__pycache__/
.DS_Store
IGNORE

# Config: the SAME one the remote deployment uses, no parallel copy. This
# used to be a heredoc with the config repeated in here, and it had already
# started drifting from compose/'s. The disabled-skills block is 66
# generated names: keeping it in two places was a guarantee that one would go
# stale.
cp "$KIT/compose/config.base.yaml" data/config.yaml

# SOUL draft: the identity with its placeholders untouched, and the kit's
# block below. The identity goes FIRST and OUTSIDE the markers: it's the part
# written client by client —including that company's own sensitive
# actions— and it's the part the version replacement preserves word for word.
# The generic part goes inside `kit:base`, with its version: that's what
# later tells which rules this agent runs without reading the whole prompt.
#
# The block comes from the FROZEN one (soul/versions/vN.md), not from pasting
# the .md files here: it has to be byte for byte the same one
# `install-soul.sh` installs and the one `replace-block.py` is going to
# compare against the day this agent bumps its version. With two different
# compositions —this one didn't resolve <RESPONSABLE>—, the first replacement
# saw that difference as text the client had written.
# ($SOUL_VERSION was validated above, before creating anything.)
BLOCK="$KIT/soul/versions/$SOUL_VERSION.md"
[[ -f "$BLOCK" ]] || {
  echo "missing $BLOCK: this kit never froze the $SOUL_VERSION block." >&2
  echo "   ./tools/install-soul.sh --block > soul/versions/$SOUL_VERSION.md" >&2
  exit 2
}
if ! "$KIT/tools/install-soul.sh" --block | diff -q "$BLOCK" - >/dev/null; then
  echo "the blocks in soul/ no longer compose what $BLOCK says." >&2
  echo "Bump soul/VERSION and freeze the new one, or re-freeze this one:" >&2
  echo "   ./tools/install-soul.sh --block > soul/versions/$SOUL_VERSION.md" >&2
  exit 2
fi
{
  cat "$KIT/soul/00-identity.md"; echo
  cat "$BLOCK"
} > data/SOUL.md

cat > README.md <<README
# $NAME's agent

tuagente.uy agent for $NAME. The adapter and the skills get installed from
\`hermes-kit\` — don't edit them here (see \`install.sh --diff\`).

\`\`\`bash
docker compose up -d
\`\`\`
README

"$KIT/install.sh" "$DEST/data" >/dev/null
git init -q && git add -A && git commit -qm "$NAME's agent: skeleton + tuagente kit"

cat <<DONE

Done: $DEST
Ports on this host: gateway 127.0.0.1:$PORT · adapter 127.0.0.1:$ADAPTER_PORT

What's left, in order:

  1. data/SOUL.md — the draft is there with ALL the <ASÍ> placeholders left
     unfilled. This is the real work: who they are, what they do, what they
     do NOT do, and what needs approval. Without this the agent has tools
     and no rules.
  2. fill in the keys in secrets.env (it's at the agent's root, NOT inside
     data/: in there the agent could read and rewrite them).
     (data/config.yaml already comes with the model, the api server and the
      native kanban tools set — check it if the client uses a different
      provider.)
  3. python3 $KIT/tools/agent-check.py $DEST/data
     0 failures BEFORE starting it up: catches a SOUL with gaps, skills with
     no frontmatter and config oversights, with nothing running.
  4. docker compose up -d
  5. python3 $KIT/tools/portal-check.py --key <API_SERVER_KEY> \\
       --endpoint http://127.0.0.1:$PORT --adapter http://127.0.0.1:$ADAPTER_PORT
     0 failures or it doesn't ship.
  6. The agent's first task: have it research the company's website and turn
     in its brief — see onboarding/company-brief.md. Out comes a draft to
     review, and from that come 3-4 lines for the SOUL.
  7. RESET IT TO ZERO, which is the last thing you do and the thing most
     often forgotten:
     $KIT/tools/reset-agent.sh --local $DEST --delivery
     Steps 5 and 6 leave a mess —conversations, spend in Usage, test
     deliverables— and the client opens their portal on day one. This
     erases that trace and keeps what you wrote: the SOUL, the flows and
     the tasks.
  8. python3 $KIT/tools/portal-check.py --key <API_SERVER_KEY> --delivery \\
       --endpoint http://127.0.0.1:$PORT --adapter http://127.0.0.1:$ADAPTER_PORT
     0 failures = meets the contract AND arrives at zero. Only then does the
     link go out.

Full runbook (channels, WhatsApp, timing): tuagente.uy/docs/client-onboarding.md
DONE
