#!/usr/bin/env python3
"""A flow that needs a connection nobody set up. `python3 engine/tests/test_flow_connections.py`.

Two halves, no model, a few seconds:

  INSIDE THE CONTAINER, a connection made of a dict — `connection.prueba` —
  provided the way a plugin provides one, and `scheduler.run` swapped for one
  that writes down what it was called with.

  OVER HTTP, the lab's two real ones: the lab has a mailbox (GreenMail's
  EMAIL_* in its compose) and no Instagram token, so `mail` must answer
  «connected» and `instagram` must not.

  a. MISSING IS WHAT IS MISSING — the card's `missing_connections` is what this
     agent has not set up, not what the flow declares, and an `active` flow
     with something missing reads `incomplete`. The file still says `active`.
  b. AN ID NOBODY ANSWERS FOR IS MISSING — a connection no plugin provides is
     not set up, which is the honest reading.
  c. IT HAS NO NEXT RUN — the task's `next_run_at` is `None`, so the tab does
     not later read the skipped run as «No arrancó cuando le tocaba».
  d. THE CLOCK DOES NOT WAKE THE AGENT FOR IT — a tick with the flow overdue
     starts no run, and says so in Activity ONCE, however many ticks.
  e. CONNECTED, IT RUNS — the same flow, with the connection there, is
     `active`, has a next run, and the next overdue tick starts it.
  f. PAUSED STAYS PAUSED — and still says what is missing.
  g. `create_flow` SAYS WHAT IS MISSING — and announces no first run.
  h. THE LAB'S REAL ONES — `bandeja-de-entrada` is not missing `email`, and
     `instagram` is `incomplete` missing `instagram`, and Activity says so.

WHERE IT POINTS. `CORE_CONTAINER` and `CORE_ADAPTER` move it onto a second
instance. It cleans up the flow and the events it wrote.
"""

import json
import os
import subprocess
import sys
import urllib.request
from pathlib import Path

CORE = Path(__file__).resolve().parent.parent
CONTAINER = os.environ.get("CORE_CONTAINER", "tuagente-core")
ADAPTER = os.environ.get("CORE_ADAPTER", "http://127.0.0.1:8643")

secrets = (CORE / "secrets.env").read_text().splitlines()
KEY = next(line.split("=", 1)[1].strip() for line in secrets if line.startswith("API_SERVER_KEY="))

INSIDE = r"""
import asyncio, json, os, shutil, tempfile, time, types
from pathlib import Path

from core import db, flows, plugins, scheduler
from core.tools import flows as flow_tools
from server import flows as routes

# THE FLOWS OF THIS TEST LIVE OUTSIDE THE WORKSPACE. The engine's own
# scheduler reads `workspace/flows/` every thirty seconds, and a flow it could
# see is a flow it could run for real, or write its own Activity line about.
HOME = Path(tempfile.mkdtemp())
flows.root = lambda: HOME

SLUG, CREATED = "prueba-conexion", "prueba-conexion-creada"
state = {"on": False}
plugins._engine.shared["connection.prueba"] = lambda: state["on"]

runs = []
async def fake_run(flow, scheduled_at, manual=False, arrived=None):
    runs.append(flow.slug)
scheduler.run = fake_run
out = {}


def clean():
    for slug in (SLUG, CREATED):
        db.write("DELETE FROM flow_runs WHERE slug = ?", (slug,))
        db.write("DELETE FROM events WHERE payload LIKE ?", (f'%"{slug}"%',))


def overdue(flow):
    # Written ten minutes ago, with a cron every five: one occurrence is owed.
    old = time.time() - 600
    os.utime(flows.file_of(flow.slug), (old, old))
    scheduler._started = 0.0


async def settle():
    await scheduler.tick()
    # `tick` starts the run as a task; let it happen before the loop closes.
    await asyncio.sleep(0.1)


def tick(flow):
    asyncio.run(settle())


def snapshot(flow):
    card, job = routes.card(flow), routes.job(flow)
    return {"status": card["status"], "missing": card["missing_connections"],
            "next_run_at": job["next_run_at"], "file_status": flows.read(flow.slug).status}


clean()
try:
    flow = flows.Flow(slug=SLUG, name="Prueba de conexión", client_summary="x",
                      trigger="schedule", trigger_detail="Cada cinco minutos",
                      cron="*/5 * * * *", connections=["prueba", "nadie-la-conoce"],
                      how="1. Hago algo.")
    flows.write(flow)
    out["off"] = snapshot(flow)

    overdue(flow)
    tick(flow); tick(flow); tick(flow)
    out["off_runs"] = runs.count(SLUG)
    out["off_lines"] = [r["label"] for r in db.query(
        "SELECT label FROM events WHERE kind = 'flow.incomplete' AND payload LIKE ?",
        (f'%"{SLUG}"%',))]

    flow = flow.model_copy(update={"connections": ["prueba"]})
    flows.write(flow)
    state["on"] = True
    out["on"] = snapshot(flow)
    overdue(flow)
    tick(flow)
    out["on_runs"] = runs.count(SLUG)

    state["on"] = False
    flow = flow.model_copy(update={"status": "paused"})
    flows.write(flow)
    out["paused"] = snapshot(flow)

    create = flow_tools.toolset().tools["create_flow"].function
    spec = flow_tools.NewFlow(slug=CREATED, name="Creada", client_summary="x",
                              trigger="schedule", trigger_detail="Todos los días a las 9",
                              cron="0 9 * * *", connections=["prueba", "ninguna"],
                              steps=["Hago algo."])
    answer = create(types.SimpleNamespace(), spec)
    out["created"] = {"answer": answer, "file": flows.read(CREATED).connections}
    print(json.dumps(out, ensure_ascii=False))
finally:
    clean()
    shutil.rmtree(HOME, ignore_errors=True)
"""


