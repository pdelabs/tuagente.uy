"""The research nobody asked for: once per website the owner leaves.

Onboarding saves the company and its website into `identity.json` and tells the
owner «sigo leyendo tu web». This ticker is what makes that true: when the
website is new — not researched yet under this name — the researcher runs once,
on its own, and the draft lands in Archivos.

ONE ATTEMPT PER WEBSITE, SUCCESS OR NOT. The mark is written BEFORE the run: a
site that is down, or a model that fails, is one line in Activity and not a
research every minute on the client's key. Trying again is the client's to
ask, through the face, which delegates to the same researcher.

WITHOUT A WEBSITE, NOTHING. A name alone is a search that finds whoever has the
same name, and a draft of somebody else's business is worse than none.
"""

import time

import business_draft
import researcher

from core import db, session

TICKER = "business.research"
EVERY = 60

SCHEMA = "CREATE TABLE IF NOT EXISTS business_marks (key TEXT PRIMARY KEY, at REAL NOT NULL)"
db.write(SCHEMA)

# Read by the client in Activity.
DONE = "Leí tu web y dejé un borrador de tu negocio en Archivos: {path}"
FAILED = "No pude leer tu web ({url}): {reason}"


def done(key: str) -> bool:
    return db.one("SELECT 1 FROM business_marks WHERE key = ?", (key,)) is not None


def mark(key: str) -> None:
    db.write("INSERT OR IGNORE INTO business_marks (key, at) VALUES (?, ?)", (key, time.time()))


async def look() -> None:
    company, url = business_draft.company()
    if not url:
        return
    key = f"{company}|{url}"
    if done(key):
        return
    mark(key)
    try:
        await researcher.run(company, url)
    except Exception as exc:
        db.append_event("business.researched", FAILED.format(url=url, reason=session.one_line(exc)), "error")
        raise
    db.append_event("business.researched", DONE.format(path=business_draft.DRAFT), "completed")
