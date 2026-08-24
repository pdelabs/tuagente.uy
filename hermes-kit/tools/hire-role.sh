#!/usr/bin/env bash
# Hire a role into an agent: build it, name it, install it, give it its own key,
# serve it.
#
#   ./hire-role.sh support tuagente              # ssh: alias named like the agent
#   ./hire-role.sh support root@1.2.3.4 east     # ssh: host + slug
#   ./hire-role.sh support --local ~/…/agente-lab
#
#   --from-request          takes the name and the look from the request the
#                            client left in the portal (policy/roles/requests.jsonl)
#   --update                re-installs a role ALREADY hired with today's dist:
#                            rebuild + re-injection of the name it already has in
#                            identities.json, WITHOUT a new key, WITHOUT touching
#                            the ledger or the roster. It's how a kit update
#                            reaches a live role without overwriting its name.
#   --name "Juana"          set it by hand (overrides the request, if there was one)
#   --look-file face.json   the look, for a manual hire; goes with --name
#
# WHY THIS EXISTS AND IS NOT FOUR COMMANDS IN A RUNBOOK. Hiring a role needs
# several things to happen together, and the one everybody forgets is the third:
#
#   1. build the distribution        roles/build_role.py
#   1b. PROJECT THE AGENT'S KNOBS    <- a profile inherits none of them
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

# Flags come first and the positionals stay as always: bash 3.2 (macOS's
# /bin/bash) has no long getopt and we won't miss it.
FROM_REQUEST=0
UPDATE=0
NAME=""
LOOK_FILE=""
ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --from-request) FROM_REQUEST=1; shift ;;
    --update)       UPDATE=1; shift ;;
    --name)         NAME="${2:-}"; shift 2 ;;
    --look-file)    LOOK_FILE="${2:-}"; shift 2 ;;
    *)              ARGS+=("$1"); shift ;;
  esac
done
set -- ${ARGS[@]+"${ARGS[@]}"}

ROLE="${1:-}"; shift || true

MODE=ssh
if [[ "${1:-}" == "--local" ]]; then MODE=local; DIR="${2:-}"; else HOST="${1:-}"; SLUG="${2:-${1:-}}"; fi

if [[ -z "$ROLE" ]] || { [[ "$MODE" == local && -z "${DIR:-}" ]]; } || { [[ "$MODE" == ssh && -z "${HOST:-}" ]]; }; then
  echo 'usage: ./hire-role.sh <role> <ssh-host> [slug]   |   ./hire-role.sh <role> --local <path>' >&2
  echo '       [--from-request] [--name "Juana"] [--look-file face.json]' >&2
  exit 2
fi
[[ -d "$KIT/roles/$ROLE" ]] || { echo "roles/$ROLE doesn't exist" >&2; exit 1; }
[[ -z "$LOOK_FILE" || -f "$LOOK_FILE" ]] || { echo "$LOOK_FILE doesn't exist" >&2; exit 1; }

# WHICH CONTAINER IS THE ENGINE'S: read off the compose, which is what named it.
# The compose renders `container_name: <slug>-hermes` from the slug the agent
# was created with, and this script used to GUESS the same string from the
# directory's basename -- with a `sed 's/^agente-//'` on it, left over from when
# every agent directory was called `agente-<slug>`. Two derivations of one fact,
# and the rename that dropped the prefix made them disagree: a directory called
# `agente-acme` holds a container called `acme-hermes` only if it was created
# before the rename. Whatever the compose says is the answer, and it is one
# `awk` away.
compose_container() {
  # stdin: the compose. The engine's service is `hermes:`; `portal-adapter:`
  # declares a container_name too, and taking the first one in the file would
  # be right only as long as nobody reorders the services.
  awk '
    /^  [a-z][a-z0-9_-]*:[ \t]*$/ { service = $1; sub(":", "", service) }
    service == "hermes" && $1 == "container_name:" { print $2; exit }
  '
}

