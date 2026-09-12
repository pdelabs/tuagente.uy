#!/usr/bin/env python3
"""G4 — compaction. Run it from anywhere: `python3 poc/core/tests/test_compaction.py`.

Restarts the container with `CORE_COMPACT_AT_TOKENS=6000` (the compose
passthrough), drives ONE session through 40 tool-heavy turns with a fact
planted at turn 2, and at turn 41 asks about the fact.

What it proves, in this order:
  a. the agent still answers the turn-2 question after 40 turns,
  b. the PERSISTED history (`history` row in /state/core.db) has fewer
     messages than two per turn — i.e. what Pydantic AI handed back to
     `core/session.py` is the compacted list, not the original one,
  c. compaction actually ran (`compaction` events, with before/after counts).

It puts the container back on the default threshold on the way out.
"""

import json
import os
import re
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

CORE = Path(__file__).resolve().parent.parent
ADAPTER = "http://127.0.0.1:8643"
ENDPOINT = "http://127.0.0.1:8642"
TURNS = 40
FACT = "mi proveedor de bisagras se llama Ferretería Ríos y entrega los jueves"

KEY = next(
    line.split("=", 1)[1].strip()
    for line in (CORE / "secrets.env").read_text().splitlines()
    if line.startswith("API_SERVER_KEY=")
)
OPENROUTER_KEY = next(
    line.split("=", 1)[1].strip()
    for line in (CORE / "secrets.env").read_text().splitlines()
    if line.startswith("OPENROUTER_API_KEY=")
)


def post_sse(url: str, payload: dict) -> list[tuple[str, dict]]:
    """Every `event: name / data: {...}` frame of one turn."""
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode(),
        headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"},
    )
    frames, name = [], None
    with urllib.request.urlopen(request, timeout=300) as response:
        for raw in response:
            line = raw.decode().rstrip("\n")
            if line.startswith("event: "):
                name = line[7:]
            elif line.startswith("data: ") and line[6:] != "[DONE]":
                frames.append((name, json.loads(line[6:])))
    return frames


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


def compose(**env) -> None:
    """Bring the container up with these env overrides, and wait for it."""
    subprocess.run(
        ["docker", "compose", "up", "-d"],
        cwd=CORE,
        check=True,
        env={**os.environ, **env},
        capture_output=True,
    )
    for _ in range(60):
        try:
            get(f"{ADAPTER}/portal/manifest")
            return
        except Exception:
            time.sleep(1)
    raise SystemExit("the container did not come back up")


def say(session_id: str, message: str) -> str:
    """One turn on the session; returns what got persisted as the answer.

    Retried once, and only for one failure: the stream ending with no
    `assistant.completed`, which is what a container that went away under the
    run looks like from here. Forty turns is forty minutes of real model
    spend, and something else restarting the container — another agent
    rebuilding it, `docker compose up` from another shell — must not cost the
    whole run. The restart also puts the threshold back to its default, so
    the override is re-applied before the retry or the rest of the run
    measures nothing.
    """
    url = f"{ADAPTER}/portal/sessions/{session_id}/chat/stream"
    for attempt in (1, 2):
        try:
            frames = post_sse(url, {"message": message})
            return next(data["content"] for name, data in frames if name == "assistant.completed")
        except (StopIteration, OSError) as exc:
            if attempt == 2:
                raise SystemExit(f"the turn never completed: {exc!r}")
            print(f"  (no answer came back — {exc!r}; bringing the container back and retrying)")
            compose(CORE_COMPACT_AT_TOKENS="6000")


