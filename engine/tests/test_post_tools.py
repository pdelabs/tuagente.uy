#!/usr/bin/env python3
"""A post's tools cannot lose a post. `python3 engine/tests/test_post_tools.py`.

The three tools of `kit/plugins/social/core/posts.py` called DIRECTLY INSIDE
THE CONTAINER, with no model and no generation: throwaway pictures with their
sidecars, a throwaway post, and the two calls that cost our own agent four
finished slides on 2026-09-15 — plus the tool that should have been called
instead of them. Free, a second, and every claim is about what is left on disk:

  a. A PICTURE THAT IS ALREADY IN A POST IS NOT AN INCOMING PICTURE —
     `save_post(replace=True, images=["posteos/<id>/01.png"])` comes back as a
     `ModelRetry` naming `update_caption` and `replace_slide`, and the post is
     untouched. That call is what the creator made when it was asked for a
     better caption and had no tool for words: `replace` deleted the folder and
     the first `brief_of` then died on a sidecar that was inside it.
  b. A SAVE THAT FAILS HALFWAY LEAVES THE POST THAT WAS THERE — the same
     `replace=True` with a sidecar deliberately missing raises, and afterwards
     the old post has its own `post.json`, its own pictures, byte for byte.
     The new post is built beside it and swapped in at the end; what a failure
     leaves behind is the half-built folder, never the finished one.
  c. WORDS ARE CHANGED WITH `update_caption` — the caption, the hashtags and
     the alts in `post.json`, `caption.md` rewritten from the same two fields,
     the pictures untouched, and a `post.updated` event. An unknown post and a
     post that is already published both come back as words: what went out to
     Instagram is not rewritten from here, and the refusal carries the
     permalink because that is the fact that settles it.

IT CLEANS UP AFTER ITSELF: the post, the pictures, the scratch folders and the
events it wrote are gone by the end, whatever happened.

WHERE IT POINTS. `CORE_CONTAINER` moves it onto a second instance; the default
is the main compose's `tuagente-core`.
"""

import json
import os
import subprocess
import sys

CONTAINER = os.environ.get("CORE_CONTAINER", "tuagente-core")

SLUG = "prueba-de-herramientas"
CAPTION = "El pie que estaba, escrito por la prueba."
NEW_CAPTION = "El pie nuevo, que es lo único que cambia."
PERMALINK = "https://www.instagram.com/p/PRUEBA/"

