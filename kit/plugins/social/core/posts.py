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


def brief_of(image: Path) -> str:
    """What the picture was made from, and the sidecar taken out of `imagenes/`.

    NO FALLBACK. A picture with no brief beside it did not come out of
    `generate_image`, and saving it would leave a slide nobody can fix later:
    the post would look finished and «arreglá la slide 2» would have nothing to
    start from. It breaks here, where the model reads the traceback, instead of
    a week from now in front of the client.
    """
    sidecar = image.with_suffix(BRIEF)
    prompt = json.loads(sidecar.read_text())["prompt"]
    sidecar.unlink()
    return prompt


def clean_caption(caption: str) -> str:
    """The caption as it is stored: the trailing hashtag block off, trimmed,
    and refused if it does not fit in Instagram. Shared by the tool that writes
    a post and the one that rewrites its words, so the two cannot drift."""
    caption = HASHTAG_LINES.sub("", caption).strip()
    if len(caption) > MAX_CAPTION:
        raise ModelRetry(
            f"el pie tiene {len(caption)} caracteres y en Instagram entran "
            f"{MAX_CAPTION}: cortalo"
        )
    return caption


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
            source.rename(staging / name)
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
            "post.saved", f"Dejé listo el posteo «{slug}»", "completed",
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
            "post.updated", f"Cambié el pie de «{post_id}»", "completed",
            ctx.deps.session_id, {"id": post_id},
        )
        return {"id": post_id, "slides": len(data["images"]),
                "url": f"/portal/posts/{post_id}"}

    @ts.tool
    def replace_slide(
        ctx: RunContext,
        post_id: str,
        number: int,
        image: str,
        reason: str,
        alt: str | None = None,
    ) -> dict:
        """Cambiar UNA sola slide de un posteo que ya está guardado.

        Es la única forma de arreglar una imagen sin rehacer el posteo: cambia
        esa slide y no toca ninguna otra, ni el pie, ni los hashtags. Llamala
        recién cuando generaste la imagen nueva y la miraste.

        Las slides se cuentan como las pasa el cliente: la 1 es el gancho y la
        última es el cierre. Se puede arreglar cualquier posteo, no sólo el de
        hoy.

        No se pierde nada: la imagen que estaba queda guardada con su brief, su
        texto alternativo y el motivo, y el cliente la sigue viendo en Posteos.
        Elegir cuál de las dos le gusta más es de él, no tuyo.

        El brief de esa slide queda reemplazado por el de la imagen nueva, así
        que generala a partir del que está guardado en el posteo y cambiá sólo
        lo que el pedido dice: el resto, palabra por palabra, es lo que mantiene
        el carrusel parejo.

        Args:
            post_id: el id del posteo, `<fecha>-<slug>`, tal como viene en el
                pedido.
            number: qué slide cambiás, contando desde 1.
            image: la imagen nueva, por su ruta en el espacio de trabajo: la
                que te devolvió `generate_image`.
            reason: qué estaba mal, con las palabras del cliente tal como te
                llegaron en el pedido. Es lo que va a leer al lado de la
                imagen vieja.
            alt: el texto alternativo nuevo, si cambió lo que se ve. Si no lo
                pasás queda el que ya tenía.
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
                f"el posteo «{post_id}» tiene {len(names)} slides y me pediste "
                f"la {number}"
            )
        if alt and len(alt) > MAX_ALT:
            raise ModelRetry(
                f"un texto alternativo tiene {len(alt)} caracteres y el máximo "
                f"es {MAX_ALT}: una oración alcanza"
            )
        source = incoming(ctx.deps.workspace, image)
        brief = brief_of(source)
        old = names[number - 1]
        # THE SLIDE THAT WAS THERE IS KEPT, and with everything that made it:
        # its brief, its alt and the client's own words about what was wrong.
        # The history is popped under the OLD name and put back under the new
        # one, so a fix that comes back as a different type does not leave the
        # earlier versions filed under a name the post no longer has.
        history = data.setdefault("versions", {}).pop(old, [])
        kept = f"{number:02d}-{len(history) + 1}{Path(old).suffix}"
        (directory / PREVIOUS).mkdir(exist_ok=True)
        (directory / old).rename(directory / PREVIOUS / kept)
        history.append({
            "file": f"{PREVIOUS}/{kept}",
            "prompt": data["prompts"][number - 1],
            "alt": data["alts"][number - 1],
            "reason": reason,
            "replaced_at": datetime.now(ZoneInfo(config.TIMEZONE)).isoformat(
                timespec="seconds"
            ),
        })
        # THE NUMBER IS THE POSITION AND THE SUFFIX IS THE NEW PICTURE'S: a
        # slide that comes back as a different type takes its own extension,
        # and the post would otherwise list `02.png` with `02.webp` beside it.
        name = f"{number:02d}{source.suffix.lower()}"
        source.rename(directory / name)
        names[number - 1] = name
        data["versions"][name] = history
        data["prompts"][number - 1] = brief
        if alt:
            data["alts"][number - 1] = alt
            # `alt` is the post's own description and it is the first slide's,
            # which is the field the portal's `Post` reads.
            data["alt"] = data["alts"][0]
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
        db.append_event(
            "post.slide_replaced", f"Cambié la slide {number} de «{post_id}»",
            "completed", ctx.deps.session_id, {"id": post_id, "slide": number},
        )
        # `kept` so the report can say the old one is still there, which is the
        # half of this the client has to hear to stop being afraid of asking.
        return {"id": post_id, "slide": number, "file": name, "kept": history[-1]["file"],
                "slides": len(names), "url": f"/portal/posts/{post_id}"}

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


@router.get("/portal/posts/{post_id}/{name:path}")
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
