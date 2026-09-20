#!/usr/bin/env python3
"""The watcher, without Instagram. `python3 engine/tests/test_instagram_watch.py`.

`ig_tools.watch` — the function the scheduler calls every thirty seconds to find
out whether the Instagram flow has anything to do — called DIRECTLY INSIDE THE
CONTAINER with the Graph behind an `httpx.MockTransport`. No model, no network.

NEVER POINT IT AT A CONNECTED AGENT: like the other Instagram tests it clears
`instagram_account` on the way out, which is where a real token lives.

  a. THE FIRST LOOK BRINGS EVERYTHING NEW, AS THE RUN WILL READ IT — the comment
     thread and the whole conversation, in one text, with their ids. The
     message is already on its ticket: code put it there, not a model.
  b. A QUIET LOOK IS TWO CALLS AND `None` — the feed and the conversation list.
     No post is opened and no conversation is read: that is what makes looking
     every thirty seconds cost nothing.
  c. ONLY WHAT MOVED IS OPENED — a new comment moves one post's
     `comments_count`, and that post is the one call more; a new message moves
     one conversation's `updated_time`.
  d. OURS IS NOT NEWS — our own reply moves the count, the post is opened, and
     the look still says `None`.
  e. HALF A FAILURE KEEPS THE OTHER HALF — the conversations break, the comment
     that was already read (and marked as seen) still comes back.
  f. A WHOLE FAILURE IS RAISED — so the scheduler can say so in Activity.
  g. THE TOKEN IS RENEWED FROM HERE — the flow that used to do it no longer
     runs when there is nothing to do.
"""

import json
import os
import subprocess
import sys

CONTAINER = os.environ.get("CORE_CONTAINER", "tuagente-core")

INSIDE = r"""
import json, os, sys

sys.path.insert(0, "/opt/kit/plugins/kanban/core")
sys.path.insert(0, "/opt/kit/plugins/instagram/core")
import httpx
import ig_graph
import ig_store
import ig_tools

from core import db

MINE, USER = "ferreteria.prueba", "17841400000000000"
MEDIA_A, MEDIA_B = "18000000000000091", "18000000000000092"
THREAD = "t_prueba_vigilante"

state = {
    "counts": {MEDIA_A: 1, MEDIA_B: 0},
    "comments": {MEDIA_A: [
        {"id": "w_pregunta", "text": "¿Cuánto sale?", "from": {"id": "2", "username": "juan.perez"},
         "timestamp": "2020-01-04T10:00:00+0000"}], MEDIA_B: []},
    "updated": "2020-01-04T10:00:00+0000",
    "messages": [
        {"id": "w_m1", "created_time": "2020-01-04T10:00:00+0000", "message": "Hola, ¿hacen envíos?",
         "from": {"id": "99", "username": "ana.gomez"}, "to": {"data": [{"id": USER}]}}],
    "break_conversations": False, "break_everything": False,
}
calls = []


def handle(request):
    path = request.url.path
    calls.append(path)
    if state["break_everything"]:
        return httpx.Response(500, json={"error": {"message": "se cayó todo"}})
    if path == "/refresh_access_token":
        return httpx.Response(200, json={"access_token": "renovado", "expires_in": 5184000})
    if path == "/v21.0/me":
        return httpx.Response(200, json={"username": MINE, "id": USER})
    if path == f"/v21.0/{USER}/media":
        return httpx.Response(200, json={"data": [
            {"id": m, "caption": f"Posteo {m[-2:]}", "permalink": f"https://www.instagram.com/p/{m[-2:]}/",
             "comments_count": state["counts"][m]} for m in (MEDIA_A, MEDIA_B)]})
    if path.endswith("/comments"):
        return httpx.Response(200, json={"data": state["comments"][path.split("/")[2]]})
    if path == "/v21.0/me/conversations":
        if state["break_conversations"]:
            return httpx.Response(500, json={"error": {"message": "los mensajes no andan"}})
        return httpx.Response(200, json={"data": [{"id": THREAD, "updated_time": state["updated"]}]})
    if path == f"/v21.0/{THREAD}":
        return httpx.Response(200, json={"messages": {"data": list(reversed(state["messages"]))}})
    return httpx.Response(400, json={"error": {"message": "nadie pidió esto"}})


ig_graph.http = lambda: httpx.Client(transport=httpx.MockTransport(handle))


def look():
    calls.clear()
    try:
        found = ig_tools.watch()
    except Exception as exc:
        found = f"RAISED {type(exc).__name__}: {exc}"
    return {"found": found, "calls": list(calls)}


def clean():
    for ticket in db.query("SELECT id FROM tickets WHERE source_ref = ?", (THREAD,)):
        db.write("DELETE FROM ticket_comments WHERE ticket_id = ?", (ticket["id"],))
        db.write("DELETE FROM tickets WHERE id = ?", (ticket["id"],))
    db.write("DELETE FROM instagram_seen WHERE comment_id LIKE 'w_%'", ())
    db.write("DELETE FROM instagram_messages WHERE conversation_id = ?", (THREAD,))
    db.write("DELETE FROM instagram_conversations WHERE conversation_id = ?", (THREAD,))
    db.write("DELETE FROM instagram_marks WHERE id IN (?, ?, ?)", (MEDIA_A, MEDIA_B, THREAD))
    db.write("DELETE FROM instagram_account", ())


out = {}
clean()
try:
    os.environ["IG_ACCESS_TOKEN"] = "el-token-del-secrets-env"
    os.environ["IG_USER_ID"] = USER

    out["first"] = look()                                   # (a) and (g)
    out["token_after_first"] = ig_store.current_token()
    # The message a ticket is opened with is its BODY; the ones after are comments.
    out["ticket"] = [dict(r) for r in db.query(
        "SELECT source, body FROM tickets WHERE source_ref = ?", (THREAD,))]
    out["quiet"] = look()                                   # (b)

    state["counts"][MEDIA_B] = 1                            # (c) a comment on the other post
    state["comments"][MEDIA_B] = [{"id": "w_otro", "text": "Me interesa", "from": {"id": "3", "username": "lu.s"},
                                   "timestamp": "2020-01-04T11:00:00+0000"}]
    out["new_comment"] = look()
    state["updated"] = "2020-01-04T12:00:00+0000"           # (c) a message
    state["messages"].append({"id": "w_m2", "created_time": "2020-01-04T12:00:00+0000",
                              "message": "¿Y a Salto llegan?", "from": {"id": "99", "username": "ana.gomez"},
                              "to": {"data": [{"id": USER}]}})
    out["new_message"] = look()

    state["counts"][MEDIA_A] = 2                            # (d) our own reply
    state["comments"][MEDIA_A].insert(0, {"id": "w_nuestra", "text": "Te escribo.", "username": MINE,
        "from": {"id": "1", "username": MINE}, "parent_id": "w_pregunta", "timestamp": "2020-01-04T12:30:00+0000"})
    state["comments"][MEDIA_A][1]["replies"] = {"data": [{"id": "w_nuestra", "text": "Te escribo.",
                                                          "timestamp": "2020-01-04T12:30:00+0000"}]}
    out["ours"] = look()

    state["counts"][MEDIA_B] = 2                            # (e) half a failure
    state["comments"][MEDIA_B].append({"id": "w_tercero", "text": "¿Precio?", "from": {"id": "4", "username": "mar.ta"},
                                       "timestamp": "2020-01-04T13:00:00+0000"})
    state["break_conversations"] = True
    out["half"] = look()
    state["break_conversations"] = False

    state["break_everything"] = True                        # (f)
    out["broken"] = look()
    print(json.dumps(out, ensure_ascii=False, default=str))
finally:
    clean()
"""