INSIDE = r"""
import json, sqlite3, sys, types
from pathlib import Path

sys.path.insert(0, "/opt/kit/plugins/social/core")
import posts

SLUG, CAPTION, NEW_CAPTION, PERMALINK = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
SESSION = "prueba-post-tools"
WS = Path("/workspace")
IMG = WS / "imagenes"
made = []


# A throwaway slide with its sidecar, the shape `generate_image` leaves.
def picture(name, prompt, brief=True):
    path = IMG / name
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + name.encode())
    made.append(path)
    if brief:
        sidecar = path.with_suffix(".json")
        sidecar.write_text(json.dumps({"prompt": prompt, "format": "feed",
                                       "model": "prueba", "created_at": "2026-09-15T09:00:00-03:00"}))
        made.append(sidecar)
    return f"imagenes/{name}"


# The tool, and what it said if it refused.
def call(tool, *args, **kwargs):
    try:
        return {"ok": tools[tool](ctx, *args, **kwargs)}
    except Exception as exc:
        return {"raised": type(exc).__name__, "said": str(exc)}


IMG.mkdir(parents=True, exist_ok=True)
tools = {name: tool.function for name, tool in posts.toolset().tools.items()}
ctx = types.SimpleNamespace(deps=types.SimpleNamespace(workspace=WS, session_id=SESSION))
report = {}
directory = None
try:
    saved = tools["save_post"](
        ctx, SLUG, CAPTION, ["uno", "dos"], "carousel",
        [picture("prueba-a.png", "brief uno"), picture("prueba-b.png", "brief dos")],
        None, ["alt uno", "alt dos"], True,
    )
    post_id = saved["saved"]
    directory = posts.folder(post_id)
    report["saved"] = saved
    before = {p.name: p.read_bytes() for p in sorted(directory.iterdir()) if p.is_file()}

    # (a) the call that deleted the post.
    report["own_images"] = call(
        "save_post", SLUG, CAPTION, ["uno"], "carousel",
        [f"posteos/{post_id}/01.png"], None, ["alt uno"], True,
    )
    report["after_own_images"] = {
        p.name: p.read_bytes() == before.get(p.name)
        for p in sorted(directory.iterdir()) if p.is_file()
    }

    # (b) a save that dies halfway through moving the pictures in.
    good = picture("prueba-c.png", "brief tres")
    naked = picture("prueba-d.png", "", brief=False)
    report["missing_brief"] = call(
        "save_post", SLUG, "Otro pie", ["uno"], "carousel",
        [good, naked], None, ["alt uno", "alt dos"], True,
    )
    report["after_missing_brief"] = {
        p.name: p.read_bytes() == before.get(p.name)
        for p in sorted(directory.iterdir()) if p.is_file()
    }
    report["post_json_intact"] = (
        json.loads((directory / "post.json").read_text())["caption"] == CAPTION
    )
    report["left_behind"] = sorted(
        p.name for p in posts.root().iterdir() if p.name.startswith(posts.BUILDING)
    )
    report["listed"] = [p["id"] for p in posts.read_all()]

    # (c) the tool that should have been called in the first place.
    report["update"] = call(
        "update_caption", post_id, NEW_CAPTION, ["tres"], ["alt uno nuevo", "alt dos nuevo"]
    )
    data = json.loads((directory / "post.json").read_text())
    report["after_update"] = {
        "caption": data["caption"],
        "hashtags": data["hashtags"],
        "alts": data["alts"],
        "alt": data["alt"],
        "images": data["images"],
        "prompts": data["prompts"],
        "caption_md": (directory / "caption.md").read_text(),
        "pictures_intact": all(
            (directory / name).read_bytes() == before.get(name) for name in data["images"]
        ),
    }
    report["unknown_post"] = call("update_caption", "2026-01-01-no-existe", "Da igual")

    data["published"] = {"permalink": PERMALINK, "id": "1", "at": "2026-09-15T10:00:00-03:00"}
    (directory / "post.json").write_text(json.dumps(data, ensure_ascii=False, indent=2))
    report["already_published"] = call("update_caption", post_id, "Otro pie más")

    db = sqlite3.connect("/state/core.db")
    db.row_factory = sqlite3.Row
    report["events"] = [
        dict(row) for row in db.execute(
            "SELECT kind, label FROM events WHERE session_id = ? ORDER BY id", (SESSION,)
        )
    ]
    print(json.dumps(report))
finally:
    import shutil
    if directory is not None and directory.is_dir():
        shutil.rmtree(directory)
    for path in posts.root().iterdir() if posts.root().is_dir() else []:
        if path.name.startswith(posts.BUILDING):
            shutil.rmtree(path)
    for path in made:
        if path.is_file():
            path.unlink()
    db = sqlite3.connect("/state/core.db")
    db.execute("DELETE FROM events WHERE session_id = ?", (SESSION,))
    db.commit()
"""


def judge(name: str, problems: list[str]) -> list[str]:
    """One line per claim, so a failure is read where it happened."""
    print(f"  {name}: " + ("PASS" if not problems else "FAIL — " + "; ".join(problems)))
    return problems


