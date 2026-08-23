#!/usr/bin/env bash
# Installs the tuagente kit into a Hermes agent's data/.
#
#   ./install.sh /path/to/the/agent/data            installs or updates
#   ./install.sh /path/to/the/agent/data --diff     only shows the differences
#
# The kit is the source of truth: if you fixed the adapter or a skill while
# debugging inside an agent, --diff tells you before it gets lost.
set -euo pipefail

KIT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA="${1:-}"
MODE="${2:-install}"

if [[ -z "$DATA" ]]; then
  echo "usage: $0 /path/to/the/agent/data [--diff]" >&2
  exit 2
fi
if [[ ! -d "$DATA" ]]; then
  echo "$DATA doesn't exist — is it the agent's data/?" >&2
  exit 2
fi
# NORMALIZING THE PATH IS NOT COSMETIC: IT'S THE MOST EXPENSIVE BUG THIS SCRIPT
# EVER HAD. `AGENT` comes out of a `cd && pwd`, so it arrives clean; `DATA`
# came in exactly as the person typed it. With the trailing slash tab-
# completion adds (`install.sh <agent>/data/`), the manifest's paths came out
# with a double slash —`data//scripts/portal_adapter.py`—, and on the NEXT run,
# without the slash, the cleaner saw that path as obsolete, resolved it to the
# just-installed file (the filesystem collapses the double slash), got the
# correct sha —it's the same byte for byte— and DELETED IT. Silently, with
# rc=0. It took the portal adapter and the connections catalog down with it:
# the whole :8643 service — tickets, approvals, deliverables, files, activity,
# usage and capabilities. It happened in both directions and didn't heal on
# its own.
DATA="$(cd "$DATA" && pwd)"

# THE KIT'S SKILLS NO LONGER GO INSIDE data/. They go to <agent>/kit-skills/,
# which the compose mounts :ro at /opt/kit/skills and config.yaml declares in
# `skills.external_dirs`. The engine indexes them the same way, but:
#   - the agent can't rewrite them (skill_manage against a :ro gives EROFS),
#   - the curator never archives them: for the engine an external skill is
#     never eligible, while a data/skills/ one WAS — after 90 days unused it
#     moves the directory to .archive/ and the portal loses `deliverable`.
AGENT="$(cd "$DATA/.." && pwd)"
KIT_SKILLS="$AGENT/kit-skills"

# The file list is BUILT from the repo: every kit skill goes in whole. It used
# to be a hand-written list and the cost was real: two skills got added to the
# kit (transcribe, drive-inbox) and the first new agent shipped without them —
# with the SOUL promising transcriptions the agent couldn't do.
# Each pair's destination is an absolute path: not everything goes to the same
# side.
#
# POLICY/ GOES HERE TOO, and until today it didn't: `deploy-remote.sh` used to
# upload the guard, the tools.json files, the pairing patch and the cont-init,
# and a LOCAL agent got none of that. The symptom wasn't an error but a lost
# client: without the patch, the Telegram bot's first message comes out in
# English asking them to run `hermes pairing approve …` in a terminal, right
# when the portal is telling them "paste the code here". Two installers for
# the same folder is how one falls behind; now both put the same thing and
# `--diff` checks it.
POLICY="$AGENT/policy"
# THE ADAPTER'S CODE NO LONGER LIVES INSIDE data/, AND IT'S A PRIVILEGE
# ESCALATION, NOT TIDINESS. `data/` belongs to the agent (uid 10000, mounted rw
# inside its container), so the agent could REWRITE
# `data/scripts/portal_adapter.py`. And that file is what the `portal-adapter`
# container runs, until today as root, with `./policy` mounted rw: inside it
# are `policy.json` (the permissions the client set), `hooks/gate.py` (the
# gate) and the capabilities catalog. Meaning the agent reached every
# guardrail in two hops —write the file, wait for a restart—, exactly what the
# compose says can't happen ("a guardrail the save can change is not a
# guardrail").
#
# It now lives in `<agent>/kit-adapter/`, sibling of `kit-skills/` and
# `policy/`, which the compose mounts :ro for the adapter. And the adapter
# runs as uid 10000, not as root: verified in the lab, portal-check 14/14 and
# still writing policy.json and requests.jsonl fine.
KIT_ADAPTER="$AGENT/kit-adapter"
# THE ADAPTER STOPPED BEING ONE FILE, and a hand-written list doesn't notice.
# Since it was split into workspace/kanban/flows, `portal_adapter.py` IMPORTS
# them: uploading only the big file leaves an adapter that won't start —an
# ImportError on the flows import— and takes the board, approvals, artifacts,
# files, activity and usage down with it. It's built from the directory, like
# the hooks, so the day a fourth module shows up it travels on its own. The
# `test_*.py` files stay in the kit.
ADAPTER_PY=()
while IFS= read -r f; do
  ADAPTER_PY+=("$(basename "$f")")
