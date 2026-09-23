"""Who the agent is and how to reach its owner: `identity.json`.

The agent dir is a read-only mount (the SOUL and the seed identity), so what
the client changes from the portal lands in /state and wins when it is there.
Read here and not in `server/portal.py` because the engine needs it too:
`core/notify.py` sends to the address the owner left in `contact`.
"""

import json

from . import config

SEED = config.AGENT_DIR / "identity.json"
LIVE = config.STATE_DIR / "identity.json"


def load() -> dict:
    return json.loads((LIVE if LIVE.exists() else SEED).read_text())


def save(who: dict) -> None:
    LIVE.write_text(json.dumps(who, ensure_ascii=False))
