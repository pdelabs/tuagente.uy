"""The promises guard on the `core` engine: what the agent says it left
running, checked against the disk before the answer is persisted.

ONE COPY OF THE MODULE, TWO ENGINES. `promises.py` is loaded from this
plugin's own `engine/promises/` — the folder Hermes reads as a plugin of its
own — by path and not as a package: the `__init__.py` next to it is the Hermes
side of the wiring and imports `hermes_constants`, which does not exist here.
The file itself imports nothing of either engine, which is why one copy can
answer for both. The engine used to keep a verbatim copy in `core/promises.py`;
two copies of a rule are two answers.

WHAT IT CHECKS is a `data/` dir with `flows/` and `cron/jobs.json` under it. In
this engine those two live apart — the flows are the agent's, under the
workspace where it can write, and the cron is the engine's, under /state, which
the client never sees — so what the module gets handed is a junction of two
symlinks, not a third copy of either.

This engine has no flow runner, so nothing ever writes a FLOW.md and rule R1 is
the live one: any claim about something repeating gets the correction, because
there is nothing running on its own. That is the honest answer for this engine,
and it is the same answer the client got wrong on 13/8/2026, which is why the
check exists. `instructions.md` says the same thing to the model in one line.
"""

import importlib.util
import json
from pathlib import Path

from core import config, db

# THE SKILL DOES NOT TRAVEL TO THIS ENGINE. `flow/SKILL.md` drives
# `create_flow.py` against a Hermes agent's `data/flows/`, and there is no flow
# runner here to deliver what it would write: indexing it would be handing the
# agent a procedure whose own `instructions.md` says it cannot work.
SKILLS: list[str] = []

PROMISES = Path(__file__).resolve().parent.parent / "engine" / "promises" / "promises.py"

DATA = config.STATE_DIR / "promises"


def load_promises():
    spec = importlib.util.spec_from_file_location("promises", PROMISES)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


promises = load_promises()


def data_dir() -> str:
    """The dir the module reads, built on first use."""
    cron = config.STATE_DIR / "cron"
    cron.mkdir(parents=True, exist_ok=True)
    jobs = cron / "jobs.json"
    if not jobs.exists():
        jobs.write_text(json.dumps({"jobs": []}))
    flows = config.WORKSPACE / "flows"
    flows.mkdir(parents=True, exist_ok=True)
    DATA.mkdir(parents=True, exist_ok=True)
    for name, target in (("flows", flows), ("cron", cron)):
        link = DATA / name
        if not link.is_symlink():
            link.symlink_to(target)
    return str(DATA)


def check(session_id: str, text: str) -> str:
    """The text as it will be persisted: the agent's, corrected if it promised."""
    corrected = promises.with_notice(text, data_dir())
    if corrected is None:
        return text
    db.append_event(
        "correction",
        "Le agregué a la respuesta el chequeo de lo que corre solo",
        "completed",
        session_id,
        {"appended_chars": len(corrected) - len(text)},
    )
    return corrected


def register(engine) -> None:
    engine.before_persist(check)
