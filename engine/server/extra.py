"""The two tabs Wave 3 adds: Usage (what this agent has spent) and Skills.

Both are read-only projections of something that already exists — the
engine's own events and the kit's mounted plugins — so neither keeps state of
its own.
"""

import json
import os
from datetime import datetime
from zoneinfo import ZoneInfo

import httpx
from fastapi import APIRouter

from core import config, db, plugins, turn_usage
from core.tools import skills

router = APIRouter()

OPENROUTER_KEY_URL = "https://openrouter.ai/api/v1/key"


def usd(value) -> float | None:
    """The field as a float, or None if the provider did not send it.

    None and 0.0 are different answers: "I do not know" is not "nothing".
    """
    return float(value) if isinstance(value, (int, float)) else None


# The events that carry what this agent spent: one per turn, and one per call
# the turn's usage does not hold (`core/turn_usage.py`).
SPENDING = ("turn_usage", turn_usage.SPEND)


def spent(since: float) -> tuple[float, int]:
    """What this agent spent since a moment, and how many calls had no price."""
    total, unpriced = 0.0, 0
    for kind in SPENDING:
        for row in db.events_of(kind, since):
            cost = json.loads(row["payload"] or "{}").get("cost_usd")
            if cost is None:
                unpriced += 1
            else:
                total += cost
    return total, unpriced


def key_figures() -> dict | None:
    """What OpenRouter says about the KEY: its cap and what it has been charged.

    A separate number on purpose. The key is shared in the lab and may outlive
    an agent anywhere, so what it has been charged is not what THIS agent
    spent: the QA agent, created that morning, showed «lleva gastados US$ 12,03»
    of a key other agents had been using for weeks. `None` when there is no key
    or the provider does not answer; the agent's own numbers do not depend on it.
    """
    key = os.environ.get("OPENROUTER_API_KEY", "").strip()
    if not key:
        return None
    try:
        response = httpx.get(
            OPENROUTER_KEY_URL, headers={"Authorization": f"Bearer {key}"}, timeout=10
        )
        response.raise_for_status()
        data = response.json().get("data") or {}
    except (httpx.HTTPError, ValueError):
        return None
    # A null limit is "no cap", which is not a cap of zero.
    return {"limit_usd": usd(data.get("limit")), "usage_usd": usd(data.get("usage"))}


@router.get("/portal/usage")
def usage():
    """What THIS agent has spent: today, this month and since it exists.

    FROM ITS OWN EVENTS, NOT FROM THE KEY. Each turn writes what it cost
    (`turn_usage`, genai-prices' number, which matched OpenRouter's meter to
    the last decimal — `kit/notes/cost-and-engine-findings.md` §2), and every
    call outside a turn's usage writes a `spend`. The days are the business's
    (`config.TIMEZONE`). `unpriced` counts the calls nobody could price, so the
    screen can say the total is a floor instead of calling them zero.

    THE KEY'S FIGURES TRAVEL APART, under `key`, and `limit_usd` is no longer
    at the top: next to this agent's total it read as «tu clave tiene un tope
    de X y lleva gastados Y» with Y the agent's and X the key's.
    """
    now = datetime.now(ZoneInfo(config.TIMEZONE))
    day = now.replace(hour=0, minute=0, second=0, microsecond=0)
    today, _ = spent(day.timestamp())
    month, _ = spent(day.replace(day=1).timestamp())
    total, unpriced = spent(0.0)
    return {
        "available": True,
        "today_usd": round(today, 6),
        "month_usd": round(month, 6),
        "total_usd": round(total, 6),
        "unpriced": unpriced,
        "key": key_figures(),
        "updated_at": now.isoformat(),
    }


@router.get("/portal/inventory")
def inventory():
    """What this agent has installed: the kit's skills and the plugins that bring them.

    THE NAMES ARE THE PORTAL'S, ONE EACH: `lib/agent.ts`'s `Inventory`. A skill
    is `label` and `summary` — what `app/app/skills/page.tsx` draws — and the
    plugins are `engine_plugins`, `{name, summary}`.

    EVERYTHING HERE IS THE OWNER'S TEXT, NEVER THE MODEL'S. `summary` was the
    skill's `description`, and the QA client read «Comments» and «Inbox» under
    «Comunes del sistema», each over a line of instructions for the model —
    `fetch_comments`, «lee marca/brand.md», «cuando el cliente te pida». Now it
    is the frontmatter's `title` and `client_summary`, and a plugin's
    `client_copy` instead of its English `description`.
    """
    return {
        "skills": [
            {
                "name": skill.name,
                "label": skill.title,
                "summary": skill.client_summary,
                "source": "kit",
                "editable": False,
            }
            for skill in skills.index().values()
        ],
        "engine_plugins": [
            {"name": plugin.id, "summary": plugin.manifest["client_copy"]}
            for plugin in plugins.enabled()
        ],
        "mcp": [],
    }
