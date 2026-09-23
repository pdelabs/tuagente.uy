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
  e. THE DRAFT HAS TO HAVE READ THE SITE — one page of a site with more is
     sent back once with the site's pages, and the second save goes through.
  f. THE SITE'S PAGES ARE CODE'S — the sitemap's, or the home's raw links
     (menus included): same site only, one spelling each, no assets.
  h. A SITEMAP INDEX IS FOLLOWED, AND THE MENU ADDS TO IT — QA's Wix site
     listed its pages in a child sitemap, and the list came out as the home
     alone; the per-plan pages are in it now, and a menu link the sitemap
     forgot is too.
  i. PRICES SEEN ARE PRICES LISTED — a draft whose questions quote $ 990 with
     `prices` empty goes back once naming the amount and where it is; the
     second save goes through; with the prices listed, amounts in a question
     are fine.
  g. THE FACE CORRECTS ONE SECTION — `correct_draft` rewrites that section and
     every other byte of the file is the same, the owner's hand edits included;
     a section she deleted comes back at the end, and with no draft there is
     nothing to correct.
  j. A CORRECTION TAKES ITS ANSWERED QUESTIONS WITH IT — QA's owner gave the
     new hours and the questions kept asking the opening days and the
     currency: the questions named in `answered_questions` leave the list in
     the same call (a copy that drops the «¿» or the end still counts), the
     rest stay in order, and a question that is not on the list goes back
     with the list and writes nothing.

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
import business_site
import business_watch
import researcher
from pydantic_ai import ModelRetry

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

site_pages = ["https://x.uy/", "https://x.uy/precios", "https://x.uy/nosotros", "https://x.uy/blog/una"]
async def fake_pages(url):
    return list(site_pages)
real_pages = business_site.pages
business_site.pages = fake_pages

