"""The social plugin on the `core` engine: the hand, the format, the page.

Five files, and they divide the work the way this kit always divides it — the
model supplies the words, the code supplies the format:

- `creator.py` — the sub-agent that makes the post: the only agent of this
  engine with `save_post` and with the image capability. The face delegates to
  it and reads its report out to the client.
- `posts.py` — `save_post`, the only thing that writes a post; the reader the
  tab and the tool share; and the three `/portal/posts*` routes, which are in
  that file and not in a `routes.py` of their own for a reason its docstring
  spells out. The folder, the file names and the one-per-day rule are here, so
  no prose has to carry them.
- `publishing.py` — `publish_instagram`, the only thing this plugin does
  outwards, on the FACE and behind the gate. And the card the client reads
  before saying yes, which this plugin draws because only it knows what a post
  is (`render.py`'s `RENDERER`).
- `instagram.py` — the Graph calls, the public bucket the slides wait on, and
  the token's 60 days.
- `skills/post/SKILL.md` — the craft: the brand file, the caption formula, the
  voice, and the checklist the image has to pass before it counts.

WHAT IS REGISTERED ON THE FACE: the page, the prose, and ONE gated tool. Not
`save_post` and not `generate_image` — the skill and those tools belong to the
creator (`SKILLS = []`, `docs/subagents-plan.md`), and the face's half of that
half is deciding to hand the work over and telling the client what came of it.
The skill file is still the plugin's `surfaces.skills` — it travels with the
plugin like any other and a Hermes agent would list it — it is this engine's
index it stays out of.

AND PUBLISHING IS ON THE FACE FOR THE SAME REASON THE CREATOR IS NOT ALLOWED
NEAR IT: a sub-agent never talks to the client, the gate is a conversation with
her, and a gated tool inside `delegate_task` does not pause — it kills the turn
(`core/plugins.py`'s `subagent`, measured).
"""

import creator
import instagram
import posts
import publishing

# The post skill is the CREATOR's, read whole into its instructions
# (`creator.py`). Empty here so the face's index does not offer a procedure
# whose tools the face does not have.
SKILLS: list[str] = []


def register(engine) -> None:
    engine.subagent(creator.build(engine), label=creator.LABEL)
    # THE WHOLE TOOLSET IS GATED, exactly as the approval plugin gates its own:
    # `approval_required()` with no predicate, so a tool added to it tomorrow
    # is gated without anyone remembering to put its name on a list.
    engine.toolset(publishing.toolset().approval_required())
    # And the card that tool is read through. The approval plugin looks it up
    # by tool name when a run stops (`approval/core/render.py`).
    engine.provide(f"approval.render.{publishing.TOOL}", publishing.card)
    engine.router(posts.router)
    engine.router(instagram.router)
    engine.module("posts", True)