# Where everything lives, in both modes. Resolved UP HERE because the client's
# request has to be read before building anything: the name they chose goes
# into the SOUL, and the SOUL is composed during the build.
if [[ "$MODE" == local ]]; then
  DIR="$(cd "$DIR" && pwd)"; SLUG="$(basename "$DIR")"
  COMPOSE="$DIR/docker-compose.yml"
  [[ -f "$COMPOSE" ]] || { echo "$COMPOSE doesn't exist — is that the agent's directory?" >&2; exit 1; }
  CONT="$(compose_container < "$COMPOSE")"
  # A QUOTED VALUE IS STILL A VALID COMPOSE, and `docker exec` on the quotes is
  # not. `container_name: "cliente-hermes"` is what a hand-edited compose looks
  # like sooner or later, and the quotes come back attached: every `run` below
  # then dies on `no such object: "cliente-hermes"` -- late, long after the name
  # was resolved, naming something the compose never said. Stripping here is the
  # only place that knows the value came out of YAML.
  CONT="${CONT%\"}"; CONT="${CONT#\"}"
  CONT="${CONT%\'}"; CONT="${CONT#\'}"
  [[ -n "$CONT" ]] || { echo "$COMPOSE has no container_name under the hermes service" >&2; exit 1; }
  POLICY_ROLES="$DIR/policy/roles"
  run() { docker exec "$CONT" sh -c "$1"; }
else
  # Over ssh the slug is not a guess: the operator typed it, `/opt/agentes/$SLUG`
  # is the directory this script is about to write into, and it is the same
  # variable `deploy-remote.sh` rendered the compose from. Nothing to read back.
  CONT="$SLUG-hermes"
  POLICY_ROLES="/opt/agentes/$SLUG/policy/roles"
  run() { ssh "$HOST" "docker exec $CONT sh -c '$1'"; }
fi

# policy/ LIVES ON THE HOST, not inside the engine's container: it's mounted
# :ro there on purpose (a guardrail the guarded can rewrite is not a
# guardrail). These three functions are the only door to those files and work
# the same locally and over ssh, so there's no `if` per file below.
fetch() { if [[ "$MODE" == local ]]; then cat "$POLICY_ROLES/$1" 2>/dev/null || true
         else ssh "$HOST" "cat '$POLICY_ROLES/$1' 2>/dev/null" || true; fi; }
# The remote path runs as root over ssh, and the adapter container runs as
# 10000:10000 with policy/ mounted rw: a root-owned roles/ dir means the
# next request from the portal dies on Errno 13. The chown keeps what the hire
# drops writable for the adapter. Locally Docker Desktop virtualises bind-mount
# ownership, so there is nothing to fix on the Mac.
# write() replaces via tmp+mv: the adapter parses these files on every request,
# and a plain `cat >` truncates first -- a request landing mid-write reads half
# a JSON document. Measured on the lab (2026-08-19): a request POST during an
# in-place catalog rewrite died on JSONDecodeError. rename(2) is atomic on the
# same filesystem, bind mounts included.
write() { if [[ "$MODE" == local ]]; then mkdir -p "$POLICY_ROLES"; cat > "$POLICY_ROLES/$1.tmp" && mv "$POLICY_ROLES/$1.tmp" "$POLICY_ROLES/$1"
         else ssh "$HOST" "mkdir -p '$POLICY_ROLES' && cat > '$POLICY_ROLES/$1.tmp' && mv '$POLICY_ROLES/$1.tmp' '$POLICY_ROLES/$1' && chown -R 10000:10000 '$POLICY_ROLES'"; fi; }
