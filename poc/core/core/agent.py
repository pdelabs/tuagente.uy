"""The agent itself: model, instructions, toolsets.

Built lazily so that everything that wants to add a toolset has registered by
the time the first run happens: the engine's own capabilities at import time,
and the kit plugins when `core/plugins.py` loads them at startup. Both write
into the two lists below.
"""

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from pydantic_ai import Agent, RunContext
from pydantic_ai.toolsets import AbstractToolset

from . import config, plugins
from .tools import skills, workspace


@dataclass
class Deps:
    """What a tool needs to know about the turn it is running in."""

    workspace: Path
    session_id: str


# EXTENSION POINT — toolsets beyond the engine's two. A plugin appends here
# through `engine.toolset(...)`, gate and all; `get_agent()` reads the list on
# the first turn, not at import.
EXTRA_TOOLSETS: list[AbstractToolset[Deps]] = []

# EXTENSION POINT — capabilities passed to the Agent: the engine's own
# (compaction, turn usage) and whatever a plugin adds with
# `engine.capability(...)`.
CAPABILITIES: list = []


def instructions(ctx: RunContext[Deps]) -> str:
    """SOUL + the enabled plugins' prose + the skills index + today's date.

    Rebuilt every run, and the SOUL read from disk each time on purpose: it is
    a read-only mount and editing it should not need a restart while the POC is
    being poked at.

    THE ORDER IS THE POINT. The SOUL says who the agent is and nothing else;
    each mechanism's rules arrive with the plugin that brings the mechanism, so
    a client who does not have approvals never reads a word about approvals.
    """
    now = datetime.now(ZoneInfo(config.TIMEZONE)).strftime("%d/%m/%Y %H:%M")
    parts = [
        (config.AGENT_DIR / "SOUL.md").read_text().strip(),
        *plugins.prose(),
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
            model_settings=config.MODEL_SETTINGS,
            toolsets=[workspace.toolset(), skills.toolset(), *EXTRA_TOOLSETS],
            capabilities=CAPABILITIES or None,
        )
    return _agent
