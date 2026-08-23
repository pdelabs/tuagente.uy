#!/usr/bin/env bash
# Removes from an agent the files the kit stopped bringing. And NOTHING ELSE.
#
#   tools/clean-obsolete.sh <agent-root>
#
# Reads two files from that root:
#   .kit-installed        what the kit installed last time (path<TAB>sha256)
#   .kit-installed.new    what was just installed
# deletes the ones that were in the old one and are no longer in the new one,
# and leaves the new one as the current manifest.
#
# WHY THIS EXISTS, AND WHY IT ISN'T AN `rsync --delete`
#
# The obvious way to clean up the old stuff is to mirror the folder: "delete
# everything not in the source." It's also the obvious way to delete a
# client's work, and it doesn't take much to get it wrong: it's enough for the
# source to come out empty because of an error, or for someone to add `data/`
# to the list of mirrored folders, or to not know that inside a folder that's
# 100% ours (`policy/`) the adapter writes `policy.json` and
# `capabilities/requests.jsonl`, which belong to the client.
#
# Here the set of deletion candidates isn't computed by diffing against a
# directory: it comes from the manifest, i.e. the files WE WRITE. A client's
# file can never be in that list — it's not that we exclude it, it's that we
# never put it there. And of the ones that ARE there, only the one whose
# sha256 still matches what we wrote gets deleted: if someone edited it, it
# gets reported and left alone, because deleting someone else's work is not
# idempotent.
#
# Runs the same way on the Mac (local install) and on the VPS (over ssh, with
# the script coming in through stdin): it's a single implementation, which is
# exactly the point of this whole change.
set -euo pipefail

# THE ONLY THING THE KIT CAN OWN, and therefore the only thing this script can
# ever delete. The manifest is a text file, i.e. DATA, and until today it was
# absolute authority: whatever was written there with the right sha got
# deleted, no matter whose it was. The README promised a client's file "isn't
# excluded, it just can't be there" — this is what makes that true. Four lines
# added by hand to the manifest were enough to delete `state.db`,
# `policy.json`, `requests.jsonl` and a deliverable; with this list, those four
# paths aren't even candidates.
#
# Today the manifest lives at the agent's root, which no container mounts, so
# the agent can't reach it. But the path arithmetic behind it already failed
# once (the trailing slash on `install.sh <data>/`, which made the cleaner eat
# the adapter), and a defense that depends on paths always being computed
# right is not a defense.
#
# If the kit starts installing somewhere new, it gets added HERE with its
# reason. The list is of EXACT FILES except where the whole folder is ours,
# and that's on purpose: whatever isn't listed doesn't get touched. `policy/`
# on its own would be a mistake — inside it live `policy.json` (the
# permissions the client set) and `capabilities/requests.jsonl` (the requests
# they made), both written by the adapter at runtime. By listing inward, those
# two are never candidates because we never name them.
ALLOWED_PREFIXES=(
  "kit-adapter/"                      # the portal adapter's code
  # Where the adapter lived until 12/8. Still on the list SO IT CAN BE REMOVED:
  # the agent could rewrite it (data/ is theirs) and the container ran it as
  # root with policy/ mounted rw. Migrating agents that already exist is
  # exactly this: the new path gets installed and this one deletes itself,
  # because it's in the old manifest and no longer in the new one. Once no
  # agent is left with an adapter in data/scripts/, this line goes away.
  "data/scripts/portal_adapter.py"
  "data/connections/catalog.json"     # the connections catalog
  "data/skills/.kit_manifest"         # which skills belong to the product
  "policy/guard.py"                   # the MCP guard
  "policy/pairing-patch.py"           # the pairing message patch
  "policy/cont-init-patches.sh"       # the cont-init that triggers it
  "policy/capabilities/catalog.json"  # HEADS UP: requests.jsonl, right next to it, is the client's
  # The roster: which roles exist and what each one does. Ours and closed --
  # the client never writes it (the name they chose lives in identities.json)
  # -- and it is only installed on an agent that ALREADY has a team. The exact
  # file and not `policy/roles/`: whatever the client decides will live next
  # to it.
  "policy/roles/catalog.json"
  "policy/hooks/"                     # the gate, in code
  "policy/plugins/"                   # the engine's plugins (the promises guard)
  "policy/tools/"                     # each connection's permission, for the guard
  "policy/mcp/"                       # the MCP servers
  "kit-skills/"                       # the kit's skills (mounted :ro, nobody else writes)
)

