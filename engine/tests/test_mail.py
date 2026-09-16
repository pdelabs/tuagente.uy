#!/usr/bin/env python3
"""The inbox, with no model. `python3 engine/tests/test_mail.py`. Free, seconds.

M1 of `docs/inbox-plan.md`: **a mail becomes a ticket, and the same message
never makes two.** Everything happens inside the container, against the lab's
stub mailbox (`greenmail`, `engine/docker-compose.yml`): four messages are
delivered over SMTP and `fetch_mail` is called directly, the way
`tests/test_board.py` calls the board's tools. No model, no money, and nothing
that could reach a real mailbox.

The claims, in order:

  a. TWO MAILS, TWO TICKETS — both land on the board with `source: mail` and
     the Message-ID as `source_ref`, born `ready`, with who wrote, when, and
     what they said in the body. The run's answer lists both with their ids.
  b. A SECOND TICK FINDS NOTHING — «Sin mails nuevos.», which is the shape that
     makes reading a flow affordable: five minutes of nothing is one line. It
     is also the restart test, twice over: IMAP's `\\Seen` flag and the
     `mail_seen` table each say the same message was worked.
  c. AN ANSWER LANDS ON THE TICKET THAT WAS THERE — a reply carrying the first
     mail's id in `In-Reply-To` is a COMMENT on ticket one, signed by whoever
     sent it, and the ticket comes back to «Por hacer» from wherever it was.
     No second ticket.
  d. WHAT NOBODY WROTE IS NOT LISTED — a `List-Unsubscribe` header is a ticket
     opened and closed in the same breath, with «Descartado: …» on it, counted
     under «Descartados» and never offered to the model as something to answer.
  e. AN HTML BODY IS TEXT — by code, with the stdlib's parser, before anybody
     reads it.
  f. AN ATTACHMENT IS ON DISK AND NAMED IN THE TICKET — under
     `workspace/correo/<ticket_id>/`, which is a path the portal turns into a
     chip.

IT CLEANS UP AFTER ITSELF: the tickets, their comments, their events, the two
mail tables and the attachments are gone by the end, whatever happened. What
stays is the stub's mailbox, which dies with its container.
"""

import json
import os
import re
import subprocess
import sys
from pathlib import Path

CORE = Path(__file__).resolve().parent.parent
CONTAINER = os.environ.get("CORE_CONTAINER", "tuagente-core")

SESSION = "prueba-bandeja"
TICKET_ID = re.compile(r"t_[0-9a-f]{12}")

# What the mails say. The Spanish is the fixture's, not the product's: it is
# what a customer of the client would write.
FIRST = "Hola, quería saber cuánto sale el diagnóstico y cómo sigue después."
SECOND_HTML = "<p>Buenas, mando el <b>remito</b> firmado.</p><p>Saludos, Ana</p>"
SECOND_TEXT = "mando el remito firmado"
REPLY = "Perfecto, entonces quedo esperando el detalle."
ATTACHMENT = "remito.pdf"

