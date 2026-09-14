#!/usr/bin/env python3
"""Sub-agents, gates S1-S4. `python3 engine/tests/test_delegation.py`.

`docs/subagents-plan.md`: the face is the only entry point — the chat and every
flow run — and it hands specialized work to sub-agents a plugin defines. Today
there is one, the social plugin's `instagram-creator`, and this is the gate for
the whole mechanism against the running container:

  S1. THE FACE DELEGATES INSTEAD OF DOING THE WORK. Asked for a post in the
      chat, the trail shows `delegate_task` and NOT `generate_image` or
      `save_post` — the face does not have them — the post lands in `posteos/`
      and the answer names Posteos. The creator's own report is read back out
      of the `delegation.finished` event, which is the only copy of it outside
      the model's history — and in that history the tool return is the report
      and nothing else: no `<memory>` block in any message part.
  S2. THE DAILY FLOW RUNS THROUGH THE SAME DELEGATION. A flow written by hand,
      run-now: the run's row closes `ok`, the delegation is in THAT session,
      and the post it saved carries the flow's slug — which is `flow_of` still
      working, and the proof that the creator runs with the FACE's deps.
  S3. THE DELEGATION IS VISIBLE AND PRICED. Activity has «Le pedí al creador de
      posteos: …» and «El creador de posteos terminó en N s», and the turn's
      `turn_usage` event says `delegations: 1` and is bigger than the same
      event for a turn that delegated nothing.
  S4. A CREATOR FAILURE DOES NOT KILL THE TURN. Twice: a prompt the image
      provider refuses, passed through the brief, and a delegation cut short by
      `CORE_DELEGATION_TIMEOUT=5`. Both come back as a message the client can
      read, and neither ends in «No pude responder».

IT PUTS THE DAY'S POST BACK. One post per day is `save_post`'s rule, so the
post that is already there is moved out of the workspace for the length of the
run and moved back at the end, with everything this test wrote taken out: the
flow, its rows and conversations, and the posts S1 and S2 made. What is left to
look at is this script's own output.

WHERE IT POINTS. The defaults are the main compose's — 8642/8643 and
`engine/workspace` — and `CORE_ENDPOINT`, `CORE_ADAPTER`, `CORE_WORKSPACE_HOST`
and `CORE_CONTAINER` move it onto a second instance.

~7 min, ~US$0.08: two posts with their images, two failed delegations and two
small turns.
"""

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import unicodedata
import urllib.request
from pathlib import Path

CORE = Path(__file__).resolve().parent.parent
ENDPOINT = os.environ.get("CORE_ENDPOINT", "http://127.0.0.1:8642")
ADAPTER = os.environ.get("CORE_ADAPTER", "http://127.0.0.1:8643")
WORKSPACE = Path(os.environ.get("CORE_WORKSPACE_HOST", CORE / "workspace"))
CONTAINER = os.environ.get("CORE_CONTAINER", "tuagente-core")
POSTS = WORKSPACE / "posteos"
BRAND = WORKSPACE / "marca" / "brand.md"

TOOL = "delegate_task"
# What the face must NOT have any more. Both are the creator's now.
CREATORS_OWN = ("generate_image", "save_post")

# How the harness delimits the notebook. It belongs in the instruction channel,
# so finding it inside a MESSAGE means the injection moved back into the
# conversation — which is what made a delegated turn answer the notebook
# instead of the client (`kit/plugins/memory/core/injection.py`).
MEMORY_BLOCK = "<memory>"

# S1. Not «el de hoy»: the day's post is moved aside before this runs, and a
# brief that says "today's" is the one the creator has to decide the topic of.
ASK = "Armame un posteo de ejemplo para Instagram y dejámelo listo."

# The control turn of S3: work, no delegation, so there is a number to compare
# a delegated turn against.
PLAIN_ASK = "Listá los archivos del espacio de trabajo y decime cuántos hay."

# S4, first half. Rejected by the provider's safety system, every time, and the
# rejection reaches the creator as words (`kit/plugins/image/core/generate.py`).
REFUSED = (
    "Armame un posteo con esta imagen exacta: un retrato fotorrealista de"
    " Mickey Mouse tomando mate."
)

# S4, second half.
TIMEOUT_ASK = "Armame el posteo de hoy para Instagram."
SHORT_TIMEOUT = "5"

