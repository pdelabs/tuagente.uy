#!/usr/bin/env python3
"""The comments, without Instagram. `python3 engine/tests/test_instagram_comments.py`.

The `instagram` plugin's tools called DIRECTLY INSIDE THE CONTAINER with the
Graph behind an `httpx.MockTransport`. Free, a second, no model and no network —
and it is where the whole mechanism can be asserted, because answering a comment
is one public thing on a real account and cannot be run twice.

  a. A TICK COMES BACK WITH THE THREAD, NOT THE ROW — the last posts, each
     comment that has something new, and the replies already under it INCLUDING
     OURS, named «Vos», with the new ones marked. The listing carries each
     answerable comment's id, which post it is under, who wrote it and what it
     says. Ours are never new and never carry an id.
  b. AND THE SECOND TICK HAS NOTHING TO SAY — «Sin comentarios nuevos.», one
     line, so a run that found nothing costs a cent and ends.
  c. AN ANSWER GOES OUT AS A REPLY TO THAT COMMENT — `POST /{comment-id}/
     replies` with the text, and it is written into Activity. The client's
     correction REPLACES the text, the way a caption's does. AND WHEN THE
     COMMENT IS A LEAD WITH A TICKET, the answer lands on it and closes it: the
     code that sent it writes it, so a thread cannot stay «waiting» after it
     was answered.
  d. SPAM IS HIDDEN AND NOT DELETED — `POST /{comment-id}` with `hide=true`.
  e. A COMMENT THE AGENT NEVER SAW IS REFUSED — both tools, in Spanish, before
     anything leaves: the id comes from the model and the model can be wrong.
  f. THE CARD IS THE COMMENT AND THE DRAFT — the post's permalink and its first
     slide when the post is one of ours, then the comment, then the answer as
     the LAST block, which is what the portal preloads into the correction box.
  g. THE CREATOR READS THE NUMBERS — the last posts with their reach, saves,
     likes and comments, which is what it is supposed to choose a topic from.
  h. AND THE TOKEN RENEWS ITSELF — the first tick refreshes (nothing is known
     about the expiry yet), the new token is stored, THE NEXT CALL USES IT, and
     a second tick right afterwards does nothing because it is not due.

IT CLEANS UP AFTER ITSELF: the rows it wrote in `instagram_seen` and
`instagram_account`, the throwaway post and the events are gone by the end,
whatever happened.

WHERE IT POINTS. `CORE_CONTAINER` moves it onto a second instance; the default
is the main compose's `tuagente-core`.
"""

import json
import os
import subprocess
import sys

CONTAINER = os.environ.get("CORE_CONTAINER", "tuagente-core")

SESSION = "prueba-comentarios"
# The account's own handle: what tells our replies from a stranger's.
MINE = "ferreteria.prueba"
USER = "17841400000000000"
SEED_TOKEN = "el-token-del-secrets-env"
NEW_TOKEN = "el-token-renovado"
# A date nobody's day is: the post has to be the test's and never the agent's.
POST_ID = "2020-01-04-comentarios-de-prueba"
MEDIA = "18000000000000001"
PERMALINK = "https://www.instagram.com/p/PRUEBA123/"
HEAD = "Una ferretería que contesta a las once de la noche."
DRAFT = "Te cuento: el diagnóstico sale USD 200 y sale con vos."
CORRECTION = "Sí, se puede. El diagnóstico sale USD 200."

