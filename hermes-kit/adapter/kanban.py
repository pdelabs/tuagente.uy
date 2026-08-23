"""Read-only Kanban models exposed through the portal adapter.

Writes remain in the adapter because they coordinate Hermes CLI calls with agent
notifications. This store owns query-only SQLite access and stable response
shapes for boards, tickets, approvals, and ticket detail.
"""

import json
import re
import sqlite3
from pathlib import Path


BOARD_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,48}$")
PENDING_WHERE = "(status = 'blocked' OR (status = 'triage' AND block_kind = 'needs_input'))"
LEGACY_PENDING_WHERE = "status = 'blocked'"


class KanbanStore:
    """Read-only access to an agent's Kanban databases."""

    def __init__(self, connect, default_database: Path, boards_directory: Path, workspace: Path):
        self.connect = connect
        self.default_database = default_database
        self.boards_directory = boards_directory
        self.workspace = workspace

    def board_database(self, slug: str):
        if not slug or slug == "default":
            return self.default_database
        if not BOARD_SLUG_RE.match(slug):
            return None
        database = self.boards_directory / slug / "kanban.db"
        return database if database.exists() else None

    def boards(self):
        boards = [{"slug": "default", "name": "Principal", "archived": False}]
        if not self.boards_directory.is_dir():
            return boards
        for directory in sorted(self.boards_directory.iterdir()):
            metadata_file = directory / "board.json"
            if not (directory / "kanban.db").exists():
                continue
            try:
                metadata = json.loads(metadata_file.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                metadata = {}
            if metadata.get("archived"):
                continue
            boards.append({
                "slug": metadata.get("slug") or directory.name,
                "name": metadata.get("name") or directory.name,
                "archived": False,
                "project_id": metadata.get("project_id"),
            })
        return boards

    def tickets(self, database=None):
        # `assignee` IS THE ROLE DOING THE WORK. The board is shared across
        # Hermes profiles and this column records which one holds the task;
        # without exposing it the portal draws a team's board that never says
        # who does what. Measured in the 16/8 spike: the decomposer split one
        # request in two and routed both correctly, and the portal still
        # returned them with a null assignee.
        connection = self.connect(database or self.default_database)
        try:
            rows = connection.execute(
                "SELECT id, title, body, status, tenant, assignee, created_at FROM tasks "
                "WHERE status != 'archived' ORDER BY created_at DESC LIMIT 100"
            ).fetchall()
            return [dict(row) for row in rows]
        finally:
            connection.close()

    @staticmethod
    def _summary(body, title):
        for line in (body or "").splitlines():
            if line.strip():
                return line.strip()
        return title

    @staticmethod
    def _pending_where(connection):
        try:
            columns = {row[1] for row in connection.execute("PRAGMA table_info(tasks)")}
        except sqlite3.Error:
            return LEGACY_PENDING_WHERE
        return PENDING_WHERE if "block_kind" in columns else LEGACY_PENDING_WHERE

    def approvals(self, database=None):
        connection = self.connect(database or self.default_database)
        try:
            rows = connection.execute(
                "SELECT id, title, body, created_at, status FROM tasks "
                f"WHERE {self._pending_where(connection)} ORDER BY created_at DESC LIMIT 100"
            ).fetchall()
            return [{
                "id": row["id"],
                "title": row["title"],
                "summary": self._summary(row["body"], row["title"]),
                "body": row["body"],
                "created_at": row["created_at"],
                "estado": row["status"],
            } for row in rows]
        finally:
            connection.close()

    def pending_count(self, database=None):
        """Cuenta los pedidos sin resolver, y ante CUALQUIER falla de sqlite
        devuelve 0 en vez de reventar.

        El abrir la base va adentro del try a proposito: enciende la pestaña
        Aprobaciones desde `manifest()`, y si una base que existe no se puede
        abrir —permisos, WAL trabado, disco— el manifiesto entero se cae y el
        cliente se queda sin portal, no sin un numerito.
        """
        try:
            connection = self.connect(database or self.default_database)
            try:
                return connection.execute(
                    f"SELECT COUNT(*) FROM tasks WHERE {self._pending_where(connection)}"
                ).fetchone()[0]
            finally:
                connection.close()
        except sqlite3.Error:
            return 0

    def task_status(self, task_id: str):
        connection = self.connect(self.default_database)
        try:
            row = connection.execute("SELECT status FROM tasks WHERE id = ?", (task_id,)).fetchone()
            return row["status"] if row else None
        finally:
            connection.close()

    def block_recurrences(self, task_id: str):
        connection = self.connect(self.default_database)
        try:
            row = connection.execute(
                "SELECT block_recurrences FROM tasks WHERE id = ?", (task_id,)
            ).fetchone()
            return row["block_recurrences"] if row else None
        except sqlite3.Error:
            return None
        finally:
            connection.close()

    def _workspace_relative(self, value):
        try:
            return str(Path(str(value)).resolve().relative_to(self.workspace.resolve()))
        except (OSError, TypeError, ValueError):
            return None

    def _event_detail(self, kind, payload):
        if not payload:
            return {}
        try:
            data = json.loads(payload)
        except (TypeError, ValueError):
            return {}
        if not isinstance(data, dict):
            return {}
        result = {}
        summary = data.get("summary") or data.get("reason") or data.get("error")
        if isinstance(summary, str) and summary.strip():
            result["summary"] = summary.strip()[:2000]
        files = [
            relative for relative in (self._workspace_relative(value) for value in data.get("artifacts") or [])
            if relative
        ]
        if files:
            result["files"] = files[:20]
        if kind in ("blocked", "unblocked") and isinstance(data.get("kind"), str):
            result["blocked_kind"] = data["kind"][:60]
        return result

    def ticket_detail(self, task_id: str, database=None):
        connection = self.connect(database or self.default_database)
        try:
            ticket = connection.execute(
                "SELECT id, title, body, status, tenant, assignee, created_at "
                "FROM tasks WHERE id = ?", (task_id,)
            ).fetchone()
            if ticket is None:
                return None
            comments = connection.execute(
                "SELECT author, body, created_at FROM task_comments "
                "WHERE task_id = ? ORDER BY created_at LIMIT 200", (task_id,)
            ).fetchall()
            events = connection.execute(
                "SELECT kind, payload, created_at FROM task_events "
                "WHERE task_id = ? ORDER BY created_at DESC LIMIT 50", (task_id,)
            ).fetchall()
        finally:
            connection.close()

        result_events, outcome = [], None
        for event in events:
            item = {"kind": event["kind"], "created_at": event["created_at"]}
            item.update(self._event_detail(event["kind"], event["payload"]))
            result_events.append(item)
            if outcome is None and event["kind"] in ("completed", "blocked", "gave_up", "failed"):
                if item.get("summary") or item.get("files"):
                    outcome = {
                        key: item[key] for key in ("kind", "summary", "files", "created_at") if key in item
                    }
        return {
            "ticket": dict(ticket),
            "outcome": outcome,
            "comments": [dict(comment) for comment in comments],
            "events": result_events,
        }


def normalize_text(value):
    return re.sub(r"\s+", " ", str(value or "")).strip().lower()
