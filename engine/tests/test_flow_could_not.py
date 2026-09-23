#!/usr/bin/env python3
"""A run that could not do its work is not «Terminé». `python3 engine/tests/test_flow_could_not.py`.

Two halves, no model, a few seconds:

  INSIDE THE CONTAINER, `scheduler.run` over a flow of this test, with
  `session.run_turn` swapped for a turn that does what a tool does when its
  connection is not there: `scheduler.could_not(session_id, reason)`.

  OVER HTTP, «Probarlo ahora» on the lab's `instagram` flow, which is
  `incomplete` (the lab has no Instagram token).

WHY. On the QA agent (2026-09-23) «Probarlo ahora» on the mail flow with no
mailbox ran: a whole turn to answer «No pude revisar la casilla: falta conectar
el correo (EMAIL_ADDRESS)», and Activity read «Terminé el flujo «Bandeja de
entrada»».

  a. A RUN A TOOL SAID COULD NOT WORK ENDS `error` — with the tool's reason on
     the row, a `flow.failed` in Activity that carries it, and no
     `flow.finished`.
  b. A RUN WITH NOTHING SAID ENDS `ok` — the same run, no call: «Terminé».
  c. FROM A CHAT TURN IT DOES NOTHING — a session with no run behind it keeps
     nothing, so nothing leaks into the next run.
  d. RUN-NOW ON AN INCOMPLETE FLOW IS REFUSED — a 409 in the portal's error
     shape, Spanish, naming the connection as the client calls it, and no run.

WHERE IT POINTS. `CORE_CONTAINER` and `CORE_ENDPOINT` move it onto a second
instance. It cleans up the flow and the rows it wrote.
"""

import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

CORE = Path(__file__).resolve().parent.parent
CONTAINER = os.environ.get("CORE_CONTAINER", "tuagente-core")
ENDPOINT = os.environ.get("CORE_ENDPOINT", "http://127.0.0.1:8642")

secrets = (CORE / "secrets.env").read_text().splitlines()
KEY = next(line.split("=", 1)[1].strip() for line in secrets if line.startswith("API_SERVER_KEY="))

INSIDE = r"""
import asyncio, json, tempfile
from datetime import datetime
from pathlib import Path

from core import db, flows, scheduler, session

# Outside the workspace, so the real clock never sees this flow.
HOME = Path(tempfile.mkdtemp())
flows.root = lambda: HOME
SLUG = "prueba-no-pudo"
REASON = "El correo de la empresa todavía no está conectado."
say = {"it": True}


async def turn(session_id, message, display=None):
    if say["it"]:
        scheduler.could_not(session_id, REASON)
    yield session.MessageCompleted("No pude revisar la casilla.")


session.run_turn = turn


def outcome(stamp):
    row = db.one("SELECT * FROM flow_runs WHERE slug = ? AND scheduled_at = ?", (SLUG, stamp))
    kinds = [e["kind"] for e in db.query(
        "SELECT kind FROM events WHERE session_id = ?", (row["session_id"],))]
    labels = [e["label"] for e in db.query(
        "SELECT label FROM events WHERE session_id = ? AND kind = 'flow.failed'",
        (row["session_id"],))]
    return {"status": row["status"], "error": row["error"], "kinds": kinds, "failed": labels}


out = {"reason": REASON}
try:
    flow = flows.Flow(slug=SLUG, name="Prueba", client_summary="x", trigger="schedule",
                      trigger_detail="Cada cinco minutos", cron="*/5 * * * *", how="1. Algo.")
    flows.write(flow)
    first = datetime(2030, 1, 1, 9, 0)
    asyncio.run(scheduler.run(flow, first, manual=True))
    out["could_not"] = outcome(first.timestamp())
    say["it"] = False
    second = datetime(2030, 1, 1, 9, 5)
    asyncio.run(scheduler.run(flow, second, manual=True))
    out["could"] = outcome(second.timestamp())
    scheduler.could_not("api_no_es_una_corrida", REASON)
    out["chat_kept"] = "api_no_es_una_corrida" in scheduler._could_not
finally:
    for row in db.query("SELECT session_id FROM flow_runs WHERE slug = ?", (SLUG,)):
        db.write("DELETE FROM events WHERE session_id = ?", (row["session_id"],))
        db.delete_session(row["session_id"])
    db.write("DELETE FROM flow_runs WHERE slug = ?", (SLUG,))
print(json.dumps(out, ensure_ascii=False))
"""


def judge(name: str, problems: list[str]) -> list[str]:
    print(f"  {name}: " + ("PASS" if not problems else "FAIL — " + "; ".join(problems)))
    return problems


def run_now(job: str) -> tuple[int, dict]:
    request = urllib.request.Request(
        f"{ENDPOINT}/api/jobs/{job}/run", method="POST",
        headers={"Authorization": f"Bearer {KEY}"},
    )
    try:
        with urllib.request.urlopen(request) as answer:
            return answer.status, json.load(answer)
    except urllib.error.HTTPError as exc:
        return exc.code, json.load(exc)


def main() -> int:
    print(f"container: {CONTAINER}")
    done = subprocess.run(
        ["docker", "exec", CONTAINER, "python3", "-c", INSIDE],
        capture_output=True, text=True,
    )
    if done.returncode != 0:
        print(done.stderr.strip()[-1500:])
        print("FLOW COULD NOT: FAIL")
        return 1
    r = json.loads(done.stdout.strip().splitlines()[-1])
    failures = []

    got = r["could_not"]
    problems = []
    if got["status"] != "error" or got["error"] != r["reason"]:
        problems.append(f"the row reads {got['status']} / {got['error']!r}")
    if "flow.finished" in got["kinds"]:
        problems.append("Activity still says «Terminé»")
    if not any(r["reason"] in label for label in got["failed"]):
        problems.append(f"Activity says {got['failed']}")
    failures += judge("a. a run a tool said could not work ends error", problems)

    got = r["could"]
    problems = [] if got["status"] == "ok" and "flow.finished" in got["kinds"] else [
        f"it read {got}"]
    failures += judge("b. a run with nothing said ends ok", problems)

    problems = ["a chat session kept a reason"] if r["chat_kept"] else []
    failures += judge("c. from a chat turn it does nothing", problems)

    status, body = run_now("flujo-instagram")
    said = (body.get("error") or {}).get("message", "")
    problems = []
    if status != 409:
        problems.append(f"run-now answered {status} {body}")
    elif "Instagram" not in said or "conectar" not in said:
        problems.append(f"it said {said!r}")
    print(f"  «{said}»")
    failures += judge("d. run-now on an incomplete flow is refused", problems)

    print("FLOW COULD NOT: " + ("PASS" if not failures else "FAIL"))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
