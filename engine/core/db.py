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
    decision   TEXT,
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
CREATE TABLE IF NOT EXISTS flow_runs (
    slug         TEXT NOT NULL,
    scheduled_at REAL NOT NULL,
    session_id   TEXT NOT NULL,
    started_at   REAL NOT NULL,
    finished_at  REAL,
    status       TEXT NOT NULL,
    error        TEXT,
    manual       INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (slug, scheduled_at)
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
# Columns added after Wave 1, so a database that already exists gets them too.
# `history` is the message list the resumed run replays: it lives on the row and
# not on the session because a session history that ends in an unanswered tool
# call is not replayable by the next chat turn. `decision` is which verb took
# the row out of `pending`, written BEFORE the resumed run starts.
_columns = {c["name"] for c in _conn.execute("PRAGMA table_info(approvals)")}
if "history" not in _columns:
    _conn.execute("ALTER TABLE approvals ADD COLUMN history TEXT NOT NULL DEFAULT ''")
if "decision" not in _columns:
    _conn.execute("ALTER TABLE approvals ADD COLUMN decision TEXT")
# `kind` tells a conversation the client started from a run the clock started.
# `source` cannot: both are `api_server`. A flow's session is the client's and
# they can open it, but FROM THE FLOW and not from the chat's list: a flow that
# runs every 15 minutes is a hundred conversations a day nobody typed in, and
# on our own agent (2026-09-20) they had buried the ones somebody did.
_session_columns = {c["name"] for c in _conn.execute("PRAGMA table_info(sessions)")}
if "kind" not in _session_columns:
    _conn.execute("ALTER TABLE sessions ADD COLUMN kind TEXT NOT NULL DEFAULT 'chat'")
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

def create_session(session_id: str, source: str = "api_server", kind: str = "chat") -> None:
    now = time.time()
    write(
        "INSERT INTO sessions (id, source, kind, title, preview, created_at, last_active)"
        " VALUES (?, ?, ?, NULL, NULL, ?, ?)",
        (session_id, source, kind, now, now),
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


def session_kind(session_id: str) -> str | None:
    """`chat` or `flow`: who opened the conversation, the client or the clock."""
    row = one("SELECT kind FROM sessions WHERE id = ?", (session_id,))
    return row["kind"] if row else None


def session_title(session_id: str) -> str | None:
    row = one("SELECT title FROM sessions WHERE id = ?", (session_id,))
    return row["title"] if row else None


def rename_session(session_id: str, title: str) -> None:
    write("UPDATE sessions SET title = ? WHERE id = ?", (title, session_id))


def delete_session(session_id: str) -> None:
    with _lock:
        _conn.execute("DELETE FROM messages WHERE session_id = ?", (session_id,))
        _conn.execute("DELETE FROM history WHERE session_id = ?", (session_id,))
        _conn.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
        _conn.commit()


def sessions() -> list[sqlite3.Row]:
    """The conversations the client started. A run's session is reached from
    its flow (`flow_runs`), never from this list."""
    return query(
        "SELECT s.*, (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id) AS message_count"
        " FROM sessions s WHERE s.kind = 'chat' ORDER BY s.last_active DESC"
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


# ── what the clock started ──────────────────────────────────────────────────

def claim_flow_run(slug: str, scheduled_at: float, session_id: str, manual: bool) -> bool:
    """Write the row for this tick, and say whether THIS caller wrote it.

    The primary key is `(slug, scheduled_at)`, so the insert is the claim: two
    ticks racing on the same occurrence, or a restart that finds the same
    occurrence still due, write one row between them and only one of them gets
    `True` back. Everything a run does happens after this returns `True`.
    """
    with _lock:
        cursor = _conn.execute(
            "INSERT OR IGNORE INTO flow_runs"
            " (slug, scheduled_at, session_id, started_at, status, manual)"
            " VALUES (?, ?, ?, ?, 'running', ?)",
            (slug, scheduled_at, session_id, time.time(), int(manual)),
        )
        _conn.commit()
        return cursor.rowcount == 1


def finish_flow_run(slug: str, scheduled_at: float, status: str, error: str | None = None) -> None:
    write(
        "UPDATE flow_runs SET finished_at = ?, status = ?, error = ?"
        " WHERE slug = ? AND scheduled_at = ?",
        (time.time(), status, error, slug, scheduled_at),
    )


def pause_flow_run(slug: str, scheduled_at: float) -> None:
    """The run stopped at the approval gate: it neither finished nor failed.

    `finished_at` STAYS EMPTY, because nothing finished. The row is out of
    `running` so a restart does not read it as a run the process died holding
    (`scheduler.recover`) — the pause is written down on the approval's row,
    and the client's answer is what moves this one to `ok`.
    """
    write(
        "UPDATE flow_runs SET status = 'paused' WHERE slug = ? AND scheduled_at = ?",
        (slug, scheduled_at),
    )


def flow_run_of_session(session_id: str) -> sqlite3.Row | None:
    """The run this session IS, when the clock is what opened it."""
    return one("SELECT * FROM flow_runs WHERE session_id = ?", (session_id,))


def paused_flow_run(session_id: str) -> sqlite3.Row | None:
    """The run of this session that is waiting for the client's answer."""
    return one(
        "SELECT * FROM flow_runs WHERE session_id = ? AND status = 'paused'", (session_id,)
    )


def last_flow_run(slug: str) -> sqlite3.Row | None:
    """The most recent occurrence of this flow, finished or not. It is what the
    next tick counts from, so a manual run moves the schedule along too."""
    return one(
        "SELECT * FROM flow_runs WHERE slug = ? ORDER BY scheduled_at DESC LIMIT 1", (slug,)
    )


def last_finished_flow_run(slug: str) -> sqlite3.Row | None:
    """The last run that has an outcome. What the portal calls `last_status` is
    this one and never the row in flight: `running` reaching the card comes back
    as "uncertain", and the client reads that as a flow that may or may not have
    worked.

    `paused` IS an outcome for this purpose — it is the one the client has to
    act on — so it travels, and the card says she is the one holding it up."""
    return one(
        "SELECT * FROM flow_runs WHERE slug = ? AND status != 'running'"
        " ORDER BY scheduled_at DESC LIMIT 1",
        (slug,),
    )


def flow_runs(slug: str, limit: int) -> list[sqlite3.Row]:
    """A flow's latest runs, newest first. `has_session` is whether the run's
    conversation is still there to open: `forget_quiet_runs` takes the old
    uneventful ones away and leaves the row."""
    return query(
        "SELECT r.*, EXISTS(SELECT 1 FROM sessions s WHERE s.id = r.session_id) AS has_session"
        " FROM flow_runs r WHERE r.slug = ? ORDER BY r.scheduled_at DESC LIMIT ?",
        (slug, limit),
    )


def forget_quiet_runs(older_than: float) -> int:
    """Delete the CONVERSATIONS of runs that went well and asked for nothing.

    The run's row stays: that it ran, when, and that it went well is the
    flow's history. What goes is the transcript of a run nobody has a reason to
    open. A run that FAILED keeps its conversation, because that is where why
    is written; so does one that asked for an approval, because the approval
    links to it. Returns how many went.
    """
    quiet = (
        "SELECT r.session_id FROM flow_runs r WHERE r.status = 'ok' AND r.finished_at < ?"
        " AND NOT EXISTS (SELECT 1 FROM approvals a WHERE a.session_id = r.session_id)"
    )
    with _lock:
        _conn.execute(f"DELETE FROM messages WHERE session_id IN ({quiet})", (older_than,))
        _conn.execute(f"DELETE FROM history WHERE session_id IN ({quiet})", (older_than,))
        gone = _conn.execute(
            f"DELETE FROM sessions WHERE kind = 'flow' AND id IN ({quiet})", (older_than,)
        ).rowcount
        _conn.commit()
    return gone


def flow_run_in_flight(slug: str) -> sqlite3.Row | None:
    return one("SELECT * FROM flow_runs WHERE slug = ? AND status = 'running'", (slug,))


def running_flow_runs() -> list[sqlite3.Row]:
    return query("SELECT * FROM flow_runs WHERE status = 'running'")


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
    (`app/app/activity/page.tsx`), so the ones the engine invents are written the
    way the client should read them.
    """
    write(
        "INSERT INTO events (ts, kind, label, status, session_id, payload) VALUES (?, ?, ?, ?, ?, ?)",
        (time.time(), kind, label, status, session_id, json.dumps(payload) if payload else None),
    )


def recent_events(limit: int = 200) -> list[sqlite3.Row]:
    return query("SELECT * FROM events ORDER BY id DESC LIMIT ?", (limit,))
