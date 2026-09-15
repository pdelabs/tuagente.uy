"""The post: the folder `save_post` writes, and the three routes that read it.

    <workspace>/posteos/<YYYY-MM-DD>-<slug>/
        post.json     the whole post; it is also what the route answers
        caption.md    the caption, a blank line, the hashtags on one line
        01.png …      the slides, in the order they are flipped through

THE DAY'S POST IS A CAROUSEL: several slides, `01.png` the hook and the last
one the close, and `alts` carries one description per slide in that same
order. `alt` stays what it was — the post's own description — and it is the
FIRST slide's, because that is the field the portal's `Post` reads.

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
"""

import json
import re
import shutil
from datetime import datetime
from pathlib import Path
from typing import Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic_ai import ModelRetry, RunContext
from pydantic_ai.toolsets import FunctionToolset

from core import config, db
from core.tools.workspace import under

WHERE = "posteos"
POST = "post.json"
CAPTION = "caption.md"

# Lowercase, hyphens, short: it is half a directory name and the whole of the
# post's id, and the id travels into the portal's URLs.
MAX_SLUG = 40
SLUG = re.compile(rf"^[a-z0-9][a-z0-9-]{{0,{MAX_SLUG - 1}}}$")

# Instagram's own caps, checked 2026-09-14. The hashtag one moved in December
# 2025 (30 -> 5) and is the number the old skill got wrong for months.
MAX_CAPTION = 2200
MAX_ALT = 1000
MAX_HASHTAGS = 5
MAX_IMAGES = 10

# What the route serves a piece as. `generate_image` only ever writes PNG; the
# other two are here because a client's own picture can land in the workspace
# and be used, and a downloaded file with the wrong type is a file that does
# not open.
TYPES = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
         ".webp": "image/webp"}

# THE FORMAT OF A POST IS NOT THE FORMAT OF A PIECE, and that is why
# `carousel` is here and NOT in the image plugin's `RATIO`. A carousel's slides
# are 4:5, exactly what `feed` already asks for, so a fourth ratio would be the
# same geometry under a second name — a new key, a new `Literal` and a new line
# of docstring in another plugin, for nothing. The skill tells the creator to
# generate every slide as `feed`, this word says what the client ends up
# flipping through, and the image plugin's vocabulary stays the three shapes a
# picture is ever cut to.
Format = Literal["feed", "square", "story", "carousel"]

