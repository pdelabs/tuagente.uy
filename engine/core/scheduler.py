"""The clock. One asyncio task, and a run is a headless session.

Every 30 s it reads the flows off disk and asks each active `schedule` one the
same question: what is the first occurrence after the last run of this flow,
and has it passed? If it has, it claims the row and runs. There is no job
store to drift from the files and no queue to lose: the state a tick needs is
the FLOW.md and the rows of runs that already happened.

MISSED TICKS COLLAPSE INTO ONE RUN. A tick looks at ONE occurrence — the next
one after the last run — so an agent that was off for a weekend comes back and
does Monday's work once, not sixty times.

A RUN IS THE SAME TURN AS A CHAT TURN. `session.run_turn`, the same tools, the
same gate, the same hooks, the same compaction. What it is not is a special
kind of agent: the only difference from the client typing the flow's steps into
the chat is that nobody typed them.

AND THE SAME TURN CAN STOP AT THE GATE. A run that ends in the approval plugin
writing a request down did not finish: its row reads `paused` until the client
answers and `resumed()` closes it. Recording it `ok` is what made the card go
green with the mail still sitting in Aprobaciones.
"""

import asyncio
import inspect
import logging
import time
from datetime import datetime

from . import config, db, flows, plugins, session, watchers
from .flows import Flow

log = logging.getLogger(__name__)

INTERVAL = 30

# Read by the client in Activity. A row left `running` means the process died
# holding it: nothing else can leave one behind, because every other path
# finishes the row it claimed.
KILLED = "La corrida se cortó: el agente se apagó mientras la trabajaba."

# When the process started. It is the floor under the first occurrence of a
# flow that has never run, so an engine that has been up for a week does not
# replay that week the moment a flow is written.
_started = 0.0


def title(flow: Flow, scheduled_at: datetime) -> str:
    """What the conversation is called in the client's list."""
    return f"{flow.name} · {scheduled_at.strftime('%d/%m %H:%M')}"


# The heading what a watcher found travels under, in the run's prompt and in
# what the client reads of it. Spanish: both read it.
ARRIVED = "## Lo que llegó"

# A run somebody asked for by hand on a flow that waits for things to arrive,
# when nothing has.
NOTHING_ARRIVED = "No llegó nada nuevo desde la última vez."

# How long what a watcher found may wait for the look that finds nothing more.
# The settle is one tick; this is the ceiling under an account where something
# new arrives on every tick.
SETTLE_CEILING = 120


def prompt(flow: Flow, arrived: str | None = None) -> str:
    """The one user turn a run is, AS THE MODEL READS IT. Spanish: the agent
    reads it.

    Both halves of the body travel. The client reads the steps in the portal
    and the technical notes are trimmed there, but the run needs them: that is
    where the tools, the folders and the edge cases of this flow are written.
    """
    parts = [
        f"Te toca trabajar el flujo «{flow.name}». Nadie está mirando la pantalla:"
        " hacé el trabajo y dejá el resultado donde dicen los pasos.",
        flow.how,
    ]
    if flow.notes:
        parts.append(f"{flows.NOTES_HEADING}\n\n{flow.notes}")
    if arrived:
        # LAST, under its own heading: it is the one part of this prompt that
        # is different every run, and it is the work.
        parts.append(f"{ARRIVED}\n\n{arrived}")
    return "\n\n".join(parts)


def display(flow: Flow, scheduled_at: datetime, arrived: str | None = None) -> str:
    """The same turn AS THE CLIENT READS IT, in Chat.

    The prompt above is not something a client should ever see: it names the
    tools, the folders and the edge cases, under a `## Notas técnicas` heading
    the portal strips everywhere else. What is shown instead is what started
    the run and the steps she already reads on the flow's page.
    """
    shown = (
        f"Corrida del flujo «{flow.name}» ({scheduled_at.strftime('%d/%m %H:%M')})."
        f"\n\n{flow.how}"
    )
    # What arrived IS shown: it is what started the run, in the client's words.
    return f"{shown}\n\n{ARRIVED}\n\n{arrived}" if arrived else shown


