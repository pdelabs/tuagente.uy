#!/usr/bin/env bash
# Preps a VPS for a client's agent and uploads the kit to it.
#
#   ./deploy-remote.sh east root@1.2.3.4 agentes.tuagente.uy
#                      ^slug ^server      ^base domain
#
# THE AGENT DOES NOT GET NAMED HERE. The CLIENT names it at naming time, in
# the first step of the portal's onboarding. Until then it says "Agente".
# (On 10/8 I passed it "Washi" —pdelabs' agent— and it was left with another
# client's name waiting for Cata to name it.)
#
# Leaves the agent BUILT BUT OFF: secrets.env still needs its keys loaded and
# DNS still needs to resolve. Starting it up with no DNS burns Let's
# Encrypt attempts, which has a weekly cap — that's why it never brings
# anything up on its own.
#
# Idempotent: if the directory already exists, it updates the kit and doesn't
# overwrite the secrets.
#
# THIS SCRIPT NO LONGER KNOWS WHAT THE KIT INSTALLS, and that's the important
# change. It used to have its own rsync list, parallel to install.sh's, and
# the two lists drifted apart four times without anything failing: the
# capabilities catalog never reached ANY remote agent (the whole feature dead
# on real clients), the pairing patch never reached the local ones (the
# client got a message in English asking them to run a terminal command), the
# `.kit_manifest` and the workspace folders each showed up on only one of the
# two. Nothing broke; the client just got a worse version.
#
# Now there's ONE installer. This script builds a fake agent in /tmp
# (staging), runs the SAME `install.sh` on it as a local agent gets, and
# uploads that. What the kit installs is decided in one single place; all
# that's left here is what's specific to a VPS: docker, ufw, Caddy, the
# compose, the .env and the permissions.
#
# To test it without a VPS —and `tools/compare-installers.sh` uses this—:
#   ./deploy-remote.sh <slug> --local-dest <dir> <base-domain>
# does everything against a local directory, skipping whatever needs root or
# a network.
set -euo pipefail

KIT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SLUG="${1:-}"; SERVER="${2:-}"; BASE_DOMAIN="${3:-}"
NAME="Agente"   # placeholder until naming; see the note above

# Simulation mode: the "server" is a directory on this machine.
LOCAL=""
if [[ "$SERVER" == "--local-dest" ]]; then
  LOCAL="${3:-}"; BASE_DOMAIN="${4:-example.local}"; SERVER=""
  [[ -n "$LOCAL" ]] || { echo "--local-dest needs a directory" >&2; exit 1; }
  mkdir -p "$LOCAL"
  LOCAL="$(cd "$LOCAL" && pwd)"
fi

if [[ -z "$SLUG" || -z "$BASE_DOMAIN" ]] || [[ -z "$SERVER" && -z "$LOCAL" ]]; then
  echo 'usage: ./deploy-remote.sh <slug> <user@ip> <base-domain>' >&2
  echo '       ./deploy-remote.sh <slug> --local-dest <dir> [base-domain]' >&2
  echo 'e.g.:  ./deploy-remote.sh east root@1.2.3.4 agentes.tuagente.uy' >&2
  exit 1
fi

[[ "$SLUG" =~ ^[a-z][a-z0-9-]{1,30}$ ]] || { echo "invalid slug: lowercase letters, numbers and dashes" >&2; exit 1; }

if [[ -n "$LOCAL" ]]; then
  REMOTE="$LOCAL/opt/agentes/$SLUG"
  DEST=""                       # rsync with no `host:`
else
  REMOTE="/opt/agentes/$SLUG"
  DEST="$SERVER:"
fi
API_DOMAIN="$SLUG.$BASE_DOMAIN"
PORTAL_DOMAIN="$SLUG-portal.$BASE_DOMAIN"

# The two ways to touch the destination, so the rest of the script doesn't
# need to know whether it's talking to a VPS or to a test directory.
over_there() {            # run a command over there
  if [[ -n "$LOCAL" ]]; then bash -c "$1"; else ssh "$SERVER" "$1"; fi
}
write_over_there() {   # dump stdin into a file over there
  if [[ -n "$LOCAL" ]]; then cat > "$1"; else ssh "$SERVER" "cat > $1"; fi
}

