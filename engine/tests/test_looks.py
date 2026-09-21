#!/usr/bin/env python3
"""No two posts alike in a row, and code is who says so. `python3 engine/tests/test_looks.py`.

`kit/plugins/social/core/looks.py` and the half of `save_post` that uses it,
called DIRECTLY INSIDE THE CONTAINER: no model, no image, a second. The brand
file is a fixture written for the test and put back on the way out, so what is
asserted is the mechanism and not our own brand.

WHY. On our own agent every post came out dark with thin violet lines
(2026-09-20): the brand file called that look the default, the skill's checklist
called it «the brand», and a model left to choose picks the safe one every day.

  a. THE BRAND DECLARES ITS LOOKS — every «### The `name` block» with a fenced
     block under it is one, in the file's order. The module names none.
  b. A BRIEF'S LOOK IS READ OFF IT — the block re-wrapped by a model, with the
     slide's own lines after it, is still that look; so is a block with a SLOT
     the creator filled in, early in it; blocks that share sentences are not
     confused; a brief with no block has no look.
  c. A POST FROM BEFORE HAS A LOOK TOO — no `look` key, and its first brief
     says which.
  d. HALF THE WARDROBE RESTS — with four looks, the last two posts' looks are
     off today; with two looks it is strict alternation.
  e. THE CREATOR IS TOLD — what the last posts wore, what rests, what is free.
  f. `save_post` REFUSES A RESTING LOOK BEFORE IT MOVES A FILE — the pictures
     are still in `imagenes/`, no post exists, and the refusal names what is
     free. A look the client asked for by name goes through, and is recorded.
  g. AND A FREE ONE IS SAVED AND WRITTEN DOWN — `look` in `post.json`.
  h. A CAROUSEL IS A STORY OR IT IS NOT SAVED — `save_post` refuses one with no
     `structure` and no `goal`, writes both down, and the creator is told which
     structures the last carousels used and that the last two rest.

WHERE IT POINTS. `CORE_CONTAINER` moves it onto a second instance. NOT ONTO A
CLIENT'S: it swaps `marca/brand.md` for the length of the run.
"""

import json
import os
import subprocess
import sys

CONTAINER = os.environ.get("CORE_CONTAINER", "tuagente-core")

