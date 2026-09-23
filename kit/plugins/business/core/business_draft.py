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

THE FACE CORRECTS IT, ONE SECTION AT A TIME. QA told the chat «los sábados
cerramos a las 14»; memory got it and the draft kept saying 19:30, so Archivos
contradicted what she had just said. `correct_draft` is the face's: it rewrites
one section in the same format and leaves every other byte of the file alone —
including whatever the owner edited by hand from Archivos.
"""

from datetime import datetime
from typing import Literal
from zoneinfo import ZoneInfo

import business_site
from pydantic_ai import FunctionToolset, ModelRetry, RunContext

from core import config, identity

DRAFT = "negocio/borrador.md"

# Read by the owner, in Archivos. ADDRESSED TO HER, in the second person, vos:
# the first draft QA read (Panadería Verdun, 2026-09-23) talked about her in
# the third person —«la empresa destaca», «¿qué margen tiene el agente…?»— as
# if it were a report about her for somebody else. The headings say «vendés»,
# the prose says «cerrás», and the questions are what the agent asks HER.
TITLE = "# Tu negocio, según lo que leí"
NOTE = (
    "> Borrador que armé leyendo {sources} el {date}. Todo sale de lo que está"
    " publicado: corregí lo que no sea así y contame lo que falta —las"
    " preguntas del final son lo que más me sirve saber—."
)
SECTIONS = (
    ("summary", "En pocas palabras"),
    ("offer", "Qué vendés"),
    ("customers", "A quién le vendés"),
    ("prices", "Precios publicados"),
    ("where_and_when", "Dónde y cuándo"),
    ("channels", "Por dónde te encuentran"),
    ("voice", "Cómo hablás"),
    ("edge", "Qué te hace distinto"),
    ("questions", "Lo que no encontré y me sirve saber"),
    ("sources", "De dónde lo saqué"),
)
HEADINGS = dict(SECTIONS)
Section = Literal[
    "summary", "offer", "customers", "prices", "where_and_when",
    "channels", "voice", "edge", "questions",
]
NOT_FOUND = "No lo encontré publicado."
NO_QUESTIONS = "Por ahora no me queda ninguna pregunta."
SAVED = "Guardé el borrador en {path}."
CORRECTED = "Corregí «{heading}» en {path}."
NO_DRAFT = "Todavía no hay borrador en {path}: guardá lo que te dijo en tu memoria y listo."

# THE DRAFT HAS TO HAVE READ THE SITE, and it is checked here because the prose
# alone did not do it (`business_site.py`). ONE REFUSAL per site and process:
# the second save goes through, because a site whose other pages are a shop's
# two hundred products has nothing more to say, and a researcher stuck between
# a rule and a site that cannot satisfy it is a draft that never lands.
MIN_PAGES = 3
READ_MORE = (
    "Leíste {read} de las {total} páginas de {site}. Antes de guardar, leé las"
    " que cuentan el negocio —servicios, precios, nosotros, contacto, preguntas"
    " frecuentes, y dos o tres notas del blog si tiene—. Estas son:\n{pages}"
)
_refused: set[str] = set()


def read_from(sources: list[str]) -> str:
    """The note's «leyendo …»: HOW MANY pages of the site, counted by code.

    It used to list the first two URLs, and QA read «leyendo
    panaderiaverdun.com, …/productos» above a sources list of eight: the note
    undersold what was read.
    """
    if not sources:
        return "lo que encontré publicado"
    site = business_site.host(sources[0])
    own = [s for s in sources if business_site.host(s) == site]
    pages = len({business_site.canonical(s) for s in own})
    out = f"{pages} {'página' if pages == 1 else 'páginas'} de {site}"
    others = len(sources) - len(own)
    if others:
        out += f" y {others} de otros sitios"
    return out


def section(key: str, value: str | list[str] | None) -> str:
    """One section's body: a list as bullets, prose as it came, empty as said."""
    empty = NO_QUESTIONS if key == "questions" else NOT_FOUND
    if isinstance(value, list):
        return "\n".join(f"- {v}" for v in value) if value else empty
    return value.strip() if value and value.strip() else empty


def render(parts: dict, when: datetime) -> str:
    note = NOTE.format(sources=read_from(parts.get("sources") or []), date=when.strftime("%d/%m/%Y"))
    out = [TITLE, "", note, ""]
    for key, heading in SECTIONS:
        out += [f"## {heading}", "", section(key, parts.get(key)), ""]
    return "\n".join(out).rstrip() + "\n"


