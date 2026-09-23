"""The draft of the business: the one file the researcher leaves behind.

THE MODEL SUPPLIES THE WORDS, THE CODE SUPPLIES THE FORMAT. `save_draft` takes
the pieces and this module writes `negocio/borrador.md` with the same headings
every time, the date, where it came from, and the line that tells the owner it
is a draft to correct. A researcher that wrote markdown freehand would leave a
different document each time, and the face would have to guess where the
prices are.

WHY «BORRADOR». Everything in it was read on a public page and nothing was
confirmed by the owner. The face reads it as background, never as her word
(`instructions.md`), and the questions at the end are what she is asked.
"""

from datetime import datetime
from zoneinfo import ZoneInfo

from pydantic_ai import FunctionToolset, RunContext

from core import config, identity

DRAFT = "negocio/borrador.md"

# Read by the owner, in Archivos.
TITLE = "# Tu negocio, según lo que leí"
NOTE = (
    "> Borrador que armé leyendo {sources} el {date}. Todo sale de lo que está"
    " publicado: corregí lo que no sea así y contame lo que falta —las"
    " preguntas del final son lo que más me sirve saber—."
)
SECTIONS = (
    ("summary", "En pocas palabras"),
    ("offer", "Qué vende"),
    ("customers", "A quién le vende"),
    ("prices", "Precios publicados"),
    ("where_and_when", "Dónde y cuándo"),
    ("channels", "Por dónde se lo encuentra"),
    ("voice", "Cómo habla"),
    ("edge", "Qué lo hace distinto"),
    ("questions", "Lo que no encontré y me sirve saber"),
    ("sources", "De dónde lo saqué"),
)
NOT_FOUND = "No lo encontré publicado."
SAVED = "Guardé el borrador en {path}."


def render(parts: dict, when: datetime) -> str:
    sources = parts.get("sources") or []
    shown = ", ".join(sources[:2]) if sources else "lo que encontré publicado"
    out = [TITLE, "", NOTE.format(sources=shown, date=when.strftime("%d/%m/%Y")), ""]
    for key, heading in SECTIONS:
        value = parts.get(key)
        out.append(f"## {heading}")
        out.append("")
        if isinstance(value, list):
            out.extend(f"- {v}" for v in value) if value else out.append(NOT_FOUND)
        else:
            out.append(value.strip() if value and value.strip() else NOT_FOUND)
        out.append("")
    return "\n".join(out).rstrip() + "\n"


def toolset() -> FunctionToolset:
    ts = FunctionToolset()

    @ts.tool
    def save_draft(
        ctx: RunContext,
        summary: str,
        offer: list[str],
        customers: str,
        prices: list[str],
        where_and_when: list[str],
        channels: list[str],
        voice: str,
        edge: str,
        questions: list[str],
        sources: list[str],
    ) -> str:
        """Write the business draft to `negocio/borrador.md`, replacing the last one.

        Every field in Spanish, as the owner will read it. Only what you read on
        a page you opened; what you did not find stays empty (an empty string or
        list) and becomes a question instead.

        Args:
            summary: two or three sentences: what the business is, where, since when if known.
            offer: what it sells, one product or service line per item.
            customers: who buys, as the site presents it.
            prices: published prices only, with currency and what each one is for.
            where_and_when: address, areas it serves, opening hours, delivery.
            channels: website, Instagram, WhatsApp, phone, email — each with its handle or link.
            voice: how the business talks (formal, cercano, vos/usted, emojis or not), with a short example taken from the site.
            edge: what the business itself says sets it apart.
            questions: 3 to 6 things the agent needs to know that are not published.
            sources: every URL you read, in order.
        """
        parts = {
            "summary": summary, "offer": offer, "customers": customers, "prices": prices,
            "where_and_when": where_and_when, "channels": channels, "voice": voice,
            "edge": edge, "questions": questions, "sources": sources,
        }
        target = config.WORKSPACE / DRAFT
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(render(parts, datetime.now(ZoneInfo(config.TIMEZONE))))
        return SAVED.format(path=DRAFT)

    return ts


def company() -> tuple[str, str]:
    """The company's name and website as the owner left them at onboarding."""
    who = identity.load()
    return (who.get("company") or "").strip(), (who.get("url") or "").strip()