def get(path: str) -> dict:
    request = urllib.request.Request(f"{ADAPTER}{path}", headers={"Authorization": f"Bearer {KEY}"})
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.load(response)


def judge(name: str, problems: list[str]) -> list[str]:
    print(f"  {name}: " + ("PASS" if not problems else "FAIL — " + "; ".join(problems)))
    return problems


def main() -> int:
    print(f"container: {CONTAINER}, adapter: {ADAPTER}")
    done = subprocess.run(
        ["docker", "exec", CONTAINER, "python3", "-c", INSIDE], capture_output=True, text=True
    )
    if done.returncode != 0:
        print(done.stderr.strip()[-2000:])
        print("FLOW CONNECTIONS: FAIL")
        return 1
    r = json.loads(done.stdout.strip().splitlines()[-1])
    failures = []

    off = r["off"]
    problems = []
    if off["status"] != "incomplete":
        problems.append(f"the card says {off['status']!r}")
    if off["file_status"] != "active":
        problems.append(f"the file was rewritten to {off['file_status']!r}")
    if "prueba" not in off["missing"]:
        problems.append(f"missing is {off['missing']}")
    failures += judge("a. missing is what is missing", problems)
    failures += judge("b. an id nobody answers for is missing",
                      [] if "nadie-la-conoce" in off["missing"] else [f"missing is {off['missing']}"])
    failures += judge("c. it has no next run",
                      [] if off["next_run_at"] is None else [f"next run {off['next_run_at']}"])

    problems = []
    if r["off_runs"]:
        problems.append(f"{r['off_runs']} runs started")
    if len(r["off_lines"]) != 1:
        problems.append(f"{len(r['off_lines'])} lines in Activity for three ticks")
    elif "hasta que conectemos prueba y nadie-la-conoce" not in r["off_lines"][0]:
        problems.append(f"the line says {r['off_lines'][0]!r}")
    failures += judge("d. the clock does not wake the agent for it", problems)

    on = r["on"]
    problems = []
    if on["status"] != "active" or on["missing"]:
        problems.append(f"the card says {on['status']!r} missing {on['missing']}")
    if on["next_run_at"] is None:
        problems.append("no next run")
    if r["on_runs"] != 1:
        problems.append(f"{r['on_runs']} runs after the tick")
    failures += judge("e. connected, it runs", problems)

    paused = r["paused"]
    failures += judge("f. paused stays paused",
                      [] if paused["status"] == "paused" and paused["missing"] == ["prueba"]
                      else [f"it reads {paused}"])

    created = r["created"]
    problems = []
    if created["answer"]["missing_connections"] != ["prueba"]:
        problems.append(f"the tool said {created['answer']['missing_connections']}")
    if created["answer"]["next_run"] is not None:
        problems.append(f"it announced a first run {created['answer']['next_run']}")
    if created["file"] != ["prueba"]:
        problems.append(f"the file declares {created['file']}")
    failures += judge("g. create_flow says what is missing", problems)

    listed = {f["slug"]: f for f in get("/portal/flows")["flows"]}
    problems = []
    mail = listed.get("bandeja-de-entrada")
    if mail is None or mail["missing_connections"]:
        problems.append(f"the lab's inbox flow reads {mail and mail['missing_connections']}")
    ig = listed.get("instagram")
    if ig is None or ig["status"] != "incomplete" or ig["missing_connections"] != ["instagram"]:
        problems.append(f"the lab's instagram flow reads {ig and (ig['status'], ig['missing_connections'])}")
    lines = [e for e in get("/portal/activity")["events"]
             if e["kind"] == "flow.incomplete" and "Instagram" in e["label"]]
    # At least one: the line is once per BOOT (claim d is the once), and the
    # lab may have been restarted since its workspace was made.
    if not lines:
        problems.append("no Activity line says the instagram flow is waiting")
    failures += judge("h. the lab's real ones", problems)

    print("FLOW CONNECTIONS: " + ("PASS" if not failures else "FAIL"))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
