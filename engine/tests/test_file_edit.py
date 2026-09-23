#!/usr/bin/env python3
"""The owner edits her files from Archivos, and only hers. `python3 engine/tests/test_file_edit.py`. No model, free.

`PUT /portal/files/{path}` (`server/portal.py`). The files are written INSIDE
the container and edited over HTTP with the key the portal travels with:

  a. HER UPLOADS AND THE DRAFT ARE EDITABLE — a text file in `entrada/` and
     `negocio/borrador.md` take the new text, byte for byte, and the listing
     marks them `editable`.
  b. THE AGENT'S WORK IS NOT — a file in `entregables/` is a 403 in Spanish,
     is left as it was, and the listing says `editable: false`.
  c. A WAY OUT IS JUDGED BY WHERE IT LANDS — `entrada/../entregables/…` and a
     symlink in `entrada/` pointing at the agent's file are 403; a `../` out of
     the workspace is a 404.
  d. ONLY TEXT, ONLY WHAT IS THERE — an .xlsx in `entrada/` is a 400, and a
     name that is not there is a 404: editing does not create.

IT PUTS BACK WHAT IT TOUCHED: its files are removed and a draft that was there
is restored.

WHERE IT POINTS. `CORE_CONTAINER`, `CORE_ADAPTER` and `CORE_SECRETS` (the
`secrets.env` with the key); the defaults are the lab's.
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
SECRETS = Path(os.environ.get("CORE_SECRETS", CORE / "secrets.env"))
KEY = next(
    line.split("=", 1)[1].strip()
    for line in SECRETS.read_text().splitlines()
    if line.startswith("API_SERVER_KEY=")
)

SETUP = r"""
import os, sys
from pathlib import Path
w = Path("/workspace")
draft = w / "negocio/borrador.md"
saved = draft.read_bytes().hex() if draft.exists() else ""
(w / "entrada").mkdir(exist_ok=True)
(w / "entregables").mkdir(exist_ok=True)
draft.parent.mkdir(exist_ok=True)
(w / "entrada/prueba-edicion.txt").write_text("lo que subí\n")
(w / "entrada/prueba-edicion.xlsx").write_bytes(b"PK\x03\x04\x00\xff\xfe")
(w / "entregables/prueba-edicion.md").write_text("del agente\n")
os.symlink("../entregables/prueba-edicion.md", w / "entrada/prueba-edicion-link.md")
draft.write_text("# Tu negocio\n")
print(saved)
"""
READ = "import sys; print(open('/workspace/' + sys.argv[1]).read(), end='')"
CLEAN = r"""
import sys
from pathlib import Path
w = Path("/workspace")
for p in ("entrada/prueba-edicion.txt", "entrada/prueba-edicion.xlsx",
          "entrada/prueba-edicion-link.md", "entregables/prueba-edicion.md"):
    (w / p).unlink(missing_ok=True)
draft = w / "negocio/borrador.md"
if sys.argv[1]:
    draft.write_bytes(bytes.fromhex(sys.argv[1]))
else:
    draft.unlink(missing_ok=True)
"""


def inside(code: str, *args: str) -> str:
    done = subprocess.run(
        ["docker", "exec", CONTAINER, "python3", "-c", code, *args],
        check=True, capture_output=True, text=True,
    )
    return done.stdout


def call(method: str, path: str, body: bytes | None = None) -> tuple[int, bytes]:
    request = urllib.request.Request(
        f"{ADAPTER}{path}", data=body, method=method,
        headers={"Authorization": f"Bearer {KEY}", "Content-Type": "text/plain; charset=utf-8"},
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read()


def put(path: str, text: str | bytes) -> tuple[int, str]:
    body = text.encode() if isinstance(text, str) else text
    status, raw = call("PUT", f"/portal/files/{urllib.parse.quote(path)}", body)
    return status, raw.decode(errors="replace")


def judge(name: str, problems: list[str]) -> int:
    print(("  ok    " if not problems else "  FAIL  ") + name)
    for p in problems:
        print("        " + p)
    return 1 if problems else 0


def main() -> int:
    saved = inside(SETUP).strip()
    failures = 0
    try:
        listed = {f["path"]: f["editable"] for f in json.loads(call("GET", "/portal/files")[1])["files"]}

        problems = []
        edited = "lo que subí, corregido: sábados hasta las 14 — ñ\n"
        status, said = put("entrada/prueba-edicion.txt", edited)
        if status != 200 or inside(READ, "entrada/prueba-edicion.txt") != edited:
            problems.append(f"her upload: {status} {said}")
        status, said = put("negocio/borrador.md", "# Tu negocio\n\nCerrás a las 14.\n")
        if status != 200 or inside(READ, "negocio/borrador.md") != "# Tu negocio\n\nCerrás a las 14.\n":
            problems.append(f"the draft: {status} {said}")
        if not (listed.get("entrada/prueba-edicion.txt") and listed.get("negocio/borrador.md")):
            problems.append(f"the listing does not mark them editable: {listed!r}")
        failures += judge("a. her uploads and the draft are editable", problems)

        problems = []
        status, said = put("entregables/prueba-edicion.md", "pisado\n")
        if status != 403 or "desde acá se puede leer, no editar" not in said:
            problems.append(f"the agent's file: {status} {said}")
        if inside(READ, "entregables/prueba-edicion.md") != "del agente\n":
            problems.append("the agent's file changed")
        if listed.get("entregables/prueba-edicion.md") is not False:
            problems.append("the listing marks the agent's file editable")
        failures += judge("b. the agent's work is not", problems)

        problems = []
        for path in ("entrada/../entregables/prueba-edicion.md", "entrada/prueba-edicion-link.md"):
            status, said = put(path, "pisado\n")
            if status != 403:
                problems.append(f"{path}: {status} {said}")
        status, said = put("entrada/../../etc/hostname", "pisado\n")
        if status != 404:
            problems.append(f"out of the workspace: {status} {said}")
        if inside(READ, "entregables/prueba-edicion.md") != "del agente\n":
            problems.append("the agent's file changed through a way out")
        failures += judge("c. a way out is judged by where it lands", problems)

        problems = []
        status, said = put("entrada/prueba-edicion.xlsx", "texto\n")
        if status != 400 or "no es un archivo de texto" not in said:
            problems.append(f"the spreadsheet: {status} {said}")
        status, said = put("entrada/prueba-no-esta.txt", "nuevo\n")
        if status != 404:
            problems.append(f"a new name: {status} {said}")
        failures += judge("d. only text, only what is there", problems)
    finally:
        inside(CLEAN, saved)

    print("FILE EDIT: " + ("PASS" if not failures else "FAIL"))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