echo "→ agent    $SLUG (unnamed — the client names it)"
echo "→ server   ${SERVER:-(local simulation)}:$REMOTE"
echo "→ api      https://$API_DOMAIN"
echo "→ portal   https://$PORTAL_DOMAIN"
echo

if [[ -z "$LOCAL" ]]; then
  ssh -o ConnectTimeout=10 "$SERVER" true || { echo "couldn't reach $SERVER over ssh" >&2; exit 1; }
fi

# ── 1. Docker and firewall ────────────────────────────────────────────────
# The firewall gets closed BEFORE anything is listening, not after.
# Watch out: `docker publish` writes to iptables underneath ufw, so a
# published port stays open EVEN IF ufw says no. That's why the remote
# compose publishes nothing except Caddy: the real defense is not opening
# anything, not ufw.
if [[ -z "$LOCAL" ]]; then
  ssh "$SERVER" 'bash -se' <<'REMOTE_SCRIPT'
set -euo pipefail
if ! command -v docker >/dev/null; then
  echo "  installing docker…"
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
REMOTE_SCRIPT
else
  echo "  (local simulation: not touching docker or ufw)"
fi

# ── 2. Structure ───────────────────────────────────────────────────────────
over_there "mkdir -p $REMOTE/data"

# ── 3. The kit: ONE SINGLE INSTALLER ───────────────────────────────────────
# A fake agent gets built and install.sh runs on it. What gets uploaded comes
# from there, not from a hand-written list in this file.
echo "→ building the kit with install.sh (staging)"
STAGING="$(mktemp -d)"
trap 'rm -rf "$STAGING"' EXIT
mkdir -p "$STAGING/data"
# THE ROSTER FROM OVER THERE TRAVELS INTO THE STAGING BEFORE THE INSTALL.
# `install.sh` decides which skills it ships by looking at
# `policy/roles/catalog.json` -- the same file the adapter reads to know
# whether this client has a team -- and the staging is a newborn agent: without
# this, a client with a team would get the whole kit in kit-skills/ again, which
# is mounted for the WHOLE installation, so every role would go back to paying
# prompt for the other roles' skills. Same shape as the adapter's old entrypoint
# a few lines below: what decides the install is the state OVER THERE, not the
# state of the fake directory.
if over_there "[ -f $REMOTE/policy/roles/catalog.json ]" 2>/dev/null; then
  mkdir -p "$STAGING/policy/roles"
  over_there "cat $REMOTE/policy/roles/catalog.json" > "$STAGING/policy/roles/catalog.json"
  echo "   this agent has a team: only the shared skills go"
fi
# AND SO DOES WHICH ROLES ARE HIRED OVER THERE, for the same reason and with
# the same shape. `install.sh` ships a plugin folder for every plugin an
# INSTALLED role declares, and it reads that off `data/profiles/<id>/` -- which
# in a newborn staging is nobody. Without this the deploy would take
# accounting's `invoices-to-data` off an agent that has accounting hired, and
# the cleaner would do it silently, because from the staging's point of view it
# was correct. The markers are empty directories and they are DELETED right
# after the install: `data/profiles/` is the agent's, it is not in any manifest,
# and uploading it would rewrite the ownership of a directory the engine owns.
if over_there "[ -d $REMOTE/data/profiles ]" 2>/dev/null; then
  while IFS= read -r role; do
    [[ -n "$role" ]] || continue
    mkdir -p "$STAGING/data/profiles/$role"
  done < <(over_there "ls -1 $REMOTE/data/profiles 2>/dev/null" || true)
  hired="$(ls -1 "$STAGING/data/profiles" 2>/dev/null | tr '\n' ' ')"
  [[ -z "${hired// }" ]] || echo "   roles hired over there: ${hired% }"
