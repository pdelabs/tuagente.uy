#!/usr/bin/env python3
"""Images, gate G4. Run it from anywhere: `python3 engine/tests/test_image.py`.

The generator, called DIRECTLY INSIDE THE CONTAINER and with no model in the
loop: `generate.generate_image(prompt, format)`, the same coroutine Pydantic
AI's `ImageGeneration` capability puts in front of an agent. Three claims:

  a. THE TOOL ANSWERED WITH BOTH THINGS — the line that says where the file is,
     and a `BinaryImage` with the provider's own media type and its bytes. That
     second half is what Pydantic AI hands to a model as an IMAGE rather than
     as a filename, so it is what makes looking at the piece possible at all.
  b. THE PNG LANDED — a new file under `<workspace>/imagenes/`, which is inside
     the one directory the client can see from the Files tab.
  c. THE SHAPE IS THE ONE ASKED FOR — the file's own IHDR, read without a
     decoder. `square` is 1:1 and a provider that quietly served something else
     would be a post cropped wrong on every phone.

IT NO LONGER GOES THROUGH A TURN, and that is the point of the change. The face
has no `generate_image` any more: the tool belongs to the social plugin's
creator (`docs/subagents-plan.md`), so a chat turn asking for a picture is a
delegation, and THAT is gated by `tests/test_delegation.py` — which is also
where the old claim "the model looked" now lives, as S1's post with an image
the creator checked before saving. What is left here is the generator itself,
for a third of the price and none of the model's opinions.

WHERE IT POINTS. The defaults are the main compose's — `tuagente-core` and
`engine/workspace` — and `CORE_CONTAINER` and `CORE_WORKSPACE_HOST` move it
onto a second instance.

~US$0.01: one image and no turn around it.
"""

import json
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

CORE = Path(__file__).resolve().parent.parent
CONTAINER = os.environ.get("CORE_CONTAINER", "tuagente-core")
WORKSPACE = Path(os.environ.get("CORE_WORKSPACE_HOST", CORE / "workspace"))
IMAGES = WORKSPACE / "imagenes"

PROMPT = (
    "Un martillo de carpintero sobre un fondo violeta liso, ilustración plana,"
    " sin ningún texto."
)
FORMAT = "square"
# What `square` means, from `kit/plugins/image/core/generate.py`'s table: the
# provider is asked for a SHAPE and picks the pixels, so the assertion is the
# ratio and not a size.
RATIO = 1.0
TOLERANCE = 0.02

# The plugin's own directory goes on the path the same way `core/plugins.py`
# puts it there, so `generate` imports by its plain name and finds `core` —
# the engine's own package — already importable at /app.
INSIDE = """
import asyncio, json, sys
sys.path.insert(0, "/opt/kit/plugins/image/core")
import generate
line, image = asyncio.run(generate.generate_image(sys.argv[1], sys.argv[2]))
print(json.dumps({"line": line, "media_type": image.media_type, "bytes": len(image.data)}))
"""

secrets = (CORE / "secrets.env").read_text().splitlines()
OPENROUTER_KEY = next(
    l.split("=", 1)[1].strip() for l in secrets if l.startswith("OPENROUTER_API_KEY=")
)


def key_usage() -> float:
    request = urllib.request.Request(
        "https://openrouter.ai/api/v1/key",
        headers={"Authorization": f"Bearer {OPENROUTER_KEY}"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return float(json.loads(response.read())["data"]["usage"])


def generate(prompt: str, shape: str) -> dict:
    """One generation, in the container that has the key and the workspace."""
    done = subprocess.run(
        ["docker", "exec", CONTAINER, "python3", "-c", INSIDE, prompt, shape],
        capture_output=True, text=True,
    )
    if done.returncode != 0:
        # A `ModelRetry` is what a refusal looks like from in here, and its
        # message is the provider's own words: it belongs on the screen whole.
        print(done.stderr.strip()[-800:])
        return {}
    return json.loads(done.stdout)


def pictures() -> set[Path]:
    return {p for p in IMAGES.glob("*") if p.is_file()} if IMAGES.is_dir() else set()


def dimensions(path: Path) -> tuple[int, int]:
    """The PNG's own IHDR, so the shape can be read without a decoder."""
    header = path.read_bytes()[16:24]
    return int.from_bytes(header[:4], "big"), int.from_bytes(header[4:], "big")


def judge(name: str, problems: list[str]) -> list[str]:
    """One line per claim, so a failure is read where it happened."""
    print(f"  {name}: " + ("PASS" if not problems else "FAIL — " + "; ".join(problems)))
    return problems


def main() -> int:
    print(f"container: {CONTAINER}")
    print(f"imagenes : {IMAGES}")
    before = pictures()
    print(f"  ({len(before)} already there; only what this run adds counts)")

    before_usd = key_usage()
    started = time.time()
    print(f"\nprompt: {PROMPT}  [{FORMAT}]")
    answered = generate(PROMPT, FORMAT)
    print(f"{int(time.time() - started)} s · {answered or '(the call failed)'}")

    fresh = sorted(pictures() - before)
    failures = []
    problems = []
    if not answered:
        problems.append("the tool raised instead of answering")
    else:
        if "imagenes" not in answered["line"]:
            problems.append(f"the line does not say where it saved it: {answered['line']!r}")
        if not answered["media_type"].startswith("image/"):
            problems.append(f"media type {answered['media_type']!r}")
        if answered["bytes"] < 1024:
            problems.append(f"the picture is {answered['bytes']} bytes")
    failures += judge("a. the tool answered with both things", problems)

    failures += judge(
        "b. the PNG landed", [] if fresh else [f"no new file under {IMAGES}"]
    )

    problems = []
    if fresh:
        width, height = dimensions(fresh[0])
        print(f"  + {fresh[0]}  {width}×{height}  {fresh[0].stat().st_size // 1024} KB")
        if abs(width / height - RATIO) > TOLERANCE:
            problems.append(f"{width}×{height} is not {RATIO}")
    else:
        problems.append("there was no file to measure")
    failures += judge("c. the shape is the one asked for", problems)

    print(f"OpenRouter key delta   : US${key_usage() - before_usd:.4f}")
    print("IMAGE: PASS" if not failures else "IMAGE: FAIL")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
