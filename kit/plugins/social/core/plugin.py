"""The social plugin on the `core` engine: the format, the page and the craft.

Three pieces and they divide the work the way this kit always divides it —
the model supplies the words, the code supplies the format:

- `posts.py` — `save_post`, the only thing that writes a post, and the reader
  the tab and the tool share. The folder, the file names and the one-per-day
  rule are here, so no prose has to carry them.
- `routes.py` — `/portal/posts`, `/portal/posts/{id}` and the bytes of each
  piece.
- `skills/post/SKILL.md` — the craft: the brand file, the caption formula, the
  voice, and the checklist the image has to pass before it counts.

`instructions.md` is two lines, and they are the only rule of this mechanism
that no code can check: the agent does not publish.
"""

import posts
import routes


def register(engine) -> None:
    engine.toolset(posts.toolset())
    engine.router(routes.router)
    engine.module("posts", True)