fi
if ! "$KIT/install.sh" "$STAGING/data" > "$STAGING/install-output.txt" 2>&1; then
  echo "install.sh failed while building the staging; not uploading anything:" >&2
  sed 's/^/   /' "$STAGING/install-output.txt" >&2
  exit 1
fi

# The profile markers did their job during the install and do not travel: see
# the note above.
rm -rf "$STAGING/data/profiles"

MANIFEST="$STAGING/.kit-installed"
[[ -s "$MANIFEST" ]] || { echo "install.sh left no .kit-installed: I don't know what to upload" >&2; exit 1; }

# THE ADAPTER MIGRATION WINDOW IS CLOSED, and it closed itself the day the
# adapter stopped being one file. There used to be a copy here that kept
# uploading `data/scripts/portal_adapter.py` while the container over there
# still started from that path -- so that a `docker restart` would not find a
# missing file. Since the split into workspace/kanban/flows/rooms/plugins, the
# big file IMPORTS them, and this only ever uploaded the big file: what it
# preserved was not a working adapter but a file that raises ImportError on the
# first line. The same restart dies either way, and the local installer's twin
# of this branch has been aborting outright (its destinations are not in
# ALLOWED_PREFIXES). Both are gone: the path is obsolete, the cleaner removes it
# with the sha check, and the compose gets pointed at
# /opt/kit/adapter/portal_adapter.py in the same visit -- which is what
# `install.sh` prints, verbatim, with the lines to paste.
echo "   $(wc -l < "$MANIFEST" | tr -d ' ') kit files"

# DRIFT CHECK. What gets uploaded is EXACTLY what install.sh says it
# installed (its manifest). If install.sh starts writing something that
# isn't listed there, this script PLANTS ITSELF instead of silently
# under-uploading, which is exactly how the capabilities catalog and the
# pairing patch got lost. The list below is the files install.sh creates
# that are NOT the kit's: named one by one with a reason, and anything else
# is a bug.
NOT_UPLOADED=(
  # Written by the CLIENT (their per-connection permissions). install.sh only
  # creates it empty if missing, and that happens further down, on the
  # agent's own side: uploading the staging's `{}` would overwrite the
  # client's policy.
  "policy/policy.json"
)
orphaned=0
while IFS= read -r rel; do
  grep -qxF "$rel" <(cut -f1 "$MANIFEST") && continue
  for allowed in "${NOT_UPLOADED[@]}"; do [[ "$rel" == "$allowed" ]] && continue 2; done
  echo "DRIFT: install.sh wrote '$rel' and it's not in its manifest." >&2
  orphaned=$((orphaned+1))
done < <(cd "$STAGING" && find . -type f ! -name '.kit-installed' ! -name 'install-output.txt' \
         | sed 's|^\./||' | sort)
if [[ $orphaned -gt 0 ]]; then
  echo >&2
  echo "Not uploading anything. Either that file belongs to the kit —in which case" >&2
  echo "install.sh has to note it in the manifest— or it belongs to the client, and" >&2
  echo "it goes into NOT_UPLOADED with the reason." >&2
  exit 1
fi

# And the root folders: each one has a different owner over there (data/
# belongs to the agent, uid 10000; policy/ and kit-skills/ stay root's
# because they're mounted :ro). A new root can't just slide through without
# someone deciding whose it is.
KNOWN="data policy kit-skills kit-adapter plugins"
while IFS= read -r root; do
  [[ " $KNOWN " == *" $root "* ]] && continue
  echo "DRIFT: install.sh created the folder '$root/', which this deploy doesn't" >&2
  echo "know the owner of (agent permissions, or root's?). Decide it here." >&2
  exit 1
done < <(cd "$STAGING" && find . -mindepth 1 -maxdepth 1 -type d | sed 's|^\./||' | sort)

echo "→ uploading the kit"
LIST="$STAGING/upload-list.txt"
{
  cut -f1 "$MANIFEST"
  # Empty folders (workspace/entregables and its siblings) aren't files and
  # aren't in the manifest: if they aren't named, they don't arrive. The
  # skills take them for granted.
  (cd "$STAGING" && find . -type d -empty | sed 's|^\./||')
} | sort -u > "$LIST"

