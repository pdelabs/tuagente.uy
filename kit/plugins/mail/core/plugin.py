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
- `flows/bandeja-de-entrada/FLOW.md` — the five minutes. Copied into the
  client's workspace below.

**THE CURATED FLOW IS COPIED INTO THE WORKSPACE AT LOAD, IF IT IS NOT THERE.**
On Hermes `install.sh` delivered a plugin's `surfaces.flows` to
`data/flows/<slug>/`; on this engine a flow is a file in `workspace/flows/`
(`core/flows.py`) and there is no install step between the kit and the
container — the kit is a read-only bind mount and the workspace is the client's.
So the plugin copies its own, once, and NEVER over a file that already exists:
what the client edited is hers. Turning the flow off is `status: paused`, which
is still a file, so a paused flow is not copied back either. It happens before
the scheduler starts (`server/app.py` loads the plugins first), so the first
tick already sees it.
"""

from pathlib import Path

import mail_store  # noqa: F401 — imported for the tables it creates on load
import mail_tools

from core import flows

# The plugin's own root, two levels up from this file: `core/plugin.py` lives
# inside `mail/`, and the flows it ships are `mail/flows/<slug>/FLOW.md`.
ROOT = Path(__file__).resolve().parent.parent
CURATED = "flows"


def install_flows() -> None:
    """The flows this plugin ships, into the workspace, if they are not there."""
    for source in sorted((ROOT / CURATED).glob(f"*/{flows.FLOW_FILE}")):
        target = flows.file_of(source.parent.name)
        if target.exists():
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(source.read_text())


def register(engine) -> None:
    install_flows()
    engine.toolset(mail_tools.reading())
    # THE WHOLE SENDING TOOLSET IS GATED, the same way the approval plugin and
    # the social plugin gate theirs: `approval_required()` with no predicate,
    # so a tool added to it tomorrow is gated without anyone remembering to put
    # its name on a list. Fail closed is the whole gate.
    engine.toolset(mail_tools.sending().approval_required())
    # And the card that tool is read through: only this plugin knows what a
    # mail thread is (`approval/core/render.py` looks it up by tool name).
    engine.provide(f"approval.render.{mail_tools.TOOL}", mail_tools.card)
