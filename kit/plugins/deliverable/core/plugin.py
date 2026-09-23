"""The deliverable plugin on the `core` engine: the prose, and a flow's results.

The mechanism is the skill and its script, and those load from
`surfaces.skills`: the script decides the path, the name and the structure, and
the model contributes the content.

What this folder adds is `instructions.md` — where the client's files come in,
where what the agent writes goes out, and that the chat gets the short answer
and the reference. Two lines about two folders, in the prompt only where this
plugin is enabled, which is the whole reason they are not in a SOUL.

AND WHAT A FLOW DELIVERED. The script puts a deliverable made inside a flow
(`--flow <slug>`) in `entregables/<slug>/`, with its attachments next to it, so
that folder IS the flow's output: this plugin hands the engine the reader
(`flow.results.deliverables`, `engine/core/plugins.py`'s `flow_results`) and the
flow's page lists it.
"""

from core import config

# The script's own folder (`skills/deliverable/deliver.py`, `DELIVERABLES`).
WHERE = "entregables"


def results(slug: str) -> list[dict]:
    """The files in this flow's deliverables folder, as `{path, mtime}`."""
    folder = config.WORKSPACE / WHERE / slug
    if not folder.is_dir():
        return []
    return [
        {"path": str(path.relative_to(config.WORKSPACE)), "mtime": path.stat().st_mtime}
        for path in folder.iterdir()
        if path.is_file() and not path.name.startswith(".")
    ]


def register(engine) -> None:
    engine.provide("flow.results.deliverables", results)
