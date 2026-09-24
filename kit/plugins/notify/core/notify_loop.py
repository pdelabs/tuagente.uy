"""What the owner hears about, and when. Code, no model.

FOUR THINGS, each said once:

1. A request is waiting for her ok — the moment it appears.
2. It is STILL waiting after `REMIND_AFTER` — one reminder, never two.
3. A flow broke: a run that could not finish, a watcher that could not look
   (the `flow.failed` events the scheduler writes).
4. A conversation the agent left for her — a WhatsApp or Instagram message it
   would not answer — with its note.

A chat turn that failed is not here: she was in the chat and saw it.

ONE MAIL AT A TIME, NOT ONE PER THING. At most one every `EVERY`; what happens
in between goes out together, one line each. The first thing after a quiet
stretch goes out at once, because nothing was sent in the last `EVERY`. And
nothing between 22 and 8 in the agent's clock: it waits and goes in one mail at
eight. An agent that writes fifteen times gets muted, and then it has no
channel at all.

WITH NO CHANNEL CHOSEN, NOTHING IS SAVED UP. What happened while the owner had
not picked one is marked as told, so choosing email on Friday does not bring a
week of notices on Friday.

A FAILED SEND MARKS NOTHING: the next window tries the same lines again. The
failure is in Activity (`core/notify.py`) and `last_try` keeps it to one
attempt per window.
"""

import json
import os
import time
from datetime import datetime
from zoneinfo import ZoneInfo

import notify_email
import notify_store as store

from core import config, db, notify

EVERY = int(os.environ.get("NOTIFY_EVERY", "1800"))
REMIND_AFTER = int(os.environ.get("NOTIFY_REMIND_AFTER", "10800"))
QUIET_FROM, QUIET_UNTIL = 22, 8

# Read by the owner.
WAITING = "Tenés algo esperando tu ok: {title}."
STILL_WAITING = "Sigue esperando tu ok: {title}."
SUBJECT_WAITING = "Espera tu ok: {title}"
SUBJECT_STILL = "Sigue esperando tu ok: {title}"
SUBJECT_FAILED = "Algo no salió como esperaba"
LEFT = "Te dejé una conversación a vos: {title}."
SUBJECT_LEFT = "Te dejé a vos: {title}"
SUBJECT_MANY = "Tengo {n} cosas para contarte"


def quiet(now: float) -> bool:
    hour = datetime.fromtimestamp(now, ZoneInfo(config.TIMEZONE)).hour
    return hour >= QUIET_FROM or hour < QUIET_UNTIL


def pending_approvals() -> list:
    return db.query(
        "SELECT id, title, summary, created_at FROM approvals"
        " WHERE status = 'pending' ORDER BY created_at"
    )


def failures(floor: float) -> list:
    return db.query(
        "SELECT id, label, payload FROM events"
        " WHERE kind = 'flow.failed' AND status = 'error' AND id > ? ORDER BY id",
        (floor,),
    )


# THE CONVERSATIONS THE AGENT LEFT FOR THE OWNER: a WhatsApp or Instagram
# message it would not answer — a price that is not published, a complaint,
# something it was not sure of — sits blocked in the Bandeja with its note.
# That is her to answer, and it was the one thing the Bandeja showed her that
# no mail did (Luis, 2026-09-24). Told once per conversation. The board is the
# `kanban` plugin's, which an agent may not run: then there is nothing to tell.
CHANNELS = ("instagram", "instagram-dm", "whatsapp")


def left_for_the_owner() -> list:
    if not db.one("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'tickets'"):
        return []
    rows = db.query(
        f"SELECT id, title FROM tickets WHERE status = 'blocked'"
        f" AND source IN ({','.join('?' * len(CHANNELS))}) ORDER BY updated_at",
        CHANNELS,
    )
    out = []
    for r in rows:
        note = db.one(
            "SELECT body FROM ticket_comments WHERE ticket_id = ? AND author = 'agente'"
            " AND sent = 0 ORDER BY id DESC LIMIT 1", (r["id"],))
        out.append({"id": r["id"], "title": r["title"], "note": note["body"] if note else None})
    return out


def items(now: float) -> list[dict]:
    """Everything not yet told, oldest first. Each one: the mark it leaves, the
    subject it would have alone, its line, and where it opens."""
    found = []
    for a in pending_approvals():
        link = notify_email.url(f"/app/approvals?request={a['id']}")
        if not store.marked(f"approval:{a['id']}"):
            found.append({
                "mark": f"approval:{a['id']}",
                "subject": SUBJECT_WAITING.format(title=a["title"]),
                "line": WAITING.format(title=a["title"]),
                "detail": a["summary"],
                "link": link,
            })
        elif now - a["created_at"] >= REMIND_AFTER and not store.marked(f"reminded:{a['id']}"):
            found.append({
                "mark": f"reminded:{a['id']}",
                "subject": SUBJECT_STILL.format(title=a["title"]),
                "line": STILL_WAITING.format(title=a["title"]),
                "detail": None,
                "link": link,
            })
    for t in left_for_the_owner():
        if not store.marked(f"left:{t['id']}"):
            found.append({
                "mark": f"left:{t['id']}",
                "subject": SUBJECT_LEFT.format(title=t["title"]),
                "line": LEFT.format(title=t["title"]),
                "detail": t["note"],
                "link": notify_email.url(f"/app/inbox?thread={t['id']}"),
            })
    for e in failures(store.state("floor") or 0):
        slug = json.loads(e["payload"]).get("slug") if e["payload"] else None
        found.append({
            "mark": None,
            "event": e["id"],
            "subject": SUBJECT_FAILED,
            "line": e["label"],
            "detail": None,
            "link": notify_email.url(f"/app/flows/{slug}" if slug else "/app/activity"),
        })
    return found


def compose(found: list[dict]) -> tuple[str, str, str]:
    if len(found) == 1:
        item = found[0]
        text = item["line"] + (f"\n\n{item['detail']}" if item["detail"] else "")
        return item["subject"], text, item["link"]
    lines = "\n".join(f"- {i['line']} {i['link']}" for i in found)
    waiting = any(i["mark"] for i in found)
    link = notify_email.url("/app/approvals" if waiting else "/app/activity")
    return SUBJECT_MANY.format(n=len(found)), lines, link


def told(found: list[dict]) -> None:
    for item in found:
        if item["mark"]:
            store.mark(item["mark"])
    events = [i["event"] for i in found if i.get("event")]
    if events:
        store.set_state("floor", max(events))


def look(now: float | None = None) -> None:
    now = time.time() if now is None else now
    if notify.chosen() is None:
        told(items(now))
        return
    if quiet(now):
        return
    last = store.state("last_try")
    if last is not None and now - last < EVERY:
        return
    found = items(now)
    if not found:
        return
    store.set_state("last_try", now)
    notify.notify_owner(*compose(found))
    told(found)
