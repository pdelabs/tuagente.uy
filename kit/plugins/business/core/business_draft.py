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

A CORRECTION KEEPS WHAT IS STILL TRUE, AND TAKES ITS QUESTIONS WITH IT. QA's
second round (2026-09-23): «desde octubre abrimos de lunes a viernes de 10 a 19
y los sábados de 9 a 13» replaced the hours that hold until October, and the
questions kept asking the currency and the other opening days — the docstring
asked for a second call on `questions` and the face never made it. So the
questions her words answer are an argument of the same call, required, and the
code takes them off the list; a question it cannot find goes back with the
list as it reads now, so a paraphrase does not silently leave it there.
"""

import re
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
ANSWERED = "Saqué {count} de las preguntas del final: tu cliente ya las contestó."
NOT_A_QUESTION = (
    "{unknown} no está entre las preguntas del borrador. Copiá la pregunta como"
    " está en la lista, o dejá `answered_questions` vacío si no contesta"
    " ninguna. Las preguntas ahora son:\n{questions}"
)
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

# PRICES SEEN ARE PRICES LISTED. QA's bike shop (2026-09-23): «Precios
# publicados: No lo encontré publicado.» above a question that quoted the three
# plans at $ 990, $ 1490 and $ 2890 — the researcher read the prices, doubted
# them, and put them only in a question, so the draft contradicted itself. A
# money amount anywhere else in the draft with `prices` empty is sent back
# ONCE per site and process; the second save goes through, for the draft whose
# only amount really is not a price (a fine, a capital, a press note's revenue).
MONEY = re.compile(
    r"(?:U\$S|US\$|\$|€|\bUSD|\bUYU|\bARS)\s?\d|\d[\d.,]*\s?(?:pesos|dólares|euros|reales)\b",
    re.I,
)
PRICES_EMPTY = (
    "Nombrás montos ({amounts}) en {where}, pero «Precios publicados» quedó vacío."
    " Los precios que viste en la web van en `prices`: cada uno con qué es y su"
    " moneda, o «moneda sin confirmar» si la página no la dice. Una pregunta puede"
    " pedirle que los confirme, pero la sección de precios no dice «no lo"
    " encontré» cuando viste precios. Si esos montos no son precios de lo que"
    " vende, o son de relleno (el mismo en todo, sin moneda ni unidad), guardá"
    " de nuevo sin cambiar nada."
)
_priced: set[str] = set()


def amounts(parts: dict) -> dict[str, list[str]]:
    """The money amounts each section but `prices` names, a few characters each."""
    found: dict[str, list[str]] = {}
    for key, _ in SECTIONS:
        if key in ("prices", "sources"):
            continue
        value = parts.get(key) or ""
        text = "\n".join(value) if isinstance(value, list) else value
        hits = [text[m.start():m.end() + 6].strip() for m in MONEY.finditer(text)]
        if hits:
            found[key] = hits
    return found


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
    start, end = bounds(lines, key)
    if start is None:
        return text.rstrip("\n") + f"\n\n## {HEADINGS[key]}\n\n{section(key, value)}\n"
    tail = "\n\n" if end < len(lines) else "\n"
    return "".join(lines[: start + 1]) + f"\n{section(key, value)}{tail}" + "".join(lines[end:])


def bounds(lines: list[str], key: str) -> tuple[int | None, int]:
    """The heading line of section `key` and the line its next section starts on."""
    ours = {f"## {h}" for h in HEADINGS.values()}
    heading = f"## {HEADINGS[key]}"
    start = next((i for i, line in enumerate(lines) if line.rstrip() == heading), None)
    if start is None:
        return None, len(lines)
    end = next((i for i in range(start + 1, len(lines)) if lines[i].rstrip() in ours), len(lines))
    return start, end


def items(text: str, key: str) -> list[str]:
    """The bullets of a list section as they read now, owner's edits included."""
    lines = text.splitlines()
    start, end = bounds(lines, key)
    if start is None:
        return []
    return [line[2:].strip() for line in lines[start + 1:end] if line.startswith("- ")]


