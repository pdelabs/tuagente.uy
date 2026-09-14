#!/usr/bin/env bash
# Moves an agent's keys out of `data/.env` into `<agent>/secrets.env`.
#
#   tools/migrate-secrets.sh <agent-root>
#
# WHY. `data/` belongs to the agent: it runs as root inside its container and
# has it mounted rw, so it can write any file in there. And `data/.env` used
# to be the `env_file` for BOTH services. With that, the agent wasn't
# "redirecting directories": it was executing CODE INSIDE THE ADAPTER.
# Measured against the real image, the adapter as uid 10000 with its code
# mounted :ro —
#
#   data/.env: PYTHONPATH=/opt/data/evil   →   /opt/data/evil/<module>.py shadows
#   a stdlib module   →   "THE AGENT'S CODE RUNNING INSIDE THE ADAPTER"
#
# — and from that process, which has `policy/` in RW, `hooks/gate.py` (the
# gate, so it would let everything through) and `cont-init-patches.sh` —which
# hermes mounts as `/etc/cont-init.d/03-patches` and **s6 runs as root** on
# every boot— got rewritten. Two hops and the agent is root in the other
# container. The secrets file can't live where the agent writes.
#
# WHAT IT DOES: moves `data/.env` → `secrets.env` (root:root 600 when
# possible). In the normal case it moves the WHOLE thing, byte for byte,
# without rewriting it: that way there's no way to split a multi-line value or
# lose a variable. It only filters if it finds something from the DANGEROUS
# list below, and in that case it leaves the original at `data/.env.unmigrated`
# instead of deleting it. It's idempotent and does NOT overwrite an existing
# `secrets.env`.
#
# WHAT IT DOESN'T DO, ON PURPOSE: it doesn't move anything if the agent's
# compose still declares `./data/.env` as its env_file. Moving the file out
# from under a compose that names it leaves the agent unable to start ("env
# file not found"), and a guardrail that takes the client down doesn't get
# installed. In that case it reports it and stops: the compose gets updated
# first (the remote deployment uploads it on every run; the local one gets
# edited by hand) and the next pass migrates it on its own.
set -euo pipefail

ROOT="${1:-}"
[[ -n "$ROOT" && -d "$ROOT" ]] || { echo "usage: $0 <agent-root>" >&2; exit 2; }
ROOT="$(cd "$ROOT" && pwd)"

OLD="$ROOT/data/.env"
NEW="$ROOT/secrets.env"
COMPOSE="$ROOT/docker-compose.yml"

if [[ -f "$COMPOSE" ]] && grep -qE '^\s*-\s*\./data/\.env\s*$' "$COMPOSE"; then
  if [[ -f "$OLD" ]]; then
    cat <<NOTICE
HEADS UP: the keys are still in data/.env, which the agent can rewrite — and
that file is the env_file for both services, i.e. code execution inside the
adapter. Not moving them yet because $COMPOSE
still names it and the agent would be left unable to start. Change it in BOTH
services:

    env_file:
      - ./secrets.env

and run this again (or the deployment, which does it on its own).
NOTICE
  fi
  exit 0
fi

if [[ -f "$NEW" && -f "$OLD" ]]; then
  echo "HEADS UP: there are keys in secrets.env AND in data/.env. Leaving both: check which"
  echo "          one is the good one and delete the data/ one by hand (the compose already"
  echo "          only reads secrets.env, so nobody uses the data/ one)."
  exit 0
fi

# The variables that do NOT get moved, and the criterion: they aren't
# credentials, they're levers that make an interpreter or the loader run code
# from somewhere else. It's a deliberately short BLOCK list. The first version
# of this was an allowlist of known credentials, and it destroyed the client's
# config: it dropped `TELEGRAM_ALLOWED_USERS` —which the kit itself creates,
# and is the bot's allowlist— and then deleted the file, meaning the value
# didn't survive anywhere. Without that variable the bot either answers nobody
# (the client loses the channel) or answers anybody. A credentials file has to
# be able to carry credentials we haven't invented yet: everything gets moved
# except what we know is dangerous.
DANGEROUS="PYTHONPATH PYTHONHOME PYTHONSTARTUP LD_PRELOAD LD_LIBRARY_PATH LD_AUDIT
            BASH_ENV ENV SHELLOPTS BASHOPTS PATH IFS PERL5LIB PERL5OPT RUBYOPT
            RUBYLIB NODE_OPTIONS NODE_PATH GCONV_PATH PYTHONWARNINGS"

