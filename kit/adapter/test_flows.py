"""Regression tests for flow truth derived from agent-owned metadata."""

import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from flows import FlowStore


class FlowStoreTests(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)
        self.flows = self.root / "flows"
        self.workspace = self.root / "workspace"
        self.executions = self.root / "executions.db"
        self.flows.mkdir()
        self.workspace.mkdir()
        connection = sqlite3.connect(self.executions)
        connection.execute("CREATE TABLE executions (job_id TEXT, finished_at TEXT, status TEXT)")
        connection.execute("INSERT INTO executions VALUES ('job-1', '2026-08-13T10:00:00-03:00', 'failed')")
        connection.commit()
        connection.close()

        def connect(path):
            connection = sqlite3.connect(path)
            connection.row_factory = sqlite3.Row
            connection.execute("PRAGMA query_only = ON")
            return connection

        self.connected = {"telegram"}
        self.store = FlowStore(connect, self.flows, self.workspace, self.executions, lambda: self.connected)

    def tearDown(self):
        self.temporary_directory.cleanup()

    def write_flow(self, slug, frontmatter, body="Customer instructions"):
        directory = self.flows / slug
        directory.mkdir()
        lines = "\n".join(f"{key}: {value}" for key, value in frontmatter.items())
        (directory / "FLOW.md").write_text(f"---\n{lines}\n---\n\n{body}", encoding="utf-8")

    def test_missing_connection_derives_incomplete_state_and_latest_failure(self):
        self.write_flow("weekly", {
            "name": "Weekly report", "status": "active", "connections": "telegram, google-workspace",
            "trigger_job": "job-1",
        })

        flow = self.store.list()["flows"][0]
        self.assertEqual(flow["status"], "incomplete")
        self.assertEqual(flow["missing_connections"], ["google-workspace"])
        self.assertEqual(flow["last_run"]["status"], "failed")

    def test_none_connection_sentinel_does_not_make_a_flow_incomplete(self):
        self.write_flow("manual", {"status": "active", "connections": "ninguna"})
        self.assertEqual(self.store.list()["flows"][0]["status"], "active")

    def test_result_paths_cannot_escape_workspace(self):
        self.write_flow("unsafe", {"status": "active", "results": "../flows"})
        flow = self.store.list()["flows"][0]
        self.assertEqual(flow["results"], [])
        self.assertEqual(flow["results_total"], 0)

    def test_detail_hides_technical_notes_and_html_comments(self):
        self.write_flow(
            "visible", {"status": "active"},
            "Step for the customer\n\n<!-- private -->\n\n## Notas técnicas\nInternal flags",
        )
        self.assertEqual(self.store.detail("visible")["how"], "Step for the customer")


if __name__ == "__main__":
    unittest.main()
