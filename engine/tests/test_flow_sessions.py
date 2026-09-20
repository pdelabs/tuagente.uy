#!/usr/bin/env python3
"""A run is opened from its flow, not from the chat. `python3 engine/tests/test_flow_sessions.py`.

Inside the container, with no model and no clock: rows written by hand under
the slug `prueba-corridas`, judged, and deleted on the way out. Free, a second.

WHY. A flow that runs every 15 minutes is a hundred conversations a day nobody
typed in. On our own agent (2026-09-20) the chat's list was one screen of
«Instagram: comentarios y me…» and the conversations somebody had were under it.

  a. THE CHAT'S LIST IS THE CLIENT'S CONVERSATIONS — `db.sessions()` carries a
     session of kind `chat` and not one of kind `flow`.
  b. THE RUN IS STILL THERE TO OPEN — the flow's history (`server.flows.past`)
     names the session of each run, which is the only way in.
  c. A QUIET OLD RUN LOSES ITS TRANSCRIPT AND KEEPS ITS ROW — went well, asked
     for nothing, older than the window: session, messages and history go; the
     run stays in the history with `session_id: null`.
  d. WHAT SOMEBODY MAY NEED IS KEPT — an old run that FAILED, an old run that
     asked for an APPROVAL, and a RECENT quiet one all keep their conversation.
  e. AND NO CONVERSATION OF THE CLIENT'S IS EVER TOUCHED — an old `chat`
     session survives the cleanup.

WHERE IT POINTS. `CORE_CONTAINER` moves it onto a second instance; the default
is the main compose's `tuagente-core`.
"""

import json
import os
import subprocess
import sys

CONTAINER = os.environ.get("CORE_CONTAINER", "tuagente-core")

INSIDE = r"""
import json, time

from core import db
from server import flows as routes

SLUG = "prueba-corridas"
NOW = time.time()
DAY = 86400
OLD, RECENT = NOW - 30 * DAY, NOW - 1 * DAY
IDS = ["prueba_quiet_old", "prueba_failed_old", "prueba_approval_old", "prueba_quiet_recent", "prueba_chat_old"]


def clean():
    for sid in IDS:
        db.delete_session(sid)
        db.write("DELETE FROM approvals WHERE session_id = ?", (sid,))
    db.write("DELETE FROM flow_runs WHERE slug = ?", (SLUG,))


def run(sid, scheduled_at, status, finished_at):
    db.create_session(sid, kind="flow")
    db.add_message(sid, "assistant", "sin novedades")
    db.save_history(sid, b"[]")
    db.write(
        "INSERT INTO flow_runs (slug, scheduled_at, session_id, started_at, finished_at, status, error, manual)"
        " VALUES (?, ?, ?, ?, ?, ?, NULL, 0)",
        (SLUG, scheduled_at, sid, finished_at - 60, finished_at, status),
    )


clean()
try:
    run("prueba_quiet_old", 1, "ok", OLD)
    run("prueba_failed_old", 2, "error", OLD)
    run("prueba_approval_old", 3, "ok", OLD)
    run("prueba_quiet_recent", 4, "ok", RECENT)
    db.write(
        "INSERT INTO approvals (id, session_id, status, title, summary, body, tool_name, requests, created_at, updated_at)"
        " VALUES ('prueba_ap', 'prueba_approval_old', 'approved', 't', 's', 'b', 'x', '[]', ?, ?)",
        (OLD, OLD),
    )
    db.create_session("prueba_chat_old", kind="chat")
    db.write("UPDATE sessions SET created_at = ?, last_active = ? WHERE id = 'prueba_chat_old'", (OLD, OLD))

    listed = {row["id"] for row in db.sessions()}
    before = {r["id"]: r["session_id"] for r in (routes.past(x) for x in db.flow_runs(SLUG, 10))}
    gone = db.forget_quiet_runs(NOW - 7 * DAY)
    after = {r["id"]: r["session_id"] for r in (routes.past(x) for x in db.flow_runs(SLUG, 10))}
    print(json.dumps({
        "listed": sorted(listed & set(IDS)),
        "before": before,
        "after": after,
        "alive": {sid: db.session_exists(sid) for sid in IDS},
        "left_behind": {
            "messages": len(db.messages("prueba_quiet_old")),
            "history": len(db.query("SELECT 1 FROM history WHERE session_id = 'prueba_quiet_old'")),
        },
    }))
finally:
    clean()
"""


def judge(name: str, problems: list[str]) -> list[str]:
    """One line per claim, so a failure is read where it happened."""
    print(f"  {name}: " + ("PASS" if not problems else "FAIL — " + "; ".join(problems)))
    return problems


def main() -> int:
    print(f"container: {CONTAINER}")
    done = subprocess.run(
        ["docker", "exec", CONTAINER, "python3", "-c", INSIDE],
        capture_output=True, text=True,
    )
    if done.returncode != 0:
        print(done.stderr.strip()[-1500:])
        print("FLOW SESSIONS: FAIL")
        return 1
    r = json.loads(done.stdout)
    failures = []

    problems = []
    if r["listed"] != ["prueba_chat_old"]:
        problems.append(f"the list carries {r['listed']}")
    failures += judge("a. the chat's list is the client's conversations", problems)

    problems = []
    if sorted(v for v in r["before"].values() if v) != sorted(i for i in r["alive"] if i != "prueba_chat_old"):
        problems.append(f"the history names {r['before']}")
    failures += judge("b. the run is still there to open", problems)

    problems = []
    if r["alive"]["prueba_quiet_old"]:
        problems.append("the quiet old run kept its session")
    if r["left_behind"] != {"messages": 0, "history": 0}:
        problems.append(f"it left {r['left_behind']} behind")
    if len(r["after"]) != 4:
        problems.append(f"the history has {len(r['after'])} rows, not 4")
    if r["after"].get("prueba-corridas/1") is not None:
        problems.append("the history still links the transcript that is gone")
    failures += judge("c. a quiet old run loses its transcript and keeps its row", problems)

    problems = [
        f"`{sid}` lost its conversation"
        for sid in ("prueba_failed_old", "prueba_approval_old", "prueba_quiet_recent")
        if not r["alive"][sid]
    ]
    failures += judge("d. what somebody may need is kept", problems)

    problems = [] if r["alive"]["prueba_chat_old"] else ["an old chat was deleted"]
    failures += judge("e. no conversation of the client's is ever touched", problems)

    print("FLOW SESSIONS: " + ("PASS" if not failures else "FAIL"))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
