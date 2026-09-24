"""The three tables this plugin keeps: what the bridge told us, the chats, the messages.

Created when this module is imported — when the plugin loads — so an agent
without `whatsapp` in `CORE_PLUGINS` has none of them. The module names carry
the `wa_` prefix because every enabled plugin's surface modules share ONE
`sys.modules` namespace (`engine/core/plugins.py`).

`whatsapp_events` IS THE DEDUPE. The bridge pushes each event and replays the
ones it could not deliver; the engine asks for what it may have missed at
start. The same event can therefore arrive twice, and `event_id` is the
primary key that makes the second one nothing. `seq` is the bridge's own
counter, and the highest one seen is where the catch-up asks from.

`whatsapp_chats` IS ONE PERSON, keyed by their PHONE JID (the bridge resolves
WhatsApp's hidden ids before anything reaches here). It holds the name the
client reads — the one in the owner's address book first, the person's own
push name second, the phone last — `last_inbound_at`, and
`taken_over_until`: while that is in the future the owner is answering this
chat herself from her phone and the agent does not.

`whatsapp_messages` KEEPS BOTH SIDES, with `origin`: `contact` (the person),
`agent` (what `send_whatsapp` sent) and `owner_phone` (what the owner typed on
her phone). `handled` is whether an inbound message has been dealt with — handed
to a run, or answered by the owner herself — and it is what the watcher reads.
"""

import time

from core import db

SCHEMA = (
    """
    CREATE TABLE IF NOT EXISTS whatsapp_events (
        event_id    TEXT PRIMARY KEY,
        seq         INTEGER,
        type        TEXT NOT NULL,
        received_at REAL NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS whatsapp_chats (
        jid              TEXT PRIMARY KEY,
        phone            TEXT,
        name             TEXT,
        push_name        TEXT,
        last_inbound_at  REAL,
        taken_over_until REAL,
        updated_at       REAL NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS whatsapp_messages (
        chat_jid   TEXT NOT NULL,
        message_id TEXT NOT NULL,
        origin     TEXT NOT NULL,
        kind       TEXT NOT NULL,
        text       TEXT NOT NULL DEFAULT '',
        reply_to   TEXT,
        timestamp  REAL NOT NULL,
        handled    INTEGER NOT NULL DEFAULT 0,
        revoked    INTEGER NOT NULL DEFAULT 0,
        edited     INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (chat_jid, message_id)
    )
    """,
    "CREATE INDEX IF NOT EXISTS whatsapp_messages_open"
    " ON whatsapp_messages(handled, origin, chat_jid)",
)

for statement in SCHEMA:
    db.write(statement)


# ── the events ──────────────────────────────────────────────────────────────


def first_time(event_id: str, seq: int | None, kind: str) -> bool:
    """Write the event down, and say whether this is the first time."""
    if db.one("SELECT 1 FROM whatsapp_events WHERE event_id = ?", (event_id,)):
        return False
    db.write(
        "INSERT OR IGNORE INTO whatsapp_events (event_id, seq, type, received_at)"
        " VALUES (?, ?, ?, ?)",
        (event_id, seq, kind, time.time()),
    )
    return True


def last_seq() -> int:
    row = db.one("SELECT MAX(seq) AS seq FROM whatsapp_events")
    return int(row["seq"] or 0)


# ── the chats ───────────────────────────────────────────────────────────────


def chat(jid: str):
    return db.one("SELECT * FROM whatsapp_chats WHERE jid = ?", (jid,))


