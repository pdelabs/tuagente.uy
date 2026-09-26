"""The post: the folder `save_post` writes, and the three routes that read it.

    <workspace>/posteos/<YYYY-MM-DD>-<slug>/
        post.json     the whole post; it is also what the route answers
        caption.md    the caption, a blank line, the hashtags on one line
        01.png …      the slides, in the order they are flipped through
        anteriores/   every slide a fix replaced, kept: 01-1.png, 02-1.png …

THE DAY'S POST IS A CAROUSEL: several slides, `01.png` the hook and the last
one the close, and `alts` carries one description per slide in that same
order. `alt` stays what it was — the post's own description — and it is the
FIRST slide's, because that is the field the portal's `Post` reads.

AND THE BRIEF OF EVERY SLIDE IS KEPT WITH IT. `generate_image` writes a
sidecar next to each picture (`imagenes/2026-09-15-1.json`, the image plugin's
`BRIEF` convention) with the prompt it was made from; `save_post` reads it as
it moves the picture in, takes it out of `imagenes/` and writes the prompt into
`prompts`, parallel to `images` and `alts` and in the same order. That is what
makes ONE slide fixable: `replace_slide` hands the creator the brief the slide
was made with, so it changes the one line that is wrong and keeps the rest word
for word — which is the only thing holding a carousel's five pieces together.
A picture with no sidecar breaks the tool loudly instead of saving a post whose
slides cannot be fixed.

AND A FIX THROWS NOTHING AWAY. `replace_slide` does not delete the slide it
replaces: it moves it into `anteriores/` as `NN-<k>.<ext>`, counting up per
slide, and writes a row into `versions` — the file, the prompt and the alt that
were that slide's, when it was replaced, and the client's own words about what
was wrong. Which of two pictures is the good one is the client's call and
nobody else's, and the picture they did not keep is also the only record of
what they asked for; both of those used to be one `unlink()` away from gone.
`versions` is keyed by the slide's CURRENT file name, so a fix that arrives as
a different type carries its history with it.

THE ROUTES ARE IN THIS FILE AND NOT IN A `routes.py`, which is what the shape
of `plugins/approval/core/` would suggest, AND THE REASON IS MEASURED. A
plugin's surface modules import each other BY PLAIN NAME (`core/plugins.py`,
`import_surface`), so they share one `sys.modules` namespace with every other
enabled plugin's: `import routes` here returned the APPROVAL plugin's module,
already imported under that name, and the app came up with `modules.posts`
true, approval's router registered twice and no `/portal/posts` at all. Nothing
failed and nothing was logged. A second plugin's file may only share a name
with the first's if they are the same file.

THE FORMAT IS CODE AND THE PROSE NEVER NAMES IT. Every convention that
depended on the agent remembering a path has failed — the Hermes skill told it
to copy the picture out of the engine's cache «con un nombre que se entienda»
and the name was different every day, so the client's folder was a pile. Here
the model supplies the words and this file supplies the directory, the file
names and the numbering.

ONE POST PER DAY, and the check is the folder: a run that starts twice after a
crash finds today's post already there and stops, which is what makes the
scheduled flow safe to repeat (`docs/own-agent-plan.md`, wave 1).

THE PIECES ARE MOVED AND NOT COPIED. `generate_image` leaves the PNG in
`imagenes/`, which is scratch: the client sees it in Files and does not know
whether it is the one that got used. After the move there is one copy and it
is inside the post, so throwing the post out throws its pictures out too.

AND THAT IS WHY A SAVE MAY NEVER DELETE BEFORE IT HAS THE REPLACEMENT. Measured
on our own agent on 2026-09-15, and it cost four finished slides: the client
asked for a better caption, the creator had no tool for words, so it called
`save_post(replace=True)` with THE POST'S OWN PICTURES as `images`. `replace`
deleted the folder, and the first `brief_of` then died on a sidecar that had
been inside it. The post was empty and nothing was left to put back. Two things
came out of that morning and both are in this file:

- `incoming()` refuses a path under `posteos/`. A picture that is already in a
  post is not an incoming picture, and the refusal names the two tools that do
  what that call was trying to do.
- A save NEVER writes over the old post. It builds the new one in a folder of
  its own and swaps it in at the end — the old one is renamed aside and only
  then removed — so a failure halfway leaves the post that was there exactly as
  it was, and the half-built one on disk for whoever wants to look.
"""

import json
import re
import shutil
import unicodedata
from datetime import datetime
from pathlib import Path
from typing import Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from PIL import Image, ImageOps
from pydantic_ai import ModelRetry, RunContext
from pydantic_ai.messages import BinaryImage
from pydantic_ai.toolsets import FunctionToolset

import looks
import voseo
from core import config, db, identity
from core.tools.workspace import under

WHERE = "posteos"
POST = "post.json"
CAPTION = "caption.md"
# Where a replaced slide goes. Spanish, like `posteos/` and `imagenes/`: it is
# a folder the client opens in Files, not an internal of ours.
PREVIOUS = "anteriores"

# The prefix of a post that is being built and of the one it is replacing. It
# starts with a dot because these two are OURS and not the client's, and the
# listing skips them by this name: a folder halfway through a save is not a
# post, and the tab drawing it would be drawing a post with no pictures.
BUILDING = ".armando-"

# The suffix of the brief `generate_image` leaves beside every picture. The
# same word as the image plugin's `BRIEF`, and not an import: the two plugins
# share a `sys.modules` namespace and nothing else.
BRIEF = ".json"

# Lowercase, hyphens, short: it is half a directory name and the whole of the
# post's id, and the id travels into the portal's URLs.
# THE STORY'S SHAPE, a closed list the skill explains (`skills/post/SKILL.md`,
# step 3) and `looks.py` rotates. A carousel is refused without one: on our own
# agent the carousels were four true sentences in no particular order, written
# after the caption as «the same lines in other words» (2026-09-20).
Structure = Literal["historia", "antes-despues", "mito", "pasos", "lista", "numero"]
Goal = Literal["guardar", "mandar", "escribir"]

MAX_SLUG = 40
SLUG = re.compile(rf"^[a-z0-9][a-z0-9-]{{0,{MAX_SLUG - 1}}}$")

# Instagram's own caps, checked 2026-09-14. The hashtag one moved in December
# 2025 (30 -> 5) and is the number the old skill got wrong for months.
MAX_CAPTION = 2200
MAX_ALT = 1000
MAX_HASHTAGS = 5
MAX_IMAGES = 10
# Ours: a name that fits on a chip in the chat and on a line of Inicio.
MAX_TITLE = 60

