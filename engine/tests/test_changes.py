#!/usr/bin/env python3
"""What the portal polls to know what changed. `python3 engine/tests/test_changes.py`.

`server/portal.py`'s `changes()` over events and sessions this test writes,
INSIDE THE CONTAINER: no model, a second.

WHY. Luis (2026-09-24): «nada actualiza las aprobaciones, tengo que hacer
refresh». The portal now asks `/portal/changes?since=<cursor>` every few
seconds and each tab refetches when a kind it draws shows up (`app/app/lib/live.ts`).

  a. THE FIRST ASK ONLY SETS THE CURSOR — no `since`, no kinds.
  b. KINDS ARE WHAT CAME AFTER THE CURSOR — distinct, bookkeeping included
     (Uso draws `turn_usage`), and nothing written before it.
  c. THE CURSOR NEVER GOES BACK — deleting the newest event leaves `last`
     where it was, so the next ask does not replay it.
  d. THE CONVERSATION LIST HAS A STAMP — a new chat, a rename and a delete
     each move it; a flow's session does not (the list never shows it).

WHERE IT POINTS. `CORE_CONTAINER` moves it onto a second instance. It deletes
the events and sessions it wrote.
"""

import json
import os
import subprocess
import sys

CONTAINER = os.environ.get("CORE_CONTAINER", "tuagente-core")

INSIDE = r"""
import json
from core import db
from server import portal

SID, FLOW = "prueba_changes_chat", "prueba_changes_flow"
out = {}
first = portal.changes()
out["first"] = first
cursor = first["last"]
db.append_event("approval_requested", "Te pedí permiso: x", "pendiente", SID)
db.append_event("turn_usage", "Consumo", "completed", SID)
db.append_event("approval_requested", "Te pedí permiso: y", "pendiente", SID)
after = portal.changes(since=cursor)
out["kinds"] = sorted(after["kinds"])
out["advanced"] = after["last"] - cursor
out["nothing_new"] = portal.changes(since=after["last"])["kinds"]

newest = db.one("SELECT MAX(id) AS id FROM events")["id"]
db.write("DELETE FROM events WHERE id = ?", (newest,))
out["kept_cursor"] = portal.changes(since=after["last"])["last"] == after["last"]

stamps = [portal.changes()["sessions"]]
db.create_session(FLOW, kind="flow")
stamps.append(portal.changes()["sessions"])
db.create_session(SID)
stamps.append(portal.changes()["sessions"])
db.rename_session(SID, "Otro nombre")
stamps.append(portal.changes()["sessions"])
db.delete_session(SID)
stamps.append(portal.changes()["sessions"])
out["stamps"] = stamps

db.delete_session(FLOW)
db.write("DELETE FROM events WHERE session_id = ?", (SID,))
print(json.dumps(out, ensure_ascii=False))
"""


def judge(name: str, problems: list[str]) -> list[str]:
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
        print("CHANGES: FAIL")
        return 1
    r = json.loads(done.stdout.strip().splitlines()[-1])
    failures = []

    problems = [] if r["first"]["kinds"] == [] else [f"it listed {r['first']['kinds']}"]
    failures += judge("a. the first ask only sets the cursor", problems)

    problems = []
    if r["kinds"] != ["approval_requested", "turn_usage"]:
        problems.append(f"kinds were {r['kinds']}")
    if r["advanced"] != 3:
        problems.append(f"the cursor moved {r['advanced']}, not 3")
    if r["nothing_new"]:
        problems.append(f"asking again from the new cursor listed {r['nothing_new']}")
    failures += judge("b. kinds are what came after the cursor", problems)

    problems = [] if r["kept_cursor"] else ["deleting the newest event moved `last` back"]
    failures += judge("c. the cursor never goes back", problems)

    s = r["stamps"]
    problems = []
    if s[1] != s[0]:
        problems.append("a flow's session moved the stamp")
    for i, what in ((2, "a new chat"), (3, "a rename"), (4, "a delete")):
        if s[i] == s[i - 1]:
            problems.append(f"{what} did not move the stamp")
    failures += judge("d. the conversation list has a stamp", problems)

    print("CHANGES: " + ("PASS" if not failures else "FAIL"))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
