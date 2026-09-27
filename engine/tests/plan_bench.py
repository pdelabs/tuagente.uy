#!/usr/bin/env python3
"""The creator's PLAN, without a single image. `python3 engine/tests/plan_bench.py MODEL [MODEL...]`.

A bench, not a test: it builds the post creator with the instructions it has in
production — who the client is, `creator.md`, the post procedure, the business,
today's look and structure, the clock — gives it only the tools that READ (the
workspace and the account's numbers), and asks it for the plan of a post and
nothing else: the ideas it weighed, the one it chose and why, the script slide
by slide and the caption. Its reasoning (the thinking parts the provider
returns) is kept next to the answer, so how it arrives at an idea can be read.

Run against OUR OWN agent's container by default (`tuagente-tuagente`), read
only: no image, no `save_post`, no file written in the workspace. Every model id
is an OpenRouter one (`openai/gpt-6-luna`, `anthropic/claude-sonnet-5`, …); each
run lands in `engine/tests/plans/<timestamp>-<model>.md`.

WHY (2026-09-27, Luis): three rounds of rules on the creator and the posts kept
being about the product. The plan is where the idea is decided, and it costs
cents; the images cost dollars and come after.
"""

import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

CONTAINER = os.environ.get("CORE_CONTAINER", "tuagente-tuagente")
OUT = Path(__file__).parent / "plans"

REQUEST = os.environ.get(
    "PLAN_REQUEST", "Hacé un posteo nuevo para Instagram, con un tema distinto a los de los últimos días.")

INSIDE = r"""
import asyncio, json, sys, uuid
from pathlib import Path
for plugin in ("social", "instagram", "kanban", "image"):
    sys.path.insert(0, f"/opt/kit/plugins/{plugin}/core")

from pydantic_ai import Agent
from pydantic_ai.messages import ThinkingPart, TextPart, ToolCallPart
from core import agent as core_agent, config
import creator, looks, posts, ig_tools

model, request = sys.argv[1], sys.argv[2]

REHEARSAL = '''## Esta vez es un ensayo: NO generes imágenes ni guardes nada

No llames a `generate_image`, `place_image` ni `save_post`: no los tenés. Hacé
los pasos 1, 2 y 3 del procedimiento —leé lo que haga falta, elegí la idea,
armá la historia— y devolvé en texto, en este orden:

1. **Las ideas que consideraste**, de 3 a 5, una línea cada una, y por qué
   elegiste la que elegiste y descartaste las otras.
2. **La estructura y el objetivo.**
3. **El guion**: una línea por lámina, con su oración exacta entre « » y qué
   muestra la imagen.
4. **El pie**, completo, tal como saldría.
5. **La prueba del hilo**: los ocho puntos, uno por línea, con por qué pasa.'''

hands = [core_agent.tools("read_file", "list_files")]
hands.append(ig_tools.performance())
bench = Agent(
    "openrouter:" + model,
    deps_type=core_agent.Deps,
    name="plan-bench",
    instructions=[core_agent.IDENTITY, creator.PROSE.read_text(), creator.procedure(),
                  creator.business, creator.todays_look, core_agent.today, REHEARSAL],
    toolsets=hands,
    model_settings={"max_tokens": 16000},
)

async def main():
    deps = core_agent.Deps(workspace=config.WORKSPACE, session_id="plan-bench-" + uuid.uuid4().hex[:6])
    result = await bench.run(request, deps=deps)
    steps = []
    for message in result.all_messages():
        for part in getattr(message, "parts", []):
            if isinstance(part, ThinkingPart) and part.content.strip():
                steps.append({"kind": "thinking", "text": part.content})
            elif isinstance(part, ToolCallPart):
                steps.append({"kind": "tool", "text": f"{part.tool_name}({json.dumps(part.args_as_dict(), ensure_ascii=False)[:200]})"})
    usage = result.usage() if callable(result.usage) else result.usage
    print(json.dumps({"steps": steps, "answer": result.output,
                      "tokens": [usage.input_tokens, usage.output_tokens]}, ensure_ascii=False))

asyncio.run(main())
"""


def run(model: str) -> Path:
    started = time.time()
    done = subprocess.run(["docker", "exec", CONTAINER, "python3", "-c", INSIDE, model, REQUEST],
                          capture_output=True, text=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    OUT.mkdir(exist_ok=True)
    path = OUT / f"{stamp}-{re.sub(r'[^a-z0-9.-]+', '-', model.lower())}.md"
    if done.returncode != 0:
        path.write_text(f"# {model} — FAILED\n\n```\n{done.stderr[-4000:]}\n```\n")
        return path
    r = json.loads(done.stdout.strip().splitlines()[-1])
    lines = [f"# {model}", "",
             f"{time.time() - started:.0f} s · {r['tokens'][0]} tokens in, {r['tokens'][1]} out", "",
             "## Razonamiento", ""]
    for step in r["steps"]:
        lines += ([f"- **{step['text']}**"] if step["kind"] == "tool"
                  else [f"> {line}" for line in step["text"].splitlines()] + [""])
    lines += ["", "## Plan", "", r["answer"]]
    path.write_text("\n".join(lines) + "\n")
    return path


if __name__ == "__main__":
    for model in sys.argv[1:] or ["openai/gpt-6-luna"]:
        print(run(model))
