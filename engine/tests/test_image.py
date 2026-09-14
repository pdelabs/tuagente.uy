#!/usr/bin/env python3
"""Images, gate G4. Run it from anywhere: `python3 engine/tests/test_image.py`.

One conversation against a container that runs the `image` plugin
(`CORE_PLUGINS=…,image`), asking for a picture AND for a description of it. The
three things the gate asks are the three things asserted:

  a. THE TOOL RAN — `generate_image` is in the turn's tool trail, read off the
     SSE stream the portal itself reads.
  b. THE PNG LANDED — a new file under `<workspace>/imagenes/`, which is inside
     the one directory the client can see from the Files tab.
  c. THE MODEL LOOKED — the answer names what is in the picture. The tool
     returns a `BinaryImage`, so the model is handed the image and not a
     filename; an answer that describes it is the only proof of that from
     outside.

WHERE IT POINTS. The defaults are the main compose's — 8642/8643 and
`engine/workspace` — and `CORE_ENDPOINT`, `CORE_ADAPTER` and
`CORE_WORKSPACE_HOST` move it onto a second instance, which is how it was run
while the main container belonged to somebody else. The two URLs are separate
because the portal's two bases are, even when one container answers both.

~US$0.04: one image (OpenRouter bills image output by the token, ~1300 of them)
plus the two model turns around it.
"""

import json
import os
import re
import sys
import time
import unicodedata
import urllib.request
from pathlib import Path

CORE = Path(__file__).resolve().parent.parent
ENDPOINT = os.environ.get("CORE_ENDPOINT", "http://127.0.0.1:8642")
ADAPTER = os.environ.get("CORE_ADAPTER", "http://127.0.0.1:8643")
WORKSPACE = Path(os.environ.get("CORE_WORKSPACE_HOST", CORE / "workspace"))
IMAGES = WORKSPACE / "imagenes"

TOOL = "generate_image"
ASK = "Generá una imagen cuadrada de un martillo sobre fondo violeta y decime qué ves."
# What the answer has to name for "it looked" to mean anything. Either word is
# enough: the model may describe the object or the ground, and asking for both
# would be grading its prose instead of its eyes.
SEEN = ("martillo", "violeta")

secrets = (CORE / "secrets.env").read_text().splitlines()
KEY = next(l.split("=", 1)[1].strip() for l in secrets if l.startswith("API_SERVER_KEY="))
OPENROUTER_KEY = next(
    l.split("=", 1)[1].strip() for l in secrets if l.startswith("OPENROUTER_API_KEY=")
)


def get(url: str) -> dict:
    request = urllib.request.Request(url, headers={"Authorization": f"Bearer {KEY}"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read())


def key_usage() -> float:
    request = urllib.request.Request(
        "https://openrouter.ai/api/v1/key",
        headers={"Authorization": f"Bearer {OPENROUTER_KEY}"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return float(json.loads(response.read())["data"]["usage"])


def conversation(opener: str) -> tuple[list[str], str]:
    """A NEW conversation with that message: (the tools it called, the answer).

    Read frame by frame instead of drained, because the tool trail only exists
    here: `server/sse.py`'s OpenAI dialect names a tool event
    `hermes.tool.progress` and everything else arrives unnamed, and a blank
    line is what closes a frame and clears the name.
    """
    request = urllib.request.Request(
        f"{ADAPTER}/portal/chat/stream",
        data=json.dumps(
            {"stream": True, "messages": [{"role": "user", "content": opener}]}
        ).encode(),
        headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"},
    )
    tools: list[str] = []
    chunks: list[str] = []
    name: str | None = None
    with urllib.request.urlopen(request, timeout=900) as response:
        for raw in response:
            line = raw.decode().rstrip("\n")
            if not line:
                name = None
            elif line.startswith("event: "):
                name = line[len("event: "):]
            elif line.startswith("data: "):
                body = line[len("data: "):]
                if body == "[DONE]":
                    continue
                data = json.loads(body)
                if name == "hermes.tool.progress":
                    tools.append(data["tool"])
                elif name is None:
                    chunks.append(data["choices"][0]["delta"]["content"])
    return tools, "".join(chunks)


def pngs() -> set[Path]:
    return set(IMAGES.glob("*.png")) if IMAGES.is_dir() else set()


def dimensions(path: Path) -> str:
    """The PNG's own IHDR, so the shape can be printed without a decoder."""
    header = path.read_bytes()[16:24]
    return f"{int.from_bytes(header[:4], 'big')}×{int.from_bytes(header[4:], 'big')}"


def plain(text: str) -> str:
    """Lowercase, unaccented, punctuation-free — how the answer is searched."""
    letters = unicodedata.normalize("NFD", text.lower())
    letters = "".join(c for c in letters if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]+", " ", letters).strip()


def judge(name: str, problems: list[str]) -> list[str]:
    """One line per claim, so a failure is read where it happened."""
    print(f"  {name}: " + ("PASS" if not problems else "FAIL — " + "; ".join(problems)))
    return problems


def main() -> int:
    get(f"{ADAPTER}/portal/manifest")
    print(f"adapter  : {ADAPTER}")
    print(f"imagenes : {IMAGES}")
    before = pngs()
    print(f"  ({len(before)} PNG already there; only what this run adds counts)")

    before_usd = key_usage()
    started = time.time()
    print(f"\ncliente: {ASK}")
    tools, answer = conversation(ASK)
    print(f"agente : {' '.join(answer.split())[:400]}")
    print(f"{int(time.time() - started)} s · tools: {', '.join(tools) or '(none)'}")

    fresh = sorted(pngs() - before)
    for path in fresh:
        print(f"  + {path}  {dimensions(path)}  {path.stat().st_size // 1024} KB")

    failures = []
    failures += judge("a. the tool ran", [] if TOOL in tools else [f"no {TOOL} in the trail"])
    failures += judge("b. the PNG landed", [] if fresh else [f"no new PNG under {IMAGES}"])
    failures += judge(
        "c. the model looked",
        [] if any(word in plain(answer) for word in SEEN)
        else [f"the answer names none of {SEEN}"],
    )

    print(f"OpenRouter key delta   : US${key_usage() - before_usd:.4f}")
    print("IMAGE: PASS" if not failures else "IMAGE: FAIL")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
