"""The business plugin: the agent starts knowing the business it works for.

- `researcher.py` — the sub-agent that reads the client's site and what is
  public about the business, and `researcher.md`, how it does it.
- `business_draft.py` — the fixed shape of `negocio/borrador.md`: the
  researcher's `save_draft`, which writes it whole, and the face's
  `correct_draft`, which rewrites one section with what the owner said.
- `business_watch.py` — runs the researcher on its own, once per website the
  owner leaves at onboarding.
- `instructions.md` — what the face does with the draft, and when it hands the
  research back to the researcher.
"""

import business_draft
import business_watch
import researcher


def register(engine) -> None:
    engine.subagent(researcher.build(engine), label=researcher.LABEL)
    engine.toolset(business_draft.corrections())
    engine.ticker(business_watch.TICKER, business_watch.look, every=business_watch.EVERY)
