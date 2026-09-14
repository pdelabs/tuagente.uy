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
from pydantic_ai.toolsets import AbstractToolset, CombinedToolset

from . import config, plugins
from .tools import flows, skills, workspace


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

# THE THREE THINGS CODE CANNOT CHECK about flows. Everything else about them is
# in the tools' descriptions (how to use them) or in the code (the slug, the
# cron, the caps): this is what is left, and it is behaviour, not mechanism.
FLOWS = """\
## Flujos

Un flujo es trabajo con nombre que se repite solo, y lo creás con `create_flow`.

- **Cerrá el contrato antes de crearlo.** Preguntá dónde termina el trabajo, con
  qué material y cómo se sabe que salió bien. Decidir mal una tarea cuesta una
  vuelta; decidir mal un flujo se repite sin que nadie mire.
- **Creá primero y contá después.** Llamá a la herramienta y recién entonces
  escribí la respuesta, nombrando la próxima corrida que te devolvió. Nunca
  digas que quedó armado antes de armarlo.
- **La primera vuelta hacela ahora.** No la dejes para el horario: hacé el
  trabajo en esta misma conversación y mostrá el resultado."""


def soul() -> str:
    """Who the agent is, read from disk every run on purpose: it is a read-only
    mount and editing it should not need a restart while the engine is being
    poked at."""
    return (config.AGENT_DIR / "SOUL.md").read_text().strip()


def today() -> str:
    """When and where the run is happening."""
    now = datetime.now(ZoneInfo(config.TIMEZONE)).strftime("%d/%m/%Y %H:%M")
    return f"Hoy es {now} en Uruguay ({config.TIMEZONE}). El workspace es {config.WORKSPACE}."


def identity() -> str:
    """What ANY agent of this client shares: who it is, and when it is.

    The face reads the same two pieces below, and a sub-agent gets these and
    nothing else (`core/plugins.py`, `engine.identity`): the plugins' prose and
    the skills index are the face's mechanisms, and a delegate that reads about
    a tool it does not have will try to use it.
    """
    return f"{soul()}\n\n{today()}"


def instructions(ctx: RunContext[Deps]) -> str:
    """SOUL + the enabled plugins' prose + the skills index + today's date.

    THE ORDER IS THE POINT. The SOUL says who the agent is and nothing else;
    each mechanism's rules arrive with the plugin that brings the mechanism, so
    a client who does not have approvals never reads a word about approvals.

    AND THE DATE STAYS LAST, which is why this is not literally `identity()`
    plus the rest: it is the one line that changes by itself, and everything
    above it is a stable prefix the provider's cache keeps. Cache is nearly all
    of this engine's conversational saving (`kit/notes/image-cost-anatomy.md`:
    96-97% on a session), and moving the clock to the top would end that prefix
    at the SOUL. The two pieces are still built in one place each.
    """
    parts = [soul(), FLOWS, *plugins.prose(), skills.index_text(), today()]
    return "\n\n".join(p for p in parts if p)


def hands() -> list[AbstractToolset[Deps]]:
    """The engine's own tools that any agent of this client may be given.

    NOT the flow tools. Creating a flow is a conversation with the client about
    work that repeats — what it delivers, how she knows it went well — and a
    sub-agent never talks to her, so `create_flow` is the face's alone.
    """
    return [workspace.toolset(), skills.toolset()]


def tools(*names: str) -> AbstractToolset[Deps]:
    """Some of those, by name, as one toolset — what a sub-agent is built with.

    The same definitions the face has, filtered: one `read_file` with one
    docstring, instead of a second copy of it that drifts. An unknown name
    raises at registration, where it is one line of a plugin to fix, and not on
    the first delegation of the first morning.
    """
    toolsets = hands()
    known = {name for toolset in toolsets for name in toolset.tools}
    unknown = sorted(set(names) - known)
    if unknown:
        raise ValueError(
            f"the engine has no tool {', '.join(unknown)}: it offers {', '.join(sorted(known))}"
        )
    wanted = set(names)
    return CombinedToolset(toolsets).filtered(lambda ctx, tool: tool.name in wanted)


_agent: Agent[Deps, str] | None = None


def get_agent() -> Agent[Deps, str]:
    global _agent
    if _agent is None:
        _agent = Agent(
            config.MODEL,
            deps_type=Deps,
            instructions=instructions,
            model_settings=config.MODEL_SETTINGS,
            toolsets=[*hands(), flows.toolset(), *EXTRA_TOOLSETS],
            capabilities=CAPABILITIES or None,
        )
    return _agent