INSIDE = r"""
import json, shutil, sys, types
from pathlib import Path

sys.path.insert(0, "/opt/kit/plugins/social/core")
import looks
import posts
from PIL import Image

from core import config

WS = config.WORKSPACE
BRAND = WS / looks.BRAND
SHARED = ("Instagram slide, 1080x1350 portrait. Headline in a geometric sans-serif, extra bold, sentence case, "
          "left aligned, tight line height, text block starting 9% from the left edge, at most 75% wide. ")
TAIL = " The ONLY text on the image is the headline below, reproduced character by character."
BLOCKS = {
    "noche": SHARED + "Flat solid dark background, white type, thin violet lines running off the edge." + TAIL,
    "dia": SHARED + "Flat solid off-white background, dark type, thin violet lines running off the edge." + TAIL,
    "color": SHARED + "Flat solid saturated violet background, white type, big tone on tone circles." + TAIL,
    # THE SLOT IS EARLY, the way a real block has it: the creator replaces PLACE,
    # so everything from there on is not the block's words any more.
    "foto": "Instagram slide, 1080x1350 portrait. A real editorial photograph, full bleed, of PLACE. "
            "Shallow depth of field, honest, never a stock photo. The lower 45% fades into a dark band. "
            "On that band, the headline in a geometric sans-serif, extra bold, white." + TAIL,
}


def brand(names):
    parts = ["# Marca de prueba", "", "### Something that is not a look", "", "```", "not a block", "```", ""]
    for name in names:
        parts += [f"### The `{name}` block", "", "A line of prose before the fence.", "", "```", BLOCKS[name], "```", ""]
    BRAND.write_text("\n".join(parts))


def brief(name, line):
    # Re-wrapped at 60 columns, the way a model hands a block back, plus the slide's own lines.
    words, rows, row = BLOCKS[name].replace("PLACE", "a bakery in Salto at dawn").split(), [], ""
    for word in words:
        if len(row) + len(word) > 60:
            rows.append(row); row = ""
        row = f"{row} {word}".strip()
    return "\n".join(rows + [row]) + f"\n\nHeadline: {line}\nMarked phrase: none"


made = []
def picture(name, prompt):
    path = WS / "imagenes" / f"prueba-look-{name}.png"
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (8, 10), "white").save(path)
    path.with_suffix(".json").write_text(json.dumps({"prompt": prompt, "format": "feed"}))
    made.append(path)
    return f"imagenes/{path.name}"


save = posts.toolset().tools["save_post"].function
ctx = types.SimpleNamespace(deps=types.SimpleNamespace(workspace=WS, session_id="prueba-looks"))
def try_save(slug, image, **more):
    try:
        return {"ok": save(ctx, slug, "Un pie.", ["prueba"], "feed", [image], alt="Una imagen.", **more)}
    except Exception as exc:
        return {"raised": type(exc).__name__, "said": str(exc)}


original = BRAND.read_text() if BRAND.is_file() else None
hidden = posts.root().with_name("posteos.prueba-looks")
out = {}
try:
    # The client's posts step aside: the rotation reads the folder.
    if posts.root().is_dir():
        posts.root().rename(hidden)
    posts.root().mkdir()

    brand(["noche", "dia", "color", "foto"])
    blocks = looks.declared()
    out["declared"] = list(blocks)
    out["read"] = {name: looks.of_brief(brief(name, "Una línea."), blocks) for name in BLOCKS}
    out["no_block"] = looks.of_brief("A cat on a sofa, photorealistic.", blocks)
    out["old_post"] = looks.of_post({"prompts": [brief("dia", "Otra.")]}, blocks)
    out["rest_four"] = looks.resting(["foto", "noche", "dia", None], blocks)
    out["rest_two"] = looks.resting(["dia", "noche"], {k: BLOCKS[k] for k in ("noche", "dia")})
    out["first_day"] = looks.today([])

    out["saved_noche"] = try_save("prueba-uno", picture("uno", brief("noche", "Uno.")))
    out["saved_foto"] = try_save("prueba-dos", picture("dos", brief("foto", "Dos.")))
    out["told"] = looks.today(posts.read_all())

    resting = picture("tres", brief("noche", "Tres."))
    out["refused"] = try_save("prueba-tres", resting)
    out["still_there"] = (WS / resting).is_file()
    out["no_post"] = not any(p.name.endswith("prueba-tres") for p in posts.root().iterdir())
    out["asked"] = try_save("prueba-tres", resting, look_asked_by_client=True)
    out["free"] = try_save("prueba-cuatro", picture("cuatro", brief("color", "Cuatro.")))
    out["written"] = {p["slug"]: p.get("look") for p in posts.read_all()}

    # (h) the story. A carousel needs two pictures' worth of arguments.
    def carousel(slug, tag, **more):
        try:
            return {"ok": save(ctx, slug, "Un pie.", ["prueba"], "carousel",
                               [picture(f"{tag}a", brief("dia", "A.")), picture(f"{tag}b", brief("dia", "B."))],
                               alts=["Una.", "Otra."], **more)}
        except Exception as exc:
            return {"raised": type(exc).__name__, "said": str(exc)}
    out["no_story"] = carousel("prueba-cinco", "cinco")
    out["story"] = carousel("prueba-seis", "seis", structure="mito", goal="mandar")
    out["story_written"] = {p["slug"]: [p.get("structure"), p.get("goal")]
                            for p in posts.read_all() if p["slug"] == "prueba-seis"}
    out["story_told"] = looks.story_today(posts.read_all())
    print(json.dumps(out, ensure_ascii=False, default=str))
finally:
    shutil.rmtree(posts.root(), ignore_errors=True)
    if hidden.is_dir():
        hidden.rename(posts.root())
    if original is None:
        BRAND.unlink(missing_ok=True)
    else:
        BRAND.write_text(original)
    for path in made:
        path.unlink(missing_ok=True)
        path.with_suffix(".json").unlink(missing_ok=True)
    from core import db
    db.write("DELETE FROM events WHERE session_id = ?", ("prueba-looks",))
"""


