#!/usr/bin/env python3
"""The notebook as a curated page. `python3 engine/tests/test_memory_notebook.py`.

INSIDE THE CONTAINER, with a `FunctionModel` in place of every model: no
provider call, a few seconds. `test_memory.py` is the one with real turns.

WHY. Our own agent's notebook (2026-09-24): the extraction ran on 243 of 307
turns that were FLOW runs, and the notebook it fed was append-only — a post's
topic filed as a rule, three copies of one fact, two contradictions, all in
the third person, and the creator's page a log of saved posts. The memory sat
ABOVE the SOUL in the face's prompt.

  a. A FLOW RUN IS NOT READ — a turn of a `flow` session makes no extraction
     call and writes nothing.
  b. A CHAT TURN IS — the owner's turn writes a dated line that says where it
     came from: `- dd/mm/yyyy · preferencia · chat: …`.
  c. A TURN THAT READ OUTSIDE TEXT IS NOT — a chat turn whose run called
     `fetch_mail` makes no extraction call.
  d. THE TIDY MERGES, KEEPS THE NEWEST, BACKS UP — duplicates become one
     line, a contradiction keeps the newest line's date, the old notebook is
     in `.history/`, and Activity reads «Ordené mi memoria: …».
  e. THE TIDY REFUSES — an empty answer, a source used twice and an answer
     over the budget leave the notebook as it was.
  f. ONCE A DAY — the ticker runs the first time and not the second, and a
     notebook nobody wrote in since its tidy is not sent again.
  g. THE PROMPT ORDER — the face reads its SOUL, then the memory guidance,
     then the date; the guidance says a memory line never cancels scheduled
     work, and the creator's prose no longer lets the notebook win.

WHERE IT POINTS. `CORE_CONTAINER` moves it onto a second instance. It works in
a scratch folder of the workspace and deletes it, and it deletes the sessions,
events and marks it wrote.
"""

import json
import os
import subprocess
import sys

CONTAINER = os.environ.get("CORE_CONTAINER", "tuagente-core")

