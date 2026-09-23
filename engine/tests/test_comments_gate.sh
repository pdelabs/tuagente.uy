#!/usr/bin/env bash
# Answering a comment or a message stops at the gate, and the card says what is
# about to go out.
#
#     ./tests/test_comments_gate.sh          ~1 minute, ~US$0.01
#
# Runs against the LIVE container, two turns, with IG_* unset — which is the
# state every agent is in until the client's token lands, and the reason this
# test can be run as often as it likes: a reply on a public thread is one
# irreversible thing on a real account. The Graph half has its own gate with no
# network at all (`tests/test_instagram_comments.py`).
#
#   a. with nothing connected, the tick ANSWERS: one turn asking for the
#      comments comes back with «Tu cuenta de Instagram todavía no está conectada…»,
#      with nothing waiting for the client
#   b. a comment the agent has seen, and one turn asking for an answer to it:
#      the turn STOPS and nothing was sent
#   c. the card carries the post, the comment and the draft, and the draft is
#      the editable tail
#   d. the client approves, and the resumed turn comes back with the missing
#      connection — an answer and not a dead turn — the request closed and both
#      halves in Activity
#   e. the same for a DIRECT MESSAGE: a seeded conversation, one turn asking for
#      an answer to it, and a card that carries the person, the thread and how
#      much of Meta's 24 hours is left
#
# The only Spanish is what the agent and the client read.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KEY="$(grep '^API_SERVER_KEY=' "$ROOT/secrets.env" | cut -d= -f2-)"
ENDPOINT="${ENDPOINT:-http://127.0.0.1:8642}"
ADAPTER="${ADAPTER:-http://127.0.0.1:8643}"
CONTAINER="${CONTAINER:-tuagente-core}"
# An id nobody's comment is: the row has to be the test's and never the feed's.
COMMENT_ID="c_prueba_de_la_puerta"
WHO="vecina.del.barrio"
SAID="¿Ustedes atienden los sábados?"
POST_LINE="Una ferretería que contesta a las once de la noche."
PERMALINK="https://www.instagram.com/p/PRUEBADELAPUERTA/"
DRAFT="Sí, los sábados de 9 a 13. Escribinos y lo vemos."
ASK="Fijate si hay comentarios nuevos en Instagram y contame."
# The DM half: a thread the agent has seen, and the person on the other side.
THREAD_ID="ig_dm_prueba_de_la_puerta"
DM_WHO="clienta.nueva"
DM_IGSID="7380000000000001"
DM_SAID="Hola, ¿ustedes atienden los sábados?"
DM_DRAFT="Sí, los sábados de 9 a 13. ¿De qué es tu negocio?"
REPLY_ASK="Contestá el comentario \`${COMMENT_ID}\` de Instagram con esto, tal cual: «${DRAFT}»"
DM_ASK="Contestá el mensaje de la conversación \`${THREAD_ID}\` de Instagram con esto, tal cual: «${DM_DRAFT}»"
FAILURES=0

# Generous: approving waits for a whole model turn.
api() { curl -s --max-time 300 -H "Authorization: Bearer $KEY" "$@"; }
post() { api -X POST -H 'Content-Type: application/json' -d "$2" "$1"; }
ok()  { printf 'PASS  %s\n' "$1"; }
bad() { printf 'FAIL  %s\n' "$1"; FAILURES=$((FAILURES + 1)); }
step() { printf '\n-- %s\n' "$1"; }
assert() { [ "$1" = "$2" ] && ok "$3" || bad "$3 (wanted '$2', got '$1')"; }
pending_ids() { api "$ADAPTER/portal/approvals" | jq -r '.approvals[].id' | sort; }

# FROM INSIDE THE CONTAINER, ALWAYS: `state/` is a WAL database the engine holds
# open and the rows belong to the process that is serving them.
inside() { docker exec "$CONTAINER" python3 -c "$@"; }