# What the route serves a piece as. `generate_image` only ever writes PNG; the
# other two are here because a client's own picture can land in the workspace
# and be used, and a downloaded file with the wrong type is a file that does
# not open.
TYPES = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
         ".webp": "image/webp"}

# THE FORMAT OF A POST IS NOT THE FORMAT OF A PIECE, and that is why
# `carousel` is here and NOT in the image plugin's `RATIO`. A carousel's slides
# are 4:5, exactly what a `feed` piece is once `fit` has cut it (`SIZE`), so a
# fourth ratio would be the
# same geometry under a second name — a new key, a new `Literal` and a new line
# of docstring in another plugin, for nothing. The skill tells the creator to
# generate every slide as `feed`, this word says what the client ends up
# flipping through, and the image plugin's vocabulary stays the three shapes a
# picture is ever cut to.
Format = Literal["feed", "square", "story", "carousel"]

# THE PIXELS A POST IS SAVED AT, and they are Instagram's, not the image
# model's. The provider has no 4:5 and answers `feed` as 3:4, 1152×1536 (the
# image plugin's `RATIO` has the measurement), and Instagram's portrait feed is
# 4:5: left to Instagram, the crop happened on the phone of whoever published,
# and the API refuses a 3:4 outright (its narrowest is 4:5). So the slide is
# cut HERE, by code, as it goes into the post: centred, which takes 48 px off
# the top and 48 off the bottom of a 1152×1536 — about 3% each — and then
# scaled to 1080 wide. The brief keeps its text out of those bands
# (`skills/post/SKILL.md`, step 5). Only the cut is kept: the bands are air by
# design, and a second copy of every slide is a second answer to «which one is
# the post».
SIZE = {"feed": (1080, 1350), "carousel": (1080, 1350),
        "square": (1080, 1080), "story": (1080, 1920)}

# Read by the client: the portal shows `error.message` on the tab she is on.
NO_POST = "No hay ningún posteo {post_id} en este agente."
NO_IMAGE = "El posteo {post_id} no tiene ninguna imagen {name}."
NO_LOGO = "No hay ningún logo {name} en la carpeta de tu marca."

# A TRAILING BLOCK OF HASHTAG LINES COMES OFF THE CAPTION. They have a field of
# their own and `caption.md` puts them back at the end, so a caption that
# carries them too is the same five tags printed twice — which is what the very
# first run of `tests/test_post.py` produced, with the tool's own docstring
# saying «sin los hashtags» right there in the prompt. The model supplies the
# words; the code supplies the format. Only a run of hashtag-ONLY lines at the
# END goes: a `#` inside a sentence is part of the sentence.
HASHTAG_LINES = re.compile(r"(?:^[ \t]*(?:#\S+[ \t]*)+$\n?)+\Z", re.MULTILINE)


def root() -> Path:
    return config.WORKSPACE / WHERE


def folder(post_id: str) -> Path:
    return root() / post_id


def expand(data: dict) -> dict:
    """The `Post` the portal reads: the file's object, images filled in.

    `post.json` carries the NAMES, and the size and the URL are computed here
    from what is on disk. The portal never builds a path of its own: it fetches
    `url` with the bearer header and makes an object URL out of the bytes, so
    the client's key never travels in a query string.

    Everything else of the file travels as it was written, `alts` and
    `prompts` included: one description and one brief per image, in the same
    order as `images`. The tab shows the brief of the slide the client is
    looking at, which is how «everything that was used» is visible and not
    only stored.

    `versions` gets the same treatment as `images`: each replaced slide is
    handed over with the `url` its bytes are at, so the tab draws the picture
    that was there before the fix without ever building a path of its own. It
    is always answered, `{}` on a post nothing was fixed on — and `.get`,
    because a post written before any of this existed is still on disk and the
    tab has to draw it.

    `title` is always answered too, for the same reason: `title_of`.
    """
    directory = folder(data["id"])
    return data | {
        "title": title_of(data),
        "images": [
            {
                "name": name,
                "bytes": (directory / name).stat().st_size,
                "url": f"/portal/posts/{data['id']}/{name}",
            }
            for name in data["images"]
        ],
        "versions": {
            name: [
                version | {"url": f"/portal/posts/{data['id']}/{version['file']}"}
                for version in history
            ]
            for name, history in (data.get("versions") or {}).items()
        },
    }


def read(post_id: str) -> dict | None:
    path = folder(post_id) / POST
    return expand(json.loads(path.read_text())) if path.is_file() else None


def read_all() -> list[dict]:
    """Every post, newest first. The day decides, and `created_at` breaks the
    tie for the day a post was replaced.

    A folder `save_post` is still building is not one of them: it carries the
    same `post.json` for the last instant before the swap, and the client would
    see the same post twice — or, if the save failed, one that has no pictures.
    """
    found = [
        json.loads(path.read_text())
        for path in root().glob(f"*/{POST}")
        if not path.parent.name.startswith(BUILDING)
    ]
    found.sort(key=lambda p: (p["date"], p["created_at"]), reverse=True)
    return [expand(p) for p in found]


def image_path(post_id: str, name: str) -> Path | None:
    """The bytes of one piece, and only of a piece the post lists.

    The listing is the allowlist, so there is no path to sanitize and no guard
    written in prose: a name that is not one of `images` or one of the
    `versions`' files is a 404 whatever it is made of, `anteriores/../../x`
    included. That is also what lets the route take a `:path` — a replaced
    slide lives one folder down and its name carries a slash.
    """
    data = read(post_id)
    if data is None:
        return None
    kept = [v["file"] for history in data["versions"].values() for v in history]
    if name not in [image["name"] for image in data["images"]] + kept:
        return None
    return folder(post_id) / name


def incoming(workspace: Path, relative: str) -> Path:
    """One picture the model just made, checked before it goes into a post.

    The refusals are worded for the model, which is who can fix them: a path
    outside the workspace, a file that is not there, a type the tab cannot draw
    — the route answers the type off the extension, so a file it has no type
    for would be a 500 on the tab instead of a picture — and a picture that is
    already inside a post.

    THAT LAST ONE IS THE ONE THAT COST FOUR SLIDES. `save_post(replace=True)`
    with the post's own pictures as `images` is a call that deletes its own
    sources, and the creator made it because it was asked for a better caption
    and had no tool for words (the module docstring has the whole morning). The
    refusal names the two tools that do what such a call is reaching for, so it
    is a redirection and not a wall.
    """
    try:
        path = under(workspace, relative)
    except ValueError:
        raise ModelRetry(f"{relative} está fuera del espacio de trabajo") from None
    if not path.is_file():
        raise ModelRetry(
            f"no encuentro {relative}: pasame la ruta que te devolvió "
            "`generate_image`"
        )
    if path.suffix.lower() not in TYPES:
        raise ModelRetry(
            f"{relative} no es una imagen que el portal pueda mostrar: "
            f"{', '.join(sorted(TYPES))}"
        )
    if path.is_relative_to((workspace / WHERE).resolve()):
        raise ModelRetry(
            f"{relative} ya es la imagen de un posteo que está guardado, y esas "
            "no se vuelven a guardar. Si hay que cambiarle las palabras al "
            "posteo usá `update_caption`; si hay que cambiar una imagen, "
            "`replace_slide`"
        )
    return path


