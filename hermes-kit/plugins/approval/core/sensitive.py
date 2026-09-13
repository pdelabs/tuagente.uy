"""Two sensitive tools with fake side effects, and the gate on top of them.

Nothing here reaches the outside: `send_email` and `publish_post` write a file
into `/workspace/outbox/` and that is the whole side effect. What is real is
the gate. The toolset is registered wrapped in `approval_required()`
(`plugin.py`), so a call stops the run and lands in the client's Approvals tab
BEFORE the tool body runs — the model cannot forget to ask, because asking is not something it
does.

`approval_required()` with no predicate on purpose, and it is `plugin.py` that
wraps the toolset: every tool in here is gated, and one added later is gated
too without anyone remembering to put its name on a list. Fail closed is the
whole gate.

THE PROSE ABOUT ASKING IS IN THE TOOL AND FIELD DESCRIPTIONS, not in a SOUL
and not in a skill. What a request has to say — what happens if the client says
yes, what happens if she says no — is a rule about using THIS tool, so it
travels with the tool and reaches the model only where the tool does.
"""

import re
import time
from pathlib import Path

from pydantic import BaseModel, Field
from pydantic_ai import RunContext
from pydantic_ai.toolsets import FunctionToolset

OUTBOX = "outbox"


class ApprovalNote(BaseModel):
    """The words the client reads on the approval card.

    The model supplies the words, the code supplies the format (`render.py`,
    next to this file): every request the client sees has the same four
    sections, whatever the tool. The field descriptions are in Spanish because
    they are what the model is answering, and the client reads the answer.
    """

    what: str = Field(description="Qué vas a hacer, en una línea y en criollo.")
    if_approved: str = Field(description="Qué pasa si el cliente te dice que sí.")
    if_rejected: str = Field(description="Qué pasa si el cliente te dice que no.")
    why: str = Field(description="Por qué lo estás proponiendo ahora.")


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:40] or "sin-nombre"


def drop(workspace: Path, prefix: str, name: str, text: str) -> str:
    box = workspace / OUTBOX
    box.mkdir(parents=True, exist_ok=True)
    target = box / f"{prefix}-{time.strftime('%Y%m%d-%H%M%S')}-{slug(name)}.md"
    target.write_text(text)
    return str(target.relative_to(workspace))


def corrected(body: str, client_correction: str | None) -> str:
    """The client's correction, applied to the text that goes out.

    It travels as a line of its own instead of being spliced into the prose:
    code cannot rewrite a paragraph, and pretending it can is how a correction
    ends up half applied.
    """
    body = body.strip()
    if not client_correction:
        return body
    return f"{body}\n\nCorrección que pidió el cliente, aplicada: {client_correction.strip()}"


def toolset() -> FunctionToolset:
    ts = FunctionToolset()

    @ts.tool
    def send_email(
        ctx: RunContext,
        to: str,
        subject: str,
        body: str,
        note: ApprovalNote,
        client_correction: str | None = None,
    ) -> str:
        """Mandar un mail. Frena hasta que el cliente lo apruebe desde el portal.

        `note` es lo que el cliente lee para decidir: llenala siempre, en
        criollo y sin tecnicismos.

        `client_correction` NO LA ESCRIBÍS VOS: la completa el cliente cuando
        aprueba con correcciones, y llega sola en la segunda vuelta. Dejala
        vacía siempre.
        """
        text = f"Para: {to}\nAsunto: {subject}\n\n{corrected(body, client_correction)}\n"
        return f"mail escrito en {drop(ctx.deps.workspace, 'email', to, text)}"

    @ts.tool
    def publish_post(
        ctx: RunContext,
        channel: str,
        text: str,
        note: ApprovalNote,
        client_correction: str | None = None,
    ) -> str:
        """Publicar algo en un canal. Frena hasta que el cliente lo apruebe.

        `note` es lo que el cliente lee para decidir: llenala siempre.

        `client_correction` NO LA ESCRIBÍS VOS: la completa el cliente cuando
        aprueba con correcciones. Dejala vacía siempre.
        """
        body = f"Canal: {channel}\n\n{corrected(text, client_correction)}\n"
        return f"publicación escrita en {drop(ctx.deps.workspace, 'post', channel, body)}"

    return ts