append() { if [[ "$MODE" == local ]]; then mkdir -p "$POLICY_ROLES"; cat >> "$POLICY_ROLES/$1"
         else ssh "$HOST" "mkdir -p '$POLICY_ROLES' && cat >> '$POLICY_ROLES/$1' && chown -R 10000:10000 '$POLICY_ROLES'"; fi; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# THE CLIENT'S REQUEST. The portal doesn't hire: it writes a line in
# requests.jsonl with the role, the name they gave it and the look they drew
# for it. The pending one gets DERIVED from the log (a `hired` or a
# `cancelled` closes it), the same way the adapter does it, so the two of us
# can never disagree about which name is being installed.
fetch requests.jsonl > "$TMP/requests.jsonl"
REQUEST_NAME="$(python3 - "$ROLE" "$TMP/requests.jsonl" "$TMP/look-request.json" "$TMP/capabilities-request.json" <<'PY'
import json, sys

role, log, look_out, caps_out = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
pending = None
for line in open(log, encoding="utf-8"):
    try:
        row = json.loads(line)
    except ValueError:
        continue                       # a half-written line costs that line
    if row.get("role") != role:
        continue
    if row.get("event") == "requested" and pending is None:
        pending = row               # the oldest one: it's what the client is waiting for
    elif row.get("event") in ("hired", "cancelled"):
        pending = None
if pending is None:
    raise SystemExit(0)
if pending.get("look"):
    with open(look_out, "w", encoding="utf-8") as fh:
        json.dump(pending["look"], fh, ensure_ascii=False)
if pending.get("capabilities"):
    # What the client marked when they said what they needed (today only the
    # assistant). Pulled out here and printed at the end: it doesn't install
    # itself.
    with open(caps_out, "w", encoding="utf-8") as fh:
        json.dump(pending["capabilities"], fh, ensure_ascii=False)
print(pending.get("name") or "")
PY
)"

if [[ "$UPDATE" == 1 ]]; then
  # An update keeps the baptism the role already has: the SOUL is
  # distribution_owned, so re-installing without re-injecting the name would
  # silently rename the client's teammate back to the catalog default.
  fetch identities.json > "$TMP/identities.current.json"
  NAME="$(python3 -c '
import json, sys
try:
    data = json.load(open(sys.argv[2], encoding="utf-8"))
except (OSError, ValueError):
    data = {}
print((data.get(sys.argv[1]) or {}).get("name") or "")' "$ROLE" "$TMP/identities.current.json")"
  [[ -n "$NAME" ]] && echo "→ update: keeping the name $NAME" || echo "→ update: this role has no name yet, going with the catalog default"
elif [[ "$FROM_REQUEST" == 1 ]]; then
  [[ -n "$REQUEST_NAME" ]] || { echo "there's no pending request for '$ROLE' in $POLICY_ROLES/requests.jsonl" >&2; exit 1; }
  NAME="$REQUEST_NAME"
  if [[ -f "$TMP/look-request.json" ]]; then LOOK_FILE="$TMP/look-request.json"; fi
  echo "→ client's request: they named it $NAME"
elif [[ -z "$NAME" && -n "$REQUEST_NAME" ]]; then
  # Hiring while ignoring the request means losing the name the client chose,
  # and losing it quietly: the role comes in called Beto and the portal shows
  # Beto where the client wrote Juana. Stop here and choose by hand.
  echo "there's a pending request for '$ROLE': the client named it $REQUEST_NAME." >&2
  echo "run with --from-request to hire it with that name, or --name X to override it." >&2
  exit 1
fi

if [[ -n "$NAME" ]]; then
  # One single sanitation for both destinations: the SOUL and identities.json
  # have to say the SAME name, or the role introduces itself one way and the
  # portal draws it another. (The SOUL writer strips `<` and `>` again anyway:
  # that's where the block's invariant lives, not here.)
  NAME="$(python3 -c 'import re,sys; print(re.sub(r"\s+", " ", sys.argv[1]).replace("<","").replace(">","").strip()[:40])' "$NAME")"
  [[ -n "$NAME" ]] || { echo "that name leaves nothing usable" >&2; exit 1; }
fi

