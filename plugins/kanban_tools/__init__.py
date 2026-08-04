"""kanban_tools plugin — native ticket tools for the Kanban board.

Hermes ships a whole kanban stack (CLI, dashboard, dispatcher, workers) and a
built-in ``kanban`` toolset — but that toolset is gated: its tools only enter
the schema inside a dispatcher-spawned worker (``HERMES_KANBAN_TASK``) or for a
profile that explicitly lists ``kanban`` in ``toolsets``. In an ordinary agent
session the board is therefore invisible, and an agent asked to touch a ticket
has nothing to call. What it does instead is improvise ``execute_code`` against
the internal modules — many turns, easy to get wrong, and occasionally
abandoned halfway with the ticket left untouched.

This plugin closes that gap with one compressed ``kanban`` tool covering the
ticket lifecycle an assistant actually needs: show, list, runs, create,
comment, complete, block, unblock, archive.

Registered under ``toolset="kanban"`` so it sits beside the built-in worker
tools rather than inventing a second board namespace. Those tools keep their
own gate, so a normal session sees exactly one new schema, not thirteen.

Out of scope on purpose: dispatch/daemon/watch/gc/repair/init, deleting
tickets, board create/delete, attachments, notify-subscribe, and all worker
orchestration (assign/claim/swarm/decompose). Those are operator and
dispatcher concerns and stay on the CLI.
"""

from __future__ import annotations

import logging

# Relative import on purpose: the loader imports a directory plugin as
# ``hermes_plugins.<slug>`` wherever it lives (bundled, ~/.hermes/plugins,
# project). An absolute ``plugins.kanban_tools...`` import only resolves for
# the bundled copy and breaks the moment the plugin is installed as a user
# plugin.
from .tools import (
    KANBAN_SCHEMA,
    check_kanban_requirements,
    handle_kanban,
)

logger = logging.getLogger(__name__)


def register(ctx) -> None:
    """Register the ``kanban`` tool.

    Called once by the plugin loader when the plugin is enabled via
    ``plugins.enabled`` in config.yaml.
    """
    ctx.register_tool(
        name="kanban",
        toolset="kanban",
        schema=KANBAN_SCHEMA,
        handler=handle_kanban,
        check_fn=check_kanban_requirements,
        emoji="🗂️",
    )