def judge(name: str, problems: list[str]) -> list[str]:
    """One line per claim, so a failure is read where it happened."""
    print(f"  {name}: " + ("PASS" if not problems else "FAIL — " + "; ".join(problems)))
    return problems


def main() -> int:
    print(f"container: {CONTAINER}")
    done = subprocess.run(
        ["docker", "exec", CONTAINER, "python3", "-c", INSIDE],
        capture_output=True, text=True,
    )
    if done.returncode != 0:
        print(done.stderr.strip()[-2000:])
        print("LOOKS: FAIL")
        return 1
    r = json.loads(done.stdout.strip().splitlines()[-1])
    failures = []

    problems = [] if r["declared"] == ["noche", "dia", "color", "foto"] else [f"it found {r['declared']}"]
    failures += judge("a. the brand declares its looks", problems)

    problems = [f"a `{k}` brief read as {v}" for k, v in r["read"].items() if k != v]
    if r["no_block"] is not None:
        problems.append(f"a brief with no block read as {r['no_block']}")
    failures += judge("b. a brief's look is read off it", problems)

    problems = [] if r["old_post"] == "dia" else [f"it read {r['old_post']}"]
    failures += judge("c. a post from before has a look too", problems)

    problems = []
    if r["rest_four"] != ["foto", "noche"]:
        problems.append(f"with four looks, {r['rest_four']} rest")
    if r["rest_two"] != ["dia"]:
        problems.append(f"with two looks, {r['rest_two']} rest")
    failures += judge("d. half the wardrobe rests", problems)

    problems = []
    if "Todavía no hay posteos" not in r["first_day"]:
        problems.append("the first day is not told as the first day")
    told = r["told"]
    # The two posts are saved within the same second, so which is «newest» is
    # not this test's to say: what rests is the PAIR, in either order.
    resting = told.split("Hoy no podés usar: ")[-1].split(".**")[0]
    if sorted(resting.replace("`", "").split(", ")) != ["foto", "noche"]:
        problems.append(f"what rests is not said: {told[:220]!r}")
    if "Elegí entre: `dia`, `color`" not in told:
        problems.append("what is free is not said")
    failures += judge("e. the creator is told", problems)

    problems = []
    if r["refused"].get("raised") != "ModelRetry":
        problems.append(f"a resting look gave {r['refused']}")
    elif "`dia`" not in r["refused"]["said"] or "`color`" not in r["refused"]["said"]:
        problems.append(f"the refusal does not name what is free: {r['refused']['said']!r}")
    if not r["still_there"]:
        problems.append("the refusal moved the picture")
    if not r["no_post"]:
        problems.append("the refusal left a post behind")
    if "ok" not in r["asked"]:
        problems.append(f"a look the client asked for gave {r['asked']}")
    failures += judge("f. save_post refuses a resting look before it moves a file", problems)

    problems = []
    if "ok" not in r["free"]:
        problems.append(f"a free look gave {r['free']}")
    expected = {"prueba-uno": "noche", "prueba-dos": "foto", "prueba-tres": "noche", "prueba-cuatro": "color"}
    if r["written"] != expected:
        problems.append(f"post.json says {r['written']}")
    failures += judge("g. and a free one is saved and written down", problems)

    problems = []
    if r["no_story"].get("raised") != "ModelRetry" or "structure" not in r["no_story"].get("said", ""):
        problems.append(f"a carousel with no story gave {r['no_story']}")
    if "ok" not in r["story"]:
        problems.append(f"a carousel with one gave {r['story']}")
    if r["story_written"] != {"prueba-seis": ["mito", "mandar"]}:
        problems.append(f"post.json says {r['story_written']}")
    if "Hoy no repitas: `mito`" not in r["story_told"]:
        problems.append(f"the creator is told {r['story_told']!r}")
    failures += judge("h. a carousel is a story or it is not saved", problems)

    print("LOOKS: " + ("PASS" if not failures else "FAIL"))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