cleanup() {
  step "cleanup"
  inside '
import sqlite3, sys
db = sqlite3.connect("/state/core.db")
db.execute("DELETE FROM instagram_seen WHERE comment_id = ?", (sys.argv[1],))
db.execute("DELETE FROM instagram_messages WHERE conversation_id = ?", (sys.argv[3],))
db.execute("DELETE FROM instagram_conversations WHERE conversation_id = ?", (sys.argv[3],))
# BOTH CONVERSATIONS, and the second one is not named after the comment: a
# session left behind is one the next run MATCHES on its own first turn
# (`match_session` reads the client turns), and then the turn this test is
# watching for never happens.
ids = [r[0] for r in db.execute(
    "SELECT id FROM sessions WHERE id IN (SELECT session_id FROM messages"
    " WHERE content LIKE ? OR content LIKE ? OR content LIKE ?)",
    (f"%{sys.argv[1]}%", f"%{sys.argv[2]}%", f"%{sys.argv[3]}%"))]
holes = ",".join("?" * len(ids)) or "NULL"
approvals = [r[0] for r in db.execute(
    f"SELECT id FROM approvals WHERE session_id IN ({holes})", ids)] if ids else []
db.executemany("DELETE FROM approval_comments WHERE approval_id = ?", [(a,) for a in approvals])
db.executemany("DELETE FROM approvals WHERE id = ?", [(a,) for a in approvals])
for table in ("events", "messages", "history", "sessions"):
    column = "id" if table == "sessions" else "session_id"
    db.executemany(f"DELETE FROM {table} WHERE {column} = ?", [(i,) for i in ids])
db.commit()
print(f"took out the comment, {len(approvals)} request(s) and {len(ids)} conversation(s)")
' "$COMMENT_ID" "$ASK" "$THREAD_ID"
}
trap cleanup EXIT

step "(a) nothing connected: the tick answers instead of dying"
first="$(post "$ADAPTER/portal/chat/stream" \
  "$(jq -nc --arg m "$ASK" '{stream: true, messages: [{role: "user", content: $m}]}')")"
# EITHER OF THE TWO READ TOOLS, because both answer the same sentence with
# nothing connected and which one the model reaches for first is its business:
# what is being claimed is that this plugin's tools are on the face and that a
# turn that touches them ends in an answer.
grep -qE '"tool": "(fetch_comments|refresh_if_due)"' <<<"$first" \
  && ok "the trail shows the plugin's tools on the face" \
  || bad "neither fetch_comments nor refresh_if_due is in the stream: $(tail -3 <<<"$first")"
grep -qi 'conectar' <<<"$first" \
  && ok "the client is told the connection is missing" \
  || bad "the answer does not mention the connection: $(tail -3 <<<"$first")"
grep -q 'No pude responder:' <<<"$first" \
  && bad "the turn died" || ok "and the run ended normally"

step "(b) a comment it has seen, and a turn that answers it"
inside '
import sqlite3, sys, time
comment_id, media, permalink, post_line, who, said = sys.argv[1:7]
db = sqlite3.connect("/state/core.db")
db.execute(
    "INSERT OR REPLACE INTO instagram_seen (comment_id, media_id, permalink, post_line,"
    " username, text, is_reply, seen_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)",
    (comment_id, media, permalink, post_line, who, said, time.time()))
db.commit()
print(f"{comment_id}: @{who}")
' "$COMMENT_ID" "18000000000000009" "$PERMALINK" "$POST_LINE" "$WHO" "$SAID" \
  || bad "the comment could not be written"

before="$(pending_ids)"
stream="$(post "$ADAPTER/portal/chat/stream" \
  "$(jq -nc --arg m "$REPLY_ASK" '{stream: true, messages: [{role: "user", content: $m}]}')")"
grep -q 'Te dejé un pedido en Aprobaciones' <<<"$stream" \
  && ok "the chat closes with the pause message the code writes" \
  || bad "the chat never said it paused: $(tail -3 <<<"$stream")"