def base_time(flow: Flow) -> float:
    """What the next occurrence is counted from.

    The last run of this flow, and for a flow that has never run the later of
    the process start and the file's own mtime. The mtime half is what stops a
    flow written at 14:00 with `0 9 * * *` from firing this morning's nine
    o'clock the instant it is saved.
    """
    row = db.last_flow_run(flow.slug)
    if row:
        return row["scheduled_at"]
    return max(_started, flows.file_of(flow.slug).stat().st_mtime)


def due_at(flow: Flow, now: datetime | None = None) -> datetime | None:
    """The occurrence this flow owes, past or future.

    THE LAST OVERDUE ONE, never the first. Running the first and counting from
    it would make the agent walk through a weekend's worth of Mondays one tick
    at a time; what the client wants when their agent comes back is Monday's
    work done once. When nothing is owed this is the NEXT occurrence, so the
    card's "próxima vez" and the clock read the same function and cannot
    disagree.
    """
    now = now or datetime.now(flows.zone(flow))
    previous = flows.previous_run(flow, now)
    if previous and previous.timestamp() > base_time(flow):
        return previous
    return flows.next_run(flow, now)


async def run(
    flow: Flow, scheduled_at: datetime, manual: bool = False, arrived: str | None = None
) -> None:
    """One occurrence of one flow, if nobody claimed it first.

    `arrived` is what a watcher found, for an `event` flow: it travels in the
    prompt, so the run starts with the work in its hand and looks for nothing.
    """
    session_id = session.new_session_id()
    if not db.claim_flow_run(flow.slug, scheduled_at.timestamp(), session_id, manual):
        return
    stamp = scheduled_at.timestamp()
    db.create_session(session_id, kind="flow")
    db.rename_session(session_id, title(flow, scheduled_at))
    db.append_event(
        "flow.started", f"Empecé el flujo «{flow.name}»", "running", session_id,
        {"slug": flow.slug, "manual": manual},
    )
    paused = False
    try:
        async for event in session.run_turn(
            session_id, prompt(flow, arrived), display(flow, scheduled_at, arrived)
        ):
            paused = paused or isinstance(event, session.Paused)
    except Exception as exc:
        # `run_turn` already wrote the client her one line and the `error`
        # event; what belongs here is the RUN's outcome, which is what the
        # Flows tab reads back as "how did it go". And the stack: a chat turn
        # that breaks reaches uvicorn's log through the request, a flow run
        # reaches nobody, and a row that says `'instagram-creator'` with no
        # trace behind it was a whole afternoon once.
        log.exception("flow %s: the run broke", flow.slug)
        reason = session.one_line(exc)
        db.finish_flow_run(flow.slug, stamp, "error", reason)
        db.append_event(
            "flow.failed", f"El flujo «{flow.name}» no pudo terminar: {reason}",
            "error", session_id, {"slug": flow.slug},
        )
        return
    if paused:
        # IT DID NOT FINISH, and a card that says it did is the whole lie this
        # status exists to stop: the mail is sitting in Aprobaciones while the
        # flow reads «salió bien». What closes this row is the client's answer,
        # through `resumed()` below.
        db.pause_flow_run(flow.slug, stamp)
        db.append_event(
            "flow.paused", f"Pausé el flujo «{flow.name}»: espera tu aprobación",
            "pendiente", session_id, {"slug": flow.slug},
        )
        return
    db.finish_flow_run(flow.slug, stamp, "ok")
    db.append_event(
        "flow.finished", f"Terminé el flujo «{flow.name}»", "completed", session_id,
        {"slug": flow.slug},
    )


