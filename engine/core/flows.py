"""A flow is a file, and there is no job store.

`workspace/flows/<slug>/FLOW.md` is the only source of truth: the frontmatter
says when it runs, the body says how, and the scheduler derives what is due
from the file on every tick. That is the whole design decision
(`docs/own-agent-plan.md`): nothing can be created and not scheduled, nothing
can be orphaned, and changing when a flow runs is editing one line of one file
the client can read in the Files tab.

THE BODY IS SPLIT IN TWO because it has two readers. What is above
`## Notas técnicas` is what the client reads in the Flows tab — the steps, in
their language. What is below it is for the agent, and the run prompt carries
both.
"""

import re
from datetime import datetime
from pathlib import Path
from typing import Literal
from zoneinfo import ZoneInfo

import frontmatter
from croniter import croniter
from pydantic import BaseModel, Field, field_validator, model_validator

from . import config

FLOW_FILE = "FLOW.md"
NOTES_HEADING = "## Notas técnicas"

# The directory name the client sees and the agent edits. Same shape the kit
# has always used, so a curated flow keeps its name when its capability is
# rebuilt.
SLUG = re.compile(r"^[a-z0-9][a-z0-9-]{0,48}$")

# How many occurrences the frequency check looks at. A cron's shortest gap is
# not a property you can read off the expression ("0,1 9 * * *" is a minute
# apart), so it is measured.
SAMPLES = 50
SAMPLE_BASE = datetime(2026, 1, 1)


def shortest_gap(expr: str) -> float:
    """The shortest gap between two runs of this cron, in minutes."""
    clock = croniter(expr, SAMPLE_BASE)
    times = [clock.get_next(datetime) for _ in range(SAMPLES)]
    return min((b - a).total_seconds() for a, b in zip(times, times[1:])) / 60


class Flow(BaseModel):
    """One `FLOW.md`, frontmatter and body. The messages are the agent's and
    the client's to read, so they are in Spanish like every other error that
    leaves the engine."""

    slug: str
    name: str
    client_summary: str
    trigger: Literal["schedule", "request"]
    trigger_detail: str
    cron: str | None = None
    timezone: str = Field(default_factory=lambda: config.TIMEZONE)
    status: Literal["active", "paused"] = "active"
    connections: list[str] = Field(default_factory=list)
    how: str = ""
    notes: str = ""

    @field_validator("slug")
    @classmethod
    def _slug(cls, value: str) -> str:
        if not SLUG.match(value):
            raise ValueError(
                f"«{value}» no sirve como nombre de carpeta: minúsculas, números y guiones"
            )
        return value

    @model_validator(mode="after")
    def _trigger(self) -> "Flow":
        # CRON IFF SCHEDULE. A `schedule` flow with no cron is a card the
        # portal draws as active that can never fire, and a `request` flow with
        # one is a client who is told it only runs when they ask while it wakes
        # the agent up on its own. Both happened on Hermes.
        if self.trigger == "schedule" and not self.cron:
            raise ValueError("un flujo que corre solo necesita `cron`")
        if self.trigger != "schedule" and self.cron:
            raise ValueError("solo un flujo con gatillo `schedule` lleva `cron`")
        if self.cron:
            if not croniter.is_valid(self.cron):
                raise ValueError(f"«{self.cron}» no es una expresión cron válida")
            if shortest_gap(self.cron) < config.FLOWS_MIN_MINUTES:
                raise ValueError(
                    f"frecuencia mínima: cada {config.FLOWS_MIN_MINUTES} minutos"
                )
        return self


def root() -> Path:
    return config.WORKSPACE / "flows"


def file_of(slug: str) -> Path:
    return root() / slug / FLOW_FILE


def split_body(content: str) -> tuple[str, str]:
    """`how` (what the client reads) and `notes` (what only the run needs)."""
    how, _, notes = content.partition(NOTES_HEADING)
    return how.strip(), notes.strip()


def parse(path: Path) -> Flow:
    post = frontmatter.load(path)
    how, notes = split_body(post.content)
    return Flow(slug=path.parent.name, how=how, notes=notes, **post.metadata)


def read(slug: str) -> Flow | None:
    path = file_of(slug)
    return parse(path) if path.is_file() else None


def read_all() -> list[Flow]:
    """Every flow on disk, by slug. A FLOW.md the model cannot validate raises
    here and takes the tab and the scheduler's tick with it — which is the
    point: a flow that is half a flow is the state nobody notices."""
    return [parse(path) for path in sorted(root().glob(f"*/{FLOW_FILE}"))]


def front(flow: Flow) -> dict:
    """The frontmatter, in the order it is written. `cron` only when there is
    one, so a `request` flow's file does not carry an empty key."""
    fields = {
        "name": flow.name,
        "client_summary": flow.client_summary,
        "trigger": flow.trigger,
        "trigger_detail": flow.trigger_detail,
    }
    if flow.cron:
        fields["cron"] = flow.cron
    fields["timezone"] = flow.timezone
    fields["status"] = flow.status
    fields["connections"] = flow.connections
    return fields


def body(flow: Flow) -> str:
    if not flow.notes:
        return flow.how
    return f"{flow.how}\n\n{NOTES_HEADING}\n\n{flow.notes}"


def write(flow: Flow) -> Path:
    path = file_of(flow.slug)
    path.parent.mkdir(parents=True, exist_ok=True)
    post = frontmatter.Post(body(flow), **front(flow))
    # `sort_keys=False`: the client reads this file in the Files tab, and the
    # name of the flow belongs above its cron expression.
    path.write_text(frontmatter.dumps(post, sort_keys=False) + "\n")
    return path


def zone(flow: Flow) -> ZoneInfo:
    return ZoneInfo(flow.timezone)


def next_run(flow: Flow, after: datetime) -> datetime | None:
    """The first occurrence strictly after `after`, in the flow's timezone.
    `None` for a flow that does not run on its own."""
    if flow.trigger != "schedule":
        return None
    return croniter(flow.cron, after.astimezone(zone(flow))).get_next(datetime)


def previous_run(flow: Flow, before: datetime) -> datetime | None:
    """The last occurrence before `before`. It is how the scheduler asks "what
    is the most recent thing I owe" in one step instead of walking there."""
    if flow.trigger != "schedule":
        return None
    return croniter(flow.cron, before.astimezone(zone(flow))).get_prev(datetime)
