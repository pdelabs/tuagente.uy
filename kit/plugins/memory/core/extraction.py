"""What the client said in passing, written down after the turn by the code.

The model's own `write_memory` only fires when the client says "acordate", and
most of what is worth keeping never comes with the magic word: a client saying
"los sábados abrimos de 9 a 13" is telling their agent a fact about the
business, not filing a request. So after every client turn one small model call
reads the turn against the notebook and answers with the NEW facts and
preferences in it, and this code appends them.

THE MODEL PICKS THE WORDS, THE CODE DOES THE WRITING. The extraction agent has
no tools and no memory: it returns a list of entries and nothing else. The date
stamp, the shape of the line, the deduplication and the write through the store
are all here, which is the house rule (`core/plugins.py`: every convention that
depended on the model remembering has failed) and is also what keeps a run's
answer from being able to edit the notebook by talking about it.

IT IS A CAPABILITY AND NOT A LINE IN `core/session.py` because `after_run` is
where the result exists — the same seam `core/turn_usage.py` uses — and because
a plugin cannot reach into the engine's turn anyway: it gets the seven verbs
and `engine.capability()` is the one that owns "anything that wants the run's
result".

WHAT IT SKIPS, and each one is a measured shape and not a precaution:
  - a run with no prompt (`ctx.prompt is None`) — that is a run RESUMED after
    an approval, whose only new content is a tool result the client already
    answered in the Approvals page;
  - a run that ended at the gate (`result.output` is not text) — the client has
    not seen an answer yet, and the turn is not over;
  - a message under 30 characters — "dale", "gracias", "sí, mandalo" carry no
    fact, and the call to find that out costs the same as the one that finds a
    fact.
"""

import re
import unicodedata
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal
from zoneinfo import ZoneInfo

from pydantic import BaseModel
from pydantic_ai import Agent
from pydantic_ai.capabilities import AbstractCapability
from pydantic_ai.run import AgentRunResult
from pydantic_ai.tools import RunContext
from pydantic_ai_harness.memory import MemoryStore

from core import config, db, turn_usage

# Under this many characters a client turn is an acknowledgement, not a fact.
MIN_CHARS = 30

# The extraction answers with a handful of one-line entries; 1024 tokens is
# above anything it has to write and keeps the turn's tail cheap.
MODEL_SETTINGS = {"max_tokens": 1024}

# The same per-file boundary the harness reads a notebook with. The whole file
# is read and the whole file is written back, so a truncated read would drop
# the tail of the notebook on the next append.
MAX_NOTEBOOK = 65_536

INSTRUCTIONS = (
    "Leés un turno de conversación entre un cliente y el agente que trabaja"
    " para él, y devolvés lo que haya que anotar en la memoria del agente.\n"
    "Anotás dos cosas y nada más: HECHOS del negocio del cliente (proveedores,"
    " horarios, precios, nombres, clientes, cómo funciona la empresa) y"
    " PREFERENCIAS del cliente sobre cómo quiere que el agente trabaje.\n"
    "NO anotás, aunque el cliente diga «acordate»: procedimientos, pasos,"
    " instrucciones de cómo hacer una tarea o qué herramienta usar. Eso no es"
    " memoria.\n"
    "Tampoco anotás: lo que ya está en el cuaderno, lo que el cliente pidió"
    " dejar afuera, el pedido de este turno («me pidió un informe») ni nada que"
    " haya dicho el agente y el cliente no haya confirmado.\n"
    "Cada entrada es UNA línea en español, que se entienda sola dentro de un"
    " año, sin la conversación al lado.\n"
    "Escribila hablándole al cliente, de vos, porque él la lee en sus"
    " Archivos: «Cerrás a las 14 los sábados», «Preferís que los textos para"
    " redes digan «¿Con cuál te quedás?»». Nunca «El cliente…» ni «Le gusta…».\n"
    "Si no hay nada que anotar, devolvés la lista vacía. Es lo más común."
)


# What Activity says about it. The agent's first person, like every other row:
# «Me anoté: Cerrás a las 14 los sábados». It was «Anoté: El cliente quiere…».
LABEL = "Me anoté: "


class Entry(BaseModel):
    """One line of the notebook, before it has a date on it."""

    kind: Literal["hecho", "preferencia"]
    text: str


_extractor: Agent | None = None


def extractor() -> Agent:
    """The same model, no tools, no memory of its own.

    Built on first use and therefore long after `core/tracing.py` ran
    `Agent.instrument_all` at startup — which is not what makes it traced:
    `_instrument_default` is a class variable resolved on every run, so this
    agent's calls are span trees in Phoenix like any other agent's, whenever it
    was constructed.
    """
    global _extractor
    if _extractor is None:
        _extractor = Agent(
            config.MODEL,
            instructions=INSTRUCTIONS,
            output_type=list[Entry],
            model_settings=MODEL_SETTINGS,
        )
    return _extractor


def plain(text: str) -> str:
    """Lowercase, unaccented, punctuation-free: what two lines are compared as.

    Enough to catch the same fact written twice, which is what the notebook
    fills up with otherwise — the extraction is handed the notebook and told
    not to repeat it, and the model repeats it anyway with one word changed.
    """
    letters = unicodedata.normalize("NFD", text.lower())
    letters = "".join(c for c in letters if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]+", " ", letters).strip()


def turn(prompt: str, answer: str, notebook: str) -> str:
    """What the extraction reads: the notebook, the client's turn, the answer."""
    return (
        f"CUADERNO ACTUAL:\n{notebook.strip() or '(vacío)'}\n\n"
        f"EL CLIENTE DIJO:\n{prompt.strip()}\n\n"
        f"EL AGENTE CONTESTÓ:\n{answer.strip()}"
    )


def line(entry: Entry) -> str:
    """The line as it lands in the notebook. Dated, because a fact expires."""
    stamp = datetime.now(ZoneInfo(config.TIMEZONE)).strftime("%d/%m/%Y")
    return f"- {stamp} · {entry.kind}: {entry.text.strip()}"


@dataclass
class Extraction(AbstractCapability):
    store: MemoryStore
    path: str

    async def after_run(
        self, ctx: RunContext, *, result: AgentRunResult[Any]
    ) -> AgentRunResult[Any]:
        prompt, answer = ctx.prompt, result.output
        if not isinstance(prompt, str) or not isinstance(answer, str):
            return result
        if len(prompt.strip()) < MIN_CHARS:
            return result

        current = await self.store.read(self.path, max_chars=MAX_NOTEBOOK)
        notebook = current.content if current else ""
        entries = await extractor().run(turn(prompt, answer, notebook))
        # Its own run, so its tokens are not in the turn's `turn_usage`.
        turn_usage.spend(ctx.deps.session_id, "anotar en la memoria", turn_usage.cost(entries))

        known = plain(notebook)
        fresh = [e for e in entries.output if e.text.strip() and plain(e.text) not in known]
        if not fresh:
            return result

        lines = [line(e) for e in fresh]
        body = notebook.rstrip()
        merged = (f"{body}\n" if body else "") + "\n".join(lines) + "\n"
        await self.store.write(
            self.path, merged, expected_version=current.version if current else None
        )
        db.append_event(
            "memoria",
            (LABEL + " · ".join(e.text.strip() for e in fresh))[:200],
            "completed",
            ctx.deps.session_id,
            {"lines": lines},
        )
        return result
