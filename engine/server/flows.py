"""The Flows tab, from one reader.

Two bases, one source. `/portal/flows*` is what the tab lists and opens;
`/api/jobs*` is what it crosses that listing against to say when the flow runs
next, how the last run went and whether it is paused — on Hermes those were two
different stores that could disagree, and the portal has a whole "uncertain"
state for when they did. Here both come from `core/flows.py` and the run rows,
so they cannot.

The shapes are `app/app/lib/agent.ts`'s `Flow`, `FlowDetail` and `CronJob`,
kept to the letter: the tab is not changed for this engine.

`results` and `results_total` travel empty. Where a flow's output lands is the
business of the plugin that produces it, and that plugin brings its own view
(`docs/own-agent-plan.md`); the two fields stay because the type has them.
"""

import asyncio
from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException

from core import config, db, flows, scheduler

router = APIRouter()

# The name of a flow's scheduled task. The `flujo-` prefix is a compatibility
# key the portal matches by string (`app/app/flows/runs.ts`) against the cron
# jobs already created inside deployed Hermes agents, so it STAYS in Spanish.
JOB_PREFIX = "flujo-"

# Read by the client: the portal puts `error.message` on the screen she is on.
NO_FLOW = "No hay ningún flujo {slug} en este agente."
NO_JOB = "No hay ninguna tarea {job_id} en este agente."
NO_ACTION = "No sé hacer «{action}» con una tarea: pausar, reanudar o correrla."


def iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, ZoneInfo(config.TIMEZONE)).isoformat()


def job_id(slug: str) -> str:
    return f"{JOB_PREFIX}{slug}"


def card(flow: flows.Flow) -> dict:
    """One flow, the `Flow` shape of `lib/agent.ts`."""
    last = db.last_finished_flow_run(flow.slug)
    return {
        "slug": flow.slug,
        "name": flow.name,
        "client_summary": flow.client_summary,
        "trigger_type": flow.trigger,
        "trigger": flow.trigger_detail,
        "status": flow.status,
        "missing_connections": flow.connections,
        "last_run": (
            {"at": iso(last["finished_at"] or last["started_at"]), "status": last["status"]}
            if last else None
        ),
        # Finally published, instead of the portal guessing it from the name:
        # a flow that runs on its own — on the clock, or when something
        # arrives — has a task, one that waits to be asked has none.
        "trigger_job": job_id(flow.slug) if flow.trigger in ON_ITS_OWN else None,
        "results": [],
        "results_total": 0,
    }


def job(flow: flows.Flow) -> dict:
    """One flow's scheduled task, the `CronJob` shape of `lib/agent.ts`.

    `last_status` is the last run WITH AN OUTCOME and never the one in flight:
    the portal reads any status it does not know as "uncertain", and a client
    reading "we are not sure how it went" about a run that is still going is
    worse than reading nothing. What says a run is happening now is `state`.

    `paused` travels as that outcome, and `state` stays what it was: `state` is
    the JOB's — scheduled, paused by the client, running — and the flow is none
    of those because one of its runs is waiting for a yes. The portal maps
    `last_status: "paused"` to «Esperando tu aprobación» (`app/app/flows/runs.ts`).
    """
    last = db.last_finished_flow_run(flow.slug)
    running = db.flow_run_in_flight(flow.slug)
    upcoming = scheduler.due_at(flow)
    latest = db.last_flow_run(flow.slug)
    return {
        "id": job_id(flow.slug),
        "name": job_id(flow.slug),
        "enabled": flow.status == "active",
        "state": "running" if running else ("paused" if flow.status == "paused" else "scheduled"),
        # An `event` flow has no expression and no next run: it runs when
        # something arrives, and `next_run_at` below is `None` for it.
        "schedule": {"kind": "cron" if flow.cron else "event", "expr": flow.cron,
                     "display": flow.trigger_detail},
        "schedule_display": flow.trigger_detail,
        "next_run_at": iso(upcoming.timestamp()) if upcoming else None,
        "last_run_at": iso(last["finished_at"] or last["started_at"]) if last else None,
        "last_status": last["status"] if last else None,
        "last_error": last["error"] if last else None,
        # The file's own mtime: pausing a flow is writing its FLOW.md, so that
        # is the moment it was paused, and there is no second place to keep it.
        "paused_at": (
            iso(flows.file_of(flow.slug).stat().st_mtime) if flow.status == "paused" else None
        ),
        # The run in flight or the last one, as the Flows tab reads it by
        # structure (`runs.ts`, `Execution`): it is what draws «Trabajando
        # ahora» while a run is going, since `last_status` is never the one in
        # flight. The same row, in the tab's vocabulary.
        "latest_execution": execution(latest) if latest else None,
    }


