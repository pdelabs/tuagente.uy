"""The two tools that touch a flow: create one, pause or resume one.

Editing a flow's body is editing its file, which the agent already can do with
`write_file` — so there is no third tool for it. What needs a tool is what has
a FORMAT: the frontmatter the portal draws the card from, and the status the
scheduler reads.

THE DOCSTRINGS ARE THE RULES ABOUT USING THE TOOL, and they are in Spanish
because the model is what reads them. What the code can check — the slug, the
cron, the caps on the steps — is checked by the model below and comes back to
the agent as a retry, not as prose it has to remember.
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator
from pydantic_ai import RunContext
from pydantic_ai.toolsets import FunctionToolset

from .. import flows, plugins

MAX_STEPS = 7
MAX_STEP_LENGTH = 320

# The answer that means "this flow needs nothing connected". It is a word and
# not an empty list on purpose: skipping the question used to be free, and the
# agent skipped it even when the work touched email — it quietly narrowed the
# scope instead of saying a connection was missing, and the flow came out green
# in the portal.
NONE = "ninguna"


class NewFlow(BaseModel):
    """Lo que hace falta para dejar un trabajo corriendo solo."""

    slug: str = Field(description="el nombre de la carpeta: minúsculas, números y guiones")
    name: str = Field(description="el nombre que lee el cliente, corto")
    client_summary: str = Field(
        description="qué hace el flujo, dicho AL CLIENTE, en una línea y sin jerga"
    )
    trigger: Literal["schedule", "request"] = Field(
        description="`schedule` si corre solo con el reloj, `request` si arranca cuando lo piden"
    )
    trigger_detail: str = Field(
        description='el gatillo en criollo: "Todos los días a las 9:00"'
    )
    cron: str | None = Field(
        default=None,
        description="la expresión cron, obligatoria si `trigger` es `schedule` y prohibida si no",
    )
    connections: list[str] = Field(
        description=f'qué tiene que estar conectado para que el trabajo salga, o ["{NONE}"]'
    )
    steps: list[str] = Field(
        description=f"los pasos que lee el cliente: hasta {MAX_STEPS}, "
                    f"de hasta {MAX_STEP_LENGTH} caracteres cada uno"
    )
    notes: str = Field(
        default="",
        description="las notas técnicas: herramientas, carpetas, casos borde. El cliente no las ve",
    )

    @field_validator("steps")
    @classmethod
    def _steps(cls, value: list[str]) -> list[str]:
        # The steps are what the client reads in the Flows tab. Without a cap
        # they turn into an internal document: the first Instagram flow had 13
        # steps of six-line paragraphs and nobody was going to read that. What
        # overflows goes to `notes`.
        if not value:
            raise ValueError("un flujo sin pasos no se puede trabajar")
        if len(value) > MAX_STEPS:
            raise ValueError(
                f"{len(value)} pasos y el máximo es {MAX_STEPS}: agrupá, o mandá "
                "el detalle en `notes`"
            )
        long = [i + 1 for i, step in enumerate(value) if len(step) > MAX_STEP_LENGTH]
        if long:
            raise ValueError(
                f"los pasos {long} pasan de {MAX_STEP_LENGTH} caracteres: el cliente "
                "los tiene que poder leer de un vistazo, el detalle va en `notes`"
            )
        return value


def declared(connections: list[str]) -> list[str]:
    """What goes into the file: every connection named, minus the word that
    means none."""
    return [c for c in connections if c.strip().lower() != NONE]


def toolset() -> FunctionToolset:
    ts = FunctionToolset()

    @ts.tool
    def create_flow(ctx: RunContext, spec: NewFlow) -> dict:
        """Dejar un trabajo repetitivo armado como flujo del cliente.

        Es la ÚNICA forma de dejar algo corriendo solo. Usala siempre que el
        pedido se repita: «todas las semanas», «cada vez que llegue»,
        «avisame cuando», «todos los días a las 9».

        Antes de llamarla, cerrá el contrato: dónde termina el trabajo, con qué
        material, y cómo se sabe que salió bien. Un flujo no es una tarea —
        decidir mal se repite todas las semanas sin que nadie mire.

        Devuelve `next_run` (cuándo corre por primera vez) y
        `missing_connections`: lo que el flujo necesita y todavía no está
        conectado en este agente. Si falta algo, el flujo queda guardado pero NO
        corre solo hasta que esté conectado: decíselo al cliente en la misma
        respuesta, con qué se pierde mientras tanto.
        """
        if flows.read(spec.slug):
            raise ValueError(
                f"ya existe el flujo {spec.slug}: editá su FLOW.md en vez de recrearlo"
            )
        flow = flows.Flow(
            slug=spec.slug,
            name=spec.name,
            client_summary=spec.client_summary,
            trigger=spec.trigger,
            trigger_detail=spec.trigger_detail,
            cron=spec.cron,
            connections=declared(spec.connections),
            how="\n".join(f"{i}. {step}" for i, step in enumerate(spec.steps, 1)),
            notes=spec.notes,
        )
        flows.write(flow)
        # WHAT IS NOT SET UP ON THIS AGENT, not what the flow names: the plugin
        # that owns each connection answers (`plugins.connected`). A flow
        # missing one does not run on its own until it is there, so it has no
        # first run to announce, and the docstring above is what tells the
        # agent to say so.
        missing = plugins.missing(flow.connections)
        upcoming = None if missing else flows.next_run(flow, datetime.now(flows.zone(flow)))
        return {
            "created": flow.slug,
            "next_run": upcoming.strftime("%d/%m/%Y %H:%M") if upcoming else None,
            "missing_connections": missing,
        }

    @ts.tool
    def set_flow_status(ctx: RunContext, slug: str, status: Literal["active", "paused"]) -> dict:
        """Pausar un flujo o volver a activarlo.

        `paused` es "no corre hasta nuevo aviso": el trabajo deja de hacerse y
        el cliente lo ve pausado en su pestaña Flujos. Pausá sólo si te lo
        pidieron.
        """
        flow = flows.read(slug)
        if flow is None:
            raise ValueError(f"no existe el flujo {slug}")
        flow = flow.model_copy(update={"status": status})
        flows.write(flow)
        upcoming = flows.next_run(flow, datetime.now(flows.zone(flow)))
        return {
            "slug": slug,
            "status": status,
            "next_run": upcoming.strftime("%d/%m/%Y %H:%M")
            if upcoming and status == "active" else None,
        }

    return ts