def save_chat(jid: str, phone: str | None, contact_name: str | None,
              push_name: str | None, inbound_at: float | None) -> None:
    """The chat, made or brought up to date. A name only ever replaces a name
    with a better one: the owner's address book beats the person's push name,
    which beats nothing."""
    now = time.time()
    if chat(jid) is None:
        db.write(
            "INSERT INTO whatsapp_chats (jid, phone, name, push_name, last_inbound_at,"
            " updated_at) VALUES (?, ?, ?, ?, ?, ?)",
            (jid, phone or None, contact_name or push_name or None, push_name or None,
             inbound_at, now),
        )
        return
    db.write(
        "UPDATE whatsapp_chats SET phone = COALESCE(?, phone),"
        " push_name = COALESCE(?, push_name),"
        " name = COALESCE(?, name, ?),"
        " last_inbound_at = MAX(COALESCE(?, 0), COALESCE(last_inbound_at, 0)),"
        " updated_at = ? WHERE jid = ?",
        (phone or None, push_name or None, contact_name or None, push_name or None,
         inbound_at, now, jid),
    )


def name_of(row) -> str:
    """What the client reads a chat as."""
    return row["name"] or row["phone"] or row["jid"].split("@", 1)[0]


def taken_over(row, now: float | None = None) -> bool:
    return bool(row["taken_over_until"]) and row["taken_over_until"] > (now or time.time())


def take_over(jid: str, until: float) -> None:
    db.write("UPDATE whatsapp_chats SET taken_over_until = ? WHERE jid = ?", (until, jid))


def release(jid: str) -> None:
    db.write("UPDATE whatsapp_chats SET taken_over_until = NULL WHERE jid = ?", (jid,))


# ── the messages ────────────────────────────────────────────────────────────


def add_message(chat_jid: str, message_id: str, origin: str, kind: str, text: str,
                reply_to: str | None, timestamp: float, handled: bool) -> bool:
    if db.one("SELECT 1 FROM whatsapp_messages WHERE chat_jid = ? AND message_id = ?",
              (chat_jid, message_id)):
        return False
    db.write(
        "INSERT INTO whatsapp_messages (chat_jid, message_id, origin, kind, text, reply_to,"
        " timestamp, handled) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (chat_jid, message_id, origin, kind, text, reply_to, timestamp, int(handled)),
    )
    return True


def message(chat_jid: str, message_id: str):
    return db.one("SELECT * FROM whatsapp_messages WHERE chat_jid = ? AND message_id = ?",
                  (chat_jid, message_id))


def revoke(chat_jid: str, message_id: str) -> None:
    """Deleted for everyone by whoever wrote it: nothing left to answer."""
    db.write("UPDATE whatsapp_messages SET revoked = 1, handled = 1"
             " WHERE chat_jid = ? AND message_id = ?", (chat_jid, message_id))


def edit(chat_jid: str, message_id: str, text: str) -> None:
    db.write("UPDATE whatsapp_messages SET text = ?, edited = 1"
             " WHERE chat_jid = ? AND message_id = ?", (text, chat_jid, message_id))


def handle_inbound(chat_jid: str) -> list[str]:
    """Every inbound message of this chat marked dealt with; their ids back."""
    ids = [row["message_id"] for row in db.query(
        "SELECT message_id FROM whatsapp_messages WHERE chat_jid = ? AND origin = 'contact'"
        " AND handled = 0", (chat_jid,))]
    db.write("UPDATE whatsapp_messages SET handled = 1 WHERE chat_jid = ?"
             " AND origin = 'contact' AND handled = 0", (chat_jid,))
    return ids


def open_chats() -> list[str]:
    """The chats with an inbound message nobody dealt with yet, oldest first."""
    return [row["chat_jid"] for row in db.query(
        "SELECT chat_jid, MIN(timestamp) AS first FROM whatsapp_messages"
        " WHERE origin = 'contact' AND handled = 0 GROUP BY chat_jid ORDER BY first")]


def thread(chat_jid: str, limit: int):
    """The last messages of a chat, oldest first."""
    rows = db.query(
        "SELECT * FROM whatsapp_messages WHERE chat_jid = ? AND revoked = 0"
        " ORDER BY timestamp DESC, rowid DESC LIMIT ?", (chat_jid, limit))
    return list(reversed(rows))


def last_message(chat_jid: str):
    return db.one(
        "SELECT * FROM whatsapp_messages WHERE chat_jid = ? AND revoked = 0"
        " ORDER BY timestamp DESC, rowid DESC LIMIT 1", (chat_jid,))