def main() -> int:
    print(f"container: {CONTAINER}")
    done = subprocess.run(
        ["docker", "exec", CONTAINER, "python3", "-c", INSIDE,
         SLUG, CAPTION, NEW_CAPTION, PERMALINK],
        capture_output=True, text=True,
    )
    if done.returncode != 0:
        print(done.stderr.strip()[-1500:])
        print("POST TOOLS: FAIL")
        return 1
    r = json.loads(done.stdout)
    print(f"  {r['saved']}")

    failures = []
    problems = []
    refusal = r["own_images"]
    print(f"  {refusal.get('raised')}: {refusal.get('said', '')[:160]}")
    if refusal.get("raised") != "ModelRetry":
        problems.append(f"it did not refuse: {refusal}")
    else:
        said = refusal["said"]
        if "update_caption" not in said or "replace_slide" not in said:
            problems.append("the refusal does not name the two tools that do it")
    if not all(r["after_own_images"].values()) or len(r["after_own_images"]) < 4:
        problems.append(f"the post is not what it was: {r['after_own_images']}")
    failures += judge("a. a picture already in a post is refused", problems)

    problems = []
    broke = r["missing_brief"]
    print(f"  {broke.get('raised')}: {broke.get('said', '')[:120]}")
    if "raised" not in broke:
        problems.append(f"the save went through: {broke}")
    elif broke["raised"] == "ModelRetry":
        problems.append("a missing sidecar came back as a retry instead of breaking")
    if not all(r["after_missing_brief"].values()) or len(r["after_missing_brief"]) < 4:
        problems.append(f"the old post lost files: {r['after_missing_brief']}")
    if not r["post_json_intact"]:
        problems.append("post.json is not the one that was there")
    # The tab shows the post once and never the folder being built — whatever
    # else this workspace already had in `posteos/` is the client's and counts
    # for nothing here.
    if r["listed"].count(r["saved"]["saved"]) != 1:
        problems.append(f"the listing shows the post {r['listed'].count(r['saved']['saved'])} times")
    if any(name.startswith(".armando-") for name in r["listed"]):
        problems.append(f"the listing shows a half-built post: {r['listed']}")
    if not r["left_behind"]:
        problems.append("the pictures of the save that failed are nowhere")
    print(f"  left behind: {r['left_behind'] or '(nothing)'} · listing: {r['listed']}")
    failures += judge("b. a save that fails leaves the post that was there", problems)

    problems = []
    if "ok" not in r["update"]:
        problems.append(f"update_caption refused: {r['update']}")
    else:
        after = r["after_update"]
        if after["caption"] != NEW_CAPTION:
            problems.append(f"the caption is {after['caption']!r}")
        if after["hashtags"] != ["tres"]:
            problems.append(f"the hashtags are {after['hashtags']}")
        if after["alts"] != ["alt uno nuevo", "alt dos nuevo"]:
            problems.append(f"the alts are {after['alts']}")
        if after["alt"] != "alt uno nuevo":
            problems.append(f"the post's own alt is {after['alt']!r}")
        if after["caption_md"] != f"{NEW_CAPTION}\n\n#tres\n":
            problems.append(f"caption.md is {after['caption_md']!r}")
        if not after["pictures_intact"] or len(after["images"]) != 2:
            problems.append("the pictures are not the ones that were there")
        if after["prompts"] != ["brief uno", "brief dos"]:
            problems.append(f"the briefs changed: {after['prompts']}")
    if r["unknown_post"].get("raised") != "ModelRetry":
        problems.append(f"an unknown post gave {r['unknown_post']}")
    published = r["already_published"]
    if published.get("raised") != "ModelRetry":
        problems.append(f"a published post gave {published}")
    elif PERMALINK not in published["said"]:
        problems.append("the refusal does not carry the permalink")
    kinds = [event["kind"] for event in r["events"]]
    if "post.updated" not in kinds:
        problems.append(f"no post.updated event: {kinds}")
    print(f"  {published.get('said', '')[:160]}")
    print(f"  events: {', '.join(kinds)}")
    failures += judge("c. words are changed with update_caption", problems)

    print("POST TOOLS: PASS" if not failures else "POST TOOLS: FAIL")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
