"""The `generate_image` tool: OpenRouter, a PNG in the workspace, the picture back.

WHY THE IMAGE API AND NOT CHAT COMPLETIONS. `POST /api/v1/images` is
OpenRouter's own endpoint for generation, and it answers a normalised
`data[0].b64_json` plus its `media_type` for every model it serves. Asking the
same model through `/chat/completions` with `modalities: ["image", "text"]`
returns the picture buried in the assistant message, pays for a conversation
nobody reads, and has nowhere to put the shape. Checked 2026-09-14: the images
endpoint serves `openai/gpt-5.4-image-2` (provider `openai`), and it validates
its own vocabulary — a wrong value comes back as the list of right ones.

WHY A RATIO AND NOT PIXELS. The endpoint takes `size` as `WIDTHxHEIGHT` and
hands it to the provider, whose set of sizes is its own and moves with the
model; `aspect_ratio` is OpenRouter's, checked against a closed list, and it
maps to a geometry the selected model does support. The three formats are
exactly three of those ratios — 1080×1350 is 4:5, 1080×1080 is 1:1, 1080×1920
is 9:16 — so we ask for the SHAPE and the model decides the pixel count. A post
is cropped to the shape, never to the pixel.

A FAILURE IS THE MODEL'S TO HANDLE, NOT THE TURN'S TO DIE OF. A generation
that fails costs nothing (OpenRouter bills a completed one or none at all),
and the two failures worth telling apart — the account is out of credit, the
prompt was refused — are both in the body of the answer. That body travels
back to the model inside a `ModelRetry`, so it reads what happened and can do
what `skills/post/SKILL.md` §5 says: deliver the caption without the image
instead of losing the whole morning's work. A bug in here is not a provider
failure and still raises.

NO `output_format` IN THE REQUEST. Sending it bought nothing — the provider
answers PNG either way and says so in `media_type`, which is now where the
file's extension comes from — and it was measured making the refusal path
worse: the validator timed the same rejected prompt at ~2.5 s without the key
and ~320 s with it, five minutes of a turn hanging on a request that was
already decided. Measured again on 14/09 it was 19.4 s without and 17.5 s
with, so the hang is not reproducible on demand; what is not in the request
cannot cause it.

THE BRIEF TRAVELS WITH THE PICTURE. Beside every image this tool writes a
SIDECAR with the same stem and a `.json` suffix —
`imagenes/2026-09-15-1.png` and `imagenes/2026-09-15-1.json` — carrying
`{"prompt", "format", "model", "created_at"}`: everything the picture was made
from. It is a convention and not a private detail, because the social plugin
reads it: `save_post` moves the brief into the post next to the slide it made,
and that stored brief is what a «arreglá la slide 2» starts from — change one
line of it, keep the rest word for word, and the fixed slide still belongs to
the same carousel. The model never writes it and never reads it: the file is
next to the picture, so nothing has to remember a path.

AND A PICTURE CAN BE EDITED INSTEAD OF REDRAWN. `reference` names a picture
already in the workspace and it travels as the endpoint's `input_references`
(one `image_url` with a data URL, the shape OpenRouter's own edit script sends;
`GET /api/v1/images/models` lists `input_references` 0..16 for this model,
checked 2026-09-23). Measured on the QA agent the same day: asked to change
only the cover's words, the creator regenerated the slide from its brief and
the client got a different loaf, a different cloth and the text somewhere
else — a brief describes a picture, it does not pin one. With the old picture
as the input, the prompt is the CHANGE and nothing else, and the frame around
it is this file's (`EDIT`): what has to stay the same is format, so the model
is not trusted to remember to say it. The sidecar carries the `reference`,
which is how `replace_slide` knows the picture is an edit and asks for the
slide's whole brief separately.
"""

import base64
import json
import os
from datetime import datetime
from pathlib import Path
from typing import Literal
from zoneinfo import ZoneInfo

import httpx
from pydantic_ai import ModelRetry
from pydantic_ai.messages import BinaryImage

from core import config
from core.tools.workspace import under

URL = "https://openrouter.ai/api/v1/images"

# Listed on OpenRouter with image output, served by OpenAI (checked 2026-09-14).
MODEL = "openai/gpt-5.4-image-2"

