#!/usr/bin/env python3
"""The board. `python3 engine/tests/test_board.py`. No model, free, a second.

Two halves, because the board has two users and they are not the same one:

  THE AGENT — `create_ticket` and `update_ticket` called DIRECTLY inside the
  container, the way `test_post_tools.py` calls the post's tools. What is
  claimed is what is left in the database.

  THE CLIENT — the five calls `app/app/lib/agent.ts` types, over HTTP against
  the running container, with the key the portal travels with. What is claimed
  is what comes back on the wire, in the shape the Board reads it in.

The claims, in order:

  a. A TICKET EXISTS — the tool opens one, the id is shaped the way the chat's
     entity chips recognize it (`t_` + 12 hex, `app/app/lib/entities.tsx`), it
     is born `ready` with no `closed_at`, and it wrote an event carrying its
     own id and the session it was opened from.
  b. THE SAME THING NEVER MAKES TWO TICKETS — a second `create_ticket` with the
     same `(source, source_ref)` answers with the id that is already there and
     says so. It is the dedupe the mail and Instagram plugins are built on:
     finding the same message again is the normal case, not an error.
  c. IT MOVES, AND `closed_at` FOLLOWS THE MOVE — into `done` it is written, out
     of it it is cleared, and each move leaves a `ticket.moved` event.
  d. A STATUS THE PORTAL DOES NOT KNOW IS REFUSED — by the tool as a
     `ModelRetry` naming the five, by the route as a 400 with the same
     sentence, and in both cases the ticket does not move. A sixth status falls
     into «En curso» on the board and the client reads a ticket that is not
     moving as one that is.
  e. THE BOARD IS WHAT THE PORTAL READS — the client's own request lands
     `ready` and `source: client`, the listing is newest first, and the detail
     carries the comments, the events and the outcome.
  f. AN ID THAT IS NOT A TICKET IS A 404 — in Spanish, which is what the portal
     shows on the card the client just clicked.

IT CLEANS UP AFTER ITSELF: the tickets, their comments and the events they
wrote are gone by the end, whatever happened.
"""

import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

CORE = Path(__file__).resolve().parent.parent
CONTAINER = os.environ.get("CORE_CONTAINER", "tuagente-core")
ADAPTER = os.environ.get("CORE_ADAPTER", "http://127.0.0.1:8643")

secrets = (CORE / "secrets.env").read_text().splitlines()
KEY = next(line.split("=", 1)[1].strip() for line in secrets if line.startswith("API_SERVER_KEY="))

# The shape the chat's chips recognize a ticket by (`app/app/lib/entities.tsx`).
TICKET_ID = re.compile(r"^t_[0-9a-f]{12}$")

SESSION = "prueba-tablero"
# The pair the second half of (b) repeats. `mail` is not installed yet; what is
# being tested is the key, and the key is a string.
SOURCE, SOURCE_REF = "mail", "<prueba@tuagente.uy>"

