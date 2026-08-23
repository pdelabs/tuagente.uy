#!/usr/bin/env bash
# Do a LOCAL agent and a REMOTE one get exactly the same kit?
#
#   tools/compare-installers.sh
#
# Builds two fake agents in /tmp —one with `install.sh`, the local path, and
# another with `deploy-remote.sh --local-dest`, the VPS path— and compares the
# two trees file by file, by path and by sha256. Any difference is a failure.
#
# WHY THIS EXISTS. For months there were two installers for the same kit with
# two hand-written lists, and they diverged four times without anything
# failing:
#
#   - the capabilities catalog never reached ANY remote agent — meaning the
#     whole feature was dead on real clients, not in testing;
#   - the pairing patch never reached local ones: the client got the bot's
#     first message in English, asking them to run a terminal command right
#     when the portal was telling them "paste the code here";
#   - `HERMES_DASHBOARD=0` got fixed in the remote compose and never made it
#     into the onboarding template: crash-loop 27 times a minute on every
#     local agent;
#   - `.kit_manifest` and the workspace folders, on only one of the two.
#
# All the same signature: nothing breaks, nobody notices, the client gets a
# worse version. The real fix was to keep ONE installer —the deployer runs
# install.sh against a staging dir and uploads that—, but a fix that depends
# on nobody ever adding a hand-written line again isn't finished. This is what
# turns that drift into a loud failure.
#
# ⚠️ THIS DOES NOT VALIDATE THE PROTOCOL, AND IT'S NOT A DETAIL. It runs the
# deployer with `--local-dest`, i.e. rsync in local mode, and the Mac's rsync
# is **openrsync**, not the VPS's GNU one. The two don't behave the same:
# `--no-implied-dirs` passed this check with rc=0 and "29 identical files"
# while breaking the remote deployment 100% (GNU aborts the whole transfer,
# rc=2, zero files, the agent with no adapter, no policy/, no kit-skills).
# What's validated here is WHICH files go and with what content.
# **Any rsync option gets tested with `tools/test-remote-deploy-ssh.sh`, which
# deploys against a real sshd with GNU's rsync.**
set -uo pipefail

KIT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BENCH="$(mktemp -d)"
trap 'rm -rf "$BENCH"' EXIT

sha() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

echo "test bench: $BENCH"
echo

# ── the LOCAL path: install.sh against an agent's data/ ───────────────────
LOCAL_AGENT="$BENCH/local"
mkdir -p "$LOCAL_AGENT/data"
"$KIT/install.sh" "$LOCAL_AGENT/data" > "$BENCH/local-output.txt" 2>&1 || {
  echo "FAILURE: install.sh could not install"; sed 's/^/   /' "$BENCH/local-output.txt"; exit 1; }
echo "local path:  $(wc -l < "$LOCAL_AGENT/.kit-installed" | tr -d ' ') files"

# ── the REMOTE path: the deployer against a directory ──────────────────────
REMOTE_ROOT="$BENCH/remote"
"$KIT/deploy-remote.sh" test --local-dest "$REMOTE_ROOT" example.local \
  > "$BENCH/remote-output.txt" 2>&1 || {
  echo "FAILURE: the deployer could not deploy"; sed 's/^/   /' "$BENCH/remote-output.txt"; exit 1; }
REMOTE_AGENT="$REMOTE_ROOT/opt/agentes/test"
echo "remote path: $(wc -l < "$REMOTE_AGENT/.kit-installed" | tr -d ' ') files"
echo

# ── the comparison ──────────────────────────────────────────────────────────
failures=0

# 1. The manifests, which are the list of what each path claims to have put.
if ! diff -q "$LOCAL_AGENT/.kit-installed" "$REMOTE_AGENT/.kit-installed" >/dev/null; then
  echo "FAILURE: the two paths install different things —"
  diff "$LOCAL_AGENT/.kit-installed" "$REMOTE_AGENT/.kit-installed" \
    | grep '^[<>]' | sed 's/^</   LOCAL only : /; s/^>/   REMOTE only: /' | cut -c1-100
  failures=$((failures+1))
fi

# 2. And the actual files, not just what the manifest promises: every path in
#    the union of the two, compared by content in both trees.
while IFS= read -r rel; do
  a="$LOCAL_AGENT/$rel"; b="$REMOTE_AGENT/$rel"
  if [[ ! -f "$a" ]]; then echo "FAILURE: missing in the LOCAL agent:  $rel"; failures=$((failures+1)); continue; fi
  if [[ ! -f "$b" ]]; then echo "FAILURE: missing in the REMOTE agent: $rel"; failures=$((failures+1)); continue; fi
  if [[ "$(sha "$a")" != "$(sha "$b")" ]]; then
    echo "FAILURE: different content: $rel"; failures=$((failures+1)); continue
  fi
  # The execute bit counts: without it, s6 doesn't run `cont-init-patches.sh`
  # and the client gets the pairing message in English, with no error in the
  # log.
  if [[ -x "$a" && ! -x "$b" ]] || [[ ! -x "$a" && -x "$b" ]]; then
    echo "FAILURE: different permissions (one is executable and the other isn't): $rel"; failures=$((failures+1))
  fi