# --files-from AND NOTHING ELSE. Nowhere in this whole script is there a
# single mirror-style delete option (`grep -- '-'-delete deploy-remote.sh`
# returns nothing), and it's not tidiness: it's what makes deleting a
# client's workspace IMPOSSIBLE rather than unlikely. With --files-from,
# rsync can only touch what's named in the list; the list comes from the
# manifest, i.e. from the files we ourselves write. What the client wrote
# isn't in there, so there's no flag, typo or empty source that can reach it.
# (What's old from the kit gets removed afterward, by manifest and by
# checking the sha256.)
# DON'T ADD `--no-implied-dirs` HERE. It was in for a while so rsync
# wouldn't rewrite the mode and mtime of `policy/` and `kit-skills/`, and IT
# BROKE THE WHOLE DEPLOYMENT: with `--files-from`, `--relative` is implied,
# the flag tells the sender not to send the directories along the path, and
# the VPS's rsync (GNU 3.4.3) rejects the transfer — `ABORTING due to
# invalid path from sender: data/connections/catalog.json`, rc=2, ZERO
# files transferred. The agent was left with `data/` and nothing else: no
# adapter, no policy/, no kit-skills.
#
# And it didn't show up in testing because the Mac's rsync is openrsync,
# which tolerates the flag and creates the directories anyway:
# `compare-installers.sh` gave rc=0 and "29 identical files" with
# production broken. That's why `tools/test-remote-deploy-ssh.sh` exists,
# which runs this same thing against a real sshd with GNU rsync: any new
# rsync option gets tested THERE.
#
# The owner of those two folders gets fixed afterward, with an explicit
# chown.
rsync -a --files-from="$LIST" "$STAGING/" "$DEST$REMOTE/"

# The compose and the Caddyfile belong to the VPS, not to the kit: they
# don't come from the staging.
rsync -a "$KIT/compose/docker-compose.remote.yml" "$DEST$REMOTE/docker-compose.yml"
rsync -a "$KIT/compose/Caddyfile"  "$DEST$REMOTE/Caddyfile"

# THE config.yaml, WHICH WAS MISSING AND BROKE EVERYTHING. Without it, Hermes
# writes its EXAMPLE config on the first boot (86 KB, all commented out) and
# starts with the defaults: with no `api_server.enabled` it NEVER binds 8642,
# so Caddy returns 502 forever and the symptom looks like a networking
# problem. Verified on 10/8 with East: the gateway "started" and wasn't
# listening on anything.
# Doesn't overwrite it if it already exists: after the first boot, Hermes
# migrates it on its own.
if ! over_there "grep -q 'enabled: true' $REMOTE/data/config.yaml 2>/dev/null"; then
  rsync -a "$KIT/compose/config.base.yaml" "$DEST$REMOTE/data/config.yaml"
  echo "→ base config.yaml installed"
else
  echo "→ config.yaml already configured, leaving it alone"
fi

# ── 3b. What the kit stopped bringing ─────────────────────────────────────
# The flip side of uploading: taking out what's old. NOT done by mirroring
# folders —that's what deletes the client's own work— but by comparing the
# new manifest against the one left over from last time, and only if the
# file still has the sha256 we wrote. It's the SAME script install.sh runs
# on a local install; here it comes in over stdin and doesn't stay on the
# server.
rsync -a "$MANIFEST" "$DEST$REMOTE/.kit-installed.new"
if [[ -n "$LOCAL" ]]; then
  bash "$KIT/tools/clean-obsolete.sh" "$REMOTE"
else
  ssh "$SERVER" "bash -s -- $REMOTE" < "$KIT/tools/clean-obsolete.sh"
fi

# The guard's policy gets created EMPTY if it's missing, and NEVER
# overwritten: that's where this client's toggles live. That's why it
# doesn't travel in the manifest (see NOT_UPLOADED, above): the staging's
# `{}` would wipe out the client's policy.
over_there "[ -s $REMOTE/policy/policy.json ] || echo '{}' > $REMOTE/policy/policy.json"