INSIDE = r"""
import json, shutil, sys, types
from pathlib import Path

# BOTH PLUGIN DIRECTORIES, the way the engine has them: every enabled plugin's
# surface is on `sys.path` at load (`core/plugins.py`), and this plugin reads the
# board for the ticket a thread already has.
sys.path.insert(0, "/opt/kit/plugins/kanban/core")
sys.path.insert(0, "/opt/kit/plugins/instagram/core")
import httpx
import ig_graph
import ig_store
import ig_tools
from PIL import Image

from core import config, db

(SESSION, MINE, USER, SEED_TOKEN, NEW_TOKEN, POST_ID, MEDIA, PERMALINK,
 HEAD, DRAFT, CORRECTION) = sys.argv[1:12]

CAPTION = HEAD + "\nLa segunda línea del pie, que no se ve en la tarjeta."
SIXTY_DAYS = 5184000

# The feed: two posts, and the comments under the first one. `c_ours` is the
# account's own reply, nested under the comment it answers, which is exactly how
# Instagram hands it back and exactly what must not come back as new.
FEED = [
    {"id": MEDIA, "caption": CAPTION, "permalink": PERMALINK,
     "timestamp": "2020-01-04T09:00:00+0000"},
    {"id": "18000000000000002", "caption": "Otro posteo sin comentarios.",
     "permalink": "https://www.instagram.com/p/PRUEBA456/",
     "timestamp": "2020-01-03T09:00:00+0000"},
]
COMMENTS = {
    MEDIA: [
        {"id": "c_pregunta", "text": "¿Cuánto sale?", "username": "juan.perez",
         "timestamp": "2020-01-04T10:00:00+0000",
         "replies": {"data": [
             {"id": "c_nuestro", "text": "Te contesto por acá.", "username": MINE,
              "timestamp": "2020-01-04T10:05:00+0000"},
             {"id": "c_respuesta", "text": "A mí también me interesa, ¿cómo hago?",
              "username": "ana.gomez", "timestamp": "2020-01-04T10:10:00+0000"},
         ]}},
        {"id": "c_spam", "text": "GANÁ PLATA DESDE CASA http://spam.example",
         "username": "cuenta.rara", "timestamp": "2020-01-04T11:00:00+0000"},
    ],
    "18000000000000002": [],
}
NUMBERS = {"reach": 320, "saved": 12, "likes": 18, "comments": 3, "shares": 2}

calls = []


def handle(request):
    form = dict(httpx.QueryParams(request.content.decode())) if request.content else {}
    params = dict(request.url.params)
    calls.append({"method": request.method, "path": request.url.path,
                  "query": params, "form": form,
                  "token": params.get("access_token") or form.get("access_token")})
    path = request.url.path
    if path == "/refresh_access_token":
        return httpx.Response(200, json={"access_token": NEW_TOKEN,
                                         "expires_in": SIXTY_DAYS, "token_type": "bearer"})
    if path == "/v21.0/me":
        return httpx.Response(200, json={"username": MINE, "id": USER})
    if path == f"/v21.0/{USER}/media":
        return httpx.Response(200, json={"data": FEED})
    if path.endswith("/comments") and request.method == "GET":
        return httpx.Response(200, json={"data": COMMENTS[path.split("/")[2]]})
    if path.endswith("/insights"):
        return httpx.Response(200, json={"data": [
            {"name": name, "values": [{"value": value}]} for name, value in NUMBERS.items()]})
    if path.endswith("/replies") and request.method == "POST":
        return httpx.Response(200, json={"id": "c_lo_que_salio"})
    if request.method == "POST" and form.get("hide"):
        return httpx.Response(200, json={"success": True})
    return httpx.Response(400, json={"error": {"message": "nadie pidió esto"}})


ig_graph.http = lambda: httpx.Client(transport=httpx.MockTransport(handle))

tools = {name: tool.function for name, tool in ig_tools.toolset().tools.items()}
gated = {name: tool.function for name, tool in ig_tools.gated().tools.items()}
numbers = {name: tool.function for name, tool in ig_tools.performance().tools.items()}
ctx = types.SimpleNamespace(deps=types.SimpleNamespace(session_id=SESSION))
NOTE = ig_tools.ApprovalNote(what="x", if_approved="x", if_rejected="x", why="x")

out = {}
post = config.WORKSPACE / "posteos" / POST_ID
try:
    import os
    os.environ["IG_ACCESS_TOKEN"] = SEED_TOKEN
    os.environ["IG_USER_ID"] = USER

    # A post of ours that went out as this media: the card's picture comes from
    # the folder, which is a convention of the workspace and not an import.
    post.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (8, 10), (20, 19, 31)).save(post / "01.png")
    (post / "post.json").write_text(json.dumps({
        "id": POST_ID, "slug": "comentarios-de-prueba", "date": POST_ID[:10],
        "format": "feed", "caption": CAPTION, "alt": "una prueba",
        "alts": ["una prueba"], "hashtags": ["ferreteria"], "images": ["01.png"],
        "prompts": ["brief"], "versions": {},
        "created_at": "2020-01-04T09:00:00-03:00", "flow": None,
        "published": {"at": "2020-01-04T09:30:00-03:00", "media_id": MEDIA,
                      "permalink": PERMALINK},
    }, ensure_ascii=False, indent=2))

    # (h) the token, before anything else: nothing is known about its expiry, so
    # the first tick renews it and everything after this uses the new one.
    out["refresh_first"] = tools["refresh_if_due"](ctx)
    out["stored_token"] = ig_store.current_token()
    out["refresh_again"] = tools["refresh_if_due"](ctx)
    out["refresh_calls"] = len([c for c in calls if c["path"] == "/refresh_access_token"])

    # (a) and (b) the two ticks.
    out["first_tick"] = tools["fetch_comments"](ctx)
    out["second_tick"] = tools["fetch_comments"](ctx)
    out["tokens_used"] = sorted({c["token"] for c in calls if c["token"]})
    out["rows"] = [dict(r) for r in db.query(
        "SELECT comment_id, media_id, username, is_reply, permalink, post_line, text"
        " FROM instagram_seen ORDER BY comment_id")]

    # (f) the card, before the answer goes anywhere.
    title, body = ig_tools.reply_card({"comment_id": "c_pregunta", "text": DRAFT})
    out["card"] = {"title": title, "body": body}
    out["hide_card"] = list(ig_tools.hide_card({"comment_id": "c_spam"}))

    # A lead's ticket, the way the skill has the face open one: the answer has
    # to land on it and close it.
    import board_store
    lead, _ = board_store.create(
        title="Comentario de @juan.perez en «…»", body="¿Cuánto sale?",
        source="instagram", source_ref="c_pregunta", session_id=SESSION)
    out["lead"] = lead

    # (c) the answer, and the correction that replaces it.
    out["replied"] = gated["reply_comment"](ctx, "c_pregunta", DRAFT, NOTE)
    out["lead_after"] = dict(board_store.row_of(lead))
    out["lead_comments"] = board_store.comments(lead)
    out["corrected"] = gated["reply_comment"](
        ctx, "c_respuesta", DRAFT, NOTE, client_correction=CORRECTION)
    # (d) the spam.
    out["hidden"] = gated["hide_comment"](ctx, "c_spam", NOTE)

    # (e) something the agent never saw.
    for name, args in (("reply_comment", ("c_inventado", DRAFT, NOTE)),
                       ("hide_comment", ("c_inventado", NOTE))):
        try:
            gated[name](ctx, *args)
            out[f"unknown_{name}"] = ""
        except Exception as exc:
            out[f"unknown_{name}"] = f"{type(exc).__name__}: {exc}"

    # (g) what the creator reads.
    out["performance"] = numbers["recent_performance"](ctx)

    out["calls"] = calls
    out["events"] = [dict(r) for r in db.query(
        "SELECT kind, label, payload FROM events WHERE session_id = ? ORDER BY id", (SESSION,))]
    print(json.dumps(out, ensure_ascii=False, default=str))
finally:
    for ticket in db.query("SELECT id FROM tickets WHERE source = ?", ("instagram",)):
        db.write("DELETE FROM ticket_comments WHERE ticket_id = ?", (ticket["id"],))
        db.write("DELETE FROM tickets WHERE id = ?", (ticket["id"],))
    shutil.rmtree(post, ignore_errors=True)
    db.write("DELETE FROM instagram_seen WHERE comment_id LIKE 'c_%'", ())
    db.write("DELETE FROM instagram_account", ())
    db.write("DELETE FROM events WHERE session_id = ?", (SESSION,))
"""


