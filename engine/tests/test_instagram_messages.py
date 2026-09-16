#!/usr/bin/env python3
"""The direct messages, without Instagram. `python3 engine/tests/test_instagram_messages.py`.

The `instagram` plugin's message tools called DIRECTLY INSIDE THE CONTAINER with
the Graph behind an `httpx.MockTransport`. Free, a second, no model and no
network — and the only place the 24-hour window can be asserted at all, because
it is a clock and a live test would have to wait a day to see it close.

  a. A TICK BRINGS BACK THE WHOLE CONVERSATION, not the new line — every thread
     with something new, oldest first, ours named «Vos», the new ones marked,
     with the person, HOW MUCH OF THE 24 HOURS IS LEFT and the board's ticket
     when there is one. The tick after it says «Sin mensajes nuevos.»
  b. AND AN OLD QUESTION IS STILL THERE WHEN A NUDGE ARRIVES — the regression
     this rule was bought with (16/9/2026, our own account): a second tick with
     one new message carries the QUESTION FROM BEFORE, unmarked, so the answer
     can be to the person and not to the last line. Ours are written down and
     named, never listed as new.
  c. THE ANSWER IS THE CALL META DOCUMENTS — `POST /{IG_USER_ID}/messages`, a
     JSON body carrying the recipient's IGSID and the text, the token as a
     Bearer header. The recipient comes from the CONVERSATION and never from
     the model. The client's correction replaces the text.
  d. PAST 24 HOURS IT DOES NOT GO OUT — the tool answers the Spanish sentence
     that says why and what to do instead, and nothing is sent. Meta's clock,
     checked again in the body because a request can sit in the queue overnight.
  e. A CONVERSATION THE AGENT NEVER SAW IS REFUSED — in Spanish, before
     anything leaves.
  f. THE CARD IS THE PERSON, THE CLOCK, THE THREAD AND THE DRAFT — the thread
     as table rows with ours marked, so the answer is the editable tail the
     portal preloads into the correction box.

IT CLEANS UP AFTER ITSELF: the rows it wrote in the three tables and the events
are gone by the end, whatever happened.
"""

import json
import os
import subprocess
import sys

CONTAINER = os.environ.get("CORE_CONTAINER", "tuagente-core")

SESSION = "prueba-mensajes"
USER = "17841400000000000"
MINE = "ferreteria.prueba"
TOKEN = "el-token-de-los-mensajes"
# The person who wrote, and her Instagram-scoped id: what a reply is addressed to.
WHO = "vecina.del.barrio"
IGSID = "7381234567890123"
OPEN_THREAD = "aWdfZG1fcHJ1ZWJhX2FiaWVydGE"
CLOSED_THREAD = "aWdfZG1fcHJ1ZWJhX3ZlbmNpZGE"
ASKED = "Hola, ¿ustedes atienden los sábados?"
ANSWERED = "Sí, los sábados de 9 a 13."
DRAFT = "Sí, de 9 a 13. ¿De qué es tu negocio?"
CORRECTION = "Sí, sábados de 9 a 13. ¿Qué tipo de negocio tenés?"