INSIDE = r"""
import json, sqlite3, smtplib, sys, time, types
from email.message import EmailMessage
from email.utils import formatdate, make_msgid
from pathlib import Path

sys.path.insert(0, "/opt/kit/plugins/kanban/core")
sys.path.insert(0, "/opt/kit/plugins/mail/core")
import board_store as board
import mail_store as store
import mail_tools

SESSION, FIRST, SECOND_HTML, REPLY, ATTACHMENT = sys.argv[1:6]
WORKSPACE = Path("/workspace")
fetch = mail_tools.reading().tools["fetch_mail"].function
ctx = types.SimpleNamespace(
    deps=types.SimpleNamespace(session_id=SESSION, workspace=WORKSPACE))
report = {}
ids = []


# One mail into the stub, as somebody who writes to the company. The
# docstrings inside this block are comments on purpose: a triple-quoted string
# in here would close the one it is written in.
def deliver(subject, body, html=False, headers=None, attachment=None):
    message = EmailMessage()
    message["From"] = "Ana Cliente <cliente@lab.test>"
    message["To"] = "agente@lab.test"
    message["Subject"] = subject
    message["Message-ID"] = make_msgid(domain="lab.test")
    message["Date"] = formatdate(localtime=True)
    for name, value in (headers or {}).items():
        message[name] = value
    message.set_content(body, subtype="html" if html else "plain")
    if attachment:
        message.add_attachment(b"%PDF-1.4 remito", maintype="application",
                               subtype="pdf", filename=attachment)
    with smtplib.SMTP("greenmail", 3025, timeout=20) as smtp:
        smtp.login("cliente", "secret")
        smtp.send_message(message)
    return message["Message-ID"]


def row(ticket_id):
    found = board.row_of(ticket_id)
    return dict(found) if found else None


def named(answer):
    return [i for i in answer.split() if i.startswith("t_")]


try:
    # (a) two mails, one tick.
    first_id = deliver("Consulta por el diagnóstico", FIRST)
    second_id = deliver("Remito firmado", SECOND_HTML, html=True, attachment=ATTACHMENT)
    time.sleep(1)
    answer = fetch(ctx)
    ids = [i.rstrip(".,") for i in named(answer)]
    report["first_run"] = {"said": answer, "ids": ids}
    report["tickets"] = {}
    for message_id, key in ((first_id, "first"), (second_id, "second")):
        found = board.by_source(store.SOURCE, message_id)
        report["tickets"][key] = dict(found) if found else None
        if found:
            report["tickets"][key]["seen_points_at"] = store.ticket_of(message_id)
            thread = store.thread(found["id"])
            report["tickets"][key]["thread"] = dict(thread) if thread else None

    # (b) the same tick again, with nothing new in the mailbox.
    report["second_run"] = fetch(ctx)

    # (c) an answer to the first one, with the ticket moved out of `ready`
    # first, so coming back to it is a move and not a coincidence.
    ticket_one = board.by_source(store.SOURCE, first_id)["id"]
    board.move(ticket_one, board.DONE, session_id=SESSION)
    deliver("Re: Consulta por el diagnóstico", REPLY,
            headers={"In-Reply-To": first_id, "References": first_id})
    time.sleep(1)
    answer = fetch(ctx)
    report["third_run"] = {
        "said": answer,
        "ids": [i.rstrip(".,") for i in named(answer)],
        "ticket": row(ticket_one),
        "comments": board.comments(ticket_one),
        "tickets_now": len(board.db.query(
            "SELECT id FROM tickets WHERE source = ?", (store.SOURCE,))),
    }

    # (d) something nobody wrote.
    deliver("Newsletter de septiembre", "Novedades del mes.",
            headers={"List-Unsubscribe": "<mailto:baja@lista.test>"})
    time.sleep(1)
    answer = fetch(ctx)
    junk = board.db.query(
        "SELECT * FROM tickets WHERE title = ?", ("Newsletter de septiembre",))
    report["fourth_run"] = {
        "said": answer,
        "ids": [i.rstrip(".,") for i in named(answer)],
        "ticket": dict(junk[0]) if junk else None,
        "comments": board.comments(junk[0]["id"]) if junk else [],
    }

    # (f) the attachment, on disk and in the body.
    ticket_two = board.by_source(store.SOURCE, second_id)["id"]
    directory = WORKSPACE / "correo" / ticket_two
    report["attachment"] = {
        "on_disk": sorted(p.name for p in directory.iterdir()) if directory.is_dir() else [],
        "body": row(ticket_two)["body"],
    }

    ids = [r["id"] for r in board.db.query(
        "SELECT id FROM tickets WHERE source = ?", (store.SOURCE,))]
    report["seen"] = len(board.db.query("SELECT message_id FROM mail_seen"))
    report["ids"] = ids
    print(json.dumps(report, ensure_ascii=False, default=str))
finally:
    import shutil
    db = sqlite3.connect("/state/core.db")
    for ticket_id in ids:
        db.execute("DELETE FROM tickets WHERE id = ?", (ticket_id,))
        db.execute("DELETE FROM ticket_comments WHERE ticket_id = ?", (ticket_id,))
        db.execute("DELETE FROM mail_seen WHERE ticket_id = ?", (ticket_id,))
        db.execute("DELETE FROM mail_threads WHERE ticket_id = ?", (ticket_id,))
        db.execute(
            "DELETE FROM events WHERE json_extract(payload, '$.ticket_id') = ?", (ticket_id,))
        shutil.rmtree(WORKSPACE / "correo" / ticket_id, ignore_errors=True)
    db.execute("DELETE FROM events WHERE session_id = ?", (SESSION,))
    db.commit()
"""


def judge(name: str, problems: list[str]) -> list[str]:
    print(f"  {name}: " + ("PASS" if not problems else "FAIL — " + "; ".join(problems)))
    return problems


