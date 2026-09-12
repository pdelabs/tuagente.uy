"""SQLite state: sessions, the messages the portal displays, the engine's own
history, approvals and the event log.

Two message stores on purpose. `messages` is what the client reads (role +
text, already corrected by the before-persist hooks); `history` is the
Pydantic AI message list serialized with `ModelMessagesTypeAdapter`, which is
what the next run replays. Compaction (Wave 3) rewrites `history` without
touching what the client already read.
"""

import json
import sqlite3
import threading
import time

from . import config

SCHEMA = """
CREATE TABLE IF NOT EXISTS sessions (
    id          TEXT PRIMARY KEY,
    source      TEXT NOT NULL,
    title       TEXT,
    preview     TEXT,
    created_at  REAL NOT NULL,
    last_active REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    role       TEXT NOT NULL,
    content    TEXT NOT NULL,
    created_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_by_session ON messages(session_id, id);
CREATE TABLE IF NOT EXISTS history (
    session_id TEXT PRIMARY KEY,
    messages   TEXT NOT NULL,
    updated_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS approvals (
    id         TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    status     TEXT NOT NULL,
    title      TEXT NOT NULL,
    summary    TEXT NOT NULL,
    body       TEXT NOT NULL,
    tool_name  TEXT NOT NULL,
    requests   TEXT NOT NULL,
    history    TEXT NOT NULL DEFAULT '',
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS approval_comments (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    approval_id TEXT NOT NULL,
    author      TEXT NOT NULL,
    body        TEXT NOT NULL,
    created_at  REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    ts         REAL NOT NULL,
    kind       TEXT NOT NULL,
    label      TEXT NOT NULL,
    status     TEXT NOT NULL,
    session_id TEXT,
    payload    TEXT
);
"""

_lock = threading.Lock()

config.STATE_DIR.mkdir(parents=True, exist_ok=True)
_conn = sqlite3.connect(config.DB_PATH, check_same_thread=False)
_conn.row_factory = sqlite3.Row
_conn.execute("PRAGMA journal_mode=WAL")
_conn.execute("PRAGMA synchronous=NORMAL")
_conn.executescript(SCHEMA)
# Appended after Wave 1, so a database that already exists gets it too:
# `history` is the message list the resumed run replays. It lives on the
# row and not on the session because a session history that ends in an
# unanswered tool call is not replayable by the next chat turn.
if "history" not in {c["name"] for c in _conn.execute("PRAGMA table_info(approvals)")}:
    _conn.execute("ALTER TABLE approvals ADD COLUMN history TEXT NOT NULL DEFAULT ''")
_conn.commit()


def query(sql: str, args: tuple = ()) -> list[sqlite3.Row]:
    with _lock:
        return _conn.execute(sql, args).fetchall()


def one(sql: str, args: tuple = ()) -> sqlite3.Row | None:
    rows = query(sql, args)
    return rows[0] if rows else None


def write(sql: str, args: tuple = ()) -> None:
    with _lock:
        _conn.execute(sql, args)
        _conn.commit()


# ── sessions ────────────────────────────────────────────────────────────────

def create_session(session_id: str, source: str = "api_server") -> None:
    now = time.time()
    write(
        "INSERT INTO sessions (id, source, title, preview, created_at, last_active)"
        " VALUES (?, ?, NULL, NULL, ?, ?)",
        (session_id, source, now, now),
    )


def session_exists(session_id: str) -> bool:
    return one("SELECT id FROM sessions WHERE id = ?", (session_id,)) is not None


def touch_session(session_id: str, preview: str | None = None) -> None:
    if preview is None:
        write("UPDATE sessions SET last_active = ? WHERE id = ?", (time.time(), session_id))
        return
    # The preview is the conversation's first line; the sidebar shows it when
    # nobody has renamed the session.
    write(
        "UPDATE sessions SET last_active = ?,"
        " preview = COALESCE(NULLIF(preview, ''), ?) WHERE id = ?",
        (time.time(), preview, session_id),
    )


def rename_session(session_id: str, title: str) -> None:
    write("UPDATE sessions SET title = ? WHERE id = ?", (title, session_id))


def delete_session(session_id: str) -> None:
    with _lock:
        _conn.execute("DELETE FROM messages WHERE session_id = ?", (session_id,))
        _conn.execute("DELETE FROM history WHERE session_id = ?", (session_id,))
        _conn.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
        _conn.commit()


def sessions() -> list[sqlite3.Row]:
    return query(
        "SELECT s.*, (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id) AS message_count"
        " FROM sessions s ORDER BY s.last_active DESC"
    )


# ── messages the portal displays ────────────────────────────────────────────

def add_message(session_id: str, role: str, content: str) -> None:
    write(
        "INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)",
        (session_id, role, content, time.time()),
    )


def messages(session_id: str) -> list[sqlite3.Row]:
    return query(
        "SELECT id, role, content FROM messages WHERE session_id = ? ORDER BY id", (session_id,)
    )


# ── the engine's own history ────────────────────────────────────────────────

def save_history(session_id: str, blob: bytes) -> None:
    write(
        "INSERT INTO history (session_id, messages, updated_at) VALUES (?, ?, ?)"
        " ON CONFLICT(session_id) DO UPDATE SET messages = excluded.messages,"
        " updated_at = excluded.updated_at",
        (session_id, blob.decode(), time.time()),
    )


def load_history(session_id: str) -> bytes | None:
    row = one("SELECT messages FROM history WHERE session_id = ?", (session_id,))
    return row["messages"].encode() if row else None


# ── the event log ───────────────────────────────────────────────────────────

def append_event(
    kind: str,
    label: str,
    status: str,
    session_id: str | None = None,
    payload: dict | None = None,
) -> None:
    """Append-only: every state change writes one and Activity is its projection.

    `kind` reaches the client's screen raw when the portal has no label for it
    (`app/app/activity/page.tsx`), so the ones the POC invents are written the
    way the client should read them.
    """
    write(
        "INSERT INTO events (ts, kind, label, status, session_id, payload) VALUES (?, ?, ?, ?, ?, ?)",
        (time.time(), kind, label, status, session_id, json.dumps(payload) if payload else None),
    )


def recent_events(limit: int = 200) -> list[sqlite3.Row]:
    return query("SELECT * FROM events ORDER BY id DESC LIMIT ?", (limit,))
