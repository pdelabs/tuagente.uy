#!/usr/bin/env python3
"""The «Marca» tab's engine half. `python3 engine/tests/test_business_context.py`.

Inside the container, with the researcher swapped for a coroutine that waits a
moment and a `FunctionModel` in place of the face's model: no provider call,
no network. The draft, the notes, the owner's files, the confirmations, the
identity, the marks and the events are put back on the way out.

WHY. The owner wants one place holding everything the agent works from about
her business, where she confirms or fixes what the researcher read — and the
face has to get it on EVERY run, not when it remembers to open a file
(`kit/plugins/business/core/business_context.py`).

  a. A CONFIRMATION LAPSES WHEN THE TEXT CHANGES — confirmed as it read, and
     a hand edit of that section afterwards leaves it «Borrador».
  b. HER EDIT CONFIRMS — `PUT /portal/business/sections/{key}` rewrites the
     section in the draft's own format (a list is one item per line, bullets
     or not), leaves it confirmed, and refuses an unknown key, an empty text
     and a missing draft; the confirm button confirms as it reads.
  c. THE RESEARCHER DOES NOT PISA WHAT SHE CONFIRMED — `save_draft` keeps a
     confirmed section byte for byte (and it stays confirmed), rewrites the
     rest, says which it kept, and stamps `researched_at`.
  d. THE FACE'S CORRECTION IS HER WORD — `correct_draft` confirms the section
     and leaves one `business.corrected` line in Activity.
  e. NOTES AND FILES ROUND-TRIP — notes read back verbatim; a file is
     listed with its workspace path, the same name replaces it, a name with
     folders lands inside `negocio/archivos/` anyway, `..` is refused, and a
     delete of what is not there is a 404.
  f. ONE RESEARCH AT A TIME, IN THE BACKGROUND — the request answers at once,
     GET reads `researching: true`, a second ask is a 409, no website is a
     400, and the end is a `business.researched` event.
  g. THE FACE READS IT ON EVERY RUN — the real face's instructions carry the
     block: confirmed and borrador markers on their sections, the notes
     verbatim, the files' paths, under the memory guidance and above the
     date line.

WHERE IT POINTS. `CORE_CONTAINER`; the default is the lab's `tuagente-core`.
"""

import json
import os
import subprocess
import sys

CONTAINER = os.environ.get("CORE_CONTAINER", "tuagente-core")