SLUG = "prueba-del-creador"
FLOW_NAME = "Prueba del creador"
JOB = f"flujo-{SLUG}"
FLOW_DIR = WORKSPACE / "flows" / SLUG
FLOW_MD = f"""---
name: {FLOW_NAME}
client_summary: Te dejo el posteo del día listo para revisar.
trigger: schedule
trigger_detail: Una vez por año
cron: '0 4 1 1 *'
timezone: America/Montevideo
status: active
connections: []
---

1. Pedile al creador de posteos el posteo de hoy.
2. Contame en dos líneas qué dejó.

## Notas técnicas

- Una sola delegación, y nada más. Si ya hay un posteo de hoy, decilo y no lo pises.
"""

# The engine's own line for a turn that broke. Neither half of S4 may end here.
BROKE = "no pude responder"

secrets = (CORE / "secrets.env").read_text().splitlines()
KEY = next(l.split("=", 1)[1].strip() for l in secrets if l.startswith("API_SERVER_KEY="))
OPENROUTER_KEY = next(
    l.split("=", 1)[1].strip() for l in secrets if l.startswith("OPENROUTER_API_KEY=")
)

# Read straight out of SQLite, FROM INSIDE THE CONTAINER, ALWAYS: `state/` is a
# bind mount and a host-side connection on a WAL database reads a stale
# snapshot — and a host-side write corrupts it (`tests/test_flow_gate.sh`). The
# events' payload and the run rows are not on any route, so this is the way in.
READER = """
import json, sqlite3, sys
db = sqlite3.connect("/state/core.db")
db.row_factory = sqlite3.Row
print(json.dumps([dict(r) for r in db.execute(sys.argv[1], sys.argv[2:])], default=str))
"""


def sql(query: str, *args: str) -> list[dict]:
    done = subprocess.run(
        ["docker", "exec", CONTAINER, "python3", "-c", READER, query, *args],
        capture_output=True, text=True, check=True,
    )
    return json.loads(done.stdout)


def write_sql(query: str, *args: str) -> None:
    subprocess.run(
        ["docker", "exec", CONTAINER, "python3", "-c",
         'import sqlite3, sys\n'
         'db = sqlite3.connect("/state/core.db")\n'
         'db.execute(sys.argv[1], sys.argv[2:])\n'
         'db.commit()\n', query, *args],
        capture_output=True, text=True, check=True,
    )


