#!/usr/bin/env python3
"""The Files route serves bytes. `python3 engine/tests/test_files.py`. No model, free.

The files are written INSIDE the container (it owns the workspace) and read
back over HTTP with the key the portal travels with, because what is claimed is
what arrives on the wire:

  a. A BINARY ARRIVES WHOLE — a PNG with bytes that are not UTF-8 comes back
     byte for byte, as `image/png`. It was `read_text()`, and every picture,
     PDF and spreadsheet in the workspace was a 500.
  b. A TEXT FILE IS WHAT IT WAS — the same bytes, as `text/plain`, which is
     what `portal-check` asserts on the first file of the listing.
  c. WHAT A BROWSER WOULD RUN IS TEXT — an `.html` and an `.svg` the agent
     wrote go out as `text/plain` with `nosniff`, never as a page.
  d. NOT THERE IS A 404 — a name that is not in the workspace and a `../` that
     tries to leave read the same, in Spanish.
  e. ARCHIVOS DOES NOT LIST THE MACHINERY — QA (2026-09-23) read every image
     next to a `.json` of its name, and `flows`, `memoria/instagram-creator`
     and `memoria/main` as folders. An image's sidecar, `flows/` and a
     sub-agent's notebook are off the LISTING; the face's own memory and a
     `.json` with no picture beside it stay; and every hidden one is still
     served by path.

IT CLEANS UP AFTER ITSELF: the folder it wrote is gone by the end.
"""

import json
import os
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

CORE = Path(__file__).resolve().parent.parent
CONTAINER = os.environ.get("CORE_CONTAINER", "tuagente-core")
ADAPTER = os.environ.get("CORE_ADAPTER", "http://127.0.0.1:8643")

secrets = Path(os.environ.get("CORE_SECRETS", CORE / "secrets.env")).read_text().splitlines()
KEY = next(line.split("=", 1)[1].strip() for line in secrets if line.startswith("API_SERVER_KEY="))

FOLDER = "prueba-archivos"
# A PNG signature and then bytes no UTF-8 decoder accepts: what `read_text()`
# died on.
PNG = b"\x89PNG\r\n\x1a\n\x00\xff\xfe\x80binary"
TEXT = "# Informe\n\nAcá hay tildes y eñes.\n".encode()
FILES = {
    "foto.png": PNG,
    "informe.md": TEXT,
    "pagina.html": b"<script>alert(1)</script>",
    "dibujo.svg": b"<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>",
}

WRITE = r"""
import sys
from pathlib import Path
folder = Path("/workspace") / sys.argv[1]
folder.mkdir(parents=True, exist_ok=True)
for name, hexed in zip(sys.argv[2::2], sys.argv[3::2]):
    (folder / name).write_bytes(bytes.fromhex(hexed))
"""
CLEAN = "import shutil, sys; shutil.rmtree('/workspace/' + sys.argv[1], ignore_errors=True)"

# e. Written where the rule looks, each under a name of its own so cleaning up
# touches nothing the agent wrote.
LISTED = {
    f"{FOLDER}/2026-09-23-1.png": PNG,
    f"{FOLDER}/datos.json": b"{}",
    "memoria/main/prueba-archivos.md": TEXT,
}
UNLISTED = {
    f"{FOLDER}/2026-09-23-1.json": b'{"prompt": "x"}',
    "flows/prueba-archivos/FLOW.md": TEXT,
    "memoria/prueba-archivos/MEMORY.md": TEXT,
}
WRITE_AT = r"""
import sys
from pathlib import Path
for name, hexed in zip(sys.argv[1::2], sys.argv[2::2]):
    path = Path("/workspace") / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(bytes.fromhex(hexed))
"""
UNLIST = r"""
import shutil, sys
from pathlib import Path
for name in sys.argv[1:]:
    (Path("/workspace") / name).unlink(missing_ok=True)
for folder in ("flows/prueba-archivos", "memoria/prueba-archivos"):
    shutil.rmtree("/workspace/" + folder, ignore_errors=True)
"""


