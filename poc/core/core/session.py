"""One user turn on one session: replay the history, stream the run, persist.

The stream this yields is the POC's OWN event vocabulary; `server/sse.py`
translates it into the portal's two dialects. Nothing above this module knows
what Pydantic AI calls its events.
"""

import secrets
import time
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass

from pydantic_ai import AgentRunResultEvent
from pydantic_ai.messages import (
    FunctionToolCallEvent,
    ModelMessagesTypeAdapter,
    PartDeltaEvent,
    PartStartEvent,
    TextPart,
    TextPartDelta,
)

from . import config, db
from .agent import Deps, get_agent

# EXTENSION POINT — transforms applied to the agent's text BEFORE it is
# persisted and before the client is told the message closed. Each hook is
# `(session_id, text) -> text`; they run in order. Wave 3 registers the
# promises check here, which is the whole point of the seam: the engine
# persists what the hook returned, not what the model said.
BEFORE_PERSIST: list[Callable[[str, str], str]] = []


@dataclass
class TextDelta:
    text: str


@dataclass
class ToolStarted:
    name: str


@dataclass
class MessageCompleted:
    content: str


@dataclass
class RunCompleted:
    messages: list[dict]


Event = TextDelta | ToolStarted | MessageCompleted | RunCompleted


def first_line(text: str) -> str:
    """The first non-empty line, for a label. Empty text gives an empty label."""
    return next((line for line in text.strip().splitlines() if line.strip()), "")[:120]


def new_session_id() -> str:
    return f"api_{int(time.time())}_{secrets.token_hex(4)}"


def display_messages(session_id: str) -> list[dict]:
    return [{"role": r["role"], "content": r["content"]} for r in db.messages(session_id)]


def match_session(prior: list[dict]) -> str | None:
    """The session whose displayed messages are exactly `prior`, if any.

    This is what keeps the OpenAI-shaped endpoint — which carries the whole
    local history and no session id — from opening one session per message.
    """
    if not prior:
        return None
    want = [(m["role"], (m["content"] or "").strip()) for m in prior]
    for row in db.sessions():
        have = [(m["role"], m["content"].strip()) for m in display_messages(row["id"])]
        if have == want:
            return row["id"]
    return None


def ensure_session(session_id: str | None = None) -> str:
    if session_id is None:
        session_id = new_session_id()
        db.create_session(session_id)
    return session_id


async def run_turn(session_id: str, message: str) -> AsyncIterator[Event]:
    agent = get_agent()
    history = db.load_history(session_id)
    replay = ModelMessagesTypeAdapter.validate_json(history) if history else None

    db.add_message(session_id, "user", message)
    db.touch_session(session_id, preview=message.strip()[:200])

    chunks: list[str] = []
    async with agent.run_stream_events(
        message,
        message_history=replay,
        deps=Deps(workspace=config.WORKSPACE, session_id=session_id),
    ) as events:
        async for event in events:
            if isinstance(event, PartStartEvent) and isinstance(event.part, TextPart):
                # A run can answer in several text parts (one before a tool
                # call, one after); they are one message to the client, so the
                # separator travels in the stream too and the accumulated text
                # matches what gets persisted.
                piece = ("\n\n" if chunks else "") + event.part.content
                if piece.strip():
                    chunks.append(piece)
                    yield TextDelta(piece)
            elif isinstance(event, PartDeltaEvent) and isinstance(event.delta, TextPartDelta):
                chunks.append(event.delta.content_delta)
                yield TextDelta(event.delta.content_delta)
            elif isinstance(event, FunctionToolCallEvent):
                yield ToolStarted(event.part.tool_name)
            elif isinstance(event, AgentRunResultEvent):
                final = "".join(chunks)
                for hook in BEFORE_PERSIST:
                    final = hook(session_id, final)
                db.add_message(session_id, "assistant", final)
                db.save_history(
                    session_id, ModelMessagesTypeAdapter.dump_json(event.result.all_messages())
                )
                db.touch_session(session_id)
                db.append_event("respuesta", first_line(final), "completed", session_id)
                yield MessageCompleted(final)
                yield RunCompleted(display_messages(session_id))