INSIDE = r"""
import json, sqlite3, sys, types

sys.path.insert(0, "/opt/kit/plugins/kanban/core")
import board_store as board
import board_tools

SESSION, SOURCE, SOURCE_REF = sys.argv[1], sys.argv[2], sys.argv[3]
tools = {name: tool.function for name, tool in board_tools.toolset().tools.items()}
ctx = types.SimpleNamespace(deps=types.SimpleNamespace(session_id=SESSION))
opened = []


def call(tool, *args, **kwargs):
    try:
        return {"ok": tools[tool](ctx, *args, **kwargs)}
    except Exception as exc:
        return {"raised": type(exc).__name__, "said": str(exc)}


def row(ticket_id):
    found = board.row_of(ticket_id)
    return dict(found) if found else None


report = {}
try:
    # (a) the tool opens one.
    said = tools["create_ticket"](
        ctx, "Pedido de prueba", "Lo que pidió el cliente, con sus palabras.")
    ticket_id = said.split()[-1].rstrip(".")
    opened.append(ticket_id)
    report["opened"] = {"said": said, "id": ticket_id, "row": row(ticket_id)}

    # (b) the same message twice.
    first = tools["create_ticket"](
        ctx, "Consulta por mail", "El cuerpo del mail.", SOURCE, SOURCE_REF)
    again = tools["create_ticket"](
        ctx, "Consulta por mail (otra vez)", "El mismo mail, otro tick.", SOURCE, SOURCE_REF)
    from_source = board.by_source(SOURCE, SOURCE_REF)
    opened.append(from_source["id"])
    report["dedupe"] = {
        "first": first,
        "again": again,
        "rows": len(board.db.query(
            "SELECT id FROM tickets WHERE source = ? AND source_ref = ?", (SOURCE, SOURCE_REF))),
        "title": from_source["title"],
    }

    # (c) it moves, and `closed_at` follows.
    report["moves"] = []
    for status in ("in_progress", "done", "ready"):
        answer = call("update_ticket", ticket_id, status,
                      "Lo dejé resuelto." if status == "done" else None)
        current = row(ticket_id)
        report["moves"].append({
            "to": status, "answer": answer,
            "status": current["status"], "closed": current["closed_at"] is not None,
        })

    # (d) a sixth status, and a ticket that is not there.
    report["bad_status"] = call("update_ticket", ticket_id, "urgente")
    report["after_bad_status"] = row(ticket_id)["status"]
    report["unknown"] = call("update_ticket", "t_000000000000", "done")
    report["nothing_to_do"] = call("update_ticket", ticket_id)

    # The trail: every event of this session, and the id each one carries.
    db = sqlite3.connect("/state/core.db")
    db.row_factory = sqlite3.Row
    report["events"] = [
        {"kind": r["kind"], "label": r["label"], "status": r["status"],
         "session": r["session_id"], "ticket": json.loads(r["payload"] or "{}").get("ticket_id")}
        for r in db.execute(
            "SELECT * FROM events WHERE session_id = ? ORDER BY id", (SESSION,))
    ]
    report["opened_ids"] = opened
    print(json.dumps(report, ensure_ascii=False))
finally:
    db = sqlite3.connect("/state/core.db")
    for ticket_id in opened:
        db.execute("DELETE FROM tickets WHERE id = ?", (ticket_id,))
        db.execute("DELETE FROM ticket_comments WHERE ticket_id = ?", (ticket_id,))
    db.execute("DELETE FROM events WHERE session_id = ?", (SESSION,))
    db.commit()
"""

# What the HTTP half leaves behind, cleared by id at the end.
FORGET = r"""
import sqlite3, sys
db = sqlite3.connect("/state/core.db")
for ticket_id in sys.argv[1:]:
    db.execute("DELETE FROM tickets WHERE id = ?", (ticket_id,))
    db.execute("DELETE FROM ticket_comments WHERE ticket_id = ?", (ticket_id,))
    db.execute(
        "DELETE FROM events WHERE json_extract(payload, '$.ticket_id') = ?", (ticket_id,))
db.commit()
"""