def flat(text: str) -> str:
    return re.sub(r"[\W_]+", "", text.casefold())


def same_question(asked: str, listed: str) -> bool:
    """Whether the face's copy of a question is that question: letters and
    digits only, case aside, and a copy that dropped the end still counts."""
    return bool(flat(asked)) and flat(asked) in flat(listed)


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
            prices: EVERY current price you saw on a page, each with what it is for and its currency («moneda sin confirmar» when the page does not say it). A price you are unsure of still goes here, and a question asks her to confirm it: this section is never empty when a page showed prices. A price tied to a date, a season or a campaign that is over (Navidad, «Fiestas», a past month) goes as «de una promoción pasada» or into the questions, never as a current price; a price that looks like a placeholder («$ 9» on everything, no currency) is not listed: it goes into the questions.
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
        seen = amounts(parts)
        site = business_site.host(sources[0]) if sources else ""
        if seen and not any(p.strip() for p in prices) and site not in _priced:
            _priced.add(site)
            raise ModelRetry(PRICES_EMPTY.format(
                amounts=", ".join(f"«{a}»" for hits in seen.values() for a in hits[:3]),
                where=" y ".join(f"«{HEADINGS[k]}»" for k in seen),
            ))
        target = config.WORKSPACE / DRAFT
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(render(parts, datetime.now(ZoneInfo(config.TIMEZONE))))
        return SAVED.format(path=DRAFT)

    return ts


def corrections() -> FunctionToolset:
    """The face's: `correct_draft`, one section at a time."""
    ts = FunctionToolset()

    @ts.tool_plain
    def correct_draft(section: Section, content: list[str], answered_questions: list[str]) -> str:
        """Rewrite one section of `negocio/borrador.md` with what your client just told you.

        The WHOLE section as it should read now, not only the change. KEEP
        WHAT IS STILL TRUE: a change that starts later is added with its
        date, next to what holds until then — she says «desde marzo también
        abrimos los sábados de 9 a 13» and the hours read «Abrís de lunes a
        viernes de 9 a 18» AND «Desde marzo, también los sábados de 9 a 13»,
        not the Saturday alone. Replace a line only when she says it is
        wrong or no longer so. Spanish, to her, in vos («Cerrás los sábados a
        las 14»). For a list section (offer, prices, where_and_when, channels,
        questions) one item per line; for the others, one or two paragraphs.

        Args:
            section: which section: summary, offer, customers, prices, where_and_when, channels, voice, edge or questions.
            content: the section's new lines.
            answered_questions: every question of «Lo que no encontré y me sirve saber» that what she told you answers, copied as it reads there; they leave the list. Empty when her words answer none.
        """
        target = config.WORKSPACE / DRAFT
        if not target.exists():
            return NO_DRAFT.format(path=DRAFT)
        lists = ("offer", "prices", "where_and_when", "channels", "questions")
        value = content if section in lists else "\n\n".join(c.strip() for c in content)
        text = replace(target.read_text(), section, value)
        if answered_questions:
            open_ = items(text, "questions")
            unknown = [a for a in answered_questions if not any(same_question(a, q) for q in open_)]
            if unknown:
                raise ModelRetry(NOT_A_QUESTION.format(
                    unknown=", ".join(f"«{u}»" for u in unknown),
                    questions="\n".join(f"- {q}" for q in open_) or NO_QUESTIONS,
                ))
            left = [q for q in open_ if not any(same_question(a, q) for a in answered_questions)]
            text = replace(text, "questions", left)
        target.write_text(text)
        said = CORRECTED.format(heading=HEADINGS[section], path=DRAFT)
        if answered_questions:
            said += " " + ANSWERED.format(count=len(open_) - len(left))
        return said

    return ts


def company() -> tuple[str, str]:
    """The company's name and website as the owner left them at onboarding."""
    who = identity.load()
    return (who.get("company") or "").strip(), (who.get("url") or "").strip()
