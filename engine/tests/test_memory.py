#!/usr/bin/env python3
"""Memory. Run it from anywhere: `python3 engine/tests/test_memory.py`.

Four short conversations against the container that is already up, one per
thing the mechanism has to do:

  a. EXPLICIT — the client says "acordate": the notebook gains the fact.
  b. CROSS-SESSION — a NEW conversation asks for the fact and gets it. This is
     the gate: a memory that only works inside one session is the history.
  c. IMPLICIT — the client says something in passing, with no magic word: the
     notebook gains it anyway. The test prints WHICH path wrote it — the
     extraction (`memoria` event) or the model's own `write_memory`.
  d. THE RULE — the client says "acordate" about a PROCEDURE: the notebook
     must not gain it. Memory holds facts and preferences; how to do a task is
     a skill, and a notebook that collects instructions is a second prompt
     nobody reviewed.

It clears the notebook first, so "contains" means "this run wrote it" and not
"something wrote it once".

~US$0.01: four turns, each with its extraction call behind it.
"""

import json
import re
import subprocess
import sys
import time
import unicodedata
import urllib.request
from pathlib import Path

CORE = Path(__file__).resolve().parent.parent
ADAPTER = "http://127.0.0.1:8643"
ENDPOINT = "http://127.0.0.1:8642"

# Where the store puts the notebook: the plugin's `FileStore(<workspace>/memoria)`
# plus its scope segment. Printed at the start, because the path is the client's
# — it is in the workspace so the Files tab shows it.
MEMORIA = CORE / "workspace" / "memoria"
NOTEBOOK = MEMORIA / "main" / "MEMORY.md"

secrets = (CORE / "secrets.env").read_text().splitlines()
KEY = next(l.split("=", 1)[1].strip() for l in secrets if l.startswith("API_SERVER_KEY="))
OPENROUTER_KEY = next(
    l.split("=", 1)[1].strip() for l in secrets if l.startswith("OPENROUTER_API_KEY=")
)


def post_sse(url: str, payload: dict) -> None:
    """One turn, read to the end. What it answered is read back from the DB."""
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode(),
        headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=300) as response:
        for _ in response:
            pass