def call(path: str, body: dict | None = None) -> tuple[int, dict]:
    """One portal call, with the key the magic link carries."""
    request = urllib.request.Request(
        f"{ADAPTER}{path}",
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"},
        method="POST" if body is not None else "GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read())


def judge(name: str, problems: list[str]) -> list[str]:
    """One line per claim, so a failure is read where it happened."""
    print(f"  {name}: " + ("PASS" if not problems else "FAIL — " + "; ".join(problems)))
    return problems


def the_agents_half() -> tuple[dict, list[str]]:
    done = subprocess.run(
        ["docker", "exec", CONTAINER, "python3", "-c", INSIDE, SESSION, SOURCE, SOURCE_REF],
        capture_output=True, text=True,
    )
    if done.returncode != 0:
        print(done.stderr.strip()[-1500:])
        return {}, ["the tools did not run inside the container"]
    r = json.loads(done.stdout)
    failures = []

    opened = r["opened"]
    print(f"  create_ticket -> {opened['said']}")
    failures += judge("a. a ticket exists", [
        *([] if TICKET_ID.match(opened["id"])
          else [f"{opened['id']} is not the id shape the chat's chips read"]),
        *([] if opened["row"] and opened["row"]["status"] == "ready"
          else [f"it is not born ready: {opened['row']}"]),
        *([] if opened["row"] and opened["row"]["source"] == "agent"
          else ["the agent's own ticket does not say so in `source`"]),
        *([] if opened["row"] and opened["row"]["closed_at"] is None
          else ["a brand-new ticket came with a closing date"]),
    ])

    dedupe = r["dedupe"]
    print(f"  the same mail twice -> {dedupe['again']}")
    failures += judge("b. the same thing never makes two tickets", [
        *([] if dedupe["rows"] == 1 else [f"{dedupe['rows']} tickets for one message"]),
        *([] if dedupe["first"].rstrip(".").split()[-1] in dedupe["again"]
          else [f"it answered another id: {dedupe['first']} / {dedupe['again']}"]),
        *([] if "ya estaba" in dedupe["again"].lower()
          else ["it did not say the ticket was already there"]),
        *([] if dedupe["title"] == "Consulta por mail"
          else ["the second call rewrote the ticket that was there"]),
    ])

    moves = {move["to"]: move for move in r["moves"]}
    for move in r["moves"]:
        print(f"  update_ticket({move['to']}) -> {move['answer'].get('ok', move['answer'])}"
              f" · closed_at {'written' if move['closed'] else 'empty'}")
    failures += judge("c. it moves and closed_at follows", [
        *([] if moves["in_progress"]["status"] == "in_progress" and not moves["in_progress"]["closed"]
          else ["in_progress did not move it, or closed it"]),
        *([] if moves["done"]["status"] == "done" and moves["done"]["closed"]
          else ["done did not write closed_at"]),
        *([] if moves["ready"]["status"] == "ready" and not moves["ready"]["closed"]
          else ["leaving done did not clear closed_at"]),
    ])

    bad, unknown, nothing = r["bad_status"], r["unknown"], r["nothing_to_do"]
    print(f"  {bad.get('raised')}: {bad.get('said', '')[:120]}")
    failures += judge("d. a status the portal does not know is refused", [
        *([] if bad.get("raised") == "ModelRetry" else [f"it accepted it: {bad}"]),
        *([] if all(word in bad.get("said", "") for word in
                    ("ready", "in_progress", "blocked", "done", "archived"))
          else ["the refusal does not name the five"]),
        *([] if r["after_bad_status"] == "ready" else ["the ticket moved anyway"]),
        *([] if unknown.get("raised") == "ModelRetry"
          else [f"a ticket that is not there did not come back as words: {unknown}"]),
        *([] if nothing.get("raised") == "ModelRetry"
          else [f"a call that changes nothing was accepted: {nothing}"]),
    ])

    events = r["events"]
    kinds = [event["kind"] for event in events]
    failures += judge("   the events carry the ticket and the session", [
        *([] if all(event["ticket"] for event in events)
          else [f"an event with no ticket_id: {[e for e in events if not e['ticket']]}"]),
        *([] if all(event["session"] == SESSION for event in events)
          else ["an event that does not say which session it came from"]),
        *([] if kinds.count("ticket.created") == 2
          else [f"the two tickets did not write two ticket.created: {kinds}"]),
        *([] if kinds.count("ticket.moved") == 3 else [f"the moves are not three: {kinds}"]),
        *([] if "ticket.commented" in kinds else ["the comment wrote no event"]),
    ])
    for event in events:
        print(f"    {event['kind']:<18} {event['status']:<12} {event['label']}")
    return r, failures


def the_clients_half() -> tuple[list[str], list[str]]:
    """The five calls the portal makes. Returns (ids to clean up, failures)."""
    made, failures = [], []

    status, first = call("/portal/tickets", {"title": "Conectar WhatsApp", "body": "Lo pido yo."})
    status, second = call("/portal/tickets",
                          {"title": "Revisar los precios", "body": "El segundo.",
                           "tenant": "Ferretería Rivas"})
    made += [first.get("id"), second.get("id")]
    listed = call("/portal/tickets")[1]["tickets"]
    mine = [t for t in listed if t["id"] in made]
    print(f"  POST /portal/tickets -> {first} · {second}")
    failures += judge("e. the client's own request lands on the board", [
        *([] if first.get("ok") and TICKET_ID.match(first.get("id") or "")
          else [f"it did not come back with an id: {first}"]),
        *([] if len(mine) == 2 else ["the two are not both on the board"]),
        *([] if mine and mine[0]["id"] == second["id"]
          else ["the listing is not newest first"]),
        *([] if mine and mine[0]["status"] == "ready" and mine[0]["source"] == "client"
          else [f"it is not born ready and hers: {mine[:1]}"]),
        *([] if mine and mine[0]["tenant"] == "Ferretería Rivas"
          else ["the tenant she typed is not on the ticket"]),
        *([] if mine and mine[0]["assignee"] is None and isinstance(mine[0]["created_at"], int)
          else ["the shape is not the one `Ticket` types"]),
    ])

    ticket_id = first["id"]
    call(f"/portal/tickets/{ticket_id}/comment", {"body": "Agregá el número nuevo."})
    call(f"/portal/tickets/{ticket_id}/comment", {"author": "agente", "body": "Listo, lo hice."})
    call(f"/portal/tickets/{ticket_id}/status", {"status": "done"})
    detail = call(f"/portal/tickets/{ticket_id}")[1]
    authors = [c["author"] for c in detail["comments"]]
    kinds = [event["kind"] for event in detail["events"]]
    print(f"  the thread: {authors} · {kinds} · outcome "
          f"{(detail.get('outcome') or {}).get('kind')}")
    failures += judge("   the detail is the thread", [
        *([] if authors == ["cliente", "agente"]
          else [f"the comments are not hers and its: {authors}"]),
        *([] if detail["comments"][0]["body"] == "Agregá el número nuevo."
          else ["her own words are not what came back"]),
        *([] if kinds and kinds[0] == "ticket.moved"
          else [f"the events are not newest first: {kinds}"]),
        *([] if detail["ticket"]["status"] == "done" else ["the status did not change"]),
        # The move carried no words, so the outcome is what the agent last
        # said on the ticket: that is the banner the Board draws above the
        # thread, and a ticket that goes from «created» to «done» with nothing
        # in it is the case it exists for.
        *([] if (detail.get("outcome") or {}).get("kind") == "completed"
          else [f"a closed ticket with no outcome: {detail.get('outcome')}"]),
        *([] if (detail.get("outcome") or {}).get("summary") == "Listo, lo hice."
          else ["the outcome does not carry what the agent said"]),
    ])

    code, refused = call(f"/portal/tickets/{ticket_id}/status", {"status": "urgente"})
    still = call(f"/portal/tickets/{ticket_id}")[1]["ticket"]["status"]
    missing_code, missing = call("/portal/tickets/t_000000000000")
    print(f"  {code} {refused['error']['message'][:100]}")
    print(f"  {missing_code} {missing['error']['message']}")
    failures += judge("f. a status and an id the board does not have", [
        *([] if code == 400 else [f"a sixth status came back {code}"]),
        *([] if all(word in refused["error"]["message"] for word in
                    ("ready", "in_progress", "blocked", "done", "archived"))
          else ["the 400 does not name the five"]),
        *([] if still == "done" else ["the ticket moved anyway"]),
        *([] if missing_code == 404 else [f"an id that is not there came back {missing_code}"]),
        *([] if "No existe la tarea" in missing["error"]["message"]
          else ["the 404 is not the sentence the client reads"]),
    ])
    # Archiving takes it off the board and leaves the link alive: that is what
    # the confirmation on the Board's detail promises.
    call(f"/portal/tickets/{second['id']}/status", {"status": "archived"})
    board = [t["id"] for t in call("/portal/tickets")[1]["tickets"]]
    archived = call(f"/portal/tickets/{second['id']}")[1]["ticket"]["status"]
    failures += judge("   archiving takes it off the board, not out of the world", [
        *([] if second["id"] not in board else ["an archived ticket is still on the board"]),
        *([] if archived == "archived" else ["its link no longer opens it"]),
    ])
    return made, failures


def main() -> int:
    print(f"container: {CONTAINER} · adapter: {ADAPTER}")
    modules = call("/portal/manifest")[1]["modules"]
    if not modules.get("kanban"):
        print("the manifest does not declare `kanban`: is the plugin in CORE_PLUGINS?")
        return 1

    print("\nthe agent's half — the two tools, inside the container")
    _, failures = the_agents_half()
    print("\nthe client's half — the five calls, over HTTP")
    made, more = the_clients_half()
    failures += more
    if made:
        subprocess.run(
            ["docker", "exec", CONTAINER, "python3", "-c", FORGET, *[i for i in made if i]],
            check=True, capture_output=True, text=True,
        )
        print(f"\ncleaned up: {', '.join(i for i in made if i)}")
    print("BOARD: PASS" if not failures else "BOARD: FAIL")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