done < <(cut -f1 "$LOCAL_AGENT/.kit-installed" "$REMOTE_AGENT/.kit-installed" | sort -u)

# 2b. The actual TREES, not just what the manifests promise. Without this, a
#     hand-added line in the deployer —one extra `rsync`— puts a file on the
#     client's agent that the local path doesn't have, and no manifest ever
#     notices. The only thing allowed to differ is what belongs to a VPS: the
#     compose, the Caddyfile, the .env files and config.yaml.
# `secrets.env` is here and `data/.env` is NOT: the keys moved out of data/ (it
# was code execution inside the adapter, see PENDING). If a data/.env ever
# reappears, this check should complain.
DEPLOY_ONLY="docker-compose.yml Caddyfile .env data/config.yaml secrets.env"
tree() { (cd "$1" && find . -type f | sed 's|^\./||' | sort); }
tree "$LOCAL_AGENT" > "$BENCH/local-tree.txt"
printf '%s\n' $DEPLOY_ONLY | sort > "$BENCH/deploy-only.txt"
tree "$REMOTE_AGENT" | comm -23 - "$BENCH/deploy-only.txt" > "$BENCH/remote-tree.txt"
while IFS= read -r extra; do
  [[ -n "$extra" ]] || continue
  echo "FAILURE: the deployment put a file the local installer doesn't put: $extra"
  echo "         (did someone add a hand-written line back into deploy-remote.sh?)"
  failures=$((failures+1))
done < <(comm -13 "$BENCH/local-tree.txt" "$BENCH/remote-tree.txt")
while IFS= read -r missing; do
  [[ -n "$missing" ]] || continue
  echo "FAILURE: the local installer puts a file that never reaches the remote one: $missing"
  failures=$((failures+1))
done < <(comm -23 "$BENCH/local-tree.txt" "$BENCH/remote-tree.txt")

# 3. The folders the kit takes for granted that aren't files: if the remote
#    one doesn't create them, the skills write into a place that doesn't
#    exist.
while IFS= read -r d; do
  [[ -d "$REMOTE_AGENT/$d" ]] || { echo "FAILURE: the REMOTE agent has no $d/ folder"; failures=$((failures+1)); }
done < <(cd "$LOCAL_AGENT" && find . -type d -empty | sed 's|^\./||' | sort)

# 3b. THE TRAILING SLASH. `install.sh <agent>/data/` —the one tab-completion
#     adds— has to give the SAME manifest as without the slash. When it
#     didn't, the paths came out as `data//scripts/portal_adapter.py`, the
#     next run saw them as obsolete, they resolved to the just-installed
#     file, the sha matched, and the cleaner DELETED the portal adapter: the
#     whole :8643 service, silently and with rc=0. It's fixed by normalizing
#     `DATA` with `cd && pwd`; this is here so it doesn't come back.
SLASH="$BENCH/slash"
mkdir -p "$SLASH/data"
"$KIT/install.sh" "$SLASH/data/" > "$BENCH/slash-output.txt" 2>&1 || {
  echo "FAILURE: install.sh with a trailing slash finished with an error"; sed 's/^/   /' "$BENCH/slash-output.txt"
  failures=$((failures+1)); }
if [[ -f "$SLASH/.kit-installed" ]]; then
  if ! diff -q <(cut -f1 "$LOCAL_AGENT/.kit-installed") <(cut -f1 "$SLASH/.kit-installed") >/dev/null; then
    echo "FAILURE: the manifest changes depending on whether the path is passed with or without a trailing slash —"
    diff <(cut -f1 "$LOCAL_AGENT/.kit-installed") <(cut -f1 "$SLASH/.kit-installed") | grep '^[<>]' | sed 's/^/   /'
    failures=$((failures+1))
  fi
  # And the second run, the one that used to delete things: without a slash
  # over what was installed with one.
  "$KIT/install.sh" "$SLASH/data" > "$BENCH/slash2-output.txt" 2>&1
  for essential in kit-adapter/portal_adapter.py data/connections/catalog.json; do
    [[ -f "$SLASH/$essential" ]] || {
      echo "FAILURE: the second run deleted $essential"; failures=$((failures+1)); }
  done
fi

# 4. What must NEVER travel.
if [[ -f "$REMOTE_AGENT/policy/policy.json" ]]; then
  content="$(tr -d '[:space:]' < "$REMOTE_AGENT/policy/policy.json")"
  [[ "$content" == "{}" ]] || { echo "FAILURE: the staging's policy.json traveled with content"; failures=$((failures+1)); }
fi
if grep -qxF "policy/policy.json" <(cut -f1 "$LOCAL_AGENT/.kit-installed"); then
  echo "FAILURE: policy.json made it into the manifest — the deployment would overwrite the client's"
  failures=$((failures+1))
fi

echo
if [[ $failures -eq 0 ]]; then
  echo "Both paths install the same thing: $(wc -l < "$LOCAL_AGENT/.kit-installed" | tr -d ' ') identical files."
  exit 0
fi
echo "$failures divergence(s) between the local installer and the remote deployment."
echo "Both have to put the same thing: the kit is installed in exactly one place"
echo "(install.sh) and the deployer uploads THAT. If you added something to only one, take it out."
exit 1