def fit(source: Path, target: Path, format: str) -> None:
    """`source` cut to the post's shape and written as `target`; `source` goes.

    `ImageOps.fit` is the centred crop and the resize in one call. The file
    type is the target's suffix, which is the source's: a client's JPEG stays a
    JPEG and the route keeps serving it with its own type.
    """
    with Image.open(source) as picture:
        ImageOps.fit(picture, SIZE[format], Image.Resampling.LANCZOS).save(target)
    source.unlink()


def brief_of(image: Path) -> str:
    """What the picture was made from, and the sidecar taken out of `imagenes/`.

    NO FALLBACK. A picture with no brief beside it did not come out of
    `generate_image`, and saving it would leave a slide nobody can fix later:
    the post would look finished and «arreglá la slide 2» would have nothing to
    start from. It breaks here, where the model reads the traceback, instead of
    a week from now in front of the client.
    """
    prompt = peek_brief(image)
    image.with_suffix(BRIEF).unlink()
    return prompt


def peek_brief(image: Path) -> str:
    """The same brief, LEFT WHERE IT IS. For whoever has to read it before
    deciding whether the post gets saved at all: a refusal must leave
    `imagenes/` exactly as it found it, sidecars included."""
    return sidecar(image)["prompt"]


def sidecar(image: Path) -> dict:
    """The whole sidecar: the brief, and `reference` when the picture is an
    EDIT of another one (`generate_image(reference=…)`), whose `prompt` is then
    the change and not a description of the picture."""
    return json.loads(image.with_suffix(BRIEF).read_text())


def clean_caption(caption: str) -> str:
    """The caption as it is stored: the trailing hashtag block off, trimmed,
    and refused if it does not fit in Instagram or does not speak `vos`
    (`voseo.py`). Shared by the tool that writes a post and the one that
    rewrites its words, so the two cannot drift."""
    caption = HASHTAG_LINES.sub("", caption).strip()
    if len(caption) > MAX_CAPTION:
        raise ModelRetry(
            f"el pie tiene {len(caption)} caracteres y en Instagram entran "
            f"{MAX_CAPTION}: cortalo"
        )
    words = voseo.found(caption)
    if words:
        raise ModelRetry(
            f"el pie habla de tú y el cliente habla de vos: {voseo.fixes(words)}. "
            "Escribilo de vos. No guardé nada."
        )
    return caption


# THE CLOSING SLIDE SAYS WHOSE POST IT IS. The QA carousel of 2026-09-23 was six
# slides of bread with the bakery's name nowhere: a post a follower sends to a
# friend has to say where the bread is from, and the one slide whose job is
# the ask is the one that carries it. The name is the identity's `company` —
# what the owner typed at onboarding — so the model supplies the sentence and
# the code checks the name is in it, spelled the owner's way (case and accents
# aside: «PANADERÍA VERDUN» is a design choice, not a different name).
# DRAWN BY THE IMAGE MODEL, NOT PASTED BY CODE, and on purpose: a code overlay
# needs a font the engine image does not carry (only Pillow's default,
# measured) and would sit on the picture in a typeface no brand chose, where
# the slide's own text is drawn in the look's. `place_image` is still the way
# a logo FILE goes on, and the checklist is what catches a misspelled name.
def company() -> str | None:
    """The business's name, or `None` before onboarding has set one."""
    return identity.load().get("company") or None


def plain(text: str) -> str:
    """Case and accents out of the way, for comparing a name."""
    decomposed = unicodedata.normalize("NFKD", text.casefold())
    return " ".join("".join(c for c in decomposed if not unicodedata.combining(c)).split())


def signed(brief: str, name: str) -> bool:
    """Whether the words a brief asks the picture to carry include `name`."""
    return plain(name) in plain(" ".join(voseo.quoted(brief)))


# THE REFUSAL HANDS OVER THE SENTENCE, AND SAYS WHOSE RULE IT IS. The first
# wording said «tiene que decir de quién es… Rehacé esa lámina», and on the QA
# agent (AQUA Bicicletería, 2026-09-23) a text fix of the closing slide ran
# twice and ended with the face asking the owner «el sistema exige incluirlo.
# ¿Autorizás que quede así?» — a rule of ours put to her as a question she had
# no way to answer. The name is how a closing is made, like the voice: the
# creator adds it and moves on, and the refusal says so in as many words, with
# the text it should end up with already written.
UNSIGNED = (
    "la lámina {number} es el cierre, y el cierre dice de quién es el posteo: "
    "su texto entre « » lleva el nombre del negocio tal cual, «{name}». "
    "Agregáselo vos, por ejemplo «{signed}», y seguí: {how} Es cómo se arma un "
    "cierre, como hablar de vos: no se le pregunta al cliente ni va en tu "
    "informe. No guardé nada."
)
# What to do with the picture, which is the one thing that differs between a
# new post and a fix: a new post's slide is drawn again with its whole brief
# (`save_post` refuses an edit as a slide of a new post); a fix's new slide is
# edited, which keeps everything else the client already saw.
REDRAW = "rehacé esa lámina con ese texto."
REEDIT = (
    "editá la imagen nueva con `generate_image(\"el texto «{text}» pasa a "
    "decir «{signed}»\", format=\"feed\", reference=\"{image}\")` y pasame en "
    "`brief` el brief de la lámina con ese texto adentro."
)


def check_slide(number: int, brief: str, closing: bool, image: str | None = None) -> None:
    """The words one slide shows, before anything moves: `vos`, and the
    business's name if it is the closing slide of a carousel. `image` is the
    new picture of a fix, which is what the refusal tells the creator to edit;
    `None` on a new post."""
    words = voseo.slide_words(brief)
    if words:
        raise ModelRetry(
            f"el texto de la lámina {number} habla de tú y el cliente habla de "
            f"vos: {voseo.fixes(words)}. Rehacé esa lámina con el texto de vos. "
            "No guardé nada."
        )
    name = company()
    if closing and name and not signed(brief, name):
        text = " ".join(voseo.quoted(brief)).strip()
        # The name as a sentence of its own: joined with a bare space the wt4
        # fix came out «…al 091 444 550 AQUA Bicicletería» (2026-09-23).
        together = (f"{text} {name}" if not text or text[-1] in ".!?…»"
                    else f"{text}. {name}")
        how = (REDRAW if image is None
               else REEDIT.format(text=text, signed=together, image=image))
        raise ModelRetry(UNSIGNED.format(number=number, name=name, signed=together, how=how))


