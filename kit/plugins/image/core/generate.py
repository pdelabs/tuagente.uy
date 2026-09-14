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

NO RETRY AND NO FALLBACK. A generation that fails costs nothing (OpenRouter
bills a completed one or none at all), and the two failures worth telling apart
— the account is out of credit, the prompt was refused — are both in the body
of the answer. So the body is the exception's message and the turn stops there.
"""

import base64
import os
from datetime import datetime
from pathlib import Path
from typing import Literal
from zoneinfo import ZoneInfo

import httpx
from pydantic_ai.messages import BinaryImage

from core import config

URL = "https://openrouter.ai/api/v1/images"

# Listed on OpenRouter with image output, served by OpenAI (checked 2026-09-14).
MODEL = "openai/gpt-5.4-image-2"

# The three shapes a piece is ever cut to, spelled as OpenRouter spells them.
# The model reads the NAME and never the ratio: the tool argument is what a
# client asks for out loud ("una historia", "un posteo"), and the geometry is
# the only thing this table is for.
RATIO = {"feed": "4:5", "square": "1:1", "story": "9:16"}

Format = Literal["feed", "square", "story"]

WHERE = config.WORKSPACE / "imagenes"

# A generation is a minute or two of provider time. httpx's five seconds is for
# APIs that answer.
TIMEOUT = 300


def next_path() -> Path:
    """`<workspace>/imagenes/<YYYY-MM-DD>-<n>.png`, counting up within the day.

    The highest number taken and not the number of files: a client who deletes
    the picture they did not like leaves a hole, and counting would put the
    next one back on top of a picture they kept.
    """
    WHERE.mkdir(parents=True, exist_ok=True)
    today = datetime.now(ZoneInfo(config.TIMEZONE)).strftime("%Y-%m-%d")
    taken = [int(p.stem.rsplit("-", 1)[1]) for p in WHERE.glob(f"{today}-*.png")]
    return WHERE / f"{today}-{max(taken, default=0) + 1}.png"


async def generate_image(prompt: str, format: Format = "feed") -> list:
    """Genera una imagen y te la devuelve para que la veas.

    Args:
        prompt: qué tiene que mostrarse, en detalle: qué se ve, el estilo, los
            colores y, si lleva texto, el texto exacto.
        format: `feed` para un posteo (vertical 4:5), `square` para una imagen
            cuadrada, `story` para una historia (vertical 9:16).
    """
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        answer = await client.post(
            URL,
            headers={"Authorization": f"Bearer {os.environ['OPENROUTER_API_KEY']}"},
            json={
                "model": MODEL,
                "prompt": prompt,
                "aspect_ratio": RATIO[format],
                "output_format": "png",
            },
        )
    if answer.status_code != 200:
        raise RuntimeError(f"OpenRouter {answer.status_code} on {MODEL}: {answer.text}")

    image = answer.json()["data"][0]
    data = base64.b64decode(image["b64_json"])
    path = next_path()
    path.write_bytes(data)
    # Two things in one return: the line is what the model quotes when it tells
    # the client where the picture is, and the BinaryImage is the picture
    # itself, which Pydantic AI puts in front of the model as an image.
    return [f"La guardé en {path}", BinaryImage(data, media_type=image["media_type"])]
