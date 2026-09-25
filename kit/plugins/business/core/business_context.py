"""Everything the agent knows about the business, in one place: the «Marca» tab
and the face's prompt read the same three things.

- THE SECTIONS of `negocio/borrador.md` (`business_draft.py` owns its shape and
  its confirmations), each one «Borrador» or «Confirmado».
- THE OWNER'S NOTES, `negocio/notas.md`: plain markdown she writes from the
  tab, read to the face verbatim. What does not fit a section — «a los
  mayoristas no les hago descuento», «el dueño se llama Juan» — goes here.
- THE OWNER'S FILES, `negocio/archivos/<name>`: a price list, a menu, a
  brochure. The face is told their paths and reads them when a question needs
  one; they are never pasted into the prompt.

THE FACE GETS IT ON EVERY RUN, NOT WHEN IT REMEMBERS. The draft used to be a
file the face was told to read «cuando necesites saber algo del negocio», and a
WhatsApp answer about the Saturday hours is exactly the turn where it does not
think to. So `Context` is a capability whose instructions are this block,
built fresh per run — chat and flow runs alike, since both are the face.

WHERE IT LANDS, AND WHY THAT SHAPE. It is `injection.Notebook`'s shape (the
memory plugin): rendered once in `for_run`, handed back as a LITERAL by
`get_instructions`. A literal sorts before every callable instruction, so the
block sits above the skills index and the date line, inside the stable prefix
the provider caches; `business` loads last in `CORE_PLUGINS`, so it lands under
the SOUL, the plugins' prose and the memory notebook. It only changes when the
owner or the face changes the business, which is the one time a cold prefix is
the right price. A callable would re-render on every round trip for nothing.

EACH SECTION SAYS WHOSE WORD IT IS. «confirmado por tu cliente» or «borrador:
lo leí en la web» on the heading itself, because what the face may tell a
customer as certain depends on it (`instructions.md`), and a marker far from
the text it qualifies is one the model loses. A section the researcher did not
find and nobody confirmed is left out: its absence says the same, for free.
"""

from dataclasses import dataclass, field
from pathlib import Path

import business_draft
from pydantic_ai.capabilities import AbstractCapability
from pydantic_ai.tools import RunContext

from core import config
from core.tools.workspace import under

NOTES = "negocio/notas.md"
FILES = "negocio/archivos"

# The block the face reads. Spanish, to the agent, about its client.
HEADING = "## El negocio de tu cliente"
CONFIRMED = "confirmado por tu cliente"
UNCONFIRMED = "borrador: lo leí en la web, tu cliente no lo confirmó"
OPEN_QUESTIONS = "### Lo que todavía no sabés (preguntale de a una, cuando venga al caso)"
OWN_WORDS = "### Lo que tu cliente escribió"
OWN_FILES = "### Archivos que te dejó (leelos con `read_file` cuando haga falta)"


def draft_text() -> str | None:
    target = config.WORKSPACE / business_draft.DRAFT
    return target.read_text() if target.exists() else None


def notes() -> str:
    target = config.WORKSPACE / NOTES
    return target.read_text() if target.exists() else ""


def save_notes(text: str) -> None:
    target = config.WORKSPACE / NOTES
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text)


def folder() -> Path:
    return config.WORKSPACE / FILES


def file_path(name: str) -> Path:
    """Where the owner's file `name` lives: inside `negocio/archivos/`, one
    level, or ValueError. `Path(name).name` drops any folder she (or a caller)
    put in front of it, and `under` refuses what still resolves outside — `..`
    is a name with no folder in front of it."""
    target = under(folder(), Path(name).name)
    if target.parent != folder().resolve():
        raise ValueError(name)
    return target


def files() -> list[dict]:
    if not folder().is_dir():
        return []
    root = config.WORKSPACE.resolve()
    return [
        {
            "name": path.name,
            "path": str(path.resolve().relative_to(root)),
            "size": path.stat().st_size,
            "uploaded_at": int(path.stat().st_mtime),
        }
        for path in sorted(folder().iterdir())
        if path.is_file() and not path.name.startswith(".")
    ]


def section(text: str, key: str, confirmed: dict[str, float]) -> dict:
    return {
        "key": key,
        "heading": business_draft.HEADINGS[key],
        "text": business_draft.body(text, key) or "",
        "confirmed": key in confirmed,
        "confirmed_at": confirmed.get(key),
    }


def sections(text: str) -> list[dict]:
    confirmed = business_draft.confirmations(text)
    return [section(text, key, confirmed) for key in business_draft.CONFIRMABLE]


def questions(text: str) -> list[str]:
    """The open questions as a list; the section's «no me queda ninguna» has
    no bullets, so it reads as none."""
    return business_draft.items(text, "questions")


def block() -> str | None:
    """What the face reads about the business this run, or nothing at all."""
    text = draft_text()
    written = notes().strip()
    owned = files()
    if text is None and not written and not owned:
        return None
    out = [HEADING]
    if text is not None:
        for s in sections(text):
            if not s["confirmed"] and s["text"] == business_draft.NOT_FOUND:
                continue
            out.append(f"### {s['heading']} ({CONFIRMED if s['confirmed'] else UNCONFIRMED})\n{s['text']}")
        asked = questions(text)
        if asked:
            out.append(OPEN_QUESTIONS + "\n" + "\n".join(f"- {q}" for q in asked))
    if written:
        out.append(f"{OWN_WORDS}\n{written}")
    if owned:
        out.append(OWN_FILES + "\n" + "\n".join(f"- `{f['path']}`" for f in owned))
    return "\n\n".join(out)


@dataclass
class Context(AbstractCapability):
    """The business block, in the instructions of every run of the face."""

    _rendered: str | None = field(default=None, init=False, repr=False, compare=False)

    async def for_run(self, ctx: RunContext) -> "Context":
        clone = Context(id=self.id)
        clone._rendered = block()
        return clone

    def get_instructions(self) -> str | None:
        return self._rendered