# THE CAPTION ADDS, IT DOES NOT REPEAT. The skill says so and the model did
# not keep it: our own agent's pricing post (2026-09-26) closed its caption with
# «Guardá estos datos para comparar. tuagente.uy.», the last slide word for
# word, and Luis read a caption that was the carousel again. So a caption
# sentence that IS a slide's sentence is refused. The first line is spared: the
# hook is the post's strongest sentence and is often the cover's. Short
# sentences are spared too — «tuagente.uy», «Escribinos» — because a name or a
# one-word ask repeated is not a caption that repeats the post.
REPEATS_FROM = 4
CAPTION_SENTENCE = re.compile(r"(?<=[.!?…])\s+|\n+")


def said(text: str) -> str:
    """A sentence as words: lowercase, no punctuation, one space."""
    return " ".join(re.sub(r"[^\w\s]", " ", text.lower()).split())


def check_caption(caption: str, briefs: list[str]) -> None:
    slides = set()
    for brief in briefs:
        quoted = voseo.quoted(brief)
        if not quoted:
            continue
        for sentence in CAPTION_SENTENCE.split(max(quoted, key=len)):
            if len(said(sentence).split()) >= REPEATS_FROM:
                slides.add(said(sentence))
    lines = [line for line in caption.splitlines() if line.strip()]
    for line in lines[1:]:
        for sentence in CAPTION_SENTENCE.split(line):
            if said(sentence) in slides:
                raise ModelRetry(
                    f"el pie repite una lámina palabra por palabra: «{sentence.strip()}». "
                    "El pie agrega lo que las láminas no dicen —el contexto, un "
                    "ejemplo, el dato entero—: reescribí esa oración con otras "
                    "palabras o sacala. Las láminas están bien, no las rehagas. "
                    "No guardé nada."
                )


def clean_title(title: str) -> str:
    """The post's name, one short line. The creator writes it — the model
    supplies the words — because a name derived from the slug has lost its
    accents and one derived from the cover is a hook, not a name."""
    title = " ".join(title.split())
    if not title or len(title) > MAX_TITLE:
        raise ModelRetry(
            f"el título tiene {len(title)} caracteres: van de tres a seis "
            f"palabras, hasta {MAX_TITLE} caracteres, como «El horario de los "
            "sábados»"
        )
    return title


def clean_tags(hashtags: list[str]) -> list[str]:
    """The hashtags without their `#`, and never more than Instagram takes.

    The `#` is stripped and not refused: the model writes them the way they
    look on the screen about half the time, and a retry over a character the
    code can take off is a turn spent on nothing.
    """
    tags = [tag.strip().lstrip("#") for tag in hashtags]
    if len(tags) > MAX_HASHTAGS:
        raise ModelRetry(
            f"{len(tags)} hashtags y el máximo es {MAX_HASHTAGS}: Instagram "
            "bajó el tope en diciembre de 2025 y treinta se ve viejo"
        )
    return tags


def check_alts(alts: list[str], images: int) -> list[str]:
    """One description per image, and none of them a paragraph."""
    if len(alts) != images:
        raise ModelRetry(
            f"el posteo tiene {images} imágenes y me pasaste {len(alts)} textos "
            "alternativos: va uno por imagen y en el mismo orden"
        )
    for description in alts:
        if len(description) > MAX_ALT:
            raise ModelRetry(
                f"un texto alternativo tiene {len(description)} caracteres "
                f"y el máximo es {MAX_ALT}: una oración alcanza"
            )
    return alts


def caption_file(caption: str, hashtags: list[str]) -> str:
    """What the client copies into Instagram, in one piece: the caption, a
    blank line, and the hashtags on the last line where they belong."""
    return f"{caption.strip()}\n\n{' '.join('#' + tag for tag in hashtags)}\n"


def flow_of(session_id: str) -> str | None:
    """The flow this run belongs to, or `None` for a conversation.

    NOT a tool argument. Whether the agent is inside a scheduled run is a fact
    the engine already has on the row it claimed, and asking the model for it
    is asking it to remember something it can get wrong in both directions —
    the morning run that forgets to say so, and the chat that claims it.
    """
    row = db.one("SELECT slug FROM flow_runs WHERE session_id = ?", (session_id,))
    return row["slug"] if row else None


SAVE_RETRIES = 4


