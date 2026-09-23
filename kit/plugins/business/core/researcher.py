"""The researcher: the sub-agent that reads the business and writes its draft.

A real Pydantic AI `Agent`, handed to the engine as a delegate
(`engine.subagent`), with the web and one tool that writes: `save_draft`
(`business_draft.py`). It reads the client's site and a few searches, and what
comes back is a file and two lines — the pages it read never enter the face's
history, which is the reason it is a delegate at all.

TWO WAYS IN. The face delegates to it when the client asks («investigá mi
empresa de nuevo», «ahora tenemos otra web»), and `business_watch.py` runs it
on its own the first time the owner leaves a website at onboarding. The second
one is not a face turn: the same agent, run directly, with the same limits.
"""

import os
from pathlib import Path

from pydantic_ai import Agent
from pydantic_ai.usage import UsageLimits
from pydantic_ai_harness.subagents import SubAgent

import business_draft

HERE = Path(__file__).resolve().parent
PROSE = HERE / "researcher.md"

NAME = "business-researcher"
LABEL = "investigador del negocio"
DESCRIPTION = (
    "Lee la web del negocio de tu cliente y lo que hay publicado sobre él, y"
    " deja un borrador en negocio/borrador.md: qué vende, a quién, precios,"
    " dónde y cuándo, canales, cómo habla y las preguntas que solo el dueño"
    " puede contestar. Pasale el nombre del negocio, su web, y lo que el"
    " cliente haya corregido o agregado en esta conversación: no la ve."
)

MAX_CALLS = 1
TIMEOUT = float(os.environ.get("CORE_DELEGATION_TIMEOUT", "900"))
# Eight pages, three searches, one save, and room for a retry or two: the
# number is what stops a site that links to itself forever.
LIMITS = UsageLimits(request_limit=30)

# The task when nobody asked: onboarding left a website. Spanish, the model's.
TASK = (
    "Investigá el negocio «{company}». Su web es {url}. Dejá el borrador con"
    " `save_draft`."
)

_agent: Agent | None = None
_deps = None


def build(engine) -> SubAgent:
    global _agent, _deps
    agent = Agent(
        engine.model,
        deps_type=engine.Deps,
        name=NAME,
        description=DESCRIPTION,
        instructions=[engine.identity, PROSE.read_text(), engine.today],
        toolsets=[engine.tools("web_search", "web_fetch"), business_draft.toolset()],
        model_settings=engine.model_settings,
    )
    _agent, _deps = agent, engine.Deps
    return SubAgent(agent, timeout_seconds=TIMEOUT, max_calls=MAX_CALLS)


async def run(company: str, url: str) -> str:
    """One research with nobody asking, on the engine's loop (the clock awaits
    it: the model's HTTP client lives there)."""
    from core import config

    result = await _agent.run(
        TASK.format(company=company or url, url=url),
        deps=_deps(workspace=config.WORKSPACE, session_id=f"business-{NAME}"),
        usage_limits=LIMITS,
    )
    return str(result.output)
