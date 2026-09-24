#!/usr/bin/env python3
"""Who wrote, on the Bandeja's Instagram tickets. `python3 engine/tests/test_instagram_inbox.py`.

The Bandeja shows a person ONCE however many comments and messages they left
(`app/app/inbox/people.ts`), and it can only do that if every Instagram ticket
says who the person is in a field — the title is prose the model writes. The
`instagram` plugin puts it there through `board_store.EXTRA`, and this asks the
RUNNING engine's own `/portal/tickets` for it, so the registration in
`plugin.py` is what is under test and not a function called by hand. Free, a
second, no model and no network.

  a. A COMMENT'S TICKET CARRIES `handle`, the comment's own words
     (`comment_text`, not the body the model wrote) and the post it is under
     (`post_permalink`, `post_line`), off `instagram_seen`.
  b. A DM THREAD'S TICKET CARRIES `handle` — THE PERSON'S, EVEN WHEN THE
     CONVERSATION ROW NAMES US. That row was measured naming our own account
     (24/9/2026: a message the owner sent from the Instagram app was read as
     inbound), and a Bandeja that grouped by it would put every such thread
     under the business's own @.
  c. THE DETAIL CARRIES THE SAME FIELDS: the open thread is drawn from it.

IT CLEANS UP AFTER ITSELF: the rows it wrote are gone by the end, whatever
happened.
"""

import json
import os
import subprocess
import sys

CONTAINER = os.environ.get("CORE_CONTAINER", "tuagente-core")

INSIDE = r"""
import json, os, sys, urllib.request

sys.path.insert(0, "/opt/kit/plugins/kanban/core")
sys.path.insert(0, "/opt/kit/plugins/instagram/core")
import board_store
import ig_store

from core import db

MINE = "ferreteria.prueba"
WHO = "vecina.del.barrio"
COMMENT = "prueba_bandeja_comentario"
THREAD = "prueba_bandeja_hilo"
PERMALINK = "https://www.instagram.com/p/PRUEBA/"
POST = "Llegaron las mechas nuevas."
SAID = "¿Tienen de 8 mm?"


def get(path):
    request = urllib.request.Request(
        f"http://127.0.0.1:8643{path}",
        headers={"Authorization": f"Bearer {os.environ['API_SERVER_KEY']}"})
    return json.loads(urllib.request.urlopen(request).read())


out = {}
try:
    ig_store.save_account("17841400000000000", username=MINE)
    ig_store.record(COMMENT, "media_prueba", PERMALINK, POST, WHO, SAID, False)
    comment_id, _ = board_store.create(
        title=f"Comentario de @{WHO} en «{POST}»",
        body=f"@{WHO} comentó «{SAID}» en {PERMALINK}",
        source="instagram", source_ref=COMMENT)
    # THE ROW AS IT WAS MEASURED: the conversation names US.
    ig_store.save_conversation(THREAD, participant_id="17841400000000000",
                               participant_username=MINE, last_inbound_at=1.0)
    ig_store.record_message("m_prueba_1", THREAD, "7381234567890123", WHO, "Hola", 1.0)
    ig_store.record_message("m_prueba_2", THREAD, "17841400000000000", MINE, "Hola!", 2.0)
    dm_id, _ = board_store.create(
        title=f"Mensaje de @{WHO} en Instagram", body="Hola",
        source="instagram-dm", source_ref=THREAD)
    listing = {t["id"]: t for t in get("/portal/tickets?source=channels")["tickets"]}
    out["comment"] = listing.get(comment_id)
    out["dm"] = listing.get(dm_id)
    out["detail"] = get(f"/portal/tickets/{comment_id}")["ticket"]
    print(json.dumps(out, ensure_ascii=False))
finally:
    for source, ref in (("instagram", COMMENT), ("instagram-dm", THREAD)):
        for ticket in db.query(
                "SELECT id FROM tickets WHERE source = ? AND source_ref = ?", (source, ref)):
            db.write("DELETE FROM ticket_comments WHERE ticket_id = ?", (ticket["id"],))
            db.write("DELETE FROM events WHERE payload LIKE ?", (f"%{ticket['id']}%",))
            db.write("DELETE FROM tickets WHERE id = ?", (ticket["id"],))
    db.write("DELETE FROM instagram_seen WHERE comment_id = ?", (COMMENT,))
    db.write("DELETE FROM instagram_messages WHERE conversation_id = ?", (THREAD,))
    db.write("DELETE FROM instagram_conversations WHERE conversation_id = ?", (THREAD,))
    db.write("DELETE FROM instagram_account", ())
"""


def judge(name: str, problems: list[str]) -> list[str]:
    print(f"  {name}: " + ("PASS" if not problems else "FAIL — " + "; ".join(problems)))
    return problems


def fields(ticket: dict | None, wanted: dict) -> list[str]:
    if ticket is None:
        return ["the ticket is not in the listing"]
    return [f"{key} is {ticket.get(key)!r}, not {value!r}"
            for key, value in wanted.items() if ticket.get(key) != value]


def main() -> int:
    print(f"container: {CONTAINER}")
    done = subprocess.run(["docker", "exec", CONTAINER, "python3", "-c", INSIDE],
                          capture_output=True, text=True)
    if done.returncode != 0:
        print(done.stderr.strip()[-3000:])
        print("INSTAGRAM INBOX: FAIL")
        return 1
    measured = json.loads(done.stdout)
    comment = {"handle": "vecina.del.barrio", "comment_text": "¿Tienen de 8 mm?",
               "post_permalink": "https://www.instagram.com/p/PRUEBA/",
               "post_line": "Llegaron las mechas nuevas."}
    failures = []
    failures += judge("a. a comment carries who and where", fields(measured["comment"], comment))
    failures += judge("b. a DM carries the person, not us",
                      fields(measured["dm"], {"handle": "vecina.del.barrio"}))
    failures += judge("c. the detail carries the same", fields(measured["detail"], comment))
    print("INSTAGRAM INBOX: " + ("PASS" if not failures else f"FAIL ({len(failures)})"))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
