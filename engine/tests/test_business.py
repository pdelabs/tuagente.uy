#!/usr/bin/env python3
"""The business draft, and the research nobody asked for. `python3 engine/tests/test_business.py`.

Inside the container, with the researcher swapped for a function that writes
down what it was asked: no model, no network. The identity, the marks and the
draft are put back on the way out.

WHY. Onboarding asks for the website and promised «sigo leyendo tu web» with
nothing behind it (`kit/plugins/business/`).

  a. THE DRAFT HAS ONE SHAPE — every heading, in order, the dated note, the
     empty ones say so, and it lands in `negocio/borrador.md`.
  b. NO WEBSITE, NO RESEARCH — a name alone is somebody else's business.
  c. ONCE PER WEBSITE — the first look runs it with the name and the site, the
     next ones do not, and a new site runs it again.
  d. A FAILURE IS ONE LINE AND NO RETRY — the mark goes in before the run.

WHERE IT POINTS. `CORE_CONTAINER`; the default is the lab's `tuagente-core`.
"""

import json
import os
import subprocess
import sys

CONTAINER = os.environ.get("CORE_CONTAINER", "tuagente-core")

INSIDE = r"""
import asyncio, json, sys
from datetime import datetime
sys.path.insert(0, "/opt/kit/plugins/business/core")

import business_draft
import business_watch
import researcher

from core import config, db, identity

out = {}
live = identity.LIVE.read_text() if identity.LIVE.exists() else None
marks = db.query("SELECT key, at FROM business_marks")
draft = config.WORKSPACE / business_draft.DRAFT
before = draft.read_text() if draft.exists() else None
first_event = db.one("SELECT COALESCE(MAX(id), 0) AS id FROM events")["id"]

asked = []
fail = False
async def fake(company, url):
    asked.append([company, url])
    if fail:
        raise RuntimeError("la web no contestó")
    return "listo"
researcher.run = fake

def set_identity(company, url):
    who = identity.load()
    who["company"], who["url"] = company, url
    identity.save(who)

def events():
    return [dict(r) for r in db.query(
        "SELECT kind, label, status FROM events WHERE id > ? AND kind = 'business.researched' ORDER BY id",
        (first_event,))]

try:
    # a.
    tool = business_draft.toolset().tools["save_draft"]
    tool.function(None, summary="Una ferretería de barrio.", offer=["Herramientas", "Pinturas"],
                  customers="", prices=[], where_and_when=["Av. Italia 1234"], channels=["https://x.uy"],
                  voice="Cercano, de vos.", edge="", questions=["¿Hacen envíos?"],
                  sources=["https://x.uy", "https://x.uy/contacto"])
    out["draft"] = draft.read_text()

    # b.
    db.write("DELETE FROM business_marks")
    set_identity("Ferretería Demo", "")
    asyncio.run(business_watch.look())
    out["no_url"] = list(asked)

    # c.
    set_identity("Ferretería Demo", "https://ferreteria.example")
    asyncio.run(business_watch.look())
    asyncio.run(business_watch.look())
    out["once"] = list(asked)
    set_identity("Ferretería Demo", "https://otra.example")
    asyncio.run(business_watch.look())
    out["new_site"] = list(asked)

    # d.
    asked.clear()
    fail = True
    set_identity("Ferretería Demo", "https://caida.example")
    try:
        asyncio.run(business_watch.look())
        out["raised"] = False
    except RuntimeError:
        out["raised"] = True
    asyncio.run(business_watch.look())
    out["retried"] = len(asked)
    out["events"] = events()
finally:
    db.write("DELETE FROM business_marks")
    for r in marks:
        db.write("INSERT INTO business_marks (key, at) VALUES (?, ?)", (r["key"], r["at"]))
    db.write("DELETE FROM events WHERE id > ?", (first_event,))
    if before is None:
        draft.unlink(missing_ok=True)
    else:
        draft.write_text(before)
    if live is None:
        identity.LIVE.unlink(missing_ok=True)
    else:
        identity.LIVE.write_text(live)

print(json.dumps(out, ensure_ascii=False))
"""


def judge(name: str, problems: list[str]) -> int:
    print(("  ok    " if not problems else "  FAIL  ") + name)
    for p in problems:
        print("        " + p)
    return 1 if problems else 0


def main() -> int:
    done = subprocess.run(
        ["docker", "exec", CONTAINER, "python3", "-c", INSIDE],
        capture_output=True, text=True,
    )
    if done.returncode != 0:
        print(done.stdout + done.stderr)
        return 1
    r = json.loads(done.stdout.strip().splitlines()[-1])
    failures = 0

    problems = []
    d = r["draft"]
    headings = ["En pocas palabras", "Qué vende", "A quién le vende", "Precios publicados",
                "Dónde y cuándo", "Por dónde se lo encuentra", "Cómo habla",
                "Qué lo hace distinto", "Lo que no encontré y me sirve saber", "De dónde lo saqué"]
    places = [d.find(f"## {h}") for h in headings]
    if -1 in places or places != sorted(places):
        problems.append("a heading is missing or out of order")
    if "Borrador que armé leyendo https://x.uy, https://x.uy/contacto" not in d:
        problems.append("the note does not say where it came from")
    if d.count("No lo encontré publicado.") != 3:
        problems.append(f"the three empty ones read {d.count('No lo encontré publicado.')} times as not found")
    if "- Pinturas" not in d or "- ¿Hacen envíos?" not in d:
        problems.append("a list did not render as a list")
    failures += judge("a. the draft has one shape", problems)

    problems = [] if not r["no_url"] else [f"it researched with no website: {r['no_url']!r}"]
    failures += judge("b. no website, no research", problems)

    problems = []
    if r["once"] != [["Ferretería Demo", "https://ferreteria.example"]]:
        problems.append(f"two looks asked {r['once']!r}")
    if r["new_site"][-1:] != [["Ferretería Demo", "https://otra.example"]] or len(r["new_site"]) != 2:
        problems.append(f"a new website asked {r['new_site']!r}")
    failures += judge("c. once per website", problems)

    problems = []
    if not r["raised"]:
        problems.append("a failed research did not raise to the clock")
    if r["retried"] != 1:
        problems.append(f"the same website was researched {r['retried']} times")
    errors = [e for e in r["events"] if e["status"] == "error"]
    if len(errors) != 1 or "la web no contestó" not in errors[0]["label"]:
        problems.append(f"the Activity lines are {r['events']!r}")
    failures += judge("d. a failure is one line and no retry", problems)

    print("BUSINESS: " + ("PASS" if not failures else "FAIL"))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