def persisted(session_id: str) -> tuple[int, int]:
    """(messages in the engine's history, messages the portal displays)."""
    script = (
        "import json,sqlite3;"
        "c=sqlite3.connect('/state/core.db');"
        f"r=c.execute('SELECT messages FROM history WHERE session_id=?',('{session_id}',)).fetchone();"
        f"m=c.execute('SELECT COUNT(*) FROM messages WHERE session_id=?',('{session_id}',)).fetchone();"
        "print(len(json.loads(r[0])), m[0])"
    )
    out = subprocess.run(
        ["docker", "exec", "tuagente-core", "python", "-c", script],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.split()
    return int(out[0]), int(out[1])


def compactions(session_id: str) -> list[dict]:
    script = (
        "import json,sqlite3;"
        "c=sqlite3.connect('/state/core.db');"
        "rows=c.execute(\"SELECT payload FROM events WHERE kind='compaction' AND session_id=?\","
        f"('{session_id}',)).fetchall();"
        "print(json.dumps([json.loads(r[0]) for r in rows]))"
    )
    out = subprocess.run(
        ["docker", "exec", "tuagente-core", "python", "-c", script],
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    return json.loads(out)


def main() -> int:
    print("restarting the container with CORE_COMPACT_AT_TOKENS=6000 …")
    compose(CORE_COMPACT_AT_TOKENS="6000")
    before_usd = key_usage()
    started = time.time()

    # Turn 1 opens the session through the OpenAI-shaped endpoint, the same way
    # the portal opens a new conversation.
    opener = "Hola, arrancamos."
    post_sse(
        f"{ADAPTER}/portal/chat/stream",
        {"stream": True, "messages": [{"role": "user", "content": opener}]},
    )
    # By its opening line and not by "the newest session": another agent
    # driving the same container would otherwise hand us its conversation.
    session_id = next(
        row["id"]
        for row in get(f"{ENDPOINT}/api/sessions")["data"]
        if get(f"{ENDPOINT}/api/sessions/{row['id']}/messages")["data"][0]["content"] == opener
    )
    print(f"session {session_id}")

    print(f"turn  2/{TURNS}: planting the fact")
    say(session_id, f"Anotá esto para después: {FACT}. Contestá con una línea.")

    for turn in range(3, TURNS + 1):
        if turn % 2:
            message = (
                f"Escribí el archivo notas/{turn:02d}.md con el texto"
                f" 'nota {turn}'. Contestá con una línea."
            )
        else:
            message = f"Leé notas/{turn - 1:02d}.md y contame qué dice, en una línea."
        answer = say(session_id, message)
        history, shown = persisted(session_id)
        print(f"turn {turn:2d}/{TURNS}: history {history:3d} msgs · {answer.splitlines()[0][:60]}")

    question = "¿Cómo se llama mi proveedor de bisagras y qué día entrega?"
    print(f"turn 41/{TURNS}: {question}")
    answer = say(session_id, question)
    print(f"  → {answer.strip()[:300]}")

    history, shown = persisted(session_id)
    runs = compactions(session_id)
    spent = key_usage() - before_usd

    print()
    print(f"persisted history      : {history} messages")
    print(f"displayed messages     : {shown} ({TURNS + 1} turns, so {2 * (TURNS + 1)} expected)")
    print(f"compactions            : {len(runs)} → {[(r['before'], r['after']) for r in runs]}")
    print(f"seconds                : {int(time.time() - started)}")
    print(f"OpenRouter key delta   : US${spent:.4f}")

    failures = []
    plain = re.sub(r"[^\w\s]", "", answer.lower())
    if "rios" not in plain.replace("í", "i"):
        failures.append("the answer does not name Ríos")
    if "jueves" not in plain:
        failures.append("the answer does not say jueves")
    if history >= 2 * TURNS:
        failures.append(f"the persisted history is {history} messages, not bounded")
    if not runs:
        failures.append("no compaction ran")
    for problem in failures:
        print(f"FAIL: {problem}")
    print("G4: PASS" if not failures else "G4: FAIL")
    return 1 if failures else 0


if __name__ == "__main__":
    code = 1
    try:
        code = main()
    finally:
        print("putting the container back on the default threshold …")
        compose()
    sys.exit(code)
