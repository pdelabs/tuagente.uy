"""Regression tests for Kanban portal read models."""

import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from kanban import KanbanStore


class KanbanStoreTests(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        root = Path(self.temporary_directory.name)
        self.database = root / "kanban.db"
        self.workspace = root / "workspace"
        self.workspace.mkdir()
        connection = sqlite3.connect(self.database)
        connection.executescript("""
            CREATE TABLE tasks (
              id TEXT PRIMARY KEY, title TEXT, body TEXT, status TEXT,
              tenant TEXT, created_at INTEGER, block_kind TEXT, block_recurrences INTEGER
            );
            CREATE TABLE task_comments (id INTEGER PRIMARY KEY, task_id TEXT, author TEXT, body TEXT, created_at INTEGER);
            CREATE TABLE task_events (id INTEGER PRIMARY KEY, task_id TEXT, kind TEXT, payload TEXT, created_at INTEGER);
        """)
        connection.executemany(
            "INSERT INTO tasks VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            [
                ("t_blocked", "Blocked", "First line", "blocked", None, 20, "needs_input", 1),
                ("t_triage", "Escalated", "Needs a decision", "triage", None, 10, "needs_input", 2),
                ("t_other", "Other", "Not an approval", "triage", None, 30, "dependency", 0),
            ],
        )
        connection.execute(
            "INSERT INTO task_events VALUES (?, ?, ?, ?, ?)",
            (1, "t_blocked", "completed", '{"summary":"Delivered","artifacts":[]}', 30),
        )
        connection.commit()
        connection.close()

        def connect(path):
            connection = sqlite3.connect(path)
            connection.row_factory = sqlite3.Row
            connection.execute("PRAGMA query_only = ON")
            return connection

        self.store = KanbanStore(connect, self.database, root / "boards", self.workspace)

    def tearDown(self):
        self.temporary_directory.cleanup()

    def test_approvals_include_escalated_permission_requests_only(self):
        approvals = self.store.approvals()
        self.assertEqual([approval["id"] for approval in approvals], ["t_blocked", "t_triage"])
        self.assertEqual(approvals[1]["estado"], "triage")
        self.assertEqual(self.store.pending_count(), 2)

    def test_ticket_detail_exposes_event_outcome(self):
        detail = self.store.ticket_detail("t_blocked")
        self.assertEqual(detail["outcome"]["summary"], "Delivered")
        self.assertEqual(detail["ticket"]["id"], "t_blocked")

    def test_status_and_recurrence_reads_are_scoped_to_default_board(self):
        self.assertEqual(self.store.task_status("t_blocked"), "blocked")
        self.assertEqual(self.store.block_recurrences("t_triage"), 2)


if __name__ == "__main__":
    unittest.main()
