#!/usr/bin/env python3
# Adapter del portal tuagente: sidecar stdlib-only sobre los datos de Hermes.
# Lecturas: sqlite en mode=ro + filesystem. Escrituras al kanban: SOLO via
# subprocess del CLI `hermes kanban ...` (jamas SQL de escritura).
# Artefactos: solo filesystem (workspace/artifacts), el HTML viaja en el JSON.
# Bearer auth con API_SERVER_KEY + CORS por PORTAL_CORS_ORIGINS.
import json
import os
import re
import shutil
import sqlite3
import subprocess
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

VERSION = "0.11.0"
# El gateway responde el stream de sesiones SIN cabeceras CORS (solo las manda
# en el preflight), asi que el browser descarta la respuesta. Lo proxeamos.
AGENT_BASE = os.environ.get("AGENT_API_BASE", "http://hermes:8642")
TOKEN = os.environ.get("API_SERVER_KEY", "")
ORIGINS = {o.strip() for o in os.environ.get("PORTAL_CORS_ORIGINS", "").split(",") if o.strip()}

DATA = Path("/opt/data")
KANBAN_DB = DATA / "kanban.db"
STATE_DB = DATA / "state.db"
CRON_JOBS = DATA / "cron" / "jobs.json"
CRON_EXEC_DB = DATA / "cron" / "executions.db"
WORKSPACE = DATA / "workspace"
ARTIFACTS = WORKSPACE / "artifacts"
CONFIG = DATA / "config.yaml"

MAX_FILE_BYTES = 5 * 1024 * 1024
MAX_UPLOAD_BYTES = 10 * 1024 * 1024
# Todo lo que sube el cliente cae acá: una sola puerta, confinada.
INBOX = WORKSPACE / "entrada"
TASK_ID_RE = re.compile(r"^[A-Za-z0-9_-]+$")
# Mismo alfabeto que genera skills/artifact/create_artifact.py. OJO: ".." y "."
# tambien matchean, asi que el confinamiento real lo hace artifact_dir().
ART_ID_RE = re.compile(r"^[\w.-]+$")

# --- Autorias que usa el adapter (una por camino, y todas != la del agente) ---
# El agente firma sus comentarios con su profile (en este deploy: "default").
# HUMAN  -> lo que el humano del portal escribe a mano (POST .../comment).
# AUDIT  -> linea automatica que deja el adapter al aprobar/rechazar; se
#           mantiene distinta de HUMAN para que la auditoria no se confunda
#           con un comentario tipeado por la persona.
AUTHOR_HUMAN = "cliente"
AUTHOR_AUDIT = "portal"
MAX_AUTHOR_LEN = 60


def ro(db):
    conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


# ---------- manifest ----------

def agent_name():
    name = os.environ.get("AGENT_NAME", "").strip()
    if name:
        return name
    # Fallback: buscar un name bajo agent:/branding:/display: en config.yaml
    # (scan minimo, sin lib yaml; jamas hardcodear un nombre aca).
    try:
        section = None
        for line in CONFIG.read_text(encoding="utf-8").splitlines():
            if not line.strip() or line.lstrip().startswith("#"):
                continue
            if not line.startswith((" ", "\t")):
                section = line.split(":", 1)[0].strip()
                continue
            m = re.match(r"\s+name:\s*(.+?)\s*$", line)
            if m and section in ("agent", "branding", "display"):
                return m.group(1).strip("\"'")
    except OSError:
        pass
    return "Agente"


def blocked_count():
    try:
        conn = ro(KANBAN_DB)
        n = conn.execute("SELECT COUNT(*) FROM tasks WHERE status='blocked'").fetchone()[0]
        conn.close()
        return n
    except sqlite3.Error:
        return 0


def manifest():
    has_kanban = KANBAN_DB.exists()
    return {
        "agent": agent_name(),
        "portal_plugin": f"adapter-{VERSION}",
        "modules": {
            "chat": True,  # el gateway (:8642) es parte del deploy Hermes
            "kanban": has_kanban,
            "approvals": has_kanban and blocked_count() > 0,
            "files": WORKSPACE.is_dir(),
            # true con que exista la carpeta (aunque este vacia): asi el cliente
            # ve la pestaña y su explicacion antes del primer artefacto.
            "artifacts": ARTIFACTS.is_dir(),
            "usage": STATE_DB.exists(),
            "activity": CRON_EXEC_DB.exists() or CRON_JOBS.exists(),
            "crons": CRON_JOBS.exists(),
            # No es una pestaña: le avisa al chat que puede adjuntar archivos.
            "upload": WORKSPACE.is_dir(),
        },
    }


# ---------- capacidades (que sabe hacer y a que esta conectado) ----------
# Fuentes: los SKILL.md del disco (las locales, siempre frescas), el snapshot
# que Hermes arma para el prompt (trae descripcion y categoria de las bundled),
# `plugins list --json` y `mcp list` (que no tiene --json, se parsea el texto).