def toolset() -> FunctionToolset:
    ts = FunctionToolset()

    # FOUR TRIES, NOT ONE. Every refusal below is a ModelRetry the creator can
    # fix without drawing again — a closing slide without the name, an alt too
    # long, a title too short — and pydantic-ai's default of one retry turned
    # two of them in a row into a dead delegation with every slide lost:
    # 2026-09-26, our own agent, twice in one request, ~USD 0.35 of images
    # each time and nothing in Posteos.
    @ts.tool(retries=SAVE_RETRIES)
    def save_post(
        ctx: RunContext,
        slug: str,
        title: str,
        caption: str,
        hashtags: list[str],
        format: Format,
        images: list[str],
        alt: str | None = None,
        alts: list[str] | None = None,
        replace: bool = False,
        look_asked_by_client: bool = False,
        structure: Structure | None = None,
        goal: Goal | None = None,
    ) -> dict:
        """Dejar el posteo del día listo para que el cliente lo revise y lo baje.

        Es la ÚNICA forma de guardar un posteo: no escribas vos las carpetas ni
        los nombres de archivo. Llamala cuando el pie esté escrito y las
        imágenes miradas, y recién después contale al cliente qué dejaste.

        UN CARRUSEL es un posteo de varias imágenes que se pasan de a una:
        pasámelas en `images` EN EL ORDEN EN QUE SE VEN —la primera es el
        gancho, la última es el cierre— y en `alts` un texto alternativo por
        imagen, en ese mismo orden. Las piezas se generan todas como `feed`,
        que es la proporción 4:5 de un carrusel, y acá el formato es
        `carousel`, que es lo que el cliente termina pasando con el dedo.

        El posteo queda con el id `<fecha>-<slug>`. Si ya hay uno de hoy con
        ese mismo slug te frena; `replace=True` lo pisa, y eso sólo lo hacés si
        te lo pidieron. Otro tema, otro slug, otro posteo: en un día entran
        los que el cliente pida.

        Args:
            slug: el tema en dos o tres palabras, en minúsculas y con guiones.
            title: cómo se llama el posteo donde el cliente lo ve —el chat,
                Inicio, Posteos—: de tres a seis palabras, en español con sus
                tildes y mayúscula inicial, como «El horario de los sábados». No
                es el gancho ni la primera línea del pie: es su nombre.
            caption: el pie completo, tal como va a salir, sin los hashtags.
                Si el posteo avisa algo —una fecha, un horario, un precio, un
                lugar—, ese dato va dicho entero también acá.
            hashtags: hasta 5, sin el `#`.
            format: `carousel` para varias imágenes, `feed` para una sola
                vertical, `square` cuadrada, `story` para una historia.
            images: las imágenes ya generadas, por su ruta en el espacio de
                trabajo y en el orden en que se ven.
            alt: qué se ve en la imagen, en una oración, para quien no la ve.
                Es el de una imagen sola; en un carrusel va `alts` en su lugar.
            alts: uno por imagen y en el mismo orden que `images`.
            replace: pisar el posteo de hoy con este slug en vez de frenar.
            structure: la estructura de la historia que elegiste en el paso 3
                del procedimiento. En un carrusel va siempre.
            goal: qué querías que hiciera quien lo lee: `guardar`, `mandar` o
                `escribir`. En un carrusel va siempre.
            look_asked_by_client: `True` sólo si el pedido nombra el look con
                todas las letras («hacelo en `violet`»). Si no, dejalo como está:
                el look lo leo yo de los briefs, y uno que descansa no se guarda.
        """
        if format == "carousel" and not (structure and goal):
            raise ModelRetry(
                "un carrusel es una historia: decime con qué `structure` la armaste "
                "y cuál era el `goal`. Si no lo decidiste, el guion está sin hacer"
            )
        if not SLUG.match(slug):
            raise ModelRetry(
                f"«{slug}» no sirve como slug: minúsculas, números y guiones, "
                f"hasta {MAX_SLUG} caracteres"
            )
        title = clean_title(title)
        caption = clean_caption(caption)
        tags = clean_tags(hashtags)
        if not 1 <= len(images) <= MAX_IMAGES:
            raise ModelRetry(
                f"un posteo lleva entre 1 y {MAX_IMAGES} imágenes, y me pasaste "
                f"{len(images)}"
            )
        # ONE DESCRIPTION PER IMAGE. `alts` is the carousel's way of saying it
        # and `alt` the single image's, and `post.json` keeps both: the list,
        # and its first item as the post's `alt`, which is the field the portal
        # has always read.
        if alts is None and not alt:
            raise ModelRetry(
                "falta el texto alternativo: `alt` si es una sola imagen, "
                "`alts` con uno por imagen si es un carrusel"
            )
        descriptions = check_alts(alts if alts is not None else [alt], len(images))
        sources = [incoming(ctx.deps.workspace, relative) for relative in images]
        # WHAT THE SLIDES SAY, read off their briefs before a file moves. An
        # EDIT is not a slide of a new post: its brief is the change, not the
        # picture, and a post saved with it would carry a slide nobody can fix
        # later. For a picture no client has seen, drawing it again is the fix.
        records = [sidecar(source) for source in sources]
        for relative, record in zip(images, records):
            if record.get("reference"):
                raise ModelRetry(
                    f"{relative} es una edición de otra imagen, y en un posteo "
                    "nuevo cada lámina va con su brief entero: generala de cero "
                    "con el brief completo. No guardé nada."
                )
        for number, record in enumerate(records, 1):
            check_slide(number, record["prompt"],
                        closing=format == "carousel" and number == len(records))
        check_caption(caption, [record["prompt"] for record in records])

        now = datetime.now(ZoneInfo(config.TIMEZONE))
        date = now.strftime("%Y-%m-%d")
        root().mkdir(parents=True, exist_ok=True)
        post_id = f"{date}-{slug}"
        directory = folder(post_id)
        if directory.is_dir() and not replace:
            raise ModelRetry(
                f"ya hay un posteo de hoy con ese slug ({post_id}). Si el "
                "cliente te pidió cambiarlo, llamame con `replace=True`; si es "
                "otro tema, dale otro slug"
            )
        # THE LOOK, READ OFF THE FIRST BRIEF, AND REFUSED IF IT RESTS — here,
        # before a single file moves, so a refusal costs the model a sentence
        # and the client nothing. The post being replaced does not count
        # against itself. A brief that carries no block of the brand's has no
        # look, and that is not refused: a brand with no looks declared is a
        # brand this rule is not about (`looks.py`).
        blocks, _, rest = looks.state([p for p in read_all() if p["id"] != post_id])
        look = looks.of_brief(peek_brief(sources[0]), blocks)
        if look in rest and not look_asked_by_client:
            free = ", ".join(f"`{name}`" for name in blocks if name not in rest)
            raise ModelRetry(
                f"el look `{look}` descansa hoy: lo usaron los últimos posteos. "
                f"Rehacé las láminas con uno de estos: {free}. No guardé nada."
            )
        # THE NEW POST IS BUILT BESIDE THE OLD ONE AND SWAPPED IN AT THE END.
        # Everything that can fail — a sidecar that is not there, a rename —
        # happens while `directory` is still the post the client has, and the
        # swap itself is two renames. What is left behind by a failure is this
        # scratch folder with whatever got moved into it, never a post that was
        # finished. A leftover from an earlier crash is this call's to clear:
        # it is ours, it is named after this post, and nothing reads it.
        staging = root() / f"{BUILDING}{post_id}"
        if staging.is_dir():
            shutil.rmtree(staging)
        staging.mkdir(parents=True)
        names = []
        # THE BRIEF COMES IN WITH THE PICTURE. It is read before the move,
        # while the sidecar is still beside it in `imagenes/`, and the move
        # leaves nothing behind: one copy of the picture and one copy of what
        # it was made from, both inside the post.
        briefs = []
        for number, source in enumerate(sources, 1):
            name = f"{number:02d}{source.suffix.lower()}"
            briefs.append(brief_of(source))
            fit(source, staging / name, format)
            names.append(name)
        data = {
            "id": post_id,
            "slug": slug,
            # What the post is called wherever the owner reads it (`title_of`).
            "title": title,
            "date": date,
            "format": format,
            # What every slide was cut to (`SIZE`), in pixels.
            "size": list(SIZE[format]),
            # Which of the brand's looks it wears, read off the first brief
            # (`looks.py`). `None` for a brand that declares none.
            "look": look,
            # How the story was built and what it was for, as the creator
            # declared them. With the numbers of `recent_performance` next to
            # them, this is what says which kind of post gets saved.
            "structure": structure,
            "goal": goal,
            "caption": caption,
            "alt": descriptions[0],
            "alts": descriptions,
            "hashtags": tags,
            "images": names,
            "prompts": briefs,
            # Nothing has been replaced yet. The key is written from the start
            # so a post's shape does not depend on whether it was ever fixed.
            "versions": {},
            "created_at": now.isoformat(timespec="seconds"),
            "flow": flow_of(ctx.deps.session_id),
        }
        (staging / POST).write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
        (staging / CAPTION).write_text(caption_file(caption, tags))
        # THE SWAP. The old post steps aside under a name the tab does not read,
        # the new one takes its place, and only then is the old one thrown out:
        # at no moment is there no post where the client is looking.
        leaving = root() / f"{BUILDING}{post_id}.anterior"
        if directory.is_dir():
            if leaving.is_dir():
                shutil.rmtree(leaving)
            directory.rename(leaving)
        staging.rename(directory)
        if leaving.is_dir():
            shutil.rmtree(leaving)
        db.append_event(
            "post.saved", f"Dejé listo el posteo «{title_of(data)}»", "completed",
            ctx.deps.session_id, {"id": post_id},
        )
        # `slides` so the report the creator writes says how many the client is
        # going to find, without counting them again from memory.
        return {"saved": post_id, "slides": len(names),
                "url": f"/portal/posts/{post_id}"}

    @ts.tool
    def update_caption(
        ctx: RunContext,
        post_id: str,
        caption: str,
        hashtags: list[str] | None = None,
        alts: list[str] | None = None,
        title: str | None = None,
    ) -> dict:
        """Cambiarle las palabras a un posteo que ya está en Posteos.

        Es la ÚNICA forma de tocarle el texto a un posteo guardado: cambia el
        pie, y si se los pasás los hashtags y los textos alternativos. Las
        imágenes no las toca. **Nunca vuelvas a guardar un posteo para cambiarle
        las palabras**: `save_post` es para uno nuevo, y si le pasás las
        imágenes del posteo que ya está, se pierden.

        El pie va entero, como va a salir: lo que mandes reemplaza lo que
        había. Los hashtags y los textos alternativos, si no los pasás, quedan
        como estaban.

        Un posteo ya publicado no se cambia desde acá: lo que salió, salió.

        Args:
            post_id: el id del posteo, `<fecha>-<tema>`, tal como aparece en
                Posteos.
            caption: el pie nuevo, completo y sin los hashtags.
            hashtags: hasta 5, sin el `#`. Si no los pasás quedan los de antes.
            alts: uno por imagen y en el mismo orden. Si no los pasás quedan
                los de antes.
            title: el nombre nuevo del posteo, sólo si te lo pidieron. Si no
                lo pasás queda el de antes.
        """
        directory = folder(post_id)
        path = directory / POST
        if not path.is_file():
            raise ModelRetry(
                f"no hay ningún posteo «{post_id}»: el id es la fecha y el "
                "tema, mirá el que vino en el pedido"
            )
        data = json.loads(path.read_text())
        # WHAT WENT OUT DOES NOT GET REWRITTEN. The permalink is in the message
        # because it is the fact that settles it: the caption on Instagram is
        # the one the client's followers are reading, and `post.json` saying
        # something else would make the tab lie about what is published.
        published = data.get("published")
        if published:
            raise ModelRetry(
                f"el posteo «{post_id}» ya está publicado: "
                f"{published['permalink']}. Lo que ya salió no se cambia desde "
                "acá; si el cliente quiere otra cosa, es otro posteo"
            )
        data["caption"] = clean_caption(caption)
        if title is not None:
            data["title"] = clean_title(title)
        if hashtags is not None:
            data["hashtags"] = clean_tags(hashtags)
        if alts is not None:
            data["alts"] = check_alts(alts, len(data["images"]))
            # `alt` is the post's own description and it is the first slide's,
            # which is the field the portal's `Post` reads.
            data["alt"] = data["alts"][0]
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
        # `caption.md` is what the client copies into Instagram by hand, so it
        # is rewritten from the same two fields every time: one of the two
        # saying something the other does not is the bug this tool exists to
        # stop making by hand.
        (directory / CAPTION).write_text(
            caption_file(data["caption"], data["hashtags"])
        )
        db.append_event(
            "post.updated", f"Cambié el texto del posteo «{title_of(data)}»", "completed",
            ctx.deps.session_id, {"id": post_id},
        )
        return {"id": post_id, "slides": len(data["images"]),
                "url": f"/portal/posts/{post_id}"}

    @ts.tool
    def view_slide(ctx: RunContext, post_id: str, number: int) -> list:
        """Ver una lámina de un posteo guardado, tal como está ahora.

        Te devuelvo la imagen y la ves. Usala antes de arreglar una lámina:
        lo que el cliente dice que está mal —el texto cortado, un dibujo raro,
        un fondo que no le gusta— lo ves acá, y el brief sólo te dice lo que
        se pidió, no lo que salió. Si el pedido habla de las otras láminas
        («que sea distinta a las demás», «que siga a la anterior»), mirá
        también esas.

        Args:
            post_id: el id del posteo, como `2026-09-21-tema`.
            number: qué lámina, contando desde 1.
        """
        data = read(post_id)
        if data is None:
            raise ModelRetry(
                f"no hay ningún posteo «{post_id}»: el id es la fecha y el "
                "tema, mirá el que vino en el pedido"
            )
        names = [image["name"] for image in data["images"]]
        if not 1 <= number <= len(names):
            raise ModelRetry(
                f"el posteo «{post_id}» tiene {len(names)} láminas y me pediste "
                f"la {number}"
            )
        path = folder(post_id) / names[number - 1]
        # The same two things `generate_image` hands back: the line the model
        # can quote, and the picture itself, which Pydantic AI puts in front of
        # the model as an image. Without this the creator fixed slides it had
        # never seen, from the brief and the client's words alone.
        # And it is the slide AS POSTED: cut to Instagram's frame (`fit`), not
        # the taller picture `generate_image` handed over. What the client
        # says is cut off is cut off here.
        return [
            f"La lámina {number} de {len(names)} de «{post_id}», tal como está "
            "ahora y como sale en Instagram.",
            BinaryImage(path.read_bytes(), media_type=TYPES[path.suffix.lower()]),
        ]

    @ts.tool
    def replace_slide(
        ctx: RunContext,
        post_id: str,
        number: int,
        image: str,
        reason: str,
        alt: str | None = None,
        brief: str | None = None,
    ) -> dict:
        """Cambiar UNA sola lámina de un posteo que ya está guardado.

        Es la única forma de arreglar una imagen sin rehacer el posteo: cambia
        esa lámina y no toca ninguna otra, ni el pie, ni los hashtags. Llamala
        recién cuando generaste la imagen nueva y la miraste.

        Las láminas se cuentan como las pasa el cliente: la 1 es el gancho y la
        última es el cierre. Se puede arreglar cualquier posteo, no sólo el de
        hoy.

        No se pierde nada: la imagen que estaba queda guardada con su brief, su
        texto alternativo y el motivo, y el cliente la sigue viendo en Posteos.
        Elegir cuál de las dos le gusta más es de él, no tuyo.

        El brief de esa lámina queda reemplazado por el de la imagen nueva, así
        que generala a partir del que está guardado en el posteo y cambiá sólo
        lo que el pedido dice: el resto, palabra por palabra, es lo que mantiene
        el carrusel parejo.

        Si la imagen nueva es una EDICIÓN de la que estaba
        (`generate_image(..., reference=…)`), lo que le pediste a esa edición
        es sólo el cambio: en `brief` pasame el brief entero de la lámina tal
        como queda, el que estaba con el cambio adentro.

        Args:
            post_id: el id del posteo, `<fecha>-<slug>`, tal como viene en el
                pedido.
            number: qué lámina cambiás, contando desde 1.
            image: la imagen nueva, por su ruta en el espacio de trabajo: la
                que te devolvió `generate_image`.
            reason: qué estaba mal, con las palabras del cliente tal como te
                llegaron en el pedido. Es lo que va a leer al lado de la
                imagen vieja.
            alt: el texto alternativo nuevo, si cambió lo que se ve. Si no lo
                pasás queda el que ya tenía.
            brief: sólo si la imagen es una edición: el brief entero de la
                lámina, como queda después del cambio.
        """
        directory = folder(post_id)
        path = directory / POST
        if not path.is_file():
            raise ModelRetry(
                f"no hay ningún posteo «{post_id}»: el id es la fecha y el "
                "tema, mirá el que vino en el pedido"
            )
        data = json.loads(path.read_text())
        names = data["images"]
        if not 1 <= number <= len(names):
            raise ModelRetry(
                f"el posteo «{post_id}» tiene {len(names)} láminas y me pediste "
                f"la {number}"
            )
        if alt and len(alt) > MAX_ALT:
            raise ModelRetry(
                f"un texto alternativo tiene {len(alt)} caracteres y el máximo "
                f"es {MAX_ALT}: una oración alcanza"
            )
        source = incoming(ctx.deps.workspace, image)
        # AN EDIT'S SIDECAR CARRIES THE CHANGE, NOT THE PICTURE. A text-only
        # fix is an edit of the slide that was there (`generate_image`'s
        # `reference`), and its prompt is «el texto X pasa a decir Y». Filed as
        # the slide's brief it would leave the next fix nothing to start from,
        # so the whole brief comes from the creator — the old one with the
        # change in it, which it has in hand — and without it this refuses.
        record = sidecar(source)
        if record.get("reference"):
            if not brief:
                raise ModelRetry(
                    "esa imagen es una edición de "
                    f"{record['reference']}: pasame en `brief` el brief entero "
                    "de la lámina como queda, el que estaba con el cambio "
                    "adentro. No cambié nada."
                )
        else:
            brief = record["prompt"]
        check_slide(number, brief, closing=data["format"] == "carousel"
                    and number == len(names), image=image)
        brief_of(source)
        old = names[number - 1]
        # A POST FROM BEFORE BRIEFS WERE KEPT has no `prompts`: its slides were
        # made from briefs nobody wrote down. Their place is `None`, and the
        # new slide's brief fills its own. Read HERE, before any file moves:
        # the first version read it after the rename, and on the lab a fix of
        # such a post died on the missing key with the old slide already
        # moved out and the new one not yet in — a post with a hole in it
        # (2026-09-21).
        prompts = data.setdefault("prompts", [None] * len(names))
        # THE SLIDE THAT WAS THERE IS KEPT, and with everything that made it:
        # its brief, its alt and the client's own words about what was wrong.
        # The history is popped under the OLD name and put back under the new
        # one, so a fix that comes back as a different type does not leave the
        # earlier versions filed under a name the post no longer has.
        history = data.setdefault("versions", {}).pop(old, [])
        kept = f"{number:02d}-{len(history) + 1}{Path(old).suffix}"
        history.append({
            "file": f"{PREVIOUS}/{kept}",
            "prompt": prompts[number - 1],
            "alt": data["alts"][number - 1],
            "reason": reason,
            "replaced_at": datetime.now(ZoneInfo(config.TIMEZONE)).isoformat(
                timespec="seconds"
            ),
        })
        (directory / PREVIOUS).mkdir(exist_ok=True)
        (directory / old).rename(directory / PREVIOUS / kept)
        # THE NUMBER IS THE POSITION AND THE SUFFIX IS THE NEW PICTURE'S: a
        # slide that comes back as a different type takes its own extension,
        # and the post would otherwise list `02.png` with `02.webp` beside it.
        name = f"{number:02d}{source.suffix.lower()}"
        # Cut to the post's shape like every slide of it, so a fix is never
        # the one slide of a carousel that comes out taller.
        fit(source, directory / name, data["format"])
        names[number - 1] = name
        data["versions"][name] = history
        prompts[number - 1] = brief
        if alt:
            data["alts"][number - 1] = alt
            # `alt` is the post's own description and it is the first slide's,
            # which is the field the portal's `Post` reads.
            data["alt"] = data["alts"][0]
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
        db.append_event(
            "post.slide_replaced",
            f"Cambié la lámina {number} del posteo «{title_of(data)}»",
            "completed", ctx.deps.session_id, {"id": post_id, "slide": number},
        )
        # `previous_kept` so the report can say the old one is still there,
        # which is the half of this the client has to hear to stop being afraid
        # of asking. A fact and not a path: the path was a file name, and the
        # creator put it in its report (QA, 2026-09-23).
        return {"id": post_id, "slide": number, "previous_kept": True,
                "slides": len(names), "url": f"/portal/posts/{post_id}"}

    return ts


