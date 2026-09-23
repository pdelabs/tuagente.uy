#!/usr/bin/env python3
"""Whose account the Posts tab draws. `python3 engine/tests/test_post_account.py`.

The tab draws every post as the feed it is going into, and the feed's header
is the ACCOUNT's. It used to make both halves up: the company's name
lowercased into a handle («aquabicicleteria», an account that does not exist)
and the agent's face as the avatar (QA, AQUA Bicicletería, 2026-09-23).
`posts.account()` and the routes, called DIRECTLY INSIDE THE CONTAINER with
no model: free, a second.

  a. THE CONNECTED ACCOUNT WINS — with the `instagram` plugin's username
     bound (`posts.USERNAME`), that is the handle, whatever the draft says.
  b. THEN THE DRAFT'S CHANNELS — the business draft's «Por dónde te
     encuentran»: an `instagram.com/<x>` link first, a lone `@handle` next, a
     mail's @ never, a post link (`instagram.com/p/…`) never, a sentence's
     final dot off. A handle anywhere else in the draft is not a channel.
  c. OR NO HANDLE AT ALL — no draft, or no Instagram in it: `handle` is
     `None` and `name` is the company, which is what the tab shows.
  d. THE AVATAR IS THE BRAND'S LOGO — a picture in `marca/` whose name says
     `logo`, served at `avatar_url` with its type; another picture of the
     brand, or any other name, is a 404. No logo, no `avatar_url`.
  e. THE LISTING CARRIES IT — `GET /portal/posts` answers `account` beside
     `posts`, and `/portal/posts/brand/<logo>` is not taken for a post id.

IT CLEANS UP AFTER ITSELF: the throwaway draft and brand folder are dotted
names of their own, never the client's `negocio/` or `marca/`.

WHERE IT POINTS. `CORE_CONTAINER` moves it onto a second instance; the default
is the main compose's `tuagente-core`.
"""

import json
import os
import subprocess
import sys

CONTAINER = os.environ.get("CORE_CONTAINER", "tuagente-core")

INSIDE = r"""
import json, shutil, sys
from pathlib import Path
from PIL import Image

sys.path.insert(0, "/opt/kit/plugins/social/core")
import posts
from core import config
from fastapi import FastAPI
from fastapi.testclient import TestClient

WS = config.WORKSPACE
posts.DRAFT = "negocio/.prueba-cuenta.md"
posts.BRAND = ".prueba-marca"
posts.company = lambda: "Bicicletería Prueba"
draft = WS / posts.DRAFT
brand = WS / posts.BRAND
made_negocio = not draft.parent.is_dir()


def with_draft(channels, elsewhere=""):
    draft.write_text(
        "# Tu negocio, según lo que leí\n\n## En pocas palabras\n\n" + elsewhere
        + "\n\n## Por dónde te encuentran\n\n" + channels
        + "\n\n## Cómo hablás\n\nCercano. Seguinos en @otra.cuenta\n"
    )
    return posts.account()


out = {}
try:
    draft.parent.mkdir(parents=True, exist_ok=True)
    CHANNELS = ("- Web: https://www.prueba.uy/\n- Mail: info@prueba.uy\n"
                "- Instagram: @prueba.bici (https://www.instagram.com/prueba.bici/)")

    posts.USERNAME = lambda: "cuenta.conectada"
    out["connected"] = with_draft(CHANNELS)
    posts.USERNAME = None
    out["link"] = with_draft(CHANNELS)
    out["at_only"] = with_draft("- Mail: info@prueba.uy\n- Instagram: @solo.arroba.")
    out["post_link"] = with_draft("- Un posteo: https://www.instagram.com/p/ABC123/")
    out["elsewhere"] = with_draft("- Web: https://www.prueba.uy/", elsewhere="Nos ven en @no.es.canal")
    draft.unlink()
    out["no_draft"] = posts.account()

    brand.mkdir(exist_ok=True)
    Image.new("RGB", (8, 8), "navy").save(brand / "Logo-Negro.png")
    Image.new("RGB", (8, 8), "red").save(brand / "personaje.png")
    out["with_logo"] = posts.account()

    app = FastAPI()
    app.include_router(posts.router)
    client = TestClient(app)
    got = client.get(out["with_logo"]["avatar_url"])
    out["logo_get"] = {"status": got.status_code, "type": got.headers.get("content-type"),
                       "same": got.content == (brand / "Logo-Negro.png").read_bytes()}
    out["other_get"] = client.get("/portal/posts/brand/personaje.png").status_code
    out["climb_get"] = client.get("/portal/posts/brand/..%2F..%2Fstate%2Fcore.db").status_code
    listing = client.get("/portal/posts").json()
    out["listing_keys"] = sorted(listing)
    out["listing_account"] = listing["account"]
    shutil.rmtree(brand)
    out["no_logo"] = posts.account()
    print(json.dumps(out, ensure_ascii=False))
finally:
    if draft.is_file():
        draft.unlink()
    if made_negocio and draft.parent.is_dir() and not any(draft.parent.iterdir()):
        draft.parent.rmdir()
    if brand.is_dir():
        shutil.rmtree(brand)
"""


def judge(name: str, problems: list[str]) -> list[str]:
    print(f"  {name}: " + ("PASS" if not problems else "FAIL — " + "; ".join(problems)))
    return problems


def expect(problems: list[str], what: str, got, want) -> None:
    if got != want:
        problems.append(f"{what}: {got!r}, not {want!r}")


def main() -> int:
    print(f"container: {CONTAINER}")
    done = subprocess.run(["docker", "exec", CONTAINER, "python3", "-c", INSIDE],
                          capture_output=True, text=True)
    if done.returncode != 0:
        print(done.stderr.strip()[-2000:])
        print("POST ACCOUNT: FAIL")
        return 1
    r = json.loads(done.stdout)
    failures = []

    problems = []
    expect(problems, "connected", r["connected"]["handle"], "cuenta.conectada")
    failures += judge("a. the connected account wins", problems)

    problems = []
    expect(problems, "a link", r["link"]["handle"], "prueba.bici")
    expect(problems, "an @ only", r["at_only"]["handle"], "solo.arroba")
    expect(problems, "a post link", r["post_link"]["handle"], None)
    expect(problems, "a handle outside the channels", r["elsewhere"]["handle"], None)
    failures += judge("b. then the draft's channels", problems)

    problems = []
    expect(problems, "no draft", r["no_draft"]["handle"], None)
    expect(problems, "the name", r["no_draft"]["name"], "Bicicletería Prueba")
    failures += judge("c. or no handle at all", problems)

    problems = []
    expect(problems, "avatar_url", r["with_logo"]["avatar_url"], "/portal/posts/brand/Logo-Negro.png")
    expect(problems, "the logo", r["logo_get"], {"status": 200, "type": "image/png", "same": True})
    expect(problems, "another brand picture", r["other_get"], 404)
    expect(problems, "a climb", r["climb_get"], 404)
    expect(problems, "without a logo", r["no_logo"]["avatar_url"], None)
    failures += judge("d. the avatar is the brand's logo", problems)

    problems = []
    expect(problems, "listing keys", r["listing_keys"], ["account", "available", "posts"])
    expect(problems, "listing account", r["listing_account"], r["with_logo"])
    failures += judge("e. the listing carries it", problems)

    print("POST ACCOUNT: PASS" if not failures else "POST ACCOUNT: FAIL")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
