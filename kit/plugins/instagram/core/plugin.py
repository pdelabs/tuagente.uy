"""The instagram plugin on the `core` engine: reading the comments and answering them.

Publishing is the SOCIAL plugin's and stays there. This one is the other half of
the same account: what people say under a post, which is where a client's next
customer actually shows up.

- `ig_graph.py` — the Graph calls: the feed, the comments, the numbers, the
  token's sixty days.
- `ig_store.py` — two tables: the comments already handled, and the account
  (its username, and the token that is current).
- `ig_tools.py` — `fetch_comments` and `refresh_if_due` on the face; the two
  gated ones, `reply_comment` and `hide_comment`, with the cards they are read
  through; and `recent_performance`, which is not the face's at all.
- `skills/comments/SKILL.md` — which comment gets an answer, which gets
  nothing, which gets hidden, and when one is a client.
- `flows/comentarios-instagram/` — the curated flow that makes it happen every
  fifteen minutes without anybody asking.

WHAT IT PROVIDES TO THE PLUGINS THAT LOAD AFTER IT, which is why `instagram`
sits before `social` in `CORE_PLUGINS`:

    instagram.token            the token in force — the table first, the env
                               second — so publishing and commenting are never
                               holding two different ideas of it
    instagram.token.refreshed  where a refresh from anywhere gets written down
    instagram.performance      the creator's `recent_performance`, read-only

The social plugin asks for all three with `engine.use(name, default=None)`: a
client can buy the posts without the comments, and then publishing reads the env
and the creator writes without the numbers. That is a real optional dependency
and the only thing the default is for (`core/plugins.py`).

THE CURATED FLOW IS COPIED INTO THE WORKSPACE AT LOAD, if it is not already
there. `workspace/flows/<slug>/FLOW.md` is the only source of truth the engine
has for what runs on its own (`core/flows.py`), and a flow that ships with a
capability has to land there for the client to ever see it. NEVER OVERWRITTEN:
the file is the client's from the moment it exists — she pauses it, the agent
edits it — and a restart that put our copy back would undo her.
"""

from pathlib import Path

import ig_graph
import ig_store  # noqa: F401 — imported for the tables it creates on load
import ig_tools

from core import flows

# The plugin's own root, two levels up from this file: `core/plugin.py` lives
# inside `instagram/`, and the flow it ships is `instagram/flows/<slug>/FLOW.md`.
ROOT = Path(__file__).resolve().parent.parent
CURATED = "flows"


def install_flows() -> None:
    """The flows this plugin ships, into the workspace, if they are not there.

    The smallest thing that is true, and the `mail` plugin does the same: the
    kit is a read-only bind mount, the workspace is the client's, and there is
    no install step between them on this engine. A file that is already there is
    never touched — what the client edited is hers, and a flow turned off is
    `status: paused`, which is still a file, so it is not copied back either.
    It happens before the scheduler starts (`server/app.py` loads the plugins
    first), so the first tick already sees it. If the engine grows a shared
    helper for this, both plugins use it and this function goes.
    """
    for source in sorted((ROOT / CURATED).glob(f"*/{flows.FLOW_FILE}")):
        target = flows.file_of(source.parent.name)
        if target.exists():
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(source.read_text())


def register(engine) -> None:
    install_flows()
    engine.toolset(ig_tools.toolset())
    # THE WHOLE TOOLSET IS GATED, with no predicate, exactly as the approval and
    # social plugins gate theirs: a tool added here tomorrow is gated without
    # anyone remembering to put its name on a list.
    engine.toolset(ig_tools.gated().approval_required())
    # And the cards those two are read through. The approval plugin looks them
    # up by tool name when a run stops (`approval/core/render.py`).
    engine.provide(f"approval.render.{ig_tools.REPLY}", ig_tools.reply_card)
    engine.provide(f"approval.render.{ig_tools.HIDE}", ig_tools.hide_card)
    # The token, shared with whoever else talks to this account.
    engine.provide("instagram.token", ig_store.current_token)
    engine.provide("instagram.token.refreshed", ig_graph.remember_token)
    # The numbers, for the hand that writes the next post. A TOOLSET and not a
    # tool: what the social plugin's creator takes is something it can hang on
    # its `Agent(...)` without knowing anything about this plugin.
    engine.provide("instagram.performance", ig_tools.performance())
