#!/usr/bin/env bash
# M2 — the reply waits for the ok, and then it really goes out.
#
#     ./tests/test_mail_gate.sh          ~1 minute, ~US$0.01
#
# Runs against the LIVE container and the lab's stub mailbox (`greenmail`,
# `docker-compose.yml`), so it can be run as often as it likes: nothing here
# can reach a real address. One turn, and it follows the mail all the way
# round:
#
#   a. a mail arrives, and one turn asks for it to be read and answered
#   b. the turn STOPS: `fetch_mail` ran, `send_email` did not, the chat says it
#      left a request, and the ticket is waiting for the client
#   c. the card names who wrote, carries the mail itself, and ends in the draft
#   d. the client approves — and the mail is in the OTHER mailbox, threaded to
#      the one that started it, with the ticket closed and Activity carrying it
#
# The only Spanish is what the agent and the client read.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KEY="$(grep '^API_SERVER_KEY=' "$ROOT/secrets.env" | cut -d= -f2-)"
ENDPOINT="${ENDPOINT:-http://127.0.0.1:8642}"
ADAPTER="${ADAPTER:-http://127.0.0.1:8643}"
CONTAINER="${CONTAINER:-tuagente-core}"
SUBJECT="Consulta por el diagnóstico (prueba de la puerta)"
MAIL="Hola, vi la página y quiero saber cómo arrancamos y qué me va a costar. Gracias, Ana."
PROMPT="Fijate si hay mails nuevos y contestá el que dice «${SUBJECT}». Contestalo ahora."
FAILURES=0

# Generous: approving waits for a whole model turn.
api() { curl -s --max-time 300 -H "Authorization: Bearer $KEY" "$@"; }
post() { api -X POST -H 'Content-Type: application/json' -d "$2" "$1"; }
ok()  { printf 'PASS  %s\n' "$1"; }
bad() { printf 'FAIL  %s\n' "$1"; FAILURES=$((FAILURES + 1)); }
step() { printf '\n-- %s\n' "$1"; }
assert() { [ "$1" = "$2" ] && ok "$3" || bad "$3 (wanted '$2', got '$1')"; }
pending_ids() { api "$ADAPTER/portal/approvals" | jq -r '.approvals[].id' | sort; }

# FROM INSIDE THE CONTAINER, ALWAYS: `state/` is a WAL database the engine
# holds open, and the stub mailbox is only reachable on the compose's own
# network. (`tests/test_flow_gate.sh` has the measured story of the other way.)
inside() { docker exec "$CONTAINER" python3 -c "$@"; }

step "(a) a mail to the company, and the turn that asks for it"
SENT_ID="$(inside '
import smtplib, sys
from email.message import EmailMessage
from email.utils import formatdate, make_msgid

message = EmailMessage()
message["From"] = "Ana Cliente <cliente@lab.test>"
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

before="$(pending_ids)"
stream="$(post "$ADAPTER/portal/chat/stream" \
  "$(jq -nc --arg m "$PROMPT" '{stream: true, messages: [{role: "user", content: $m}]}')")"

step "(b) it read the mail and stopped before answering it"
grep -q '"tool": "fetch_mail"' <<<"$stream" \
  && ok "the tool trail shows fetch_mail" || bad "fetch_mail is not in the stream"
grep -q '"tool": "send_email"' <<<"$stream" \
  && ok "and send_email" || bad "send_email is not in the stream"
grep -q 'Te dejé un pedido en Aprobaciones' <<<"$stream" \
  && ok "the chat closes with the pause message the code writes" \
  || bad "the chat never said it paused: $(tail -3 <<<"$stream")"
TICKET="$(inside '
import sys
sys.path.insert(0, "/opt/kit/plugins/kanban/core")
import board_store as board
found = board.by_source("mail", sys.argv[1])
print(found["id"] if found else "")
' "$SENT_ID")"
[ -n "$TICKET" ] && ok "the mail is a ticket: $TICKET" || bad "no ticket for the mail"

cleanup() {
  step "cleanup"
  inside '
import shutil, sqlite3, sys
from pathlib import Path
ticket = sys.argv[1]
db = sqlite3.connect("/state/core.db")
ids = [r[0] for r in db.execute(
    "SELECT id FROM sessions WHERE id IN (SELECT session_id FROM messages WHERE content LIKE ?)",
    (f"%{sys.argv[2]}%",))]
holes = ",".join("?" * len(ids)) or "NULL"
approvals = [r[0] for r in db.execute(
    f"SELECT id FROM approvals WHERE session_id IN ({holes})", ids)] if ids else []
db.executemany("DELETE FROM approval_comments WHERE approval_id = ?", [(a,) for a in approvals])
db.executemany("DELETE FROM approvals WHERE id = ?", [(a,) for a in approvals])
for table in ("events", "messages", "history", "sessions"):
    column = "id" if table == "sessions" else "session_id"
    db.executemany(f"DELETE FROM {table} WHERE {column} = ?", [(i,) for i in ids])
if ticket:
    db.execute("DELETE FROM tickets WHERE id = ?", (ticket,))
    db.execute("DELETE FROM ticket_comments WHERE ticket_id = ?", (ticket,))
    db.execute("DELETE FROM mail_seen WHERE ticket_id = ?", (ticket,))
    db.execute("DELETE FROM mail_threads WHERE ticket_id = ?", (ticket,))
    db.execute("DELETE FROM events WHERE json_extract(payload, ?) = ?",
               ("$.ticket_id", ticket))
    shutil.rmtree(Path("/workspace/correo") / ticket, ignore_errors=True)
db.commit()
print(f"took out the ticket, {len(approvals)} request(s) and {len(ids)} conversation(s)")
' "$TICKET" "$SUBJECT"
}
trap cleanup EXIT