# The variable name a line declares, or empty if it declares none, or "?" if
# we don't understand it. NORMALIZES BEFORE COMPARING, and that's the whole
# point: the consumer's parser (godotenv, the one docker compose uses) accepts
# an `export` prefix and spaces around the `=`, and ours didn't. With that,
# `export PYTHONPATH=/opt/data/evil` never matched `^NAME=`, was never
# compared against DANGEROUS, the file was declared clean and got moved WHOLE
# —payload included— into the file this script announces as "out of the
# agent's reach." Verified with `docker compose config`: the variable got
# through. Two forms slipped by (`export X=` and `X =`) and two got caught
# (`  X=` and `X= `). Now all four come out the same way.
name_of() {
  local l="$1"
  l="${l#"${l%%[![:space:]]*}"}"                       # leading whitespace
  if [[ -z "$l" || "$l" == \#* ]]; then printf ''; return; fi
  if [[ "$l" =~ ^(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)[[:space:]]*= ]]; then
    printf '%s' "${BASH_REMATCH[2]}"
  else
    printf '?'
  fi
}

# Does the line leave a quote open? Used to tell a CONTINUATION of a
# multi-line value apart (legitimate: a PEM key between quotes) from a line we
# don't understand. Counts unescaped quotes; it's an approximation, and that's
# why, when in doubt, it falls back to the conservative path instead of moving
# blindly.
odd_quote_count() {  # $1 = text, $2 = quote char
  local text="$1" q="$2" n=0 i c prev=""
  for ((i=0; i<${#text}; i++)); do
    c="${text:i:1}"
    [[ "$c" == "$q" && "$prev" != "\\" ]] && n=$((n+1))
    prev="$c"
  done
  (( n % 2 ))
}

if [[ -f "$OLD" ]]; then
  # It gets looked at BEFORE touching anything: that it's understood WHOLE and
  # that it carries none of the dangerous ones. Only with both things true
  # does it get moved as-is, without rewriting it — that way there's no way to
  # split a multi-line value or lose a quote.
  dangerous_found=""
  weird_lines=0
  open_quote=""
  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ -n "$open_quote" ]]; then                     # known continuation
      odd_quote_count "$line" "$open_quote" && open_quote=""
      continue
    fi
    name="$(name_of "$line")"
    if [[ "$name" == "?" ]]; then weird_lines=$((weird_lines+1)); continue; fi
    [[ -z "$name" ]] && continue
    for bad in $DANGEROUS; do
      [[ "$name" == "$bad" ]] && dangerous_found="$dangerous_found $name"
    done
    value="${line#*=}"
    if odd_quote_count "$value" '"'; then open_quote='"'
    elif odd_quote_count "$value" "'"; then open_quote="'"; fi
  done < "$OLD"
  [[ -n "$open_quote" ]] && weird_lines=$((weird_lines+1))             # a quote that never closed

  if [[ -z "$dangerous_found" && $weird_lines -eq 0 ]]; then
    # The everyday case: moved whole, byte for byte.
    if [[ -f "$NEW" ]]; then
      echo "HEADS UP: there's already a secrets.env. Leaving data/.env as-is: check which one is the good one."
    else
      mv "$OLD" "$NEW"
      chmod 600 "$NEW"
      [[ "$(id -u)" == "0" ]] && chown root:root "$NEW"
      echo "moved   data/.env → secrets.env (whole, root:root 600, out of the agent's reach)"
    fi
  elif [[ $weird_lines -gt 0 ]]; then
    # Not understood as a whole. Filtering blindly splits values; moving it
    # whole ships up what couldn't be checked. Left untouched, and explained.
    cat <<NOTICE
HEADS UP: data/.env has $weird_lines line(s) I don't understand (not
\`NAME=value\`, not a comment, not a quoted multi-line value continuation)${dangerous_found:+, and also
variables that aren't credentials:${dangerous_found}}. Not touching it: moving it whole
would ship up what I couldn't check, and filtering it would split a multi-line value.
Copy the credentials into secrets.env by hand, leave out what isn't one, and
delete data/.env.
NOTICE
  else
    # Dangerous ones present, but the file is understood as a whole: everything
    # else gets moved and the original is left as .unmigrated AT THE ROOT. Not
    # inside data/: the agent can reach it there, and the file has ALL the
    # credentials.
    : > "$NEW"; chmod 600 "$NEW"
    while IFS= read -r line || [[ -n "$line" ]]; do
      name="$(name_of "$line")"
      skip=""
      for bad in $DANGEROUS; do [[ "$name" == "$bad" ]] && skip=1; done
      [[ -n "$skip" ]] || printf '%s\n' "$line" >> "$NEW"
    done < "$OLD"
    [[ "$(id -u)" == "0" ]] && chown root:root "$NEW"
    mv "$OLD" "$ROOT/.env.unmigrated"
    chmod 600 "$ROOT/.env.unmigrated"
    [[ "$(id -u)" == "0" ]] && chown root:root "$ROOT/.env.unmigrated"
    cat <<NOTICE
moved   data/.env → secrets.env (minus${dangerous_found})
HEADS UP: I did NOT bring over${dangerous_found}. They aren't credentials: they're
     variables that make an interpreter load code from somewhere else, and
     data/.env can be written by the agent. The original was left at the
     agent's root as .env.unmigrated (root:root 600, outside data/) so you
     can look at what was there and who put it.
NOTICE
  fi
fi

# ── AND NOW THE CONSUMER'S OWN PARSER CHECKS IT, NOT OURS ──────────────────
# This whole function is a `.env` parser we wrote, and the bug fixed above was
# exactly that: ours said "clean" and docker's read `PYTHONPATH`. So after
# moving, THE ONE THAT'S ACTUALLY GOING TO READ IT gets asked: `docker compose
# config` resolves the services' real environment. If a dangerous one shows
# up, the move gets undone — the file goes back to data/ and no bomb is left
# sitting in the trusted spot.
if [[ -f "$NEW" && -f "$ROOT/docker-compose.yml" ]] && command -v docker >/dev/null 2>&1; then
  resolved="$(cd "$ROOT" && docker compose config 2>/dev/null || true)"
  if [[ -z "$resolved" ]]; then
    echo "(couldn't run \`docker compose config\` here: the check against the"
    echo " consumer's own parser is pending — run it on the server)"
  else
    leaked=""
    for bad in $DANGEROUS; do
      printf '%s' "$resolved" | grep -qE "^[[:space:]]+$bad:" && leaked="$leaked $bad"
    done
    if [[ -n "$leaked" ]]; then
      mv "$NEW" "$OLD"
      echo "FAILURE:${leaked} reaches the services' environment anyway according to"
      echo "  \`docker compose config\`, which is the parser that matters. Undid the"
      echo "  move: the keys are still in data/.env. Check it by hand before continuing."
      exit 1
    fi
    echo "verified with \`docker compose config\`: no dangerous variable reaches the services"
  fi
fi
