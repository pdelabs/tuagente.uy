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
- `flows/instagram/` — the curated flow that makes all of it happen without
  anybody asking: `trigger: event`, fired by `ig_tools.watch`, which looks at
  the account every thirty seconds WITH NO MODEL and only wakes the agent up
  when something arrived.

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

THE CURATED FLOW IS COPIED INTO THE WORKSPACE BY THE ENGINE'S LOADER
(`surfaces.flows`, `engine/core/plugins.py`), never over a file that is there:
the file is the client's from the moment it exists — she pauses it, the agent
edits it. What this plugin keeps is its flow's HISTORY, as the two constants
the loader reads: `SUPERSEDED`, a slug it no longer ships, and `UPGRADED`,
earlier versions of one it still does. Renaming a curated flow is otherwise how
a client ends up with two of them reading the same feed.
"""

import ig_graph
import ig_store  # noqa: F401 — imported for the tables it creates on load
import ig_tools

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

# A FLOW THIS PLUGIN STILL SHIPS, IN A VERSION IT NO LONGER SHIPS: slug, and the
# sha256 of every copy we ever shipped under it. On 20/9/2026 `instagram` stopped
# running on a cron and started running when something arrives (`trigger:
# event`), which is a change to the FILE — and the file is the client's.
#
# Same rule as `SUPERSEDED`, for the same reason: an installed copy that is byte
# for byte one of ours was never touched, so it is replaced by today's; anything
# else is hers and stays, with a line in the log. It keeps working as it was —
# the fetch tools are still on the face — it just keeps costing a turn every
# fifteen minutes until somebody moves it over.
UPGRADED = {
    "instagram": {
        "3772d40d3a11f45809b9092ad5de3727dd37b6f815d0d3f908a94b2a107f9e0c",
    },
}


def register(engine) -> None:
    # WHETHER THE ACCOUNT IS SET UP, for a flow that names `instagram`. Without
    # it the flow reads «Le falta una conexión» and its watcher is not called.
    engine.provide("connection.instagram", ig_graph.connected)
    # WHAT FIRES THE FLOW: code that looks at the account with no model in it
    # (`ig_tools.watch`). The flow names it in its frontmatter, `event:`.
    engine.watcher(ig_tools.WATCHER, ig_tools.watch, every=ig_tools.WATCH_EVERY)
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