SKILLS_DIR = DATA / "skills"
SKILLS_SNAPSHOT = DATA / ".skills_prompt_snapshot.json"


def _skill_summary(skill_md):
    """Que hace esta skill, en una linea.

    Las bundled traen frontmatter YAML con `description`; las nuestras arrancan
    con prosa. Sin saltear el frontmatter, la descripcion terminaba siendo
    "name: claude-code", que no le dice nada a nadie.
    """
    try:
        lines = skill_md.read_text(encoding="utf-8").splitlines()
    except OSError:
        return ""
    i = 0
    if lines and lines[0].strip() == "---":
        for j, line in enumerate(lines[1:], start=1):
            if line.strip() == "---":
                i = j + 1
                break
            m = re.match(r'\s*description:\s*["\']?(.+?)["\']?\s*$', line)
            if m:
                return m.group(1)[:200]
    for line in lines[i:]:
        line = line.strip()
        if not line or line.startswith(("#", "---", "```", "|", ">")):
            continue
        return re.sub(r"[*`_]", "", line)[:200]
    return ""


def _bundled_names():
    """Skills que vienen con Hermes (para no venderlas como propias)."""
    try:
        return {
            l.split(":", 1)[0]
            for l in (SKILLS_DIR / ".bundled_manifest").read_text(encoding="utf-8").splitlines()
            if ":" in l
        }
    except OSError:
        return set()


def capabilities():
    skills, vistos = [], set()
    bundled = _bundled_names()
    if SKILLS_DIR.is_dir():
        for folder in sorted(SKILLS_DIR.iterdir()):
            if folder.name.startswith(".") or not folder.is_dir():
                continue
            md = folder / "SKILL.md"
            if md.exists():
                skills.append({"name": folder.name, "summary": _skill_summary(md),
                               "origen": "de fábrica" if folder.name in bundled else "propia"})
                vistos.add(folder.name)
                continue
            # Categorias: carpetas que agrupan skills (ej. productivity/xlsx).
            for sub in sorted(folder.iterdir()):
                sub_md = sub / "SKILL.md"
                if sub.is_dir() and sub_md.exists() and sub.name not in vistos:
                    skills.append({"name": sub.name, "summary": _skill_summary(sub_md),
                                   "origen": "de fábrica" if sub.name in bundled else "propia",
                                   "categoria": folder.name})
                    vistos.add(sub.name)
    try:
        snap = json.loads(SKILLS_SNAPSHOT.read_text(encoding="utf-8"))
        for s in snap.get("skills", []):
            nombre = s.get("skill_name") or s.get("frontmatter_name")
            if not nombre or nombre in vistos:
                continue
            skills.append({"name": nombre, "summary": s.get("description") or "",
                           "origen": "de fábrica", "categoria": s.get("category") or ""})
            vistos.add(nombre)
    except (OSError, ValueError):
        pass

    plugins = []
    try:
        raw = subprocess.run(["hermes", "plugins", "list", "--json"],
                             capture_output=True, text=True, timeout=30)
        data = json.loads(raw.stdout or "[]")
        items = data if isinstance(data, list) else data.get("plugins", [])
        for p in items:
            if str(p.get("status", "")).lower() == "enabled" or p.get("enabled"):
                plugins.append({"name": p.get("name"), "summary": p.get("description") or ""})
    except (OSError, ValueError, subprocess.SubprocessError):
        pass

    mcp = []
    try:
        raw = subprocess.run(["hermes", "mcp", "list"],
                             capture_output=True, text=True, timeout=30)
        for line in (raw.stdout or "").splitlines():
            line = line.strip()
            # Las filas utiles empiezan con el nombre; el vacio dice "No MCP...".
            if not line or line.startswith(("No MCP", "Add one", "hermes mcp", "-", "=")):
                continue
            mcp.append({"name": line.split()[0], "detalle": line})
    except (OSError, subprocess.SubprocessError):
        pass

    return {"skills": skills, "plugins": plugins, "mcp": mcp}


# ---------- tableros ----------
# El board por defecto vive en /opt/data/kanban.db; los demas en
# /opt/data/kanban/boards/<slug>/kanban.db, cada uno con su board.json
# (verificado creando y borrando uno de prueba, 2026-08-04).

BOARDS_DIR = DATA / "kanban" / "boards"
BOARD_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,48}$")


def board_db(slug):
    """Ruta de la db de un board. None si el slug no existe."""
    if not slug or slug == "default":
        return KANBAN_DB
    if not BOARD_SLUG_RE.match(slug):
        return None
    db = BOARDS_DIR / slug / "kanban.db"
    return db if db.exists() else None


