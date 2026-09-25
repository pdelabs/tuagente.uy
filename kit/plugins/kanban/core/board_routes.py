"""The Board tab: the five calls `app/app/lib/agent.ts` already types.

    GET  /portal/tickets                  the board, newest first
    GET  /portal/tickets?source=channels  the same list, only the conversations
    GET  /portal/tickets/{id}             the thread: ticket, comments, events, outcome
    POST /portal/tickets                  {title, body?, tenant?} -> {ok, id}
    POST /portal/tickets/{id}/comment     {body, author?}         -> {ok}
    POST /portal/tickets/{id}/status      {status}                -> {ok}
    POST /portal/tickets/{id}/reply       {text}                  -> {ok}

The last one is new (25/9/2026): the owner answering a person herself from the
Bandeja. The board does not know how to reach anybody — the channel plugin that
opened the ticket does, and files how under `board.REPLY + source`.

Not one of them is new: the portal has been calling these since the Hermes
adapter served them, and this plugin is what answers them on this engine. The
empty `/portal/tickets` the engine itself used to answer is gone with it
(`engine/server/portal.py`).

THIS ROUTER OWNS `/portal/tickets/{id}` FOR EVERY PLUGIN THAT HAS A THREAD TO
SHOW THERE. The approval plugin has one — the Approvals tab opens a request
with `getTicketDetail(approvalId)` — and two routers cannot answer the same
path: FastAPI matches the first one registered and the second is dead code
nobody notices, whichever order `CORE_PLUGINS` happens to put them in. So the
board answers for its own ids and asks whoever else filed a lookup under
`tickets.detail.<name>` for the rest. It is `core/plugins.py`'s own
`provide`/`use` mechanism, read at REQUEST time exactly like the approval
plugin's renderer hook: the plugin that files one may load before or after this
one and neither has to know.
"""

import json

from fastapi import APIRouter, HTTPException, Request

import board_store as board

router = APIRouter()

# The engine's shared objects, bound by `plugin.register`. What is in it NOW is
# whatever registered before this plugin; what matters is what is in it when a
# request arrives.
SHARED: dict = {}

# What another plugin files its own `/portal/tickets/{id}` lookup under. One
# per plugin, and each one answers `None` for an id that is not its own.
DETAIL = "tickets.detail."

# The two words the portal asks `?source=` with, and they are ALIASES and not
# sources: `channels` is the three a person writes in through and `work` is
# everything else. Which three is `board.CHANNELS`' to say — the portal asks
# for the screen it is drawing, not for a list of plugin names it would have to
# keep in step. A bare `?source=mail,instagram` still works, which is what the
# aliases are built out of.
CHANNELS = "channels"
WORK = "work"

# Read by the owner, under the Bandeja's box.
NO_REPLY = "Esta conversación no se contesta desde acá."
EMPTY_REPLY = "Escribí lo que le querés contestar."


async def payload(request: Request) -> dict:
    raw = await request.body()
    return json.loads(raw) if raw else {}


def elsewhere(ticket_id: str) -> dict | None:
    """The thread another plugin draws for an id that is not the board's."""
    for name, lookup in SHARED.items():
        if not name.startswith(DETAIL):
            continue
        found = lookup(ticket_id)
        if found:
            return found
    return None


def wanted(source: str | None) -> tuple[tuple[str, ...], bool]:
    """What `?source=` asks for: which sources, and whether to keep the OTHERS.

    Nothing is refused here. A source nobody has ever written a ticket with
    answers with an empty list, which is the truth about it, and the two
    aliases are the only spellings the portal uses.
    """
    value = (source or "").strip()
    if not value:
        return (), False
    if value == CHANNELS:
        return board.CHANNELS, False
    if value == WORK:
        return board.CHANNELS, True
    return tuple(part.strip() for part in value.split(",") if part.strip()), False


def a_status(value: str) -> str:
    if value not in board.STATUSES:
        raise HTTPException(400, board.BAD_STATUS.format(status=value))
    return value


@router.get("/portal/tickets")
def tickets(source: str | None = None):
    """The board. With no `?source=` it is the whole of it, which is the call
    `portal-check` makes and the one every screen made before the Inbox."""
    sources, other = wanted(source)
    return {"tickets": board.listing(sources, other)}


@router.get("/portal/tickets/{ticket_id}")
def ticket(ticket_id: str):
    found = board.detail(ticket_id) or elsewhere(ticket_id)
    if found is None:
        raise HTTPException(404, board.MISSING.format(ticket_id=ticket_id))
    return found


@router.post("/portal/tickets")
async def create(request: Request):
    """The client's own request, off the board's «Nueva tarea».

    It is born `ready` — on the board, in «Por hacer», nobody working it yet —
    and `source` says it is hers. That is also what makes the agent's answer to
    it the answer to something she asked for, and not to something it invented.
    """
    body = await payload(request)
    ticket_id, _ = board.create(
        title=body["title"],
        body=body.get("body") or "",
        source=board.FROM_CLIENT,
        tenant=body.get("tenant") or None,
    )
    return {"ok": True, "id": ticket_id}


@router.post("/portal/tickets/{ticket_id}/comment")
async def comment(ticket_id: str, request: Request):
    if board.row_of(ticket_id) is None:
        raise HTTPException(404, board.MISSING.format(ticket_id=ticket_id))
    body = await payload(request)
    board.comment(ticket_id, body.get("author") or board.CLIENT, body["body"])
    return {"ok": True}


@router.post("/portal/tickets/{ticket_id}/status")
async def status(ticket_id: str, request: Request):
    if board.row_of(ticket_id) is None:
        raise HTTPException(404, board.MISSING.format(ticket_id=ticket_id))
    board.move(ticket_id, a_status((await payload(request))["status"]))
    return {"ok": True}


@router.post("/portal/tickets/{ticket_id}/reply")
async def reply(ticket_id: str, request: Request):
    row = board.row_of(ticket_id)
    if row is None:
        raise HTTPException(404, board.MISSING.format(ticket_id=ticket_id))
    send = SHARED.get(board.REPLY + row["source"])
    if send is None:
        raise HTTPException(400, NO_REPLY)
    text = ((await payload(request)).get("text") or "").strip()
    if not text:
        raise HTTPException(400, EMPTY_REPLY)
    try:
        send(row["source_ref"], text)
    except board.Refused as exc:
        raise HTTPException(409, str(exc)) from exc
    return {"ok": True}