def judge(name: str, problems: list[str]) -> list[str]:
    """One line per claim, so a failure is read where it happened."""
    print(f"  {name}: " + ("PASS" if not problems else "FAIL — " + "; ".join(problems)))
    return problems


def opened(look: dict) -> list[str]:
    """The calls of a look that are not the two every look makes."""
    return [c for c in look["calls"] if not c.endswith("/media") and not c.endswith("/me/conversations")]


def main() -> int:
    print(f"container: {CONTAINER}")
    done = subprocess.run(
        ["docker", "exec", CONTAINER, "python3", "-c", INSIDE],
        capture_output=True, text=True,
    )
    if done.returncode != 0:
        print(done.stderr.strip()[-2000:])
        print("INSTAGRAM WATCH: FAIL")
        return 1
    r = json.loads(done.stdout.strip().splitlines()[-1])
    failures = []

    problems = []
    first = r["first"]["found"] or ""
    for must in ("`w_pregunta`", "@juan.perez", "¿Cuánto sale?", "`t_prueba_vigilante`", "@ana.gomez", "¿hacen envíos?"):
        if must not in first:
            problems.append(f"the first look does not carry {must}")
    if len(r["ticket"]) != 1 or "¿hacen envíos?" not in r["ticket"][0]["body"]:
        problems.append(f"the message did not open its ticket: {r['ticket']}")
    failures += judge("a. the first look brings everything new", problems)

    problems = []
    if r["quiet"]["found"] is not None:
        problems.append(f"a quiet look said {r['quiet']['found']!r}")
    if len(r["quiet"]["calls"]) != 2 or opened(r["quiet"]):
        problems.append(f"a quiet look made {r['quiet']['calls']}")
    failures += judge("b. a quiet look is two calls and None", problems)

    problems = []
    if "w_otro" not in (r["new_comment"]["found"] or ""):
        problems.append("the new comment did not come back")
    if opened(r["new_comment"]) != ["/v21.0/18000000000000092/comments"]:
        problems.append(f"for one new comment it opened {opened(r['new_comment'])}")
    found = r["new_message"]["found"] or ""
    if "¿Y a Salto llegan?" not in found or "¿hacen envíos?" not in found:
        problems.append("the new message did not come back with its conversation")
    if opened(r["new_message"]) != ["/v21.0/t_prueba_vigilante"]:
        problems.append(f"for one new message it opened {opened(r['new_message'])}")
    failures += judge("c. only what moved is opened", problems)

    problems = []
    if r["ours"]["found"] is not None:
        problems.append(f"our own reply came back as news: {r['ours']['found']!r}")
    if "/v21.0/18000000000000091/comments" not in r["ours"]["calls"]:
        problems.append("the post whose count moved was not opened")
    failures += judge("d. ours is not news", problems)

    problems = []
    half = r["half"]["found"] or ""
    if "w_tercero" not in half or half.startswith("RAISED"):
        problems.append(f"with the messages down it gave {half[:160]!r}")
    failures += judge("e. half a failure keeps the other half", problems)

    problems = [] if str(r["broken"]["found"]).startswith("RAISED") else [f"it gave {r['broken']['found']!r}"]
    failures += judge("f. a whole failure is raised", problems)

    problems = []
    if "/refresh_access_token" not in r["first"]["calls"]:
        problems.append("the first look did not renew a token of unknown age")
    if r["token_after_first"] != "renovado":
        problems.append(f"the token in force is {r['token_after_first']!r}")
    if "/refresh_access_token" in r["quiet"]["calls"]:
        problems.append("it renewed again on the next look")
    failures += judge("g. the token is renewed from here", problems)

    print("INSTAGRAM WATCH: " + ("PASS" if not failures else "FAIL"))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
