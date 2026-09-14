"""One `turn_usage` event per run: what the turn cost, from the engine's side.

`hermes-kit/notes/cost-and-engine-findings.md` §2 is the reason this exists.
There, the engine's own `estimated_cost_usd` matched OpenRouter to the last
decimal on every session, which is what made the polling harness unnecessary.
This is the same number for this engine: Pydantic AI prices each request with
genai-prices and hands it back as `usage.cost`. `tests/cost.py` prints it next
to the provider's own delta so the two can be compared instead of trusted.

A capability rather than a line in `core/session.py`: `after_run` is where the
result and its usage exist, and the seam belongs to whoever wants the number.
"""

from dataclasses import dataclass
from typing import Any

from pydantic_ai.capabilities import AbstractCapability
from pydantic_ai.run import AgentRunResult
from pydantic_ai.tools import RunContext

from . import db
from .agent import CAPABILITIES


@dataclass
class TurnUsage(AbstractCapability):
    async def after_run(
        self, ctx: RunContext, *, result: AgentRunResult[Any]
    ) -> AgentRunResult[Any]:
        usage = result.usage
        db.append_event(
            "turn_usage",
            f"Consumo del turno: {usage.input_tokens} tokens de entrada"
            f" y {usage.output_tokens} de salida",
            "completed",
            ctx.deps.session_id,
            {
                "requests": usage.requests,
                "tool_calls": usage.tool_calls,
                "input_tokens": usage.input_tokens,
                "cache_read_tokens": usage.cache_read_tokens,
                "output_tokens": usage.output_tokens,
                # genai-prices' estimate, or None when it cannot price the
                # model. None is not zero and is not written as zero.
                "cost_usd": float(usage.cost) if usage.cost is not None else None,
            },
        )
        return result


CAPABILITIES.append(TurnUsage())