done < <(find "$KIT/adapter" -maxdepth 1 -type f -name "*.py" ! -name "test_*" | sort)
[[ ${#ADAPTER_PY[@]} -gt 0 ]] || { echo "adapter/: no .py file to install" >&2; exit 1; }

FILES=(
  "connections/catalog.json:$DATA/connections/catalog.json"
  # THE CAPABILITIES CATALOG GOES TO policy/, NOT TO data/. It's the text of
  # the card the client sees: in data/ the agent —which runs as root— could
  # rewrite what its client reads about what the agent can do, and delete the
  # request log. The markdown the agent READS was already :ro in kit-skills/,
  # so it could lie to the client but not to itself.
  "capabilities/catalog.json:$POLICY/capabilities/catalog.json"
  # The pairing message patch and the cont-init that triggers it. The .sh is
  # mounted as /etc/cont-init.d/03-patches and s6 runs it on every boot,
  # before the gateway; the .py is what that script executes.
  "tools/pairing-patch.py:$POLICY/pairing-patch.py"
  "tools/cont-init-patches.sh:$POLICY/cont-init-patches.sh"
  # The MCP guard and each connection's permission: without this, a connection
  # configured in config.yaml points at a file that doesn't exist.
  "mcp-guard/guard.py:$POLICY/guard.py"
)
for m in "${ADAPTER_PY[@]}"; do
  FILES+=("adapter/$m:$KIT_ADAPTER/$m")
done
# THE OLD PATH KEEPS GETTING INSTALLED WHILE THE COMPOSE STILL USES IT. If we
# pulled `data/scripts/portal_adapter.py` out while the compose still pointed
# there, the live process keeps running (it has the file open), but a
# `docker restart` —without `compose up -d`— starts with the old entrypoint
# over a file that no longer exists: the portal crash-loops, and the client is
# left with no board and no approvals. While it's on the list it's also in
# the manifest, so the cleaner doesn't see it as obsolete. Once the compose
# points at the new place, it stops being installed, becomes obsolete, and
# leaves on its own.
AGENT_COMPOSE="$AGENT/docker-compose.yml"
if [[ -f "$AGENT_COMPOSE" ]] && grep -q '/opt/data/scripts/portal_adapter.py' "$AGENT_COMPOSE"; then
  # The modules go through the OLD path too: the import is relative to the
  # file that gets run, so an unmigrated agent that only gets the big file
  # ends up just as broken as a new one.
  for m in "${ADAPTER_PY[@]}"; do
    FILES+=("adapter/$m:$DATA/scripts/$m")
  done
fi

# The hooks are BUILT from the directory, like the skills: the day there's a
# second hook, a hand-written list leaves it out and the gate is left half
# working.
while IFS= read -r f; do
  FILES+=("policy/hooks/$(basename "$f"):$POLICY/hooks/$(basename "$f")")
done < <(find "$KIT/policy/hooks" -type f -name "*.py" ! -path "*/__pycache__/*" | sort)
# The engine's plugins, same story: the whole folder, with its plugin.yaml.
# They go to policy/ and NOT to data/plugins/ —which is where the engine looks
# for them— because data/ belongs to the agent: the compose mounts
# policy/plugins on top, read-only, so the promises guard can't be taken off.
while IFS= read -r f; do
  rel="${f#"$KIT"/policy/plugins/}"      # promises/promises.py
  FILES+=("policy/plugins/$rel:$POLICY/plugins/$rel")
done < <(find "$KIT/policy/plugins" -type f \( -name "*.py" -o -name "*.yaml" \) ! -path "*/__pycache__/*" | sort)
for c in "$KIT"/connections/*/tools.json; do
  [[ -f "$c" ]] || continue
  FILES+=("connections/$(basename "$(dirname "$c")")/tools.json:$POLICY/tools/$(basename "$(dirname "$c")").json")
done
while IFS= read -r f; do
  rel="${f#"$KIT"/connections/}"           # mercadopago/mcp/server.py
  connection="${rel%%/*}"
  FILES+=("connections/$rel:$POLICY/mcp/$connection/${rel#"$connection"/mcp/}")
done < <(find "$KIT"/connections/*/mcp -type f ! -path "*/__pycache__/*" 2>/dev/null | sort)
# WHICH SKILLS THIS AGENT GETS, AND IT IS NO LONGER "ALL OF THEM". The kit used
# to copy every skill into kit-skills/, which the compose mounts for the WHOLE
# installation -- so on a client with a team the accounting role was indexing
# the brand kit and the Instagram writer, and a skill's description is loaded on
# EVERY request. A role carrying the whole kit is the single fat agent this
# pivot exists to replace.
#
# THE MARKER IS THE ROSTER, the same file the adapter reads to decide whether
# this client has a team (`ROLES_CATALOG.is_file()` in portal_adapter.py).
# Presence, never a value someone wrote. Without it nothing changes: a pre-pivot
# client gets the whole kit exactly like yesterday.
#
# With a roster only the shared skills travel here; the craft ones arrive with
# the role that claims them (`tools/hire-role.sh` installs the profile with
# its skills inside). Who is shared and who is not is COMPUTED from the roles by
# roles/skills_split.py, not written down here: a list by hand is how two skills
# once made it into the kit and never into a new agent.
#
# WHERE EACH SKILL'S FILES ARE is no longer just `skills/<name>/`: a skill can
# ship inside a plugin, at `plugins/<id>/skills/<name>/`. It installs into the
# same `kit-skills/<name>/` either way -- in phase 1 the plugin folder is
# packaging in this repo and the agent's layout does not change
# (notes/plugin-system-plan.md) -- so the only thing that moves is where the
# source is read from, and skills_split.py is the one that knows.
SKILL_DIRS="$(python3 "$KIT/roles/skills_split.py" --dirs)"
skill_dir() { printf '%s\n' "$SKILL_DIRS" | awk -F'\t' -v n="$1" '$1 == n { print $2; exit }'; }

ROSTER="$POLICY/roles/catalog.json"
SKILLS_TO_INSTALL=()
if [[ -f "$ROSTER" ]]; then
  while IFS= read -r s; do
    SKILLS_TO_INSTALL+=("$s")
  done < <(python3 "$KIT/roles/skills_split.py" --shared)
  # If the split cannot be computed there is no safe fallback: installing
  # everything would put the craft skills back on every role, and installing
  # nothing would take the portal's screens down. Stop before writing anything.
  [[ ${#SKILLS_TO_INSTALL[@]} -gt 0 ]] || {
    echo "roles/skills_split.py didn't say which skills are shared. Installed nothing." >&2
    exit 1
  }
  # The roster is OURS and closed -- the client never writes it (the name they
  # gave a role lives beside it, in policy/roles/identities.json, and their
  # pending asks in requests.jsonl; neither is touched here, and this copies the
  # one file and not the directory). Keeping it in the install is what makes a
  # new role show up as available to a client that already has a team, instead
  # of waiting for someone to copy a file by hand.
  FILES+=("roles/catalog.json:$ROSTER")
else
  while IFS=$'\t' read -r name _; do
    SKILLS_TO_INSTALL+=("$name")
  done < <(printf '%s\n' "$SKILL_DIRS")
fi

for s in "${SKILLS_TO_INSTALL[@]}"; do
  rel_dir="$(skill_dir "$s")"              # skills/deliverable or plugins/x/skills/y
  [[ -n "$rel_dir" ]] || {
    echo "'$s' has to be installed and there is no such skill in the kit." >&2
    exit 1
  }
  source_dir="$KIT/$rel_dir"
  while IFS= read -r f; do
    inner="${f#"$source_dir"/}"            # SKILL.md, scripts/verify_rows.py
    FILES+=("$rel_dir/$inner:$KIT_SKILLS/$s/$inner")
  done < <(find "$source_dir" -type f \( -name "*.md" -o -name "*.py" \) \
    ! -path "*/evals/*" | sort)
done
# evals/ do NOT travel on purpose: they're ours, to test the skill before
# shipping it. Nobody runs them inside the agent and they only cost prompt
# space and disk.

shorten() { echo "${1#"$AGENT"/}"; }        # readable paths in the messages

# The manifest of what got installed: <path relative to the agent><TAB><sha256>.
# It is the list of files WE WRITE, and it exists for exactly one thing: being
# able to remove the ones the kit stopped bringing without touching anything
# else.
#
# It's the difference between "delete everything not in the source" —which is
# how you delete a client's own work— and "delete what you put there and no
# longer bring." A client's file is NEVER in the manifest, so there's no way
# for it to enter the set of deletion candidates: it's not that we exclude it,
# it's that it can't be there. And even while there, it only gets deleted if
# its sha256 still matches what we wrote: if someone edited it, it gets
# reported and left alone.
#
# `policy/policy.json` is the example of why: it lives in a folder that's 100%
# ours but the client writes it (their permissions), same as
# `policy/capabilities/requests.jsonl`. Neither one is in the manifest, and
# that's why neither one is ever at risk.
MANIFEST="$AGENT/.kit-installed"

sha() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

if [[ "$MODE" == "--diff" ]]; then
  different=0
  for pair in "${FILES[@]}"; do
    source_path="$KIT/${pair%%:*}"; dest="${pair##*:}"
    if [[ ! -f "$dest" ]]; then
      echo "MISSING  $(shorten "$dest")"; different=$((different+1))
    elif ! diff -q "$source_path" "$dest" >/dev/null; then
      echo "DIFFERENT $(shorten "$dest")"
      diff -u "$source_path" "$dest" | sed 's/^/    /' | head -20
      different=$((different+1))
    fi
  done
  # WHAT THIS AGENT GETS, not the kit's whole catalog -- same list the copy uses
  # below. On a team agent `brand-kit` is not shipped here, so a directory by
  # that name under data/skills/ is the CLIENT's, and calling it "an old copy
  # shadowing the kit's" is a lie that ends with us moving it away.
  for s in "${SKILLS_TO_INSTALL[@]}"; do
    old="$DATA/skills/$s"
    [[ -d "$old" ]] && { echo "EXTRA    data/skills/$s — old copy, shadows the kit's"; different=$((different+1)); }
  done
  # What the kit installed at some point and no longer brings: the install is
  # going to remove it (if it's still exactly what we left) or report it (if
  # someone edited it).
  if [[ -f "$MANIFEST" ]]; then
    expected="$(mktemp)"
    { for pair in "${FILES[@]}"; do echo "${pair##*:}" | sed "s|^$AGENT/||"; done
      echo "data/skills/.kit_manifest"; } | sort > "$expected"
    while IFS=$'\t' read -r path _; do
      [[ -n "${path:-}" && -f "$AGENT/$path" ]] || continue
      echo "OBSOLETE $path — the kit no longer brings it; the install removes it"
      different=$((different+1))
    done < <(awk -F'\t' 'NR==FNR { seen[$0]=1; next } !($1 in seen)' "$expected" "$MANIFEST")
    rm -f "$expected"
  fi
  if [[ $different -eq 0 ]]; then
    echo "The agent is up to date with the kit."
  else
    echo
    echo "$different different file(s). If the good change is in the agent,"
    echo "copy it into the kit before installing, or you're about to overwrite it."
  fi
  exit 0
fi

# NOTHING GETS COPIED THAT CAN'T BE OURS, and it's validated BEFORE the first
# file gets written: if this aborted halfway through the loop, the agent would
# be left with half the kit installed. The list of prefixes lives in the
# cleaner —the one that deletes afterward— and gets asked for once, so there
# aren't two copies that drift apart.
PREFIXES="$("$KIT/tools/clean-obsolete.sh" --prefixes)"
for pair in "${FILES[@]}"; do
  path="${pair##*:}"; path="${path#"$AGENT"/}"
  ok=0
  while IFS= read -r pref; do
    case "$pref" in
      */) [[ "$path" == "$pref"* ]] && { ok=1; break; } ;;
      *)  [[ "$path" == "$pref"  ]] && { ok=1; break; } ;;
    esac
  done <<< "$PREFIXES"
  if [[ $ok -eq 0 ]]; then
    echo "The kit was about to install '$path', which is not a path the kit" >&2
    echo "is allowed to own. Two causes, and the first is the most common:" >&2
    echo "  · the agent path is wrong — check that '$DATA' really is the" >&2
    echo "    agent's data/ (watch the case: on the Mac 'Data' and 'data'" >&2
    echo "    are the same directory and this comes out different);" >&2
    echo "  · the kit started installing somewhere new, in which case the path" >&2
    echo "    (with its reason) goes into ALLOWED_PREFIXES, in tools/clean-obsolete.sh." >&2
    echo "Installed nothing." >&2
    exit 1
  fi
done

for pair in "${FILES[@]}"; do
  source_path="$KIT/${pair%%:*}"; dest="${pair##*:}"
  mkdir -p "$(dirname "$dest")"
  # THE DESTINATION GETS DELETED BEFORE COPYING, and it's not for tidiness:
  # `cp` FOLLOWS the destination's symlink and writes on the other side. The
  # agent runs as root with /opt/data writable, so it's enough for it to leave
  # `data/scripts/portal_adapter.py -> data/state.db` for the next install to
  # write the adapter's code RIGHT INTO its own database. Tested: it happens.
  # (The remote path is immune because rsync replaces the symlink; the local
  # one wasn't.) `cp --remove-destination` doesn't exist on the Mac and
  # `install -T` doesn't either, so it gets deleted by hand, which works on
  # both sides.
  rm -f "$dest"
  cp "$source_path" "$dest"
  echo "installed $(shorten "$dest")"
done

# MIGRATION: the old copy inside data/skills/ SHADOWS the kit-skills one.
# The engine resolves by local directory first (agent/skill_utils.py:566-574,
# tools/skill_manager_tool.py:645-662) and the prompt index skips the external
# one if it already saw that name (agent/prompt_builder.py:1738-1760). In
# other words: with both present, the agent keeps using the old one and this
# install.sh has no effect, with not a single error message. It doesn't get
# deleted —it gets set aside— because deleting someone's work is not
# idempotent.
#
# And it gets set aside OUTSIDE data/skills/, which is the only thing that
# counts: the engine indexes that whole tree and only skips the names in
# EXCLUDED_SKILL_DIRS (agent/skill_utils.py:26-44). A directory starting with
# a dot is NOT enough —`.archive` is on that list, `.whatever` isn't—, so
# "setting aside" inside data/skills/ leaves the old copy indexed and still
# shadowing. It goes to a sibling of data/.
# It's searched for across the WHOLE tree, not just data/skills/<name>: a copy
# under a category (data/skills/productivity/flujo/) shadows just the same,
# and it's what agent-check reports. Directories the engine also doesn't index
# (EXCLUDED_SKILL_DIRS) get skipped: whatever is in .archive/ is already out of
# play.
#
# IT WALKS THIS AGENT'S SELECTION AND NOT THE KIT'S CATALOG, and the difference
# is whose file it is. Setting a directory aside is justified by one sentence:
# there are two copies of THE SAME skill and the one in data/ shadows ours. On a
# team agent the kit does not ship `brand-kit` here -- it travels inside
# marketing's profile -- so a `data/skills/brand-kit` shadows nothing: it is the
# client's. Walking the whole catalog confiscated a client's own skill and told
# them it was shadowing a kit skill this agent is never going to receive.
SET_ASIDE_DIR="$AGENT/shadowed-skills"
set_aside_count=0
for name in "${SKILLS_TO_INSTALL[@]}"; do
  while IFS= read -r old; do
    [[ -f "$old/SKILL.md" ]] || continue
    rel="${old#"$DATA"/skills/}"
    mkdir -p "$SET_ASIDE_DIR/$(dirname "$rel")"
    # SETTING ASIDE NEVER OVERWRITES SOMETHING ALREADY SET ASIDE. There used to
    # be an `rm -rf` on the destination here, and with that the SECOND
    # collision on the same name destroyed what the first one had saved: the
    # agent recreates `data/skills/entregable`, the install sets it aside, and
    # months of work that was sitting set aside underneath vanishes with no
    # trace anywhere in the tree. Measured. If the spot is taken, the new copy
    # goes next to it with the date, and if even that collides, nothing gets
    # touched and it's reported: losing work is not an option, having two
    # folders is.
    aside="$SET_ASIDE_DIR/$rel"
    if [[ -e "$aside" ]]; then
      aside="$SET_ASIDE_DIR/$rel.$(date +%Y%m%d-%H%M%S)"
    fi
    if [[ -e "$aside" ]]; then
      echo "HEADS UP: didn't set aside data/skills/$rel — one is already set aside and"
      echo "          another has the same timestamp. Check shadowed-skills/ and remove the extra one."
      continue
    fi
    mv "$old" "$aside"
    echo "set aside data/skills/$rel → $(shorten "$aside") (was shadowing the kit's)"
    set_aside_count=$((set_aside_count+1))
  done < <(find "$DATA/skills" \
             \( -name .archive -o -name .git -o -name .github -o -name .hub \
                -o -name node_modules -o -name __pycache__ -o -name .venv \) -prune -o \
             -type d -name "$name" -print 2>/dev/null)
done

# Folders the kit takes for granted (the portal reads them, the skills write
# to them).
for folder in workspace/entregables workspace/artifacts workspace/entrada workspace/interno; do
  mkdir -p "$DATA/$folder"
done

# THE EXECUTABLE BITS IN policy/. The engine runs the hooks with its own
# interpreter, but `cont-init-patches.sh` gets run by s6 by path: without the
# execute bit the patch never applies and —since the cont-init is the only
# thing that triggers it— the client gets the pairing message in English with
# not a single error in the log.
chmod +x "$POLICY"/hooks/*.py "$POLICY/cont-init-patches.sh"

# The guard's policy. Created EMPTY if missing, never overwritten: this is
# where each client's toggles get written, and it belongs to the agent, not
# the kit.
[[ -s "$POLICY/policy.json" ]] || { echo '{}' > "$POLICY/policy.json"; echo "created policy/policy.json"; }

# MIGRATION of the capabilities catalog, which used to install into data/. It
# only gets deleted if it's IDENTICAL to the kit's —i.e. ours and untouched—:
# an old file at the path the adapter no longer reads is a trap for whoever
# comes to debug it. If someone edited it, it gets reported and left alone:
# deleting someone else's work is not idempotent.
OLD="$DATA/capacidades/catalogo.json"
if [[ -f "$OLD" ]]; then
  if diff -q "$KIT/capabilities/catalog.json" "$OLD" >/dev/null 2>&1; then
    rm -f "$OLD"; rmdir "$DATA/capacidades" 2>/dev/null || true
    echo "removed data/capacidades/catalogo.json (now lives in policy/, read-only)"
  else
    echo "HEADS UP: data/capacidades/catalogo.json has been edited and is no longer read (the good one is policy/capabilities/catalog.json)"
  fi
fi

# Manifest of WHICH skills belong to the kit. The adapter uses it to tell the
# "tuagente product" ones (common to everyone, hold up portal tabs, not
# editable from there) apart from the ones made for THIS client (editable).
# Without this, every skill looks like the client's and the portal offers to
# edit the one that holds up the deliveries tab.
#
# IT IS WHAT THIS AGENT GOT, not the kit's whole catalog: on a team agent
# `brand-kit` lives inside marketing's profile and not here. The adapter adds
# the hired roles' skills when it builds the list (`_kit_names`), so a craft
# skill still counts as ours -- and a capability detected by `kit_skill` does
# not tell the client "you already have this" about something that is nowhere.
mkdir -p "$DATA/skills"
printf '%s\n' "${SKILLS_TO_INSTALL[@]}" > "$DATA/skills/.kit_manifest"
echo "installed data/skills/.kit_manifest"

if [[ -f "$ROSTER" ]]; then
  echo "team: kit-skills/ got the shared ones (${SKILLS_TO_INSTALL[*]})"
  echo "      the craft ones travel with each role: tools/hire-role.sh <role> <agent>"
  # OUT LOUD, because the alternative is a skill that reaches nobody: a skill in
  # the kit that no role claims and that is not a fallback note has no way into
  # a team agent. Either a role declares it or it does not exist for this client.
  #
  # A BANNER IS NOT WORTH ABORTING FOR, and under `set -euo pipefail` this
  # assignment was: the install had already copied every file, and a failure
  # here died before writing the manifest -- leaving the agent installed and the
  # cleanup never run. The install was already gated on `--shared` succeeding,
  # up where it still could stop without writing anything; this second call only
  # decorates the output. If it fails, no banner.
  orphaned="$(python3 "$KIT/roles/skills_split.py" --orphan | tr '\n' ' ')" || orphaned=""
  [[ -z "${orphaned// }" ]] || echo "        no owner (no role brings them): ${orphaned% }"
fi


# The manifest of what we installed, and the cleanup of what the kit stopped
# bringing. Built AFTER copying everything, with the sha256 of what ended up
# written. `data/skills/.kit_manifest` goes in too: we're the ones who generate
# it, and if it ever stopped being generated, it has to leave along with
# everything else.
{
  for pair in "${FILES[@]}"; do
    dest="${pair##*:}"
    printf '%s\t%s\n' "${dest#"$AGENT"/}" "$(sha "$dest")"
  done
  printf '%s\t%s\n' "data/skills/.kit_manifest" "$(sha "$DATA/skills/.kit_manifest")"
} | sort > "$MANIFEST.new"

# (Paths were already validated against ALLOWED_PREFIXES before copying anything.)
"$KIT/tools/clean-obsolete.sh" "$AGENT"

# And the keys come out of data/, which belongs to the agent. The script does
# nothing if they're already out, and doesn't move them if the compose still
# names them there (that would leave the agent unable to start): in that case
# it reports it and migrates on the next run.
"$KIT/tools/migrate-secrets.sh" "$AGENT"

# NOBODY UPDATES THE COMPOSE OF AN AGENT THAT ALREADY EXISTS. The remote one
# does —the deployment re-uploads it from the template on every run—, but a
# local agent's is a copy made on onboarding day. If it still starts the
# adapter from data/, this install just took that file out from under it and
# the container is going to die on the next restart. It reports what needs to
# change, verbatim.
COMPOSE="$AGENT/docker-compose.yml"
if [[ -f "$COMPOSE" ]] && grep -q '/opt/data/scripts/portal_adapter.py' "$COMPOSE"; then
  cat <<NOTICE

HEADS UP: $COMPOSE still starts the adapter from data/, which belongs to the
agent. The code is no longer there (it now lives in kit-adapter/, mounted
read-only), so the container is going to die on the next restart. Change the
portal-adapter service:

    entrypoint: ["python3", "/opt/kit/adapter/portal_adapter.py"]
    user: "10000:10000"
    volumes:
      - ./kit-adapter:/opt/kit/adapter:ro     ← add

and then: docker compose up -d portal-adapter

(It's already like this in compose/docker-compose.example.yml, with the why
right next to it.)
NOTICE
fi

# Same story with the plugin's mount: the file is already in policy/plugins/,
# but the engine looks for them at /opt/data/plugins. Without the line, the
# promises guard ends up installed and off — which is worse than not having
# it, because `fleet.md` is going to say it's there.
if [[ -f "$COMPOSE" ]] && ! grep -q 'policy/plugins:/opt/data/plugins' "$COMPOSE"; then
  cat <<NOTICE

HEADS UP: $COMPOSE doesn't mount the `promises` plugin. It's what stops the
agent from announcing a flow it didn't create, and without the mount it never
loads. Add this to the hermes service:

    volumes:
      - ./policy/plugins:/opt/data/plugins:ro     ← add

and to data/config.yaml (if it isn't there):

    plugins:
      enabled:
        - promises

and then: docker compose up -d hermes   (a \`restart\` isn't enough: it's a new
mount). Checked by tools/agent-check.py.
NOTICE
fi

if [[ $set_aside_count -gt 0 ]]; then
  cat <<NOTICE

HEADS UP: set aside $set_aside_count skill(s) that were duplicated in
data/skills/. That directory wins over the external one, so up to now the
agent was running the old copy. They're left in $SET_ASIDE_DIR/
—outside the tree the engine indexes—: check that nothing hand-made is in
there and delete them once you're sure.
NOTICE
fi

cat <<'DONE'

Installed. What's left to do by hand:

  0. The compose has to mount the kit's skills read-only and the config has
     to declare them, or the agent won't see them:
       volumes:  - ./kit-skills:/opt/kit/skills:ro     (hermes and portal-adapter)
       config:   skills.external_dirs: ["/opt/kit/skills"]
     Both already come set in compose/ and in compose/config.base.yaml.

  1. Compose the SOUL from the blocks in soul/ (see soul/README.md).
     Without that the agent has the tools but not the rules.
  1b. Turn on kanban's native tools in data/config.yaml. BOTH keys are
      needed; with only one the agent sees none of them:
        toolsets:
          - kanban
        platform_toolsets:
          api_server: [hermes-api-server, kanban]
          telegram:   [hermes-telegram, kanban]
          cron:       [hermes-cron, kanban]
      Without this the agent can't touch its own tickets (it improvises with
      Python and fails). Requires restarting the gateway.
  2. In the docker-compose: AGENT_NAME, TZ and both CORS lists
     (API_SERVER_CORS_ORIGINS and PORTAL_CORS_ORIGINS).
  3. Check data/ BEFORE starting it up:
       python3 tools/agent-check.py <path>/data
     Catches the classic onboarding oversights (a SOUL with gaps, skills
     with no frontmatter, an empty default model) without having to bring
     anything up.
  4. docker compose up -d
  5. Check the contract with the portal, now that it's running:
       python3 tools/portal-check.py --key <API_SERVER_KEY>
     0 failures or it doesn't ship.

Skills take a few minutes to show up in the agent's index: that's normal,
Hermes reindexes on its own once it sees the new files.
DONE
