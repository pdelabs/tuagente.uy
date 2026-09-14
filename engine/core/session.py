"""One user turn on one session: replay the history, stream the run, persist.

The stream this yields is the engine's OWN event vocabulary; `server/sse.py`
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

from . import config, db
from .agent import Deps, get_agent

# EXTENSION POINT — transforms applied to the agent's text BEFORE it is
# persisted and before the client is told the message closed. Each hook is
# `(session_id, text) -> text`; they run in order. The `flow` plugin registers
# the promises check here through `engine.before_persist`, which is the whole
# point of the seam: the engine persists what the hook returned, not what the
# model said.
BEFORE_PERSIST: list[Callable[[str, str], str]] = []

# EXTENSION POINT — what happens to a run that ended at a gated tool, set by
# ONE plugin through `engine.deferred`. The engine knows a run can stop and
# nothing else: where the pause is written down, what the client reads and how
# it is resumed are the gating plugin's, and today that is `approval`.
#
# NO HANDLER AND A RUN STOPS ANYWAY = a toolset somebody gated with nobody to
# answer for it. That raises, which is the loud break we want: the alternative
# is a turn that swallows the request and a client who never sees it.
DEFERRED_HANDLER: Callable[[str, DeferredToolRequests, str], str] | None = None

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
class Paused:
    """The turn stopped at a gated tool and is waiting for the client.

    It travels next to the `MessageCompleted` carrying the same line, and not
    instead of it: both dialects close a turn on `MessageCompleted` and neither
    has anything to say about a pause. Who reads this is whoever started the
    turn — the scheduler, which cannot record a run as finished when what
    happened is that it stopped halfway.
    """

    content: str


@dataclass
class RunCompleted:
    messages: list[dict]


@dataclass
class Failed:
    """The turn that did not answer. It is the last event either dialect sees."""

    content: str


Event = TextDelta | ToolStarted | MessageCompleted | Paused | RunCompleted | Failed


def first_line(text: str) -> str:
    """The first non-empty line, for a label. Empty text gives an empty label."""
    return next((line for line in text.strip().splitlines() if line.strip()), "")[:120]


def failure_message(reason: str) -> str:
    """What the chat says when the turn broke. The stack is the log's; hers is
    this sentence and the one line that says what failed. A turn that breaks is
    the engine's business, so the sentence lives here."""
    return f"No pude responder: {reason}"


def one_line(exc: BaseException) -> str:
    """Why the turn broke, in one line. The class name only when there is no
    message to read, which is the one case where it is the whole reason."""
    reason = " ".join(str(exc).split())[:300]
    return reason or type(exc).__name__


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


def history_of(session_id: str) -> list:
    """The session's engine history as messages, empty when it has none yet."""
    blob = db.load_history(session_id)
    return ModelMessagesTypeAdapter.validate_json(blob) if blob else []


def ensure_session(session_id: str | None = None) -> str:
    if session_id is None:
        session_id = new_session_id()
        db.create_session(session_id)
    return session_id


async def run_turn(session_id: str, message: str) -> AsyncIterator[Event]:
    history = db.load_history(session_id)
    replay = ModelMessagesTypeAdapter.validate_json(history) if history else None

    db.add_message(session_id, "user", message)
    db.touch_session(session_id, preview=message.strip()[:200])

    try:
        async for event in stream_run(session_id, message, replay):
            yield event
    except Exception as exc:
        # A turn that breaks used to end in silence: the client's message sat
        # there with no answer under it and nothing in Activity said why. Now
        # she reads one line, the log keeps the stack, and the event is in
        # Activity next to every other thing that happened.
        failed = failure_message(one_line(exc))
        db.add_message(session_id, "assistant", failed)
        db.touch_session(session_id)
        db.append_event("error", failed, "error", session_id)
        yield Failed(failed)
        raise


async def stream_run(
    session_id: str, message: str, replay: list | None
) -> AsyncIterator[Event]:
    """The turn itself. It is its own function so that the failure path around
    it in `run_turn` is one `try`, and not a wrapper around every yield."""
    agent = get_agent()
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
                # The gate stopped the run, and what a stopped run becomes is
                # the gating plugin's business: it gets the requests and the
                # run's messages — NOT the session, whose history would end in
                # an unanswered tool call and stop being replayable — and
                # returns the one line the client reads.
                if DEFERRED_HANDLER is None:
                    raise RuntimeError(
                        "a run ended at a gated tool and no plugin claimed it with "
                        "engine.deferred(): there is nothing to write the request down"
                    )
                paused = DEFERRED_HANDLER(
                    session_id,
                    event.result.output,
                    ModelMessagesTypeAdapter.dump_json(event.result.all_messages()).decode(),
                )
                db.add_message(session_id, "assistant", paused)
                db.touch_session(session_id)
                # The pause message is NOT streamed as a delta: it is the whole
                # persisted message, and both dialects close a turn on
                # `MessageCompleted`. Streaming it too would send it twice.
                yield MessageCompleted(paused)
                yield Paused(paused)
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
    it over SSE is out of scope for the engine, on purpose.
    """
    result = await get_agent().run(
        message_history=history,
        deferred_tool_results=results,
        output_type=OUTPUT,
        deps=Deps(workspace=config.WORKSPACE, session_id=session_id),
    )
    branch = result.all_messages()
    blob = ModelMessagesTypeAdapter.dump_json(branch).decode()
    if isinstance(result.output, DeferredToolRequests):
        return Resumed("", result.output, blob)

    text = result.output
    for hook in BEFORE_PERSIST:
        text = hook(session_id, text)
    db.add_message(session_id, "assistant", text)
    # The branch is APPENDED to the session's history, never written over it.
    # An approval can sit in the queue for a day, and the client keeps talking
    # to the agent meanwhile: overwriting the session with the branch — which
    # was forked back when the run paused — dropped every turn taken while she
    # was deciding. What gets appended starts at the pause point: the
    # ModelResponse carrying the tool call, the ModelRequest carrying its
    # result, and whatever the run said after. The provider reads that as a
    # call answered immediately, which is what it is.
    db.save_history(
        session_id,
        ModelMessagesTypeAdapter.dump_json(history_of(session_id) + branch[len(history) - 1:]),
    )
    db.touch_session(session_id)
    db.append_event("respuesta", first_line(text), "completed", session_id)
    # A run of a flow that had stopped at the gate ends HERE and not in the
    # scheduler: the loop that started it walked away the moment it paused. The
    # import is local because the scheduler is the one that imports this module.
    from . import scheduler

    scheduler.resumed(session_id)
    return Resumed(text, None, blob)
