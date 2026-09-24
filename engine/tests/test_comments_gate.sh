#!/usr/bin/env bash
# Answering a comment or a message goes out with no stop; hiding one stops at
# the gate, and its card says what is about to be hidden.
#
#     ./tests/test_comments_gate.sh          ~1 minute, ~US$0.02
#
# Runs against the LIVE container, four turns, with IG_* unset — which is the
# state every agent is in until the client's token lands, and the reason this
# test can be run as often as it likes: a reply on a public thread is one
# irreversible thing on a real account. What an answer WRITES when it does go
# out — the Activity line with the words, the ticket closed, the one-answer
# mark — is asserted with the Graph mocked and no model at all
# (`tests/test_instagram_comments.py`, `tests/test_instagram_messages.py`).
#
#   a. with nothing connected, the tick ANSWERS: one turn asking for the
#      comments comes back with «Tu cuenta de Instagram todavía no está
#      conectada…», with nothing waiting for the client
#   b. a comment the agent has seen, and one turn asking for an answer to it:
#      reply_comment is CALLED, the turn does NOT stop, no request appears in
#      Aprobaciones, and the client is told the connection is missing (since
#      24/9/2026 answers do not wait for her yes)
#   c. the same for a DIRECT MESSAGE: send_message called, no stop, no request
#   d. HIDING STILL STOPS: a spam comment, one turn asking to hide it, the turn
#      pauses, the card carries who wrote it and what it says, and the client's
#      yes comes back with the missing connection — an answer, not a dead turn
#
# The only Spanish is what the agent and the client read.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# `SECRETS` points it at an instance's file (`instances/<name>/secrets.env`).
SECRETS="${SECRETS:-$ROOT/secrets.env}"
KEY="$(grep '^API_SERVER_KEY=' "$SECRETS" | cut -d= -f2-)"
ENDPOINT="${ENDPOINT:-http://127.0.0.1:8642}"
ADAPTER="${ADAPTER:-http://127.0.0.1:8643}"
CONTAINER="${CONTAINER:-tuagente-core}"
# Ids nobody's comment is: the rows have to be the test's and never the feed's.
COMMENT_ID="c_prueba_de_la_puerta"
SPAM_ID="c_prueba_de_la_puerta_spam"
WHO="vecina.del.barrio"
SAID="¿Ustedes atienden los sábados?"
SPAMMER="gana.plata.ya"
SPAM="GANÁ PLATA DESDE CASA entrá a http://spam.example"
POST_LINE="Una ferretería que contesta a las once de la noche."
PERMALINK="https://www.instagram.com/p/PRUEBADELAPUERTA/"
DRAFT="Sí, los sábados de 9 a 13."
ASK="Fijate si hay comentarios nuevos en Instagram y contame."
# The DM half: a thread the agent has seen, and the person on the other side.
THREAD_ID="ig_dm_prueba_de_la_puerta"
DM_WHO="clienta.nueva"
DM_IGSID="7380000000000001"
DM_SAID="Hola, ¿ustedes atienden los sábados?"
DM_DRAFT="Hola, sí: los sábados de 9 a 13."
REPLY_ASK="Contestá el comentario \`${COMMENT_ID}\` de Instagram con esto, tal cual: «${DRAFT}»"
DM_ASK="Contestá el mensaje de la conversación \`${THREAD_ID}\` de Instagram con esto, tal cual: «${DM_DRAFT}»"
HIDE_ASK="Ocultá el comentario \`${SPAM_ID}\` de Instagram, es spam."
FAILURES=0

# Generous: approving waits for a whole model turn.
api() { curl -s --max-time 300 -H "Authorization: Bearer $KEY" "$@"; }
post() { api -X POST -H 'Content-Type: application/json' -d "$2" "$1"; }
ok()  { printf 'PASS  %s\n' "$1"; }
bad() { printf 'FAIL  %s\n' "$1"; FAILURES=$((FAILURES + 1)); }
step() { printf '\n-- %s\n' "$1"; }
assert() { [ "$1" = "$2" ] && ok "$3" || bad "$3 (wanted '$2', got '$1')"; }
pending_ids() { api "$ADAPTER/portal/approvals" | jq -r '.approvals[].id' | sort; }
turn() {
  post "$ADAPTER/portal/chat/stream" \
    "$(jq -nc --arg m "$1" '{stream: true, messages: [{role: "user", content: $m}]}')"
}
# WHAT THE AGENT SAID, whole: the stream cuts the answer into deltas, and a word
# split across two of them is in no single line.
said() {
  sed -n 's/^data: //p' <<<"$1" | grep -v '^\[DONE\]' \
    | jq -rj '.choices[0].delta.content // empty' 2>/dev/null
}

