"""The two tabs Wave 3 adds: Usage (what the key has spent) and Skills.

Both are read-only projections of something that already exists — the
provider's own accounting and the kit's mounted plugins — so neither keeps
state of its own.
"""

import os
from datetime import datetime
from zoneinfo import ZoneInfo

import httpx
from fastapi import APIRouter

from core import config, plugins
from core.tools import skills

router = APIRouter()

OPENROUTER_KEY_URL = "https://openrouter.ai/api/v1/key"


def usd(value) -> float | None:
    """The field as a float, or None if the provider did not send it.

    None and 0.0 are different answers: "I do not know" is not "nothing".
    """
    return float(value) if isinstance(value, (int, float)) else None


@router.get("/portal/usage")
def usage():
    """What OpenRouter says this key has spent. No cache.

    `available: false` with a 200 when there is no key or the provider does not
    answer: the portal hides the tab, and a money screen that errors reads far
    worse to a client than a money screen that is not there. The reason travels
    in Spanish because `app/app/usage/page.tsx` shows it to the client.

    No cache on purpose. The adapter caches for five minutes; here the number
    is also what `tests/cost.py` prices a turn against, and a cached total
    turns a measurement into a guess.
    """
    key = os.environ.get("OPENROUTER_API_KEY", "").strip()
    if not key:
        return {"available": False, "reason": "este agente no tiene clave del proveedor"}
    try:
        response = httpx.get(
            OPENROUTER_KEY_URL, headers={"Authorization": f"Bearer {key}"}, timeout=10
        )
        response.raise_for_status()
        data = response.json().get("data") or {}
    except (httpx.HTTPError, ValueError) as exc:
        return {"available": False, "reason": f"no pude preguntarle al proveedor: {exc}"}
    return {
        "available": True,
        "today_usd": usd(data.get("usage_daily")),
        "month_usd": usd(data.get("usage_monthly")),
        "total_usd": usd(data.get("usage")),
        # A null limit is "no cap", which is not a cap of zero.
        "limit_usd": usd(data.get("limit")),
        "updated_at": datetime.now(ZoneInfo(config.TIMEZONE)).isoformat(),
    }


@router.get("/portal/inventory")
def inventory():
    """What this agent has installed: the kit's skills and the plugins that bring them.

    Each skill travels under both names. The plan's contract table says
    `description`; `app/app/skills/page.tsx` reads `summary`. Same as `files`'
    `mtime`/`modified`: serving both costs a key and saves a blank screen.
    """
    return {
        "skills": [
            {
                "name": skill.name,
                "description": skill.description,
                "summary": skill.description,
                "source": "kit",
                "editable": False,
            }
            for skill in skills.index().values()
        ],
        "plugins": [
            {
                "id": plugin.id,
                "version": plugin.manifest["version"],
                "description": plugin.manifest["description"],
            }
            for plugin in plugins.enabled()
        ],
        "mcp": [],
    }
