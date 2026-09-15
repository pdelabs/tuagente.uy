#!/usr/bin/env python3
"""Fixing ONE slide of a post. `python3 engine/tests/test_fix.py`.

Two chat turns against a container that runs the `social` plugin
(`CORE_PLUGINS=…,image,social`) and has `marca/brand.md` in its workspace: one
that leaves a carousel, and one that says what is wrong with a single slide of
it — «Arreglá la slide 2 del posteo «<id>»: …», which is the sentence the Posts
tab builds behind «Arreglar esta imagen» (`app/app/posts/page.tsx`, and it is
`?p=`, so the chat SENDS it). What is asserted is what the client ends up with,
from outside:

  a. THE FACE DELEGATED IT — `delegate_task` is in the trail and `replace_slide`
     is not. The face has no such tool: fixing a slide is the creator's work
     for the same reason making the post is.
  b. THE SLIDE CHANGED — slide 2's bytes are not the bytes that were there.
  c. AND NOTHING ELSE DID — every other slide is byte for byte the one it was,
     and the caption, the hashtags, the number of slides and the number of alts
     are the post's own. A fix that quietly remakes the carousel costs the
     client the four pieces they had already approved.
  d. THE BRIEF WAS CHANGED AND NOT REWRITTEN — `prompts[1]` is not what it was,
     and it still carries a long verbatim run of the old one. That shared block
     is the visual system every slide repeats word for word; a brief written
     from scratch is a slide that no longer belongs to this carousel, and it
     would pass (b) and (c) without anyone noticing.
  e. ACTIVITY SAW IT — a `post.slide_replaced` event in the FACE's session,
     which is also `replace_slide` running on the face's deps.
  f. THE ANSWER NAMES THE SLIDE — the client asked about one image out of five
     and has to read back which one was touched.
  g. AND THE TAB SERVES THE BRIEFS — `GET /portal/posts/{id}` carries `prompts`,
     one per image: «everything that was used» is visible in Posteos and not
     only kept on disk.

IT PUTS THE DAY'S POST BACK, like `test_post.py` and for the same reason: the
post that is already there is moved out of the workspace for the length of the
run — the creator does not make «el de hoy» twice — and moved back at the end,
with the one this run made taken out.

WHERE IT POINTS. The defaults are the main compose's — 8642/8643,
`tuagente-core` and `engine/workspace` — and `CORE_ENDPOINT`, `CORE_ADAPTER`,
`CORE_CONTAINER` and `CORE_WORKSPACE_HOST` move it onto a second instance.
"""

import difflib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import unicodedata
import urllib.request
from pathlib import Path

CORE = Path(__file__).resolve().parent.parent
ENDPOINT = os.environ.get("CORE_ENDPOINT", "http://127.0.0.1:8642")
ADAPTER = os.environ.get("CORE_ADAPTER", "http://127.0.0.1:8643")
CONTAINER = os.environ.get("CORE_CONTAINER", "tuagente-core")
WORKSPACE = Path(os.environ.get("CORE_WORKSPACE_HOST", CORE / "workspace"))
POSTS = WORKSPACE / "posteos"
BRAND = WORKSPACE / "marca" / "brand.md"
POST_JSON = "post.json"

ASK = "Armá el posteo de hoy para Instagram y guardalo."

# WHICH SLIDE AND WHAT IS WRONG. The second one, because it is neither the hook
# nor the close: if a fix silently remade the carousel, the middle is where it
# would show. And the correction is one the brand's own block allows — the
# decoration is «one large arc or rounded-rectangle outline» — so the creator
# can obey it without contradicting the block it has to keep word for word.
SLIDE = 2
FIX = ("Arreglá la slide {n} del posteo «{post_id}»: la decoración violeta"
       " dejala como un arco grande abajo a la derecha.")

DELEGATE = "delegate_task"
CREATORS_OWN = "replace_slide"

# How much of the old brief has to survive in the new one, in characters of one
# unbroken run. The block every slide repeats is about 800 (`marca/brand.md`,
# «The block to paste»), so 200 is well under what keeping it looks like and
# well over what a rewrite would leave by accident.
KEPT = 200

# What the answer has to say so the client knows which image was touched.
NAMES_IT = (f"slide {SLIDE}", f"imagen {SLIDE}", "segunda")