def inside(code: str, *args: str) -> None:
    subprocess.run(["docker", "exec", CONTAINER, "python3", "-c", code, *args], check=True)


def lower(headers) -> dict:
    """By lowercase name: the app writes them capitalized (`server/app.py`)."""
    return {name.lower(): value for name, value in headers.items()}


def fetch(path: str) -> tuple[int, dict, bytes]:
    request = urllib.request.Request(
        f"{ADAPTER}/portal/files/{urllib.parse.quote(path)}",
        headers={"Authorization": f"Bearer {KEY}"},
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return response.status, lower(response.headers), response.read()
    except urllib.error.HTTPError as exc:
        return exc.code, lower(exc.headers), exc.read()


def listing() -> list[str]:
    request = urllib.request.Request(f"{ADAPTER}/portal/files", headers={"Authorization": f"Bearer {KEY}"})
    with urllib.request.urlopen(request, timeout=10) as response:
        return [f["path"] for f in json.loads(response.read())["files"]]


def judge(name: str, problems: list[str]) -> list[str]:
    print(f"  {name}: " + ("PASS" if not problems else "FAIL — " + "; ".join(problems)))
    return problems


def main() -> int:
    print(f"container: {CONTAINER}, adapter: {ADAPTER}")
    args = [part for name, blob in FILES.items() for part in (name, blob.hex())]
    inside(WRITE, FOLDER, *args)
    failures = []
    try:
        status, headers, body = fetch(f"{FOLDER}/foto.png")
        problems = []
        if status != 200:
            problems.append(f"answered {status}")
        if body != PNG:
            problems.append(f"{len(body)} bytes came back and they are not the ones written")
        if headers.get("content-type") != "image/png":
            problems.append(f"as {headers.get('content-type')!r}")
        failures += judge("a. a binary arrives whole", problems)

        status, headers, body = fetch(f"{FOLDER}/informe.md")
        problems = []
        if status != 200 or body != TEXT:
            problems.append(f"answered {status} with {body[:60]!r}")
        if not headers.get("content-type", "").startswith("text/plain"):
            problems.append(f"as {headers.get('content-type')!r}")
        failures += judge("b. a text file is what it was", problems)

        problems = []
        for name in ("pagina.html", "dibujo.svg"):
            status, headers, body = fetch(f"{FOLDER}/{name}")
            if status != 200 or body != FILES[name]:
                problems.append(f"{name} answered {status}")
            if not headers.get("content-type", "").startswith("text/plain"):
                problems.append(f"{name} as {headers.get('content-type')!r}")
            if headers.get("x-content-type-options") != "nosniff":
                problems.append(f"{name} without nosniff")
        failures += judge("c. what a browser would run is text", problems)

        problems = []
        for path in (f"{FOLDER}/no-existe.pdf", "../state/core.db", FOLDER):
            status, _, body = fetch(path)
            if status != 404:
                problems.append(f"{path} answered {status}")
            elif "No hay ningún archivo" not in body.decode():
                problems.append(f"{path} said {body[:80]!r}")
        failures += judge("d. not there is a 404", problems)

        both = {**LISTED, **UNLISTED}
        inside(WRITE_AT, *[part for name, blob in both.items() for part in (name, blob.hex())])
        paths = listing()
        problems = [f"{name} is not listed" for name in LISTED if name not in paths]
        problems += [f"{name} is listed" for name in UNLISTED if name in paths]
        problems += [f"{name} is not served by path" for name, blob in UNLISTED.items()
                     if fetch(name)[2] != blob]
        failures += judge("e. Archivos does not list the machinery", problems)
    finally:
        inside(CLEAN, FOLDER)
        inside(UNLIST, *LISTED, *UNLISTED)

    print("FILES: " + ("PASS" if not failures else "FAIL"))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
