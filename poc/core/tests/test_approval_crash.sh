#!/usr/bin/env bash
# G1 — a fail-closed approval that survives a crash, and a negotiation that
# five "no"s in a row do not kill.
#
# Runs against the LIVE container (docker compose up -d) and kills it halfway
# on purpose: a pause that only lives in memory is not a gate, it is a
# coincidence. Reads the key from secrets.env itself.
#
#     ./tests/test_approval_crash.sh
#
# Every step prints PASS or FAIL; the exit code is 1 if any of them failed.
# The only Spanish here is what travels to the agent and what the client would
# read: the prompt, the five reasons, the correction and the pause message.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KEY="$(grep '^API_SERVER_KEY=' "$ROOT/secrets.env" | cut -d= -f2-)"
ENDPOINT="${ENDPOINT:-http://127.0.0.1:8642}"
ADAPTER="${ADAPTER:-http://127.0.0.1:8643}"
PROMPT="Mandale un mail a juan@acme.com avisando que el pedido de 20 bisagras está listo para retirar"
CORRECTION="que diga 25 bisagras, no 20"
FAILURES=0

# Generous on purpose: approve and reject both wait for a whole model turn.
api() { curl -s --max-time 300 -H "Authorization: Bearer $KEY" "$@"; }
post() { api -X POST -H 'Content-Type: application/json' -d "$2" "$1"; }
pending_ids() { api "$ADAPTER/portal/approvals" | jq -r '.approvals[].id' | sort; }
proposals() { api "$ADAPTER/portal/tickets/$1" | jq '[.comments[] | select(.author == "agente")] | length'; }

ok()  { printf 'PASS  %s\n' "$1"; }
bad() { printf 'FAIL  %s\n' "$1"; FAILURES=$((FAILURES + 1)); }
step() { printf '\n-- %s\n' "$1"; }
assert() { [ "$1" = "$2" ] && ok "$3" || bad "$3 (wanted '$2', got '$1')"; }

step "(a) a turn that reaches a sensitive tool"
before="$(pending_ids)"
stream="$(post "$ADAPTER/portal/chat/stream" \
  "$(jq -nc --arg m "$PROMPT" '{stream: true, messages: [{role: "user", content: $m}]}')")"
grep -q 'Te dejé un pedido en Aprobaciones' <<<"$stream" \
  && ok "the chat closes with the pause message the code writes" \
  || bad "the chat never said it paused: $(tail -3 <<<"$stream")"
grep -q '"tool": "send_email"' <<<"$stream" \
  && ok "the tool trail shows send_email" || bad "no tool event in the stream"

step "(b) one row is waiting and the conversation says so"
new="$(comm -13 <(printf '%s\n' "$before") <(pending_ids))"
assert "$(grep -c . <<<"$new")" "1" "exactly one new request appeared"
ID="$(head -1 <<<"$new")"
[ -n "$ID" ] || { bad "no approval id: nothing else can be checked"; exit 1; }
SID="$(api "$ENDPOINT/api/sessions" | jq -r --arg p "$PROMPT" \
  '.data[] | select(.preview == $p) | .id' | head -1)"
last="$(api "$ENDPOINT/api/sessions/$SID/messages" | jq -r '.data[-1] | "\(.role)|\(.content)"')"
grep -q '^assistant|Te dejé un pedido en Aprobaciones: ' <<<"$last" \
  && ok "the session's last message is the pause message" \
  || bad "the last message is something else: $last"
assert "$(api "$ADAPTER/portal/tickets/$ID" | jq -r '.ticket.status')" "blocked" \
  "the detail reads as blocked"

step "(c) docker kill and back up"
docker kill tuagente-core >/dev/null 2>&1 || bad "the container would not die"
(cd "$ROOT" && docker compose up -d >/dev/null 2>&1)
for _ in $(seq 1 60); do
  api "$ADAPTER/portal/manifest" | grep -q '"adapter_version"' && break
  sleep 1
done
assert "$(api "$ADAPTER/portal/manifest" | jq -r '.modules.approvals')" "true" \
  "the manifest came back with the approvals module"
pending_ids | grep -qx "$ID" \
  && ok "the request survived the restart, same id" \
  || bad "the request is gone after the restart"

step "(d) five rejections in a row do not kill it"
i=0
for reason in \
  "Poné el horario de retiro, de 9 a 18." \
  "No lo trates de usted, tuteálo." \
  "Sacale el «Estimado», arrancá con Hola." \
  "Agregá que puede venir con el remito." \
  "Más corto: tres líneas como mucho."; do
  i=$((i + 1))
  had="$(proposals "$ID")"
  res="$(post "$ADAPTER/portal/approvals/$ID/reject" "$(jq -nc --arg r "$reason" '{reason: $r}')")"
  assert "$(jq -r '.in_approvals' <<<"$res")" "true" "rejection $i: still in the queue"
  assert "$(jq -r '.unblocked' <<<"$res")" "false" "rejection $i: the unblock was not spent"
  now="$(proposals "$ID")"
  [ "$now" -gt "$had" ] \
    && ok "rejection $i: the agent proposed another version ($had -> $now)" \
    || bad "rejection $i: no new proposal ($had -> $now)"
  pending_ids | grep -qx "$ID" \
    && ok "rejection $i: same id, no second request opened" \
    || bad "rejection $i: the request fell out of the queue"
done

step "(e) approve with a correction and look at what it did"
mark="$(mktemp)"
sleep 1
approved="$(post "$ADAPTER/portal/approvals/$ID/approve" \
  "$(jq -nc --arg c "$CORRECTION" '{correction: $c}')")"
assert "$(jq -r '.ok' <<<"$approved")" "true" "the approval answered ok"
pending_ids | grep -qx "$ID" \
  && bad "the request is still in the queue after being approved" \
  || ok "the request left the queue"
assert "$(api "$ADAPTER/portal/tickets/$ID" | jq -r '.ticket.status')" "done" \
  "the detail reads as closed"
written="$(find "$ROOT/workspace/outbox" -type f -newer "$mark" 2>/dev/null)"
[ -n "$written" ] \
  && ok "the tool wrote into outbox: $(basename "$written")" \
  || bad "nothing new landed in outbox"
grep -q "$CORRECTION" $written 2>/dev/null \
  && ok "the mail went out with the client's correction applied" \
  || bad "the correction is not in what was sent"
rm -f "$mark"

step "(f) result"
[ "$FAILURES" -eq 0 ] && printf 'G1 PASS - 0 failures\n' || printf 'G1 FAIL - %s failures\n' "$FAILURES"
exit $((FAILURES > 0))
