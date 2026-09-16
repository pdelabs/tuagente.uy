#!/usr/bin/env python3
"""A path that is not there is a sentence. `python3 engine/tests/test_workspace_tools.py`.

`core/tools/workspace.py`'s three file tools called DIRECTLY INSIDE THE
CONTAINER, with no model: free, a second, and it is the gate for the failure
that killed a client's turn on our own agent on 2026-09-15 — `read_file` on a
`post.json` that had just been deleted raised `FileNotFoundError`, nothing
caught it, and the answer the client got was «No pude responder: [Errno 2] No
such file or directory».

  a. A FILE THAT IS NOT THERE COMES BACK AS WORDS — `read_file` raises
     `ModelRetry` with the path in the message, in Spanish. The model can act
     on that: list the folder, ask, say so. It cannot act on a traceback.
  b. SO DOES A FOLDER THAT IS NOT ONE, AND A FOLDER WHERE A FILE GOES — a path
     under a file (`marca/brand.md/x`), and a directory read as a file.
  c. AND WHAT WORKS STILL WORKS — a real file comes back as its text, a real
     folder lists, and a write says what it wrote. A tool that turned every
     error into a retry would be a tool that never fails and never works.
  d. A PATH THAT LEAVES THE WORKSPACE STILL RAISES — confinement is not a
     conversation: `../../etc/passwd` is a `ValueError` and the run shows it.

WHERE IT POINTS. `CORE_CONTAINER` moves it onto a second instance; the default
is the main compose's `tuagente-core`.
"""

import json
import os
import subprocess
import sys

CONTAINER = os.environ.get("CORE_CONTAINER", "tuagente-core")

INSIDE = r"""
import json, types
from pathlib import Path

from core.tools.workspace import toolset

WS = Path("/workspace")
tools = {name: tool.function for name, tool in toolset().tools.items()}
ctx = types.SimpleNamespace(deps=types.SimpleNamespace(workspace=WS, session_id="prueba"))
made = []


def call(tool, *args):
    try:
        return {"ok": tools[tool](ctx, *args)}
    except Exception as exc:
        return {"raised": type(exc).__name__, "said": str(exc)}


try:
    real = WS / "prueba-workspace.txt"
    real.write_text("dos líneas\ny la segunda\n")
    made.append(real)
    print(json.dumps({
        "missing_file": call("read_file", "posteos/no-existe/post.json"),
        "missing_folder": call("list_files", "no-existe"),
        "not_a_directory": call("read_file", "prueba-workspace.txt/adentro.md"),
        "is_a_directory": call("read_file", "posteos"),
        "read": call("read_file", "prueba-workspace.txt"),
        "list": call("list_files", "."),
        "write": call("write_file", "prueba-workspace-2.txt", "escrito por la prueba"),
        "escapes": call("read_file", "../../etc/passwd"),
    }))
finally:
    made.append(WS / "prueba-workspace-2.txt")
    for path in made:
        if path.is_file():
            path.unlink()
"""


def judge(name: str, problems: list[str]) -> list[str]:
    """One line per claim, so a failure is read where it happened."""
    print(f"  {name}: " + ("PASS" if not problems else "FAIL — " + "; ".join(problems)))
    return problems


def retry(answer: dict, must_say: str) -> list[str]:
    """It came back as a `ModelRetry` that names the path it was given."""
    if answer.get("raised") != "ModelRetry":
        return [f"it gave {answer.get('raised') or answer}"]
    if must_say not in answer["said"]:
        return [f"the message does not name the path: {answer['said']!r}"]
    return []


def main() -> int:
    print(f"container: {CONTAINER}")
    done = subprocess.run(
        ["docker", "exec", CONTAINER, "python3", "-c", INSIDE],
        capture_output=True, text=True,
    )
    if done.returncode != 0:
        print(done.stderr.strip()[-1500:])
        print("WORKSPACE TOOLS: FAIL")
        return 1
    r = json.loads(done.stdout)
    for key in ("missing_file", "missing_folder", "not_a_directory", "is_a_directory"):
        print(f"  {key:16} {r[key].get('raised')}: {r[key].get('said', '')[:90]}")

    failures = []
    failures += judge(
        "a. a file that is not there comes back as words",
        retry(r["missing_file"], "posteos/no-existe/post.json"),
    )

    problems = retry(r["missing_folder"], "no-existe")
    problems += retry(r["not_a_directory"], "prueba-workspace.txt/adentro.md")
    problems += retry(r["is_a_directory"], "posteos")
    failures += judge("b. so does a folder that is not one, and the other way", problems)

    problems = []
    if "dos líneas" not in (r["read"].get("ok") or ""):
        problems.append(f"read_file gave {r['read']}")
    if "prueba-workspace.txt" not in (r["list"].get("ok") or ""):
        problems.append("list_files does not list the file that is there")
    if "written" not in (r["write"].get("ok") or ""):
        problems.append(f"write_file gave {r['write']}")
    failures += judge("c. and what works still works", problems)

    failures += judge(
        "d. a path that leaves the workspace still raises",
        [] if r["escapes"].get("raised") == "ValueError"
        else [f"it gave {r['escapes']}"],
    )

    print("WORKSPACE TOOLS: PASS" if not failures else "WORKSPACE TOOLS: FAIL")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
