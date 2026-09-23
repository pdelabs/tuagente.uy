"""The mail plugin on the `core` engine: the mailbox, the board, the gate.

Everything the client's inbox needs is in this folder and nothing of it is in
the engine:

- `mail_store.py` — the connection (read at call time, never at import) and the
  two tables: what we have already seen, and who an answer goes to.
- `mail_imap.py` — the folder, the unread messages, and turning one into
  something a person reads. The discards are here, in code, before the model.
- `mail_smtp.py` — the reply, and the three headers that make it thread.
- `mail_tools.py` — `fetch_mail` on the face, ungated; `send_email` on the
  face, gated; and the card the client reads before saying yes.
- `instructions.md` — how to talk about what lands in the board.
- `flows/bandeja-de-entrada/FLOW.md` — the five minutes. The engine's loader
  copies it into the client's workspace, never over one that is there
  (`surfaces.flows`, `engine/core/plugins.py`).
"""

import mail_store  # noqa: F401 — imported for the tables it creates on load
import mail_tools


def register(engine) -> None:
    engine.toolset(mail_tools.reading())
    # THE WHOLE SENDING TOOLSET IS GATED, the same way the approval plugin and
    # the social plugin gate theirs: `approval_required()` with no predicate,
    # so a tool added to it tomorrow is gated without anyone remembering to put
    # its name on a list. Fail closed is the whole gate.
    engine.toolset(mail_tools.sending().approval_required())
    # And the card that tool is read through: only this plugin knows what a
    # mail thread is (`approval/core/render.py` looks it up by tool name).
    engine.provide(f"approval.render.{mail_tools.TOOL}", mail_tools.card)
