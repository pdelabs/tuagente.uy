#!/usr/bin/env python3
"""Uso shows what THIS agent spent. `python3 engine/tests/test_usage.py`.

`server/extra.py`'s `usage()`, INSIDE THE CONTAINER, over events this test
writes: no model, no provider, a second.

WHY. The QA agent (2026-09-23), created that morning, showed the OpenRouter
KEY's whole spend — today, this month, all time — and «lleva gastados US$
12,03» under the key's cap. The key is shared in the lab; the page is about
the agent.

  a. THE DAYS ARE THE AGENT'S OWN MONEY — a turn's `turn_usage` and a
     `spend` outside it both count, today in today, last month only in the
     total.
  b. A CALL NOBODY PRICED IS NOT ZERO — it is counted in `unpriced`, and adds
     nothing.
  c. THE KEY TRAVELS APART — no `limit_usd` at the top, where the portal pairs
     it with the agent's total; the key's figures are under `key`.

WHERE IT POINTS. `CORE_CONTAINER` moves it onto a second instance. It deletes
the events it wrote.
"""

import json
import os
import subprocess
import sys

CONTAINER = os.environ.get("CORE_CONTAINER", "tuagente-core")

INSIDE = r"""
import json, time
from datetime import datetime
from zoneinfo import ZoneInfo

from core import config, db, turn_usage
from server import extra

SID = "prueba_uso"
before = extra.usage()
turn_usage.spend(SID, "una imagen", 0.25)
turn_usage.spend(SID, "algo sin precio", None)
db.append_event("turn_usage", "x", "completed", SID, {"cost_usd": 1.0})
# One from last month: in the total and not in this month.
first = datetime.now(ZoneInfo(config.TIMEZONE)).replace(day=1, hour=0, minute=0, second=0)
db.append_event("turn_usage", "x", "completed", SID, {"cost_usd": 2.0})
db.write("UPDATE events SET ts = ? WHERE id = (SELECT MAX(id) FROM events)",
         (first.timestamp() - 3600,))
after = extra.usage()
db.write("DELETE FROM events WHERE session_id = ?", (SID,))
print(json.dumps({"before": before, "after": after}))
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
        print("USAGE: FAIL")
        return 1
    r = json.loads(done.stdout.strip().splitlines()[-1])
    b, a = r["before"], r["after"]
    failures = []

    delta = {k: round(a[k] - b[k], 6) for k in ("today_usd", "month_usd", "total_usd")}
    want = {"today_usd": 1.25, "month_usd": 1.25, "total_usd": 3.25}
    problems = [] if delta == want else [f"the numbers moved {delta}, not {want}"]
    failures += judge("a. the days are the agent's own money", problems)

    problems = [] if a["unpriced"] - b["unpriced"] == 1 else [
        f"unpriced moved {a['unpriced'] - b['unpriced']}"]
    failures += judge("b. a call nobody priced is not zero", problems)

    problems = []
    if "limit_usd" in a:
        problems.append("limit_usd is still at the top")
    if "key" not in a:
        problems.append("the key's figures are gone")
    failures += judge("c. the key travels apart", problems)

    print("USAGE: " + ("PASS" if not failures else "FAIL"))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
