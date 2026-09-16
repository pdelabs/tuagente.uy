"""The two tables this plugin keeps: the comments it has seen, and the account.

WHY THE TABLES ARE CREATED HERE AND NOT IN `core/db.py`. Reading comments is a
plugin of the kit and the engine knows nothing about it: an agent without
`instagram` in `CORE_PLUGINS` has neither of these tables, the same way one
without `kanban` has no tickets. The statements run when this module is
imported, which is when the plugin loads.

THE MODULE NAMES CARRY THE `ig_` PREFIX, like the board's carry `board_`. A
plugin's surface modules import each other by plain name and share ONE
`sys.modules` namespace with every other enabled plugin's
(`core/plugins.py`): a `store.py` here would BE the approval plugin's `store`,
already imported under that name, and this plugin would come up reading the
gate's rows with nothing failing and nothing logged.

`instagram_seen` IS THE DEDUPE AND THE CARD'S SOURCE. A comment is handled once
— the flow ticks every fifteen minutes over the same feed, so «already saw it»
is the normal case — and the row carries what the client has to read when the
run stops at the gate: who wrote it, what it says, and which post it is under.
THE APPROVAL CARD IS RENDERED FROM THIS ROW AND NOT FROM A GRAPH CALL: the card
is drawn inside the pause path, and a network call there is a run that dies
holding a request the client never sees.

THERE IS NO `ticket_id` COLUMN, and the plan's first sketch had one. The ticket
a lead becomes is opened by the face with the board's own `create_ticket`, and
`(source, source_ref) = ("instagram", <comment id>)` is already a UNIQUE index
over there (`kanban/core/board_store.py`): that pair IS the link. A column here
would be a second copy of it that nothing in this plugin maintains.

`instagram_account` IS WHERE THE TOKEN LIVES ONCE IT HAS BEEN REFRESHED. The
env is the SEED — `IG_ACCESS_TOKEN` in the instance's `secrets.env`, which is
outside the container and cannot be written from in here — and this table is
the CURRENT value: `refresh_if_due()` writes it and every Graph call reads it
first, falling back to the env. Without that the refreshed token would live
only in `os.environ` of one process and die with it, and the sixty days would
start being counted from a value nobody can see. The username is cached here
too: it is not an env, it is read once from `/me` and it is what tells our own
replies apart from a stranger's.
"""

import time

from core import db

# One row, keyed by the account the agent is connected to. A second account is
# a second agent, which is what this product sells.
SCHEMA = (
    """
    CREATE TABLE IF NOT EXISTS instagram_account (
        user_id          TEXT PRIMARY KEY,
        username         TEXT,
        token            TEXT,
        token_expires_at REAL,
        fetched_at       REAL NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS instagram_seen (
        comment_id TEXT PRIMARY KEY,
        media_id   TEXT NOT NULL,
        permalink  TEXT,
        post_line  TEXT,
        username   TEXT,
        text       TEXT,
        is_reply   INTEGER NOT NULL DEFAULT 0,
        seen_at    REAL NOT NULL
    )
    """,
)

for statement in SCHEMA:
    db.write(statement)


# ── the comments ────────────────────────────────────────────────────────────


def seen(comment_id: str):
    return db.one("SELECT * FROM instagram_seen WHERE comment_id = ?", (comment_id,))


def record(
    comment_id: str,
    media_id: str,
    permalink: str | None,
    post_line: str | None,
    username: str | None,
    text: str,
    is_reply: bool,
) -> bool:
    """Write the comment down, and say whether it is new.

    The primary key is the dedupe and `INSERT OR IGNORE` is what it does with a
    comment that is already there: the tick that finds the same comment again
    leaves the first row alone, which is the row the approval card is drawn
    from.
    """
    if seen(comment_id) is not None:
        return False
    db.write(
        "INSERT OR IGNORE INTO instagram_seen"
        " (comment_id, media_id, permalink, post_line, username, text, is_reply, seen_at)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (comment_id, media_id, permalink, post_line, username, text,
         int(is_reply), time.time()),
    )
    return True


# ── the account: the username, and the token that is current ────────────────


def account():
    return db.one("SELECT * FROM instagram_account ORDER BY fetched_at DESC LIMIT 1")


def save_account(user_id: str, **fields) -> None:
    """The row, made or updated. Only the fields that were given are written:
    the username is learned once and the token is learned every refresh, and
    neither call has anything to say about the other."""
    now = time.time()
    if account() is None:
        db.write(
            "INSERT INTO instagram_account (user_id, fetched_at) VALUES (?, ?)",
            (user_id, now),
        )
    columns = ", ".join(f"{name} = ?" for name in fields)
    db.write(
        f"UPDATE instagram_account SET {columns}, fetched_at = ? WHERE user_id = ?",
        (*fields.values(), now, user_id),
    )


def username() -> str | None:
    row = account()
    return row["username"] if row else None


def current_token() -> str | None:
    """The token this agent is working with, or `None` while the env is still
    the only one there is.

    It is what the social plugin reads through `engine.use("instagram.token")`:
    both plugins publish on the same account with the same token, and after a
    refresh the env's copy is the old one.
    """
    row = account()
    return row["token"] if row else None


def expires_at() -> float | None:
    row = account()
    return row["token_expires_at"] if row else None