# The three shapes a piece is ever cut to, spelled as OpenRouter spells them.
# The model reads the NAME and never the ratio: the tool argument is what a
# client asks for out loud ("una historia", "un posteo"), and the geometry is
# the only thing this table is for.
#
# `feed` IS 3:4 AND NOT THE 4:5 INSTAGRAM PREFERS, because the provider does
# not serve 4:5: `{"aspect_ratio": "4:5"}` comes back 400 with the whole
# accepted vocabulary in the body — 1:1, 3:2, 2:3, 4:3, 3:4, 16:9, 9:16, 21:9,
# auto (measured 2026-09-14, and only `square` had ever been asked for before,
# so the shape every post actually uses was the broken one). 3:4 is the nearest
# vertical, it is honoured exactly (1152×1536), and Instagram crops it to 4:5,
# which takes about 6% off the top and the bottom: whatever matters stays out
# of those bands. The old Hermes plugin hit the same wall and answered 1:1,
# which is honest and gives up the vertical — the thing a feed post is for.
RATIO = {"feed": "3:4", "square": "1:1", "story": "9:16"}

Format = Literal["feed", "square", "story"]

WHERE = config.WORKSPACE / "imagenes"

# The sidecar's suffix. The social plugin knows this convention by the same
# name: a picture and its brief differ only in this.
BRIEF = ".json"

# A generation is a minute or two of provider time, so the read is generous;
# the connect is not, because a provider that does not pick up the phone is not
# thinking about it. httpx's default five seconds everywhere is for APIs that
# answer, and no timeout at all is how a refused prompt became a five-minute
# silence in the middle of a flow.
TIMEOUT = httpx.Timeout(120.0, connect=10.0)

# Read by the model and repeated to the client, so: Spanish, one line, and the
# provider's own words inside it — «rejected by the safety system» is the
# difference between changing the prompt and topping up the account.
FAILED = "No pude generar la imagen: {reason}. Seguí sin la imagen o cambiá el pedido."

# The frame of an edit, around the change the model asked for. Spanish because
# the image model reads the rest of every brief in Spanish, and the list of
# what stays is the list of what the QA fix lost (2026-09-23).
EDIT = (
    "Editá la imagen de referencia. Cambiá sólo esto: {change}\n"
    "Todo lo demás queda exactamente igual que en la referencia: el encuadre,"
    " los objetos y su lugar, la luz, los colores, la tipografía, el tamaño y la"
    " posición del texto que no cambia."
)

# What a reference is sent as, by its suffix: the same four the posts tab
# serves. A file of another type is not a picture a slide can be.
TYPES = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
         ".webp": "image/webp"}


def flat(text) -> str:
    """One line, short enough to sit inside a sentence the client reads."""
    return " ".join(str(text).split())[:300]


def why(exc: Exception) -> str:
    """Why the call never got an answer. The class name only when there is
    nothing else to read, which is exactly the case of a timeout:
    `str(ReadTimeout())` is empty, and "" as a reason tells nobody anything."""
    return flat(exc) or type(exc).__name__


def reason(answer: httpx.Response) -> str:
    """Why the provider said no, in its own words. A body that is not the
    shape OpenRouter documents (a proxy's HTML, say) travels raw behind the
    status code: unreadable is still more than nothing."""
    try:
        return flat(answer.json()["error"]["message"])
    except Exception:
        return f"{answer.status_code} {flat(answer.text)}"


def suffix_of(media_type: str) -> str:
    """`image/png` -> `.png`: the provider's own word for what it sent.

    Not `mimetypes.guess_extension`, which answers `None` for `image/webp` on
    this image — a table that does not know every image type is a table that
    can refuse to name a picture we are holding in our hands.
    """
    return "." + media_type.rsplit("/", 1)[-1].split("+", 1)[0]


def next_path(suffix: str) -> Path:
    """`<workspace>/imagenes/<YYYY-MM-DD>-<n><suffix>`, counting up within the day.

    The highest number taken and not the number of files: a client who deletes
    the picture they did not like leaves a hole, and counting would put the
    next one back on top of a picture they kept.

    THE SUFFIX IS THE PROVIDER'S. It used to be hard-named `.png` while the
    request asked for PNG; with the request no longer asking, what the answer
    says it sent is the only thing that knows.
    """
    WHERE.mkdir(parents=True, exist_ok=True)
    today = datetime.now(ZoneInfo(config.TIMEZONE)).strftime("%Y-%m-%d")
    # The sidecar shares the stem, so it counts as the same number and the
    # picture it belongs to is never overwritten by the next one.
    taken = [int(p.stem.rsplit("-", 1)[1]) for p in WHERE.glob(f"{today}-*")]
    return WHERE / f"{today}-{max(taken, default=0) + 1}{suffix}"


