#!/usr/bin/env python3
"""A flow that runs when something arrives. `python3 engine/tests/test_event_flows.py`.

Inside the container, with a watcher made of a list and `scheduler.run` swapped
for one that writes down what it was called with: no model, no network, a
second. What is asserted is the MECHANISM — when a look becomes a run — and the
run itself is the same one every other flow test already covers.

WHY. Until 2026-09-20 the Instagram flow was a cron: a whole turn of the agent
every fifteen minutes to find out there was nothing to do. The looking is code
now (`core/watchers.py`), and a flow only becomes a turn when there is work.

  a. THE FILE SAYS IT — `trigger: event` needs `event:`, and nothing else may
     carry one. The round trip through FLOW.md keeps it.
  b. A QUIET LOOK IS NOTHING — no run, nothing waiting.
  c. WHAT A LOOK FINDS WAITS FOR A QUIET ONE — three messages in a row are one
     conversation: the first look that finds something does not run, the next
     one that finds nothing more does, ONCE, with everything found in order.
  d. IT TRAVELS IN THE PROMPT — under «Lo que llegó», last, and in what the
     client reads of the run; a run with nothing to carry has no such heading.
  e. NOT ON TOP OF A RUN IN FLIGHT — what arrives while the flow is working
     waits, and runs when that one is done.
  f. AND NOT FOREVER — on an account where every look finds something, the
     ceiling starts the run anyway.
  g. WHAT IS WAITING SURVIVES A RESTART — it is a table, not a variable.
  h. A BROKEN WATCHER IS ONE LINE IN ACTIVITY, NOT ONE PER LOOK — and it does
     not take the loop down.
  i. IT HAS A TASK — the tab can pause it and run it now; it has no next run.

WHERE IT POINTS. `CORE_CONTAINER` moves it onto a second instance; the default
is the main compose's `tuagente-core`.
"""

import json
import os
import subprocess
import sys

CONTAINER = os.environ.get("CORE_CONTAINER", "tuagente-core")