grep -q '"tool": "reply_comment"' <<<"$stream" \
  && ok "the tool trail shows reply_comment" \
  || bad "reply_comment is not in the stream"
assert "$(api "$ADAPTER/portal/activity" \
  | jq '[.events[] | select(.kind == "comment.replied")] | length')" "0" \
  "nothing was answered"

step "(c) the card says what is about to go out"
new="$(comm -13 <(printf '%s\n' "$before") <(pending_ids))"
assert "$(grep -c . <<<"$new")" "1" "exactly one new request appeared"
ID="$(head -1 <<<"$new")"
[ -n "$ID" ] || { bad "no approval id: nothing else can be checked"; exit 1; }
api "$ADAPTER/portal/approvals" | jq -r --arg i "$ID" \
  '.approvals[] | select(.id == $i) | .title' | grep -q "@${WHO}" \
  && ok "the title names who commented" \
  || bad "the title is $(api "$ADAPTER/portal/approvals" | jq -r --arg i "$ID" '.approvals[] | select(.id == $i) | .title')"
BODY="$(api "$ADAPTER/portal/tickets/$ID" | jq -r '.ticket.body')"
grep -qF "$SAID" <<<"$BODY" \
  && ok "the comment is on the card" || bad "the comment is not on the card"
grep -qF "$POST_LINE" <<<"$BODY" \
  && ok "and which post it is under" || bad "the post is not on the card"
grep -qF "$PERMALINK" <<<"$BODY" \
  && ok "with the link to it" || bad "the permalink is not on the card"
grep -qF "$DRAFT" <<<"$BODY" \
  && ok "the draft answer is on the card" || bad "the draft is not on the card: $BODY"
# The draft is the LAST thing on the card and the comment sits in a table, so
# the correction box the portal preloads (`splitProposal`) is the answer and
# nothing else.
[ "$(printf '%s' "$BODY" | grep -n '^|' | tail -1 | cut -d: -f1)" \
  -lt "$(printf '%s' "$BODY" | grep -nF "$DRAFT" | tail -1 | cut -d: -f1)" ] \
  && ok "the draft is below the last table row, which is what gets corrected" \
  || bad "the draft is not the card's editable tail"

step "(d) the client approves and gets the sentence, not a broken turn"
assert "$(post "$ADAPTER/portal/approvals/$ID/approve" '{}' | jq -r '.ok')" "true" \
  "the approval answered ok"
SID="$(api "$ENDPOINT/api/sessions" | jq -r --arg p "$REPLY_ASK" \
  '.data[] | select(.preview == $p) | .id' | head -1)"
LAST="$(api "$ENDPOINT/api/sessions/$SID/messages" | jq -r '.data[-1] | "\(.role)|\(.content)"')"
grep -q '^assistant|' <<<"$LAST" \
  && ok "the run ended with an answer, not with a crash" \
  || bad "the last message is $LAST"
# The engine's own failure line is «No pude responder: <reason>» — the colon is
# what makes it that line and not the agent's «No pude responderlo: falta
# conectar…», which is an answer and the one this test wants.
grep -q 'No pude responder:' <<<"$LAST" \
  && bad "the turn died: $LAST" || ok "and it is not an engine error"
grep -qi 'conectar' <<<"$LAST" \
  && ok "the client is told the connection is missing: $(head -c 140 <<<"$LAST")" \
  || bad "the answer does not mention the connection: $(head -c 200 <<<"$LAST")"
assert "$(api "$ADAPTER/portal/activity" \
  | jq '[.events[] | select(.kind == "comment.replied")] | length')" "0" \
  "and still nothing was answered on Instagram"
pending_ids | grep -qx "$ID" \
  && bad "the request is still in the queue" || ok "the request left the queue"
assert "$(api "$ADAPTER/portal/tickets/$ID" | jq -r '.ticket.status')" "done" \
  "the request reads as closed"