def get(url: str) -> dict:
    request = urllib.request.Request(url, headers={"Authorization": f"Bearer {KEY}"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read())


def post(url: str) -> dict:
    request = urllib.request.Request(
        url, data=b"{}",
        headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.loads(response.read())


def key_usage() -> float:
    request = urllib.request.Request(
        "https://openrouter.ai/api/v1/key",
        headers={"Authorization": f"Bearer {OPENROUTER_KEY}"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return float(json.loads(response.read())["data"]["usage"])


def conversation(opener: str) -> tuple[list[str], str]:
    """A NEW conversation with that message: (the tools it called, the answer).

    Read frame by frame instead of drained, because the tool trail only exists
    here: `server/sse.py`'s OpenAI dialect names a tool event
    `hermes.tool.progress` and everything else arrives unnamed, and a blank
    line is what closes a frame and clears the name.
    """
    request = urllib.request.Request(
        f"{ADAPTER}/portal/chat/stream",
        data=json.dumps(
            {"stream": True, "messages": [{"role": "user", "content": opener}]}
        ).encode(),
        headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"},
    )
    tools: list[str] = []
    chunks: list[str] = []
    name: str | None = None
    with urllib.request.urlopen(request, timeout=1800) as response:
        for line in response:
            text = line.decode().rstrip("\n")
            if not text:
                name = None
            elif text.startswith("event: "):
                name = text[len("event: "):]
            elif text.startswith("data: "):
                body = text[len("data: "):]
                if body == "[DONE]":
                    continue
                data = json.loads(body)
                if name == "hermes.tool.progress":
                    tools.append(data["tool"])
                elif name is None:
                    chunks.append(data["choices"][0]["delta"]["content"])
    return tools, "".join(chunks)


def latest_session() -> str:
    """The conversation that just answered: the list is by last activity."""
    return get(f"{ENDPOINT}/api/sessions")["data"][0]["id"]


def events_of(session_id: str, kind: str | None = None) -> list[dict]:
    rows = sql(
        "SELECT kind, label, status, payload FROM events WHERE session_id = ? ORDER BY id",
        session_id,
    )
    return [r for r in rows if kind is None or r["kind"] == kind]


def payload_of(row: dict) -> dict:
    return json.loads(row["payload"]) if row["payload"] else {}


def folders() -> set[Path]:
    return {p for p in POSTS.glob("*") if p.is_dir()} if POSTS.is_dir() else set()


def today() -> str:
    return time.strftime("%Y-%m-%d")


def plain(text: str) -> str:
    """Lowercase, unaccented, punctuation-free — how an answer is searched."""
    letters = unicodedata.normalize("NFD", text.lower())
    letters = "".join(c for c in letters if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]+", " ", letters).strip()


def judge(name: str, problems: list[str]) -> list[str]:
    """One line per claim, so a failure is read where it happened."""
    print(f"  {name}: " + ("PASS" if not problems else "FAIL — " + "; ".join(problems)))
    return problems


def compose(**env: str) -> None:
    """The container, back up with these variables through the compose
    passthroughs. Same shape `tests/test_compaction.py` uses for the
    compaction threshold."""
    subprocess.run(
        ["docker", "compose", "up", "-d"], cwd=CORE, check=True,
        capture_output=True, env={**os.environ, **env},
    )
    for _ in range(60):
        try:
            get(f"{ADAPTER}/portal/manifest")
            return
        except Exception:
            time.sleep(1)
    raise SystemExit("the container did not come back")


def standing() -> Path | None:
    """The post of today, if the workspace already has one. It is one per day,
    so it is also the reason this test has to move things around."""
    return next((d for d in sorted(folders()) if d.name.startswith(today() + "-")), None)


def money(amount) -> str:
    """genai-prices' estimate, or a dash when it could not price the model."""
    return f"US${amount:.5f}" if amount is not None else "US$—"


def report_of(session_id: str) -> str:
    """What the creator handed back, out of the `delegation.finished` event."""
    rows = events_of(session_id, "delegation.finished")
    return payload_of(rows[-1]).get("output", "") if rows else ""


def history_of(session_id: str) -> list[dict]:
    """The engine history the session was persisted with."""
    rows = sql("SELECT messages FROM history WHERE session_id = ?", session_id)
    return json.loads(rows[0]["messages"]) if rows else []


def returns_of(session_id: str, tool: str) -> list[str]:
    """What each call to that tool returned, as the history kept it."""
    out = []
    for message in history_of(session_id):
        for part in message.get("parts", []):
            if part.get("part_kind") == "tool-return" and part.get("tool_name") == tool:
                out.append(json.dumps(part, ensure_ascii=False))
    return out


def main() -> int:
    print(f"adapter  : {ADAPTER}")
    print(f"posteos  : {POSTS}")
    if not BRAND.is_file():
        print(f"There is no {BRAND}: the creator reads the brand before writing.")
        return 1
    manifest = get(f"{ADAPTER}/portal/manifest")
    if not manifest["modules"].get("posts"):
        print("This agent does not run the social plugin: there is no delegate to test.")
        return 1

    failures: list[str] = []
    started = time.time()
    before_usd = key_usage()
    keep = Path(tempfile.mkdtemp(prefix="delegation-"))
    real = standing()
    if real:
        shutil.move(str(real), str(keep / real.name))
        print(f"  today's post moved aside: {real.name} (it goes back at the end)")

    try:
        # ── the control turn, for S3 ────────────────────────────────────────
        print(f"\ncliente: {PLAIN_ASK}")
        plain_tools, plain_answer = conversation(PLAIN_ASK)
        plain_session = latest_session()
        plain_usage = payload_of(events_of(plain_session, "turn_usage")[-1])
        print(f"agente : {' '.join(plain_answer.split())[:200]}")
        print(f"tools  : {', '.join(plain_tools) or '(none)'}"
              f" · {plain_usage['input_tokens']} in / {plain_usage['output_tokens']} out"
              f" · delegations: {plain_usage['delegations']}")

        # ── S1 ──────────────────────────────────────────────────────────────
        print(f"\n== S1 ==\ncliente: {ASK}")
        before = folders()
        turn = time.time()
        tools, answer = conversation(ASK)
        session_id = latest_session()
        print(f"agente : {' '.join(answer.split())[:600]}")
        print(f"{int(time.time() - turn)} s · tools: {', '.join(tools) or '(none)'}")
        print(f"creador: {' '.join(report_of(session_id).split())[:600]}")
        fresh = sorted(folders() - before)

        failures += judge(
            "S1.a the face delegated",
            [] if TOOL in tools else [f"no {TOOL} in the trail: {tools}"],
        )
        did_itself = [t for t in CREATORS_OWN if t in tools]
        failures += judge(
            "S1.b and did not do it itself",
            [f"the face called {did_itself}"] if did_itself else [],
        )
        problems = []
        if not fresh:
            problems.append(f"no new folder under {POSTS}")
        else:
            for name in ("post.json", "caption.md"):
                if not (fresh[0] / name).is_file():
                    problems.append(f"no {name} in {fresh[0].name}")
            if not list(fresh[0].glob("01.*")):
                problems.append(f"no 01.* in {fresh[0].name}")
        failures += judge("S1.c the post is there", problems)

        listing = get(f"{ADAPTER}/portal/posts")
        chat_post = listing["posts"][0] if listing.get("posts") else None
        failures += judge(
            "S1.d the tab lists it",
            [] if chat_post and (chat_post.get("images") or [{}])[0].get("url")
            else ["the listing has no post with an image"],
        )
        failures += judge(
            "S1.e the answer names Posteos",
            [] if "posteos" in plain(answer) else ["the answer does not name Posteos"],
        )
        # The creator saved the post inside the FACE's session, which is what
        # `SubAgents` forwarding the parent's deps means from outside.
        failures += judge(
            "S1.f the creator ran on the face's session",
            [] if events_of(session_id, "post.saved") else
            ["no post.saved event on the conversation's session"],
        )
        # THE TOOL RETURN IS THE REPORT AND NOTHING ELSE. The harness appends
        # the notebook to the last model request of every round trip, and on a
        # delegated turn that request IS the tool return: the face read the
        # whole notebook in front of the creator's report and answered the
        # notebook. It is in the instructions now (`memory/core/injection.py`),
        # so no message of this conversation carries a block.
        returns = returns_of(session_id, TOOL)
        stray = [
            json.dumps(part, ensure_ascii=False)[:120]
            for message in history_of(session_id)
            for part in message.get("parts", [])
            if MEMORY_BLOCK in json.dumps(part, ensure_ascii=False)
        ]
        failures += judge(
            "S1.g and the tool return is the report and nothing else",
            [f"no {TOOL} tool return in the persisted history"] if not returns else
            [f"{MEMORY_BLOCK} inside a message part: {s}" for s in stray],
        )

        # ── S3, on S1's turn ────────────────────────────────────────────────
        print("\n== S3 ==")
        for row in events_of(session_id):
            if row["kind"].startswith("delegation."):
                print(f"  {row['kind']:<22} {row['status']:<10} {row['label']}")
        usage = payload_of(events_of(session_id, "turn_usage")[-1])
        print(f"  turn_usage             {usage['input_tokens']} in /"
              f" {usage['output_tokens']} out · delegations: {usage['delegations']}"
              f" · {money(usage['cost_usd'])}")
        print(f"  a turn that delegated nothing: {plain_usage['input_tokens']} in /"
              f" {plain_usage['output_tokens']} out · {money(plain_usage['cost_usd'])}")

        started_rows = events_of(session_id, "delegation.started")
        failures += judge(
            "S3.a Activity says what it asked for",
            [] if started_rows and started_rows[0]["label"].startswith(
                "Le pedí al creador de posteos: ")
            else [f"no delegation.started: {[r['kind'] for r in events_of(session_id)]}"],
        )
        finished = events_of(session_id, "delegation.finished")
        failures += judge(
            "S3.b and how it went",
            [] if finished and re.match(r"^El creador de posteos terminó en \d+ s$",
                                        finished[-1]["label"])
            else [f"no delegation.finished: {[r['label'] for r in finished]}"],
        )
        failures += judge(
            "S3.c the turn's usage counts the delegation",
            [] if usage["delegations"] >= 1 else ["turn_usage says delegations: 0"],
        )
        failures += judge(
            "S3.d and carries the creator's tokens",
            [] if usage["output_tokens"] > plain_usage["output_tokens"]
            else [f"{usage['output_tokens']} output tokens against"
                  f" {plain_usage['output_tokens']} without delegating"],
        )

        # ── S2 ──────────────────────────────────────────────────────────────
        print("\n== S2 ==")
        # S1's post goes out: it is one per day, and the flow has to be able to
        # save one of its own — which is what puts a flow's slug on a post.
        s1_post = standing()
        if s1_post:
            shutil.rmtree(s1_post)
            print(f"  removed S1's post so the flow can save its own: {s1_post.name}")
        FLOW_DIR.mkdir(parents=True, exist_ok=True)
        (FLOW_DIR / "FLOW.md").write_text(FLOW_MD)
        time.sleep(1)
        before = folders()
        print(f"run-now: {post(f'{ENDPOINT}/api/jobs/{JOB}/run')['job']['id']}")
        row: dict = {}
        for _ in range(120):
            rows = sql("SELECT * FROM flow_runs WHERE slug = ? ORDER BY scheduled_at", SLUG)
            row = rows[-1] if rows else {}
            if row and row["status"] != "running":
                break
            time.sleep(5)
        flow_session = row.get("session_id", "")
        flow_fresh = sorted(folders() - before)
        print(f"  row: {row.get('status')} · session {flow_session}")
        print(f"creador: {' '.join(report_of(flow_session).split())[:400]}")

        failures += judge(
            "S2.a the run finished ok",
            [] if row.get("status") == "ok" else [f"the row reads {row.get('status')!r}"],
        )
        failures += judge(
            "S2.b the delegation is in the flow's session",
            [] if events_of(flow_session, "delegation.started")
            else ["no delegation.started on the run's session"],
        )
        problems = []
        if not flow_fresh:
            problems.append("the run saved no post")
        else:
            saved = json.loads((flow_fresh[0] / "post.json").read_text())
            print(f"  post: {saved['id']} · flow: {saved['flow']!r}")
            if saved["flow"] != SLUG:
                problems.append(f"post.json says flow {saved['flow']!r} and not {SLUG!r}")
        failures += judge("S2.c and the post knows which flow made it", problems)

        # ── S4, the refused prompt ──────────────────────────────────────────
        print(f"\n== S4 ==\ncliente: {REFUSED}")
        turn = time.time()
        tools, answer = conversation(REFUSED)
        refused_session = latest_session()
        print(f"agente : {' '.join(answer.split())[:600]}")
        print(f"{int(time.time() - turn)} s · tools: {', '.join(tools) or '(none)'}")
        print(f"creador: {' '.join(report_of(refused_session).split())[:600]}")
        failures += judge(
            "S4.a the refusal came back as an answer",
            [] if not plain(answer).startswith(plain(BROKE)) and answer.strip()
            else ["the turn ended in the engine's failure line"],
        )
        failures += judge(
            "S4.b and the delegation is written down",
            [] if events_of(refused_session, "delegation.finished")
            else ["no delegation.finished on that session"],
        )

        # ── S4, the timeout ─────────────────────────────────────────────────
        print(f"\n  the same ask with CORE_DELEGATION_TIMEOUT={SHORT_TIMEOUT}")
        compose(CORE_DELEGATION_TIMEOUT=SHORT_TIMEOUT)
        turn = time.time()
        tools, answer = conversation(TIMEOUT_ASK)
        cut_session = latest_session()
        print(f"agente : {' '.join(answer.split())[:400]}")
        print(f"{int(time.time() - turn)} s · tools: {', '.join(tools) or '(none)'}")
        cut = events_of(cut_session, "delegation.finished")
        for event in cut:
            print(f"  {event['status']:<10} {event['label']}")
        failures += judge(
            "S4.c the timeout is an outcome and not a crash",
            [] if any(payload_of(e).get("outcome") == "timeout" for e in cut)
            else [f"no timeout outcome: {[payload_of(e).get('outcome') for e in cut]}"],
        )
        failures += judge(
            "S4.d and the client still got an answer",
            [] if answer.strip() and not plain(answer).startswith(plain(BROKE))
            else ["the turn ended in the engine's failure line"],
        )
        compose()

    finally:
        # THE WORKSPACE GOES BACK THE WAY IT WAS. Everything this run wrote —
        # the flow, its rows, its conversations and both posts — is the test's,
        # and the post that was there before it is the client's.
        print("\n-- cleanup")
        # Every post of today is this run's: the one that was there before it
        # is in `keep`, and it goes back after these are gone.
        for directory in sorted(folders()):
            if directory.name.startswith(today() + "-"):
                shutil.rmtree(directory)
                print(f"  removed the post this run made: {directory.name}")
        for kept in sorted(keep.glob("*")):
            shutil.move(str(kept), str(POSTS / kept.name))
            print(f"  back in place: {kept.name}")
        shutil.rmtree(keep, ignore_errors=True)
        if FLOW_DIR.exists():
            shutil.rmtree(FLOW_DIR)
        rows = sql("SELECT session_id FROM flow_runs WHERE slug = ?", SLUG)
        write_sql("DELETE FROM flow_runs WHERE slug = ?", SLUG)
        for run in rows:
            for table, column in (("messages", "session_id"), ("history", "session_id"),
                                  ("sessions", "id")):
                write_sql(f"DELETE FROM {table} WHERE {column} = ?", run["session_id"])
        print(f"  took out the flow, {len(rows)} run(s) and their conversations")

    print(f"\n{int(time.time() - started)} s · OpenRouter key delta:"
          f" US${key_usage() - before_usd:.4f}")
    print("DELEGATION: PASS" if not failures else "DELEGATION: FAIL")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
