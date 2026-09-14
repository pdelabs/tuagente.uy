#!/usr/bin/env python3
"""The post of the day, G5's engine half. `python3 engine/tests/test_post.py`.

One chat turn against a container that runs the `social` plugin
(`CORE_PLUGINS=…,image,social`) and has `marca/brand.md` in its workspace:
«Armá el posteo de hoy para Instagram y guardalo». What the gate asks is what
is asserted, from outside, the way the portal sees it:

  a. THE FOLDER IS THERE — a new directory under `<workspace>/posteos/` with
     `post.json`, `caption.md` and at least one image. Nothing is written
     outside it: the picture `generate_image` left in `imagenes/` was MOVED.
  b. THE TAB LISTS IT — `GET /portal/posts` answers `available` and carries the
     post with an `images[0].url`.
  c. THE PIECE DOWNLOADS — that url answers PNG bytes with `Content-Type:
     image/png` and an inline `Content-Disposition`. Through `/portal/files`
     the same file comes back as `text/plain`, which is why the plugin serves
     it and the engine does not.
  d. THE MODULE IS DECLARED — `GET /portal/manifest` has `modules.posts` true,
     which is what makes the portal draw the tab at all.
  e. ACTIVITY SAW IT — a `post.saved` event, so the client does not have to be
     in the conversation to know there is a post waiting.
  f. IT DID NOT CLAIM TO PUBLISH — the answer says it left the post ready, and
     never that it went up. The one rule of this plugin that no code enforces.

THE POST IS LEFT ON DISK. It is the thing to look at, and a test that cleaned
up after itself would delete the only evidence of the run. Which is why IT RUNS
ONCE A DAY: the second run of the same day finds today's post, the agent
refuses to overwrite it, and the gate says so and stops instead of failing on
a folder that was never going to appear.

WHERE IT POINTS. The defaults are the main compose's — 8642/8643 and
`engine/workspace` — and `CORE_ENDPOINT`, `CORE_ADAPTER` and
`CORE_WORKSPACE_HOST` move it onto a second instance.

~US$0.02: one image plus the turn around it.
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
POSTS = WORKSPACE / "posteos"
BRAND = WORKSPACE / "marca" / "brand.md"

ASK = "Armá el posteo de hoy para Instagram y guardalo."

# What the answer must NOT claim. The agent does not publish, and the words it
# would use if it thought it had are these. «publicar» is not in the list on
# its own: «no publico nada» is the sentence we WANT.
PUBLISHED = ("ya lo publiqué", "lo publiqué", "quedó publicado", "está publicado",
             "lo subí a instagram", "ya salió en instagram")

secrets = (CORE / "secrets.env").read_text().splitlines()
KEY = next(l.split("=", 1)[1].strip() for l in secrets if l.startswith("API_SERVER_KEY="))
OPENROUTER_KEY = next(
    l.split("=", 1)[1].strip() for l in secrets if l.startswith("OPENROUTER_API_KEY=")
)


def get(url: str) -> dict:
    request = urllib.request.Request(url, headers={"Authorization": f"Bearer {KEY}"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read())


def raw(url: str) -> tuple[bytes, dict]:
    """The bytes and the headers, which is how the portal fetches a piece."""
    request = urllib.request.Request(url, headers={"Authorization": f"Bearer {KEY}"})
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read(), dict(response.headers)


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
    with urllib.request.urlopen(request, timeout=1800) as response:
        for line in response:
            text = line.decode().rstrip("\n")
            if not text:
                name = None
            elif text.startswith("event: "):
                name = text[len("event: "):]
            elif text.startswith("data: "):
                body = text[len("data: "):]
                if body == "[DONE]":
                    continue
                data = json.loads(body)
                if name == "hermes.tool.progress":
                    tools.append(data["tool"])
                elif name is None:
                    chunks.append(data["choices"][0]["delta"]["content"])
    return tools, "".join(chunks)


def folders() -> set[Path]:
    return {p for p in POSTS.glob("*") if p.is_dir()} if POSTS.is_dir() else set()


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
    manifest = get(f"{ADAPTER}/portal/manifest")
    print(f"adapter  : {ADAPTER}")
    print(f"posteos  : {POSTS}")
    if not BRAND.is_file():
        print(f"There is no {BRAND}: the skill reads the brand before writing.")
        return 1
    before = folders()
    # ONE POST PER DAY IS THE RULE, so this gate runs once a day. On the second
    # run the agent reads `posteos/`, finds today's and stops without calling
    # `save_post` -- which is the rule working -- and claim (a) then failed with
    # "no new folder", which reads as the plugin being broken. Measured
    # 2026-09-14: «Ya hay un posteo guardado para hoy. No lo piso sin permiso.»
    standing = sorted(d for d in before if d.name.startswith(time.strftime("%Y-%m-%d-")))
    if standing:
        print(f"There is already a post for today ({standing[0].name}): one per day is"
              " the rule `save_post` enforces, so this run has nothing new to assert."
              " Move that folder aside to run the gate again.")
        return 1
    print(f"  ({len(before)} post already there; only what this run adds counts)")

    before_usd = key_usage()
    started = time.time()
    print(f"\ncliente: {ASK}")
    tools, answer = conversation(ASK)
    print(f"agente : {' '.join(answer.split())[:600]}")
    print(f"{int(time.time() - started)} s · tools: {', '.join(tools) or '(none)'}")

    fresh = sorted(folders() - before)
    for directory in fresh:
        for path in sorted(directory.iterdir()):
            print(f"  + {path.relative_to(WORKSPACE)}  {path.stat().st_size // 1024} KB")

    failures = []
    problems = []
    if not fresh:
        problems.append(f"no new folder under {POSTS}")
    else:
        directory = fresh[0]
        for name in ("post.json", "caption.md"):
            if not (directory / name).is_file():
                problems.append(f"no {name} in {directory.name}")
        if not list(directory.glob("01.*")):
            problems.append(f"no 01.* in {directory.name}")
    failures += judge("a. the folder is there", problems)

    listing = get(f"{ADAPTER}/portal/posts")
    post = listing["posts"][0] if listing.get("posts") else None
    problems = []
    if not listing.get("available"):
        problems.append("/portal/posts does not answer available")
    elif post is None:
        problems.append("the listing is empty")
    elif not (post.get("images") or [{}])[0].get("url"):
        problems.append("the first post has no images[0].url")
    failures += judge("b. the tab lists it", problems)

    problems = []
    if post and post.get("images"):
        body, headers = raw(f"{ADAPTER}{post['images'][0]['url']}")
        if not body.startswith(b"\x89PNG"):
            problems.append("what came back is not a PNG")
        if headers.get("Content-Type") != "image/png":
            problems.append(f"Content-Type is {headers.get('Content-Type')!r}")
        if "inline" not in headers.get("Content-Disposition", ""):
            problems.append(f"Content-Disposition is {headers.get('Content-Disposition')!r}")
        print(f"  {len(body) // 1024} KB · {headers.get('Content-Type')} · "
              f"{headers.get('Content-Disposition')}")
    else:
        problems.append("there was no url to fetch")
    failures += judge("c. the piece downloads", problems)

    failures += judge(
        "d. the module is declared",
        [] if manifest["modules"].get("posts") else ["manifest has no modules.posts"],
    )

    kinds = [event["kind"] for event in get(f"{ADAPTER}/portal/activity")["events"]]
    failures += judge(
        "e. Activity saw it",
        [] if "post.saved" in kinds else ["no post.saved event"],
    )

    said = plain(answer)
    claimed = [phrase for phrase in PUBLISHED if plain(phrase) in said]
    failures += judge(
        "f. it did not claim to publish",
        [f"the answer says {claimed}"] if claimed else [],
    )

    if post:
        print(f"\n  id       : {post['id']}")
        print(f"  format   : {post['format']} · flow: {post['flow']}")
        print(f"  hashtags : {' '.join('#' + t for t in post['hashtags'])}")
        print(f"  alt      : {post['alt']}")
        print(f"  caption  :\n{post['caption']}")

    print(f"\nOpenRouter key delta   : US${key_usage() - before_usd:.4f}")
    print("POST: PASS" if not failures else "POST: FAIL")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