# FROM INSIDE THE CONTAINER, ALWAYS: `state/` is a WAL database the engine holds
# open and the rows belong to the process that is serving them.
inside() { docker exec "$CONTAINER" python3 -c "$@"; }

cleanup() {
  step "cleanup"
  inside '
import sqlite3, sys
db = sqlite3.connect("/state/core.db")
db.execute("DELETE FROM instagram_seen WHERE comment_id IN (?, ?)", (sys.argv[1], sys.argv[4]))
db.execute("DELETE FROM instagram_marks WHERE kind = ? AND id = ?", ("replied", sys.argv[1]))
db.execute("DELETE FROM instagram_messages WHERE conversation_id = ?", (sys.argv[3],))
db.execute("DELETE FROM instagram_conversations WHERE conversation_id = ?", (sys.argv[3],))
# EVERY CONVERSATION THIS TEST OPENED, and not only by the comment id: a
# session left behind is one the next run MATCHES on its own first turn
# (`match_session` reads the client turns), and then the turn this test is
# watching for never happens.
ids = [r[0] for r in db.execute(
    "SELECT id FROM sessions WHERE id IN (SELECT session_id FROM messages"
    " WHERE content LIKE ? OR content LIKE ? OR content LIKE ? OR content LIKE ?)",
    tuple(f"%{a}%" for a in (sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4])))]
holes = ",".join("?" * len(ids)) or "NULL"
approvals = [r[0] for r in db.execute(
    f"SELECT id FROM approvals WHERE session_id IN ({holes})", ids)] if ids else []
db.executemany("DELETE FROM approval_comments WHERE approval_id = ?", [(a,) for a in approvals])
db.executemany("DELETE FROM approvals WHERE id = ?", [(a,) for a in approvals])
for table in ("events", "messages", "history", "sessions"):
    column = "id" if table == "sessions" else "session_id"
    db.executemany(f"DELETE FROM {table} WHERE {column} = ?", [(i,) for i in ids])
db.commit()
print(f"took out the comments, {len(approvals)} request(s) and {len(ids)} conversation(s)")
' "$COMMENT_ID" "$ASK" "$THREAD_ID" "$SPAM_ID"
}
trap cleanup EXIT

seed_comment() {
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
' "$1" "18000000000000009" "$PERMALINK" "$POST_LINE" "$2" "$3"
}

step "(a) nothing connected: the tick answers instead of dying"
first="$(turn "$ASK")"
# EITHER OF THE TWO READ TOOLS, because both answer the same sentence with
# nothing connected and which one the model reaches for first is its business:
# what is being claimed is that this plugin's tools are on the face and that a
# turn that touches them ends in an answer.
grep -qE '"tool": "(fetch_comments|refresh_if_due)"' <<<"$first" \
  && ok "the trail shows the plugin's tools on the face" \
  || bad "neither fetch_comments nor refresh_if_due is in the stream: $(said "$first")"
grep -qi 'conect' <<<"$(said "$first")" \
  && ok "the client is told the connection is missing" \
  || bad "the answer does not mention the connection: $(said "$first")"
grep -q 'No pude responder:' <<<"$first" \
  && bad "the turn died" || ok "and the run ended normally"

step "(b) a comment it has seen, answered with no stop"
seed_comment "$COMMENT_ID" "$WHO" "$SAID" || bad "the comment could not be written"
before="$(pending_ids)"
stream="$(turn "$REPLY_ASK")"
grep -q '"tool": "reply_comment"' <<<"$stream" \
  && ok "the tool trail shows reply_comment" \
  || bad "reply_comment is not in the stream: $(said "$stream")"
grep -q 'Te dejé un pedido en Aprobaciones' <<<"$stream" \
  && bad "the reply stopped at the gate" || ok "the turn did not stop for a yes"
