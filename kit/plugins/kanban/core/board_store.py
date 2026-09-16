"""The board: the tickets, their comments, and the three events that move them.

A ticket is what the client can point at after the conversation is over: a
request she made that needs following, a lead, work that spans more than one
turn. The chat is not that — an answer given in a turn is finished when the
turn is.

WHY THE TABLES ARE CREATED HERE AND NOT IN `core/db.py`. The board is a plugin
of the kit and the engine knows nothing about it: an engine without `kanban` in
`CORE_PLUGINS` has no tickets table, no board routes and no module. The two
statements run when this module is imported, which is when the plugin loads.

THE FIVE STATUSES ARE THE PORTAL'S AND THIS PLUGIN INVENTS NONE. `ready`,
`in_progress`, `blocked`, `done` and `archived` are what `columnForTask`
(`app/app/lib/labels.ts`) reads, and each one lands in a column the client
already has a word for. Anything else is refused by the routes and by the
tools, naming the five: a status the portal does not know falls into «En curso»
and the client reads a ticket that is not moving as one that is.

WHICH OF THE TWO WORDS A BLOCKED TICKET GETS IS DECIDED BY `source`. The portal
splits `blocked` in two — «Esperando aprobación» when the agent is waiting on
the client, «Lo estamos viendo» when the client asked for something and we are
the ones holding it — and it tells them apart by the body. Here the discriminant
is better: a ticket the client made from the portal has `source = client`, which
is the fact itself and not a marker in prose.

`(source, source_ref)` IS THE DEDUPE, and it is a UNIQUE INDEX and not a check
before the insert. The mail and Instagram plugins tick every few minutes over
the same inbox and the same comment feed: «already have it» is the normal case,
not the exception, so `create()` answers with the id that is already there and
says so instead of raising.

`closed_at` IS WRITTEN BY THE MOVE AND NEVER BY THE MODEL. A ticket that enters
`done` or `archived` is closed at that instant; one that leaves them is open
again and the column is cleared. Nothing asks the agent to remember it.
"""

import json
import secrets
import time

from core import db

# ── the five statuses, and the words the client reads them under ────────────

READY = "ready"
IN_PROGRESS = "in_progress"
BLOCKED = "blocked"
DONE = "done"
ARCHIVED = "archived"
STATUSES = (READY, IN_PROGRESS, BLOCKED, DONE, ARCHIVED)

# The end of a ticket's life, either way: `done` is the last column and
# `archived` leaves the board. Both set `closed_at`; leaving either clears it.
CLOSED = (DONE, ARCHIVED)

# The Board's own column names (`app/app/lib/labels.ts`). They are here because
# the event the client reads in Activity is written when the move happens, and
# the code writes it: «Moví «…» a Completado». One status with three names on
# three screens is the bug that list exists to prevent, so these are the same
# five words and no others.
COLUMN = {
    READY: "Por hacer",
    IN_PROGRESS: "En curso",
    BLOCKED: "Esperando aprobación",
    DONE: "Completado",
    ARCHIVED: "Archivada",
}
# What `blocked` is called when the client is the one who asked: the ball is
# ours, not hers.
OURS = "Lo estamos viendo"

# ── where a ticket came from ────────────────────────────────────────────────

# The client made it from the portal; the agent opened it with no source of its
# own; or a plugin did, and then `source` is that plugin's name (`mail`,
# `instagram`) and `source_ref` its key — the message id, the comment id.
FROM_CLIENT = "client"
FROM_AGENT = "agent"

# Who signs a comment. `cliente` is the word the portal reads as hers
# (`isTheClient`), `agente` the one it draws under the name she gave the agent.
CLIENT = "cliente"
AGENT = "agente"

# ── the events a ticket writes ──────────────────────────────────────────────

CREATED = "ticket.created"
MOVED = "ticket.moved"
COMMENTED = "ticket.commented"

# What the ticket's history shows for each one is the portal's
# (`labels.ts`); these are the Activity lines, and Activity is where a client
# reads what her agent did with no ticket open in front of her.
OPENED_LABEL = "Abrí la tarea «{title}»"
MOVED_LABEL = "Moví «{title}» a {column}"
COMMENTED_LABEL = "Comenté en «{title}»"

# Read by the client, on the card she is looking at.
MISSING = "No existe la tarea {ticket_id}."
BAD_STATUS = (
    "«{status}» no es un estado del tablero. Son cinco: ready (Por hacer),"
    " in_progress (En curso), blocked (Esperando), done (Completado)"
    " y archived (sale del tablero)."
)

