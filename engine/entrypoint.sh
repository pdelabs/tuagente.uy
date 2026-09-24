#!/bin/bash
# The container's one process — or two, when this agent has WhatsApp.
#
# THE BRIDGE RUNS ONLY WHEN THE PLUGIN DOES: `whatsapp` in CORE_PLUGINS (or
# WHATSAPP_BRIDGE=1, for a test that wants the bridge without the plugin). An
# agent that did not buy WhatsApp has no second process, no socket and no
# whatsmeow store.
#
# When it runs, the two share a token generated here, per boot, and exported to
# both: nothing to configure and nothing in secrets.env. Either process dying
# takes the other one down and the container with it — `restart:
# unless-stopped` brings both back, which beats an engine answering «no está
# conectado tu WhatsApp» forever over a bridge that crashed. SIGTERM (docker
# stop) is passed to both, so the bridge closes its socket cleanly.
set -euo pipefail

ENGINE=(uvicorn server.app:app --host 0.0.0.0 --port 8643 --http h11)

case ",${CORE_PLUGINS:-}," in
  *,whatsapp,*) bridge=1 ;;
  *) bridge="${WHATSAPP_BRIDGE:-0}" ;;
esac

if [ "$bridge" != 1 ]; then
  exec "${ENGINE[@]}"
fi

WHATSAPP_BRIDGE_TOKEN="${WHATSAPP_BRIDGE_TOKEN:-$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')}"
export WHATSAPP_BRIDGE_TOKEN

whatsapp-bridge &
bridge_pid=$!
"${ENGINE[@]}" &
engine_pid=$!

trap 'kill -TERM "$engine_pid" "$bridge_pid" 2>/dev/null || true' TERM INT

set +e
wait -n "$engine_pid" "$bridge_pid"
status=$?
kill -TERM "$engine_pid" "$bridge_pid" 2>/dev/null
wait
exit "$status"