# Read by the client: the portal shows `error.message` on the tab she is on.
NO_POST = "No hay ningún posteo {post_id} en este agente."
NO_IMAGE = "El posteo {post_id} no tiene ninguna imagen {name}."

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

    Everything else of the file travels as it was written, `alts` included:
    one description per image and in the same order as `images`.
    """
    directory = folder(data["id"])
    return data | {
        "images": [
            {
                "name": name,
                "bytes": (directory / name).stat().st_size,
                "url": f"/portal/posts/{data['id']}/{name}",
            }
            for name in data["images"]
        ]
    }


def read(post_id: str) -> dict | None:
    path = folder(post_id) / POST
    return expand(json.loads(path.read_text())) if path.is_file() else None


def read_all() -> list[dict]:
    """Every post, newest first. The day decides, and `created_at` breaks the
    tie for the day a post was replaced."""
    found = [json.loads(path.read_text()) for path in root().glob(f"*/{POST}")]
    found.sort(key=lambda p: (p["date"], p["created_at"]), reverse=True)
    return [expand(p) for p in found]


def image_path(post_id: str, name: str) -> Path | None:
    """The bytes of one piece, and only of a piece the post lists.

    The listing is the allowlist, so there is no path to sanitize: a name that
    is not in `images` is a 404 whatever it is made of.
    """
    data = read(post_id)
    if data is None or name not in [image["name"] for image in data["images"]]:
        return None
    return folder(post_id) / name


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


def toolset() -> FunctionToolset:
    ts = FunctionToolset()

    @ts.tool
    def save_post(
        ctx: RunContext,
        slug: str,
        caption: str,
        hashtags: list[str],
        format: Format,
        images: list[str],
        alt: str | None = None,
        alts: list[str] | None = None,
        replace: bool = False,
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
            caption: el pie completo, tal como va a salir, sin los hashtags.
            hashtags: hasta 5, sin el `#`.
            format: `carousel` para varias imágenes, `feed` para una sola
                vertical, `square` cuadrada, `story` para una historia.
            images: las imágenes ya generadas, por su ruta en el espacio de
                trabajo y en el orden en que se ven.
            alt: qué se ve en la imagen, en una oración, para quien no la ve.
                Es el de una imagen sola; en un carrusel va `alts` en su lugar.
            alts: uno por imagen y en el mismo orden que `images`.
            replace: pisar el posteo de hoy con este slug en vez de frenar.
        """
        if not SLUG.match(slug):
            raise ModelRetry(
                f"«{slug}» no sirve como slug: minúsculas, números y guiones, "
                f"hasta {MAX_SLUG} caracteres"
            )
        caption = HASHTAG_LINES.sub("", caption).strip()
        if len(caption) > MAX_CAPTION:
            raise ModelRetry(
                f"el pie tiene {len(caption)} caracteres y en Instagram entran "
                f"{MAX_CAPTION}: cortalo"
            )
        # The `#` is stripped and not refused: the model writes the hashtags
        # the way they look on the screen about half the time, and a retry over
        # a character the code can take off is a turn spent on nothing.
        tags = [tag.strip().lstrip("#") for tag in hashtags]
        if len(tags) > MAX_HASHTAGS:
            raise ModelRetry(
                f"{len(tags)} hashtags y el máximo es {MAX_HASHTAGS}: Instagram "
                "bajó el tope en diciembre de 2025 y treinta se ve viejo"
            )
        if not 1 <= len(images) <= MAX_IMAGES:
            raise ModelRetry(
                f"un posteo lleva entre 1 y {MAX_IMAGES} imágenes, y me pasaste "
                f"{len(images)}"
            )
        # ONE DESCRIPTION PER IMAGE. `alts` is the carousel's way of saying it
        # and `alt` the single image's, and `post.json` keeps both: the list,
        # and its first item as the post's `alt`, which is the field the portal
        # has always read.
        if alts is not None and len(alts) != len(images):
            raise ModelRetry(
                f"me pasaste {len(images)} imágenes y {len(alts)} textos "
                "alternativos: va uno por imagen y en el mismo orden"
            )
        if alts is None and not alt:
            raise ModelRetry(
                "falta el texto alternativo: `alt` si es una sola imagen, "
                "`alts` con uno por imagen si es un carrusel"
            )
        descriptions = alts if alts is not None else [alt]
        for description in descriptions:
            if len(description) > MAX_ALT:
                raise ModelRetry(
                    f"un texto alternativo tiene {len(description)} caracteres "
                    f"y el máximo es {MAX_ALT}: una oración alcanza"
                )
        sources = []
        for relative in images:
            try:
                path = under(ctx.deps.workspace, relative)
            except ValueError:
                raise ModelRetry(
                    f"{relative} está fuera del espacio de trabajo"
                ) from None
            if not path.is_file():
                raise ModelRetry(
                    f"no encuentro {relative}: pasame la ruta que te devolvió "
                    "`generate_image`"
                )
            # The route answers the type off the extension, so a file it has no
            # type for would be a 500 on the tab instead of a picture. The
            # format is this tool's business, which is why it is caught here.
            if path.suffix.lower() not in TYPES:
                raise ModelRetry(
                    f"{relative} no es una imagen que el portal pueda mostrar: "
                    f"{', '.join(sorted(TYPES))}"
                )
            sources.append(path)

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
        if directory.is_dir():
            shutil.rmtree(directory)
        directory.mkdir(parents=True)
        names = []
        for number, source in enumerate(sources, 1):
            name = f"{number:02d}{source.suffix.lower()}"
            source.rename(directory / name)
            names.append(name)
        data = {
            "id": post_id,
            "slug": slug,
            "date": date,
            "format": format,
            "caption": caption,
            "alt": descriptions[0],
            "alts": descriptions,
            "hashtags": tags,
            "images": names,
            "created_at": now.isoformat(timespec="seconds"),
            "flow": flow_of(ctx.deps.session_id),
        }
        (directory / POST).write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
        (directory / CAPTION).write_text(caption_file(caption, tags))
        db.append_event(
            "post.saved", f"Dejé listo el posteo «{slug}»", "completed",
            ctx.deps.session_id, {"id": post_id},
        )
        # `slides` so the report the creator writes says how many the client is
        # going to find, without counting them again from memory.
        return {"saved": post_id, "slides": len(names),
                "url": f"/portal/posts/{post_id}"}

    return ts


# ── the Posts tab ───────────────────────────────────────────────────────────

router = APIRouter()


@router.get("/portal/posts")
def listing():
    return {"available": True, "posts": read_all()}


@router.get("/portal/posts/{post_id}")
def detail(post_id: str):
    found = read(post_id)
    if found is None:
        raise HTTPException(404, NO_POST.format(post_id=post_id))
    return found


@router.get("/portal/posts/{post_id}/{name}")
def piece(post_id: str, name: str):
    """The bytes of one image, with the type that makes it open.

    NOT `/portal/files/<path>`, which answers `text/plain` for everything it
    has — a PNG through that route arrives as mojibake. The portal fetches this
    with the bearer header and makes an object URL out of the answer, so the
    client's key never travels in a query string.
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
