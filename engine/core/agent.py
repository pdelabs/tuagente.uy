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

from pydantic import ValidationError
from pydantic_ai import Agent, RunContext
from pydantic_ai.exceptions import ModelAPIError
from pydantic_ai.models import Model
from pydantic_ai.models.fallback import FallbackModel
from pydantic_ai.toolsets import AbstractToolset, CombinedToolset

from . import config, plugins
from .tools import flows, skills, web, workspace


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


# HOW A FILE REACHES THE CLIENT FROM A SENTENCE. The portal turns a workspace
# path into something she can open, and a picture written as markdown into the
# picture itself. Measured on our own agent (2026-09-24): asked for a table of
# the posts' images it wrote bare `01.png`–`05.png`, which name no post, and
# linked a PDF as `sandbox:/workspace/…` — the chat dialect of another product.
FILES = """\
## Archivos en tus respuestas

- **Nombrá cada archivo por su ruta dentro del espacio de trabajo**, entera y
  tal cual: `posteos/2026-09-15-tema/01.png`, `negocio/borrador.md`. Así tu
  cliente la toca y se abre. Nunca solo el nombre (`01.png`), nunca con
  `/workspace/` adelante ni `sandbox:`.
- **Una imagen que tu cliente quiere ver**, escribila como imagen:
  `![Lámina 1](posteos/2026-09-15-tema/01.png)`. Se ve ahí mismo, también
  dentro de una tabla."""


def soul() -> str:
    """Who the agent is, read from disk every run on purpose: it is a read-only
    mount and editing it should not need a restart while the engine is being
    poked at."""
    return (config.AGENT_DIR / "SOUL.md").read_text().strip()


def today() -> str:
    """When and where the run is happening.

    A CALLABLE, and it is the last instruction every agent of this client is
    built with. Pydantic AI sorts static instruction parts before dynamic ones
    (`InstructionPart.sorted`), so a callable lands after every literal string
    whatever order it was written in — which is where the one line that changes
    by itself belongs: everything above it is the stable prefix the provider's
    cache keeps.
    """
    now = datetime.now(ZoneInfo(config.TIMEZONE)).strftime("%d/%m/%Y %H:%M")
    return f"Hoy es {now} en Uruguay ({config.TIMEZONE}). El workspace es {config.WORKSPACE}."


# The line that opens the block every SOUL of the fleet ends with. Above it is
# the client's own half of the file; below it is the paragraph all of them share.
BASE = "<!-- core:base v2 -->"

# And the last line of that block, which is NOT shared: it is the face's
# manners in the chat, and a sub-agent has no chat.
CHAT_MANNERS = "En el chat, respuestas cortas."


def identity() -> str:
    """WHAT EVERY AGENT OF THIS CLIENT SHARES, and nothing else.

    Two pieces of the SOUL, and each one is here because a delegate that does
    not read it is a different company's agent:

    - the SOUL's OPENING, up to its first `## ` heading — who the client is and
      what the company does. A creator that does not know that writes for
      nobody;
    - the `core:base` block, MINUS its last line. That block is the fleet's own
      paragraph (never a person, never promise what you do not have); the last
      line is «En el chat, respuestas cortas», which is manners for the chat and
      the face is the only one in it.

    NOT «Tu alcance», NOT «Cómo escribís», NOT «Horarios»: those are the face's
    job description, and a delegate reading «Lo que te pidan por el chat…» in
    its own prompt is a delegate answering a chat it is not in. The measurement
    that forced this split is in `docs/subagents-plan.md`: with the whole SOUL
    at the END of the creator's prompt, the last thing it read before working
    was the face's scope.

    ITS VALUE IS FIXED AT LOAD (`IDENTITY` below) and not read per run, which is
    what makes it a plain string in a delegate's `instructions` and therefore
    the FIRST thing in its prompt. Editing a SOUL needs a restart to reach a
    delegate — the same restart `engine/README.md` already asks for.
    """
    head, base = soul().split(BASE)
    opening = head.split("\n## ")[0].strip()
    shared = base.strip().removesuffix(CHAT_MANNERS).strip()
    return f"{opening}\n\n{shared}"


IDENTITY = identity()


def instructions(ctx: RunContext[Deps]) -> str:
    """SOUL + the engine's own rules + the enabled plugins' prose + the skills index + today's date.

    THE ORDER IS THE POINT. The SOUL says who the agent is and nothing else;
    each mechanism's rules arrive with the plugin that brings the mechanism, so
    a client who does not have approvals never reads a word about approvals.

    AND THE DATE STAYS LAST: it is the one line that changes by itself, and
    everything above it is a stable prefix the provider's cache keeps. Cache is
    nearly all of this engine's conversational saving
    (`kit/notes/image-cost-anatomy.md`: 96-97% on a session), and moving the
    clock to the top would end that prefix at the SOUL.

    THE FACE READS ITS SOUL WHOLE, and `identity()` is the part of it a
    delegate gets. Not the same text and not meant to be: the face is the one
    with a scope, a chat and manners in it.
    """
    parts = [soul(), FLOWS, FILES, web.WEB, *plugins.prose(), skills.index_text(), today()]
    return "\n\n".join(p for p in parts if p)


def hands() -> list[AbstractToolset[Deps]]:
    """The engine's own tools that any agent of this client may be given.

    NOT the flow tools. Creating a flow is a conversation with the client about
    work that repeats — what it delivers, how she knows it went well — and a
    sub-agent never talks to her, so `create_flow` is the face's alone.
    """
    return [workspace.toolset(), skills.toolset(), web.toolset()]


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


def model() -> Model:
    """The engine's model, with ONE retry on the provider.

    OpenRouter intermittently answers a 200 with a body that is neither a
    completion nor its error envelope; pydantic-ai raises a ValidationError
    on it (issues 3994 and 6900 upstream) and the turn dies. Measured on our
    own agent on 2026-09-16: the daily flow had saved its post and lost its
    last model call to one of those. The same model twice in a FallbackModel
    is a retry, and the fallback also covers a transport-level ModelAPIError.
    Every agent of the engine, the face and the plugins' sub-agents, gets it
    through `engine.model`.
    """
    return FallbackModel(
        config.MODEL, config.MODEL, fallback_on=(ModelAPIError, ValidationError)
    )


def get_agent() -> Agent[Deps, str]:
    global _agent
    if _agent is None:
        _agent = Agent(
            model(),
            deps_type=Deps,
            instructions=instructions,
            model_settings=config.MODEL_SETTINGS,
            toolsets=[*hands(), flows.toolset(), *EXTRA_TOOLSETS],
            capabilities=CAPABILITIES or None,
        )
    return _agent