def replace(text: str, key: str, value: str | list[str]) -> str:
    """`text` with the section `key` rewritten, and every other byte as it was.

    A section runs from its heading to the next heading of the draft's own
    (`## ` + one of `SECTIONS`), so a `## ` the owner typed inside a section
    stays part of it. A section she deleted by hand comes back at the end: the
    correction is what she asked for, and it has to land somewhere she sees.
    """
    lines = text.splitlines(keepends=True)
    ours = {f"## {h}" for h in HEADINGS.values()}
    heading = f"## {HEADINGS[key]}"
    start = next((i for i, line in enumerate(lines) if line.rstrip() == heading), None)
    if start is None:
        return text.rstrip("\n") + f"\n\n{heading}\n\n{section(key, value)}\n"
    end = next((i for i in range(start + 1, len(lines)) if lines[i].rstrip() in ours), len(lines))
    tail = "\n\n" if end < len(lines) else "\n"
    return "".join(lines[: start + 1]) + f"\n{section(key, value)}{tail}" + "".join(lines[end:])


def toolset() -> FunctionToolset:
    """The researcher's: `save_draft`, which writes the whole draft."""
    ts = FunctionToolset()

    @ts.tool
    async def save_draft(
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

        Every field in Spanish, written TO the owner, in the second person with
        vos: «Vendés pan de masa madre», «Cerrás los domingos», never «la
        empresa vende» or «el negocio cierra». Only what you read on a page you
        opened; what you did not find stays empty (an empty string or list) and
        becomes a question instead.

        Args:
            summary: two or three sentences to the owner: what her business is, where, since when if known («Tenés una panadería en…»).
            offer: what she sells, one product or service line per item.
            customers: who buys from her, as her site presents it.
            prices: CURRENT published prices only, with currency and what each one is for. A price tied to a date, a season or a campaign that is over (Navidad, «Fiestas», a past month) goes as «de una promoción pasada» or into the questions, never as a current price; a price that looks like a placeholder («$ 9» on everything, no currency) is not listed: it goes into the questions.
            where_and_when: address, areas she serves, opening hours, delivery («Abrís de lunes a sábado de 6:30 a 19:30»).
            channels: website, Instagram, WhatsApp, phone, email — each with its handle or link.
            voice: how she talks to her customers (formal, cercano, vos/usted, emojis or not), with a short example taken from her site.
            edge: what she herself says sets her business apart («Destacás que…»).
            questions: 3 to 6 questions TO the owner, in vos, about what the agent needs and is not published («¿Cuánto margen me das para negociar un precio?», «¿Quién atiende los reclamos?»).
            sources: every URL you read, in order.
        """
        if sources:
            site = business_site.host(sources[0])
            listed = await business_site.pages(sources[0])
            read = {business_site.canonical(s) for s in sources if business_site.host(s) == site}
            if len(read) < min(MIN_PAGES, len(listed)) and site not in _refused:
                _refused.add(site)
                raise ModelRetry(READ_MORE.format(
                    read=len(read), total=len(listed), site=site,
                    pages="\n".join(f"- {p}" for p in listed[:30]),
                ))
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


def corrections() -> FunctionToolset:
    """The face's: `correct_draft`, one section at a time."""
    ts = FunctionToolset()

    @ts.tool_plain
    def correct_draft(section: Section, content: list[str]) -> str:
        """Rewrite one section of `negocio/borrador.md` with what your client just told you.

        The WHOLE section as it should read now, not only the change: what was
        right stays, what she corrected is replaced, what she added goes in.
        Spanish, to her, in vos («Cerrás los sábados a las 14»). For a list
        section (offer, prices, where_and_when, channels, questions) one item
        per line; for the others, one or two paragraphs.

        When she answers one of the questions, correct the section the answer
        belongs to AND `questions` with that question gone.

        Args:
            section: which section: summary, offer, customers, prices, where_and_when, channels, voice, edge or questions.
            content: the section's new lines.
        """
        target = config.WORKSPACE / DRAFT
        if not target.exists():
            return NO_DRAFT.format(path=DRAFT)
        lists = ("offer", "prices", "where_and_when", "channels", "questions")
        value = content if section in lists else "\n\n".join(c.strip() for c in content)
        target.write_text(replace(target.read_text(), section, value))
        return CORRECTED.format(heading=HEADINGS[section], path=DRAFT)

    return ts


def company() -> tuple[str, str]:
    """The company's name and website as the owner left them at onboarding."""
    who = identity.load()
    return (who.get("company") or "").strip(), (who.get("url") or "").strip()
