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

        # Kept on the instance so a test can build a second store over a
        # different schema without re-deriving the fixture's plumbing.
        self.connect = connect
        self.boards = root / "boards"
        self.store = KanbanStore(connect, self.database, self.boards, self.workspace)

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

    def test_pending_count_degrades_to_zero_when_the_database_cannot_be_opened(self):
        """`manifest()` llama a esto: una base ilegible tiene que costar el
        contador, no el manifiesto entero."""
        unreadable = Path(self.temporary_directory.name) / "no-existe" / "kanban.db"
        self.assertEqual(self.store.pending_count(unreadable), 0)

    def test_assignee_is_null_when_the_schema_predates_it(self):
        """An older agent shows an unowned ticket, never an error.

        The engine owns the kanban schema and our agents do not all update on
        the same day. `assignee` -- the role doing the work -- is one of the new
        columns: asking for it where it does not exist yields OperationalError,
        not an empty field, and that takes the whole response down. This class's
        fixture deliberately lacks the column, so this covers the old shape.
        """
        self.assertIsNone(self.store.tickets()[0]["assignee"])
        self.assertIsNone(self.store.ticket_detail("t_blocked")["ticket"]["assignee"])

    def test_assignee_travels_when_the_schema_has_it(self):
        """And when it is there it reaches the portal: it draws the role chip."""
        database = Path(self.temporary_directory.name) / "with-roles.db"
        connection = sqlite3.connect(database)
        connection.executescript("""
            CREATE TABLE tasks (
              id TEXT PRIMARY KEY, title TEXT, body TEXT, status TEXT,
              tenant TEXT, assignee TEXT, created_at INTEGER,
              block_kind TEXT, block_recurrences INTEGER
            );
            CREATE TABLE task_comments (id INTEGER PRIMARY KEY, task_id TEXT, author TEXT, body TEXT, created_at INTEGER);
            CREATE TABLE task_events (id INTEGER PRIMARY KEY, task_id TEXT, kind TEXT, payload TEXT, created_at INTEGER);
        """)
        connection.execute(
            "INSERT INTO tasks VALUES ('t_post', 'Publicar', '', 'ready', NULL, 'marketing', 1, NULL, NULL)"
        )
        connection.commit()
        connection.close()

        store = KanbanStore(self.connect, database, self.boards, self.workspace)
        self.assertEqual(store.tickets()[0]["assignee"], "marketing")


if __name__ == "__main__":
    unittest.main()