INSIDE = r"""
import json, sys, types
from datetime import datetime, timedelta, timezone

# BOTH PLUGIN DIRECTORIES, the way the engine has them: every enabled plugin's
# surface is on `sys.path` at load (`core/plugins.py`), and this plugin reads the
# board for the ticket a thread already has.
sys.path.insert(0, "/opt/kit/plugins/kanban/core")
sys.path.insert(0, "/opt/kit/plugins/instagram/core")
import httpx
import ig_graph
import ig_store
import ig_tools

from core import db

(SESSION, USER, MINE, TOKEN, WHO, IGSID, OPEN_THREAD, CLOSED_THREAD,
 ASKED, ANSWERED, DRAFT, CORRECTION) = sys.argv[1:13]


def stamp(hours):
    "Graph's own format, `hours` ago."
    when = datetime.now(timezone.utc) - timedelta(hours=hours)
    return when.strftime(ig_graph.WHEN)


THEM = {"username": WHO, "id": IGSID}
US = {"username": MINE, "id": USER}
# Newest first, which is how Meta hands a thread back.
THREADS = {
    OPEN_THREAD: [
        {"id": "m_nuestro", "created_time": stamp(1.5), "from": US,
         "to": {"data": [THEM]}, "message": ANSWERED},
        {"id": "m_pregunta", "created_time": stamp(2), "from": THEM,
         "to": {"data": [US]}, "message": ASKED},
        {"id": "m_saludo", "created_time": stamp(3), "from": THEM,
         "to": {"data": [US]}, "message": "Hola!"},
    ],
    # Twenty-five hours: Meta's window is shut and nothing can be sent.
    CLOSED_THREAD: [
        {"id": "m_viejo", "created_time": stamp(25), "from": THEM,
         "to": {"data": [US]}, "message": "¿Hacen envíos al interior?"},
    ],
}
CONVERSATIONS = [
    {"id": OPEN_THREAD, "updated_time": stamp(1.5)},
    {"id": CLOSED_THREAD, "updated_time": stamp(25)},
]

calls = []


def handle(request):
    body = None
    if request.content:
        try:
            body = json.loads(request.content.decode())
        except ValueError:
            body = dict(httpx.QueryParams(request.content.decode()))
    params = dict(request.url.params)
    calls.append({"method": request.method, "path": request.url.path, "query": params,
                  "body": body, "auth": request.headers.get("authorization"),
                  "type": request.headers.get("content-type")})
    path = request.url.path
    if path == "/v21.0/me/conversations":
        return httpx.Response(200, json={"data": CONVERSATIONS})
    for thread_id, messages in THREADS.items():
        if path == f"/v21.0/{thread_id}":
            return httpx.Response(200, json={"id": thread_id,
                                             "messages": {"data": messages}})
    if path == f"/v21.0/{USER}/messages" and request.method == "POST":
        return httpx.Response(200, json={"recipient_id": IGSID, "message_id": "m_salido"})
    return httpx.Response(400, json={"error": {"message": "nadie pidió esto"}})


ig_graph.http = lambda: httpx.Client(transport=httpx.MockTransport(handle))

# THE NUDGE: what the person writes when nobody answered the question. It
# arrives between the first tick and the second, which is the shape of the run
# that bought this rule.
NUDGE = {"id": "m_insistencia", "created_time": stamp(0.2), "from": THEM,
         "to": {"data": [US]}, "message": "hola buenas, ¿leyeron mi mensaje?"}

tools = {name: tool.function for name, tool in ig_tools.toolset().tools.items()}
gated = {name: tool.function for name, tool in ig_tools.gated().tools.items()}
ctx = types.SimpleNamespace(deps=types.SimpleNamespace(session_id=SESSION))
NOTE = ig_tools.ApprovalNote(what="x", if_approved="x", if_rejected="x", why="x")

out = {}
try:
    import os
    os.environ["IG_ACCESS_TOKEN"] = TOKEN
    os.environ["IG_USER_ID"] = USER

    # The thread's own ticket on the board: the listing has to name it.
    import board_store
    ticket_id, _ = board_store.create(
        title="Mensaje de prueba en Instagram", body=ASKED,
        source="instagram-dm", source_ref=OPEN_THREAD, session_id=SESSION)
    out["ticket_id"] = ticket_id

    # (a) the first tick, (b) the nudge, and then nothing.
    out["first_tick"] = tools["fetch_messages"](ctx)
    THREADS[OPEN_THREAD].insert(0, NUDGE)
    out["nudge_tick"] = tools["fetch_messages"](ctx)
    out["third_tick"] = tools["fetch_messages"](ctx)
    out["rows"] = [dict(r) for r in db.query(
        "SELECT message_id, conversation_id, from_id, from_username, text"
        " FROM instagram_messages ORDER BY created_time")]
    out["threads"] = [dict(r) for r in db.query(
        "SELECT * FROM instagram_conversations ORDER BY conversation_id")]

    # (f) the card, before anything goes out.
    title, body = ig_tools.send_card({"conversation_id": OPEN_THREAD, "text": DRAFT})
    out["card"] = {"title": title, "body": body}

    # (c) the answer, and the correction that replaces it.
    out["sent"] = gated["send_message"](ctx, OPEN_THREAD, DRAFT, NOTE)
    out["corrected"] = gated["send_message"](
        ctx, OPEN_THREAD, DRAFT, NOTE, client_correction=CORRECTION)
    # (d) the one whose window shut.
    out["closed"] = gated["send_message"](ctx, CLOSED_THREAD, DRAFT, NOTE)
    out["closed_card"] = ig_tools.send_card({"conversation_id": CLOSED_THREAD,
                                             "text": DRAFT})[1]

    # (e) a thread nobody ever saw.
    try:
        gated["send_message"](ctx, "no-existe", DRAFT, NOTE)
        out["unknown"] = ""
    except Exception as exc:
        out["unknown"] = f"{type(exc).__name__}: {exc}"

    out["calls"] = calls
    out["events"] = [dict(r) for r in db.query(
        "SELECT kind, label, payload FROM events WHERE session_id = ? ORDER BY id", (SESSION,))]
    print(json.dumps(out, ensure_ascii=False, default=str))
finally:
    for ticket in db.query("SELECT id FROM tickets WHERE source = ?", ("instagram-dm",)):
        db.write("DELETE FROM ticket_comments WHERE ticket_id = ?", (ticket["id"],))
        db.write("DELETE FROM tickets WHERE id = ?", (ticket["id"],))
    for thread_id in (OPEN_THREAD, CLOSED_THREAD):
        db.write("DELETE FROM instagram_messages WHERE conversation_id = ?", (thread_id,))
        db.write("DELETE FROM instagram_conversations WHERE conversation_id = ?", (thread_id,))
    db.write("DELETE FROM instagram_account", ())
    db.write("DELETE FROM events WHERE session_id = ?", (SESSION,))
"""