# Without gateway.multiplex_profiles the install "succeeds" and the role is
# never served: /p/<rol>/ stays dead and the waiting loop below never ends.
# Cheaper to refuse here, with the fix in hand, than to hang there.
if ! run "grep -qE '^[[:space:]]*multiplex_profiles:[[:space:]]*true' /opt/data/config.yaml"; then
  echo "this agent doesn't have gateway.multiplex_profiles: true in data/config.yaml:" >&2
  echo "the gateway would only serve the active profile and the role would end up" >&2
  echo "installed but unreachable. Add it (it's in compose/config.base.yaml) and retry." >&2
  exit 1
fi

echo "→ building the distribution"
# Into the temp dir, NOT the repo's dist/: the client's name gets injected into
# this build, and a named build sitting in the working tree is one copy-paste
# of build_role.py's suggested install command away from landing in the next
# client's agent. The repo's dist/ stays nameless.
DIST="$TMP/dist/$ROLE"
python3 "$KIT/roles/build_role.py" "$ROLE" --out "$TMP/dist" >/dev/null

echo "→ projecting this agent's knobs into the profile's config"
# STEP 1b, AND IT IS THE ONE NOBODY KNEW WAS MISSING. A secondary profile reads
# ITS OWN config.yaml over the engine's defaults and inherits nothing from
# data/config.yaml -- that file is the DEFAULT profile's, not the agent's
# (hermes:hermes_cli/config.py:3263-3330). Measured on the local agent
# 2026-08-23 by resolving the engine's loader under each home: the hired roles
# had no kanban toolset, no gate hooks, the curator on over the only copy of
# their craft skills, the engine's "assume plain text" preamble and a different
# MODEL -- so every cost and quality number ever measured for a role was
# measured on something else.
#
# The distribution cannot fix that: it is generic and the model is the client's.
# Here the agent's config is one `docker exec` away, so here is where the copy
# belongs. `tools/profile_config.py` owns which knobs travel and which four do
# not; `tools/agent-check.py` fails, naming the knob, when this file and the
# agent's config drift apart.
#
# It is read from INSIDE the container, at the path the engine reads, so the ssh
# and the local paths ask the same question and neither depends on knowing where
# the agent's directory lives on that host.
run "cat /opt/data/config.yaml" > "$TMP/agent-config.yaml"
python3 "$KIT/tools/profile_config.py" "$ROLE" \
  --agent-config "$TMP/agent-config.yaml" > "$DIST/config.yaml"

if [[ -n "$NAME" ]]; then
  echo "→ leaving its name in the SOUL"
  # THE `portal:identity` BLOCK, the same one that writes the whole agent's own
  # baptism (adapter: write_identity_in_soul). It's not a convention of this
  # script: the SOUL's base block already says that if a `portal:identity`
  # shows up further down, THAT name wins over any other in the document.
  # It goes here and not inside the container because SOUL.md is
  # `distribution_owned`: every `hermes profile install` overwrites it, so the
  # name has to travel in the distribution and come back in on every update.
  python3 - "$DIST/SOUL.md" "$NAME" <<'PY'
import re, sys

soul, name = sys.argv[1], sys.argv[2]
# No `<` or `>`: the block is delimited with HTML comments and a name with
# those characters closes it early (same sanitation as the adapter's).
name = re.sub(r"\s+", " ", name).replace("<", "").replace(">", "").strip()[:40]
start, end = "<!-- portal:identity -->", "<!-- /portal:identity -->"
block = "\n".join([
    start,
    "## Quién sos",
    "",
    f"Tu cliente te bautizó **{name}** desde el portal. Ese es tu nombre:",
    "presentate así cuando saludes, cuando te pregunten quién sos y cuando",
    "firmes lo que entregás. Si el resto de este documento te llama de otra",
    "forma, vale este.",
    end,
])
text = open(soul, encoding="utf-8").read()
i, f = text.find(start), text.find(end)
new = text[:i] + block + text[f + len(end):] if i != -1 and f > i else text.rstrip() + "\n\n" + block + "\n"
open(soul, "w", encoding="utf-8").write(new)
PY
fi