def boards():
    out = [{"slug": "default", "name": "Principal", "archived": False}]
    if BOARDS_DIR.is_dir():
        for folder in sorted(BOARDS_DIR.iterdir()):
            meta_file = folder / "board.json"
            if not (folder / "kanban.db").exists():
                continue
            meta = {}
            try:
                meta = json.loads(meta_file.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                pass
            if meta.get("archived"):
                continue
            out.append({
                "slug": meta.get("slug") or folder.name,
                "name": meta.get("name") or folder.name,
                "archived": False,
                # Link opcional a un Project de Hermes (repos/carpetas).
                "project_id": meta.get("project_id"),
            })
    return out


# ---------- kanban (lectura) ----------

def tickets(db=None):
    conn = ro(db or KANBAN_DB)
    rows = conn.execute(
        "SELECT id, title, body, status, tenant, created_at FROM tasks "
        "WHERE status != 'archived' ORDER BY created_at DESC LIMIT 100"
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def _summary(body, title):
    for line in (body or "").splitlines():
        if line.strip():
            return line.strip()
    return title


def approvals(db=None):
    conn = ro(db or KANBAN_DB)
    rows = conn.execute(
        "SELECT id, title, body, created_at FROM tasks "
        "WHERE status = 'blocked' ORDER BY created_at DESC LIMIT 100"
    ).fetchall()
    conn.close()
    return [
        {
            "id": r["id"],
            "title": r["title"],
            "summary": _summary(r["body"], r["title"]),
            "body": r["body"],
            "created_at": r["created_at"],
        }
        for r in rows
    ]


def task_status(task_id):
    conn = ro(KANBAN_DB)
    row = conn.execute("SELECT status FROM tasks WHERE id = ?", (task_id,)).fetchone()
    conn.close()
    return row["status"] if row else None


def ticket_detail(task_id, db=None):
    conn = ro(db or KANBAN_DB)
    t = conn.execute(
        "SELECT id, title, body, status, tenant, created_at FROM tasks WHERE id = ?",
        (task_id,),
    ).fetchone()
    if t is None:
        conn.close()
        return None
    comments = conn.execute(
        "SELECT author, body, created_at FROM task_comments "
        "WHERE task_id = ? ORDER BY created_at LIMIT 200",
        (task_id,),
    ).fetchall()
    events = conn.execute(
        "SELECT kind, created_at FROM task_events "
        "WHERE task_id = ? ORDER BY created_at DESC LIMIT 50",
        (task_id,),
    ).fetchall()
    conn.close()
    return {
        "ticket": dict(t),
        "comments": [dict(c) for c in comments],
        "events": [dict(e) for e in events],
    }


# ---------- kanban (escritura via CLI, jamas SQL) ----------
#
# Convenciones de invocacion (importan mas de lo que parecen):
#   * opciones SIEMPRE en forma `--flag=valor`; con `--flag valor` argparse
#     rompe cuando el valor empieza con "-" (un titulo tipo "-30% de leads").
#   * un `--` antes de los posicionales, por el mismo motivo.

def hermes_cli(*args):
    """Corre `hermes kanban ...` y devuelve su stdout. Nunca toca SQL."""
    proc = subprocess.run(
        ["hermes", "kanban", *args],
        capture_output=True, text=True, timeout=60,
    )
    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout or "").strip()[-400:]
        raise RuntimeError(f"hermes kanban {args[0]} fallo (rc={proc.returncode}): {detail}")
    return proc.stdout or ""


# Mapa status del portal -> subcomando del CLI. `ready` es "unblock" porque en
# Hermes volver a la cola es exactamente desbloquear (blocked/scheduled -> ready).
STATUS_CMD = {
    "done": "complete",
    "blocked": "block",
    "ready": "unblock",
    "archived": "archive",
}


def safe_author(raw, default):
    """Autor sanitizado, lo mas fiel posible a lo que mando la persona.

    Como pasamos `--author=<valor>` (forma inequivoca para argparse) no hay
    que censurar caracteres raros ni guiones iniciales: alcanza con sacar
    control chars / saltos de linea y acotar el largo. Un nombre tipo
    "Luis (cliente)" tiene que llegar entero al kanban.
    """
    author = re.sub(r"[\x00-\x1f\x7f]+", " ", str(raw or ""))
    author = re.sub(r"\s+", " ", author).strip()[:MAX_AUTHOR_LEN].strip()
    return author or default


def created_task_id(out):
    """Saca el id de la salida de `hermes kanban create`.

    Preferimos --json (imprime el task entero). Si eso falla, caemos al texto
    "Created t_xxxx  (ready, assignee=-)". Si tampoco sale, devolvemos None:
    el ticket YA se creo, asi que mentir un id seria peor que admitir que no
    lo sabemos.
    """
    try:
        data = json.loads(out)
        tid = data.get("id") if isinstance(data, dict) else None
        if isinstance(tid, str) and TASK_ID_RE.match(tid):
            return tid
    except ValueError:
        pass
    m = re.search(r"^Created\s+(\S+)", out or "", re.M)
    if m and TASK_ID_RE.match(m.group(1)):
        return m.group(1)
    return None


def create_ticket(title, body, tenant):
    args = ["create", "--json", f"--created-by={AUTHOR_HUMAN}"]
    if body:
        args.append(f"--body={body}")
    if tenant:
        args.append(f"--tenant={tenant}")
    args += ["--", title]
    return created_task_id(hermes_cli(*args))


def comment_ticket(task_id, body, author):
    # TRAMPA CONOCIDA (no la disparamos, pero conviene tenerla escrita):
    # `hermes kanban comment` NO cambia el estado — solo inserta el comentario
    # y un evento 'commented'. Lo que promueve solo es el dispatcher: en su
    # pasada llama a recompute_ready(), que devuelve un ticket 'blocked' a
    # 'ready' salvo que el bloqueo sea "sticky" (= el ultimo evento
    # blocked/unblocked del ticket es 'blocked'). Un ticket que llego a blocked
    # SIN ese evento tipado —circuit breaker ('gave_up'), `create
    # --initial-status blocked`, o escritura directa a la db— se auto-promueve
    # en la proxima pasada, y como `hermes kanban list` tambien corre
    # recompute_ready(), basta con listar para dispararlo.
    # Por eso: este endpoint NUNCA llama a `list` ni a `unblock`, y el estado
    # lo leemos por SQL read-only. Comentar desde el portal deja el ticket
    # exactamente como estaba.
    # Verificado en 0.5.0: un ticket bloqueado con `hermes kanban block` (que
    # SI emite el evento) aguanta comentarios y pasadas del dispatcher sin
    # moverse; uno creado con `--initial-status blocked` se fue solo a 'ready'
    # antes siquiera de comentarlo. Nuestro create nunca usa esa opcion.
    hermes_cli("comment", f"--author={author}", "--", task_id, body)


def set_ticket_status(task_id, status):
    # Sin --reason/--kind a proposito: `block <id> <reason>` y
    # `unblock --reason=...` agregan un comentario firmado por el profile del
    # CLI (el agente), y eso ensuciaria la autoria del portal.
    hermes_cli(STATUS_CMD[status], "--", task_id)


# ---------- activity ----------

def cron_jobs_raw():
    try:
        return json.loads(CRON_JOBS.read_text(encoding="utf-8")).get("jobs", [])
    except (OSError, ValueError):
        return []


def cron_detail(job_id):
    """Que hace esta tarea y como le fue: la pregunta real del cliente."""
    job = next((j for j in cron_jobs_raw() if j.get("id") == job_id), None)
    if job is None:
        return None
    runs = []
    if CRON_EXEC_DB.exists():
        try:
            conn = ro(CRON_EXEC_DB)
            runs = [
                dict(r) for r in conn.execute(
                    "SELECT id, status, claimed_at, started_at, finished_at, error "
                    "FROM executions WHERE job_id = ? "
                    "ORDER BY claimed_at DESC LIMIT 30",
                    (job_id,),
                ).fetchall()
            ]
            conn.close()
        except sqlite3.Error:
            pass
    return {
        "job": {
            "id": job.get("id"),
            "name": job.get("name"),
            # La consigna con la que corre: es lo que el cliente quiere leer
            # para entender que hace realmente la tarea.
            "prompt": job.get("prompt") or "",
            "script": job.get("script") or "",
            "schedule_display": job.get("schedule_display") or "",
            "enabled": job.get("enabled"),
            "state": job.get("state"),
            "model": job.get("model_snapshot") or job.get("model") or "",
            "deliver": job.get("deliver") or "",
            "last_status": job.get("last_status"),
            "last_error": job.get("last_error"),
            "next_run_at": job.get("next_run_at"),
        },
        "runs": runs,
    }


def activity():
    names = {}
    try:
        data = json.loads(CRON_JOBS.read_text(encoding="utf-8"))
        for job in data.get("jobs", []):
            names[job.get("id")] = job.get("name") or job.get("id")
    except (OSError, ValueError):
        pass
    events = []
    if CRON_EXEC_DB.exists():
        try:
            conn = ro(CRON_EXEC_DB)
            rows = conn.execute(
                "SELECT job_id, status, claimed_at, started_at, finished_at "
                "FROM executions ORDER BY claimed_at DESC LIMIT 50"
            ).fetchall()
            conn.close()
            for r in rows:
                events.append({
                    "ts": r["finished_at"] or r["started_at"] or r["claimed_at"],
                    "kind": "job_run",
                    "label": names.get(r["job_id"], r["job_id"]),
                    "status": r["status"],
                })
        except sqlite3.Error:
            pass
    # Vida del kanban (creaciones, promociones, comentarios...) mezclada con
    # las corridas de jobs; ts ISO local para ordenar parejo.
    if KANBAN_DB.exists():
        try:
            conn = ro(KANBAN_DB)
            rows = conn.execute(
                "SELECT e.kind, e.created_at, COALESCE(t.title, e.task_id) AS label "
                "FROM task_events e LEFT JOIN tasks t ON t.id = e.task_id "
                "ORDER BY e.created_at DESC LIMIT 50"
            ).fetchall()
            conn.close()
            from datetime import datetime
            for r in rows:
                events.append({
                    "ts": datetime.fromtimestamp(r["created_at"]).astimezone().isoformat(),
                    "kind": "ticket",
                    "label": r["label"],
                    "status": r["kind"],
                })
        except sqlite3.Error:
            pass
    events.sort(key=lambda e: e["ts"] or "", reverse=True)
    return events[:80]


# ---------- files (confinado al workspace) ----------

def files_list():
    base = WORKSPACE.resolve()
    out = []
    for path in base.rglob("*"):
        rel = path.relative_to(base)
        if any(part.startswith(".") for part in rel.parts):
            continue
        # Los artefactos tienen su propia pestaña: listarlos aca los duplica.
        if rel.parts and rel.parts[0] == "artifacts":
            continue
        if not path.is_file():
            continue
        st = path.stat()
        out.append({
            "path": path.relative_to(base).as_posix(),
            "size": st.st_size,
            "mtime": int(st.st_mtime),
        })
        if len(out) >= 1000:
            break
    out.sort(key=lambda f: f["mtime"], reverse=True)
    return out


def file_resolve(rel):
    # Path-confined: resolve() + relative_to; nunca escapar del workspace.
    if not rel or rel.startswith("/") or "\x00" in rel:
        return None
    base = WORKSPACE.resolve()
    target = (base / rel).resolve()
    try:
        target.relative_to(base)
    except ValueError:
        return None
    return target if target.is_file() else None


# ---------- artifacts ----------
# Los escribe skills/artifact/create_artifact.py en workspace/artifacts/<id>/
# (index.html + meta.json). El adapter solo lista, lee y borra. El HTML viaja
# DENTRO del JSON como string: el portal lo dibuja en un iframe aislado y el
# adapter jamas lo sirve como text/html (regla anti-XSS del proyecto).

def artifact_dir(art_id):
    # Path-confined, mismo patron que file_resolve() + una vuelta de tuerca:
    # exigimos que el padre sea exactamente la carpeta de artefactos. ".." y "."
    # pasan el regex de id, y sin este chequeo "." resolveria a la carpeta raiz
    # (un DELETE se llevaria puestos TODOS los artefactos).
    if not art_id or not ART_ID_RE.match(art_id):
        return None
    base = ARTIFACTS.resolve()
    target = (base / art_id).resolve()
    try:
        target.relative_to(base)
    except ValueError:
        return None
    if target.parent != base:
        return None
    return target if target.is_dir() else None


def _art_ts(meta):
    try:
        return float(meta.get("created_at") or 0)
    except (TypeError, ValueError):
        return 0.0


def artifact_meta(folder):
    try:
        meta = json.loads((folder / "meta.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(meta, dict):
        return None
    meta.setdefault("id", folder.name)
    return meta


def artifacts_list():
    if not ARTIFACTS.is_dir():
        return []
    out = []
    for folder in ARTIFACTS.iterdir():
        if not folder.is_dir():
            continue
        meta = artifact_meta(folder)
        if meta is None:
            continue  # meta.json ausente o roto: salteamos, la lista no se cae
        out.append(meta)
    out.sort(key=_art_ts, reverse=True)
    return out


def artifact_detail(art_id):
    folder = artifact_dir(art_id)
    if folder is None:
        return None
    try:
        html = (folder / "index.html").read_text(encoding="utf-8")
    except OSError:
        return None  # sin index.html no hay artefacto que mostrar
    # meta best-effort: si esta roto igual devolvemos el HTML, con lo minimo.
    meta = artifact_meta(folder) or {"id": folder.name}
    return {**meta, "html": html}


def artifact_delete(art_id):
    folder = artifact_dir(art_id)
    if folder is None:
        return False
    shutil.rmtree(folder)
    return True


# ---------- usage ----------

def usage(days=30):
    if not STATE_DB.exists():
        return {"available": False}
    try:
        since = time.time() - days * 86400
        conn = ro(STATE_DB)
        row = conn.execute(
            "SELECT COUNT(*) AS sessions, "
            "COALESCE(SUM(input_tokens), 0) AS input_tokens, "
            "COALESCE(SUM(output_tokens), 0) AS output_tokens, "
            "COALESCE(SUM(estimated_cost_usd), 0) AS cost_usd "
            "FROM sessions WHERE started_at >= ?",
            (since,),
        ).fetchone()
        conn.close()
    except sqlite3.Error:
        return {"available": False}
    if not row or row["sessions"] == 0:
        return {"available": False}
    daily, by_channel, by_model = [], [], []
    try:
        conn = ro(STATE_DB)
        daily = [
            dict(r) for r in conn.execute(
                "SELECT date(started_at, 'unixepoch', 'localtime') AS date, "
                "COALESCE(SUM(input_tokens), 0) AS input_tokens, "
                "COALESCE(SUM(output_tokens), 0) AS output_tokens, "
                "COALESCE(SUM(estimated_cost_usd), 0) AS cost_usd "
                "FROM sessions WHERE started_at >= ? GROUP BY date ORDER BY date",
                (time.time() - 14 * 86400,),
            ).fetchall()
        ]
        # De donde vino el trabajo y con que modelo se pago: las dos preguntas
        # que se hace cualquiera que mira una factura.
        by_channel = [
            dict(r) for r in conn.execute(
                "SELECT source AS name, COUNT(*) AS sessions, "
                "COALESCE(SUM(estimated_cost_usd), 0) AS cost_usd "
                "FROM sessions WHERE started_at >= ? "
                "GROUP BY source ORDER BY cost_usd DESC",
                (since,),
            ).fetchall()
        ]
        by_model = [
            dict(r) for r in conn.execute(
                "SELECT COALESCE(model, 'sin dato') AS name, COUNT(*) AS sessions, "
                "COALESCE(SUM(estimated_cost_usd), 0) AS cost_usd "
                "FROM sessions WHERE started_at >= ? "
                "GROUP BY model ORDER BY cost_usd DESC LIMIT 8",
                (since,),
            ).fetchall()
        ]
        conn.close()
    except sqlite3.Error:
        pass
    return {
        "available": True,
        "sessions": row["sessions"],
        "input_tokens": row["input_tokens"],
        "output_tokens": row["output_tokens"],
        "total_tokens": row["input_tokens"] + row["output_tokens"],
        # Estimado del propio Hermes (estimated_cost_usd), no un calculo nuestro.
        "cost_usd": row["cost_usd"],
        "period": f"{days}d",
        "daily": daily,
        "by_channel": by_channel,
        "by_model": by_model,
    }


# ---------- http ----------

class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        origin = self.headers.get("Origin", "")
        if origin in ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
            self.send_header("Access-Control-Allow-Methods",
                             "GET, POST, DELETE, OPTIONS")
        self.send_header("Vary", "Origin")

    def _send(self, code, payload):
        body = json.dumps(payload, default=str).encode()
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body)

    def _send_text(self, code, data):
        # SIEMPRE text/plain (anti-XSS): jamas un content-type que ejecute
        # o dispare download.
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(data)

    def _authed(self):
        auth = self.headers.get("Authorization", "")
        if not TOKEN or auth != f"Bearer {TOKEN}":
            self._send(401, {"error": "unauthorized"})
            return False
        return True

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if not self._authed():
            return
        parsed = urlparse(self.path)
        path = unquote(parsed.path)
        # ?board=<slug> elige tablero; sin el parametro, el de siempre.
        slug = ""
        for chunk in parsed.query.split("&"):
            if chunk.startswith("board="):
                slug = unquote(chunk[len("board="):])
        db = board_db(slug)
        if db is None:
            return self._send(404, {"error": "board not found"})
        try:
            if path == "/portal/manifest":
                return self._send(200, manifest())
            if path == "/portal/capabilities":
                return self._send(200, capabilities())
            if path == "/portal/boards":
                return self._send(200, {"boards": boards()})
            if path == "/portal/tickets":
                return self._send(200, {"tickets": tickets(db)})
            m = re.match(r"^/portal/tickets/([^/]+)$", path)
            if m:
                if not TASK_ID_RE.match(m.group(1)):
                    return self._send(400, {"error": "invalid ticket id"})
                detail = ticket_detail(m.group(1), db)
                if detail is None:
                    return self._send(404, {"error": "ticket not found"})
                return self._send(200, detail)
            if path == "/portal/approvals":
                return self._send(200, {"approvals": approvals(db)})
            m = re.match(r"^/portal/crons/([^/]+)$", path)
            if m:
                detail = cron_detail(m.group(1))
                if detail is None:
                    return self._send(404, {"error": "cron not found"})
                return self._send(200, detail)
            if path == "/portal/activity":
                return self._send(200, {"events": activity()})
            if path == "/portal/files":
                return self._send(200, {"files": files_list()})
            if path.startswith("/portal/files/"):
                target = file_resolve(path[len("/portal/files/"):])
                if target is None:
                    return self._send(404, {"error": "not found"})
                if target.stat().st_size > MAX_FILE_BYTES:
                    return self._send(413, {"error": "file too large"})
                return self._send_text(200, target.read_bytes())
            if path == "/portal/artifacts":
                return self._send(200, {"artifacts": artifacts_list()})
            m = re.match(r"^/portal/artifacts/([^/]+)$", path)
            if m:
                detail = artifact_detail(m.group(1))
                if detail is None:
                    return self._send(404, {"error": "artifact not found"})
                return self._send(200, detail)
            if path == "/portal/usage":
                return self._send(200, usage())
        except (sqlite3.Error, OSError) as exc:
            return self._send(500, {"error": str(exc)})
        return self._send(404, {"error": "not found"})

    def do_DELETE(self):
        if not self._authed():
            return
        path = unquote(urlparse(self.path).path)
        m = re.match(r"^/portal/artifacts/([^/]+)$", path)
        if not m:
            return self._send(404, {"error": "not found"})
        try:
            if not artifact_delete(m.group(1)):
                return self._send(404, {"error": "artifact not found"})
        except OSError as exc:
            return self._send(500, {"error": str(exc)})
        return self._send(200, {"ok": True})

    def _read_json_body(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length <= 0:
            return {}
        try:
            return json.loads(self.rfile.read(length).decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return None

    def _proxy_chat_stream(self, session_id, body):
        # SSE linea a linea: readline() devuelve apenas llega cada evento
        # (read(n) bufferearia hasta completar n bytes y mataria el streaming).
        req = urllib.request.Request(
            f"{AGENT_BASE}/api/sessions/{session_id}/chat/stream",
            data=json.dumps(body).encode(),
            headers={"Authorization": f"Bearer {TOKEN}",
                     "Content-Type": "application/json"},
            method="POST",
        )
        try:
            upstream = urllib.request.urlopen(req, timeout=900)
        except urllib.error.HTTPError as exc:
            return self._send(exc.code, {"error": exc.read().decode("utf-8", "replace")[:400]})
        except OSError as exc:
            return self._send(502, {"error": f"no pude hablar con el agente: {exc}"})
        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()
        try:
            for line in upstream:
                self.wfile.write(line)
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass  # el cliente corto el stream (boton detener): normal
        finally:
            upstream.close()

    def _upload(self, body):
        """Guarda un archivo que el cliente manda desde el portal.

        Llega en base64 dentro del JSON (no multipart: http.server no lo parsea
        y no vale la pena escribir un parser). Va SIEMPRE a workspace/entrada/,
        con el nombre saneado: nada de rutas, ni de escribir en otro lado.
        """
        import base64

        name = os.path.basename(str(body.get("name") or "")).strip()
        name = re.sub(r"[^\w.\- ]", "_", name)[:120]
        if not name or name.startswith("."):
            return self._send(400, {"error": "nombre de archivo invalido"})
        try:
            data = base64.b64decode(str(body.get("content_b64") or ""), validate=True)
        except (ValueError, TypeError):
            return self._send(400, {"error": "contenido invalido (se espera base64)"})
        if not data:
            return self._send(400, {"error": "el archivo vino vacio"})
        if len(data) > MAX_UPLOAD_BYTES:
            return self._send(413, {"error": "el archivo supera 10MB"})

        INBOX.mkdir(parents=True, exist_ok=True)
        target = (INBOX / name).resolve()
        try:
            target.relative_to(INBOX.resolve())
        except ValueError:
            return self._send(400, {"error": "nombre de archivo invalido"})
        if target.exists():  # no pisamos lo que ya subio antes
            stem, suffix = target.stem, target.suffix
            n = 2
            while (INBOX / f"{stem}-{n}{suffix}").exists():
                n += 1
            target = INBOX / f"{stem}-{n}{suffix}"
        target.write_bytes(data)
        rel = target.relative_to(WORKSPACE.resolve()).as_posix()
        return self._send(200, {"ok": True, "path": f"workspace/{rel}", "bytes": len(data)})

    def do_POST(self):
        if not self._authed():
            return
        path = unquote(urlparse(self.path).path)
        if path == "/portal/upload":
            body = self._read_json_body()
            if body is None:
                return self._send(400, {"error": "invalid JSON body"})
            return self._upload(body)
        m = re.match(r"^/portal/sessions/([^/]+)/chat/stream$", path)
        if m:
            body = self._read_json_body()
            if body is None or not str(body.get("message") or "").strip():
                return self._send(400, {"error": "message is required"})
            return self._proxy_chat_stream(m.group(1), body)

        # --- escrituras del kanban (todo por CLI, jamas SQL) ---
        if path == "/portal/tickets":
            body = self._read_json_body()
            if body is None:
                return self._send(400, {"error": "invalid JSON body"})
            title = str(body.get("title") or "").strip()
            if not title:
                return self._send(400, {"error": "title is required"})
            try:
                task_id = create_ticket(
                    title,
                    str(body.get("body") or "").strip(),
                    str(body.get("tenant") or "").strip(),
                )
            except (RuntimeError, subprocess.TimeoutExpired) as exc:
                return self._send(502, {"error": str(exc)})
            return self._send(200, {"ok": True, "id": task_id})

        m = re.match(r"^/portal/tickets/([^/]+)/(comment|status)$", path)
        if m:
            task_id, action = m.group(1), m.group(2)
            if not TASK_ID_RE.match(task_id):
                return self._send(400, {"error": "invalid ticket id"})
            body = self._read_json_body()
            if body is None:
                return self._send(400, {"error": "invalid JSON body"})
            # Validaciones de forma ANTES de tocar la db: un status invalido es
            # 400 aunque el ticket no exista.
            text = status = None
            if action == "comment":
                text = str(body.get("body") or "").strip()
                if not text:
                    return self._send(400, {"error": "body is required"})
            else:
                status = str(body.get("status") or "").strip()
                if status not in STATUS_CMD:
                    return self._send(400, {
                        "error": "invalid status",
                        "allowed": sorted(STATUS_CMD),
                    })
            try:
                if task_status(task_id) is None:
                    return self._send(404, {"error": "ticket not found"})
            except sqlite3.Error as exc:
                return self._send(500, {"error": str(exc)})
            try:
                if action == "comment":
                    # Default = el humano del portal; si el cliente manda
                    # `author`, lo respetamos (sanitizado).
                    comment_ticket(
                        task_id, text,
                        safe_author(body.get("author"), AUTHOR_HUMAN),
                    )
                else:
                    set_ticket_status(task_id, status)
            except (RuntimeError, subprocess.TimeoutExpired) as exc:
                return self._send(502, {"error": str(exc)})
            return self._send(200, {"ok": True})

        m = re.match(r"^/portal/approvals/([^/]+)/(approve|reject)$", path)
        if not m:
            return self._send(404, {"error": "not found"})
        task_id, action = m.group(1), m.group(2)
        if not TASK_ID_RE.match(task_id):
            return self._send(400, {"error": "invalid ticket id"})
        try:
            status = task_status(task_id)
        except sqlite3.Error as exc:
            return self._send(500, {"error": str(exc)})
        if status is None:
            return self._send(404, {"error": "ticket not found"})
        if status != "blocked":
            return self._send(409, {"error": f"ticket is not blocked (status={status})"})

        body = self._read_json_body()
        if body is None:
            return self._send(400, {"error": "invalid JSON body"})
        # Autoria: approve/reject firman con AUTHOR_AUDIT ("portal"), distinto
        # del profile del agente ("default") y distinto de AUTHOR_HUMAN
        # ("cliente", el default de POST /portal/tickets/{id}/comment). Asi en
        # el detalle del ticket se lee de un vistazo quien dijo cada cosa:
        # agente / accion auditada del portal / persona escribiendo.
        try:
            if action == "approve":
                # Aprobar con correccion: el CLI no puede editar el body de un
                # ticket bloqueado (`kanban edit` solo backfillea tareas done),
                # asi que la version corregida entra como comentario del humano
                # ANTES de desbloquear. El agente debe usar esa version: es la
                # ultima palabra del cliente sobre que ejecutar.
                correction = str(body.get("correction") or "").strip()
                if correction:
                    hermes_cli("comment", f"--author={AUTHOR_HUMAN}", "--", task_id,
                               "Aprobado CON CORRECCIONES. Usa exactamente esta "
                               f"version, no la original:\n\n{correction}")
                    hermes_cli("comment", f"--author={AUTHOR_AUDIT}", "--", task_id,
                               "Aprobado desde el portal (con correcciones)")
                else:
                    hermes_cli("comment", f"--author={AUTHOR_AUDIT}", "--",
                               task_id, "Aprobado desde el portal")
                hermes_cli("unblock", "--", task_id)
            else:
                reason = str(body.get("reason") or "").strip()
                if not reason:
                    return self._send(400, {"error": "reason is required"})
                hermes_cli("comment", f"--author={AUTHOR_AUDIT}", "--",
                           task_id, f"Rechazado desde el portal: {reason}")
                # Reject NO desbloquea: el ticket queda blocked a la espera.
        except (RuntimeError, subprocess.TimeoutExpired) as exc:
            return self._send(502, {"error": str(exc)})
        return self._send(200, {"ok": True})

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    # Threading: un stream SSE abierto no puede bloquear el resto del portal.
    ThreadingHTTPServer(("0.0.0.0", 8643), Handler).serve_forever()
