"""The portal's two SSE dialects, byte for byte as `app/app/lib/agent.ts`
parses them.

They are NOT the same protocol: the OpenAI one (a new conversation) sends
unnamed `data:` frames with the OpenAI delta shape and names the tool event
`hermes.tool.progress` with a `tool` key; the session one (a resumed
conversation) names every event and carries `tool_name`. Both close their
frames with a blank line, which is what resets the event name on the parser's
side — an event left hanging swallows every text frame after it.
"""

import json
from collections.abc import AsyncIterator

from core.session import Event, MessageCompleted, RunCompleted, TextDelta, ToolStarted

HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}


def frame(name: str | None, data: dict) -> str:
    line = f"event: {name}\n" if name else ""
    return line + f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


def reconcile(streamed: str, persisted: str) -> str:
    """The one delta that leaves the browser's bubble ending in `persisted`.

    This dialect has no authoritative "here is the message" event — the
    portal's `chatStream` only accumulates deltas — so whatever the engine
    changed on the message's way to disk has to travel as one more delta.
    Two cases: the persisted text EXTENDS what was streamed (the promises
    check appends its correction) and only the tail is missing; or it does not
    (a pause replaces the model's preamble with the message the code writes)
    and it travels whole, after a blank line so it reads as its own paragraph.
    """
    if persisted == streamed:
        return ""
    if persisted.startswith(streamed):
        return persisted[len(streamed):]
    return "\n\n" + persisted


async def openai_dialect(events: AsyncIterator[Event]) -> AsyncIterator[str]:
    streamed = ""
    async for event in events:
        if isinstance(event, TextDelta):
            streamed += event.text
            yield frame(None, {"choices": [{"delta": {"content": event.text}}]})
        elif isinstance(event, ToolStarted):
            yield frame("hermes.tool.progress", {"tool": event.name, "status": "started"})
        elif isinstance(event, MessageCompleted):
            tail = reconcile(streamed, event.content)
            if tail:
                streamed += tail
                yield frame(None, {"choices": [{"delta": {"content": tail}}]})
    yield "data: [DONE]\n\n"


async def session_dialect(events: AsyncIterator[Event], session_id: str) -> AsyncIterator[str]:
    yield frame("run.started", {"session_id": session_id})
    opened = False
    async for event in events:
        if isinstance(event, TextDelta):
            if not opened:
                yield frame("message.started", {})
                opened = True
            yield frame("assistant.delta", {"delta": event.text})
        elif isinstance(event, ToolStarted):
            yield frame("tool.started", {"tool_name": event.name})
        elif isinstance(event, MessageCompleted):
            if not opened:
                yield frame("message.started", {})
                opened = True
            yield frame("assistant.completed", {"content": event.content})
        elif isinstance(event, RunCompleted):
            yield frame("run.completed", {"messages": event.messages})
    yield frame("done", {})
