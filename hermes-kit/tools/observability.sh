#!/usr/bin/env bash
# Turns an agent's observability on or off: see ALL its prompts.
#
#   ./observability.sh tuagente on
#   ./observability.sh tuagente off
#   ./observability.sh tuagente status
#   ./observability.sh root@1.2.3.4 on east    # ssh host NOT named after the agent
#
# The THIRD argument is the slug: the directory name on the VPS
# (/opt/agentes/<slug>) and the container prefix. It goes third and not
# second because the second one is already the action. It defaults to the
# same as the ssh host.
#
# When on, calls to the model go through a proxy (litellm) that sends them to
# Phoenix. When off, the agent talks directly to OpenRouter and nothing is
# kept.
#
# Do NOT leave it on for a client without telling them: Phoenix stores the
# prompts, and the prompts are THEIR data. See the notes in
# compose/docker-compose.observability.yml.
set -euo pipefail

KIT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOST="${1:-}"; ACTION="${2:-status}"; SLUG="${3:-$HOST}"
[[ -n "$HOST" ]] || { echo 'usage: ./observability.sh <ssh-host> [on|off|status] [slug]' >&2; exit 1; }
DIR="/opt/agentes/$SLUG"
PROXY="http://litellm:4000"

ssh "$HOST" "[ -d $DIR/data ]" || {
  echo "$DIR/data doesn't exist on $HOST" >&2
  echo "if the agent's directory isn't called '$SLUG', pass it as the third" >&2
  echo "argument:  ./observability.sh $HOST $ACTION <slug>" >&2
  exit 1
}

compose() { ssh "$HOST" "cd $DIR && docker compose -f docker-compose.yml -f docker-compose.observability.yml $*"; }

wait_for_gateway() {
  for _ in $(seq 1 40); do
    sleep 6
    [[ "$(ssh "$HOST" "docker exec $SLUG-hermes curl -s -o /dev/null -w '%{http_code}' -m 5 http://127.0.0.1:8642/health" 2>/dev/null)" == "200" ]] && return 0
  done
  return 1
}

case "$ACTION" in
  status)
    echo -n "  model's base_url : "
    ssh "$HOST" "grep -A3 '^model:' $DIR/data/config.yaml | grep base_url || echo '(no base_url — straight to OpenRouter)'"
    echo -n "  containers       : "
    ssh "$HOST" "docker ps --format '{{.Names}}' | grep -E 'phoenix|litellm' | tr '\n' ' ' || true"
    echo
    ;;

  on)
    echo "→ uploading the overlay"
    rsync -a "$KIT/compose/docker-compose.observability.yml" "$HOST:$DIR/"
    rsync -a "$KIT/compose/litellm.yaml" "$HOST:$DIR/"
    # The callback that logs the real cost. Goes together with the yaml that
    # names it: if one travels without the other, litellm starts with a
    # callback that doesn't exist.
    rsync -a "$KIT/compose/litellm-cost.py" "$HOST:$DIR/"
    rsync -a "$KIT/compose/otel-collector.yaml" "$HOST:$DIR/"

    # The model comes from the agent's config: litellm doesn't send it on the
    # useful span and without it the trace doesn't say who you were talking to.
    #
    # ⚠️ THAT VALUE IS WRITTEN BY THE AGENT. `data/config.yaml` lives in its
    # volume, and until today this pasted it UNQUOTED into the string that
    # goes to `ssh`: with a `default:` like  model'; touch /tmp/ROOT; echo 'x
    # the command ran ON THE VPS'S ROOT SHELL. Reproduced. It was the first
    # path that got out of the container and reached the host: the agent
    # writes its config, the operator runs a kit tool, and that's it.
    #
    # Now: it's validated to look like a model name and NOT INTERPOLATED —
    # the value travels as an argument, `printf %q`-quoted, to a script that
    # comes in over stdin, and on the other side it's used quoted, with no sed.
    MODEL="$(ssh "$HOST" "grep -E '^\s*default:' $DIR/data/config.yaml | head -1 | sed 's/.*default:[[:space:]]*//'" | tr -d '\r')"
    MODEL="${MODEL%\"}"; MODEL="${MODEL#\"}"; MODEL="${MODEL%\'}"; MODEL="${MODEL#\'}"
    if [[ -n "$MODEL" && ! "$MODEL" =~ ^[A-Za-z0-9][A-Za-z0-9._:/-]{0,80}$ ]]; then
      echo "→ HEADS UP: the agent's config model doesn't look like a model name" >&2
      echo "   ($(printf '%q' "$MODEL")). Not using it: the trace is going to say 'unknown'," >&2
      echo "   but a value like that inside a remote command is code execution." >&2
      MODEL=""
    fi
    echo "→ agent's model: ${MODEL:-unknown}"
    ssh "$HOST" "bash -s -- $(printf '%q' "$DIR") $(printf '%q' "$MODEL")" <<'REMOTE'
