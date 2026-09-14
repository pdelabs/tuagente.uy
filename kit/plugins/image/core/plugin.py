"""Images on the `core` engine: Pydantic AI's capability, our generator under it.

The mechanism is `ImageGeneration(native=False, local=…)`. The capability's job
here is the one thing a bare toolset cannot claim: it is the framework's own
name for "this agent can make pictures", so the day the conversational model
grows native image generation, dropping `native=False` is the whole change.
What it gives the model today is one tool, and what comes back from that tool
is a `BinaryImage`, which Pydantic AI hands to the model as an IMAGE and not as
a filename — the agent sees what it made.

WHY `local` IS OURS. The capability's direct generators
(`ImageGenerator('provider:model')`) dispatch on `openai`, `google` and `xai`
and on nothing else. OpenRouter is not one of them, and one provider and one
key is what this engine runs on, so the generator is `core/generate.py`.

WHY ONE TOOL WITH A `format` ARGUMENT AND NOT THE CAPABILITY'S GEOMETRY. Read
against the installed 2.43.0: `dimensions` is one pair for the life of the
agent AND it only reaches a direct generator — with a callable on `local`,
`_direct_only_geometry()` lists it and `__post_init__` warns that it was
ignored. A callable, on the other hand, is wrapped in a plain `Tool`
(`NativeOrLocalTool.__post_init__`: `self.local = Tool(self.local)`), so the
tool the model sees is OUR signature: its name, its arguments and its docstring.
The shape of a piece changes per call — a feed post and a story are the same
request cut differently — so the shape is an argument, and the model never
handles pixels: `generate_image(prompt, format)`.

`description=` is not passed for the same reason: on an always-on capability it
is only read to fill the `load_capability` catalogue, which nothing here builds.
"""

import generate
from pydantic_ai import Tool
from pydantic_ai.capabilities import ImageGeneration


def register(engine) -> None:
    # Two retries, not the default one: the skill tells the agent to try once
    # more with the fix in the prompt when the provider refuses, and a second
    # refusal must reach the model as words, not end the turn.
    engine.capability(
        ImageGeneration(native=False, local=Tool(generate.generate_image, max_retries=2))
    )
