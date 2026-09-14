#!/usr/bin/env bash
# Installs the kit's base SOUL on an agent that doesn't have it.
#
#   ./install-soul.sh tuagente
#   ./install-soul.sh root@1.2.3.4 east   # if the ssh host isn't named like the agent
#   ./install-soul.sh --block             # prints what it would install, no ssh, touches nothing
#   ./install-soul.sh --replace tuagente   # swaps the old block for the new one
#   ./install-soul.sh --replace --rescue tuagente   # and also pulls out of the block
#                                              # whatever the client wrote inside it
#
# WHY IT EXISTS: `deploy-remote.sh` never used to install a SOUL. Remote
# agents ran with Nous's 800-byte preamble and NOTHING else: no approval rule,
# no delivery conventions, no language. That's why they answered like a
# generic assistant. (Seen on 11/8 with Mr.Wobble: 10 lines of SOUL.)
#
# WHAT IT INSTALLS: the five generic blocks —approvals, delivery, channels,
# language and precedence— between the `kit:base` markers, with their
# version, and with <RESPONSABLE> resolved as "tu cliente", which is exactly
# who's holding the portal.
#
# WHAT IT DOESN'T: `00-identity.md`, which has eight gaps and is the
# hand-crafted part (what it does, who's who, what can never happen without
# an OK). The block the portal writes during the baptism already covers name
# and company; a person writes the rest, client by client.
#
# It's idempotent: if there's already a block —whatever version— it doesn't
# duplicate it. To MOVE from one version to another there's `--replace`,
# which pulls the old block out and puts the new one in, keeping everything
# outside it (the identity, the block the portal wrote at the baptism).
# Before this was "pull the old block out by hand," on a 15 KB file, over ssh.
#
# And it refuses if there's text inside the old block that isn't in that
# version's canonical block (soul/versions/vN.md): that was written by a
# person for THAT client and the replace would take it out along with the
# rest. It prints it line by line; with `--rescue` it moves it outside the
# block —into the identity's "Lo que en esta empresa no se hace sin permiso"
# section, which the replace keeps word for word— and only then replaces.
#
# NEEDS python3 ON YOUR MACHINE (not on the server): before uploading
# anything it runs `agent-check.py --review` on the block it composed.
# Without python3 it doesn't install, and that's on purpose — it's the only
# check standing between a broken block (an unfilled gap, a comment the
# engine reads as an injection) and the prompt of a production agent.
set -euo pipefail

KIT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BLOCKS=(01-approvals 02-delivery 03-channels 04-language 05-precedence)
[[ -f "$KIT/soul/VERSION" ]] || {
  echo "missing $KIT/soul/VERSION, which says which version of the block the kit installs." >&2
  echo "It's one line with the version (vN). Create it and run again:" >&2
  echo "   echo v2 > $KIT/soul/VERSION" >&2
  exit 1
}
VERSION="$(tr -d '[:space:]' < "$KIT/soul/VERSION")"

# The version has to look like a version or nothing gets stamped. A "2" or a
# "v2.1" would go into the marker just the same, and then `agent-check.py`
# would see them as unbalanced markers, which sends you looking for the
# problem somewhere else.
[[ "$VERSION" =~ ^v[0-9]+$ ]] || {
  echo "soul/VERSION says '$VERSION' and it has to be vN (v1, v2, v3…)." >&2
  echo "Installing nothing until that's fixed." >&2
  exit 1
}

MARKER="<!-- kit:base $VERSION -->"
CLOSE="<!-- /kit:base -->"

# Composing it apart from ssh: this way what's about to be installed can be
# seen and checked without a server in front of you (`--block`).
compose() {
  echo "$MARKER"
  echo
  for b in "${BLOCKS[@]}"; do
    sed 's/<RESPONSABLE>/tu cliente/g' "$KIT/soul/$b.md"
    echo
  done
  echo "$CLOSE"
  echo
}

if [[ "${1:-}" == "--block" ]]; then
  compose
  exit 0
fi