set -eu
DIR="$1"; MODEL="${2:-}"
tmp="$DIR/.env.new"
{ [ -f "$DIR/.env" ] && grep -v '^AGENT_MODEL=' "$DIR/.env" || true; } > "$tmp"
[ -n "$MODEL" ] && printf 'AGENT_MODEL=%s\n' "$MODEL" >> "$tmp"
mv "$tmp" "$DIR/.env"
REMOTE

    echo "→ bringing up phoenix and litellm"
    compose "up -d phoenix otel-collector litellm" >/dev/null 2>&1

    # The proxy has to answer BEFORE Hermes depends on it: otherwise the agent
    # goes mute until someone remembers to check the logs.
    echo -n "→ the proxy answers: "
    ready=""
    for _ in $(seq 1 12); do
      sleep 8
      ssh "$HOST" "docker exec $SLUG-hermes curl -s -o /dev/null -w '%{http_code}' -m 8 http://litellm:4000/health/liveliness" 2>/dev/null | grep -q 200 && { ready=1; break; }
    done
    # Asked FROM hermes and not from litellm: the proxy's image doesn't ship
    # curl, and its absence looks exactly like "the proxy isn't answering."
    # This also tests what actually matters — that hermes CAN REACH IT over
    # the internal network—, which is the only question that decides whether
    # to continue.
    if [[ -n "$ready" ]]; then
      echo "yes"
    else
      echo "NO — not touching the agent, check 'docker compose logs litellm'" >&2
      exit 1
    fi

    # config.yaml is mounted :ro INSIDE THE CONTAINER, but on the host it's a
    # regular file: it gets edited here and restarted.
    # WATCH THE PROVIDER, which is what took time to find: with
    # `provider: openrouter` Hermes IGNORES base_url and goes straight through
    # — the proxy stays up and never sees a single call. The provider for a
    # custom endpoint is `custom` (`openai` doesn't even exist: it throws
    # "Unknown provider").
    echo "→ pointing the model at the proxy"
    ssh "$HOST" "python3 - <<'PY'
import pathlib, re
p = pathlib.Path('$DIR/data/config.yaml')
s = p.read_text()
if 'base_url' in s.split('toolsets:')[0]:
    s = re.sub(r'^(\s*)base_url:.*$', r'\1base_url: $PROXY', s, count=1, flags=re.M)
else:
    s = s.replace('model:\n', 'model:\n  base_url: $PROXY\n', 1)
s = re.sub(r'^(\s*)provider:.*$', r'\1provider: custom', s, count=1, flags=re.M)
p.write_text(s)
PY"
    compose "restart hermes" >/dev/null 2>&1
    wait_for_gateway || { echo "the gateway never came back — check the logs" >&2; exit 1; }
    echo "→ gateway up with the proxy in the middle"
    echo
    echo "To watch it (the prompts do NOT leave the machine, they go through the tunnel):"
    echo "    ssh -L 6006:localhost:6006 $HOST"
    echo "    http://localhost:6006"
    ;;

  off)
    echo "→ taking the proxy out of the middle"
    ssh "$HOST" "python3 - <<'PY'
import pathlib, re
p = pathlib.Path('$DIR/data/config.yaml')
s = re.sub(r'^\s*base_url:.*\n', '', p.read_text(), count=1, flags=re.M)
s = re.sub(r'^(\s*)provider:\s*custom\s*$', r'\1provider: openrouter', s, count=1, flags=re.M)
p.write_text(s)
PY"
    compose "restart hermes" >/dev/null 2>&1
    wait_for_gateway || { echo "the gateway never came back — check the logs" >&2; exit 1; }
    echo "→ the agent talks directly to OpenRouter"
    compose "stop phoenix otel-collector litellm" >/dev/null 2>&1
    echo "→ phoenix, the collector and litellm are off (the traces stay in their volume)"
    ;;

  *) echo "unknown action: $ACTION (on | off | status)" >&2; exit 1 ;;
esac
