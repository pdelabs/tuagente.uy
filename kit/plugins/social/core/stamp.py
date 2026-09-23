"""`place_image`: the brand's own pictures onto a slide, put there by CODE.

WHY THIS EXISTS AT ALL. A character, a logo, a mark — anything the client
already owns — is the one thing an image model cannot be asked for: told to
draw Mr. Wobbles it draws a different animal every time, and told to put «the
logo in the corner» it invents letters. That is why the brand block in
`marca/brand.md` forbids characters and logos in a brief, and it is why this
tool exists: the slide is generated WITHOUT the asset, and the asset is pasted
in afterwards from the file the client gave us. The model supplies the words;
the code supplies the format — a picture that has to be itself is format.

WHERE THE ASSETS LIVE: `<workspace>/marca/`, next to `brand.md`, because they
are the brand and the client can see and replace them from Files. The listing
of that folder IS the allowlist — a name that is not a file in it comes back as
a `ModelRetry` with the names that are — so there is no path to sanitize and
`marca/../../etc/passwd` is just a name nobody has.

IT WRITES A NEW PICTURE AND KEEPS THE OLD ONE. The stamped slide is the next
number in `imagenes/`, with its own sidecar: the original's brief plus one line
saying what was placed and where, `model` «place_image» so nobody reads it as
something the model drew. The bare slide stays where it was, because choosing
between the two is the creator's (it looks at both) and then the client's — and
because `save_post` moves whichever one is chosen, taking its brief with it.

THE MODULE IS NAMED `stamp` AND NOT `image`, `assets` OR `compose`. A plugin's
surface modules import each other by plain name and share one `sys.modules`
namespace with every other enabled plugin's (`posts.py`'s docstring has the
measured story), so a second module called like somebody else's is a silent
swap of one file for another. This name is used once in the whole kit.
"""

import json
from datetime import datetime
from pathlib import Path
from typing import Literal
from zoneinfo import ZoneInfo

import posts
from PIL import Image, ImageOps
from pydantic_ai import ModelRetry, RunContext
from pydantic_ai.messages import BinaryImage
from pydantic_ai.toolsets import FunctionToolset

from core import config

# Where the generated slides are, and where the stamped one lands: the same
# scratch folder, because a stamped slide is one more picture to look at and
# `save_post` takes it from there like any other.
WHERE = config.WORKSPACE / "imagenes"

# The brand's fixed pictures. Spanish, like the rest of the workspace: the
# client opens this folder in Files.
ASSETS = config.WORKSPACE / "marca"

# The sidecar's suffix, the image plugin's convention (`BRIEF` there, and the
# same word in `posts.py`): a picture and its brief differ only in this.
BRIEF = ".json"

# What a stamped slide is written as. Always PNG: the composite carries the
# asset's transparency, and PNG is what the generator writes and what the tab
# serves. The line in the sidecar is what says it was not drawn.
OUT = ".png"
TYPE = "image/png"

Corner = Literal["bottom-right", "bottom-left", "top-right", "top-left", "center", "top", "bottom"]

# What goes into the stamped slide's brief, under the original's. It is read
# back by `replace_slide`'s procedure — the creator starts a fix from the
# stored brief — so it has to say, in the brief's own language, that the asset
# is not something the model drew.
PLACED = "[place_image: {asset} at {corner}, size {size}]"


def assets() -> list[str]:
    """The brand's pictures, by name. `brand.md` is not one of them: the filter
    is the same table the tab can draw, which is also what `save_post` takes."""
    if not ASSETS.is_dir():
        return []
    return sorted(
        path.name for path in ASSETS.glob("*")
        if path.is_file() and path.suffix.lower() in posts.TYPES
    )


def next_path() -> Path:
    """`<workspace>/imagenes/<YYYY-MM-DD>-<n>.png`, counting up within the day.

    The same convention `generate_image` writes under, and deliberately NOT an
    import of it: the image plugin and this one share a module namespace and
    nothing else. The highest number taken and not the number of files, so a
    picture the client deleted does not put the next one on top of one they
    kept — and the sidecar shares the stem, so it counts as the same number.
    """
    WHERE.mkdir(parents=True, exist_ok=True)
    today = datetime.now(ZoneInfo(config.TIMEZONE)).strftime("%Y-%m-%d")
    taken = [int(path.stem.rsplit("-", 1)[1]) for path in WHERE.glob(f"{today}-*")]
    return WHERE / f"{today}-{max(taken, default=0) + 1}{OUT}"