def judge(name: str, problems: list[str]) -> list[str]:
    """One line per claim, so a failure is read where it happened."""
    print(f"  {name}: " + ("PASS" if not problems else "FAIL — " + "; ".join(problems)))
    return problems


def main() -> int:
    print(f"container: {CONTAINER}")
    done = subprocess.run(
        ["docker", "exec", CONTAINER, "python3", "-c", INSIDE, SESSION, MINE, USER,
         SEED_TOKEN, NEW_TOKEN, POST_ID, MEDIA, PERMALINK, HEAD, DRAFT, CORRECTION],
        capture_output=True, text=True,
    )
    if done.returncode != 0:
        print(done.stderr.strip()[-3000:])
        print("INSTAGRAM COMMENTS: FAIL")
        return 1
    measured = json.loads(done.stdout)
    calls = measured["calls"]
    failures = []

    # (a) the tick
    problems = []
    listing = measured["first_tick"]
    print(f"  {listing.splitlines()[0]}")
    for wanted in ("c_pregunta", "c_respuesta", "c_spam"):
        if wanted not in listing:
            problems.append(f"{wanted} is not in the listing")
    if "`c_nuestro`" in listing:
        problems.append("our own reply came back with an id, as if it were answerable")
    if "Vos: «Te contesto por acá.»" not in listing:
        problems.append("our own reply is not in the thread as context")
    if "(nuevo)" not in listing:
        problems.append("nothing is marked as new")
    if "Te contesto por acá.» (nuevo)" in listing:
        problems.append("our own reply came back marked as new")
    if "@juan.perez" not in listing or "¿Cuánto sale?" not in listing:
        problems.append("the listing does not say who wrote it or what it says")
    if HEAD not in listing:
        problems.append("the listing does not say which post it is under")
    if PERMALINK not in listing:
        problems.append("the listing carries no link to the post")
    if "respuesta" not in listing:
        problems.append("a reply is not marked as one")
    rows = {row["comment_id"]: row for row in measured["rows"]}
    if set(rows) != {"c_pregunta", "c_respuesta", "c_spam"}:
        problems.append(f"what was written down is {sorted(rows)}")
    elif rows["c_respuesta"]["is_reply"] != 1 or rows["c_pregunta"]["is_reply"] != 0:
        problems.append("the row does not say which one is a reply")
    elif rows["c_pregunta"]["media_id"] != MEDIA:
        problems.append("the row does not carry the post it is under")
    failures += judge("a. a tick brings back what is new, ours skipped", problems)

    # (b) the second tick
    problems = []
    if measured["second_tick"] != "Sin comentarios nuevos.":
        problems.append(f"it said {measured['second_tick']!r}")
    failures += judge("b. and the second tick has nothing to say", problems)

    # (c) the answer
    problems = []
    replies = [c for c in calls if c["path"].endswith("/replies")]
    if len(replies) != 2:
        problems.append(f"{len(replies)} replies went out for two answers")
    else:
        if replies[0]["path"] != "/v21.0/c_pregunta/replies":
            problems.append(f"it answered {replies[0]['path']}")
        if replies[0]["form"].get("message") != DRAFT:
            problems.append(f"what went out is {replies[0]['form'].get('message')!r}")
        if replies[1]["form"].get("message") != CORRECTION:
            problems.append("the client's correction did not replace the text: "
                            f"{replies[1]['form'].get('message')!r}")
    if "@juan.perez" not in measured["replied"]:
        problems.append(f"the tool answered {measured['replied']!r}")
    kinds = [event["kind"] for event in measured["events"]]
    if kinds.count("comment.replied") != 2:
        problems.append(f"Activity has {kinds.count('comment.replied')} comment.replied")
    elif "@juan.perez" not in measured["events"][0]["label"]:
        problems.append(f"the event reads {measured['events'][0]['label']!r}")
    if measured["lead_after"]["status"] != "done":
        problems.append(f"the lead's ticket is {measured['lead_after']['status']!r} "
                        "after being answered")
    answers = [c for c in measured["lead_comments"] if c["author"] == "agente"]
    if not any(DRAFT in c["body"] for c in answers):
        problems.append("what was answered is not on the lead's ticket")
    failures += judge("c. the answer goes out under that comment", problems)

    # (d) the spam
    problems = []
    hidden = [c for c in calls if c["form"].get("hide")]
    if len(hidden) != 1:
        problems.append(f"{len(hidden)} calls hid something")
    elif hidden[0]["path"] != "/v21.0/c_spam" or hidden[0]["form"]["hide"] != "true":
        problems.append(f"it called {hidden[0]['method']} {hidden[0]['path']} "
                        f"with {hidden[0]['form']}")
    if any("DELETE" == c["method"] for c in calls):
        problems.append("something was deleted")
    if kinds.count("comment.hidden") != 1:
        problems.append("Activity has no comment.hidden")
    failures += judge("d. spam is hidden, not deleted", problems)

    # (e) an id nobody saw
    problems = []
    for name in ("reply_comment", "hide_comment"):
        said = measured[f"unknown_{name}"]
        if not said.startswith("ModelRetry"):
            problems.append(f"{name} answered {said!r}")
        elif "No tengo ningún comentario" not in said:
            problems.append(f"{name} said {said!r}")
    if len([c for c in calls if c["path"].endswith("/replies")]) != 2:
        problems.append("the unknown id still reached Instagram")
    failures += judge("e. a comment the agent never saw is refused", problems)

    # (f) the card
    problems = []
    card = measured["card"]
    body = card["body"]
    if "@juan.perez" not in card["title"]:
        problems.append(f"the title is {card['title']!r}")
    for wanted in (PERMALINK, "¿Cuánto sale?", HEAD, DRAFT):
        if wanted not in body:
            problems.append(f"the card does not carry {wanted!r}")
    if f"](/portal/posts/{POST_ID}/01.png)" not in body:
        problems.append("the post's first slide is not on the card")
    lines = body.splitlines()
    last_row = max((i for i, line in enumerate(lines) if line.strip().startswith("|")),
                   default=-1)
    draft_at = max((i for i, line in enumerate(lines) if DRAFT in line), default=-1)
    if not last_row < draft_at:
        problems.append("the answer is not the card's editable tail")
    if len(measured["hide_card"][1].splitlines()) < 3:
        problems.append("the hide card says nothing about the comment")
    failures += judge("f. the card is the comment and the draft", problems)

    # (g) the numbers
    problems = []
    performance = measured["performance"]
    for wanted in ("alcance 320", "guardados 12", "me gusta 18", "comentarios 3",
                   HEAD, PERMALINK, "2020-01-04"):
        if wanted not in performance:
            problems.append(f"it does not say {wanted!r}")
    if performance.count("\n- ") + performance.startswith("- ") < 1:
        problems.append("it is not a listing")
    failures += judge("g. the creator reads the numbers", problems)

    # (h) the token
    problems = []
    if measured["stored_token"] != NEW_TOKEN:
        problems.append(f"what was stored is {measured['stored_token']!r}")
    if "días" not in measured["refresh_first"]:
        problems.append(f"the refresh said {measured['refresh_first']!r}")
    if "al día" not in measured["refresh_again"]:
        problems.append(f"the second one said {measured['refresh_again']!r}")
    if measured["refresh_calls"] != 1:
        problems.append(f"{measured['refresh_calls']} refreshes for one due token")
    if measured["tokens_used"] != sorted([SEED_TOKEN, NEW_TOKEN]):
        problems.append(f"the calls went out with {measured['tokens_used']}")
    after = [c["token"] for c in calls if c["path"].endswith("/comments")]
    if set(after) != {NEW_TOKEN}:
        problems.append(f"the calls after the refresh used {set(after)}")
    failures += judge("h. the token renews itself and the next call uses it", problems)

    print("INSTAGRAM COMMENTS: PASS" if not failures else "INSTAGRAM COMMENTS: FAIL")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
