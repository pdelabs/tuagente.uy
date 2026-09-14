"""The notebook goes FIRST in the request, never last. Measured, twice.

The harness injects `MEMORY.md` as a user-role part APPENDED to the last model
request of every round trip — `Memory.before_model_request`, and there is no
knob for where it lands. On the request that carries the client's message that
is harmless. On the request that carries a TOOL RETURN it is the last thing the
model reads before answering, and the model answers IT:

    request: [tool-return "Dejé guardado el posteo 2026-09-14-atencion-sabados",
              user-prompt "<memory> … Los sábados el negocio abre de 9 a 13 …"]
    answer:  «Recibido. El horario de los sábados es de 9:00 a 13:00.»

Two turns out of two, on 14/09, on the turn where the client had asked for a
post. It is not new — every tool loop has had this shape — but a delegated turn
is ONE short tool return where there used to be a long trail of them, so what
was a rare wobble became the usual answer.

THE FIX IS THE ORDER AND NOTHING ELSE. `Notebook` is the harness's `Memory`
with the injected part moved to the front of the request afterwards, so the
notebook is background the model reads BEFORE the thing it has to answer —
which is what the `guidance` already tells it the notebook is. Nothing is
added, removed or rewritten: the harness still decides what goes in and still
strips it on the next round trip.

IT IS THE CAPABILITY AND NOT A SECOND ONE NEXT TO IT, so every agent this
plugin hands a notebook to gets the order with it — the face, and the
sub-agent that asks for one through `engine.use("memory")`.
"""

from dataclasses import replace

from pydantic_ai.messages import ModelRequest, TextContent, UserPromptPart
from pydantic_ai.models import ModelRequestContext
from pydantic_ai.tools import RunContext
from pydantic_ai_harness.memory import Memory

# How the harness stamps the part it injects
# (`pydantic_ai_harness/memory/_capability.py`, `_MEMORY_PART_METADATA`, plus
# `:<scope hash>`). It is private, so this is a string we keep in step with the
# library: if it moves, this stops finding anything and the wobble above comes
# back — which is what `engine/tests/test_delegation.py` S1 catches.
MARKER = "pydantic-ai-harness.memory.v1"


def injected(part) -> bool:
    """Whether this user-role part is the notebook and not the client."""
    if not isinstance(part, UserPromptPart) or isinstance(part.content, str):
        return False
    return any(
        isinstance(item, TextContent) and (item.metadata or "").startswith(MARKER)
        for item in part.content
    )


class Notebook(Memory):
    async def before_model_request(
        self, ctx: RunContext, request_context: ModelRequestContext
    ) -> ModelRequestContext:
        request_context = await super().before_model_request(ctx, request_context)
        request = request_context.messages[-1]
        if not isinstance(request, ModelRequest):
            return request_context
        notebook = [part for part in request.parts if injected(part)]
        rest = [part for part in request.parts if not injected(part)]
        if notebook and rest:
            request_context.messages[-1] = replace(request, parts=[*notebook, *rest])
        return request_context
