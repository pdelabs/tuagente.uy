"""Compaction: one model call replaces the old history with a summary.

Registered as a `ProcessHistory` capability, so it runs on EVERY model request
of the run — including the ones a tool loop makes — and what it returns is what
the model is sent. It is also, and this is the part that mattered, what gets
persisted: `_agent_graph` assigns the processed list back with
`ctx.state.message_history[:] = messages`, so `result.all_messages()` at the
end of the run is the COMPACTED list and `core/session.py` saves it unchanged.
Nothing in session.py had to move. `tests/test_compaction.py` is what proves
it: the persisted row stays bounded across 40 turns.

WHAT IT SUMMARIZES. Everything above the last two complete user turns — but
never twice. A summary a previous compaction left at the head is carried
forward word for word and the model is only ever handed the turns it has not
seen yet; see `SUMMARY_CAP` for the measurement that forced that.

WHEN IT FIRES. Either threshold trips it, and the OR is deliberate:
`ctx.context_window_used` is measured against the model's window, and this
model's window is 1_050_000 tokens (`infer_model(...).context_window`,
checked). 0.6 of that is 630_000 tokens — a fraction that would never be
reached in a client's conversation, so on its own it is a knob that does
nothing. The token estimate (4 characters per token over the serialized
messages) is the one that actually bounds the history here; the fraction stays
because on a small-window model it is the honest measure and it trips first.
"""

from pydantic_ai import Agent, RunContext
from pydantic_ai.capabilities import ProcessHistory, ReinjectSystemPrompt
from pydantic_ai.messages import (
    ModelMessage,
    ModelMessagesTypeAdapter,
    ModelRequest,
    RetryPromptPart,
    TextPart,
    ToolCallPart,
    ToolReturnPart,
    UserPromptPart,
)

from . import config, db
from .agent import CAPABILITIES

# The words are the model's; the format is the code's. Spanish, because what it
# writes travels back into the conversation the client is having.
SUMMARY_INSTRUCTIONS = (
    "Resumí en español la conversación de abajo, preservando hechos, nombres,"
    " números, decisiones y pedidos pendientes"
)
SUMMARY_PREFIX = "Resumen de la conversación hasta acá: "

# How many complete user turns survive verbatim. Two: the one being answered
# and the one before it, so a follow-up ("y eso cuánto era?") still has its
# antecedent in full instead of in a summary.
KEEP_TURNS = 2

CHARS_PER_TOKEN = 4

# How long the running summary is allowed to get before it is summarized
# again. MEASURED, on the first run of `tests/test_compaction.py`: with the
# threshold at 6000 tokens, compaction fires on EVERY turn, and re-summarizing
# the previous summary 39 times in a row is a game of telephone — the fact
# planted at turn 2 ("Ferretería Ríos, entrega los jueves") was still there at
# turn 20 and gone by turn 41, replaced by a list of the files written since.
# So the code carries the previous summary forward WORD FOR WORD and the model
# only ever summarizes what it has not seen. The summary is folded back
# through the model only when it passes this cap, which is once every few
# dozen compactions instead of every one.
SUMMARY_CAP = 4000

_summarizer: Agent | None = None

# The run ids already compacted. A run makes one model request per tool round
# trip and the capability runs on each of them; without this the same history
# would be summarized several times in one turn, each time paying for it.
_compacted: set[str] = set()


def summarizer() -> Agent:
    """The same model, with no tools and no capabilities of its own.

    No capabilities is not an omission: give this agent the compaction
    capability and summarizing a long history calls itself.
    """
    global _summarizer
    if _summarizer is None:
        _summarizer = Agent(
            config.MODEL,
            instructions=SUMMARY_INSTRUCTIONS,
            model_settings=config.MODEL_SETTINGS,
        )
    return _summarizer


def estimated_tokens(messages: list[ModelMessage]) -> int:
    return len(ModelMessagesTypeAdapter.dump_json(messages)) // CHARS_PER_TOKEN


def over_threshold(ctx: RunContext, messages: list[ModelMessage]) -> bool:
    used = ctx.context_window_used
    if used is not None and used > config.COMPACT_AT:
        return True
    return estimated_tokens(messages) > config.COMPACT_AT_TOKENS