# BY THE LABEL AND NOT BY THE PAYLOAD: `/portal/activity` publishes four fields
# and the approval id is not one of them. The label carries the request's title,
# which carries the handle, which is what makes it this test's event.
for kind in approval_requested approval_approved; do
  api "$ADAPTER/portal/activity" | jq -e --arg k "$kind" --arg w "@$WHO" \
    '[.events[] | select(.kind == $k and (.label | contains($w)))] | length > 0' \
    >/dev/null \
    && ok "Activity has $kind" || bad "Activity has no $kind for this request"
done

step "(e) the same door for a direct message"
inside '
import sqlite3, sys, time
thread_id, igsid, who, said = sys.argv[1:5]
now = time.time()
db = sqlite3.connect("/state/core.db")
db.execute(
    "INSERT OR REPLACE INTO instagram_conversations (conversation_id, participant_id,"
    " participant_username, last_inbound_at) VALUES (?, ?, ?, ?)",
    (thread_id, igsid, who, now - 3600))
db.execute(
    "INSERT OR REPLACE INTO instagram_messages (message_id, conversation_id, from_id,"
    " from_username, text, created_time, seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    (f"{thread_id}-1", thread_id, igsid, who, said, now - 3600, now))
db.commit()
print(f"{thread_id}: @{who}, hace una hora")
' "$THREAD_ID" "$DM_IGSID" "$DM_WHO" "$DM_SAID" || bad "the conversation could not be written"

before="$(pending_ids)"
dm="$(post "$ADAPTER/portal/chat/stream" \
  "$(jq -nc --arg m "$DM_ASK" '{stream: true, messages: [{role: "user", content: $m}]}')")"
grep -q 'Te dejé un pedido en Aprobaciones' <<<"$dm" \
  && ok "the message turn stops at the gate too" \
  || bad "the message turn never paused: $(tail -3 <<<"$dm")"
grep -q '"tool": "send_message"' <<<"$dm" \
  && ok "the tool trail shows send_message" || bad "send_message is not in the stream"
new="$(comm -13 <(printf '%s\n' "$before") <(pending_ids))"
DM_ID="$(head -1 <<<"$new")"
if [ -n "$DM_ID" ]; then
  DM_BODY="$(api "$ADAPTER/portal/tickets/$DM_ID" | jq -r '.ticket.body')"
  grep -qF "$DM_SAID" <<<"$DM_BODY" \
    && ok "what she wrote is on the card" || bad "the message is not on the card"
  grep -qF "@$DM_WHO" <<<"$DM_BODY" \
    && ok "and who wrote it" || bad "the person is not on the card"
  grep -q 'Quedan .* h del plazo' <<<"$DM_BODY" \
    && ok "with how much of the 24 hours is left" \
    || bad "the window is not on the card: $DM_BODY"
  grep -qF "$DM_DRAFT" <<<"$DM_BODY" \
    && ok "the draft answer is on the card" || bad "the draft is not on the card"
  [ "$(printf '%s' "$DM_BODY" | grep -n '^|' | tail -1 | cut -d: -f1)" \
    -lt "$(printf '%s' "$DM_BODY" | grep -nF "$DM_DRAFT" | tail -1 | cut -d: -f1)" ] \
    && ok "and it is the card's editable tail" \
    || bad "the draft is not the card's editable tail"
  assert "$(post "$ADAPTER/portal/approvals/$DM_ID/approve" '{}' | jq -r '.ok')" "true" \
    "the approval answered ok"
  assert "$(api "$ADAPTER/portal/activity" \
    | jq '[.events[] | select(.kind == "message.sent")] | length')" "0" \
    "nothing was sent to anybody"
else
  bad "no approval id for the message: nothing else can be checked"
fi

step "(f) result"
[ "$FAILURES" -eq 0 ] && printf 'COMMENTS GATE PASS - 0 failures\n' \
  || printf 'COMMENTS GATE FAIL - %s failures\n' "$FAILURES"
exit $((FAILURES > 0))
