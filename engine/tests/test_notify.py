#!/usr/bin/env python3
"""The owner hears about it, once, by mail. `python3 engine/tests/test_notify.py`.

Inside the container, with Resend swapped for a list and the clock passed in:
no model, no network, a second. The lab's own rows are left as they were — the
test's approvals are its own, the pending ones the lab already had are not
looked at, and the identity, marks and floor are put back on the way out.

WHY. The agent works on its own and, until 2026-09-22, the owner found out by
opening the portal (`core/notify.py`, `kit/plugins/notify/`).

  a. THE REGISTRY — a channel registered twice raises; the manifest lists it.
  b. NO CHANNEL CHOSEN IS A SKIP — nothing sent, a `skipped` line in Activity.
  c. A SEND — from "<agent> <avisos@…>", to the owner's address, the link in
     the text and in the HTML, and a `completed` line.
  d. A FAILED SEND RAISES — and says so in Activity.
  e. A WAITING REQUEST IS SAID ONCE — the mail names it and opens it, and the
     next looks say nothing.
  f. THE REMINDER, ONCE — after REMIND_AFTER, and never a second one.
  g. ONE MAIL PER WINDOW — what happens inside it goes out together, later.
  h. QUIET AT NIGHT — nothing at 23:00, all of it at 08:00.
  i. A BROKEN FLOW — its line, and the flow's page as the link.
  j. NOTHING IS SAVED UP WITH NO CHANNEL — choosing mail later does not bring
     what happened before.
  k. A FAILED MAIL MARKS NOTHING — the next window says it again.
  l. INSTALLING IT DOES NOT MAIL THE PAST — events before the floor are history.
  m. A CONVERSATION LEFT FOR HER — mailed once, with the agent's note and the
     Bandeja link.

WHERE IT POINTS. `CORE_CONTAINER` moves it onto a second instance; the default
is the main compose's `tuagente-core`.
"""

import json
import os
import subprocess
import sys

CONTAINER = os.environ.get("CORE_CONTAINER", "tuagente-core")