REPLACE=0
RESCUE=()
while [[ "${1:-}" == --* ]]; do
  case "$1" in
    --replace) REPLACE=1; shift ;;
    # Passed straight through to replace-block.py: it moves whatever the
    # client wrote inside the block out to the identity, before replacing.
    --rescue)  RESCUE=(--rescue); shift ;;
    *) echo "unknown option $1" >&2; exit 1 ;;
  esac
done
if [[ ${#RESCUE[@]} -gt 0 && $REPLACE -eq 0 ]]; then
  echo "--rescue only makes sense with --replace." >&2
  exit 1
fi

HOST="${1:-}"
[[ -n "$HOST" ]] || {
  echo 'usage: ./install-soul.sh [--replace [--rescue]] <ssh-host> [slug] | --block' >&2
  exit 1
}
# The directory on the VPS is /opt/agentes/<slug>, and by default the slug is
# the same name as the ssh host (that's how observability.sh and
# reset-agent.sh use it). When they don't match —`deploy-remote.sh` connects
# as user@ip— it goes as the second argument; without that the script used to
# upload the file, the `cd` would fail, and it would finish without
# installing anything.
SLUG="${2:-$HOST}"
DIR="/opt/agentes/$SLUG"

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
compose > "$tmp"

# The block being installed has to be IDENTICAL to the one frozen in
# soul/versions/$VERSION.md. That file isn't documentation: it's what
# `replace-block.py` is going to compare THIS agent's block against the day
# it moves up to the next version, and it's the only thing that tells "the
# kit brought this" apart from "a person wrote this for this client." If a
# block that isn't frozen gets installed, that comparison has no baseline and
# we're back to the 12/8 bug: the replace silently deletes whatever the
# client added.
FROZEN="$KIT/soul/versions/$VERSION.md"
if [[ ! -f "$FROZEN" ]]; then
  echo "missing $FROZEN: this kit never froze the $VERSION block." >&2
  echo "Without it, this agent's next update has nothing to compare" >&2
  echo "against. Freeze it and run again:" >&2
  echo "   ./tools/install-soul.sh --block > soul/versions/$VERSION.md" >&2
  exit 1
fi
if ! diff -q "$FROZEN" "$tmp" >/dev/null; then
  echo "the blocks in soul/ no longer compose what $FROZEN says:" >&2
  diff -u "$FROZEN" "$tmp" | sed -n '3,40p' >&2
  echo >&2
  echo "Either you changed soul/*.md without bumping soul/VERSION —and now two" >&2
  echo "different things are both called $VERSION—, or the frozen copy went stale." >&2
  echo "Bump the version and freeze the new one, or re-freeze this one:" >&2
  echo "   ./tools/install-soul.sh --block > soul/versions/$VERSION.md" >&2
  exit 1
fi

# NOTHING leaves here unreviewed, and it's reviewed BEFORE touching the
# network: it's a property of the kit, not of the server. These are the
# SOUL's two silent failure modes, with the same code that later reviews the
# already-installed SOUL:
#
#   - an unfilled gap: the HARD RULE reached production saying
#     "JAMAS <la accion sensible: ...>", which forbids nothing;
#   - an HTML comment with ignore/override/system/secret/hidden: the engine
#     discards the WHOLE file and the agent starts with no identity and no
#     rules.
if ! output="$(python3 "$KIT/tools/agent-check.py" --review "$tmp")"; then
  echo "$output" >&2
  echo >&2
  echo "Installing nothing: fix the blocks in soul/ and run again." >&2
  exit 1
fi

ssh "$HOST" "[ -d $DIR/data ]" || {
  echo "$DIR/data doesn't exist on $HOST" >&2
  echo "if the agent's directory isn't named '$SLUG', pass it as the second" >&2
  echo "argument:  ./install-soul.sh $HOST <slug>" >&2
  exit 1
}

# Already installed: any version is fine, but we say which one is there. We
# don't overwrite it: if two blocks ended up there, the precedence rule would
# make the one further down win, i.e. the old one.
present="$(ssh "$HOST" "grep -o '<!-- kit:base[^>]*-->' $DIR/data/SOUL.md 2>/dev/null | head -1" || true)"

if [[ $REPLACE -eq 1 ]]; then
  [[ -n "$present" ]] || {
    echo "$HOST has no kit:base block at all: this is an install, not a" >&2
    echo "replace. Run the same command without --replace." >&2
    exit 1
  }
  old="$(mktemp)"; new="$(mktemp)"
  trap 'rm -f "$tmp" "$old" "$new"' EXIT
  ssh "$HOST" "cat $DIR/data/SOUL.md" > "$old"
  echo "→ $HOST has $present · this kit installs $VERSION"
  # The old SOUL stays on your machine before touching anything: if something
  # goes wrong, the original is right here and there's no need to go fetch it
  # from the server.
  mkdir -p "$KIT/soul-backups"
  backup="$KIT/soul-backups/$SLUG-$(date +%Y%m%d-%H%M%S).md"
  cp "$old" "$backup"
  echo "   copy of the old SOUL: $backup"
  # `${a[@]+"${a[@]}"}`: with `set -u` and bash 3.2 —macOS's—, expanding an
  # empty array with a bare "${a[@]}" aborts the script.
  if ! python3 "$KIT/tools/replace-block.py" "$old" "$tmp" \
       ${RESCUE[@]+"${RESCUE[@]}"} > "$new"; then
    echo >&2
    echo "Touched nothing on $HOST." >&2
    exit 1
  fi
  ssh "$HOST" "cat > /tmp/soul-new.md" < "$new"
  ssh "$HOST" "cd $DIR/data && mv /tmp/soul-new.md SOUL.md && chown 10000:10000 SOUL.md"
  echo "→ block replaced with $VERSION on $HOST"
  ssh "$HOST" "wc -c < $DIR/data/SOUL.md | sed 's/^/   /' ; echo '   bytes'"
  echo
  echo "Check that the agent still knows who it is: the identity block and the"
  echo "baptism's block were left out of the replace, but it's a one-minute look."
  exit 0
fi

if [[ -n "$present" ]]; then
  echo "$HOST already has the base block: $present"
  echo "This kit installs $VERSION. To update it: ./install-soul.sh --replace $HOST${2:+ $2}"
  exit 0
fi

# It goes IN FRONT of whatever's already there: Nous's preamble and, above
# all, the `portal:identity` block the adapter rewrites at every baptism.
# Overwriting the whole file would delete the name and the company the client
# already entered.
#
# AND IF THERE'S NOTHING THERE EITHER, IT STILL INSTALLS — which is the case
# this script exists for and was exactly the one that didn't work. This used
# to say
#     { cat /tmp/soul-base.md; [ -f SOUL.md ] && cat SOUL.md; } > SOUL.nuevo && mv …
# and a pipeline's status is the LAST command's: with no SOUL.md, `[ -f … ]`
# returns 1, the `&& mv` never runs, and the agent is left with no SOUL, with
# an orphaned SOUL.nuevo sitting next to it. The only trace was
# `deploy-remote.sh`'s "(the SOUL wasn't installed; check by hand)", which
# reads like an ssh problem.
# It shows up when resetting an agent in full mode —the reset takes the SOUL
# with it— and on any onboarding where the SOUL doesn't exist yet. With `if`
# the pipeline exits 0.
ssh "$HOST" "cat > /tmp/soul-base.md" < "$tmp"
ssh "$HOST" "cd $DIR/data && \
  cat /tmp/soul-base.md > SOUL.new && \
  if [ -f SOUL.md ]; then cat SOUL.md >> SOUL.new; fi && \
  mv SOUL.new SOUL.md && chown 10000:10000 SOUL.md && rm -f /tmp/soul-base.md"

echo "→ SOUL $VERSION installed on $HOST"
ssh "$HOST" "wc -c < $DIR/data/SOUL.md | sed 's/^/   /' ; echo '   bytes'"
echo
echo "MISSING: the hand-crafted part, 00-identity.md (what it does, who approves"
echo "what, what can never happen without an OK). A person writes that, per client."
echo
echo "And after that, the full check against the agent's data/ —catches a SOUL"
echo "with no identity, mute skills and config oversights—:"
echo "   python3 tools/agent-check.py $DIR/data     (on $HOST, or against a copy)"