SCHEMA = (
    """
    CREATE TABLE IF NOT EXISTS tickets (
        id         TEXT PRIMARY KEY,
        title      TEXT NOT NULL,
        body       TEXT NOT NULL DEFAULT '',
        status     TEXT NOT NULL,
        tenant     TEXT,
        source     TEXT NOT NULL,
        source_ref TEXT,
        created_at REAL NOT NULL,
        updated_at REAL NOT NULL,
        closed_at  REAL
    )
    """,
    # The dedupe, as a constraint and not as a convention. Partial, because a
    # ticket with no `source_ref` — the client's own, the agent's own — has
    # nothing to be the same as.
    """
    CREATE UNIQUE INDEX IF NOT EXISTS tickets_by_source
        ON tickets(source, source_ref) WHERE source_ref IS NOT NULL
    """,
    """
    CREATE TABLE IF NOT EXISTS ticket_comments (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        ticket_id  TEXT NOT NULL,
        author     TEXT NOT NULL,
        body       TEXT NOT NULL,
        created_at REAL NOT NULL
    )
    """,
    "CREATE INDEX IF NOT EXISTS ticket_comments_by_ticket ON ticket_comments(ticket_id, id)",
)

for statement in SCHEMA:
    db.write(statement)


def column_of(status: str, source: str) -> str:
    """The column's name, the way the client reads it on the board."""
    if status == BLOCKED and source == FROM_CLIENT:
        return OURS
    return COLUMN[status]


def row_of(ticket_id: str):
    return db.one("SELECT * FROM tickets WHERE id = ?", (ticket_id,))


def by_source(source: str, source_ref: str):
    return db.one(
        "SELECT * FROM tickets WHERE source = ? AND source_ref = ?", (source, source_ref)
    )


def as_ticket(row) -> dict:
    """The shape `app/app/lib/agent.ts` types as `Ticket`.

    `created_at` travels as an epoch in SECONDS, which is what the portal's
    `momentOf` reads, and `assignee` as `null`: nothing in the portal draws it
    and this board has no one to put in it. `source` and `source_ref` travel
    too — they are what the mail and Instagram waves draw «Ver el mail» and
    «Ver el comentario» from.
    """
    return {
        "id": row["id"],
        "title": row["title"],
        "body": row["body"],
        "status": row["status"],
        "tenant": row["tenant"],
        "assignee": None,
        "created_at": int(row["created_at"]),
        "source": row["source"],
        "source_ref": row["source_ref"],
    }


def listing() -> list[dict]:
    """The board, newest first. Archived tickets are off it — that is what
    archiving is — and the link to one still opens its detail."""
    return [
        as_ticket(row)
        for row in db.query(
            "SELECT * FROM tickets WHERE status != ? ORDER BY created_at DESC LIMIT 100",
            (ARCHIVED,),
        )
    ]


def comments(ticket_id: str) -> list[dict]:
    return [
        {"author": row["author"], "body": row["body"], "created_at": int(row["created_at"])}
        for row in db.query(
            "SELECT author, body, created_at FROM ticket_comments WHERE ticket_id = ?"
            " ORDER BY id",
            (ticket_id,),
        )
    ]


def events(ticket_id: str) -> list:
    """This ticket's rows in the engine's event log, newest first.

    THERE IS NO SECOND TIMELINE. Everything that happens to a ticket is already
    an event — it has to be, because Activity is the one place the client reads
    what her agent did — so the ticket's history is that log filtered by the
    `ticket_id` its payload carries.
    """
    return db.query(
        "SELECT * FROM events WHERE json_extract(payload, '$.ticket_id') = ?"
        " ORDER BY id DESC LIMIT 50",
        (ticket_id,),
    )


def payload_of(row) -> dict:
    return json.loads(row["payload"]) if row["payload"] else {}


def as_event(row) -> dict:
    """The shape the portal types as `TicketEvent`: the kind it has a word for,
    when it happened, and the line that came with it."""
    item = {"kind": row["kind"], "created_at": int(row["ts"])}
    said = payload_of(row).get("comment")
    if said:
        item["summary"] = said
    return item


