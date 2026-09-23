#!/usr/bin/env python3
"""What the owner reads in Activity and Inicio. `python3 engine/tests/test_activity_feed.py`.

`server/portal.py`'s `activity()` over events this test writes, INSIDE THE
CONTAINER: no model, a second.

WHY. The QA client (2026-09-23) read, in her own feed: «Consumo del turno:
99049 tokens de entrada y 1056 de salida», an answer's first line with
`**Posteos**` in it, «Empecé el flujo» still saying «Miga está trabajando»
long after the run ended, and «Anoté: El cliente quiere…».

  a. BOOKKEEPING IS NOT IN THE FEED — `turn_usage`, `compaction` and
     `correction` stay in the table and out of `/portal/activity`.
  b. A LABEL IS PLAIN TEXT — markdown in what a caller quoted is gone, and so
     are the line breaks.
  c. A START THAT ENDED SAYS HOW IT ENDED — a flow's `started` takes its
     `finished`'s status, a paused one takes the pause's until it finishes, a
     delegation's takes its `finished`, and one whose turn broke takes the
     `error`. One that has not ended still reads `running`.
  d. MEMORY SPEAKS TO HER — the extraction's label opens «Me anoté:», and its
     prose tells the model to write to the client, «de vos», never «El cliente».

WHERE IT POINTS. `CORE_CONTAINER` moves it onto a second instance. It deletes
the events it wrote.
"""

import json
import os
import subprocess
import sys

CONTAINER = os.environ.get("CORE_CONTAINER", "tuagente-core")

INSIDE = r"""
import json, sys
sys.path.insert(0, "/opt/kit/plugins/memory/core")

from core import db
from server import portal

FLOW, PAUSED, CHAT, BROKE, OPEN = (f"prueba_feed_{n}" for n in range(5))
db.append_event("turn_usage", "Consumo del turno: 10 tokens", "completed", CHAT)
db.append_event("compaction", "Resumí la conversación", "completed", CHAT)
db.append_event("correction", "Le agregué a la respuesta", "completed", CHAT)
db.append_event("respuesta", "Te dejé **dos** posteos en *Posteos*\ny `listo`", "completed", CHAT)
db.append_event("flow.started", "Empecé el flujo «A»", "running", FLOW)
db.append_event("flow.finished", "Terminé el flujo «A»", "completed", FLOW)
db.append_event("flow.started", "Empecé el flujo «B»", "running", PAUSED)
db.append_event("flow.paused", "Pausé el flujo «B»", "pendiente", PAUSED)
db.append_event("delegation.started", "Le pedí al creador: uno", "running", CHAT)
db.append_event("delegation.started", "Le pedí al creador: dos", "running", CHAT)
db.append_event("delegation.finished", "El creador terminó", "completed", CHAT)
db.append_event("delegation.started", "Le pedí al creador: tres", "running", BROKE)
db.append_event("error", "No pude responder: x", "error", BROKE)
db.append_event("flow.started", "Empecé el flujo «C»", "running", OPEN)

import extraction
out = {
    "feed": [
        {"kind": e["kind"], "label": e["label"], "status": e["status"]}
        for e in portal.activity()["events"]
        if e["label"].startswith(("Consumo", "Resumí", "Le agregué", "Te dejé", "Empecé",
                                  "Le pedí al creador"))
    ],
    "kept": [r["kind"] for r in db.recent_events(50) if r["session_id"] == CHAT
             and r["kind"] in ("turn_usage", "compaction", "correction")],
    "memory_label": extraction.LABEL,
    "memory_prose": extraction.INSTRUCTIONS,
}
for sid in (FLOW, PAUSED, CHAT, BROKE, OPEN):
    db.write("DELETE FROM events WHERE session_id = ?", (sid,))
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
        print("ACTIVITY FEED: FAIL")
        return 1
    r = json.loads(done.stdout.strip().splitlines()[-1])
    feed = {e["label"]: e for e in r["feed"]}
    failures = []

    problems = [f"«{label}» is in the feed" for label in feed
                if label.startswith(("Consumo", "Resumí", "Le agregué"))]
    if sorted(r["kept"]) != ["compaction", "correction", "turn_usage"]:
        problems.append(f"the table kept {r['kept']}")
    failures += judge("a. bookkeeping is not in the feed", problems)

    answer = next((label for label in feed if label.startswith("Te dejé")), "")
    problems = [] if answer == "Te dejé dos posteos en Posteos y listo" else [f"it reads {answer!r}"]
    failures += judge("b. a label is plain text", problems)

    want = {
        "Empecé el flujo «A»": "completed",
        "Empecé el flujo «B»": "pendiente",
        "Empecé el flujo «C»": "running",
        "Le pedí al creador: uno": "completed",
        "Le pedí al creador: dos": "running",
        "Le pedí al creador: tres": "error",
    }
    problems = [f"«{label}» reads {feed.get(label, {}).get('status')}, not {status}"
                for label, status in want.items() if feed.get(label, {}).get("status") != status]
    failures += judge("c. a start that ended says how it ended", problems)

    problems = []
    if r["memory_label"] != "Me anoté: ":
        problems.append(f"the label opens {r['memory_label']!r}")
    if "de vos" not in r["memory_prose"] or "Nunca «El cliente" not in r["memory_prose"]:
        problems.append("the extraction is not told to write to the client")
    failures += judge("d. memory speaks to her", problems)

    print("ACTIVITY FEED: " + ("PASS" if not failures else "FAIL"))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