def toolset() -> FunctionToolset:
    ts = FunctionToolset()

    @ts.tool
    def place_image(
        ctx: RunContext,
        image: str,
        asset: str,
        corner: Corner,
        size: float = 0.28,
        margin: float = 0.06,
    ) -> list:
        """Pegar sobre una slide una imagen fija de la marca y devolvértela para
        que la veas.

        Es para las imágenes que la marca ya tiene y que son siempre las mismas:
        el personaje de la marca, su logo. **Es la ÚNICA forma de que una de esas entre en
        una slide**: en el brief nunca las pidas: el modelo dibuja un personaje
        distinto cada vez y escribe mal el logo. La slide se genera sin eso, y
        acá se le pega el archivo que nos dio el cliente.

        Las imágenes que hay están en `marca/`. Te devuelvo una imagen NUEVA,
        aparte: la slide sin la marca queda igual donde estaba, así que
        guardás la que te guste más de las dos.

        Args:
            image: la slide ya generada, por su ruta en el espacio de trabajo:
                la que te devolvió `generate_image`.
            asset: el nombre del archivo en `marca/`, tal como lo nombra el
                archivo de marca.
            corner: dónde va: una esquina (`bottom-right`, `bottom-left`,
                `top-right`, `top-left`), o centrado horizontalmente en
                `center` (el medio de la slide), `top` o `bottom`. Centrado es
                para cuando el personaje es el protagonista y el texto va
                arriba o abajo: el brief de esa slide deja libre la franja
                donde va.
            size: qué tan grande, como parte del ancho de la slide. 0.28 es un
                poco más de un cuarto del ancho, que es lo que se usa.
            margin: cuánto aire le queda contra los dos bordes, también como
                parte del ancho.
        """
        slide = posts.incoming(ctx.deps.workspace, image)
        available = assets()
        if asset not in available:
            # The folder's listing is the whole vocabulary, so the refusal
            # hands it over: the model picks a name instead of guessing one.
            raise ModelRetry(
                f"no hay ninguna imagen «{asset}» en `marca/`. Las que hay son: "
                f"{', '.join(available)}"
                if available
                else "no hay ninguna imagen de marca en `marca/`: pedile el "
                     "archivo al cliente y dejá la slide como está"
            )
        # The brief the slide was generated with. No fallback: a picture with
        # no sidecar did not come out of `generate_image`, and what this writes
        # is that brief plus one line.
        brief = json.loads(slide.with_suffix(BRIEF).read_text())

        # CUT TO THE POST'S SHAPE FIRST, so the corner is the corner the client
        # will see. `save_post` cuts every slide to Instagram's frame
        # (`posts.SIZE`), and a mark placed on the provider's taller 3:4 lost
        # half its air to that cut: 6% of the width above the bottom edge was
        # 3% after it. Cut here, `save_post`'s own cut finds nothing to take.
        with Image.open(slide) as bare:
            picture = ImageOps.fit(bare.convert("RGBA"), posts.SIZE[brief["format"]],
                                   Image.Resampling.LANCZOS)
        mark = Image.open(ASSETS / asset).convert("RGBA")
        width = round(picture.width * size)
        height = round(mark.height * width / mark.width)
        mark = mark.resize((width, height), Image.Resampling.LANCZOS)
        gap = round(picture.width * margin)
        # The corner names the two edges it hugs; everything else is the same
        # arithmetic mirrored.
        if corner.endswith("left"):
            x = gap
        elif corner.endswith("right"):
            x = picture.width - width - gap
        else:
            x = (picture.width - width) // 2
        if corner.startswith("top"):
            y = gap
        elif corner.startswith("bottom"):
            y = picture.height - height - gap
        else:
            y = (picture.height - height) // 2
        # `paste` WITH THE MARK AS ITS OWN MASK, which is what respects the
        # transparency: pasted without the mask, a cut-out asset arrives in its
        # own black box. And unlike `alpha_composite` it clips at the edge
        # instead of raising, so an asset asked for too big is a picture the
        # creator looks at and does again, not a dead turn.
        picture.paste(mark, (x, y), mark)

        out = next_path()
        picture.save(out)
        out.with_suffix(BRIEF).write_text(
            json.dumps(
                {
                    "prompt": brief["prompt"] + "\n" + PLACED.format(
                        asset=asset, corner=corner, size=size
                    ),
                    "format": brief["format"],
                    "model": "place_image",
                    "created_at": datetime.now(
                        ZoneInfo(config.TIMEZONE)
                    ).isoformat(timespec="seconds"),
                },
                ensure_ascii=False,
                indent=2,
            )
            + "\n"
        )
        # THE SAME TWO THINGS `generate_image` ANSWERS, and in the same shape:
        # the line the model quotes when it says where the picture is, and the
        # picture itself, which is what Pydantic AI puts in front of the model
        # as an IMAGE. A tool that only answered a path would have the creator
        # saving a composite it never looked at, and the checklist is the whole
        # reason this hand exists.
        return [f"La guardé en {out}", BinaryImage(out.read_bytes(), media_type=TYPE)]

    return ts