assert "$(comm -13 <(printf '%s\n' "$before") <(pending_ids) | grep -c .)" "0" \
  "no request appeared in Aprobaciones"
grep -qi 'conect' <<<"$(said "$stream")" \
  && ok "the client is told the connection is missing" \
  || bad "the answer does not mention the connection: $(said "$stream")"
grep -q 'No pude responder:' <<<"$stream" \
  && bad "the turn died" || ok "and the run ended normally"

step "(c) a direct message, answered with no stop"
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
dm="$(turn "$DM_ASK")"
grep -q '"tool": "send_message"' <<<"$dm" \
  && ok "the tool trail shows send_message" \
  || bad "send_message is not in the stream: $(said "$dm")"
grep -q 'Te dejé un pedido en Aprobaciones' <<<"$dm" \
  && bad "the message stopped at the gate" || ok "the turn did not stop for a yes"
assert "$(comm -13 <(printf '%s\n' "$before") <(pending_ids) | grep -c .)" "0" \
  "no request appeared in Aprobaciones"

step "(d) hiding still stops, and the card says what goes"
seed_comment "$SPAM_ID" "$SPAMMER" "$SPAM" || bad "the spam could not be written"
before="$(pending_ids)"
hide="$(turn "$HIDE_ASK")"
grep -q '"tool": "hide_comment"' <<<"$hide" \
  && ok "the tool trail shows hide_comment" || bad "hide_comment is not in the stream"
grep -q 'Te dejé un pedido en Aprobaciones' <<<"$hide" \
  && ok "the chat closes with the pause message the code writes" \
  || bad "the hide never paused: $(said "$hide")"
new="$(comm -13 <(printf '%s\n' "$before") <(pending_ids))"
assert "$(grep -c . <<<"$new")" "1" "exactly one new request appeared"
ID="$(head -1 <<<"$new")"
[ -n "$ID" ] || { bad "no approval id: nothing else can be checked"; exit 1; }
api "$ADAPTER/portal/approvals" | jq -r --arg i "$ID" \
  '.approvals[] | select(.id == $i) | .title' | grep -q "@${SPAMMER}" \
  && ok "the title names who wrote it" \
  || bad "the title is $(api "$ADAPTER/portal/approvals" | jq -r --arg i "$ID" '.approvals[] | select(.id == $i) | .title')"
BODY="$(api "$ADAPTER/portal/tickets/$ID" | jq -r '.ticket.body')"
grep -qF "$SPAM" <<<"$BODY" \
  && ok "the comment is on the card" || bad "the comment is not on the card: $BODY"
grep -qF "$PERMALINK" <<<"$BODY" \
  && ok "with the link to its post" || bad "the permalink is not on the card"
assert "$(post "$ADAPTER/portal/approvals/$ID/approve" '{}' | jq -r '.ok')" "true" \
  "the approval answered ok"
SID="$(api "$ENDPOINT/api/sessions" | jq -r --arg p "$HIDE_ASK" \
  '.data[] | select(.preview == $p) | .id' | head -1)"
LAST="$(api "$ENDPOINT/api/sessions/$SID/messages" | jq -r '.data[-1] | "\(.role)|\(.content)"')"
grep -q '^assistant|' <<<"$LAST" \
  && ok "the run ended with an answer, not with a crash" \
  || bad "the last message is $LAST"
# The engine's own failure line is «No pude responder: <reason>» — the colon is
# what makes it that line and not the agent's «No pude ocultarlo: falta
# conectar…», which is an answer and the one this test wants.
grep -q 'No pude responder:' <<<"$LAST" \
  && bad "the turn died: $LAST" || ok "and it is not an engine error"
pending_ids | grep -qx "$ID" \
  && bad "the request is still in the queue" || ok "the request left the queue"

step "(e) and nothing reached Instagram"
for kind in comment.replied message.sent comment.hidden; do
  assert "$(api "$ADAPTER/portal/activity" \
    | jq --arg k "$kind" '[.events[] | select(.kind == $k)] | length')" "0" \
    "no $kind with nothing connected"
done

step "(f) result"
[ "$FAILURES" -eq 0 ] && printf 'COMMENTS GATE PASS - 0 failures\n' \
  || printf 'COMMENTS GATE FAIL - %s failures\n' "$FAILURES"
exit $((FAILURES > 0))