INSIDE = r"""
import json, sys, time
from datetime import datetime
from zoneinfo import ZoneInfo

sys.path.insert(0, "/opt/kit/plugins/notify/core")

import notify_email
import notify_loop
import notify_store as store

from core import config, db, identity, notify

out = {}
ZONE = ZoneInfo(config.TIMEZONE)
def at(hour, minute=0, day=22):
    return datetime(2026, 9, day, hour, minute, tzinfo=ZONE).timestamp()

sent = []
def post(payload):
    if fail:
        raise RuntimeError("resend dijo 500")
    sent.append(payload)
fail = False
notify_email.post = post

PREFIX = "apr_test_notify_"
original_pending = notify_loop.pending_approvals
notify_loop.pending_approvals = lambda: [a for a in original_pending() if a["id"].startswith(PREFIX)]
original_left = notify_loop.left_for_the_owner
notify_loop.left_for_the_owner = lambda: [t for t in original_left() if t["title"].startswith("Prueba notify")]

first_event = store.newest_event()
live = identity.LIVE.read_text() if identity.LIVE.exists() else None
marks = db.query("SELECT key, at FROM notify_marks")
state = db.query("SELECT key, value FROM notify_state")
def reset():
    db.write("DELETE FROM notify_marks")
    db.write("DELETE FROM notify_state")
    db.write("DELETE FROM approvals WHERE id LIKE ?", (PREFIX + "%",))
    store.start_floor()
    sent.clear()

def contact(channel, value=None):
    who = identity.load()
    who["contact"] = {"channel": channel, "value": value}
    identity.save(who)

def approval(n, created):
    db.write(
        "INSERT INTO approvals (id, session_id, status, title, summary, body, tool_name,"
        " requests, created_at, updated_at) VALUES (?, 's', 'pending', ?, ?, '', 't', '[]', ?, ?)",
        (PREFIX + str(n), f"Pedido {n}", f"Resumen del pedido {n}", created, created),
    )

def failure(slug):
    db.append_event("flow.failed", f"El flujo «{slug}» no pudo terminar: se cayó", "error",
                    None, {"slug": slug})

def last_notify():
    row = db.one("SELECT label, status FROM events WHERE kind = 'notify' ORDER BY id DESC LIMIT 1")
    return dict(row) if row else None

def look(now):
    before = len(sent)
    try:
        notify_loop.look(now)
    except Exception as exc:
        return {"raised": str(exc), "sent": sent[before:]}
    return {"sent": sent[before:]}

try:
    had_email = "email" in notify.CHANNELS
    notify.CHANNELS.pop("email", None)
    # a.
    notify.register("email", notify_email.send)
    try:
        notify.register("email", notify_email.send)
        out["double"] = "no raise"
    except ValueError:
        out["double"] = "raised"
    out["available"] = notify.available()

    # b.
    reset()
    contact("none")
    out["none"] = {"returned": notify.notify_owner("Algo", "texto"), "sent": list(sent),
                   "event": last_notify()}

    # c.
    contact("email", "duena@ejemplo.uy")
    out["send"] = {"returned": notify.notify_owner("Asunto", "Texto", "http://p/app/x"),
                   "payload": sent[-1] if sent else None, "event": last_notify(),
                   "name": identity.load()["name"]}

    # d.
    fail = True
    try:
        notify.notify_owner("Asunto", "Texto")
        out["failed"] = {"raised": False}
    except Exception:
        out["failed"] = {"raised": True, "event": last_notify()}
    fail = False

    # e.
    reset()
    approval(1, at(10))
    out["first"] = look(at(10, 1))
    out["again"] = look(at(10, 2))
    out["next_window"] = look(at(10, 40))

    # f.
    out["reminder"] = look(at(13, 5))
    out["reminder_again"] = look(at(14, 0))

    # g.
    reset()
    approval(2, at(15))
    out["g_first"] = look(at(15, 1))
    approval(3, at(15, 5))
    failure("prueba-notify")
    out["g_inside"] = look(at(15, 10))
    out["g_after"] = look(at(15, 32))

    # h.
    reset()
    approval(4, at(23))
    out["night"] = look(at(23, 1))
    out["morning"] = look(at(8, 0, day=23))

    # i.
    reset()
    failure("prueba-notify")
    out["broken"] = look(at(11))

    # j.
    reset()
    contact("none")
    approval(5, at(11))
    failure("prueba-notify")
    out["j_none"] = look(at(11, 1))
    contact("email", "duena@ejemplo.uy")
    out["j_chosen"] = look(at(11, 2))

    # k.
    reset()
    approval(6, at(11))
    fail = True
    out["k_fail"] = look(at(11, 1))
    fail = False
    out["k_same_window"] = look(at(11, 10))
    out["k_next"] = look(at(11, 32))

    # l.
    reset()
    db.write("DELETE FROM notify_state")
    failure("prueba-notify")
    store.start_floor()
    out["history"] = look(at(11))

    # m.
    reset()
    sys.path.insert(0, "/opt/kit/plugins/kanban/core")
    import board_store as board
    tid, _ = board.create("Prueba notify: Mensaje de Ana por WhatsApp", "hola",
                          status=board.BLOCKED, source="whatsapp", source_ref="prueba-notify@s.whatsapp.net")
    board.comment(tid, board.AGENT, "Pregunta un precio que no está publicado.")
    out["left"] = look(at(11))
    out["left_again"] = look(at(11, 40))
    db.write("DELETE FROM ticket_comments WHERE ticket_id = ?", (tid,))
    db.write("DELETE FROM tickets WHERE id = ?", (tid,))
finally:
    notify.CHANNELS.pop("email", None)
    if had_email:
        notify.CHANNELS["email"] = notify_email.send
    db.write("DELETE FROM approvals WHERE id LIKE ?", (PREFIX + "%",))
    db.write("DELETE FROM events WHERE id > ?", (first_event,))
    db.write("DELETE FROM notify_marks")
    db.write("DELETE FROM notify_state")
    for r in marks:
        db.write("INSERT INTO notify_marks (key, at) VALUES (?, ?)", (r["key"], r["at"]))
    for r in state:
        db.write("INSERT INTO notify_state (key, value) VALUES (?, ?)", (r["key"], r["value"]))
    if live is None:
        identity.LIVE.unlink(missing_ok=True)
    else:
        identity.LIVE.write_text(live)

print(json.dumps(out, ensure_ascii=False))
"""


def judge(name: str, problems: list[str]) -> int:
    print(("  ok    " if not problems else "  FAIL  ") + name)
    for p in problems:
        print("        " + p)
    return 1 if problems else 0


def subjects(r: dict) -> list[str]:
    return [p["subject"] for p in r["sent"]]


