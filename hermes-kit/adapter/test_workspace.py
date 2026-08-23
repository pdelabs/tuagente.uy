"""Regression tests for workspace confinement and artifact handling."""

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from workspace import WorkspaceStore


class WorkspaceStoreTests(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.workspace = Path(self.temporary_directory.name) / "workspace"
        self.workspace.mkdir()
        self.store = WorkspaceStore(self.workspace)

    def tearDown(self):
        self.temporary_directory.cleanup()

    def test_resolve_file_stays_inside_workspace(self):
        report = self.workspace / "deliveries" / "report.md"
        report.parent.mkdir()
        report.write_text("report", encoding="utf-8")

        self.assertEqual(self.store.resolve_file("deliveries/report.md"), report.resolve())
        self.assertIsNone(self.store.resolve_file("../outside.md"))
        self.assertIsNone(self.store.resolve_file("/etc/passwd"))

    def test_artifact_directory_rejects_parent_paths(self):
        artifact = self.workspace / "artifacts" / "sales"
        artifact.mkdir(parents=True)

        self.assertEqual(self.store.artifact_directory("sales"), artifact.resolve())
        self.assertIsNone(self.store.artifact_directory("."))
        self.assertIsNone(self.store.artifact_directory(".."))
        self.assertIsNone(self.store.artifact_directory("nested/sales"))

    def test_artifact_list_and_detail_ignore_broken_metadata(self):
        good = self.workspace / "artifacts" / "good"
        good.mkdir(parents=True)
        (good / "meta.json").write_text(json.dumps({"title": "Good", "created_at": 20}), encoding="utf-8")
        (good / "index.html").write_text("<p>Safe</p>", encoding="utf-8")
        broken = self.workspace / "artifacts" / "broken"
        broken.mkdir()
        (broken / "meta.json").write_text("not json", encoding="utf-8")

        self.assertEqual(self.store.list_artifacts(), [{"title": "Good", "created_at": 20, "id": "good"}])
        self.assertEqual(self.store.artifact_detail("good")["html"], "<p>Safe</p>")

    def test_file_list_hides_artifact_and_hidden_files(self):
        (self.workspace / "visible.md").write_text("visible", encoding="utf-8")
        (self.workspace / ".hidden.md").write_text("hidden", encoding="utf-8")
        artifact_file = self.workspace / "artifacts" / "chart" / "index.html"
        artifact_file.parent.mkdir(parents=True)
        artifact_file.write_text("chart", encoding="utf-8")

        self.assertEqual([item["path"] for item in self.store.list_files()], ["visible.md"])


if __name__ == "__main__":
    unittest.main()
