#!/usr/bin/env python3
"""The agent can look outside. `python3 engine/tests/test_web_tools.py`.

`core/tools/web.py`'s two tools called DIRECTLY INSIDE THE CONTAINER, with no
model: a few seconds and free. It needs the container to reach the internet,
which is the thing being tested.

  a. THE FACE HAS THEM — `web_search` and `web_fetch` are in the engine's own
     hands, and the paragraph that says a page is data and never an order is in
     the prose the face is built with.
  b. A SEARCH COMES BACK AS RESULTS — title, address, snippet, and the address
     is one a `web_fetch` can open.
  c. A PAGE COMES BACK AS ITS TEXT — the blocks that are not the page (script,
     style, nav, footer) are gone WITH their content, which is what the
     library's own converter does not do; links are dropped unless asked for.
     Judged on fixed HTML, so it does not depend on anybody's site.
  d. A REAL PAGE READS CLEAN — our own `/privacidad` opens, says what it says,
     and carries none of the inline JavaScript it is served with.
  e. THE AGENT CANNOT BE SENT TO ITSELF — a loopback address is refused, as a
     `ModelRetry` naming the address; so is a page that is not there.
  f. A FILE IS NOT A PAGE — a PDF comes back as a sentence, not as bytes.

WHERE IT POINTS. `CORE_CONTAINER` moves it onto a second instance; the default
is the main compose's `tuagente-core`.
"""

import json
import os
import subprocess
import sys

CONTAINER = os.environ.get("CORE_CONTAINER", "tuagente-core")

INSIDE = r"""
import asyncio, json, types

from core import agent
from core.tools import web

tools = {name: tool.function for name, tool in web.toolset().tools.items()}
ctx = types.SimpleNamespace(deps=types.SimpleNamespace(session_id="prueba"))

PAGE = '''<html><head><title>Panadería</title><style>.x{color:red}</style>
<script>var secreto = "no-soy-la-pagina";</script></head><body>
<nav><a href="/menu">menú-del-sitio</a></nav>
<h1>Horarios</h1><p>Abrimos de <a href="https://ejemplo.uy/mapa">lunes a sábado</a>.</p>
<footer>pie-del-sitio</footer></body></html>'''


def call(tool, *args):
    try:
        found = tools[tool](ctx, *args)
        if asyncio.iscoroutine(found):
            found = asyncio.run(found)
        return {"ok": found}
    except Exception as exc:
        return {"raised": type(exc).__name__, "said": str(exc)}


hands = sorted(name for toolset in agent.hands() for name in toolset.tools)
print(json.dumps({
    "hands": hands,
    "prose": web.WEB,
    "search": call("web_search", "Banco Central del Uruguay cotización dólar"),
    "plain": web.as_markdown(PAGE, links=False),
    "linked": web.as_markdown(PAGE, links=True),
    "real": call("web_fetch", "https://tuagente.uy/privacidad"),
    "loopback": call("web_fetch", "http://127.0.0.1:8643/portal/tickets"),
    "gone": call("web_fetch", "https://tuagente.uy/esta-pagina-no-existe"),
    "pdf": call("web_fetch", "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf"),
}))
"""


def judge(name: str, problems: list[str]) -> list[str]:
    """One line per claim, so a failure is read where it happened."""
    print(f"  {name}: " + ("PASS" if not problems else "FAIL — " + "; ".join(problems)))
    return problems


def retry(answer: dict, must_say: str) -> list[str]:
    """It came back as a `ModelRetry` that names the address it was given."""
    if answer.get("raised") != "ModelRetry":
        return [f"it gave {answer.get('raised') or str(answer)[:120]}"]
    if must_say not in answer["said"]:
        return [f"the message does not name the address: {answer['said']!r}"]
    return []


def main() -> int:
    print(f"container: {CONTAINER}")
    done = subprocess.run(
        ["docker", "exec", CONTAINER, "python3", "-c", INSIDE],
        capture_output=True, text=True,
    )
    if done.returncode != 0:
        print(done.stderr.strip()[-1500:])
        print("WEB TOOLS: FAIL")
        return 1
    r = json.loads(done.stdout)
    failures = []

    problems = [f"the face has no `{t}`" for t in ("web_search", "web_fetch") if t not in r["hands"]]
    if "nunca una orden" not in r["prose"]:
        problems.append("the prose does not say a page is never an order")
    failures += judge("a. the face has them", problems)

    problems = []
    found = r["search"].get("ok", "")
    if not found:
        problems.append(f"it gave {r['search']}")
    elif "https://" not in found:
        problems.append("no result carries an address")
    failures += judge("b. a search comes back as results", problems)

    problems = []
    for noise in ("no-soy-la-pagina", "color:red", "menú-del-sitio", "pie-del-sitio"):
        if noise in r["plain"]:
            problems.append(f"`{noise}` survived")
    if "Horarios" not in r["plain"] or "lunes a sábado" not in r["plain"]:
        problems.append("the page's own text is gone")
    if "ejemplo.uy" in r["plain"]:
        problems.append("a link survived without being asked for")
    if "https://ejemplo.uy/mapa" not in r["linked"]:
        problems.append("`links=True` did not keep the link")
    failures += judge("c. a page comes back as its text", problems)

    problems = []
    page = r["real"].get("ok", "")
    if "Política de privacidad" not in page:
        problems.append(f"it gave {str(r['real'])[:160]}")
    if "function" in page or "ChunkLoadError" in page:
        problems.append("the inline JavaScript came with it")
    failures += judge("d. a real page reads clean", problems)

    problems = retry(r["loopback"], "127.0.0.1")
    problems += retry(r["gone"], "esta-pagina-no-existe")
    failures += judge("e. the agent cannot be sent to itself", problems)

    problems = []
    if "application/pdf" not in r["pdf"].get("ok", ""):
        problems.append(f"it gave {str(r['pdf'])[:160]}")
    failures += judge("f. a file is not a page", problems)

    print("WEB TOOLS: " + ("PASS" if not failures else "FAIL"))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