if [[ "${1:-}" == "--prefixes" ]]; then
  # So install.sh validates against the SAME list, not a copy.
  printf '%s\n' "${ALLOWED_PREFIXES[@]}"
  exit 0
fi

ROOT="${1:-}"
[[ -n "$ROOT" && -d "$ROOT" ]] || { echo "usage: $0 <agent-root>" >&2; exit 2; }
ROOT="$(cd "$ROOT" && pwd)"

OLD="$ROOT/.kit-installed"
NEW="$ROOT/.kit-installed.new"
[[ -f "$NEW" ]] || { echo "missing $NEW: nothing to make current" >&2; exit 2; }

sha() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

is_allowed() {   # $1 = manifest-relative path
  local path="$1" p
  for p in "${ALLOWED_PREFIXES[@]}"; do
    case "$p" in
      */) [[ "$path" == "$p"* ]] && return 0 ;;
      *)  [[ "$path" == "$p"  ]] && return 0 ;;
    esac
  done
  return 1
}

is_where_it_says() {     # $1 = manifest-relative path
  # "Falls inside the agent" isn't enough: it has to fall EXACTLY where the
  # path says. With `policy/hooks` replaced by a symlink to
  # `data/workspace/entregables`, the target was still inside the agent and
  # the deletion took a client deliverable down with it. The RESOLVED parent
  # gets compared against the LITERAL parent: if they differ, there's a
  # symlink in some path component and it isn't the file we think it is.
  local abs="$REAL_ROOT/$1" literal resolved
  literal="$(dirname "$abs")"
  resolved="$(cd "$literal" 2>/dev/null && pwd -P)" || return 1
  [[ "$resolved" == "$literal" ]]
}

REAL_ROOT="$(cd "$ROOT" && pwd -P)"
removed=0
kept_edited=0

if [[ -f "$OLD" ]]; then
  # The ones that were there and no longer are. Compared by PATH (field 1),
  # not by line: a file that's still shipped but changed content is not
  # obsolete.
  while IFS=$'\t' read -r path hash; do
    [[ -n "${path:-}" ]] || continue

    # The manifest is a file, i.e. it's data, and data doesn't get obeyed: an
    # absolute path or one with `..` would point outside the agent. Discarded.
    case "$path" in
      /*|*..*) echo "HEADS UP: suspicious path in the manifest, skipping it: $path" >&2; continue ;;
    esac

    # And even if it's listed: only what the kit COULD have put there gets
    # touched, and only if it's still inside the agent after resolving the
    # path's symlinks. Both together are what makes it impossible for a
    # client's file to enter the candidate set, even if added by hand.
    if ! is_allowed "$path"; then
      echo "HEADS UP: the manifest names '$path', which is not a path the kit"
      echo "          installs. Not touching it. (If the kit started installing"
      echo "          there, the path goes into ALLOWED_PREFIXES, in tools/clean-obsolete.sh.)"
      continue
    fi

    dest="$ROOT/$path"
    [[ -f "$dest" ]] || continue          # already gone: nothing to do
    if [[ -L "$dest" ]]; then
      echo "HEADS UP: $path is a symlink, and the kit doesn't install symlinks — leaving it"
      continue
    fi
    if ! is_where_it_says "$path"; then
      echo "HEADS UP: $path is not where it says (there's a symlink along the way) — leaving it"
      continue
    fi

    current="$(sha "$dest")"
    if [[ "$current" != "$hash" ]]; then
      echo "HEADS UP: $path is no longer shipped by the kit BUT it's been edited — leaving it"
      kept_edited=$((kept_edited+1))
      continue
    fi
    rm -f "$dest"
    echo "removed  $path (the kit no longer brings it)"
    removed=$((removed+1))

    # And whatever directory is left empty, up to but not including the
    # agent's root: an empty folder from a connection we took out confuses
    # whoever looks at it.
    dir="$(dirname "$dest")"
    while [[ "$dir" != "$ROOT" && "$dir" != "/" ]]; do
      rmdir "$dir" 2>/dev/null || break
      dir="$(dirname "$dir")"
    done
    # The old manifest's lines whose PATH is not in the new one.
  done < <(awk -F'\t' 'NR==FNR { seen[$1]=1; next } !($1 in seen)' "$NEW" "$OLD")
fi

mv "$NEW" "$OLD"

if [[ $removed -gt 0 || $kept_edited -gt 0 ]]; then
  echo "cleanup: $removed removed, $kept_edited edited and left as-is"
fi