def main() -> int:
    done = subprocess.run(
        ["docker", "exec", CONTAINER, "python3", "-c", INSIDE],
        capture_output=True, text=True,
    )
    if done.returncode != 0:
        print(done.stdout + done.stderr)
        return 1
    r = json.loads(done.stdout.strip().splitlines()[-1])
    failures = 0

    problems = []
    if r["double"] != "raised":
        problems.append("a second channel under the same name did not raise")
    if r["available"] != ["email"]:
        problems.append(f"available() is {r['available']!r}")
    failures += judge("a. the registry", problems)

    problems = []
    if r["none"]["returned"] is not False or r["none"]["sent"]:
        problems.append(f"with no channel it gave {r['none']!r}")
    if (r["none"]["event"] or {}).get("status") != "skipped":
        problems.append(f"the Activity line is {r['none']['event']!r}")
    failures += judge("b. no channel chosen is a skip", problems)

    problems = []
    p = r["send"]["payload"] or {}
    if p.get("from") != f"{r['send']['name']} <avisos@tuagente.uy>":
        problems.append(f"from is {p.get('from')!r}")
    if p.get("to") != ["duena@ejemplo.uy"] or p.get("subject") != "Asunto":
        problems.append(f"to/subject are {p.get('to')!r} {p.get('subject')!r}")
    if "http://p/app/x" not in p.get("text", "") or 'href="http://p/app/x"' not in p.get("html", ""):
        problems.append("the link is not in the text and the HTML")
    if r["send"]["name"] not in p.get("text", ""):
        problems.append("the mail is not signed with the agent's name")
    if (r["send"]["event"] or {}).get("status") != "completed":
        problems.append(f"the Activity line is {r['send']['event']!r}")
    failures += judge("c. a send", problems)

    problems = []
    if not r["failed"]["raised"]:
        problems.append("a failed send did not raise")
    elif r["failed"]["event"]["status"] != "error" or "resend dijo 500" not in r["failed"]["event"]["label"]:
        problems.append(f"the Activity line is {r['failed']['event']!r}")
    failures += judge("d. a failed send raises", problems)

    problems = []
    if subjects(r["first"]) != ["Espera tu ok: Pedido 1"]:
        problems.append(f"the first look sent {subjects(r['first'])!r}")
    elif "/app/approvals?request=apr_test_notify_1" not in r["first"]["sent"][0]["text"] \
            or "Resumen del pedido 1" not in r["first"]["sent"][0]["text"]:
        problems.append("the mail does not carry the summary and the request's link")
    if r["again"]["sent"] or r["next_window"]["sent"]:
        problems.append("the same request was announced again")
    failures += judge("e. a waiting request is said once", problems)

    problems = []
    if subjects(r["reminder"]) != ["Sigue esperando tu ok: Pedido 1"]:
        problems.append(f"after three hours it sent {subjects(r['reminder'])!r}")
    if r["reminder_again"]["sent"]:
        problems.append("a second reminder went out")
    failures += judge("f. the reminder, once", problems)

    problems = []
    if subjects(r["g_first"]) != ["Espera tu ok: Pedido 2"]:
        problems.append(f"the first thing after a quiet stretch waited: {subjects(r['g_first'])!r}")
    if r["g_inside"]["sent"]:
        problems.append("a second mail went out inside the window")
    if subjects(r["g_after"]) != ["Tengo 2 cosas para contarte"]:
        problems.append(f"after the window it sent {subjects(r['g_after'])!r}")
    elif "Pedido 3" not in r["g_after"]["sent"][0]["text"] or "prueba-notify" not in r["g_after"]["sent"][0]["text"]:
        problems.append("the batch is missing a line")
    failures += judge("g. one mail per window", problems)

    problems = []
    if r["night"]["sent"]:
        problems.append("a mail went out at 23:00")
    if subjects(r["morning"]) != ["Espera tu ok: Pedido 4"]:
        problems.append(f"at 08:00 it sent {subjects(r['morning'])!r}")
    failures += judge("h. quiet at night", problems)

    problems = []
    if subjects(r["broken"]) != ["Algo no salió como esperaba"]:
        problems.append(f"a broken flow sent {subjects(r['broken'])!r}")
    elif "/app/flows/prueba-notify" not in r["broken"]["sent"][0]["text"] \
            or "no pudo terminar" not in r["broken"]["sent"][0]["text"]:
        problems.append("the mail does not name the failure and link the flow")
    failures += judge("i. a broken flow", problems)

    problems = []
    if r["j_none"]["sent"] or r["j_chosen"]["sent"]:
        problems.append(f"what happened with no channel came later: {subjects(r['j_chosen'])!r}")
    failures += judge("j. nothing is saved up with no channel", problems)

    problems = []
    if "raised" not in r["k_fail"]:
        problems.append("a failed mail did not raise to the clock")
    if r["k_same_window"]["sent"]:
        problems.append("it retried inside the same window")
    if subjects(r["k_next"]) != ["Espera tu ok: Pedido 6"]:
        problems.append(f"the next window sent {subjects(r['k_next'])!r}")
    failures += judge("k. a failed mail marks nothing", problems)

    problems = [] if not r["history"]["sent"] else [f"it mailed {subjects(r['history'])!r}"]
    failures += judge("l. installing it does not mail the past", problems)

    problems = []
    if subjects(r["left"]) != ["Te dejé a vos: Prueba notify: Mensaje de Ana por WhatsApp"]:
        problems.append(f"a conversation left for her sent {subjects(r['left'])!r}")
    elif "precio que no está publicado" not in r["left"]["sent"][0]["text"] \
            or "/app/inbox?thread=" not in r["left"]["sent"][0]["text"]:
        problems.append("the mail does not carry the note and the conversation's link")
    if r["left_again"]["sent"]:
        problems.append("the same conversation was mailed twice")
    failures += judge("m. a conversation left for her is mailed once, with the note", problems)

    print("NOTIFY: " + ("PASS" if not failures else "FAIL"))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
