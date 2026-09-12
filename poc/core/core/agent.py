"""The agent itself: model, instructions, toolsets.

Built lazily so that every module that wants to add a toolset has been
imported by the time the first run happens. That is the extension point:
append to `EXTRA_TOOLSETS` at import time (Wave 2's sensitive tools, Wave 3's
whatever) and they are in the next build.
"""

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from pydantic_ai import Agent, RunContext
from pydantic_ai.toolsets import AbstractToolset

from . import config
from .tools import skills, workspace


@dataclass
class Deps:
    """What a tool needs to know about the turn it is running in."""

    workspace: Path
    session_id: str


# EXTENSION POINT — Wave 2 and 3 append their toolsets here (import side
# effect is fine: `get_agent()` reads the list on the first turn, not at
# import). Wave 2: `core.tools.sensitive.toolset().approval_required(...)`.
EXTRA_TOOLSETS: list[AbstractToolset[Deps]] = []

# EXTENSION POINT — capabilities passed to the Agent. Wave 3 appends its
# `ProcessHistory` compaction capability and `ReinjectSystemPrompt()`.
CAPABILITIES: list = []


def instructions(ctx: RunContext[Deps]) -> str:
    """SOUL + the skills index + today's date, rebuilt every run.

    Read from disk each time on purpose: the SOUL is a read-only mount and
    editing it should not need a restart while the POC is being poked at.
    """
    now = datetime.now(ZoneInfo(config.TIMEZONE)).strftime("%d/%m/%Y %H:%M")
    parts = [
        (config.AGENT_DIR / "SOUL.md").read_text().strip(),
        skills.index_text(),
        f"Hoy es {now} en Uruguay ({config.TIMEZONE}). El workspace es {config.WORKSPACE}.",
    ]
    return "\n\n".join(p for p in parts if p)


_agent: Agent[Deps, str] | None = None


def get_agent() -> Agent[Deps, str]:
    global _agent
    if _agent is None:
        _agent = Agent(
            config.MODEL,
            deps_type=Deps,
            instructions=instructions,
            toolsets=[workspace.toolset(), skills.toolset(), *EXTRA_TOOLSETS],
            capabilities=CAPABILITIES or None,
        )
    return _agent
