"""One user turn on one session: replay the history, stream the run, persist.

The stream this yields is the POC's OWN event vocabulary; `server/sse.py`
translates it into the portal's two dialects. Nothing above this module knows
what Pydantic AI calls its events.
"""

import secrets
import time
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass

from pydantic_ai import AgentRunResultEvent, DeferredToolRequests, DeferredToolResults
from pydantic_ai.messages import (
    FunctionToolCallEvent,
    ModelMessagesTypeAdapter,
    PartDeltaEvent,
    PartStartEvent,
    TextPart,
    TextPartDelta,
)

from . import approvals, config, db, render
from .agent import Deps, get_agent

# EXTENSION POINT — transforms applied to the agent's text BEFORE it is
# persisted and before the client is told the message closed. Each hook is
# `(session_id, text) -> text`; they run in order. Wave 3 registers the
# promises check here, which is the whole point of the seam: the engine
# persists what the hook returned, not what the model said.
BEFORE_PERSIST: list[Callable[[str, str], str]] = []

# A turn ends in the answer, or in the engine stopping at a gated tool.
# Declaring the second one as an output type is what turns the gate into a
# value the code can hold: the run returns the pending calls instead of
# raising, and the next run takes the client's answer as an argument.
OUTPUT = [str, DeferredToolRequests]


@dataclass
class Resumed:
    """What a resumed run left behind: an answer, or another request."""

    text: str
    requests: DeferredToolRequests | None
    history: str


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
    """The session whose CLIENT turns are exactly the ones in `prior`, if any.

    This is what keeps the OpenAI-shaped endpoint — which carries the whole
    local history and no session id — from opening one session per message.

    ONLY THE USER MESSAGES ARE COMPARED. The assistant's are the engine's to
    transform: the promises check rewrites an answer before it is persisted and
    a pause replaces the model's preamble with the message the code writes, so
    the browser's copy of an answer is not the one on disk. Matching on it
    forked a second session the moment either of those fired, and the client
    watched her conversation split in two.
    """
    want = [(m["content"] or "").strip() for m in prior if m["role"] == "user"]
    if not want:
        return None
    for row in db.sessions():
        have = [m["content"].strip() for m in display_messages(row["id"]) if m["role"] == "user"]
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
        output_type=OUTPUT,
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
            elif isinstance(event, AgentRunResultEvent) and isinstance(
                event.result.output, DeferredToolRequests
            ):
                # The gate stopped the run. The messages go on the approval
                # row and NOT on the session: a history that ends in an
                # unanswered tool call is not replayable by the next turn,
                # and the row is also what makes the pause survive a
                # restart. What the client reads is written by the code —
                # whatever the model said on its way to the tool call is in
                # the request's body, where she decides.
                requests = event.result.output
                call = requests.approvals[0]
                approvals.record_pending(
                    session_id,
                    requests,
                    ModelMessagesTypeAdapter.dump_json(event.result.all_messages()).decode(),
                )
                paused = render.pause_message(
                    render.approval_title(call.tool_name, call.args_as_dict())
                )
                db.add_message(session_id, "assistant", paused)
                db.touch_session(session_id)
                # The pause message is NOT streamed as a delta: it is the whole
                # persisted message, and both dialects close a turn on
                # `MessageCompleted`. Streaming it too would send it twice.
                yield MessageCompleted(paused)
                yield RunCompleted(display_messages(session_id))
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


async def run_resumed(
    session_id: str, history: list, results: DeferredToolResults
) -> Resumed:
    """The rest of a paused turn, with the client's answer in its hands.

    No client message (she already spoke in Approvals) and no stream attached:
    the answer lands in the session and she reads it on the next load. Pushing
    it over SSE is out of scope for the POC, on purpose.
    """
    result = await get_agent().run(
        message_history=history,
        deferred_tool_results=results,
        output_type=OUTPUT,
        deps=Deps(workspace=config.WORKSPACE, session_id=session_id),
    )
    blob = ModelMessagesTypeAdapter.dump_json(result.all_messages()).decode()
    if isinstance(result.output, DeferredToolRequests):
        return Resumed("", result.output, blob)

    text = result.output
    for hook in BEFORE_PERSIST:
        text = hook(session_id, text)
    db.add_message(session_id, "assistant", text)
    # Only now does the session take the history back: with the tool call
    # answered, it is replayable again.
    db.save_history(session_id, blob.encode())
    db.touch_session(session_id)
    db.append_event("respuesta", first_line(text), "completed", session_id)
    return Resumed(text, None, blob)
