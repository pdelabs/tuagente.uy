#!/usr/bin/env bash
# G1 — a fail-closed approval that survives a crash, and a negotiation that
# five "no"s in a row do not kill.
#
# Runs against the LIVE container (docker compose up -d) and kills it halfway
# on purpose: a pause that only lives in memory is not a gate, it is a
# coincidence. Reads the key from secrets.env itself.
#
# THE SENSITIVE TOOL IS THE MAIL PLUGIN'S `send_email`, against the lab's stub
# mailbox (`greenmail`, `docker-compose.yml`). It used to be the approval
# plugin's own fake one, which wrote a file into `workspace/outbox/` and went
# out with it: two tools with that name, one of them real, is the model
# choosing between them by the shape of a sentence. So a mail is dropped in
# first, and what proves the correction was applied is the message that lands
# in the OTHER mailbox.
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
SUBJECT="Pedido de bisagras (prueba de la puerta)"
MAIL="Buenas, quería saber si el pedido de 20 bisagras ya está para retirar. Juan."
PROMPT="Fijate si hay mails nuevos y contestá el que dice «${SUBJECT}». Contestalo ahora."
# A CORRECTION REPLACES THE TEXT, it is not an instruction about it: the portal
# preloads the box with the draft and sends back whatever the client leaves in
# it, so what arrives is a finished mail (`app/app/approvals/page.tsx`).
CORRECTION="Hola Juan: son 25 bisagras y ya están para retirar, de lunes a viernes de 9 a 18."
FAILURES=0

# Generous on purpose: approve and reject both wait for a whole model turn.
api() { curl -s --max-time 300 -H "Authorization: Bearer $KEY" "$@"; }
post() { api -X POST -H 'Content-Type: application/json' -d "$2" "$1"; }
pending_ids() { api "$ADAPTER/portal/approvals" | jq -r '.approvals[].id' | sort; }
proposals() { api "$ADAPTER/portal/tickets/$1" | jq '[.comments[] | select(.author == "agente")] | length'; }

inside() { docker exec tuagente-core python3 -c "$@"; }
ok()  { printf 'PASS  %s\n' "$1"; }
bad() { printf 'FAIL  %s\n' "$1"; FAILURES=$((FAILURES + 1)); }
step() { printf '\n-- %s\n' "$1"; }
assert() { [ "$1" = "$2" ] && ok "$3" || bad "$3 (wanted '$2', got '$1')"; }

step "(a) a mail waiting, and a turn that reaches a sensitive tool"
SENT_ID="$(inside '
import smtplib, sys
from email.message import EmailMessage
from email.utils import formatdate, make_msgid

message = EmailMessage()
message["From"] = "Juan Pérez <cliente@lab.test>"
message["To"] = "agente@lab.test"
message["Subject"] = sys.argv[1]
message["Message-ID"] = make_msgid(domain="lab.test")
message["Date"] = formatdate(localtime=True)
message.set_content(sys.argv[2])
with smtplib.SMTP("greenmail", 3025, timeout=20) as smtp:
    smtp.login("cliente", "secret")
    smtp.send_message(message)
print(message["Message-ID"])
' "$SUBJECT" "$MAIL")"
[ -n "$SENT_ID" ] && ok "the mail is in the stub: $SENT_ID" \
  || { bad "the mail could not be delivered"; exit 1; }

cleanup() {
  step "cleanup"
  inside '
import sqlite3, sys
db = sqlite3.connect("/state/core.db")
ids = [r[0] for r in db.execute(
    "SELECT id FROM sessions WHERE id IN (SELECT session_id FROM messages WHERE content LIKE ?)",
    (f"%{sys.argv[1]}%",))]
holes = ",".join("?" * len(ids)) or "NULL"
approvals = [r[0] for r in db.execute(
    f"SELECT id FROM approvals WHERE session_id IN ({holes})", ids)] if ids else []
db.executemany("DELETE FROM approval_comments WHERE approval_id = ?", [(a,) for a in approvals])
db.executemany("DELETE FROM approvals WHERE id = ?", [(a,) for a in approvals])
for table in ("events", "messages", "history", "sessions"):
    column = "id" if table == "sessions" else "session_id"
    db.executemany(f"DELETE FROM {table} WHERE {column} = ?", [(i,) for i in ids])
tickets = [r[0] for r in db.execute(
    "SELECT id FROM tickets WHERE source = ? AND source_ref = ?", ("mail", sys.argv[2]))]
for ticket in tickets:
    db.execute("DELETE FROM tickets WHERE id = ?", (ticket,))
    db.execute("DELETE FROM ticket_comments WHERE ticket_id = ?", (ticket,))
    db.execute("DELETE FROM mail_seen WHERE ticket_id = ?", (ticket,))
    db.execute("DELETE FROM mail_threads WHERE ticket_id = ?", (ticket,))
    db.execute("DELETE FROM events WHERE json_extract(payload, ?) = ?", ("$.ticket_id", ticket))
db.commit()
print(f"took out {len(approvals)} request(s), {len(tickets)} ticket(s) "
      f"and {len(ids)} conversation(s)")
' "$SUBJECT" "$SENT_ID"
}
trap cleanup EXIT

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
approved="$(post "$ADAPTER/portal/approvals/$ID/approve" \
  "$(jq -nc --arg c "$CORRECTION" '{correction: $c}')")"
assert "$(jq -r '.ok' <<<"$approved")" "true" "the approval answered ok"
pending_ids | grep -qx "$ID" \
  && bad "the request is still in the queue after being approved" \
  || ok "the request left the queue"
assert "$(api "$ADAPTER/portal/tickets/$ID" | jq -r '.ticket.status')" "done" \
  "the detail reads as closed"
DELIVERED="$(inside '
import email, imaplib, json, sys
from email.header import decode_header, make_header
conn = imaplib.IMAP4("greenmail", 3143)
conn.login("cliente", "secret")
conn.select("INBOX")
found = {}
for uid in conn.search(None, "ALL")[1][0].split():
    message = email.message_from_bytes(conn.fetch(uid, "(BODY.PEEK[])")[1][0][1])
    if (message.get("From") or "").find("agente@lab.test") < 0:
        continue
    if str(make_header(decode_header(message.get("Subject") or ""))) != "Re: " + sys.argv[1]:
        continue
    found = {"in_reply_to": message.get("In-Reply-To"),
             "body": (message.get_payload(decode=True) or b"").decode("utf-8", "replace")}
conn.logout()
print(json.dumps(found, ensure_ascii=False))
' "$SUBJECT")"
assert "$(jq -r '.in_reply_to // ""' <<<"$DELIVERED")" "$SENT_ID" \
  "the mail went out, threaded to the one that asked"
jq -r '.body // ""' <<<"$DELIVERED" | grep -qF "$CORRECTION" \
  && ok "and the correction IS the text, not something appended to it" \
  || bad "the correction is not what was sent: $(jq -r '.body' <<<"$DELIVERED" | head -c 200)"

step "(f) result"
[ "$FAILURES" -eq 0 ] && printf 'G1 PASS - 0 failures\n' || printf 'G1 FAIL - %s failures\n' "$FAILURES"
exit $((FAILURES > 0))
