"""Read and manage customer-visible workspace content.

This module owns filesystem confinement for portal files and artifacts. It does
not know about HTTP, authentication, or Hermes internals, which keeps those
boundaries independently testable.
"""

import json
import re
import shutil
from pathlib import Path


MAX_FILE_BYTES = 5 * 1024 * 1024
ARTIFACT_ID_RE = re.compile(r"^[\w.-]+$")


class WorkspaceStore:
    """Filesystem operations scoped to one agent workspace."""

    def __init__(self, workspace: Path):
        self.workspace = workspace
        self.artifacts = workspace / "artifacts"

    def list_files(self):
        """Return visible workspace files, excluding artifact implementation files."""
        if not self.workspace.is_dir():
            return []
        base = self.workspace.resolve()
        files = []
        for path in base.rglob("*"):
            relative = path.relative_to(base)
            if any(part.startswith(".") for part in relative.parts):
                continue
            if relative.parts and relative.parts[0] == "artifacts":
                continue
            if not path.is_file():
                continue
            stat = path.stat()
            files.append({
                "path": relative.as_posix(),
                "size": stat.st_size,
                "mtime": int(stat.st_mtime),
            })
            if len(files) >= 1000:
                break
        files.sort(key=lambda item: item["mtime"], reverse=True)
        return files

    def resolve_file(self, relative_path: str):
        """Resolve an existing file without allowing escape from the workspace."""
        if not relative_path or relative_path.startswith("/") or "\x00" in relative_path:
            return None
        base = self.workspace.resolve()
        target = (base / relative_path).resolve()
        try:
            target.relative_to(base)
        except ValueError:
            return None
        return target if target.is_file() else None

    def artifact_directory(self, artifact_id: str):
        """Resolve one direct artifact child; dots must never target its parent."""
        if not artifact_id or not ARTIFACT_ID_RE.match(artifact_id):
            return None
        base = self.artifacts.resolve()
        target = (base / artifact_id).resolve()
        try:
            target.relative_to(base)
        except ValueError:
            return None
        if target.parent != base:
            return None
        return target if target.is_dir() else None

    @staticmethod
    def _artifact_meta(directory: Path):
        try:
            metadata = json.loads((directory / "meta.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None
        if not isinstance(metadata, dict):
            return None
        metadata.setdefault("id", directory.name)
        return metadata

    @staticmethod
    def _artifact_timestamp(metadata):
        try:
            return float(metadata.get("created_at") or 0)
        except (AttributeError, TypeError, ValueError):
            return 0.0

    def list_artifacts(self):
        if not self.artifacts.is_dir():
            return []
        artifacts = []
        for directory in self.artifacts.iterdir():
            if not directory.is_dir():
                continue
            metadata = self._artifact_meta(directory)
            if metadata is not None:
                artifacts.append(metadata)
        artifacts.sort(key=self._artifact_timestamp, reverse=True)
        return artifacts

    def artifact_detail(self, artifact_id: str):
        directory = self.artifact_directory(artifact_id)
        if directory is None:
            return None
        try:
            html = (directory / "index.html").read_text(encoding="utf-8")
        except OSError:
            return None
        metadata = self._artifact_meta(directory) or {"id": directory.name}
        return {**metadata, "html": html}

    def delete_artifact(self, artifact_id: str):
        directory = self.artifact_directory(artifact_id)
        if directory is None:
            return False
        shutil.rmtree(directory)
        return True
