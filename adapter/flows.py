"""Customer flow read models exposed through the portal adapter.

A flow is declarative metadata in ``flujos/<slug>/FLUJO.md``. This module
derives its portal state from that file, available connections, execution data,
and workspace results without trusting any flow-controlled path to escape the
workspace.
"""

import re
import sqlite3
from pathlib import Path


FLOW_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,48}$")
NO_CONNECTION = {"ninguna", "ninguno", "none", "n/a", "-", "—"}


class FlowStore:
    """Read and derive the customer-facing state of an agent's flows."""

    def __init__(self, connect, flows_directory: Path, workspace: Path, execution_database: Path,
                 connected_connections):
        self.connect = connect
        self.flows_directory = flows_directory
        self.workspace = workspace
        self.execution_database = execution_database
        self.connected_connections = connected_connections

    @staticmethod
    def frontmatter(path: Path):
        try:
            lines = path.read_text(encoding="utf-8").splitlines()
        except OSError:
            return {}
        if not lines or lines[0].strip() != "---":
            return {}
        fields = {}
        for line in lines[1:]:
            if line.strip() == "---":
                break
            match = re.match(r"^([a-z_]+):\s*[\"']?(.*?)[\"']?\s*$", line)
            if match:
                fields[match.group(1)] = match.group(2)
        return fields

    @staticmethod
    def connection_ids(value):
        return [
            item.strip() for item in (value or "").split(",")
            if item.strip() and item.strip().lower() not in NO_CONNECTION
        ]

    def latest_run(self, job_id):
        if not job_id or not self.execution_database.exists():
            return None
        try:
            connection = self.connect(self.execution_database)
            try:
                row = connection.execute(
                    "SELECT finished_at, status FROM executions WHERE job_id = ? "
                    "ORDER BY rowid DESC LIMIT 1", (job_id,),
                ).fetchone()
            finally:
                connection.close()
            return {"cuando": row[0], "status": row[1]} if row else None
        except sqlite3.Error:
            return None

    def results_directory(self, value, slug):
        relative = value or f"entregables/{slug}"
        base = self.workspace.resolve()
        candidate = (base / relative).resolve()
        try:
            candidate.relative_to(base)
        except ValueError:
            return None
        return candidate if candidate.is_dir() else None

    def _results(self, fields, slug):
        directory = self.results_directory(fields.get("resultados"), slug)
        if directory is None:
            return []
        try:
            return sorted(
                (path for path in directory.iterdir() if path.is_file()),
                key=lambda path: path.stat().st_mtime,
                reverse=True,
            )
        except OSError:
            return []

    def list(self, result_limit=20):
        if not self.flows_directory.is_dir():
            return {"disponible": False, "flujos": []}
        connected = self.connected_connections()
        flows = []
        for directory in sorted(self.flows_directory.iterdir()):
            definition = directory / "FLUJO.md"
            if not directory.is_dir() or not definition.is_file() or not FLOW_SLUG_RE.match(directory.name):
                continue
            fields = self.frontmatter(definition)
            required = self.connection_ids(fields.get("conexiones"))
            missing = [] if connected is None else [item for item in required if item not in connected]
            state = fields.get("estado", "activo")
            if state == "activo" and missing:
                state = "incompleto"
            results = self._results(fields, directory.name)
            flows.append({
                "slug": directory.name,
                "nombre": fields.get("nombre") or directory.name,
                "para_cliente": fields.get("para_cliente", ""),
                "gatillo_tipo": fields.get("gatillo_tipo", "pedido"),
                "gatillo": fields.get("gatillo_detalle", ""),
                "estado": state,
                "conexiones_faltan": missing,
                "ultima_corrida": self.latest_run(fields.get("gatillo_job")),
                "resultados": [
                    {"path": str(path.relative_to(self.workspace)), "mtime": path.stat().st_mtime}
                    for path in results[:result_limit]
                ],
                "resultados_total": len(results),
            })
        flows.sort(key=lambda flow: (
            flow["estado"] != "incompleto", flow["estado"] != "activo", flow["nombre"],
        ))
        return {"disponible": True, "flujos": flows}

    def detail(self, slug):
        if not slug or not FLOW_SLUG_RE.match(slug):
            return None
        flow = next((item for item in self.list(result_limit=500)["flujos"] if item["slug"] == slug), None)
        if flow is None:
            return None
        try:
            text = (self.flows_directory / slug / "FLUJO.md").read_text(encoding="utf-8")
            parts = text.split("---", 2)
            instructions = parts[2].strip() if len(parts) >= 3 else ""
        except OSError:
            instructions = ""
        instructions = re.split(r"\n##\s+Notas?\s+t[eé]cnicas?\b", instructions, flags=re.IGNORECASE)[0]
        instructions = re.sub(r"<!--.*?-->", "", instructions, flags=re.DOTALL)
        flow["como"] = instructions.strip()
        return flow

    def required_connection_ids(self):
        ids = set()
        for flow in self.list(result_limit=0)["flujos"]:
            if flow.get("estado") == "pausado":
                continue
            definition = self.flows_directory / flow["slug"] / "FLUJO.md"
            ids.update(self.connection_ids(self.frontmatter(definition).get("conexiones")))
        return ids
