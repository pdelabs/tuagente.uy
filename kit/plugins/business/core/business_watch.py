"""The research: once per website the owner leaves, and again when she asks.

Onboarding saves the company and its website into `identity.json` and tells the
owner «sigo leyendo tu web». This ticker is what makes that true: when the
website is new — not researched yet under this name — the researcher runs once,
on its own, and the draft lands in «Marca».

ONE ATTEMPT PER WEBSITE, SUCCESS OR NOT. The mark is written BEFORE the run: a
site that is down, or a model that fails, is one line in Activity and not a
research every minute on the client's key. Trying again is the client's to
ask: through the face, which delegates to the same researcher, or with the
«Marca» tab's button (`start`, below).

ONE RESEARCH AT A TIME, whoever started it. The ticker's and the button's are
the same `research()`, and `researching()` is what both the tab (`researching:
true`) and the route's 409 read. Two at once would be two researchers writing
one file, and the second one's draft is the one that stays.

THE BUTTON'S RUN IS DETACHED. A research is minutes of model calls; the request
that asked for it answers at once and the run lives on the engine's loop — the
route is `async`, so `create_task` lands where the scheduler and the model's
HTTP client live, the same shape as «Probarlo ahora» on a flow
(`engine/server/flows.py`). The task is kept in a module variable, because
the loop holds only a weak reference to a task and one nobody holds can be
collected mid-run. The Activity line it ends with is what `/portal/changes`
hands the tab to refetch on.

WITHOUT A WEBSITE, NOTHING. A name alone is a search that finds whoever has the
same name, and a draft of somebody else's business is worse than none.
"""

import asyncio
import logging
import time

import business_draft
import researcher

from core import db, identity, session

log = logging.getLogger(__name__)

TICKER = "business.research"
EVERY = 60

SCHEMA = "CREATE TABLE IF NOT EXISTS business_marks (key TEXT PRIMARY KEY, at REAL NOT NULL)"
db.write(SCHEMA)

# Read by the client in Activity.
DONE = "Leí tu web y te dejé lo que entendí de tu negocio en Marca."
FAILED = "No pude leer tu web ({url}): {reason}"

_busy = False
_task: asyncio.Task | None = None


def done(key: str) -> bool:
    return db.one("SELECT 1 FROM business_marks WHERE key = ?", (key,)) is not None


def mark(key: str) -> None:
    db.write("INSERT OR IGNORE INTO business_marks (key, at) VALUES (?, ?)", (key, time.time()))


def researching() -> bool:
    return _busy


async def research(company: str, url: str) -> None:
    global _busy
    _busy = True
    try:
        await researcher.run(company, url)
    except Exception as exc:
        db.append_event("business.researched", FAILED.format(url=url, reason=session.one_line(exc)), "error")
        raise
    finally:
        _busy = False
    db.append_event("business.researched", DONE, "completed")


async def look() -> None:
    if _busy:
        return
    company, url = business_draft.company()
    if not url:
        return
    key = f"{company}|{url}"
    if done(key):
        return
    mark(key)
    await research(company, url)


async def detached(company: str, url: str) -> None:
    try:
        await research(company, url)
    except Exception:
        # `research` already wrote the owner her line; the stack goes to the log.
        log.exception("business: the research the owner asked for broke")


def start(url: str) -> None:
    """The owner's «Leer mi web de nuevo»: the research, now, on `url`.

    A website she gives here IS her business's website, so it goes into
    `identity.json` like onboarding's, and its mark goes in first: the ticker
    would otherwise see a new website on its next look and run a second one.
    `_busy` is set HERE, before the task gets its first slice of the loop, so
    the GET right after this request already reads `researching: true`.
    """
    global _busy, _task
    who = identity.load()
    if url != (who.get("url") or "").strip():
        identity.save(who | {"url": url})
    company = (who.get("company") or "").strip()
    mark(f"{company}|{url}")
    _busy = True
    _task = asyncio.create_task(detached(company, url))