INSIDE = r"""
import asyncio, json, shutil, time

from core import db, flows, scheduler, watchers
from server import flows as routes

SLUG = "prueba-evento"
EVENT = "prueba.evento"
out = {}

# The watcher: whatever is at the front of this list, or nothing.
queue = []
def fn():
    found = queue.pop(0) if queue else None
    if isinstance(found, Exception):
        raise found
    return found
watchers.WATCHERS[EVENT] = watchers.Watcher(fn, every=30)

# The run: written down, not run.
runs = []
async def fake_run(flow, scheduled_at, manual=False, arrived=None):
    runs.append({"slug": flow.slug, "manual": manual, "arrived": arrived})
scheduler.run = fake_run


def clean():
    shutil.rmtree(flows.root() / SLUG, ignore_errors=True)
    db.write("DELETE FROM flow_pending WHERE slug = ?", (SLUG,))
    db.write("DELETE FROM flow_runs WHERE slug = ?", (SLUG,))
    db.write("DELETE FROM events WHERE payload LIKE ?", (f'%{SLUG}%',))


def look():
    asyncio.run(scheduler.watch(flow))
    return {"runs": len(runs), "waiting": db.pending_since(SLUG) is not None}


clean()
try:
    # (a) the model.
    base = dict(slug=SLUG, name="Prueba de evento", client_summary="x",
                trigger_detail="Cuando llega algo", how="1. Hago lo que llegó.")
    for label, extra in (("event_without_name", {"trigger": "event"}),
                         ("schedule_with_event", {"trigger": "schedule", "cron": "0 9 * * *", "event": EVENT}),
                         ("request_with_event", {"trigger": "request", "event": EVENT})):
        try:
            flows.Flow(**base, **extra)
            out[label] = "accepted"
        except Exception as exc:
            out[label] = str(exc)[-160:]
    flow = flows.Flow(**base, trigger="event", event=EVENT)
    flows.write(flow)
    back = flows.read(SLUG)
    out["round_trip"] = {"trigger": back.trigger, "event": back.event, "cron": back.cron}

    # (b) quiet.
    out["quiet"] = look()

    # (c) found, found again, then quiet.
    queue[:] = ["primero", "segundo"]
    out["first_hit"] = look()
    out["wants_next_tick"] = scheduler.wants_a_look(flow, time.time())
    out["second_hit"] = look()
    out["settled"] = look()
    out["settled_run"] = runs[-1] if runs else None

    # (d) the prompt.
    out["prompt"] = scheduler.prompt(flow, "lo que llegó, entero")
    out["prompt_plain"] = scheduler.prompt(flow)
    out["display"] = scheduler.display(flow, __import__("datetime").datetime(2020, 1, 4, 9, 0), "lo que llegó, entero")

    # (e) a run in flight.
    before = len(runs)
    db.claim_flow_run(SLUG, 1.0, "prueba_evento_en_vuelo", False)
    queue[:] = ["llegó durante la corrida"]
    look()
    out["during_flight"] = look() | {"new_runs": len(runs) - before}
    db.finish_flow_run(SLUG, 1.0, "ok")
    out["after_flight"] = look() | {"new_runs": len(runs) - before, "arrived": runs[-1]["arrived"]}

    # (f) the ceiling.
    before = len(runs)
    queue[:] = ["uno", "dos"]
    look()
    db.write("UPDATE flow_pending SET created_at = ? WHERE slug = ?",
             (time.time() - scheduler.SETTLE_CEILING - 1, SLUG))
    out["ceiling"] = look() | {"new_runs": len(runs) - before, "arrived": runs[-1]["arrived"]}

    # (g) a restart: nothing in memory, a row on disk.
    before = len(runs)
    db.add_pending(SLUG, "quedó de antes de apagarse")
    scheduler._looked.clear()
    out["restart_wants"] = scheduler.wants_a_look(flow, time.time())
    out["restart"] = look() | {"new_runs": len(runs) - before, "arrived": runs[-1]["arrived"]}

    # (h) the watcher breaks, twice, the same way.
    queue[:] = [RuntimeError("Instagram no contesta"), RuntimeError("Instagram no contesta")]
    look(); look()
    out["errors"] = [r["label"] for r in db.query(
        "SELECT label FROM events WHERE kind = 'flow.failed' AND payload LIKE ?", (f'%{SLUG}%',))]

    # (i) the task.
    job = routes.job(flow)
    out["job"] = {"id": job["id"], "state": job["state"], "next_run_at": job["next_run_at"],
                  "kind": job["schedule"]["kind"]}
    out["card_job"] = routes.card(flow)["trigger_job"]
    print(json.dumps(out, ensure_ascii=False))
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
        print(done.stderr.strip()[-2000:])
        print("EVENT FLOWS: FAIL")
        return 1
    r = json.loads(done.stdout.strip().splitlines()[-1])
    failures = []

    problems = [f"`{k}` was accepted" for k in ("event_without_name", "schedule_with_event", "request_with_event")
                if r[k] == "accepted"]
    if r["round_trip"] != {"trigger": "event", "event": "prueba.evento", "cron": None}:
        problems.append(f"the file came back as {r['round_trip']}")
    failures += judge("a. the file says it", problems)

    problems = [] if r["quiet"] == {"runs": 0, "waiting": False} else [f"it left {r['quiet']}"]
    failures += judge("b. a quiet look is nothing", problems)

    problems = []
    if r["first_hit"] != {"runs": 0, "waiting": True}:
        problems.append(f"the first look that found something left {r['first_hit']}")
    if not r["wants_next_tick"]:
        problems.append("with something waiting, the next tick would not look again")
    if r["second_hit"]["runs"] != 0:
        problems.append("it ran while things were still arriving")
    if r["settled"] != {"runs": 1, "waiting": False}:
        problems.append(f"the quiet look left {r['settled']}")
    if (r["settled_run"] or {}).get("arrived") != "primero\n\nsegundo":
        problems.append(f"the run got {r['settled_run']}")
    failures += judge("c. what a look finds waits for a quiet one", problems)

    problems = []
    if not r["prompt"].endswith("## Lo que llegó\n\nlo que llegó, entero"):
        problems.append("what arrived is not the last thing in the prompt")
    if "Lo que llegó" in r["prompt_plain"]:
        problems.append("a run with nothing to carry has the heading")
    if "lo que llegó, entero" not in r["display"]:
        problems.append("the client does not read what started the run")
    failures += judge("d. it travels in the prompt", problems)

    problems = []
    if r["during_flight"]["new_runs"] != 0 or not r["during_flight"]["waiting"]:
        problems.append(f"with a run in flight: {r['during_flight']}")
    if r["after_flight"]["new_runs"] != 1 or r["after_flight"]["arrived"] != "llegó durante la corrida":
        problems.append(f"once it finished: {r['after_flight']}")
    failures += judge("e. not on top of a run in flight", problems)

    problems = []
    if r["ceiling"]["new_runs"] != 1 or r["ceiling"]["arrived"] != "uno\n\ndos":
        problems.append(f"past the ceiling: {r['ceiling']}")
    failures += judge("f. and not forever", problems)

    problems = []
    if not r["restart_wants"]:
        problems.append("a fresh process would not look")
    if r["restart"]["new_runs"] != 1 or r["restart"]["arrived"] != "quedó de antes de apagarse":
        problems.append(f"after a restart: {r['restart']}")
    failures += judge("g. what is waiting survives a restart", problems)

    problems = []
    if len(r["errors"]) != 1:
        problems.append(f"{len(r['errors'])} lines in Activity for the same error twice")
    elif "Instagram no contesta" not in r["errors"][0]:
        problems.append(f"the line says {r['errors'][0]!r}")
    failures += judge("h. a broken watcher is one line, not one per look", problems)

    problems = []
    if r["job"] != {"id": "flujo-prueba-evento", "state": "scheduled", "next_run_at": None, "kind": "event"}:
        problems.append(f"the task is {r['job']}")
    if r["card_job"] != "flujo-prueba-evento":
        problems.append("the card does not name its task")
    failures += judge("i. it has a task", problems)

    print("EVENT FLOWS: " + ("PASS" if not failures else "FAIL"))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