def resumed(session_id: str) -> None:
    """The client answered and the run finished: the row it left `paused` closes.

    Called from `session.run_resumed`, which is where a paused turn of any kind
    ends — a chat turn resumed the same way finds no row here and there is
    nothing to close. A rejection closes it too: the run does not die on a «no»,
    it answers with what it did instead, so what happened to the RUN is that it
    finished.

    The flow's file can have been deleted while the request sat in the queue, and
    a run that already did its work is not the place to find that out: the label
    falls back to the slug.
    """
    row = db.paused_flow_run(session_id)
    if row is None:
        return
    flow = flows.read(row["slug"])
    db.finish_flow_run(row["slug"], row["scheduled_at"], "ok")
    db.append_event(
        "flow.finished", f"Terminé el flujo «{flow.name if flow else row['slug']}»",
        "completed", session_id, {"slug": row["slug"]},
    )


def recover() -> None:
    """Rows left `running` by a process that died holding them.

    Without this a killed run stays `running` forever: the card says the agent
    is working on it and the next tick counts from an occurrence that never
    finished. It runs once, before the loop's first tick.
    """
    for row in db.running_flow_runs():
        db.finish_flow_run(row["slug"], row["scheduled_at"], "error", KILLED)
        db.append_event("flow.failed", KILLED, "error", row["session_id"], {"slug": row["slug"]})


# When each `event` flow's watcher last looked, and the ones looking right now.
# In memory on purpose: a restart looks again at once, which is what it should do.
_looked: dict[str, float] = {}
_looking: set[str] = set()
# The last thing each watcher failed with, so a Graph that is down for an hour
# is ONE line in Activity and not a hundred and twenty.
_watch_errors: dict[str, str] = {}


def look(flow: Flow) -> str | None:
    """Everything this flow's watcher finds, plus what was already waiting."""
    found = watchers.WATCHERS[flow.event].fn()
    if found:
        db.add_pending(flow.slug, found)
    return found


async def watch(flow: Flow) -> None:
    """One look of one `event` flow, and the run if it is time for one.

    THE SETTLE IS ONE QUIET LOOK. Somebody who writes three messages in a row
    is one conversation, and a run per message is three turns stepping on each
    other. So what a look finds WAITS (`flow_pending`), the next tick looks
    again, and the run starts on the first look that finds nothing more — or
    after `SETTLE_CEILING`, for the account where there is always something.
    """
    _looking.add(flow.slug)
    try:
        _looked[flow.slug] = time.time()
        try:
            found = await asyncio.to_thread(look, flow)
        except Exception as exc:
            reason = session.one_line(exc)
            if _watch_errors.get(flow.slug) != reason:
                _watch_errors[flow.slug] = reason
                log.exception("flow %s: the watcher broke", flow.slug)
                db.append_event(
                    "flow.failed", f"No pude mirar si llegó algo para «{flow.name}»: {reason}",
                    "error", None, {"slug": flow.slug},
                )
            return
        _watch_errors.pop(flow.slug, None)
        since = db.pending_since(flow.slug)
        if since is None or db.flow_run_in_flight(flow.slug):
            return
        if found and time.time() - since < SETTLE_CEILING:
            return
        now = datetime.now(flows.zone(flow)).replace(microsecond=0)
        await run(flow, now, arrived="\n\n".join(db.take_pending(flow.slug)))
    finally:
        _looking.discard(flow.slug)


def wants_a_look(flow: Flow, now: float) -> bool:
    """Its turn on the watcher's own clock, or something is already waiting —
    in which case the very next tick looks again, which is the settle."""
    if flow.slug in _looking or flow.event not in watchers.WATCHERS:
        return False
    if db.pending_since(flow.slug) is not None:
        return True
    return now - _looked.get(flow.slug, 0) >= watchers.WATCHERS[flow.event].every


_ticked: dict[str, float] = {}
_ticking: set[str] = set()
_tick_errors: dict[str, str] = {}