EXECUTION_STATUS = {"running": "running", "ok": "completed", "error": "failed", "paused": "paused"}


def execution(run) -> dict:
    return {
        "id": f"{run['slug']}/{int(run['scheduled_at'])}",
        "status": EXECUTION_STATUS[run["status"]],
        "claimed_at": iso(run["started_at"]) if run["started_at"] else None,
        "started_at": iso(run["started_at"]) if run["started_at"] else None,
        "finished_at": iso(run["finished_at"]) if run["finished_at"] else None,
        "error": run["error"],
    }


# How many runs the flow's own page lists. A day of a flow that runs hourly.
RUNS_SHOWN = 24


def past(run) -> dict:
    """One run in the flow's history, the `FlowRun` shape of `lib/agent.ts`.

    `session_id` is the conversation the run happened in, and it is how the
    client opens one: a run's session is not in the chat's list
    (`db.sessions`). `None` once `db.forget_quiet_runs` has taken it.
    """
    return execution(run) | {
        "manual": bool(run["manual"]),
        "session_id": run["session_id"] if run["has_session"] else None,
    }


# The triggers that make a flow run without anybody asking. Each of those
# flows has a task the tab can pause, resume and run now.
ON_ITS_OWN = ("schedule", "event")


def scheduled() -> list[flows.Flow]:
    return [f for f in flows.read_all() if f.trigger in ON_ITS_OWN]


def by_job(job_id_: str) -> flows.Flow:
    flow = next((f for f in scheduled() if job_id(f.slug) == job_id_), None)
    if flow is None:
        raise HTTPException(404, NO_JOB.format(job_id=job_id_))
    return flow


# ── the tab ─────────────────────────────────────────────────────────────────

@router.get("/portal/flows")
def listing():
    return {"available": True, "flows": [card(f) for f in flows.read_all()]}


@router.get("/portal/flows/{slug}")
def detail(slug: str):
    flow = flows.read(slug)
    if flow is None:
        raise HTTPException(404, NO_FLOW.format(slug=slug))
    # `how` is the half of the body above `## Notas técnicas`: what the client
    # reads as "cómo lo trabaja tu agente". The notes are the run's, and they
    # never leave the engine.
    return card(flow) | {"how": flow.how, "runs": [past(r) for r in db.flow_runs(slug, RUNS_SHOWN)]}


# ── the scheduled tasks the tab crosses it against ──────────────────────────

@router.get("/api/jobs")
def jobs(include_disabled: bool = False):
    return {
        "jobs": [job(f) for f in scheduled() if include_disabled or f.status == "active"]
    }


async def run_now(flow: flows.Flow, now: datetime) -> None:
    """«Probarlo ahora». For an `event` flow that is one look of its watcher
    right now, and the run gets what it found plus whatever was already
    waiting — or, when nothing arrived, a line that says so: she asked for a
    run and the tab is watching for one."""
    if flow.trigger != "event":
        return await scheduler.run(flow, now, manual=True)
    await asyncio.to_thread(scheduler.look, flow)
    arrived = "\n\n".join(db.take_pending(flow.slug)) or scheduler.NOTHING_ARRIVED
    await scheduler.run(flow, now, manual=True, arrived=arrived)


@router.post("/api/jobs/{job_id_}/{action}")
async def act(job_id_: str, action: str):
    """Pause, resume and run now — the three buttons on a flow's card.

    Pause and resume are ONE LINE OF THE FLOW.md, because the file is the
    schedule. `run` claims the row for this instant and answers immediately:
    the client is not going to sit on a request while a whole turn happens, and
    the tab watches the task until the run shows up.
    """
    flow = by_job(job_id_)
    if action == "run":
        now = datetime.now(flows.zone(flow)).replace(microsecond=0)
        asyncio.create_task(run_now(flow, now))
        return {"job": job(flow)}
    if action not in ("pause", "resume"):
        raise HTTPException(400, NO_ACTION.format(action=action))
    flow = flow.model_copy(update={"status": "paused" if action == "pause" else "active"})
    flows.write(flow)
    return {"job": job(flow)}
