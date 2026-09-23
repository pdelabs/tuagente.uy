#!/usr/bin/env python3
"""What a flow produced is on its page. `python3 engine/tests/test_flow_results.py`.

No model, free, a few seconds. The fixtures are written INSIDE the container
(it owns the workspace) — a request flow, two deliverables in its folder, a
post saved by one of its runs and a post saved by another flow's — and read
back over HTTP from the running engine, because what is claimed is what the
Flows tab receives, through the plugins that provide it (`flow.results.*`).

  a. THE DELIVERABLES ARE THERE — what the deliverable script leaves in
     `entregables/<slug>/`, the note and its attachment.
  b. THE POST IS THERE, AND ONLY THIS FLOW'S — as its first slide, labelled
     with the caption's first line; the other flow's post is not.
  c. NEWEST FIRST, AND COUNTED — `mtime` in epoch seconds, sorted, and
     `results_total` is the count on the listing's card and on the page.
  d. NOTHING IS NOTHING — a flow that produced nothing has `[]` and `0`.
  e. A FILE DELETED IS A RESULT GONE — there is no list to fall out of date.

IT CLEANS UP AFTER ITSELF: the flows, the folder and the posts it wrote.
"""

import json
import os
import subprocess
import sys
import urllib.request
from pathlib import Path

CORE = Path(__file__).resolve().parent.parent
CONTAINER = os.environ.get("CORE_CONTAINER", "tuagente-core")
ADAPTER = os.environ.get("CORE_ADAPTER", "http://127.0.0.1:8643")

secrets = (CORE / "secrets.env").read_text().splitlines()
KEY = next(line.split("=", 1)[1].strip() for line in secrets if line.startswith("API_SERVER_KEY="))

SLUG, EMPTY, OTHER = "prueba-resultados", "prueba-sin-resultados", "otro-flujo"
POST, OTHER_POST = "2001-01-01-prueba-resultado", "2001-01-01-prueba-de-otro"

SETUP = r"""
import json, os, sys, time
from pathlib import Path

from core import flows

SLUG, EMPTY, OTHER, POST, OTHER_POST = sys.argv[1:6]
W = Path("/workspace")
for slug in (SLUG, EMPTY):
    flows.write(flows.Flow(slug=slug, name=f"Prueba {slug}", client_summary="x",
                           trigger="request", trigger_detail="Cuando lo pedís",
                           how="1. Dejo algo."))

folder = W / "entregables" / SLUG
folder.mkdir(parents=True, exist_ok=True)
(folder / "2001-01-01-informe.md").write_text("# Informe\n")
(folder / "2001-01-01-informe.png").write_bytes(b"\x89PNG")

for post_id, flow, caption in ((POST, SLUG, "El gancho del posteo.\n\nY el resto."),
                               (OTHER_POST, OTHER, "De otro flujo.")):
    where = W / "posteos" / post_id
    where.mkdir(parents=True, exist_ok=True)
    (where / "01.png").write_bytes(b"\x89PNG")
    (where / "caption.md").write_text(caption)
    (where / "post.json").write_text(json.dumps({
        "id": post_id, "slug": post_id[11:], "date": "2001-01-01", "caption": caption,
        "hashtags": [], "images": ["01.png"], "alts": ["x"], "alt": "x", "prompts": [None],
        "versions": {}, "created_at": "2001-01-01T09:00:00-03:00", "flow": flow,
    }))

# Three ages, a minute apart, so the order is not the order they were written.
now = time.time()
os.utime(folder / "2001-01-01-informe.md", (now - 180, now - 180))
os.utime(W / "posteos" / POST / "post.json", (now - 60, now - 60))
os.utime(folder / "2001-01-01-informe.png", (now - 120, now - 120))
"""

DELETE = r"""
import sys
from pathlib import Path
(Path("/workspace/entregables") / sys.argv[1] / "2001-01-01-informe.png").unlink()
"""

CLEAN = r"""
import shutil, sys
from pathlib import Path
SLUG, EMPTY, OTHER, POST, OTHER_POST = sys.argv[1:6]
W = Path("/workspace")
for path in (W / "flows" / SLUG, W / "flows" / EMPTY, W / "entregables" / SLUG,
             W / "posteos" / POST, W / "posteos" / OTHER_POST):
    shutil.rmtree(path, ignore_errors=True)
entregables = W / "entregables"
if entregables.is_dir() and not any(entregables.iterdir()):
    entregables.rmdir()
"""

ARGS = [SLUG, EMPTY, OTHER, POST, OTHER_POST]


def inside(code: str) -> None:
    subprocess.run(["docker", "exec", CONTAINER, "python3", "-c", code, *ARGS], check=True)


def get(path: str) -> dict:
    request = urllib.request.Request(f"{ADAPTER}{path}", headers={"Authorization": f"Bearer {KEY}"})
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.load(response)


def judge(name: str, problems: list[str]) -> list[str]:
    print(f"  {name}: " + ("PASS" if not problems else "FAIL — " + "; ".join(problems)))
    return problems


def main() -> int:
    print(f"container: {CONTAINER}, adapter: {ADAPTER}")
    inside(SETUP)
    failures = []
    try:
        page = get(f"/portal/flows/{SLUG}")
        results = page["results"]
        paths = [r["path"] for r in results]

        wanted = {f"entregables/{SLUG}/2001-01-01-informe.md", f"entregables/{SLUG}/2001-01-01-informe.png"}
        failures += judge("a. the deliverables are there",
                          [] if wanted <= set(paths) else [f"the page lists {paths}"])

        problems = []
        post = next((r for r in results if r["path"].startswith("posteos/")), None)
        if post is None or post["path"] != f"posteos/{POST}/01.png":
            problems.append(f"the post is {post}")
        elif post.get("label") != "El gancho del posteo.":
            problems.append(f"labelled {post.get('label')!r}")
        if any(OTHER_POST in p for p in paths):
            problems.append("the other flow's post is listed")
        failures += judge("b. the post is there, and only this flow's", problems)

        problems = []
        expected = [f"posteos/{POST}/01.png", f"entregables/{SLUG}/2001-01-01-informe.png",
                    f"entregables/{SLUG}/2001-01-01-informe.md"]
        if paths != expected:
            problems.append(f"in the order {paths}")
        if not all(isinstance(r["mtime"], int) for r in results):
            problems.append("mtime is not epoch seconds")
        card = next(f for f in get("/portal/flows")["flows"] if f["slug"] == SLUG)
        if page["results_total"] != 3 or card["results_total"] != 3:
            problems.append(f"counted {page['results_total']} and {card['results_total']}")
        if [r["path"] for r in card["results"]] != expected:
            problems.append("the listing's card has another list")
        failures += judge("c. newest first, and counted", problems)

        empty = get(f"/portal/flows/{EMPTY}")
        failures += judge("d. nothing is nothing",
                          [] if empty["results"] == [] and empty["results_total"] == 0
                          else [f"it has {empty['results']}"])

        inside(DELETE)
        after = get(f"/portal/flows/{SLUG}")
        failures += judge("e. a file deleted is a result gone",
                          [] if after["results_total"] == 2 else [f"{after['results_total']} left"])
    finally:
        inside(CLEAN)

    print("FLOW RESULTS: " + ("PASS" if not failures else "FAIL"))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