async def call_ticker(name: str) -> None:
    """One call of a plugin's ticker (`core/watchers.py`). Its failure is the
    plugin's, logged once per distinct reason: a mail service that is down for
    an hour is one stack in the log, not a hundred and twenty."""
    _ticking.add(name)
    try:
        _ticked[name] = time.time()
        fn = watchers.TICKERS[name].fn
        # A coroutine runs on this loop — a model run has to, since the model's
        # HTTP client lives here; anything else is sync work, in a thread.
        await (fn() if inspect.iscoroutinefunction(fn) else asyncio.to_thread(fn))
        _tick_errors.pop(name, None)
    except Exception as exc:
        reason = session.one_line(exc)
        if _tick_errors.get(name) != reason:
            _tick_errors[name] = reason
            log.exception("ticker %s broke", name)
    finally:
        _ticking.discard(name)


# Read by the client in Activity, once per flow and not once per tick.
INCOMPLETE = "No voy a correr el flujo «{name}» hasta que conectes {missing}."

# The flows already said to be waiting, so the line above is written once. In
# memory on purpose: a restart says it again, which is one line per boot, and a
# flow that gets its connection leaves the set and is told about again if it
# ever loses it.
_incomplete: set[str] = set()


def missing(flow: Flow) -> list[str]:
    """What this flow names and this agent has not set up (`plugins.missing`)."""
    return plugins.missing(flow.connections)


def waiting_for_a_connection(flow: Flow) -> bool:
    """An active flow that names a connection nobody set up is NOT RUN.

    Measured on the mail flow: with no mailbox it woke the agent up every five
    minutes, a whole turn and a conversation each time, to answer «Falta
    conectar el correo» to nobody (`docs/PENDING.md`). The client already reads
    it where it belongs — the card says «Le falta una conexión»
    (`server/flows.py`) — so the clock does not spend a turn to say it again.
    Only the clock: «Probarlo ahora» is the client asking, and it still runs.
    """
    gaps = missing(flow)
    if not gaps:
        _incomplete.discard(flow.slug)
        return False
    if flow.slug not in _incomplete:
        _incomplete.add(flow.slug)
        db.append_event(
            "flow.incomplete", INCOMPLETE.format(name=flow.name, missing=" y ".join(gaps)),
            "skipped", None, {"slug": flow.slug, "missing": gaps},
        )
    return True


async def tick() -> None:
    now = time.time()
    db.forget_quiet_runs(now - config.FLOWS_QUIET_RUN_DAYS * 86400)
    for name, ticker in watchers.TICKERS.items():
        if name not in _ticking and now - _ticked.get(name, 0) >= ticker.every:
            asyncio.create_task(call_ticker(name))
    for flow in flows.read_all():
        if flow.status != "active" or waiting_for_a_connection(flow):
            continue
        if flow.trigger == "event" and wants_a_look(flow, now):
            asyncio.create_task(watch(flow))
        if flow.trigger != "schedule":
            continue
        due = due_at(flow, datetime.fromtimestamp(now, flows.zone(flow)))
        if due and due.timestamp() <= now:
            # As a task and not awaited: a run takes as long as a turn takes,
            # and the flow after it in the list is not waiting for that. The
            # claim is the first thing `run` does, so the next tick cannot
            # start this occurrence a second time.
            asyncio.create_task(run(flow, due))


async def loop() -> None:
    while True:
        try:
            await tick()
        except Exception as exc:
            # THE LOOP OUTLIVES A BROKEN FLOW, and says so where the client
            # looks. A FLOW.md the model cannot validate raises in `read_all`,
            # and letting that kill the task would stop EVERY flow of this
            # agent for good, silently — the exact shape of failure this whole
            # mechanism exists to make impossible.
            db.append_event(
                "flow.failed", f"No pude mirar los flujos: {session.one_line(exc)}", "error"
            )
        await asyncio.sleep(INTERVAL)


def start() -> None:
    global _started
    _started = time.time()
    recover()
    asyncio.create_task(loop())