# THE SOUL, WHICH ALSO WASN'T GETTING INSTALLED. Without it, the agent runs
# on Nous's ~800-byte preamble and nothing else: no approval rule, no
# delivery conventions, no language — and it answers like a generic
# assistant. The five generic blocks get installed, which we can fill in on
# our own; `00-identity.md` is left for whoever onboards the client.
# The two arguments: how the ssh gets in and what the agent's directory is
# called. They don't match here —the ssh goes to user@ip and the agent lives
# at /opt/agentes/$SLUG— and with only one, the SOUL wasn't getting
# installed.
if [[ -n "$LOCAL" ]]; then
  echo "   (local simulation: the SOUL installs over ssh, skipping it)"
else
  "$KIT/tools/install-soul.sh" "$SERVER" "$SLUG" || echo "   (the SOUL didn't install; check it by hand)"
fi

# THE config.yaml LOCK STAYS ON. There used to be a `sed` here that commented
# out the TWO `- ./data/config.yaml:...:ro` lines "for the first boot", and
# with that the agent could write its own config until someone remembered to
# run `close-config.sh` by hand — which is to say, almost never. The compose
# says exactly what that enables: "cronjob could get itself turned back on
# and register an MCP that skips the guard; it just had to wait for a
# restart." And it's also what gives the agent the lever for
# `tools/observability.sh`, which reads the model from that file.
#
# The caution was about an old engine: with v2026.7.30 the gateway starts
# fine with the file :ro from the VERY FIRST boot —verified on 12/8 on an
# agent created from scratch— because this same script uploads the config
# before bringing anything up. If some future version ever needs to migrate
# it, there's `tools/with-config-open.sh`, which opens it and closes it back
# up in the same run instead of leaving it open forever.

# ── 4. The compose's .env (no secrets) ────────────────────────────────────
write_over_there "$REMOTE/.env" <<EOF
CLIENT=$SLUG
AGENT_NAME=$NAME
API_DOMAIN=$API_DOMAIN
PORTAL_DOMAIN=$PORTAL_DOMAIN
EMAIL_TLS=soporte@tuagente.uy
EOF

# ── 5. The secrets — template only, NEVER uploaded with keys from here ────
# The keys get loaded by hand on the server. Uploading them by rsync leaves
# them in the local shell's history and in any backup of the laptop.
#
# AND THEY GO AT THE AGENT'S ROOT, not in data/. `data/` belongs to the agent
# (rw, and runs as root inside) and this file is the env_file for BOTH
# services: with the keys in there, a `PYTHONPATH=/opt/data/...` makes it run
# its own code inside the adapter, and from there it reaches policy/ —the
# gate— and the cont-init that s6 runs as root. Measured against the real
# image.
if [[ -z "$LOCAL" ]]; then
  ssh "$SERVER" "bash -s -- $REMOTE" < "$KIT/tools/migrate-secrets.sh"
else
  bash "$KIT/tools/migrate-secrets.sh" "$REMOTE"
fi
if over_there "[ -s $REMOTE/secrets.env ]"; then
  echo "→ secrets.env already exists, leaving it alone"
else
  write_over_there "$REMOTE/secrets.env" <<'EOF'
API_SERVER_KEY=
OPENROUTER_API_KEY=
TELEGRAM_BOT_TOKEN=
TELEGRAM_ALLOWED_USERS=
EOF
  over_there "chmod 600 $REMOTE/secrets.env"
  echo "→ secrets.env created EMPTY — it needs to be filled in on the server"
fi

