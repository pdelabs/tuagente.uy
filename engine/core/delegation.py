"""A delegation, as the client sees it: two events and two lines in the trail.

The mechanism is the harness's `SubAgents` (`core/plugins.py` builds the one
capability and every delegate a plugin registered goes into it). What is here
is the half the client reads: a sub-agent run is minutes of silence otherwise —
the face calls `delegate_task`, the creator reads the brand, writes, draws,
looks and saves, and none of that is on the parent's stream.

TWO PATHS FOR THE SAME TWO EVENTS, and they are not redundant. The capability
below writes them to the events table through `@on_event`, which fires on ANY
run: a chat turn, a flow's run, and a run resumed after an approval, which has
no stream attached at all. `core/session.py` ALSO reads them off the stream and
yields them as `ToolStarted`, because the chat's trail is built from the stream
and nothing else. One writes them down; the other shows them while they happen.

THE NAME THE CLIENT READS COMES FROM THE PLUGIN, never from the delegate's id.
`instagram-creator` is an id, in English, like every other id in the kit; «el
creador de posteos» is what the client is told, and the plugin passes it with
`engine.subagent(..., label=…)`.
"""

from dataclasses import dataclass

from pydantic_ai import ModelRetry
from pydantic_ai.capabilities import AbstractCapability, on_event
from pydantic_ai.tools import RunContext
from pydantic_ai_harness.subagents import DelegationEndEvent, DelegationStartEvent

from . import db

# The two of them, for the `isinstance` in `core/session.py`: the harness's
# names are imported here and nowhere else in the engine.
EVENTS = (DelegationStartEvent, DelegationEndEvent)

# The one delegate tool of the face. The name is not free: the portal's
# dictionary already translates it (`app/app/lib/labels.ts`: «Repartió el
# trabajo»), so the trail reads as Spanish without touching the portal.
TOOL = "delegate_task"

# What Activity files these under. Same shape as `post.saved`: the kind is the
# chip, the label is the sentence.
STARTED = "delegation.started"
FINISHED = "delegation.finished"

# The Spanish name of each delegate, by the name the model delegates to.
# Filled by `engine.subagent(...)` at startup and read here.
LABELS: dict[str, str] = {}

# How much of the brief travels into Activity. The whole task is in the trace;
# what the client wants on that screen is which delegate got what, at a glance.
TASK_CHARS = 120

# Read by the client, so: Spanish, and the outcome said as a fact.
ASKED = "Le pedí al {label}: {task}"
DONE = "El {label} terminó en {seconds} s"
COULD_NOT = "El {label} no pudo: {why}"

# `DelegationOutcome` in the client's words. `ok` is not here: it is the other
# sentence. Every other outcome is a delegation that came back with a steering
# message instead of work, and the face answers her from that message.
WHY = {
    "timeout": "tardó más de lo que tenía",
    "budget": "se quedó sin presupuesto",
    "failed": "falló en el medio",
    "contained": "se rompió en el medio",
}

# A BRIEF CUT IN HALF, and what the face is told about it. Measured on our own
# agent (2026-09-21): the client asked to change a slide's text and wrote the
# new text between double quotes; the face copied her words into the brief, the
# model did not escape the first `"`, and in a tool call's JSON that quote ENDS
# the string. The creator got «El cliente pidió: «Saca el» and nothing else,
# twice, and the face's third, whole brief hit the two-delegation cap. The cut
# is visible from here: the face quotes the client between « », and a brief
# that opens one and never closes it stopped mid-quote. Refused BEFORE the
# delegate runs, so it costs a retry and not one of the delegations.
CUT = (
    "Tu pedido al {label} quedó cortado a la mitad: abre «, nunca lo cierra, y "
    "termina en «{tail}». Pasa cuando una comilla doble entra en el pedido. "
    "Mandalo de nuevo, entero, citando las palabras del cliente entre « » y sin "
    "comillas dobles."
)

# And the rule that keeps it from happening, in the face's instructions.
QUOTING = (
    "Cuando le pases a un ayudante las palabras del cliente, citalas entre « ». "
    "Nunca uses comillas dobles adentro del pedido: una comilla doble lo corta ahí."
)

# How many delegations each run made, by `run_id`. Read once and forgotten, by
# `core/turn_usage.py`, which is what puts `delegations` on the turn's event.
_counts: dict[str, int] = {}


def count(run_id: str | None) -> int:
    """How many delegations this run made. Reading it is forgetting it."""
    return _counts.pop(run_id or "", 0)


def label(name: str) -> str:
    """The delegate's Spanish name, or the name itself.

    The fallback is a guard against a measured failure: on 2026-09-14 the first
    run-now of our own agent's flow after a rebuild died with a bare
    `KeyError: 'instagram-creator'`, the run read `error`, and the rerun
    passed. The stack was not kept (the scheduler logs it now). Whatever
    emptied this table for one run, a label is decoration and must never be
    what kills the work.
    """
    return LABELS.get(name, name)


def started_line(event: DelegationStartEvent) -> str:
    return ASKED.format(label=label(event.agent_name), task=event.task[:TASK_CHARS])


def finished_line(event: DelegationEndEvent) -> str:
    if event.outcome == "ok":
        return DONE.format(label=label(event.agent_name), seconds=int(event.duration_seconds))
    return COULD_NOT.format(label=label(event.agent_name), why=WHY[event.outcome])


def trail(event) -> str:
    """The name one of these travels under in the chat's tool trail.

    The event's own kind, and not the delegate's: it is what Activity files the
    same moment under, so the two screens say it with one vocabulary.
    """
    return STARTED if isinstance(event, DelegationStartEvent) else FINISHED


@dataclass
class Delegation(AbstractCapability):
    """Every delegation of this run, in Activity.

    A capability and not a line in `core/session.py` for the same reason
    `core/turn_usage.py` is one: the events exist inside the run, and the seam
    belongs to whoever wants them. It is registered only when a plugin
    registered a delegate — with no delegate there is nothing to listen to.
    """

    def get_instructions(self):
        return QUOTING

    async def before_tool_execute(self, ctx: RunContext, *, call, tool_def, args):
        """A brief that stopped mid-quote goes back to the face, not to the delegate."""
        if tool_def.name == TOOL:
            task = args.get("task") or ""
            if task.count("«") > task.count("»"):
                raise ModelRetry(CUT.format(label=label(args.get("agent_name") or ""),
                                            tail=task.rstrip()[-40:]))
        return args

    @on_event(DelegationStartEvent)
    async def _started(self, ctx: RunContext, event: DelegationStartEvent) -> None:
        _counts[ctx.run_id or ""] = _counts.get(ctx.run_id or "", 0) + 1
        db.append_event(
            STARTED, started_line(event), "running", ctx.deps.session_id,
            {"agent": event.agent_name, "task": event.task},
        )

    @on_event(DelegationEndEvent)
    async def _finished(self, ctx: RunContext, event: DelegationEndEvent) -> None:
        db.append_event(
            FINISHED, finished_line(event),
            "completed" if event.outcome == "ok" else "error",
            ctx.deps.session_id,
            {
                "agent": event.agent_name,
                "outcome": event.outcome,
                "seconds": round(event.duration_seconds, 1),
                # What the face was handed back: the delegate's report, or the
                # steering message that replaced it. It is the only copy of it
                # outside the model's own history.
                "output": event.output,
            },
        )
