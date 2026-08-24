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
# "Calls to the model" is THREE routes, not one, and each is wired below with
# its own reason: the client's chat (data/config.yaml), every teammate's chat
# (data/profiles/*/config.yaml — the engine merges nothing from the parent
# home) and image generation (OPENROUTER_BASE_URL in each home's .env — the
# image plugin resolves its endpoint on its own and ignores the model block).
# Miss any of the three and the proxy is up, the operator reads "on", and that
# traffic is neither traced nor priced in costs.jsonl.
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
    # Asked separately because it IS separate: the image plugin resolves its
    # own endpoint and ignores the model block. A status that only read the
    # line above said "proxied" while every pixel went around it.
    echo -n "  image route      : "
    ssh "$HOST" "grep -h '^OPENROUTER_BASE_URL=' $DIR/data/.env $DIR/data/profiles/*/.env 2>/dev/null | sort -u | tr '\n' ' ' || true"
    ssh "$HOST" "grep -qh '^OPENROUTER_BASE_URL=' $DIR/data/.env $DIR/data/profiles/*/.env 2>/dev/null" \
      || echo -n '(straight to OpenRouter — images NOT in costs.jsonl)'
    echo
    echo -n "  homes covered    : "
    ssh "$HOST" "ls -d $DIR/data $DIR/data/profiles/*/ 2>/dev/null | wc -l | tr -d ' '"
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
    # EVERY HOME, NOT JUST THE AGENT'S. Under `gateway.multiplex_profiles` a
    # hired role's home is `data/profiles/<role>/` and the engine merges
    # NOTHING from the parent (tools/profile_config.py): a config.yaml that
    # only the default profile got left every teammate talking straight to
    # OpenRouter, untraced and unledgered, while the operator read "the proxy
    # is in the middle". The role configs are projections of the agent's, so
    # the same edit on all of them is what keeps them from drifting — which is
    # what `agent-check.py` compares, key by key.
    echo "→ pointing the model at the proxy"
    ssh "$HOST" "python3 - <<'PY'
import pathlib, re
for p in [pathlib.Path('$DIR/data/config.yaml')] + sorted(
        pathlib.Path('$DIR/data/profiles').glob('*/config.yaml')):
    s = p.read_text()
    if 'base_url' in s.split('toolsets:')[0]:
        s = re.sub(r'^(\s*)base_url:.*$', r'\1base_url: $PROXY', s, count=1, flags=re.M)
    else:
        s = s.replace('model:\n', 'model:\n  base_url: $PROXY\n', 1)
    s = re.sub(r'^(\s*)provider:.*$', r'\1provider: custom', s, count=1, flags=re.M)
    p.write_text(s)
PY"

    # THE IMAGE PLUGIN DOES NOT READ model.base_url, and that is why the ledger
    # was blind to 92% of an image-heavy agent's spend. `image_generate` is an
    # engine plugin (plugins/image_gen/openrouter) that asks
    # `resolve_runtime_provider(requested='openrouter')` for its endpoint, and
    # that path IGNORES the model block whenever the requested provider is not
    # `custom`/`auto` (hermes:hermes_cli/runtime_provider.py:1192-1207). So the
    # chat went through the proxy and the pixels went around it: the Uso tab is
    # right either way (it asks OpenRouter what it charged), but `costs.jsonl`
    # -- the only per-model, per-call record we have -- never saw an image.
    #
    # The ONE seam is OPENROUTER_BASE_URL. `providers.openrouter.base_url`
    # does not work: `openrouter` is a canonical provider name, so the named
    # custom-provider lookup returns None for it before ever reading the block
    # (runtime_provider.py:657-672). With the var set, the same function keeps
    # picking OPENROUTER_API_KEY, because it treats a configured OpenRouter
    # mirror as OpenRouter context (:1214-1228).
    #
    # AND IT HAS TO BE A `.env` FILE, NOT THE CONTAINER ENVIRONMENT. With
    # multiplexing on, the engine reads credentials through a per-profile
    # secret scope built from `<home>/.env`, and a scope miss returns the
    # default instead of falling through to os.environ -- fail-closed on
    # purpose, so one client's key cannot leak into another's turn
    # (hermes:agent/secret_scope.py:123-190). secrets.env reaches the process
    # and the turn never sees it.
    #
    # RE-RUN THIS AFTER EVERY HIRE: `hire-role.sh` writes the role's .env from
    # scratch with its API_SERVER_KEY, so a role hired later comes up without
    # this line and its images go around the proxy again.
    echo "→ pointing image generation at the proxy"
    ssh "$HOST" "python3 - <<'PY'
import pathlib
for home in [pathlib.Path('$DIR/data')] + sorted(
        d for d in pathlib.Path('$DIR/data/profiles').glob('*') if d.is_dir()):
    env = home / '.env'
    fresh = not env.exists()
    lines = [l for l in env.read_text().splitlines() if not l.startswith('OPENROUTER_BASE_URL=')] \
        if not fresh else []
    lines.append('OPENROUTER_BASE_URL=$PROXY')
    env.write_text('\n'.join(lines) + '\n')
    if fresh:
        # It holds a URL, not a credential, and the engine runs as another
        # user: readable, or the proxy is simply not there for that profile.
        env.chmod(0o644)
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
    # Both halves come back out, and every home: the chat's base_url and the
    # image plugin's OPENROUTER_BASE_URL. Leaving the second one behind would
    # point image generation at a container that is about to be stopped, and
    # the failure reads as "the image tool broke" with no proxy in sight.
    echo "→ taking the proxy out of the middle"
    ssh "$HOST" "python3 - <<'PY'
import pathlib, re
for p in [pathlib.Path('$DIR/data/config.yaml')] + sorted(
        pathlib.Path('$DIR/data/profiles').glob('*/config.yaml')):
    s = re.sub(r'^\s*base_url:.*\n', '', p.read_text(), count=1, flags=re.M)
    s = re.sub(r'^(\s*)provider:\s*custom\s*$', r'\1provider: openrouter', s, count=1, flags=re.M)
    p.write_text(s)
for home in [pathlib.Path('$DIR/data')] + sorted(
        d for d in pathlib.Path('$DIR/data/profiles').glob('*') if d.is_dir()):
    env = home / '.env'
    if not env.exists():
        continue
    lines = [l for l in env.read_text().splitlines() if not l.startswith('OPENROUTER_BASE_URL=')]
    env.write_text(('\n'.join(lines) + '\n') if lines else '')
PY"
    compose "restart hermes" >/dev/null 2>&1
    wait_for_gateway || { echo "the gateway never came back — check the logs" >&2; exit 1; }
    echo "→ the agent talks directly to OpenRouter"
    compose "stop phoenix otel-collector litellm" >/dev/null 2>&1
    echo "→ phoenix, the collector and litellm are off (the traces stay in their volume)"
    ;;

  *) echo "unknown action: $ACTION (on | off | status)" >&2; exit 1 ;;
esac