# The role's key is generated HERE and none gets reused: it's what separates
# one role from another for the engine, and sharing it would give all four the
# same door.
if [[ "$UPDATE" == 1 ]]; then KEY=""; else KEY="$(openssl rand -hex 32)"; fi

echo "→ copying the distribution"
if [[ "$MODE" == local ]]; then
  # rm first: `docker cp dir existing-dir` NESTS instead of replacing, and an
  # update would silently re-fetch the stale copy from the original hire.
  run "rm -rf /tmp/dist-$ROLE"
  docker cp "$DIST" "$CONT:/tmp/dist-$ROLE" >/dev/null
else
  ssh "$HOST" "rm -rf /tmp/dist-$ROLE"
  scp -rq "$DIST" "$HOST:/tmp/dist-$ROLE"
  ssh "$HOST" "docker cp /tmp/dist-$ROLE $CONT:/tmp/dist-$ROLE"
fi

if [[ "$UPDATE" == 1 ]]; then
  # The engine refuses `install` over an existing profile and is right to:
  # update rewrites only distribution_owned files, install would demand --force.
  echo "→ updating the profile"
  # update takes the NAME and re-fetches from the recorded source -- which is
  # /tmp/dist-$ROLE from the original install, refreshed by the docker cp above.
  #
  # --force-config BECAUSE THE PROFILE'S config.yaml IS OURS. The engine
  # preserves it on update by default, assuming it holds the operator's
  # overrides; ours holds the pin that keeps the profile servable at all (see
  # PROFILE_CONFIG in roles/build_role.py). Without the flag a role hired
  # before the pin existed would keep its missing config through every update
  # -- which is exactly how the two roles on the local agent stayed skipped.
  run "hermes profile update $ROLE -y --force-config" | tail -3
else
  echo "→ installing the profile"
  run "hermes profile install /tmp/dist-$ROLE -y" | tail -3
fi

if [[ "$UPDATE" == 1 ]]; then
  echo "→ key stays whatever it already had (.env isn't part of the distribution)"
else
  echo "→ giving it its own key"
  run "echo 'API_SERVER_KEY=$KEY' > /opt/data/profiles/$ROLE/.env && chown 10000:10000 /opt/data/profiles/$ROLE/.env"
fi

echo "→ pointing its workspace at the shared one"
# ONE workspace, the client's. Every profile gets its own workspace dir and the
# portal's Archivos tab reads only the default's -- so a role that "delivered"
# into its private dir delivered into a place no screen shows. A symlink makes
# this a filesystem fact instead of a SOUL instruction someone can forget.
# cp -rn first: never clobber anything the role already wrote.
run "w=/opt/data/profiles/$ROLE/workspace; if [ -d \"\$w\" ] && [ ! -L \"\$w\" ]; then cp -rn \"\$w\"/. /opt/data/workspace/ 2>/dev/null || true; rm -rf \"\$w\"; ln -s /opt/data/workspace \"\$w\"; chown -h 10000:10000 \"\$w\"; fi"

# The count BEFORE the restart, because gateway.log is append-only across
# boots and a boot from last week must not fail today's hire. What matters is
# whether the boot we are about to cause adds one more.
SKIPS_BEFORE="$(run "grep -c \"Skipping secondary profile .$ROLE.\" /opt/data/logs/gateway.log || true" 2>/dev/null || echo 0)"

echo "→ restarting the gateway so it serves it"
if [[ "$MODE" == local ]]; then docker restart "$CONT" >/dev/null; else ssh "$HOST" "docker restart $CONT" >/dev/null; fi

echo "→ waiting"
until run "hermes profile list" >/dev/null 2>&1; do sleep 5; done
# The gateway answers before it writes the multiplex line, so the wait above
# isn't enough: without this the script showed the OLD set and it looked like
# the role hadn't gone in.
until run "grep -q \"multiplex:.*'"'"'$ROLE'"'"'\" /opt/data/logs/gateway.log" 2>/dev/null; do sleep 3; done