def outcome(ticket, rows: list) -> dict | None:
    """How it ended, or why it is stopped — with what was said about it.

    The portal draws this above the thread so a ticket that went from «created»
    to «done» does not leave the client with no idea what was done. It is built
    from the move that put the ticket where it is, and from what the agent said
    doing it: the comment the move carried, or failing that the last thing the
    agent wrote on the ticket. Nothing said about it is no outcome, which is
    the adapter's own rule — a banner with «Sin detalle» in it is a banner
    that tells her nothing.
    """
    status = ticket["status"]
    if status not in (DONE, BLOCKED):
        return None
    move = next((row for row in rows if row["kind"] == MOVED), None)
    said = payload_of(move).get("comment") if move else None
    if not said:
        said = next(
            (c["body"] for c in reversed(comments(ticket["id"])) if c["author"] == AGENT), None
        )
    if not said:
        return None
    return {
        # The two words the portal knows: `completed` is the one it draws as
        # «Resultado», anything else as «Por qué se frenó».
        "kind": "completed" if status == DONE else "blocked",
        "summary": said,
        "created_at": int(move["ts"] if move else ticket["updated_at"]),
    }


def detail(ticket_id: str) -> dict | None:
    """The whole thread: the ticket, what was said on it, what happened to it."""
    ticket = row_of(ticket_id)
    if ticket is None:
        return None
    rows = events(ticket_id)
    return {
        "ticket": as_ticket(ticket),
        "outcome": outcome(ticket, rows),
        "comments": comments(ticket_id),
        "events": [as_event(row) for row in rows],
    }


def comment(ticket_id: str, author: str, body: str, session_id: str | None = None) -> None:
    ticket = row_of(ticket_id)
    now = time.time()
    db.write(
        "INSERT INTO ticket_comments (ticket_id, author, body, created_at) VALUES (?, ?, ?, ?)",
        (ticket_id, author, body, now),
    )
    db.write("UPDATE tickets SET updated_at = ? WHERE id = ?", (now, ticket_id))
    db.append_event(
        COMMENTED, COMMENTED_LABEL.format(title=ticket["title"]), "comment", session_id,
        {"ticket_id": ticket_id, "author": author, "comment": body},
    )


def set_body(ticket_id: str, body: str) -> None:
    """The ticket's body, rewritten. Not a tool and not a route: the ONE caller
    is a plugin that only learns part of the body after the ticket exists.

    The mail plugin is that caller. An attachment is saved under
    `workspace/correo/<ticket_id>/`, and the folder's name is the id the insert
    hands back — so the paths the body lists cannot be known while it is being
    written. Everything else about a ticket's body is written once, by whoever
    opened it.
    """
    db.write(
        "UPDATE tickets SET body = ?, updated_at = ? WHERE id = ?",
        (body, time.time(), ticket_id),
    )


def create(
    title: str,
    body: str = "",
    status: str = READY,
    source: str = FROM_AGENT,
    source_ref: str | None = None,
    tenant: str | None = None,
    session_id: str | None = None,
) -> tuple[str, bool]:
    """The ticket, and whether THIS call is the one that opened it.

    A `(source, source_ref)` that is already on the board answers with the
    ticket that is there: for the plugins that read an inbox or a comment feed
    every few minutes, finding the same message twice is the normal case.
    """
    if source_ref:
        existing = by_source(source, source_ref)
        if existing:
            return existing["id"], False
    ticket_id = f"t_{secrets.token_hex(6)}"
    now = time.time()
    db.write(
        "INSERT INTO tickets (id, title, body, status, tenant, source, source_ref,"
        " created_at, updated_at, closed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (ticket_id, title, body, status, tenant, source, source_ref, now, now,
         now if status in CLOSED else None),
    )
    db.append_event(
        CREATED, OPENED_LABEL.format(title=title), "created", session_id,
        {"ticket_id": ticket_id, "source": source, "status": status},
    )
    return ticket_id, True


def move(ticket_id: str, status: str, said: str | None = None, session_id: str | None = None) -> None:
    """Into a column, with what the agent said about the move if it said any.

    `closed_at` follows the move and nothing else: it is set entering `done` or
    `archived` and cleared leaving them, so a reopened ticket is open again by
    the same fact that closed it.
    """
    ticket = row_of(ticket_id)
    now = time.time()
    db.write(
        "UPDATE tickets SET status = ?, updated_at = ?, closed_at = ? WHERE id = ?",
        (status, now, now if status in CLOSED else None, ticket_id),
    )
    db.append_event(
        MOVED,
        MOVED_LABEL.format(title=ticket["title"], column=column_of(status, ticket["source"])),
        status,
        session_id,
        {"ticket_id": ticket_id, "status": status, "from": ticket["status"],
         **({"comment": said} if said else {})},
    )
