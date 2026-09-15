#!/usr/bin/env python3
"""The brand's picture pasted onto a slide. `python3 engine/tests/test_place.py`.

`place_image` called DIRECTLY INSIDE THE CONTAINER, with no model in the loop
and nothing generated: a throwaway slide with its sidecar, a throwaway asset in
`marca/`, and the tool. Free, a second, and it is the whole of what this tool
has to get right, because what it does is arithmetic and not judgement:

  a. THE PICTURE LANDED AND THE BARE ONE STAYED — a new `imagenes/<n>.png` with
     its own sidecar, and the slide it was made from still where it was, with
     its own. The creator chooses between the two, so losing the bare one would
     be the tool deciding for it.
  b. IT IS STILL THE SLIDE — the same pixel size. A composite that resized the
     piece would be a carousel where one slide is a different shape.
  c. THE ASSET IS IN THE CORNER, AND ITS TRANSPARENCY SURVIVED — the asset's
     opaque half is the asset's colour at the corner it was asked for, the
     quadrant it left transparent is still the slide's background, and so is a
     point far from that corner. Pasted without its own mask, a cut-out arrives
     inside a black box — which looks like a bug of the image model and is not.
  d. THE BRIEF SAYS WHAT WAS PLACED — the sidecar carries the slide's own
     prompt plus one line naming the asset and the corner, the format copied,
     and `model` «place_image» so nobody reads the asset as something the model
     drew. That brief is where a fix of this slide would start.
  e. THE MODEL SEES WHAT IT MADE — the return is the line with the path AND the
     picture, the same two things `generate_image` answers, which is what puts
     the composite in front of the creator's checklist.
  f. AND AN ASSET THAT IS NOT THERE COMES BACK AS WORDS — a `ModelRetry` that
     lists what `marca/` does have, so the model picks a name instead of
     guessing another one.

IT CLEANS UP AFTER ITSELF: the slide, the asset, the composite and both
sidecars are gone by the end, whatever happened.

WHERE IT POINTS. `CORE_CONTAINER` moves it onto a second instance; the default
is the main compose's `tuagente-core`.
"""

import json
import os
import subprocess
import sys

CONTAINER = os.environ.get("CORE_CONTAINER", "tuagente-core")

# The slide, the asset, and what the tool is asked for. The numbers are here so
# the arithmetic is asserted against something written down, not against what
# the code happens to compute: 600 × 0.28 = 168 wide, 600 × 0.06 = 36 of air,
# so a square asset sits at (396, 546) of a 600×750 slide.
WIDE, TALL = 600, 750
SIZE, MARGIN = 0.28, 0.06
CORNER = "bottom-right"
PLACED = 168
GAP = 36
BACKGROUND = (20, 19, 31, 255)
ASSET_COLOUR = (233, 76, 61, 255)
PROMPT = "Instagram slide, fondo #14131F, titular blanco. Titular: la prueba."

INSIDE = r"""
import json, sys, types
from pathlib import Path
from PIL import Image

sys.path.insert(0, "/opt/kit/plugins/social/core")
import stamp

WIDE, TALL, SIZE, MARGIN, CORNER, PROMPT = (
    int(sys.argv[1]), int(sys.argv[2]), float(sys.argv[3]), float(sys.argv[4]),
    sys.argv[5], sys.argv[6],
)
BACKGROUND = (20, 19, 31, 255)
ASSET_COLOUR = (233, 76, 61, 255)

slide = stamp.WHERE / "prueba-slide.png"
brief = slide.with_suffix(".json")
asset = stamp.ASSETS / "prueba-asset.png"
made = {"slide": slide, "brief": brief, "asset": asset}
out = None
try:
    stamp.WHERE.mkdir(parents=True, exist_ok=True)
    Image.new("RGBA", (WIDE, TALL), BACKGROUND).save(slide)
    brief.write_text(json.dumps({"prompt": PROMPT, "format": "feed",
                                 "model": "openai/gpt-5.4-image-2",
                                 "created_at": "2026-09-15T09:00:00-03:00"}))
    # A square with one transparent quadrant: what is pasted has to keep its
    # hole, and a paste without the mask fills it in.
    picture = Image.new("RGBA", (200, 200), ASSET_COLOUR)
    for x in range(100):
        for y in range(100):
            picture.putpixel((x, y), (0, 0, 0, 0))
    picture.save(asset)

    tools = {name: tool.function for name, tool in stamp.toolset().tools.items()}
    ctx = types.SimpleNamespace(
        deps=types.SimpleNamespace(workspace=Path("/workspace"), session_id="prueba")
    )
    answer = tools["place_image"](
        ctx, f"imagenes/{slide.name}", asset.name, CORNER, SIZE, MARGIN
    )
    line, image = answer[0], answer[1]
    out = Path(line.split(" en ", 1)[1])
    made["out"] = out
    made["out_brief"] = out.with_suffix(".json")

    composite = Image.open(out).convert("RGBA")
    width = round(WIDE * SIZE)
    gap = round(WIDE * MARGIN)
    left, top = WIDE - width - gap, TALL - width - gap
    refused = ""
    try:
        tools["place_image"](ctx, f"imagenes/{slide.name}", "no-existe.png", CORNER)
    except Exception as exc:
        refused = f"{type(exc).__name__}: {exc}"

    print(json.dumps({
        "out": str(out),
        "out_exists": out.is_file(),
        "out_brief": json.loads(out.with_suffix(".json").read_text()),
        "slide_kept": slide.is_file() and brief.is_file(),
        "size": list(composite.size),
        "placed": [width, gap, left, top],
        # Three quarters into the asset (opaque), one quarter in (the hole it
        # left), and a corner of the slide nothing was pasted on.
        "opaque": list(composite.getpixel((left + width * 3 // 4, top + width * 3 // 4))),
        "hole": list(composite.getpixel((left + width // 4, top + width // 4))),
        "far": list(composite.getpixel((10, 10))),
        "line": line,
        "media_type": image.media_type,
        "bytes": len(image.data),
        "refused": refused,
    }))
finally:
    for path in made.values():
        if path is not None and Path(path).is_file():
            Path(path).unlink()
"""


