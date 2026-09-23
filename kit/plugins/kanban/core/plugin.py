"""The board plugin on the `core` engine: the store, the two tools, the tab.

Everything the client's board needs is in this folder and nothing of it is in
the engine:

- `board_store.py` — the `tickets` and `ticket_comments` tables, the five
  statuses, the dedupe key and `closed_at`. The tables are created when this
  plugin loads: an engine without `kanban` has no board at all.
- `board_routes.py` — the five calls the portal already types, and the one
  route another plugin's thread is reached through.
- `board_tools.py` — `create_ticket` and `update_ticket` on the face, not
  gated.
- `instructions.md` — when a ticket is worth opening and how to talk about it.

THE FILE NAMES CARRY THE `board_` PREFIX ON PURPOSE. A plugin's surface modules
import each other by plain name and share ONE `sys.modules` namespace with
every other enabled plugin's (`core/plugins.py`): a `store.py` here would BE
the approval plugin's `store`, already imported under that name, and the board
would come up serving the gate's rows with nothing failing and nothing logged.
Measured once already, on the social plugin's `routes.py`.
"""

import board_routes
import board_store  # noqa: F401 — imported for the tables it creates on load
import board_tools


def register(engine) -> None:
    # Bound, not read: the plugin whose thread also lives at
    # `/portal/tickets/{id}` may register before or after this one, and what
    # matters is what is in the dict when a request arrives.
    board_routes.SHARED = engine.shared
    engine.toolset(board_tools.toolset())
    engine.router(board_routes.router)
    engine.module("kanban", True)
    # THE INBOX IS THE BOARD'S TOO, and it is on the moment the board is. It is
    # not a second store and not a second route: it is the same `/portal/tickets`
    # asked with `?source=channels`, so what would turn it off is the plugin
    # that answers it not being loaded. An Inbox with nothing in it is a
    # truthful screen — an agent whose client has not connected a mailbox yet
    # has no conversations, and the tab says so; a tab that appears the day the
    # first mail lands is a tab the client never learns she has.
    engine.module("inbox", True)