def reference_of(relative: str) -> dict:
    """The picture an edit starts from, as one `input_references` item.

    Confined to the workspace like every path the model hands a tool: a name
    outside it, or one that is not a picture, comes back as words.
    """
    try:
        path = under(config.WORKSPACE, relative)
    except ValueError:
        raise ModelRetry(f"{relative} está fuera del espacio de trabajo") from None
    if not path.is_file() or path.suffix.lower() not in TYPES:
        raise ModelRetry(
            f"no encuentro la imagen {relative}: pasame la ruta de una imagen del "
            "espacio de trabajo, como `posteos/<id>/01.png`"
        )
    data = base64.b64encode(path.read_bytes()).decode()
    return {"type": "image_url",
            "image_url": {"url": f"data:{TYPES[path.suffix.lower()]};base64,{data}"}}


def request(prompt: str, format: Format, reference: str | None) -> dict:
    """The body of the call. A generation is the prompt and the shape; an edit
    is the same plus the picture it starts from, with the prompt inside `EDIT`."""
    body = {"model": MODEL, "prompt": prompt, "aspect_ratio": RATIO[format]}
    if reference is not None:
        body["prompt"] = EDIT.format(change=prompt)
        body["input_references"] = [reference_of(reference)]
    return body


def write_brief(path: Path, prompt: str, format: Format, when: datetime,
                reference: str | None = None) -> Path:
    """The sidecar beside the picture: what it was made from, as JSON.

    `<same stem>.json`, so whoever is holding the image is holding its brief:
    no index, no name to remember, and moving the picture out of `imagenes/`
    is what takes the brief with it (`plugins/social/core/posts.py`).
    """
    brief = path.with_suffix(BRIEF)
    data = {
        "prompt": prompt,
        "format": format,
        "model": MODEL,
        "created_at": when.isoformat(timespec="seconds"),
    }
    # Only on an edit: its `prompt` is the change and not a description of the
    # picture, and whoever files the picture has to know that.
    if reference is not None:
        data["reference"] = reference
    brief.write_text(
        json.dumps(
            data,
            ensure_ascii=False,
            indent=2,
        )
        + "\n"
    )
    return brief


async def generate_image(
    prompt: str, format: Format = "feed", reference: str | None = None
) -> list:
    """Genera una imagen y te la devuelve para que la veas.

    Con `reference` no dibuja de cero: EDITA esa imagen y deja todo lo demás
    como estaba. Es lo que va cuando hay que cambiar sólo el texto de una
    imagen que ya está bien.

    Args:
        prompt: qué tiene que mostrarse, en detalle: qué se ve, el estilo, los
            colores y, si lleva texto, el texto exacto. Con `reference`, en
            cambio, sólo el cambio: el texto «X» pasa a decir «Y».
        format: `feed` para un posteo (vertical 4:5), `square` para una imagen
            cuadrada, `story` para una historia (vertical 9:16).
        reference: la imagen que querés editar, por su ruta en el espacio de
            trabajo, como `posteos/<id>/01.png`.
    """
    body = request(prompt, format, reference)
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            answer = await client.post(
                URL,
                headers={"Authorization": f"Bearer {os.environ['OPENROUTER_API_KEY']}"},
                json=body,
            )
    except httpx.HTTPError as exc:
        raise ModelRetry(FAILED.format(reason=why(exc)))
    if answer.status_code != 200:
        raise ModelRetry(FAILED.format(reason=reason(answer)))

    image = answer.json()["data"][0]
    data = base64.b64decode(image["b64_json"])
    path = next_path(suffix_of(image["media_type"]))
    path.write_bytes(data)
    write_brief(path, prompt, format, datetime.now(ZoneInfo(config.TIMEZONE)), reference)
    # Two things in one return: the line is what the model quotes when it tells
    # the client where the picture is, and the BinaryImage is the picture
    # itself, which Pydantic AI puts in front of the model as an image.
    return [f"La guardé en {path}", BinaryImage(data, media_type=image["media_type"])]