def judge(name: str, problems: list[str]) -> list[str]:
    """One line per claim, so a failure is read where it happened."""
    print(f"  {name}: " + ("PASS" if not problems else "FAIL — " + "; ".join(problems)))
    return problems


def main() -> int:
    print(f"container: {CONTAINER}")
    done = subprocess.run(
        ["docker", "exec", CONTAINER, "python3", "-c", INSIDE,
         str(WIDE), str(TALL), str(SIZE), str(MARGIN), CORNER, PROMPT],
        capture_output=True, text=True,
    )
    if done.returncode != 0:
        print(done.stderr.strip()[-1500:])
        print("PLACE: FAIL")
        return 1
    measured = json.loads(done.stdout)
    print(f"  {measured['line']}")
    print(f"  {measured['size'][0]}×{measured['size'][1]} · asset {measured['placed'][0]}px"
          f" at ({measured['placed'][2]}, {measured['placed'][3]})"
          f" · {measured['bytes'] // 1024} KB")

    failures = []
    problems = []
    if not measured["out_exists"]:
        problems.append("the composite is not on disk")
    if not measured["slide_kept"]:
        problems.append("the bare slide or its brief is gone")
    failures += judge("a. the picture landed and the bare one stayed", problems)

    failures += judge(
        "b. it is still the slide",
        [] if measured["size"] == [WIDE, TALL] else [f"it is {measured['size']}"],
    )

    problems = []
    if measured["placed"] != [PLACED, GAP, WIDE - PLACED - GAP, TALL - PLACED - GAP]:
        problems.append(f"the geometry is {measured['placed']}")
    if tuple(measured["opaque"]) != ASSET_COLOUR:
        problems.append(f"the asset's colour is not at the corner: {measured['opaque']}")
    if tuple(measured["hole"]) != BACKGROUND:
        problems.append(f"the transparent quadrant came out {measured['hole']}")
    if tuple(measured["far"]) != BACKGROUND:
        problems.append(f"the far corner came out {measured['far']}")
    failures += judge("c. the asset is in the corner, transparency and all", problems)

    written = measured["out_brief"]
    line = f"[place_image: prueba-asset.png at {CORNER}, size {SIZE}]"
    problems = []
    if written["prompt"] != f"{PROMPT}\n{line}":
        problems.append(f"the brief is {written['prompt']!r}")
    if written["format"] != "feed":
        problems.append(f"the format is {written['format']!r} and not the slide's")
    if written["model"] != "place_image":
        problems.append(f"the model is {written['model']!r}")
    failures += judge("d. the brief says what was placed", problems)

    problems = []
    if "imagenes" not in measured["line"]:
        problems.append(f"the line does not say where it is: {measured['line']!r}")
    if measured["media_type"] != "image/png":
        problems.append(f"media type {measured['media_type']!r}")
    if measured["bytes"] < 1024:
        problems.append(f"the picture handed to the model is {measured['bytes']} bytes")
    failures += judge("e. the model sees what it made", problems)

    refused = measured["refused"]
    print(f"  {refused}")
    problems = []
    if "ModelRetry" not in refused:
        problems.append(f"an unknown asset raised {refused!r}")
    elif "prueba-asset.png" not in refused:
        problems.append("the refusal does not list what marca/ does have")
    failures += judge("f. and an asset that is not there comes back as words", problems)

    print("PLACE: PASS" if not failures else "PLACE: FAIL")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
