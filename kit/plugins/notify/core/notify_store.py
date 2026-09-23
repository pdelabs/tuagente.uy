"""What the notify plugin has already told the owner, so it says it once.

`notify_marks` is one row per thing said: `approval:<id>` when a request was
first announced, `reminded:<id>` when the reminder went out. `notify_state`
holds two numbers: `floor`, the last event id already looked at (set to the
newest one the first time the plugin loads, so installing it does not mail the
owner a year of history), and `last_try`, when the last mail was attempted —
which is what spaces them, sent or not.

The `notify_` prefix: plugin modules share one `sys.modules` namespace
(`engine/core/plugins.py`), so a bare `store` would be the approval plugin's.
"""

import time

from core import db

SCHEMA = (
    "CREATE TABLE IF NOT EXISTS notify_marks (key TEXT PRIMARY KEY, at REAL NOT NULL)",
    "CREATE TABLE IF NOT EXISTS notify_state (key TEXT PRIMARY KEY, value REAL NOT NULL)",
)

for statement in SCHEMA:
    db.write(statement)


def marked(key: str) -> bool:
    return db.one("SELECT 1 FROM notify_marks WHERE key = ?", (key,)) is not None


def mark(key: str) -> None:
    db.write("INSERT OR IGNORE INTO notify_marks (key, at) VALUES (?, ?)", (key, time.time()))


def state(key: str) -> float | None:
    row = db.one("SELECT value FROM notify_state WHERE key = ?", (key,))
    return row["value"] if row else None


def set_state(key: str, value: float) -> None:
    db.write(
        "INSERT INTO notify_state (key, value) VALUES (?, ?)"
        " ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, value),
    )


def newest_event() -> int:
    return db.one("SELECT COALESCE(MAX(id), 0) AS id FROM events")["id"]


def start_floor() -> None:
    if state("floor") is None:
        set_state("floor", newest_event())