try:
    # a.
    tool = business_draft.toolset().tools["save_draft"]
    asyncio.run(tool.function(None, summary="Una ferretería de barrio.", offer=["Herramientas", "Pinturas"],
                  customers="", prices=[], where_and_when=["Av. Italia 1234"], channels=["https://x.uy"],
                  voice="Cercano, de vos.", edge="", questions=["¿Hacen envíos?"],
                  sources=["https://x.uy", "https://x.uy/contacto", "https://x.uy/precios/"]))
    out["draft"] = draft.read_text()

    # e.
    draft.unlink()
    args = dict(summary="s", offer=[], customers="", prices=[], where_and_when=[], channels=[],
                voice="", edge="", questions=[], sources=["https://otra.uy/"])
    site_pages = ["https://otra.uy/", "https://otra.uy/precios", "https://otra.uy/nosotros"]
    try:
        asyncio.run(tool.function(None, **args))
        out["first"] = "saved"
    except ModelRetry as exc:
        out["first"] = str(exc)
    out["first_wrote"] = draft.exists()
    asyncio.run(tool.function(None, **args))
    out["second_wrote"] = draft.exists()

    # f.
    business_site.pages = real_pages
    async def fake_get(url, accept):
        if url.endswith("/sitemap.xml"):
            return None
        return ('<nav><a href="/servicios">S</a><a href="/precios/">P</a></nav>'
                '<a href="https://www.x.uy/blog?utm=1#top">B</a><a href="/logo.png">L</a>'
                '<a href="https://otro.com/">O</a><a href="mailto:a@x.uy">M</a>')
    business_site.get = fake_get
    out["pages"] = asyncio.run(business_site.pages("https://x.uy/"))

    # h.
    async def index_get(url, accept):
        if url == "https://y.uy/sitemap.xml":
            return ('<?xml version="1.0"?><sitemapindex><sitemap><loc>https://y.uy/pages-sitemap.xml</loc>'
                    '</sitemap></sitemapindex>')
        if url == "https://y.uy/pages-sitemap.xml":
            return ('<urlset><url><loc>https://y.uy/mantenimientos</loc></url>'
                    '<url><loc>https://y.uy/plan-simple</loc></url></urlset>')
        return '<nav><a href="/contacto">C</a><a href="/plan-simple">S</a></nav>'
    business_site.get = index_get
    out["indexed"] = asyncio.run(business_site.pages("https://y.uy/"))

    # i.
    async def few_pages(url):
        return [url]
    business_site.pages = few_pages
    draft.unlink(missing_ok=True)
    quoted = dict(args, sources=["https://precios.uy/"],
                  questions=["¿Siguen vigentes el simple ($ 990) y el completo ($ 2890)?"])
    try:
        asyncio.run(tool.function(None, **quoted))
        out["unpriced"] = "saved"
    except ModelRetry as exc:
        out["unpriced"] = str(exc)
    out["unpriced_wrote"] = draft.exists()
    asyncio.run(tool.function(None, **quoted))
    out["unpriced_again"] = draft.exists()
    draft.unlink()
    try:
        asyncio.run(tool.function(None, **dict(quoted, sources=["https://otros.uy/"],
                                                prices=["Mantenimiento simple: $ 990, moneda sin confirmar"])))
        out["priced"] = draft.exists()
    except ModelRetry as exc:
        out["priced"] = str(exc)
    business_site.pages = real_pages

    # g.
    correct = business_draft.corrections().tools["correct_draft"].function
    parts = dict(summary="Tenés una ferretería.", offer=["Herramientas"], customers="Vecinos.",
                 prices=["Martillo, $ 450"], where_and_when=["Abrís de 9 a 19:30"], channels=[],
                 voice="", edge="", questions=["¿Hacés envíos?", "¿Abrís los sábados?"],
                 sources=["https://x.uy"])
    base = business_draft.render(parts, datetime(2026, 9, 23))
    # The owner's hand edit from Archivos, with a `## ` of her own inside a section.
    base = base.replace("Vecinos.", "Vecinos del barrio.\n\n## Mayoristas\n\nTambién.")
    draft.write_text(base)
    out["said"] = correct(section="where_and_when", content=["Abrís de 9 a 19:30", "Los sábados cerrás a las 14"],
                           answered_questions=[])
    correct(section="questions", content=["¿Hacés envíos?"], answered_questions=[])
    out["base"], out["corrected"] = base, draft.read_text()
    draft.write_text(base.replace("## Cómo hablás\n\nNo lo encontré publicado.\n\n", ""))
    correct(section="voice", content=["Cercano, de vos."], answered_questions=[])
    out["restored"] = draft.read_text()
    # j.
    four = dict(parts, questions=["¿En qué moneda están tus precios?", "¿Abrís otros días?",
                                  "¿Quién atiende los reclamos?", "¿Hacés envíos?"])
    draft.write_text(business_draft.render(four, datetime(2026, 9, 23)))
    out["answered_said"] = correct(
        section="where_and_when",
        content=["Abrís de lunes a viernes de 9 a 18", "Desde marzo, también los sábados de 9 a 13"],
        answered_questions=["En qué moneda están tus precios", "¿Abrís otros días?"])
    out["answered"] = draft.read_text()
    kept = draft.read_text()
    try:
        correct(section="prices", content=["Martillo, $ 450 (pesos)"], answered_questions=["¿Tenés estacionamiento?"])
        out["unknown"] = "saved"
    except ModelRetry as exc:
        out["unknown"] = str(exc)
    out["unknown_kept"] = draft.read_text() == kept
    draft.unlink()
    out["no_draft"] = correct(section="prices", content=["x"], answered_questions=[])
    out["no_draft_wrote"] = draft.exists()

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
    headings = ["En pocas palabras", "Qué vendés", "A quién le vendés", "Precios publicados",
                "Dónde y cuándo", "Por dónde te encuentran", "Cómo hablás",
                "Qué te hace distinto", "Lo que no encontré y me sirve saber", "De dónde lo saqué"]
    places = [d.find(f"## {h}") for h in headings]
    if -1 in places or places != sorted(places):
        problems.append("a heading is missing or out of order")
    # Counted, not listed: three pages of x.uy.
    if "Borrador que armé leyendo 3 páginas de x.uy el " not in d:
        problems.append("the note does not count the pages it read")
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

    problems = []
    if "Leíste 1 de las 3 páginas de otra.uy" not in r["first"] or "https://otra.uy/precios" not in r["first"]:
        problems.append(f"one page of three was not sent back: {r['first'][:160]!r}")
    if r["first_wrote"]:
        problems.append("the refused draft was written anyway")
    if not r["second_wrote"]:
        problems.append("the second save did not go through")
    failures += judge("e. the draft has to have read the site", problems)

    want = ["https://x.uy/", "https://x.uy/servicios", "https://x.uy/precios", "https://www.x.uy/blog"]
    problems = [] if r["pages"] == want else [f"the map is {r['pages']!r}"]
    failures += judge("f. the site's pages are code's", problems)

    want = ["https://y.uy/", "https://y.uy/mantenimientos", "https://y.uy/plan-simple", "https://y.uy/contacto"]
    problems = [] if r["indexed"] == want else [f"the map is {r['indexed']!r}"]
    failures += judge("h. a sitemap index is followed, and the menu adds to it", problems)

    problems = []
    u = r["unpriced"]
    if "«$ 990" not in u or "«Lo que no encontré y me sirve saber»" not in u or "moneda sin confirmar" not in u:
        problems.append(f"the unpriced draft was not sent back: {u[:200]!r}")
    if r["unpriced_wrote"]:
        problems.append("the refused draft was written anyway")
    if not r["unpriced_again"]:
        problems.append("the second save did not go through")
    if r["priced"] is not True:
        problems.append(f"a draft with its prices listed gave {r['priced']!r}")
    failures += judge("i. prices seen are prices listed", problems)

    problems = []
    b, c = r["base"], r["corrected"]
    wanted = "## Dónde y cuándo\n\n- Abrís de 9 a 19:30\n- Los sábados cerrás a las 14\n\n## Por dónde"
    if wanted not in c:
        problems.append("the section did not read as corrected")
    if "## Lo que no encontré y me sirve saber\n\n- ¿Hacés envíos?\n\n## De dónde" not in c:
        problems.append("the answered question did not leave the list")
    head, tail = b.split("## Dónde y cuándo")[0], b.split("## Por dónde te encuentran")[1].split("## Lo que no")[0]
    if not c.startswith(head) or tail not in c or not c.endswith(b.split("## De dónde lo saqué")[1]):
        problems.append("a byte outside the corrected sections changed")
    if "Vecinos del barrio.\n\n## Mayoristas\n\nTambién." not in c:
        problems.append("the owner's own edit did not survive")
    if not r["restored"].endswith("## Cómo hablás\n\nCercano, de vos.\n"):
        problems.append(f"a deleted section did not come back at the end: {r['restored'][-80:]!r}")
    if "Corregí «Dónde y cuándo»" not in r["said"]:
        problems.append(f"the face was told {r['said']!r}")
    if "Todavía no hay borrador" not in r["no_draft"] or r["no_draft_wrote"]:
        problems.append(f"with no draft it answered {r['no_draft']!r}")
    failures += judge("g. the face corrects one section", problems)

    problems = []
    a = r["answered"]
    if "## Lo que no encontré y me sirve saber\n\n- ¿Quién atiende los reclamos?\n- ¿Hacés envíos?\n\n## De dónde" not in a:
        problems.append(f"the questions read {a.split('## Lo que no')[1][:200]!r}")
    if "- Desde marzo, también los sábados de 9 a 13" not in a:
        problems.append("the section itself was not corrected")
    if "Saqué 2 de las preguntas" not in r["answered_said"]:
        problems.append(f"the face was told {r['answered_said']!r}")
    if "¿Tenés estacionamiento?" not in r["unknown"] or "- ¿Quién atiende los reclamos?" not in r["unknown"]:
        problems.append(f"an unknown question gave {r['unknown'][:200]!r}")
    if not r["unknown_kept"]:
        problems.append("a refused correction wrote the draft")
    failures += judge("j. a correction takes its answered questions with it", problems)

    print("BUSINESS: " + ("PASS" if not failures else "FAIL"))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
