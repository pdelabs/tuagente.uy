"""The approval plugin on the `core` engine: the gate, the queue and the page.

Everything the client's yes needs lives in this folder and nothing of it is in
the engine:

- `sensitive.py` — the toolset, exported wrapped in `approval_required()`. The
  gate is on the TOOL, so the model cannot forget to ask: asking is not
  something it does. The prose about what a request must say is in the tool
  and field descriptions, which is where a rule about using a tool belongs.
- `store.py` — the approval row: the pause, the negotiation, the resume.
- `render.py` — the body the client reads, one shape for every tool.
- `routes.py` — `/portal/approvals*`. The request's THREAD is read at
  `/portal/tickets/{id}`, which is the board's path and the board's router:
  this plugin hands over `store.detail` and the board asks for it when an id is
  not one of its own.
- `instructions.md` — the two rules that are about behaviour and that no code
  can enforce. In the prompt only where this plugin is enabled.

`SKILLS = []` because the plugin's `SKILL.md` is about blocking a Hermes
kanban ticket, and this engine has no board: the gate replaced that mechanism
whole. The skill is not broken, it is simply not this engine's, and shipping
its prose here would be telling the agent to use a board that is not there.
"""

import render
import routes
import sensitive
import store

# The one surface of this plugin that does NOT travel to a core engine.
SKILLS: list[str] = []


def paused(session_id: str, requests, history: str) -> str:
    """A run stopped at the gate: the row, and the line the client reads.

    THE RUN'S MESSAGES GO ON THE ROW AND NOT ON THE SESSION. A history that
    ends in an unanswered tool call is not replayable by the next turn, and the
    row is also what makes the pause survive a restart — it carries the
    messages AND the serialized requests, so approving after a `docker kill`
    resumes exactly where the gate stopped.

    What the client reads is written by the code, every time the same sentence.
    Whatever the model said on its way to the tool call is in the request's
    body, where she is the one deciding.
    """
    call = requests.approvals[0]
    store.record_pending(session_id, requests, history)
    return render.pause_message(render.approval_title(call.tool_name, call.args_as_dict()))


def register(engine) -> None:
    # THE CARD ANOTHER PLUGIN DRAWS FOR ITS OWN TOOL. The engine's shared dict
    # is bound, not read: the plugins that gate a tool of theirs load after
    # this one, so what is in it now is nothing and what matters is what is in
    # it when a run stops (`render.py`).
    render.SHARED = engine.shared
    # THE THREAD THE PORTAL OPENS FOR A REQUEST. `/portal/tickets/{id}` is the
    # board's route and there can only be one of it, so what travels is the
    # lookup: the board asks every `tickets.detail.*` it finds for an id that
    # is not a ticket of its own, and this is ours. The name is written out and
    # not imported — two plugins share one `sys.modules` namespace and nothing
    # else (`core/plugins.py`) — the same way the social plugin writes
    # `approval.render.<tool>` to reach this one.
    engine.provide("tickets.detail.approvals", store.detail)
    engine.toolset(sensitive.toolset().approval_required())
    engine.router(routes.router)
    engine.module("approvals", True)
    engine.deferred(paused)
