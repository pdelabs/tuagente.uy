"""The social plugin on the `core` engine: the hand, the format, the page.

Three files, and they divide the work the way this kit always divides it — the
model supplies the words, the code supplies the format:

- `creator.py` — the sub-agent that makes the post: the only agent of this
  engine with `save_post` and with the image capability. The face delegates to
  it and reads its report out to the client.
- `posts.py` — `save_post`, the only thing that writes a post; the reader the
  tab and the tool share; and the three `/portal/posts*` routes, which are in
  that file and not in a `routes.py` of their own for a reason its docstring
  spells out. The folder, the file names and the one-per-day rule are here, so
  no prose has to carry them.
- `skills/post/SKILL.md` — the craft: the brand file, the caption formula, the
  voice, and the checklist the image has to pass before it counts.

NOTHING IS REGISTERED ON THE FACE except the page and the one line of prose.
`SKILLS = []` and no toolset: the skill and the tool belong to the creator, and
the face's half of this mechanism is deciding to hand the work over and telling
the client what came of it (`docs/subagents-plan.md`). The skill file is still
the plugin's `surfaces.skills` — it travels with the plugin like any other and
a Hermes agent would list it — it is this engine's index it stays out of.

`instructions.md` is one line, and it is the only rule of this mechanism that
no code can check: the agent does not publish.
"""

import creator
import posts

# The post skill is the CREATOR's, read whole into its instructions
# (`creator.py`). Empty here so the face's index does not offer a procedure
# whose tools the face does not have.
SKILLS: list[str] = []


def register(engine) -> None:
    engine.subagent(creator.build(engine), label=creator.LABEL)
    engine.router(posts.router)
    engine.module("posts", True)
