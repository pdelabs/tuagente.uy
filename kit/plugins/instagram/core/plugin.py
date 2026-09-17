"""The instagram plugin on the `core` engine: reading the comments and answering them.

Publishing is the SOCIAL plugin's and stays there. This one is the other half of
the same account: what people say under a post, which is where a client's next
customer actually shows up.

- `ig_graph.py` — the Graph calls: the feed, the comments, the message threads,
  the numbers, the token's sixty days.
- `ig_store.py` — four tables: the comments already handled, the messages and
  who is on the other side of each thread, and the account (its username, and
  the token that is current).
- `ig_tools.py` — `fetch_comments`, `fetch_messages` and `refresh_if_due` on
  the face; the three gated ones, `reply_comment`, `hide_comment` and
  `send_message`, with the cards they are read through; and
  `recent_performance`, which is not the face's at all.
- `skills/comments/SKILL.md` — which comment gets an answer, which gets
  nothing, which gets hidden, what a first message deserves, and when either
  one is a client.
- `flows/instagram/` — the curated flow that makes all of it happen every
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

AND A FLOW THIS PLUGIN NO LONGER SHIPS IS RETIRED FIRST, by slug and only if
the installed copy is byte for byte the one we shipped (`SUPERSEDED` below).
Renaming a curated flow is otherwise how a client ends up with two of them
reading the same feed every fifteen minutes.

THE CURATED FLOW IS COPIED INTO THE WORKSPACE AT LOAD, if it is not already
there. `workspace/flows/<slug>/FLOW.md` is the only source of truth the engine
has for what runs on its own (`core/flows.py`), and a flow that ships with a
capability has to land there for the client to ever see it. NEVER OVERWRITTEN:
the file is the client's from the moment it exists — she pauses it, the agent
edits it — and a restart that put our copy back would undo her.
"""

import hashlib
from pathlib import Path

import ig_graph
import ig_store  # noqa: F401 — imported for the tables it creates on load
import ig_tools

from core import flows

# The plugin's own root, two levels up from this file: `core/plugin.py` lives
# inside `instagram/`, and the flow it ships is `instagram/flows/<slug>/FLOW.md`.
ROOT = Path(__file__).resolve().parent.parent
CURATED = "flows"

# A FLOW THIS PLUGIN USED TO SHIP AND DOES NOT ANY MORE, by slug, with the
# sha256 of the EXACT bytes it shipped. `comentarios-instagram` became `instagram`
# on 16/9/2026 when the same fifteen minutes started reading the messages too.
#
# WHY A HASH AND NOT JUST THE SLUG. The installed file is the CLIENT's: she can
# pause it, the agent can edit it. Deleting one by name would throw her edit
# away; leaving it would run two flows over the same feed, one of them ours and
# stale. So an untouched copy — byte for byte what we shipped — is retired, and
# anything else is left alone with a line in the log saying so, which is the
# only honest answer when two people have a claim on one file.
SUPERSEDED = {
    "comentarios-instagram":
        "bebb5682fbde76b57b7e400c113498e0d2f32669373a14a787b0c88a3db5368a",
}


def retire_flows() -> None:
    """The flows this plugin used to ship, taken out if nobody touched them."""
    for slug, digest in SUPERSEDED.items():
        installed = flows.file_of(slug)
        if not installed.is_file():
            continue
        if hashlib.sha256(installed.read_bytes()).hexdigest() != digest:
            print(f"instagram: workspace/flows/{slug}/ was edited, so it stays — it is "
                  f"superseded by `instagram` and both will run until somebody picks one",
                  flush=True)
            continue
        installed.unlink()
        if not any(installed.parent.iterdir()):
            installed.parent.rmdir()
        # `flush`: a line that is block-buffered behind a container's pipe is a
        # line nobody reads until the next hundred arrive.
        print(f"instagram: retired workspace/flows/{slug}/, superseded by `instagram`",
              flush=True)


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
    retire_flows()
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
    engine.provide(f"approval.render.{ig_tools.SEND}", ig_tools.send_card)
    # AND WHAT HAPPENS TO THE TICKET WHILE SHE DECIDES. A gated tool's body does
    # not run until the yes, so the «Esperando tu ok» on the thread cannot be
    # written by the tool: the gate calls this when it writes the row
    # (`approval/core/store.py`'s `PAUSED`). It was prose until 16/9/2026, and
    # prose is what left a thread blocked forever with every request approved.
    engine.provide(f"approval.paused.{ig_tools.SEND}", ig_tools.paused)
    engine.provide(f"approval.paused.{ig_tools.REPLY}", ig_tools.paused)
    # And the gate's own answer to «is that request still out?», which is what
    # keeps a rejected one from reading as a pending one forever.
    ig_tools.PENDING_FOR = engine.use("approvals.pending_for")
    # The token, shared with whoever else talks to this account.
    engine.provide("instagram.token", ig_store.current_token)
    engine.provide("instagram.token.refreshed", ig_graph.remember_token)
    # The numbers, for the hand that writes the next post. A TOOLSET and not a
    # tool: what the social plugin's creator takes is something it can hang on
    # its `Agent(...)` without knowing anything about this plugin.
    engine.provide("instagram.performance", ig_tools.performance())