def get(url: str) -> dict:
    request = urllib.request.Request(url, headers={"Authorization": f"Bearer {KEY}"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read())


def key_usage() -> float:
    request = urllib.request.Request(
        "https://openrouter.ai/api/v1/key",
        headers={"Authorization": f"Bearer {OPENROUTER_KEY}"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return float(json.loads(response.read())["data"]["usage"])


def conversation(opener: str) -> tuple[str, str]:
    """A NEW conversation with that opening message: (session id, the answer).

    Opened through the OpenAI-shaped endpoint, which is how the portal opens
    one, and found by its opening line — never by "the newest session", which
    would hand us another agent's conversation.
    """
    post_sse(
        f"{ADAPTER}/portal/chat/stream",
        {"stream": True, "messages": [{"role": "user", "content": opener}]},
    )
    session_id = next(
        row["id"]
        for row in get(f"{ENDPOINT}/api/sessions")["data"]
        if get(f"{ENDPOINT}/api/sessions/{row['id']}/messages")["data"][0]["content"] == opener
    )
    messages = get(f"{ENDPOINT}/api/sessions/{session_id}/messages")["data"]
    answer = next(m["content"] for m in reversed(messages) if m["role"] == "assistant")
    return session_id, answer


def notebook() -> str:
    return NOTEBOOK.read_text() if NOTEBOOK.is_file() else ""


def wrote_event(session_id: str) -> list[str]:
    """The lines the EXTRACTION appended on that session, off the event log."""
    script = (
        "import json,sqlite3;"
        "c=sqlite3.connect('/state/core.db');"
        "rows=c.execute(\"SELECT payload FROM events WHERE kind='memoria' AND session_id=?\","
        f"('{session_id}',)).fetchall();"
        "print(json.dumps([l for r in rows for l in json.loads(r[0])['lines']]))"
    )
    out = subprocess.run(
        ["docker", "exec", "tuagente-core", "python", "-c", script],
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    return json.loads(out)


def plain(text: str) -> str:
    """Lowercase, unaccented, punctuation-free — how the notebook is searched."""
    letters = unicodedata.normalize("NFD", text.lower())
    letters = "".join(c for c in letters if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]+", " ", letters).strip()


def added(before: str, after: str) -> list[str]:
    """The lines the notebook gained."""
    old = set(before.splitlines())
    return [line for line in after.splitlines() if line.strip() and line not in old]


def step(name: str, opener: str) -> tuple[str, str, list[str], list[str]]:
    """One conversation: (the answer, the notebook, the new lines, the events)."""
    before = notebook()
    print(f"\n{name}\n  cliente: {opener}")
    started = time.time()
    session_id, answer = conversation(opener)
    print(f"  agente : {' '.join(answer.split())[:220]}")
    new = added(before, notebook())
    events = wrote_event(session_id)
    path = "extraction" if events else ("write_memory" if new else "nothing")
    print(f"  {int(time.time() - started)} s · session {session_id} · wrote: {path}")
    for line in new:
        print(f"    + {line}")
    return answer, notebook(), new, events


def judge(name: str, problems: list[str]) -> list[str]:
    """One line per step, so a failure is read where it happened."""
    print(f"  {name}: " + ("PASS" if not problems else "FAIL — " + "; ".join(problems)))
    return problems


def main() -> int:
    get(f"{ADAPTER}/portal/manifest")
    print(f"notebook: {NOTEBOOK}")
    if NOTEBOOK.is_file():
        print("  (clearing what was in it, so `contains` means this run wrote it)")
        for line in notebook().splitlines():
            print(f"    - {line}")
        NOTEBOOK.unlink()

    before_usd = key_usage()
    failures = []

    answer, book, new, events = step(
        "a. explicit — «acordate»",
        "Acordate que mi proveedor de bisagras es Ferretería Ríos y entrega los jueves.",
    )
    failures += judge("a", [
        *(["the notebook does not name Ríos"] if "rios" not in plain(book) else []),
        *(["the notebook does not say jueves"] if "jueves" not in plain(book) else []),
    ])

    answer, book, new, events = step(
        "b. cross-session — a NEW conversation",
        "¿Quién es mi proveedor de bisagras y qué día entrega?",
    )
    failures += judge("b", [
        *(["the answer does not name Ríos"] if "rios" not in plain(answer) else []),
        *(["the answer does not say jueves"] if "jueves" not in plain(answer) else []),
    ])

    answer, book, new, events = step(
        "c. implicit — no magic word",
        "Che, los sábados abrimos de 9 a 13, así que si alguien pregunta por el"
        " horario del finde decile eso.",
    )
    failures += judge("c", [
        *(["the notebook does not say sábado"] if "sabado" not in plain(book) else []),
        # The hours as the model chose to write them: «9 a 13», «9:00 a 13:00»,
        # «de 9 a 13 h». The two numbers close together is the claim.
        *([] if re.search(r"\b9\b.{0,12}\b13\b", plain(book))
          else ["the notebook does not carry the 9 a 13 hours"]),
    ])

    answer, book, new, events = step(
        "d. the rule — «acordate» about a procedure",
        "Acordate que para mandar un mail primero hay que abrir la consola y"
        " correr el script viejo.",
    )
    took = [l for l in new if "consola" in plain(l) or "script" in plain(l)]
    for line in took:
        print(f"    the notebook took the procedure: {line}")
    failures += judge("d", ["the notebook gained the procedure"] if took else [])

    print("\nthe notebook, verbatim:")
    print(notebook() or "(empty)")
    print(f"OpenRouter key delta   : US${key_usage() - before_usd:.4f}")
    print("MEMORY: PASS" if not failures else "MEMORY: FAIL")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