assert "$(api "$ADAPTER/portal/tickets/$TICKET" | jq -r '.ticket.status')" "blocked" \
  "the ticket is waiting for the client, not being worked"

step "(c) the card carries the mail and ends in the draft"
new="$(comm -13 <(printf '%s\n' "$before") <(pending_ids))"
assert "$(grep -c . <<<"$new")" "1" "exactly one new request appeared"
ID="$(head -1 <<<"$new")"
[ -n "$ID" ] || { bad "no approval id: nothing else can be checked"; exit 1; }
api "$ADAPTER/portal/approvals" | jq -r --arg i "$ID" \
  '.approvals[] | select(.id == $i) | .title' \
  | grep -q "^Contestar el mail de cliente@lab.test: Re: ${SUBJECT}$" \
  && ok "the title names who wrote and what it answers" \
  || bad "the title is $(api "$ADAPTER/portal/approvals" | jq -r --arg i "$ID" '.approvals[] | select(.id == $i) | .title')"
BODY="$(api "$ADAPTER/portal/tickets/$ID" | jq -r '.ticket.body')"
grep -qF "cliente@lab.test" <<<"$BODY" \
  && ok "the card says who it goes to" || bad "the recipient is not on the card"
grep -qF "> Hola, vi la página" <<<"$BODY" \
  && ok "the mail itself is on the card, quoted" \
  || bad "the original mail is not on the card"
# The draft is what is BELOW the last table row: that is what the portal
# preloads into the correction box (`splitProposal`), so anything of ours down
# there would be mailed as if the agent had written it.
DRAFT="$(awk '/^\|/{last=NR} {line[NR]=$0} END{for(i=last+1;i<=NR;i++) print line[i]}' <<<"$BODY")"
[ "$(printf '%s' "$DRAFT" | wc -c)" -gt 40 ] \
  && ok "the card's editable tail is the draft ($(printf '%s' "$DRAFT" | wc -c | tr -d ' ') bytes)" \
  || bad "there is no draft below the last table row: $(head -c 200 <<<"$DRAFT")"
grep -q '^>' <<<"$DRAFT" && bad "the quoted mail leaked into what gets sent" \
  || ok "and it carries nothing of the thread"

step "(d) the client approves and the mail is in the other mailbox"
assert "$(post "$ADAPTER/portal/approvals/$ID/approve" '{}' | jq -r '.ok')" "true" \
  "the approval answered ok"
DELIVERED="$(inside '
import email, imaplib, json, sys
from email.header import decode_header, make_header


# A header with an accent in it travels RFC 2047 encoded, which is what a mail
# client undoes before showing it. So does this, or the subject reads
# "=?utf-8?q?diagn=C3=B3stico?=" and the check is about the wrong thing.
def words(value):
    return str(make_header(decode_header(value or "")))


conn = imaplib.IMAP4("greenmail", 3143)
conn.login("cliente", "secret")
conn.select("INBOX")
found = {}
for uid in conn.search(None, "ALL")[1][0].split():
    message = email.message_from_bytes(conn.fetch(uid, "(BODY.PEEK[])")[1][0][1])
    if (message.get("From") or "").find("agente@lab.test") < 0:
        continue
    body = message.get_payload(decode=True) or b""
    found = {"subject": words(message.get("Subject")), "from": message.get("From"),
             "in_reply_to": message.get("In-Reply-To"),
             "references": message.get("References"),
             "body": body.decode("utf-8", "replace")}
conn.logout()
print(json.dumps(found, ensure_ascii=False))
')"
assert "$(jq -r '.from // ""' <<<"$DELIVERED")" "agente@lab.test" \
  "it went out as the company's address"
assert "$(jq -r '.subject // ""' <<<"$DELIVERED")" "Re: $SUBJECT" \
  "under the subject it answers"
assert "$(jq -r '.in_reply_to // ""' <<<"$DELIVERED")" "$SENT_ID" \
  "threaded to the mail that started it"
[ "$(jq -r '.body // "" | length' <<<"$DELIVERED")" -gt 40 ] \
  && ok "and it has an answer in it: $(jq -r '.body' <<<"$DELIVERED" | head -1 | head -c 90)" \
  || bad "the mail that went out is empty"
assert "$(api "$ADAPTER/portal/tickets/$TICKET" | jq -r '.ticket.status')" "done" \
  "the ticket closed"
api "$ADAPTER/portal/tickets/$TICKET" | jq -e '[.comments[] | select(.author == "agente@lab.test")] | length > 0' \
  >/dev/null \
  && ok "what was sent is on the ticket, signed by the address it went out as" \
  || bad "the answer is not on the ticket"
api "$ADAPTER/portal/activity" | jq -e '[.events[] | select(.kind == "mail.sent")] | length > 0' \
  >/dev/null && ok "Activity has mail.sent" || bad "Activity has no mail.sent"
pending_ids | grep -qx "$ID" \
  && bad "the request is still in the queue" || ok "the request left the queue"

step "(e) result"
[ "$FAILURES" -eq 0 ] && printf 'MAIL GATE PASS - 0 failures\n' \
  || printf 'MAIL GATE FAIL - %s failures\n' "$FAILURES"
exit $((FAILURES > 0))