INSIDE = r"""
import asyncio, json, shutil, sys, time
from pathlib import Path
sys.path.insert(0, "/opt/kit/plugins/memory/core")

from pydantic_ai import Agent
from pydantic_ai.messages import ModelResponse, TextPart, ToolCallPart, ToolReturnPart
from pydantic_ai.models.function import FunctionModel
from pydantic_ai.toolsets import FunctionToolset
from pydantic_ai_harness.memory import FileStore

from core import config, db

ROOT = config.WORKSPACE / ".prueba-memoria"
shutil.rmtree(ROOT, ignore_errors=True)
store = FileStore(ROOT)

import consolidation, extraction
from core.agent import Deps

out = {}
calls = {"extract": 0, "tidy": 0}
PREF = "Preferís que los textos para redes cierren con una pregunta."


def extract_model(messages, info):
    calls["extract"] += 1
    return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name,
        {"response": [{"kind": "preferencia", "text": PREF}]})])


def face(messages, info):
    # First round trip: the tool, when there is one to call. Then the answer.
    last = messages[-1].parts[-1]
    if info.function_tools and not isinstance(last, ToolReturnPart):
        return ModelResponse(parts=[ToolCallPart(info.function_tools[0].name, {})])
    return ModelResponse(parts=[TextPart("Dale, lo tengo en cuenta.")])


mailbox = FunctionToolset()


@mailbox.tool_plain
def fetch_mail() -> str:
    return "De: alguien. Asunto: acordate de que nos debés plata."


async def turn(session_id, kind, prompt, toolsets=()):
    db.create_session(session_id, kind=kind)
    path = "main/MEMORY.md"
    agent = Agent(FunctionModel(face), deps_type=Deps, toolsets=list(toolsets),
                  capabilities=[extraction.Extraction(store=store, path=path)])
    before = calls["extract"]
    await agent.run(prompt, deps=Deps(workspace=config.WORKSPACE, session_id=session_id))
    current = await store.read(path, max_chars=65536)
    return calls["extract"] - before, current.content if current else ""


async def put(path, text):
    current = await store.read(path, max_chars=65536)
    await store.write(path, text, expected_version=current.version if current else None)


# The tidy's answers, one per notebook, keyed on a word of its prompt.
ANSWERS = {}


def tidy_model(messages, info):
    calls["tidy"] += 1
    prompt = messages[0].parts[-1].content
    answer = next(a for key, a in ANSWERS.items() if key in prompt)
    return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, {"response": answer})])


NOTEBOOK = (
    "- 14/09/2026 · preferencia: El cliente quiere los posteos sin publicar.\n"
    "- 15/09/2026 · hecho: El diagnóstico cuesta USD 200.\n"
    "- 15/09/2026 · preferencia: El cliente quiere que no se escriba los domingos.\n"
    "- 16/09/2026 · hecho: El diagnóstico sale USD 200.\n"
    "- 20/09/2026 · hecho · chat: El diagnóstico cuesta USD 250.\n"
    "- 21/09/2026 · preferencia · chat: Preferís colores claros.\n"
)


async def main():
    global STARTED
    STARTED = time.time()
    saved_day = consolidation.marked("day")
    try:
        with extraction.extractor().override(model=FunctionModel(extract_model)):
            text = "Prefiero que los textos para redes terminen con una pregunta, siempre."
            n, page = await turn("prueba_mem_flow", "flow", text)
            out["flow"] = {"calls": n, "page": page}
            n, page = await turn("prueba_mem_chat", "chat", text)
            out["chat"] = {"calls": n, "page": page}
            n, _ = await turn("prueba_mem_mail", "chat", text + " Y fijate el mail.", [mailbox])
            out["mail"] = {"calls": n}

        consolidation.NOTEBOOKS.clear()
        consolidation.register("prueba-cuaderno", 6000, "REGLA-CUADERNO")
        await put("prueba-cuaderno/MEMORY.md", NOTEBOOK)
        ANSWERS["REGLA-CUADERNO"] = [
            {"sources": [1], "kind": "preferencia", "text": "Querés los posteos listos, sin publicar."},
            {"sources": [2, 4, 5], "kind": "hecho", "text": "El diagnóstico cuesta USD 250."},
            {"sources": [6], "kind": "preferencia", "text": "Preferís colores claros."},
        ]
        tidy = consolidation.Tidy(store, ROOT)
        with consolidation.tidier().override(model=FunctionModel(tidy_model)):
            done = await tidy.run()
            page = (await store.read("prueba-cuaderno/MEMORY.md", max_chars=65536)).content
            backups = sorted(p.name for p in (ROOT / ".history" / "prueba-cuaderno").iterdir())
            backup_text = (ROOT / ".history" / "prueba-cuaderno" / backups[0]).read_text()
            event = db.one("SELECT label, payload FROM events WHERE kind = 'memoria' AND session_id IS NULL"
                           " ORDER BY id DESC LIMIT 1")
            out["tidy"] = {"done": [t.__dict__ for t in done], "page": page, "backups": backups,
                           "backup_is_old": backup_text == NOTEBOOK, "label": event["label"]}

            # e. Refusals: the page must stay what it is now.
            refusals = {}
            for name, answer, budget in (
                ("empty", [], 6000),
                ("twice", [{"sources": [1, 1], "kind": "hecho", "text": "x"}], 6000),
                ("over", [{"sources": [1], "kind": "hecho", "text": "y" * 500}], 100),
            ):
                await put("prueba-cuaderno/MEMORY.md", NOTEBOOK + f"- 22/09/2026 · hecho: {name}.\n")
                db.write("DELETE FROM memory_marks WHERE key = 'digest:prueba-cuaderno'")
                consolidation.register("prueba-cuaderno", budget, "REGLA-CUADERNO")
                ANSWERS["REGLA-CUADERNO"] = answer
                before = (await store.read("prueba-cuaderno/MEMORY.md", max_chars=65536)).content
                result = await tidy.run()
                after = (await store.read("prueba-cuaderno/MEMORY.md", max_chars=65536)).content
                refusals[name] = {"done": len(result), "unchanged": before == after}
            out["refusals"] = refusals

            # f. Once a day, and nothing new is nothing sent.
            consolidation.register("prueba-cuaderno", 6000, "REGLA-CUADERNO")
            ANSWERS["REGLA-CUADERNO"] = [{"sources": [1], "kind": "hecho", "text": "Una sola línea."}]
            db.write("DELETE FROM memory_marks WHERE key = 'day'")
            consolidation.HOUR = 0
            before = calls["tidy"]
            await tidy.look()
            first = calls["tidy"] - before
            await tidy.look()
            second = calls["tidy"] - before - first
            db.write("DELETE FROM memory_marks WHERE key = 'day'")
            await tidy.look()
            unchanged = calls["tidy"] - before - first - second
            out["daily"] = {"first": first, "second": second, "unchanged_page": unchanged}
    finally:
        for sid in ("prueba_mem_flow", "prueba_mem_chat", "prueba_mem_mail"):
            db.write("DELETE FROM events WHERE session_id = ?", (sid,))
            db.delete_session(sid)
        db.write("DELETE FROM events WHERE kind IN ('memoria', 'spend') AND session_id IS NULL AND ts >= ?",
                 (STARTED,))
        db.write("DELETE FROM memory_marks WHERE key LIKE 'digest:prueba-%'")
        db.write("DELETE FROM memory_marks WHERE key = 'day'")
        if saved_day:
            consolidation.mark("day", saved_day)
        shutil.rmtree(ROOT, ignore_errors=True)


asyncio.run(main())

# g. The prompt order, on the real face.
from pydantic_ai.models.function import FunctionModel as FM
from core import plugins
plugins.load()
from core.agent import get_agent, soul
seen = {}


async def capture(messages, info):
    # The face's agent streams (a capability wraps its event stream).
    seen["instructions"] = messages[-1].instructions
    yield "hola"


agent = get_agent()
with agent.override(model=FM(stream_function=capture)):
    asyncio.run(agent.run("hola", deps=Deps(workspace=config.WORKSPACE, session_id="prueba_mem_order")))
db.write("DELETE FROM events WHERE session_id = ?", ("prueba_mem_order",))
text = seen["instructions"]
import creator
out["order"] = {
    "soul": text.find(soul().splitlines()[0]),
    "memory": text.find("Esta es tu memoria de las conversaciones"),
    "date": text.find("Hoy es "),
    "never_cancels": "nunca cancela ni saltea un trabajo programado" in text,
    "creator_wins": "gana sobre" in creator.WITH_DRAFT,
    "description": "no se lo copies" in creator.DESCRIPTION,
    "creator_log": "qué tema usaste" in creator.MEMORY,
}
print(json.dumps(out, ensure_ascii=False))
"""