# ── 6. THE OWNER OF data/, WHICH IS WHAT BROKE THE FIRST DEPLOYMENT ───────
# Everything above got created over ssh, i.e. AS ROOT. The agent runs as uid
# 10000 and on the first boot it wants to seed the engine's 70 skills into
# data/skills: with no permission it throws ~140 "Permission denied" in a
# row, the index is left EMPTY, and the agent starts with not a single
# skill. The boot doesn't fail, there's no visible error in the portal: it
# just doesn't know how to do anything. Seen with Mr.Wobble on 12/8/2026.
#
# Goes at the end, once everything that lives inside data/ has been uploaded.
#
# AND THE OWNERS ARE SET EXPLICITLY, which until today wasn't done: `rsync
# -a` implies `-o -g` and applied the sender's owner, meaning they ended up
# `501:staff` on the VPS — a Mac's uid, which is nobody on the server.
#
#   kit-skills/ and kit-adapter/  → root. Nobody ever writes to them: both
#                                   services mount them :ro.
#   policy/                       → the ADAPTER's (uid 10000), and on
#                                   purpose: that's where it writes
#                                   `policy.json` (the client's permissions)
#                                   and `capabilities/requests.jsonl`. What
#                                   protects that folder from the AGENT isn't
#                                   the owner, it's its container's :ro mount
#                                   — verified: inside hermes it gives
#                                   "Read-only file system" even for root.
#                                   (That the adapter can rewrite the hooks
#                                   sitting next to it is a known item in
#                                   PENDING.md: closed by moving its two files
#                                   into a folder of their own. With the
#                                   adapter's code already out of the agent's
#                                   reach, there's no path to get there.)
#   .kit-installed                → root's and 600: it's ours and nobody
#                                   else reads it.
if [[ -n "$LOCAL" ]]; then
  echo "→ permissions: (local simulation: chown needs root, skipping it)"
else
  echo "→ permissions: data/ and policy/ owned by the agent (uid 10000); kit-skills/ and kit-adapter/ by root"
  ssh "$SERVER" "chown -R 10000:10000 $REMOTE/data $REMOTE/policy && \
                   chown -R root:root $REMOTE/kit-skills $REMOTE/kit-adapter && \
                   chown root:root $REMOTE/.kit-installed $REMOTE/secrets.env && \
                   chmod 600 $REMOTE/.kit-installed $REMOTE/secrets.env"
fi

cat <<EOF

Done, and off on purpose. What's left:

  1. DNS (in Vercel, tuagente.uy):
       $API_DOMAIN      A  -> the VPS's IP
       $PORTAL_DOMAIN   A  -> the same IP
     Check that it resolves BEFORE bringing it up:
       dig +short $API_DOMAIN

  2. The keys, on the server (not from here):
       ssh $SERVER
       openssl rand -hex 32          # the API_SERVER_KEY, unique to this client
       nano $REMOTE/secrets.env

  3. Check data/ BEFORE starting it up. Not optional, and portal-check
     doesn't cover it: catches a SOUL with gaps, mute skills, config
     oversights — and the TWO migrations this deploy doesn't do, because
     they need the agent's live tree: an old skill in data/skills/ shadowing
     the kit's, and an old capabilities catalog inside data/.
       rsync -a $SERVER:$REMOTE/data/ /tmp/$SLUG-data/
       python3 tools/agent-check.py /tmp/$SLUG-data
     If it reports either of those two, fix it by running install.sh on that
     copy and uploading what changed, or by hand on the server.

  4. Bring it up:
       ssh $SERVER 'cd $REMOTE && docker compose up -d'

  5. Check it, and it's 0 failures or it doesn't ship:
       python3 tools/portal-check.py --key <key> \\
           --endpoint https://$API_DOMAIN \\
           --adapter  https://$PORTAL_DOMAIN \\
           --origin   https://tuagente.uy

  6. After naming, the bot's photo (the Bot API won't let a bot change its
     own, it goes through MTProto from your Mac). The two arguments: how the
     ssh gets in and what the agent is called under /opt/agentes/:
       tools/bot-photo.sh $SERVER $SLUG

  (The config.yaml lock already comes on: the compose mounts it :ro from the
   first boot. \`tools/close-config.sh\` is left for the old agents that were
   deployed back when this script left it open — check with
   \`grep -c 'config.yaml:/opt/data/config.yaml:ro' $REMOTE/docker-compose.yml\`,
   it has to give 2.)

  7. The link, which IS the credential:
       https://tuagente.uy/app#endpoint=https://$API_DOMAIN&adapter=https://$PORTAL_DOMAIN&key=<key>
EOF