INSIDE = r"""
import asyncio, base64, json, shutil, sys, tempfile, time
from datetime import datetime
from pathlib import Path
sys.path.insert(0, "/opt/kit/plugins/business/core")

import business_context
import business_draft
import business_routes
import business_site
import business_watch
import researcher
from fastapi import FastAPI
from fastapi.testclient import TestClient

from core import config, db, identity

out = {}
WS = config.WORKSPACE
draft = WS / business_draft.DRAFT
notes = WS / business_context.NOTES
folder = business_context.folder()
before = draft.read_text() if draft.exists() else None
notes_before = notes.read_text() if notes.exists() else None
saved_folder = Path(tempfile.mkdtemp()) / "archivos"
had_folder = folder.is_dir()
if had_folder:
    shutil.copytree(folder, saved_folder)
negocio_existed = draft.parent.is_dir()
live = identity.LIVE.read_text() if identity.LIVE.exists() else None
confirmed_rows = db.query("SELECT section, digest, confirmed_at FROM business_confirmed")
researched_rows = db.query("SELECT id, at FROM business_researched")
marks = db.query("SELECT key, at FROM business_marks")
first_event = db.one("SELECT COALESCE(MAX(id), 0) AS id FROM events")["id"]

PARTS = dict(summary="Tenés una bicicletería en Pocitos.", offer=["Bicicletas", "Service"],
             customers="Gente del barrio.", prices=["Service simple: $ 990, moneda sin confirmar"],
             where_and_when=["Abrís de lunes a viernes de 9 a 18"], channels=["https://bici.uy"],
             voice="", edge="", questions=["¿Hacés envíos?", "¿Aceptás tarjeta?"],
             sources=["https://bici.uy/", "https://bici.uy/service"])


def fresh():
    db.write("DELETE FROM business_confirmed")
    draft.parent.mkdir(parents=True, exist_ok=True)
    draft.write_text(business_draft.render(PARTS, datetime(2026, 9, 23)))


app = FastAPI()
app.include_router(business_routes.router)

try:
    with TestClient(app) as client:
        # a.
        fresh()
        business_draft.confirm(draft.read_text(), "prices")
        out["a_confirmed"] = sorted(business_draft.confirmations(draft.read_text()))
        draft.write_text(draft.read_text().replace("$ 990", "$ 1090"))
        out["a_after_edit"] = sorted(business_draft.confirmations(draft.read_text()))

        # b.
        fresh()
        r = client.put("/portal/business/sections/where_and_when",
                       json={"text": "- Abrís de lunes a viernes de 9 a 18\nLos sábados de 9 a 13"})
        out["b_put"] = {"status": r.status_code, "body": r.json()}
        out["b_file"] = draft.read_text()
        out["b_unknown"] = client.put("/portal/business/sections/questions", json={"text": "x"}).status_code
        out["b_empty"] = client.put("/portal/business/sections/voice", json={"text": "  "}).json()
        r = client.post("/portal/business/sections/summary/confirm")
        out["b_confirm"] = {"status": r.status_code, "body": r.json()}
        got = client.get("/portal/business").json()
        out["b_get"] = got
        draft.unlink()
        out["b_no_draft"] = client.post("/portal/business/sections/summary/confirm").status_code
        out["b_get_empty"] = client.get("/portal/business").json()

        # c.
        fresh()
        db.write("DELETE FROM business_researched")
        mine = "- Service simple: $ 1100 pesos\n- Service completo: $ 2500 pesos"
        client.put("/portal/business/sections/prices", json={"text": mine})
        mine_body = business_draft.body(draft.read_text(), "prices")
        async def few(url):
            return [url]
        business_site.pages = few
        tool = business_draft.toolset().tools["save_draft"]
        out["c_said"] = asyncio.run(tool.function(
            None, summary="Tenés una bicicletería nueva.", offer=["Bicis eléctricas"], customers="",
            prices=["Service simple: $ 990"], where_and_when=[], channels=[], voice="", edge="",
            questions=["¿Abrís los domingos?"], sources=["https://bici2.uy/"]))
        text = draft.read_text()
        out["c_prices_kept"] = business_draft.body(text, "prices") == mine_body
        out["c_summary"] = business_draft.body(text, "summary")
        out["c_confirmed"] = sorted(business_draft.confirmations(text))
        out["c_researched_at"] = business_draft.researched_at(text)

        # d.
        correct = business_draft.corrections().tools["correct_draft"].function
        correct(section="voice", content=["Cercano, de vos."], answered_questions=[])
        out["d_confirmed"] = sorted(business_draft.confirmations(draft.read_text()))
        out["d_events"] = [dict(e) for e in db.query(
            "SELECT kind, label, status FROM events WHERE id > ? AND kind = 'business.corrected'", (first_event,))]

        # e.
        note = "A los mayoristas no les hago descuento.\n\n## Ojo\n- El dueño se llama Juan."
        out["e_notes_put"] = client.put("/portal/business/notes", json={"text": note}).json()
        out["e_notes_same"] = client.get("/portal/business").json()["notes"] == note
        pdf = base64.b64encode(b"%PDF-1.4 lista").decode()
        up = client.post("/portal/business/files", json={"name": "precios.pdf", "content_b64": pdf})
        out["e_upload"] = {"status": up.status_code, "body": up.json()}
        again = client.post("/portal/business/files", json={"name": "precios.pdf",
                                                            "content_b64": base64.b64encode(b"otra").decode()})
        out["e_again_size"] = again.json()["file"]["size"]
        climb = client.post("/portal/business/files", json={"name": "../../../state/escape.txt",
                                                            "content_b64": base64.b64encode(b"x").decode()})
        out["e_climb"] = {"status": climb.status_code, "path": climb.json().get("file", {}).get("path")}
        out["e_escaped"] = (WS.parent / "state" / "escape.txt").exists() or (WS / "escape.txt").exists()
        out["e_dots"] = client.post("/portal/business/files", json={"name": "..", "content_b64": pdf}).status_code
        out["e_bad_b64"] = client.post("/portal/business/files", json={"name": "a.txt", "content_b64": "%%"}).status_code
        out["e_files"] = client.get("/portal/business").json()["files"]
        out["e_del"] = client.delete("/portal/business/files/escape.txt").json()
        out["e_del_again"] = client.delete("/portal/business/files/escape.txt").status_code
        out["e_del_climb"] = client.delete("/portal/business/files/..%2F..%2Fnotas.md").status_code
        out["e_del_climb_kept"] = notes.exists()

        # f.
        async def slow(company, url):
            await asyncio.sleep(0.6)
            return "listo"
        researcher.run = slow
        who = identity.load()
        identity.save(who | {"url": "", "company": "Bici Prueba"})
        draft.unlink()
        out["f_no_site"] = client.post("/portal/business/research").status_code
        r = client.post("/portal/business/research", json={"website": "https://bici.uy"})
        out["f_start"] = r.status_code
        out["f_researching"] = client.get("/portal/business").json()["researching"]
        out["f_busy"] = client.post("/portal/business/research").json()
        out["f_busy_status"] = client.post("/portal/business/research").status_code
        out["f_identity_url"] = identity.load().get("url")
        for _ in range(40):
            if not client.get("/portal/business").json()["researching"]:
                break
            time.sleep(0.1)
        out["f_done"] = not client.get("/portal/business").json()["researching"]
        out["f_events"] = [dict(e) for e in db.query(
            "SELECT kind, label, status FROM events WHERE id > ? AND kind = 'business.researched'", (first_event,))]
        out["f_marked"] = business_watch.done("Bici Prueba|https://bici.uy")

    # g. The real face, all plugins loaded, one run with the model captured.
    fresh()
    business_draft.confirm(draft.read_text(), "prices")
    from core import plugins
    plugins.load()
    from core.agent import Deps, get_agent
    from pydantic_ai.models.function import FunctionModel
    seen = {}
    async def capture(messages, info):
        seen["instructions"] = messages[-1].instructions
        yield "hola"
    agent = get_agent()
    with agent.override(model=FunctionModel(stream_function=capture)):
        asyncio.run(agent.run("hola", deps=Deps(workspace=WS, session_id="prueba_marca")))
    db.write("DELETE FROM events WHERE session_id = ?", ("prueba_marca",))
    t = seen["instructions"]
    out["g_block"] = t[t.find(business_context.HEADING):t.find("Hoy es ")] if business_context.HEADING in t else ""
    out["g_order"] = {
        "memory": t.find("Esta es tu memoria de las conversaciones"),
        "rules": t.find("## Lo que sabés del negocio"),
        "block": t.find(business_context.HEADING),
        "date": t.find("Hoy es "),
    }
finally:
    db.write("DELETE FROM business_confirmed")
    for r in confirmed_rows:
        db.write("INSERT INTO business_confirmed (section, digest, confirmed_at) VALUES (?, ?, ?)", tuple(r))
    db.write("DELETE FROM business_researched")
    for r in researched_rows:
        db.write("INSERT INTO business_researched (id, at) VALUES (?, ?)", tuple(r))
    db.write("DELETE FROM business_marks")
    for r in marks:
        db.write("INSERT INTO business_marks (key, at) VALUES (?, ?)", tuple(r))
    db.write("DELETE FROM events WHERE id > ?", (first_event,))
    if before is None:
        draft.unlink(missing_ok=True)
    else:
        draft.write_text(before)
    if notes_before is None:
        notes.unlink(missing_ok=True)
    else:
        notes.write_text(notes_before)
    shutil.rmtree(folder, ignore_errors=True)
    if had_folder:
        shutil.copytree(saved_folder, folder)
    if not negocio_existed and draft.parent.is_dir() and not any(draft.parent.iterdir()):
        draft.parent.rmdir()
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
    if r["a_confirmed"] != ["prices"]:
        problems.append(f"confirmed read {r['a_confirmed']!r}")
    if r["a_after_edit"]:
        problems.append(f"a hand edit left {r['a_after_edit']!r} confirmed")
    failures += judge("a. a confirmation lapses when the text changes", problems)

    problems = []
    put = r["b_put"]
    want = {"key": "where_and_when", "heading": "Dónde y cuándo",
            "text": "- Abrís de lunes a viernes de 9 a 18\n- Los sábados de 9 a 13", "confirmed": True}
    got = put["body"].get("section", {})
    if put["status"] != 200 or put["body"].get("ok") is not True or any(got.get(k) != v for k, v in want.items()):
        problems.append(f"PUT answered {put!r}")
    if not isinstance(got.get("confirmed_at"), (int, float)):
        problems.append("confirmed_at is not epoch seconds")
    if "## Dónde y cuándo\n\n- Abrís de lunes a viernes de 9 a 18\n- Los sábados de 9 a 13\n\n## Por dónde" not in r["b_file"]:
        problems.append("the draft does not read as edited, in its own format")
    if r["b_unknown"] != 404:
        problems.append(f"a PUT on questions gave {r['b_unknown']}")
    # A bare app: FastAPI's `detail`, which the engine's handler serves as `error.message`.
    if "vacía" not in r["b_empty"].get("detail", ""):
        problems.append(f"an empty text gave {r['b_empty']!r}")
    if r["b_confirm"]["status"] != 200 or r["b_confirm"]["body"]["section"]["confirmed"] is not True:
        problems.append(f"the confirm button gave {r['b_confirm']!r}")
    g = r["b_get"]
    keys = [s["key"] for s in g["sections"]]
    if keys != ["summary", "offer", "customers", "prices", "where_and_when", "channels", "voice", "edge"]:
        problems.append(f"GET sections are {keys!r}")
    states = {s["key"]: s["confirmed"] for s in g["sections"]}
    if [k for k, v in states.items() if v] != ["summary", "where_and_when"]:
        problems.append(f"confirmed on GET: {states!r}")
    if g["questions"] != ["¿Hacés envíos?", "¿Aceptás tarjeta?"] or g["sources"] != ["https://bici.uy/", "https://bici.uy/service"]:
        problems.append(f"questions/sources read {g['questions']!r} {g['sources']!r}")
    if not g["exists"] or not isinstance(g["researched_at"], (int, float)):
        problems.append(f"exists/researched_at read {g['exists']!r} {g['researched_at']!r}")
    if any(s["text"].startswith("## ") for s in g["sections"]):
        problems.append("a section's text carries its heading")
    if r["b_no_draft"] != 404:
        problems.append(f"confirming with no draft gave {r['b_no_draft']}")
    e = r["b_get_empty"]
    if e["exists"] or e["sections"] or e["researched_at"] is not None:
        problems.append(f"with no draft GET gave {e!r}")
    failures += judge("b. her edit confirms, the button confirms as it reads", problems)

    problems = []
    if not r["c_prices_kept"]:
        problems.append("the researcher rewrote the confirmed prices")
    if r["c_confirmed"] != ["prices"]:
        problems.append(f"after the research, confirmed: {r['c_confirmed']!r}")
    if r["c_summary"] != "Tenés una bicicletería nueva.":
        problems.append(f"an unconfirmed section was not rewritten: {r['c_summary']!r}")
    if "Dejé como estaban «Precios publicados»" not in r["c_said"]:
        problems.append(f"the researcher was told {r['c_said']!r}")
    if not isinstance(r["c_researched_at"], (int, float)):
        problems.append("researched_at was not stamped")
    failures += judge("c. the researcher keeps what she confirmed", problems)

    problems = []
    if "voice" not in r["d_confirmed"]:
        problems.append(f"correct_draft left confirmed {r['d_confirmed']!r}")
    ev = r["d_events"]
    if len(ev) != 1 or "«Cómo hablás»" not in ev[0]["label"] or "Marca" not in ev[0]["label"]:
        problems.append(f"Activity got {ev!r}")
    failures += judge("d. the face's correction is her word", problems)

    problems = []
    if r["e_notes_put"] != {"ok": True} or not r["e_notes_same"]:
        problems.append("the notes did not read back verbatim")
    up = r["e_upload"]
    f = up["body"].get("file", {})
    if up["status"] != 200 or f.get("path") != "negocio/archivos/precios.pdf" or f.get("name") != "precios.pdf" \
            or f.get("size") != len(b"%PDF-1.4 lista") or not isinstance(f.get("uploaded_at"), int):
        problems.append(f"the upload answered {up!r}")
    if r["e_again_size"] != 4:
        problems.append("the same name did not replace the file")
    if r["e_climb"]["path"] != "negocio/archivos/escape.txt" or r["e_escaped"]:
        problems.append(f"a name with folders landed at {r['e_climb']!r} (escaped: {r['e_escaped']})")
    if r["e_dots"] != 400 or r["e_bad_b64"] != 400:
        problems.append(f"«..» gave {r['e_dots']}, bad base64 gave {r['e_bad_b64']}")
    if [x["name"] for x in r["e_files"]] != ["escape.txt", "precios.pdf"]:
        problems.append(f"files listed {r['e_files']!r}")
    if r["e_del"] != {"ok": True} or r["e_del_again"] != 404 or r["e_del_climb"] != 404 or not r["e_del_climb_kept"]:
        problems.append(f"delete gave {r['e_del']!r}, again {r['e_del_again']}, «..» {r['e_del_climb']}")
    failures += judge("e. notes and files round-trip, and stay inside", problems)

    problems = []
    if r["f_no_site"] != 400:
        problems.append(f"no website gave {r['f_no_site']}")
    if r["f_start"] != 200 or not r["f_researching"]:
        problems.append(f"the start gave {r['f_start']}, researching {r['f_researching']}")
    if r["f_busy_status"] != 409 or "Ya estoy leyendo tu web" not in json.dumps(r["f_busy"], ensure_ascii=False):
        problems.append(f"a second ask gave {r['f_busy_status']} {r['f_busy']!r}")
    if r["f_identity_url"] != "https://bici.uy" or not r["f_marked"]:
        problems.append("the website she gave is not the business's, or the ticker would run it again")
    if not r["f_done"] or [e["status"] for e in r["f_events"]] != ["completed"]:
        problems.append(f"the end was {r['f_done']!r} {r['f_events']!r}")
    failures += judge("f. one research at a time, in the background", problems)

    problems = []
    b, o = r["g_block"], r["g_order"]
    if "### Precios publicados (confirmado por tu cliente)" not in b:
        problems.append("the confirmed section is not marked")
    if "### En pocas palabras (borrador: lo leí en la web, tu cliente no lo confirmó)" not in b:
        problems.append("a borrador section is not marked")
    if "Cómo hablás" in b:
        problems.append("a section nobody found or confirmed is in the block")
    if "- ¿Hacés envíos?" not in b:
        problems.append("the open questions are not in the block")
    note = "A los mayoristas no les hago descuento.\n\n## Ojo\n- El dueño se llama Juan."
    if f"### Lo que tu cliente escribió\n{note}" not in b:
        problems.append("the owner's notes are not in the block verbatim")
    if "- `negocio/archivos/precios.pdf`" not in b or "read_file" not in b:
        problems.append("the owner's file is not listed by its path")
    if not (0 <= o["memory"] < o["block"] < o["date"]) or not (0 <= o["rules"] < o["block"]):
        problems.append(f"the order is {o!r}")
    failures += judge("g. the face reads it on every run", problems)

    print("BUSINESS CONTEXT: " + ("PASS" if not failures else "FAIL"))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
