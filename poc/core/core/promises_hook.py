"""The promises check, wired into the seam that persists the turn. (G5)

`core/promises.py` is the kit's file, copied unchanged. It answers one
question — does the disk back up what the agent just claimed it left running?
— over a `data/` dir with `flows/` and `cron/jobs.json` under it.

In this engine those two live apart: the flows are the agent's (under the
workspace, where it can write) and the cron is the engine's (under /state,
which the client never sees). So what the kit's module gets handed is a
junction of two symlinks, not a third copy of either.

The POC has no flow engine — nothing ever writes a FLOW.md — so in practice
rule R1 is the live one: any claim about something repeating gets the
correction, because there is nothing running on its own. That is the honest
answer for this engine, and it is the same answer the client got wrong on
8/13/2026, which is why the check exists.
"""

import json

from . import config, db, promises
from .session import BEFORE_PERSIST

DATA = config.STATE_DIR / "promises"


def data_dir() -> str:
    """The dir the kit's module reads, built on first use."""
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


BEFORE_PERSIST.append(check)
