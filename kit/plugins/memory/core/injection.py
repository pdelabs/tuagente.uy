"""The notebook goes into the INSTRUCTIONS, never into a message. Measured.

The harness injects `MEMORY.md` as a user-role part APPENDED to the last model
request of every round trip (`Memory.before_model_request`), and there is no
knob for where it lands. On the request that carries the client's message that
is harmless. On the request that carries a TOOL RETURN it is the last thing the
model reads before answering, and the model answers IT:

    request: [tool-return "Dejé guardado el posteo 2026-09-14-atencion-sabados",
              user-prompt "<memory> … Los sábados el negocio abre de 9 a 13 …"]
    answer:  «Recibido. El horario de los sábados es de 9:00 a 13:00.»

Two turns out of two, on 14/09, on the turn where the client had asked for a
post. Moving the part to the FRONT of the request fixed the answer and left the
block inside the conversation, where it was still the delegation's problem: the
`delegate_task` tool return carried a copy of the whole notebook in front of the
creator's report, in the persisted history, for every turn that delegated.

SO IT IS NOT IN THE CONVERSATION AT ALL ANY MORE. A capability may contribute
instructions (`AbstractCapability.get_instructions`), and what is re-extracted
per run is the instance `for_run` returns — so the notebook is read there, once
per run, and rendered into the instruction channel next to the guidance that
already lives in it. The message stream carries messages; what the agent knows
arrives the way every other standing fact about the client arrives.

WHAT IT COSTS, AND WHY IT IS WORTH IT. The injected part was at the TAIL of the
request, so a notebook that changed invalidated only the tail of the provider's
cache; an instruction is at the HEAD, so a turn that follows a write starts cold.
It buys the thing the reordering could not: a delegated turn whose tool return
is the delegate's report and nothing else, and a persisted history with no
`<memory>` in it. The block is a LITERAL instruction and not a callable, which
keeps it above the date line and inside the run's stable prefix — one snapshot
per run, not one per round trip.

IT IS STILL DELIMITED. `<memory>` markers stay around the notebook and the
guidance stays outside them: the instruction channel is one authority level up
from a user part, and the markers are what is left saying that these lines were
written by a model and are background, never orders. The guidance says so in
words, which is what it was always for.

IT IS THE CAPABILITY AND NOT A SECOND ONE NEXT TO IT, so every agent this plugin
hands a notebook to gets this — the face, and the sub-agents that ask for one
through `engine.use("memory")`.
"""

from dataclasses import dataclass, field

from pydantic_ai.tools import RunContext
from pydantic_ai_harness.memory import Memory
from pydantic_ai_harness.memory._toolset import render_memory_prompt

# How the harness delimits the notebook (`memory/_capability.py`). Kept in step
# with the library by hand, because it is private and because it is the one
# thing in the prompt that says these lines are not instructions.
OPEN = "<memory>\n"
CLOSE = "\n</memory>"


@dataclass
class Notebook(Memory):
    """The harness's `Memory`, injecting through the instructions."""

    # The run's notebook, rendered once by `for_run` and read back by
    # `get_instructions`, which the framework calls on the instance `for_run`
    # returned. `init=False` because nobody builds one of these with a snapshot
    # in hand.
    _rendered: str | None = field(default=None, init=False, repr=False, compare=False)

    def __post_init__(self) -> None:
        super().__post_init__()
        # THE BASE CLASS'S INJECTION IS OFF, and its `before_model_request` is
        # left alone rather than overridden: with this false it does exactly one
        # thing, which is strip the `<memory>` parts a history persisted before
        # this change still carries.
        self.inject_memory = False

    async def for_run(self, ctx: RunContext) -> "Notebook":
        clone = await super().for_run(ctx)
        clone._rendered = await clone._render(ctx)
        return clone

    async def _render(self, ctx: RunContext) -> str | None:
        """The notebook as the harness renders it, inside its markers.

        The same budget arithmetic as `Memory.before_model_request`: the whole
        section — guidance, heading, lines, file list — fits in `max_tokens`,
        so an agent with two of these pays twice for two notebooks and not
        twice for one budget.
        """
        main, subfiles, files_truncated, error = await self._load_snapshot(ctx)
        content = "" if main is None else main.content
        if error is not None or not (content or subfiles or files_truncated):
            return None
        guidance = self._render_guidance()
        budget = self.max_tokens * 4 - len(guidance or "") - len(OPEN) - len(CLOSE)
        body = render_memory_prompt(
            content,
            subfiles,
            # The heading rides with the guidance when there is one, so the
            # section is not titled twice; a notebook with no guidance of its
            # own carries it here.
            heading="" if guidance else self.heading,
            guidance="",
            max_lines=self.max_lines,
            max_tokens=max(1, budget // 4),
            main_truncated=main is not None and main.truncated,
            files_truncated=files_truncated,
        )[:budget]
        return f"{OPEN}{body}{CLOSE}"

    def get_instructions(self) -> str | None:
        """The rule and the notebook, in that order, as one instruction."""
        return "\n\n".join(p for p in (self._render_guidance(), self._rendered) if p) or None