# ── the Posts tab ───────────────────────────────────────────────────────────

router = APIRouter()


@router.get("/portal/posts")
def listing():
    return {"available": True, "posts": read_all(), "account": account()}


# ── whose account the tab draws the posts on ────────────────────────────────
#
# THE CARD IS DRAWN AS THE FEED THE POST IS GOING INTO, and the feed's header is
# the ACCOUNT's: its handle and its picture. The tab used to make both up — the
# company's name lowercased into a handle («aquabicicleteria», an account that
# does not exist) and the agent's own face as the avatar — and QA read the
# preview as somebody else's Instagram (2026-09-23). What is known, in order:
#
# - the account the `instagram` plugin is connected to, whose username it read
#   from `/me` (`ig_store.username`). Optional: bound in `plugin.py` from
#   `engine.use("instagram.username", default=None)`, `None` without it.
# - the handle the business draft found on the business's own pages, in the
#   section the `business` plugin writes it under: an `instagram.com/<x>` link
#   first — a link is the account itself — and then a lone `@handle`.
# - nothing, and the tab shows the business's name without an @.
#
# And the picture is the brand's logo when `marca/` has one — a file whose name
# says `logo`, the way `place_image`'s assets are named — and otherwise the tab
# draws the name's initial. Never the agent's face: the agent does not post.
USERNAME = None