# AND THE LINE ABOVE IS NOT PROOF THAT THE ROLE IS SERVED. It comes from the
# cron scheduler, which lists what `profiles_to_serve` scanned off disk -- the
# same directory scan that answers /p/<role>/. A profile whose config makes the
# gateway refuse its adapters is still in that list, so for weeks the hire
# looked green while every boot logged:
#
#   Skipping secondary profile '<role>' due to port-binding config error
#
# and started none of that profile's adapters. `roles/build_role.py` ships the
# config that avoids it; this is what notices when it stops working.
SKIPS_AFTER="$(run "grep -c \"Skipping secondary profile .$ROLE.\" /opt/data/logs/gateway.log || true" 2>/dev/null || echo 0)"
if [[ "${SKIPS_AFTER:-0}" -gt "${SKIPS_BEFORE:-0}" ]]; then
  echo >&2
  echo "the gateway REFUSED to serve profile '$ROLE' on this boot:" >&2
  run "grep \"Skipping secondary profile .$ROLE.\" /opt/data/logs/gateway.log | tail -1" >&2 || true
  echo >&2
  echo "Its config.yaml declares a platform that binds a port, and under" >&2
  echo "gateway.multiplex_profiles only the default profile may. Rebuild the" >&2
  echo "distribution (roles/build_role.py writes the pin) and re-run this with" >&2
  echo "--update; python3 tools/agent-check.py <agent>/data names it too." >&2
  exit 1
fi

# EVERYTHING FROM HERE ON GETS PERSISTED, and not before: the role is already
# installed and the gateway is already serving it. A hire that failed at
# `hermes profile install` leaves nothing written (see the why behind the
# roster, further down).
if [[ -n "$NAME" && "$UPDATE" != 1 ]]; then
  echo "→ writing down the name"
  # THE CLIENT'S NAME DOES NOT LIVE IN THE PROFILE. role.json is
  # `distribution_owned`: the next `hermes profile install` replaces it and the
  # name would be gone with the first update the client never asked for. It
  # lives in policy/roles/identities.json, which belongs to the host, and is
  # what the adapter reads to serve the name and the look in `GET
  # /portal/roles`.
  fetch identities.json > "$TMP/identities.json"
  python3 - "$ROLE" "$NAME" "$LOOK_FILE" "$TMP/identities.json" "$TMP/identities.new.json" <<'PY'
import json, sys, time

role, name, look_file, current, out = sys.argv[1:6]
try:
    with open(current, encoding="utf-8") as fh:
        data = json.load(fh)
except (OSError, ValueError):
    data = {}                          # hasn't named anyone yet
if not isinstance(data, dict):
    data = {}
look = None
if look_file:
    with open(look_file, encoding="utf-8") as fh:
        look = json.load(fh)
data[role] = {
    "name": name,
    "look": look,
    "named_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
}
with open(out, "w", encoding="utf-8") as fh:
    json.dump(data, fh, ensure_ascii=False, indent=2)
    fh.write("\n")
PY
  write identities.json < "$TMP/identities.new.json"

  # AND THE REQUEST GETS CLOSED. requests.jsonl is append-only —a line never
  # gets rewritten— so "already hired" is one more event, not a field someone
  # edits. Without this the portal keeps telling the client "you asked for
  # this, it's on its way" about someone who's already working.
  python3 -c 'import json,sys,time; print(json.dumps({"event":"hired","role":sys.argv[1],"name":sys.argv[2],"hired_at":time.strftime("%Y-%m-%dT%H:%M:%S")}, ensure_ascii=False))' \
    "$ROLE" "$NAME" | append requests.jsonl
fi

if [[ "$UPDATE" == 1 ]]; then
  echo "Done: $ROLE updated with today's dist, same name, same key."
  exit 0
fi

echo "→ leaving the roster in policy/"
# THE ROSTER IS WHAT TURNS THIS AGENT INTO A TEAM, for the portal and for the
# installer. The adapter draws the Equipo tab only when `policy/roles/
# catalog.json` exists, and `install.sh` reads the same file to decide that
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
# It goes on the HOST and not through `docker exec`: policy/ is mounted read
# only in the engine's container, on purpose (a guardrail the guarded can
# rewrite is not a guardrail).
write catalog.json < "$KIT/roles/catalog.json"

