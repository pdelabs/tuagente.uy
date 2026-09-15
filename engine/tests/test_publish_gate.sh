#!/usr/bin/env bash
# Publishing stops at the gate, and the card says what is about to go out.
#
#     ./tests/test_publish_gate.sh          ~1 minute, ~US$0.01
#
# Runs against the LIVE container, ONE turn, with IG_* and R2_* unset — which
# is the state every agent is in until the client's token lands, and the reason
# this test can be run as often as it likes: a real publish is one irreversible
# thing on a real account. The sequence itself has its own gate with no network
# at all (`tests/test_instagram.py`).
#
#   a. a throwaway post, and one turn asking for it to be published
#   b. the turn STOPS: the chat says it left a request, and nothing was called
#   c. the card names the post and shows the caption and the slides
#   d. the client approves, and the resumed turn comes back with «Falta
#      conectar Instagram…» — the run ends normally, the post is still not
#      published, and Activity carries both halves
#
# The only Spanish is what the agent and the client read.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KEY="$(grep '^API_SERVER_KEY=' "$ROOT/secrets.env" | cut -d= -f2-)"
ENDPOINT="${ENDPOINT:-http://127.0.0.1:8642}"
ADAPTER="${ADAPTER:-http://127.0.0.1:8643}"
CONTAINER="${CONTAINER:-tuagente-core}"
# A date nobody's day is: the post has to be the test's and never the agent's.
POST_ID="2020-01-03-la-puerta-de-publicar"
CAPTION_HEAD="Una ferretería que contesta a las once de la noche."
PROMPT="Publicá en Instagram el posteo «${POST_ID}»"
SLIDES=2
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
# holds open and `workspace/` is written by uid 10000. One writer, one side.
# (`tests/test_flow_gate.sh` has the measured story of the other way.)
inside() { docker exec "$CONTAINER" python3 -c "$@"; }

published_field() {
  inside '
import json, sys
from pathlib import Path
path = Path("/workspace/posteos") / sys.argv[1] / "post.json"
print(json.loads(path.read_text()).get("published") if path.is_file() else "no-post")
' "$POST_ID"
}

cleanup() {
  step "cleanup"
  inside '
import shutil, sqlite3, sys
from pathlib import Path
shutil.rmtree(Path("/workspace/posteos") / sys.argv[1], ignore_errors=True)
db = sqlite3.connect("/state/core.db")
ids = [r[0] for r in db.execute("SELECT id FROM sessions WHERE title LIKE ? OR id IN "
                                "(SELECT session_id FROM messages WHERE content LIKE ?)",
                                (f"%{sys.argv[1]}%", f"%{sys.argv[1]}%"))]
holes = ",".join("?" * len(ids)) or "NULL"
approvals = [r[0] for r in db.execute(
    f"SELECT id FROM approvals WHERE session_id IN ({holes})", ids)] if ids else []
db.executemany("DELETE FROM approval_comments WHERE approval_id = ?", [(a,) for a in approvals])
db.executemany("DELETE FROM approvals WHERE id = ?", [(a,) for a in approvals])
for table in ("events", "messages", "history", "sessions"):
    column = "id" if table == "sessions" else "session_id"
    db.executemany(f"DELETE FROM {table} WHERE {column} = ?", [(i,) for i in ids])
db.commit()
print(f"took out the post, {len(approvals)} request(s) and {len(ids)} conversation(s)")
' "$POST_ID"
}
trap cleanup EXIT

step "(a) a post to publish, and the turn that asks for it"
inside '
import json, sys
sys.path.insert(0, "/opt/kit/plugins/social/core")
import posts
from PIL import Image

post_id, head, slides = sys.argv[1], sys.argv[2], int(sys.argv[3])
directory = posts.folder(post_id)
directory.mkdir(parents=True, exist_ok=True)
names = []
for number in range(1, slides + 1):
    name = f"{number:02d}.png"
    Image.new("RGB", (1080, 1350), (20, 19, 31)).save(directory / name)
    names.append(name)
caption = head + "\nTu agente contesta, presupuesta y te avisa."
hashtags = ["ferreteria", "montevideo"]
(directory / posts.POST).write_text(json.dumps({
    "id": post_id, "slug": "la-puerta-de-publicar", "date": post_id[:10],
    "format": "carousel", "caption": caption, "alt": "una prueba",
    "alts": ["una prueba"] * slides, "hashtags": hashtags, "images": names,
    "prompts": ["brief"] * slides, "versions": {},
    "created_at": "2020-01-03T09:00:00-03:00", "flow": None,
}, ensure_ascii=False, indent=2))
(directory / posts.CAPTION).write_text(posts.caption_file(caption, hashtags))
print(f"{post_id}: {len(names)} slides")
' "$POST_ID" "$CAPTION_HEAD" "$SLIDES" || bad "the post could not be written"