# The business plugin's draft and the heading its channels go under
# (`business_draft.SECTIONS`), named here as a workspace convention and not
# imported: that plugin is not a dependency of this one.
DRAFT = "negocio/borrador.md"
CHANNELS = "## Por dónde te encuentran"
PROFILE = re.compile(r"instagram\.com/([A-Za-z0-9._]{1,30})")
# Not after a letter, a dot or another @: «info@negocio.uy» is a mail.
HANDLE = re.compile(r"(?<![\w.@])@([A-Za-z0-9._]{1,30})")
# Instagram paths that are not an account.
NOT_ACCOUNTS = {"p", "reel", "reels", "explore", "stories", "tv"}
BRAND = "marca"
LOGO = "logo"


def draft_handle() -> str | None:
    """The Instagram handle the draft lists among the business's channels."""
    path = config.WORKSPACE / DRAFT
    text = path.read_text() if path.is_file() else ""
    if CHANNELS not in text:
        return None
    channels = text.split(CHANNELS, 1)[1].split("\n## ", 1)[0]
    # A handle never ends in a dot, and a sentence that ends on one does.
    linked = [m.group(1).rstrip(".") for m in PROFILE.finditer(channels)]
    linked = [name for name in linked if name.lower() not in NOT_ACCOUNTS]
    if linked:
        return linked[0]
    found = HANDLE.search(channels)
    return found.group(1).rstrip(".") if found else None


