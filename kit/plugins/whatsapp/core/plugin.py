"""The whatsapp plugin on the `core` engine: the client's own number, answered.

The number lives in a second process of the same container — the Go bridge in
`engine/whatsapp-bridge/`, over whatsmeow — which the entrypoint starts only
when this plugin is in `CORE_PLUGINS`. This side is everything else:

- `wa_bridge.py` — HTTP to the bridge, on loopback, with the token the
  entrypoint generated for both.
- `wa_store.py` — the events already seen, the chats (one per person, keyed by
  phone, with the owner's takeover clock) and the messages of both sides.
- `wa_tools.py` — `ingest` (what the bridge pushes: the chat, the message, the
  Bandeja ticket, the takeover), `watch` (what the flow run reads), and
  `send_whatsapp`, the one tool, on the face, not gated.
- `wa_routes.py` — the bridge's webhook and the portal's `/portal/whatsapp/*`.
- `skills/whatsapp/SKILL.md` — what gets answered and what is the owner's.
- `flows/whatsapp/` — the curated flow, `trigger: event`: a message arrives,
  the bridge pushes it, the webhook POKES the scheduler, and a run starts a few
  seconds later — after the person stops typing, so three messages in a row are
  one run.

IT REQUIRES `kanban`: every chat is a Bandeja ticket (`source="whatsapp"`,
`source_ref` the chat's JID), opened and written by code.
"""

import board_store
import wa_routes
import wa_store  # noqa: F401 — imported for the tables it creates on load
import wa_tools


def register(engine) -> None:
    # WHETHER A NUMBER IS LINKED, for a flow that names `whatsapp`: the flow
    # reads «Le falta una conexión» until the owner scans the code.
    engine.provide("connection.whatsapp", wa_tools.connected)
    engine.provide("connection.whatsapp.label", "tu WhatsApp")
    # WHAT FIRES THE FLOW: the pending messages, read with no model. The bridge's
    # push pokes it; this clock is the net under a push that did not arrive.
    engine.watcher(wa_tools.WATCHER, wa_tools.watch, every=wa_tools.WATCH_EVERY)
    # What the bridge has that the push did not bring (the engine was down).
    engine.ticker("whatsapp.catchup", wa_tools.catch_up, every=60)
    # Answering goes out at once (Luis, 24/9/2026): what a gate did, the tool
    # does itself — the Activity line with the words, the ticket closed.
    engine.toolset(wa_tools.toolset())
    engine.router(wa_routes.router)
    # What the owner sends herself from the Bandeja (`board_routes.reply`).
    engine.provide(board_store.REPLY + wa_tools.SOURCE, wa_tools.owner_reply)
    engine.module("whatsapp", True)
    # The chat's name and takeover clock on its Bandeja ticket.
    board_store.EXTRA[wa_tools.SOURCE] = wa_tools.ticket_extra
