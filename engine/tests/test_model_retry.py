#!/usr/bin/env python3
"""The engine's model retries once on a provider body pydantic-ai cannot read.

`python3 engine/tests/test_model_retry.py` copies itself into the lab container
(`CORE_CONTAINER`, default tuagente-core) and runs there, where pydantic-ai is.
"""
import asyncio
import os
import subprocess
import sys

if not os.path.exists("/app/core"):
    container = os.environ.get("CORE_CONTAINER", "tuagente-core")
    subprocess.run(["docker", "cp", __file__, f"{container}:/tmp/test_model_retry.py"], check=True)
    raise SystemExit(subprocess.run(
        ["docker", "exec", "-w", "/app", container, "python3", "/tmp/test_model_retry.py"]
    ).returncode)

from pydantic import BaseModel, ValidationError
from pydantic_ai import Agent
from pydantic_ai.exceptions import ModelAPIError
from pydantic_ai.messages import ModelResponse, TextPart
from pydantic_ai.models.fallback import FallbackModel
from pydantic_ai.models.function import AgentInfo, FunctionModel

from core import agent as engine_agent


class Envelope(BaseModel):
    error: dict


calls = {"n": 0}


def flaky(messages, info: AgentInfo) -> ModelResponse:
    calls["n"] += 1
    if calls["n"] == 1:
        Envelope.model_validate({"error": None})  # the malformed OpenRouter body
    return ModelResponse(parts=[TextPart("hola")])


async def main() -> int:
    built = engine_agent.model()
    assert isinstance(built, FallbackModel) and len(built.models) == 2, "two tries of the same model"
    flaky_model = FunctionModel(flaky)
    retrying = FallbackModel(flaky_model, flaky_model, fallback_on=(ModelAPIError, ValidationError))
    result = await Agent(retrying).run("hola")
    assert result.output == "hola" and calls["n"] == 2, (result.output, calls)
    print("MODEL RETRY: PASS · the first body was unreadable, the second answered")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