def logo() -> str | None:
    """The brand's logo in `marca/`, by file name, or `None`."""
    brand = config.WORKSPACE / BRAND
    if not brand.is_dir():
        return None
    found = sorted(
        path.name for path in brand.iterdir()
        if path.is_file() and path.suffix.lower() in TYPES and LOGO in path.stem.casefold()
    )
    return found[0] if found else None


def account() -> dict:
    """`{handle, name, avatar_url}`: whose feed the tab draws. `handle` has no
    @ and is `None` when nothing knows it; `avatar_url` is relative to the
    adapter and needs the bearer, like every picture the tab draws."""
    handle = (USERNAME() if USERNAME else None) or draft_handle()
    mark = logo()
    return {
        "handle": handle,
        "name": company(),
        "avatar_url": f"/portal/posts/brand/{mark}" if mark else None,
    }


# BEFORE `/portal/posts/{post_id}/{name:path}`, which would otherwise take
# «brand» for a post id: a route is matched in the order it was added. A post
# id is always `<YYYY-MM-DD>-<slug>`, so no post is ever called «brand».
@router.get("/portal/posts/brand/{name}")
def brand_picture(name: str):
    """The logo's bytes. The allowlist is `logo()` itself: any other name is a
    404, whatever it is made of."""
    if name != logo():
        raise HTTPException(404, NO_LOGO.format(name=name))
    path = config.WORKSPACE / BRAND / name
    return Response(path.read_bytes(), media_type=TYPES[path.suffix.lower()],
                    headers={"Content-Disposition": f'inline; filename="{name}"'})


# How long the label of a post is, on a flow's page: the hook, cut.
LABEL = 80


def results(slug: str) -> list[dict]:
    """The posts a flow's runs saved, as a flow's results
    (`flow.results.posts`, `engine/core/plugins.py`'s `flow_results`).

    `flow` is on `post.json` because `save_post` wrote it from the run's own
    row (`flow_of`), so this is what the flow MADE, not a guess from a name.
    The path is the first slide — what the Files viewer opens as the post —
    or the caption when a post has no picture, and the label is the caption's
    first line, because `01.png` says nothing about which post it is.
    """
    found = []
    for data in read_all():
        if data.get("flow") != slug:
            continue
        piece = data["images"][0]["name"] if data["images"] else CAPTION
        found.append({
            "path": f"{WHERE}/{data['id']}/{piece}",
            "mtime": (folder(data["id"]) / POST).stat().st_mtime,
            "label": title_of(data),
        })
    return found


def title_of(data: dict) -> str:
    """What a post is called where the owner reads it: its `title`, which the
    creator gives in `save_post`. Never the id — `2026-09-23-pan-masa-madre`
    is a folder name — and never the slug, which is the same thing with the
    date off and the accents gone: QA read «Sabados octubre» in the chat, in
    Inicio and in Posteos (2026-09-23).

    A post saved before `title` existed is still on disk and has none; it is
    called by its caption's first line, cut, which is what every post was
    called until then."""
    if data.get("title"):
        return data["title"]
    caption = data["caption"].strip()
    hook = caption.splitlines()[0] if caption else data["slug"].replace("-", " ")
    return hook if len(hook) <= LABEL else hook[: LABEL - 1].rstrip() + "…"


@router.get("/portal/posts/{post_id}")
def detail(post_id: str):
    found = read(post_id)
    if found is None:
        raise HTTPException(404, NO_POST.format(post_id=post_id))
    return found


@router.get("/portal/posts/{post_id}/{name:path}")
def piece(post_id: str, name: str):
    """The bytes of one image, with the type that makes it open.

    Here and not through `/portal/files/<path>` because the allowlist is the
    post's own listing: a name that is not in `images` or `versions` is a 404.
    The portal fetches this with the bearer header and makes an object URL out
    of the answer, so the client's key never travels in a query string.
    """
    path = image_path(post_id, name)
    if path is None:
        raise HTTPException(404, NO_IMAGE.format(post_id=post_id, name=name))
    # `inline` and not `attachment`: the tab draws the picture, and the
    # download is a link the portal builds from the same bytes.
    return Response(
        path.read_bytes(),
        media_type=TYPES[path.suffix.lower()],
        headers={"Content-Disposition": f'inline; filename="{name}"'},
    )
