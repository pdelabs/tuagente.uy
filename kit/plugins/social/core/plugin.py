"""The social plugin on the `core` engine: the format, the page and the craft.

Two files, and they divide the work the way this kit always divides it — the
model supplies the words, the code supplies the format:

- `posts.py` — `save_post`, the only thing that writes a post; the reader the
  tab and the tool share; and the three `/portal/posts*` routes, which are in
  that file and not in a `routes.py` of their own for a reason its docstring
  spells out. The folder, the file names and the one-per-day rule are here, so
  no prose has to carry them.
- `skills/post/SKILL.md` — the craft: the brand file, the caption formula, the
  voice, and the checklist the image has to pass before it counts.

`instructions.md` is two lines, and they are the only rule of this mechanism
that no code can check: the agent does not publish.
"""

import posts


def register(engine) -> None:
    engine.toolset(posts.toolset())
    engine.router(posts.router)
    engine.module("posts", True)