def is_user_turn(message: ModelMessage) -> bool:
    """A request the CLIENT opened, not one a tool result closed.

    The tail has to start on one of these: cutting in the middle of a tool
    round trip leaves a call with no return, and the model reads that as a
    question it never answered.
    """
    if not isinstance(message, ModelRequest):
        return False
    parts = message.parts
    return any(isinstance(p, UserPromptPart) for p in parts) and not any(
        isinstance(p, (ToolReturnPart, RetryPromptPart)) for p in parts
    )


def split(messages: list[ModelMessage]) -> tuple[list[ModelMessage], list[ModelMessage]]:
    """(what gets summarized, what is kept word for word)."""
    starts = [i for i, m in enumerate(messages) if is_user_turn(m)]
    if len(starts) <= KEEP_TURNS:
        return [], messages
    cut = starts[-KEEP_TURNS]
    return messages[:cut], messages[cut:]


def carried_summary(messages: list[ModelMessage]) -> str:
    """The summary a previous compaction left at the head, if there is one."""
    first = messages[0]
    if not isinstance(first, ModelRequest):
        return ""
    for part in first.parts:
        # `content` is a str or a sequence of content parts; only a str can be
        # one of ours.
        if isinstance(part, UserPromptPart) and isinstance(part.content, str):
            if part.content.startswith(SUMMARY_PREFIX):
                return part.content[len(SUMMARY_PREFIX):]
    return ""


def transcript(messages: list[ModelMessage]) -> str:
    """The history as a readable conversation, which is what a summary reads.

    Tool calls and their results travel too: half of what the client asked
    about in a working session is a number that came out of a tool.
    """
    lines: list[str] = []
    for message in messages:
        for part in message.parts:
            if isinstance(part, UserPromptPart):
                lines.append(f"Cliente: {part.content}")
            elif isinstance(part, TextPart):
                lines.append(f"Agente: {part.content}")
            elif isinstance(part, ToolCallPart):
                lines.append(f"[herramienta {part.tool_name}] {part.args}")
            elif isinstance(part, ToolReturnPart):
                lines.append(f"[resultado de {part.tool_name}] {part.content}")
    return "\n".join(str(line) for line in lines)


async def compact(ctx: RunContext, messages: list[ModelMessage]) -> list[ModelMessage]:
    if ctx.run_id in _compacted or not over_threshold(ctx, messages):
        return messages
    head, tail = split(messages)
    if not head:
        return messages
    carried = carried_summary(head)
    fresh = head[1:] if carried else head
    if not fresh:
        # Everything above the tail is already the summary: there is nothing
        # left to compact, and calling the model would only reword it.
        return messages

    # Marked BEFORE the summary call, not after: that call is a suspension
    # point and the run can reach this hook again while it is in flight.
    if len(_compacted) > 500:
        _compacted.clear()
    _compacted.add(ctx.run_id)

    if carried and len(carried) <= SUMMARY_CAP:
        # The words are the model's, the format is the code's: what was
        # already summarized is copied, not re-read.
        summary = await summarizer().run(transcript(fresh))
        text = f"{carried} {summary.output}"
    else:
        summary = await summarizer().run(transcript(head))
        text = summary.output
    compacted = [ModelRequest(parts=[UserPromptPart(content=SUMMARY_PREFIX + text)]), *tail]
    # Its own run, so its tokens are not in the turn's `turn_usage`. Imported
    # here and not at the top: importing it registers its capability, and the
    # order `server/app.py` registers them in is compaction first.
    from . import turn_usage

    turn_usage.spend(ctx.deps.session_id, "resumir la conversación", turn_usage.cost(summary))
    db.append_event(
        "compaction",
        f"Resumí la conversación: {len(messages)} mensajes quedaron en {len(compacted)}",
        "completed",
        ctx.deps.session_id,
        {
            "before": len(messages),
            "after": len(compacted),
            "summary_chars": len(text),
            "carried_chars": len(carried),
            "input_tokens": summary.usage.input_tokens,
            "output_tokens": summary.usage.output_tokens,
        },
    )
    return compacted


# `ReinjectSystemPrompt` is here because the plan asks for it and because a
# compaction pipeline is exactly what it is for. On this agent it is a no-op:
# the SOUL travels as `instructions=`, which Pydantic AI rebuilds on every
# request and never stores in the history, so there is no system prompt for a
# summary to drop.
CAPABILITIES.extend([ProcessHistory(compact), ReinjectSystemPrompt()])