def judge(name: str, problems: list[str]) -> list[str]:
    print(f"  {name}: " + ("PASS" if not problems else "FAIL — " + "; ".join(problems)))
    return problems


def main() -> int:
    print(f"container: {CONTAINER}")
    done = subprocess.run(
        ["docker", "exec", CONTAINER, "python3", "-c", INSIDE, SESSION, USER, MINE,
         TOKEN, WHO, IGSID, OPEN_THREAD, CLOSED_THREAD, ASKED, ANSWERED, DRAFT,
         CORRECTION],
        capture_output=True, text=True,
    )
    if done.returncode != 0:
        print(done.stderr.strip()[-3000:])
        print("INSTAGRAM MESSAGES: FAIL")
        return 1
    measured = json.loads(done.stdout)
    calls = measured["calls"]
    failures = []

    # (a) the tick
    problems = []
    listing = measured["first_tick"]
    print(f"  {listing.splitlines()[0]}")
    for wanted in (OPEN_THREAD, CLOSED_THREAD, f"@{WHO}", ASKED, "Hola!"):
        if wanted not in listing:
            problems.append(f"the listing does not carry {wanted!r}")
    # OURS ARE CONTEXT, NAMED AND NOT MARKED NEW: the thread is what gets read.
    if "Vos: «" not in listing:
        problems.append("our own answer is not in the thread as «Vos»")
    if f"Vos: «{ANSWERED}» (nuevo)" in listing:
        problems.append("our own answer came back as something new")
    if "Quedan" not in listing:
        problems.append("it does not say how much of the window is left")
    if "VENCIÓ" not in listing:
        problems.append("it does not say which window is already shut")
    if f"tarea {measured['ticket_id']}" not in listing:
        problems.append("the thread's ticket is not named in the listing")
    # Oldest first: the greeting is above the question it came before.
    if listing.index("Hola!") > listing.index(ASKED):
        problems.append("the thread is not oldest first")
    if measured["third_tick"] != "Sin mensajes nuevos.":
        problems.append(f"the tick after the nudge said {measured['third_tick']!r}")
    listed = [c for c in calls if c["path"] == "/v21.0/me/conversations"]
    if not listed or listed[0]["query"].get("platform") != "instagram":
        problems.append("the conversations call did not carry platform=instagram")
    expanded = [c for c in calls if c["path"] == f"/v21.0/{OPEN_THREAD}"]
    if not expanded or "messages{" not in expanded[0]["query"].get("fields", ""):
        problems.append("the thread was not asked for with its messages expanded")
    failures += judge("a. a tick brings back the whole conversation", problems)

    # (b) the nudge, and the question from before
    problems = []
    nudge = measured["nudge_tick"]
    if "¿leyeron mi mensaje?" not in nudge:
        problems.append("the nudge is not in the listing")
    elif "¿leyeron mi mensaje?» (nuevo)" not in nudge:
        problems.append("the nudge is not marked as the new one")
    if ASKED not in nudge:
        problems.append("THE QUESTION FROM BEFORE IS GONE — this is the whole bug")
    elif f"«{ASKED}» (nuevo)" in nudge:
        problems.append("the old question came back marked as new")
    if CLOSED_THREAD in nudge:
        problems.append("a conversation with nothing new was listed")
    rows = {row["message_id"]: row for row in measured["rows"]}
    if set(rows) < {"m_saludo", "m_pregunta", "m_nuestro", "m_insistencia"}:
        problems.append(f"what was written down is {sorted(rows)}")
    elif rows["m_nuestro"]["from_id"] != USER:
        problems.append("our own message is not marked as ours")
    threads = {row["conversation_id"]: row for row in measured["threads"]}
    if threads.get(OPEN_THREAD, {}).get("participant_id") != IGSID:
        problems.append("the conversation does not carry the person's IGSID")
    if threads.get(OPEN_THREAD, {}).get("participant_username") != WHO:
        problems.append("the conversation does not carry the person's handle")
    failures += judge("b. and an old question is still there when a nudge arrives",
                      problems)

    # (c) the answer
    problems = []
    sent = [c for c in calls if c["path"] == f"/v21.0/{USER}/messages"]
    if len(sent) != 2:
        problems.append(f"{len(sent)} sends for two answers")
    else:
        if sent[0]["body"] != {"recipient": {"id": IGSID}, "message": {"text": DRAFT}}:
            problems.append(f"the body is {sent[0]['body']!r}")
        if sent[0]["auth"] != f"Bearer {TOKEN}":
            problems.append(f"the token travelled as {sent[0]['auth']!r}")
        if "application/json" not in (sent[0]["type"] or ""):
            problems.append(f"it was not sent as JSON ({sent[0]['type']!r})")
        if sent[1]["body"]["message"]["text"] != CORRECTION:
            problems.append("the client's correction did not replace the text: "
                            f"{sent[1]['body']['message']['text']!r}")
    if f"@{WHO}" not in measured["sent"]:
        problems.append(f"the tool answered {measured['sent']!r}")
    said = [e for e in measured["events"] if e["kind"] == "message.sent"]
    if len(said) != 2:
        problems.append(f"Activity has {len(said)} message.sent")
    elif f"@{WHO}" not in said[0]["label"]:
        problems.append(f"the event reads {said[0]['label']!r}")
    failures += judge("c. the answer is the call Meta documents", problems)

    # (d) the window
    problems = []
    closed = measured["closed"]
    print(f"  {closed}")
    if "24 horas" not in closed:
        problems.append(f"it said {closed!r}")
    if "tablero" not in closed:
        problems.append("it does not say what to do instead")
    if len(sent) != 2:
        problems.append("something was sent for the thread whose window is shut")
    if "VENCIÓ" not in measured["closed_card"]:
        problems.append("the card of a shut thread does not say so")
    failures += judge("d. past 24 hours it does not go out", problems)

    # (e) a thread nobody saw
    problems = []
    unknown = measured["unknown"]
    if not unknown.startswith("ModelRetry"):
        problems.append(f"it answered {unknown!r}")
    elif "No tengo ninguna conversación" not in unknown:
        problems.append(f"it said {unknown!r}")
    failures += judge("e. a conversation the agent never saw is refused", problems)

    # (f) the card
    problems = []
    card = measured["card"]
    body = card["body"]
    if f"@{WHO}" not in card["title"]:
        problems.append(f"the title is {card['title']!r}")
    for wanted in (ASKED, ANSWERED, DRAFT, "Quedan", measured["ticket_id"]):
        if wanted not in body:
            problems.append(f"the card does not carry {wanted!r}")
    if "| Vos |" not in body:
        problems.append("our own message is not marked as ours on the card")
    if body.index("Hola!") > body.index(ASKED):
        problems.append("the card's thread is not oldest first")
    lines = body.splitlines()
    last_row = max((i for i, line in enumerate(lines) if line.strip().startswith("|")),
                   default=-1)
    draft_at = max((i for i, line in enumerate(lines) if DRAFT in line), default=-1)
    if not last_row < draft_at:
        problems.append("the answer is not the card's editable tail")
    failures += judge("f. the card is the person, the clock, the thread and the draft",
                      problems)

    print("INSTAGRAM MESSAGES: PASS" if not failures else "INSTAGRAM MESSAGES: FAIL")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