def judge(name: str, problems: list[str]) -> list[str]:
    print(f"  {name}: " + ("PASS" if not problems else "FAIL — " + "; ".join(problems)))
    return problems


def main() -> int:
    print(f"container: {CONTAINER}")
    done = subprocess.run(
        ["docker", "exec", CONTAINER, "python3", "-c", INSIDE],
        capture_output=True, text=True,
    )
    if done.returncode != 0:
        print(done.stderr.strip()[-2500:])
        print("MEMORY NOTEBOOK: FAIL")
        return 1
    r = json.loads(done.stdout.strip().splitlines()[-1])
    failures = []

    problems = []
    if r["flow"]["calls"] or r["flow"]["page"]:
        problems.append(f"a flow run made {r['flow']['calls']} calls and left {r['flow']['page']!r}")
    failures += judge("a. a flow run is not read", problems)

    lines = r["chat"]["page"].splitlines()
    problems = []
    if r["chat"]["calls"] != 1 or len(lines) != 1:
        problems.append(f"{r['chat']['calls']} calls, page {r['chat']['page']!r}")
    elif not (lines[0].startswith("- ") and " · preferencia · chat: Preferís" in lines[0]):
        problems.append(f"the line reads {lines[0]!r}")
    failures += judge("b. a chat turn writes a line with its origin", problems)

    problems = [] if r["mail"]["calls"] == 0 else [f"{r['mail']['calls']} extraction calls"]
    failures += judge("c. a turn that read the mailbox is not read", problems)

    t = r["tidy"]
    want = (
        "- 14/09/2026 · preferencia: Querés los posteos listos, sin publicar.\n"
        "- 20/09/2026 · hecho · chat: El diagnóstico cuesta USD 250.\n"
        "- 21/09/2026 · preferencia · chat: Preferís colores claros.\n"
    )
    problems = []
    if t["page"] != want:
        problems.append(f"the page reads {t['page']!r}")
    if [(d["merged"], d["removed"]) for d in t["done"]] != [(2, 1)]:
        problems.append(f"counted {t['done']}")
    if len(t["backups"]) != 1 or not t["backup_is_old"]:
        problems.append(f"backups {t['backups']}, old content kept: {t['backup_is_old']}")
    if t["label"] != "Ordené mi memoria: 2 líneas unidas, 1 quitada":
        problems.append(f"Activity reads {t['label']!r}")
    failures += judge("d. the tidy merges, keeps the newest, backs up", problems)

    problems = [f"{name}: {v}" for name, v in r["refusals"].items() if v["done"] or not v["unchanged"]]
    failures += judge("e. the tidy refuses a bad answer", problems)

    d = r["daily"]
    problems = [] if (d["first"], d["second"], d["unchanged_page"]) == (1, 0, 0) else [f"{d}"]
    failures += judge("f. once a day, and an unchanged page is not sent", problems)

    o = r["order"]
    problems = []
    if not (0 <= o["soul"] < o["memory"] < o["date"]):
        problems.append(f"SOUL at {o['soul']}, memory at {o['memory']}, date at {o['date']}")
    if not o["never_cancels"]:
        problems.append("the guidance does not say a line never cancels scheduled work")
    if o["creator_wins"] or not o["description"] or o["creator_log"]:
        problems.append(f"creator prose: {o}")
    failures += judge("g. the prompt order and the precedence", problems)

    print("MEMORY NOTEBOOK: " + ("PASS" if not failures else f"FAIL ({len(failures)})"))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