def main() -> int:
    print(f"container: {CONTAINER}")
    done = subprocess.run(
        ["docker", "exec", CONTAINER, "python3", "-c", INSIDE,
         SESSION, FIRST, SECOND_HTML, REPLY, ATTACHMENT],
        capture_output=True, text=True,
    )
    if done.returncode != 0 or not done.stdout.strip():
        print(done.stderr.strip()[-2000:])
        print("MAIL: FAIL — the inbox pass did not run inside the container")
        return 1
    r = json.loads(done.stdout)
    failures: list[str] = []

    first, tickets = r["first_run"], r["tickets"]
    print(f"  fetch_mail ->\n{first['said']}\n")
    one, two = tickets.get("first"), tickets.get("second")
    failures += judge("a. two mails, two tickets", [
        *([] if len(first["ids"]) == 2 else [f"the run named {first['ids']}"]),
        *([] if one and two else ["a mail did not become a ticket"]),
        *([] if one and one["source"] == "mail" and one["source_ref"]
          else ["the ticket does not say it came from the mailbox"]),
        *([] if one and one["status"] == "ready" and one["closed_at"] is None
          else [f"it is not born ready: {one}"]),
        *([] if one and FIRST[:30] in one["body"] and "cliente@lab.test" in one["body"]
          else ["the body is not the mail: who wrote, when, and what they said"]),
        *([] if one and one["seen_points_at"] == one["id"]
          else ["mail_seen does not point the Message-ID at its ticket"]),
        *([] if one and (one["thread"] or {}).get("to_address") == "cliente@lab.test"
          else [f"the thread does not know who to answer: {one and one['thread']}"]),
    ])

    print(f"  fetch_mail again -> {r['second_run']}")
    failures += judge("b. a second tick finds nothing", [
        *([] if r["second_run"] == "Sin mails nuevos."
          else [f"it answered {r['second_run']!r}"]),
    ])

    third = r["third_run"]
    authors = [c["author"] for c in third["comments"]]
    first_ticket = one["id"] if one else None
    print(f"  the reply -> {third['said'].splitlines()[0]} · comments {authors}")
    failures += judge("c. an answer lands on the ticket that was there", [
        *([] if third["tickets_now"] == 2 else [f"{third['tickets_now']} tickets, not two"]),
        *([] if third["ids"] == [first_ticket]
          else [f"the run named {third['ids']} instead of {first_ticket}"]),
        *([] if "cliente@lab.test" in authors
          else [f"the message is not a comment signed by whoever sent it: {authors}"]),
        *([] if any(REPLY[:20] in c["body"] for c in third["comments"])
          else ["what they wrote is not on the ticket"]),
        *([] if third["ticket"]["status"] == "ready"
          else [f"the ticket did not come back to «Por hacer»: {third['ticket']['status']}"]),
        *([] if third["ticket"]["closed_at"] is None
          else ["it is open again and still carries a closing date"]),
    ])

    fourth = r["fourth_run"]
    said = [c["body"] for c in fourth["comments"]]
    print(f"  the newsletter -> {fourth['said']} · {said}")
    failures += judge("d. what nobody wrote is not listed", [
        *([] if fourth["ids"] == [] else [f"it offered it as new: {fourth['ids']}"]),
        *([] if "Descartados: 1" in fourth["said"]
          else ["the run does not say one was discarded"]),
        *([] if fourth["ticket"] and fourth["ticket"]["status"] == "done"
          else [f"the discarded mail is not closed: {fourth['ticket']}"]),
        *([] if any("Descartado:" in body and "List-Unsubscribe" in body for body in said)
          else ["the ticket does not say why it was discarded"]),
    ])

    attachment = r["attachment"]
    body = attachment["body"]
    second_ticket = two["id"] if two else None
    print(f"  the second ticket -> {attachment['on_disk']}")
    failures += judge("e. an HTML body is text", [
        *([] if SECOND_TEXT in " ".join(body.split())
          else [f"the html did not become text: {body[:200]!r}"]),
        *([] if "<p>" not in body and "<b>" not in body
          else ["the markup reached the ticket"]),
    ])
    failures += judge("f. the attachment is on disk and named in the ticket", [
        *([] if attachment["on_disk"] == [ATTACHMENT]
          else [f"the files are {attachment['on_disk']}"]),
        *([] if f"correo/{second_ticket}/{ATTACHMENT}" in body
          else ["the body does not name the path the client opens"]),
    ])
    failures += judge("   every message is written down once", [
        *([] if r["seen"] == 4 else [f"mail_seen has {r['seen']} rows for four messages"]),
    ])

    print(f"\ncleaned up: {', '.join(r['ids'])}")
    print("MAIL: PASS" if not failures else "MAIL: FAIL")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
