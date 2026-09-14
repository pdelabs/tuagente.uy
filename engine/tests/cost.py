#!/usr/bin/env python3
"""G6 — what a turn costs on this engine, measured the way the baseline was.

`kit/notes/cost-and-engine-findings.md` §1: send the turn the way
`chat/page.tsx` sends it (`POST /portal/chat/stream`, `stream: true`), read
`GET https://openrouter.ai/api/v1/key` before and after, and poll the key
until the delta stops moving. §1 also names the trap: THE DELTA IS ONLY
ATTRIBUTABLE WHEN NOTHING ELSE IS TALKING TO THIS AGENT. Do not run this
while the portal is open or the compaction gate is running.

§2 is why the table has two money columns. On Hermes the engine's own
estimate matched the provider to the last decimal; here the engine's estimate
is genai-prices, written per turn as a `turn_usage` event by
`core/turn_usage.py`. Both numbers are printed so the claim can be checked
rather than repeated.
"""

import json
import subprocess
import time
import urllib.request
from pathlib import Path

CORE = Path(__file__).resolve().parent.parent
ADAPTER = "http://127.0.0.1:8643"
ENDPOINT = "http://127.0.0.1:8642"
QUIET_SECONDS = 20
BASELINE = {"conversational": 0.0036, "tools": 0.0247}

secrets = dict(
    line.split("=", 1)
    for line in (CORE / "secrets.env").read_text().splitlines()
    if "=" in line and not line.startswith("#")
)
KEY = secrets["API_SERVER_KEY"].strip()
OPENROUTER_KEY = secrets["OPENROUTER_API_KEY"].strip()

CONVERSATIONAL = "Contame en dos líneas qué podés hacer por una ferretería."
TOOL_HEAVY = (
    "Escribí tres archivos: notas/costo-1.md, notas/costo-2.md y notas/costo-3.md,"
    " cada uno con una línea distinta sobre tornillos. Después listá el workspace"
    " y decime cuántos archivos hay."
)


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


def settled(before: float) -> float:
    """The delta once the key has stopped moving for QUIET_SECONDS."""
    last, changed_at = key_usage(), time.time()
    while time.time() - changed_at < QUIET_SECONDS:
        time.sleep(2)
        now = key_usage()
        if now != last:
            last, changed_at = now, time.time()
    return last - before


def session_for(message: str) -> str:
    """The session that opened with this message.

    Not "the newest session": another agent driving the same container would
    otherwise hand us its conversation, and the usage row we read would be
    somebody else's turn.
    """
    return next(
        row["id"]
        for row in get(f"{ENDPOINT}/api/sessions")["data"]
        if get(f"{ENDPOINT}/api/sessions/{row['id']}/messages")["data"][0]["content"] == message
    )


def turn(message: str) -> tuple[int, float]:
    """One turn on a FRESH session. Returns (tool events, seconds)."""
    request = urllib.request.Request(
        f"{ADAPTER}/portal/chat/stream",
        data=json.dumps({"stream": True, "messages": [{"role": "user", "content": message}]}).encode(),
        headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"},
    )
    started, tools = time.time(), 0
    with urllib.request.urlopen(request, timeout=300) as response:
        for raw in response:
            line = raw.decode()
            # The OpenAI dialect names the tool event `hermes.tool.progress`;
            # the session dialect names it `tool.started`. Count either.
            if line.startswith("event: ") and line[7:].strip() in (
                "hermes.tool.progress", "tool.started"
            ):
                tools += 1
    return tools, time.time() - started


def engine_usage(session_id: str) -> dict:
    script = (
        "import json,sqlite3;"
        "c=sqlite3.connect('/state/core.db');"
        "r=c.execute(\"SELECT payload FROM events WHERE kind='turn_usage' AND session_id=?"
        f" ORDER BY id DESC LIMIT 1\",('{session_id}',)).fetchone();"
        "print(r[0])"
    )
    return json.loads(
        subprocess.run(
            ["docker", "exec", "tuagente-core", "python", "-c", script],
            check=True, capture_output=True, text=True,
        ).stdout
    )


def measure(label: str, message: str) -> dict:
    print(f"{label}: sending …")
    before = key_usage()
    tools, seconds = turn(message)
    print(f"{label}: sent in {seconds:.0f} s, {tools} tool events; waiting for the key to settle …")
    spent = settled(before)
    usage = engine_usage(session_for(message))
    return {"label": label, "tools": tools, "seconds": seconds, "usd": spent, "usage": usage}


def main() -> None:
    model = subprocess.run(
        ["docker", "exec", "tuagente-core", "python", "-c", "from core import config; print(config.MODEL)"],
        check=True, capture_output=True, text=True,
    ).stdout.strip()

    rows = [
        measure("conversational", CONVERSATIONAL),
        measure("with tools", TOOL_HEAVY),
    ]

    print()
    print(f"model: {model}")
    print()
    print(f"{'turn':<16}{'tools':>6}{'s':>6}{'metered US$':>14}{'engine US$':>13}{'baseline US$':>14}")
    for row, baseline in zip(rows, (BASELINE["conversational"], BASELINE["tools"])):
        engine = row["usage"]["cost_usd"]
        print(
            f"{row['label']:<16}{row['tools']:>6}{row['seconds']:>6.0f}"
            f"{row['usd']:>14.6f}{(engine if engine is not None else 0):>13.6f}{baseline:>14.4f}"
        )
    print()
    print("tokens per turn, from the `turn_usage` event the engine writes:")
    for row in rows:
        u = row["usage"]
        print(
            f"  {row['label']:<16} in {u['input_tokens']:>6} (cache read {u['cache_read_tokens']:>6})"
            f" · out {u['output_tokens']:>5} · {u['requests']} requests · {u['tool_calls']} tool calls"
        )
    print()
    print("baseline: kit/notes/cost-and-engine-findings.md §3 —")
    print("  US$0.0036 conversational, US$0.0247 with tools, on openai/gpt-5.6-luna")


if __name__ == "__main__":
    main()