echo
run "grep -o \"multiplex: .*\" /opt/data/logs/gateway.log | tail -1" || true
echo
echo "Done. $ROLE hired on $SLUG${NAME:+, and its name is $NAME}."
echo "The portal will show it under Equipo — no need to hand it any key:"
echo "the adapter has the role's, and the client keeps using theirs."
echo
echo "RUN THE INSTALLER ONCE MORE — not only after the first hire:"
echo "  ./install.sh <agent>/data      (or ./deploy-remote.sh, if it's remote)"
echo "Two things depend on it. With a roster, kit-skills/ keeps only the shared"
echo "skills and the craft ones stop getting charged to every role on every"
echo "request. And this role's plugins reach plugins/ (mounted at /opt/plugins)"
echo "only from there: hiring installs the profile, the installer is what makes"
echo "the agent SAY which plugins it now has."

# WHAT THE CLIENT ASKED FOR AND THIS SCRIPT DID NOT SET UP. A role composed of
# capabilities (today the assistant) arrives with the list the client checked
# during onboarding, and hiring it does NOT install any of them: each one is
# our own work with the catalog in front of us. It goes last and loud because
# it's the only part of the onboarding still pending when the script finishes
# cleanly — and a pending item printed in the middle of the log is a pending
# item nobody sees.
if [[ -s "$TMP/capabilities-request.json" ]]; then
  echo
  echo "=============================================================="
  echo "THE CLIENT ASKED FOR THESE CAPABILITIES — not set up yet:"
  python3 - "$TMP/capabilities-request.json" "$KIT/capabilities/catalog.json" <<'PY'
import json, sys

requested = json.load(open(sys.argv[1], encoding="utf-8"))
try:
    catalog = json.load(open(sys.argv[2], encoding="utf-8"))["capabilities"]
except (OSError, ValueError, KeyError):
    catalog = []
labels = {c.get("id"): c.get("label") or "" for c in catalog}
for ident in requested:
    # The id wins: it's what has to be looked up in the catalog. The label is
    # there to recognize it at a glance, and if the catalog changed, it's
    # missing and doesn't lie.
    print(f"  - {ident}" + (f"   ({labels[ident]})" if labels.get(ident) else ""))
PY
  echo
  echo "Install them with the catalog in hand (capabilities/catalog.json)."
  echo "=============================================================="
fi

# THE BOT PHOTO, offered and never automatic: uploading a profile photo talks
# to Telegram AS the client's bot, and that is an outward-facing move the
# operator triggers on purpose. If the agent has no bot token there is nothing
# to offer, so the hint only prints when one is set.
HAS_TOKEN=0
if [[ "$MODE" == local ]]; then
  grep -qE '^TELEGRAM_BOT_TOKEN=.+' "$DIR/secrets.env" 2>/dev/null && HAS_TOKEN=1
else
  ssh "$HOST" "grep -qE '^TELEGRAM_BOT_TOKEN=.+' /opt/agentes/$SLUG/secrets.env" 2>/dev/null && HAS_TOKEN=1
fi
if [[ "$HAS_TOKEN" == 1 ]]; then
  echo
  echo "The Telegram bot can wear ${NAME:-$ROLE}'s face (by hand, whenever you want):"
  if [[ "$MODE" == local ]]; then
    echo "  ~/.tuagente-tools/bin/python3 $KIT/tools/avatar-bot.py \\"
    echo "      --role $ROLE --agent $DIR --env $DIR/data/.env"
  else
    echo "  ~/.tuagente-tools/bin/python3 $KIT/tools/avatar-bot.py --role $ROLE --env <.env with the token>"
    echo "  (for the baptism's face you need the agent's policy/roles/identities.json:"
    echo "   fetch it with scp and pass that folder with --agent)"
  fi
fi
