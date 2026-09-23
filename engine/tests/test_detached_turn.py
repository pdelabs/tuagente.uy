#!/usr/bin/env python3
"""A chat turn outlives the connection that started it. `python3 engine/tests/test_detached_turn.py`.

`core/session.py`'s `start_turn`, called DIRECTLY INSIDE THE CONTAINER with a
`FunctionModel` in place of the provider: no model, a few seconds.

WHY. On the QA agent (2026-09-23) the client asked for a post, the face
delegated it, and while the creator worked she went to look at Flujos. The
portal aborts the stream when the chat unmounts, the turn was the response's
body, and it died at the next frame it tried to send: the post landed in
Posteos, the face's closing message never existed, and her conversation showed
her request with nothing under it and nothing saying it was being worked.

  a. THE ANSWER IS PERSISTED WITH NOBODY READING — the consumer reads the
     first event and walks away (`aclose`, what a dropped response does to
     its body), and the answer is in the conversation anyway.
  b. THE CONVERSATION SAYS IT IS BEING WORKED while the turn runs, and stops
     saying it when the turn ends — `running(session_id)`, which is what
     `GET /api/sessions/{id}/messages` serves as `running`.
  c. A TURN THAT IS CANCELLED SAYS SO — the process going down under a turn
     leaves the client a line, not the old silence.

WHERE IT POINTS. `CORE_CONTAINER` moves it onto a second instance; the default
is the main compose's `tuagente-core`.
"""

import json
import os
import subprocess
import sys

CONTAINER = os.environ.get("CORE_CONTAINER", "tuagente-core")

INSIDE = r"""
import asyncio, json
from pydantic_ai.models.function import FunctionModel

from core import db, session
from core.agent import get_agent

ANSWER = "Listo, quedó guardado."


async def slow(messages, info):
    await asyncio.sleep(2)
    yield ANSWER


async def hanging(messages, info):
    await asyncio.sleep(60)
    yield "nunca"


async def main():
    out = {}
    agent = get_agent()
    with agent.override(model=FunctionModel(stream_function=slow)):
        sid = session.ensure_session()
        events = session.start_turn(sid, "hola")
        await events.__anext__()
        await events.aclose()
        out["running_while"] = session.running(sid)
        for _ in range(100):
            if not session.running(sid):
                break
            await asyncio.sleep(0.1)
        out["running_after"] = session.running(sid)
        out["messages"] = session.display_messages(sid)
        db.delete_session(sid)

    with agent.override(model=FunctionModel(stream_function=hanging)):
        sid = session.ensure_session()
        events = session.start_turn(sid, "hola")
        await asyncio.sleep(0.5)
        session._turns[sid].cancel()
        async for _ in events:
            pass
        out["cancelled"] = session.display_messages(sid)
        db.delete_session(sid)
    out["cut"] = session.CUT
    out["answer"] = ANSWER
    print(json.dumps(out, ensure_ascii=False))


asyncio.run(main())
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
        print(done.stderr.strip()[-1500:])
        print("DETACHED TURN: FAIL")
        return 1
    r = json.loads(done.stdout.strip().splitlines()[-1])
    failures = []

    last = r["messages"][-1] if r["messages"] else {}
    problems = [] if last == {"role": "assistant", "content": r["answer"]} else [
        f"the conversation ends in {r['messages']}"]
    failures += judge("a. the answer is persisted with nobody reading", problems)

    problems = []
    if not r["running_while"]:
        problems.append("it did not say it was working while the turn ran")
    if r["running_after"]:
        problems.append("it still says it is working after the turn ended")
    failures += judge("b. the conversation says it is being worked", problems)

    last = r["cancelled"][-1] if r["cancelled"] else {}
    problems = [] if last == {"role": "assistant", "content": r["cut"]} else [
        f"a cancelled turn ends in {r['cancelled']}"]
    failures += judge("c. a cancelled turn says so", problems)

    print("DETACHED TURN: " + ("PASS" if not failures else "FAIL"))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
