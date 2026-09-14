"""The deliverable plugin on the `core` engine: nothing to register.

The mechanism is the skill and its script, and those load from
`surfaces.skills` the same way on any engine: the script decides the path, the
name and the structure, and the model contributes the content.

What this folder adds is `instructions.md` — where the client's files come in,
where what the agent writes goes out, and that the chat gets the short answer
and the reference. Two lines about two folders, in the prompt only where this
plugin is enabled, which is the whole reason they are not in a SOUL.
"""


def register(engine) -> None:
    """Nothing, on purpose. The prose ships next to this file."""