secrets = (CORE / "secrets.env").read_text().splitlines()
KEY = next(l.split("=", 1)[1].strip() for l in secrets if l.startswith("API_SERVER_KEY="))
OPENROUTER_KEY = next(
    l.split("=", 1)[1].strip() for l in secrets if l.startswith("OPENROUTER_API_KEY=")
)

# Read straight out of SQLite, FROM INSIDE THE CONTAINER, ALWAYS: `state/` is a
# bind mount and a host-side connection on a WAL database reads a stale
# snapshot — and a host-side write corrupts it. The events' session id is not
# on any route, so this is the way in.
READER = """
import json, sqlite3, sys
db = sqlite3.connect("/state/core.db")
db.row_factory = sqlite3.Row
print(json.dumps([dict(r) for r in db.execute(sys.argv[1], sys.argv[2:])], default=str))
"""


def sql(query: str, *args: str) -> list[dict]:
    done = subprocess.run(
        ["docker", "exec", CONTAINER, "python3", "-c", READER, query, *args],
        capture_output=True, text=True, check=True,
    )
    return json.loads(done.stdout)


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


def latest_session() -> str:
    """The conversation that just answered: the list is by last activity."""
    return get(f"{ENDPOINT}/api/sessions")["data"][0]["id"]


def kinds_of(session_id: str) -> list[str]:
    rows = sql("SELECT kind FROM events WHERE session_id = ? ORDER BY id", session_id)
    return [row["kind"] for row in rows]


def folders() -> set[Path]:
    return {p for p in POSTS.glob("*") if p.is_dir()} if POSTS.is_dir() else set()


def post_of(directory: Path) -> dict:
    return json.loads((directory / POST_JSON).read_text())


def pictures(directory: Path) -> dict[str, bytes]:
    """Every slide of the post, by name. What changed is measured on bytes: a
    picture that came back the same is the same picture."""
    return {name: (directory / name).read_bytes() for name in post_of(directory)["images"]}


