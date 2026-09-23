"""The notify plugin: the owner hears about what the agent did on its own.

- `notify_email.py` — the email channel, over Resend, from our domain.
- `notify_loop.py` — what gets said and when: a request waiting, a reminder,
  a broken flow; batched, and quiet at night.
- `notify_store.py` — what was already said.

The channel registry and `notify_owner` are the engine's (`core/notify.py`);
this plugin brings the one channel there is and the rules. It also PROVIDES
`notify.owner` — `notify_owner(subject, text, link)` — to any plugin that
loads after it and has something the owner should hear.
"""

import notify_email
import notify_loop
import notify_store

from core import notify

TICKER = "notify.owner"
EVERY = 60


def register(engine) -> None:
    notify_store.start_floor()
    # No key, no channel: `notify_channels` comes back empty and the portal
    # offers nothing. Not an error — the state of any agent with no account.
    if notify_email.KEY:
        engine.notifier("email", notify_email.send)
    engine.provide("notify.owner", notify.notify_owner)
    engine.ticker(TICKER, notify_loop.look, every=EVERY)