before="$(pending_ids)"
stream="$(post "$ADAPTER/portal/chat/stream" \
  "$(jq -nc --arg m "$PROMPT" '{stream: true, messages: [{role: "user", content: $m}]}')")"

step "(b) the turn stops at the gate and nothing was called"
grep -q 'Te dejé un pedido en Aprobaciones' <<<"$stream" \
  && ok "the chat closes with the pause message the code writes" \
  || bad "the chat never said it paused: $(tail -3 <<<"$stream")"
grep -q '"tool": "publish_instagram"' <<<"$stream" \
  && ok "the tool trail shows publish_instagram" \
  || bad "publish_instagram is not in the stream"
assert "$(published_field)" "None" 'post.json has no `published`'
assert "$(api "$ADAPTER/portal/activity" \
  | jq '[.events[] | select(.kind == "post.published")] | length')" "0" \
  "nothing published anything"

step "(c) the card says what is about to go out"
new="$(comm -13 <(printf '%s\n' "$before") <(pending_ids))"
assert "$(grep -c . <<<"$new")" "1" "exactly one new request appeared"
ID="$(head -1 <<<"$new")"
[ -n "$ID" ] || { bad "no approval id: nothing else can be checked"; exit 1; }
api "$ADAPTER/portal/approvals" | jq -r --arg i "$ID" \
  '.approvals[] | select(.id == $i) | .title' \
  | grep -q "^Publicar en Instagram el posteo «${POST_ID}»$" \
  && ok "the title names the post" \
  || bad "the title is $(api "$ADAPTER/portal/approvals" | jq -r --arg i "$ID" '.approvals[] | select(.id == $i) | .title')"
BODY="$(api "$ADAPTER/portal/tickets/$ID" | jq -r '.ticket.body')"
grep -qF "$CAPTION_HEAD" <<<"$BODY" \
  && ok "the caption is on the card" || bad "the caption is not on the card"
grep -qF '#ferreteria #montevideo' <<<"$BODY" \
  && ok "and the hashtags with it" || bad "the hashtags are not on the card"
missing=0
for n in $(seq 1 "$SLIDES"); do
  grep -qF "](/portal/posts/${POST_ID}/0${n}.png)" <<<"$BODY" || missing=$((missing + 1))
done
assert "$missing" "0" "every slide is on the card, as a picture"
# The caption is the LAST thing on the card and the slides sit in a table, so
# the correction box the portal preloads (`splitProposal`) is the caption and
# nothing else.
[ "$(printf '%s' "$BODY" | grep -n '^|' | tail -1 | cut -d: -f1)" \
  -lt "$(printf '%s' "$BODY" | grep -nF "$CAPTION_HEAD" | tail -1 | cut -d: -f1)" ] \
  && ok "the caption is below the last table row, which is what gets corrected" \
  || bad "the caption is not the card's editable tail"

step "(d) the client approves and gets the sentence, not a broken turn"
assert "$(post "$ADAPTER/portal/approvals/$ID/approve" '{}' | jq -r '.ok')" "true" \
  "the approval answered ok"
SID="$(api "$ENDPOINT/api/sessions" | jq -r --arg p "$PROMPT" \
  '.data[] | select(.preview == $p) | .id' | head -1)"
LAST="$(api "$ENDPOINT/api/sessions/$SID/messages" | jq -r '.data[-1] | "\(.role)|\(.content)"')"
grep -q '^assistant|' <<<"$LAST" \
  && ok "the run ended with an answer, not with a crash" \
  || bad "the last message is $LAST"
grep -q 'No pude responder' <<<"$LAST" \
  && bad "the turn died: $LAST" || ok "and it is not an engine error"
grep -qi 'conectar' <<<"$LAST" \
  && ok "the client is told the connection is missing: $(head -c 140 <<<"$LAST")" \
  || bad "the answer does not mention the connection: $(head -c 200 <<<"$LAST")"
assert "$(published_field)" "None" "the post is still not published"
pending_ids | grep -qx "$ID" \
  && bad "the request is still in the queue" || ok "the request left the queue"
assert "$(api "$ADAPTER/portal/tickets/$ID" | jq -r '.ticket.status')" "done" \
  "the request reads as closed"
# BY THE LABEL AND NOT BY THE PAYLOAD: `/portal/activity` publishes four fields
# and the approval id is not one of them. The label carries the request's
# title, which carries the post's id, which is what makes it this test's event
# and not an older run's.
for kind in approval_requested approval_approved; do
  api "$ADAPTER/portal/activity" | jq -e --arg k "$kind" --arg p "$POST_ID" \
    '[.events[] | select(.kind == $k and (.label | contains($p)))] | length > 0' \
    >/dev/null \
    && ok "Activity has $kind" || bad "Activity has no $kind for this request"
done

step "(e) result"
[ "$FAILURES" -eq 0 ] && printf 'PUBLISH GATE PASS - 0 failures\n' \
  || printf 'PUBLISH GATE FAIL - %s failures\n' "$FAILURES"
exit $((FAILURES > 0))