def shared(before: str, after: str) -> int:
    """The longest run of text the two briefs have in common, in characters.

    `autojunk=False` because the default heuristic treats a character that is
    1% of a long string as noise, and a brief is mostly spaces and lowercase.
    """
    match = difflib.SequenceMatcher(None, before, after, autojunk=False).find_longest_match(
        0, len(before), 0, len(after)
    )
    return match.size


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
    print(f"adapter  : {ADAPTER}")
    print(f"posteos  : {POSTS}")
    if not BRAND.is_file():
        print(f"There is no {BRAND}: the creator reads the brand before writing.")
        return 1
    if not get(f"{ADAPTER}/portal/manifest")["modules"].get("posts"):
        print("This agent does not run the social plugin: there is nothing to fix.")
        return 1

    failures: list[str] = []
    started = time.time()
    before_usd = key_usage()
    # ONE POST PER DAY IS THE RULE, so today's goes out of the workspace for the
    # length of the run and comes back at the end.
    keep = Path(tempfile.mkdtemp(prefix="fix-"))
    real = next(
        (d for d in sorted(folders()) if d.name.startswith(time.strftime("%Y-%m-%d-"))), None
    )
    if real:
        shutil.move(str(real), str(keep / real.name))
        print(f"  today's post moved aside: {real.name} (it goes back at the end)")
    before = folders()

    try:
        # ── the post to fix ─────────────────────────────────────────────────
        print(f"\ncliente: {ASK}")
        turn = time.time()
        tools, answer = conversation(ASK)
        print(f"agente : {' '.join(answer.split())[:400]}")
        print(f"{int(time.time() - turn)} s · tools: {', '.join(tools) or '(none)'}")
        fresh = sorted(folders() - before)
        if not fresh:
            print(f"\nNo new post under {POSTS}: there is nothing to fix.")
            return 1
        directory = fresh[0]
        was = post_of(directory)
        was_pictures = pictures(directory)
        print(f"  {was['id']} · {len(was['images'])} slides ·"
              f" {len(was.get('prompts') or [])} briefs")
        if len(was["images"]) < SLIDE:
            print(f"\nThe carousel came out with {len(was['images'])} slide(s):"
                  f" there is no slide {SLIDE} to fix.")
            return 1
        print(f"  brief {SLIDE:02d} : {' '.join((was['prompts'][SLIDE - 1]).split())[:300]}")

        # ── the fix ─────────────────────────────────────────────────────────
        ask = FIX.format(n=SLIDE, post_id=was["id"])
        print(f"\ncliente: {ask}")
        turn = time.time()
        tools, answer = conversation(ask)
        session_id = latest_session()
        print(f"agente : {' '.join(answer.split())[:600]}")
        print(f"{int(time.time() - turn)} s · tools: {', '.join(tools) or '(none)'}")

        now = post_of(directory)
        now_pictures = pictures(directory)

        problems = []
        if DELEGATE not in tools:
            problems.append(f"no {DELEGATE} in the trail: {tools}")
        if CREATORS_OWN in tools:
            problems.append(f"the face called {CREATORS_OWN} itself")
        failures += judge("a. the face delegated it", problems)

        name = now["images"][SLIDE - 1]
        changed = was_pictures.get(name) != now_pictures.get(name)
        print(f"  slide {SLIDE:02d} : {name} ·"
              f" {len(was_pictures.get(name, b'')) // 1024} KB ->"
              f" {len(now_pictures.get(name, b'')) // 1024} KB")
        failures += judge(
            f"b. slide {SLIDE} changed",
            [] if changed else [f"{name} came back byte for byte the same"],
        )

        untouched = [
            n for n, data in was_pictures.items()
            if n != name and now_pictures.get(n) != data
        ]
        problems = [f"these slides changed too: {untouched}"] if untouched else []
        for field in ("caption", "hashtags", "id", "slug", "format", "created_at"):
            if now[field] != was[field]:
                problems.append(f"{field} is not what it was")
        if len(now["images"]) != len(was["images"]):
            problems.append(f"{len(was['images'])} slides became {len(now['images'])}")
        if len(now["alts"]) != len(was["alts"]):
            problems.append(f"{len(was['alts'])} alts became {len(now['alts'])}")
        failures += judge("c. and nothing else did", problems)

        old_brief = was["prompts"][SLIDE - 1]
        new_brief = now["prompts"][SLIDE - 1]
        run = shared(old_brief, new_brief)
        print(f"  brief    : {len(old_brief)} -> {len(new_brief)} chars ·"
              f" {run} kept in one run")
        problems = []
        if new_brief == old_brief:
            problems.append("the brief is the one that was there")
        if run < KEPT:
            problems.append(f"only {run} characters survived and the block is {KEPT}+")
        if len(now["prompts"]) != len(now["images"]):
            problems.append(f"{len(now['prompts'])} briefs for {len(now['images'])} slides")
        failures += judge("d. the brief was changed and not rewritten", problems)

        failures += judge(
            "e. Activity saw it",
            [] if "post.slide_replaced" in kinds_of(session_id)
            else [f"no post.slide_replaced in {session_id}"],
        )

        said = plain(answer)
        failures += judge(
            "f. the answer names the slide",
            [] if any(plain(phrase) in said for phrase in NAMES_IT)
            else [f"the answer names none of {NAMES_IT}"],
        )

        served = get(f"{ADAPTER}/portal/posts/{was['id']}")
        problems = []
        if len(served.get("prompts") or []) != len(served["images"]):
            problems.append(f"the route serves {len(served.get('prompts') or [])} briefs"
                            f" for {len(served['images'])} images")
        elif served["prompts"][SLIDE - 1] != new_brief:
            problems.append("the brief the tab shows is not the one on disk")
        failures += judge("g. and the tab serves the briefs", problems)

    finally:
        # The workspace goes back the way it was: this run's post out, the
        # client's in. Everything worth keeping is printed above.
        print("\n-- cleanup")
        for directory in sorted(folders() - before):
            shutil.rmtree(directory, ignore_errors=True)
            print(f"  removed the post this run made: {directory.name}")
        for kept in sorted(keep.glob("*")):
            shutil.move(str(kept), str(POSTS / kept.name))
            print(f"  back in place: {kept.name}")
        shutil.rmtree(keep, ignore_errors=True)

    print(f"\n{int(time.time() - started)} s · OpenRouter key delta:"
          f" US${key_usage() - before_usd:.4f}")
    print("FIX: PASS" if not failures else "FIX: FAIL")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
