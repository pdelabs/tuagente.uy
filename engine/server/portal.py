"""What the portal calls the `adapter` base: everything the native gateway
does not expose.

What a PLUGIN adds is not here: `/portal/approvals*` is the `approval`
plugin's router and `/portal/tickets*` the `kanban` plugin's, both registered
with `engine.router(...)` and included after this one. The manifest's `modules`
is the engine's base plus what those plugins flipped (`core/plugins.py`).

THE BOARD USED TO BE ANSWERED HERE, EMPTY. `GET /portal/tickets` returned
`{"tickets": []}` because this engine had no board; it has one now and it is a
plugin's, so an engine without `kanban` in `CORE_PLUGINS` answers 404 — which
is what the portal reads as "this agent does not have that module", and which
its manifest already said.
"""

import base64
import binascii
import mimetypes
import zlib
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, StreamingResponse

from core import config, db, identity, notify, plugins, session
from core.tools.workspace import under

from . import sse

router = APIRouter()

# Read by the client: the portal shows `error.message` on the tab she is on.
NO_FILE = "No hay ningún archivo {path} en el espacio de trabajo."
BAD_UPLOAD = "No pude leer el archivo: lo que llegó no es base64."
# A second message while the first is still being worked: a turn outlives the
# connection now (`session.start_turn`), and two turns on one session would
# each save a history without the other's.
BUSY = (
    "Todavía estoy trabajando en tu mensaje anterior de esta conversación."
    " Cuando termine te lo dejo acá; después mandame este de nuevo."
)


def iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, ZoneInfo(config.TIMEZONE)).isoformat()


@router.get("/portal/manifest")
def manifest():
    who = identity.load()
    return {
        "agent": who["name"],
        "adapter_version": config.ADAPTER_VERSION,
        "modules": plugins.modules(),
        "named": bool(who.get("name")),
        "look": who.get("look"),
        "company": who.get("company"),
        "notify_channel": who.get("contact", {}).get("channel"),
        "notify_channels": notify.available(),
        "timezone": config.TIMEZONE,
    }


@router.post("/portal/identity")
async def save_identity(request: Request):
    identity.save(identity.load() | await request.json())
    return {"ok": True}


# ── chat ────────────────────────────────────────────────────────────────────

@router.post("/portal/chat/stream")
async def chat_stream(request: Request):
    """OpenAI-shaped: the whole local history travels, no session id.

    The session is the one whose displayed messages are exactly this history
    minus the message being sent; without that, every message of a new
    conversation would open a session of its own.
    """
    payload = await request.json()
    messages = [m for m in payload["messages"] if m.get("role") in ("user", "assistant")]
    if not messages or messages[-1]["role"] != "user":
        raise HTTPException(400, "the last message has to be the client's")
    session_id = session.match_session(messages[:-1]) or session.ensure_session()
    if session.running(session_id):
        raise HTTPException(409, BUSY)
    events = session.start_turn(session_id, messages[-1]["content"])
    return StreamingResponse(
        sse.openai_dialect(events), media_type="text/event-stream", headers=sse.HEADERS
    )


@router.post("/portal/sessions/{session_id}/chat/stream")
async def session_chat_stream(session_id: str, request: Request):
    # Before the body: portal-check posts an empty body to a session that does
    # not exist and expects the 400 to be about the session.
    if not db.session_exists(session_id):
        raise HTTPException(400, f"there is no conversation {session_id}")
    message = (await request.json())["message"]
    if session.running(session_id):
        raise HTTPException(409, BUSY)
    events = session.start_turn(session_id, message)
    return StreamingResponse(
        sse.session_dialect(events, session_id),
        media_type="text/event-stream",
        headers=sse.HEADERS,
    )


# ── the rest of the tabs ────────────────────────────────────────────────────

# What closes a `…started` event, by the family its kind belongs to. A flow's
# run ends in one of three; a delegation in its `finished`, or in the turn
# around it breaking (`error`), which is the one way it can end with no
# `finished` of its own.
ENDS = {
    "flow": ("flow.finished", "flow.failed", "flow.paused"),
    "delegation": ("delegation.finished", "error"),
}


def settled(rows: list) -> dict[int, str]:
    """The status a `…started` event is served with once what it started ended.

    THE LOG IS APPEND-ONLY AND THIS IS ITS PROJECTION. «Empecé el flujo» is
    written `running`, and it stayed `running` after the run finished: the
    portal read that as «Miga está trabajando» on Inicio and Activity for good.
    So each start takes the status of the event that closed it, matched in
    the same session — a flow's run is one session, and a session's
    delegations close in the order they opened.
    """
    open_: dict[tuple[str, str], list[int]] = {}
    out: dict[int, str] = {}
    for row in sorted(rows, key=lambda r: r["id"]):
        family, _, verb = row["kind"].partition(".")
        if verb == "started" and family in ENDS and row["session_id"]:
            open_.setdefault((family, row["session_id"]), []).append(row["id"])
            continue
        for family, ends in ENDS.items():
            if row["kind"] not in ends:
                continue
            waiting = open_.get((family, row["session_id"])) or []
            if family == "flow":
                # A paused run finishes later in the same session: the last
                # word wins, and the start stays addressable until then.
                for start in waiting:
                    out[start] = row["status"]
            elif row["kind"] == "error":
                for start in waiting:
                    out[start] = row["status"]
                waiting.clear()
            elif waiting:
                out[waiting.pop(0)] = row["status"]
    return out


@router.get("/portal/activity")
def activity():
    """What the owner reads in Activity and Inicio: `db.owner_events`, with every
    start that already ended served with the status of its end."""
    rows = db.owner_events(200)
    ended = settled(rows)
    return {
        "events": [
            {"ts": iso(row["ts"]), "kind": row["kind"], "label": row["label"],
             "status": ended.get(row["id"], row["status"])}
            for row in rows
        ]
    }


@router.get("/portal/changes")
def changes(since: int | None = None):
    """What changed since the portal last looked: the one thing it polls.

    NOTHING ON SCREEN MOVED WITHOUT A RELOAD (Luis, 2026-09-24): every tab read
    its data once and then every 30 or 60 seconds, each on its own timer, so an
    approval the agent asked for sat invisible for up to a minute and the
    sidebar's count for longer. The portal now asks this every few seconds
    while it is visible, and each tab refetches only when a kind it draws is
    in `kinds`.

    - `last` is the log's cursor: `sqlite_sequence`, not `MAX(id)`, so a
      deleted newest row never moves it back and never replays kinds.
    - `kinds` is every distinct kind written after `since`, INTERNAL ones
      included: Uso draws `turn_usage`. With no `since` (the portal's first
      ask) it is empty: that call only sets the cursor.
    - `sessions` is a stamp of the client's conversations. A conversation
      opened in another tab or a rename writes no event, and the Chat's list
      has to move the moment it happens, not when the answer lands.
    """
    seq = db.one("SELECT seq FROM sqlite_sequence WHERE name = 'events'")
    kinds = [] if since is None else [
        row["kind"] for row in db.query("SELECT DISTINCT kind FROM events WHERE id > ?", (since,))
    ]
    stamp = db.one(
        "SELECT COUNT(*) AS n, MAX(last_active) AS at, GROUP_CONCAT(title, '|') AS titles"
        " FROM (SELECT last_active, COALESCE(title, '') AS title FROM sessions"
        " WHERE kind = 'chat' ORDER BY id)"
    )
    titles = zlib.crc32((stamp["titles"] or "").encode())
    return {
        "last": seq["seq"] if seq else 0,
        "kinds": kinds,
        "sessions": f"{stamp['n']}:{stamp['at'] or 0}:{titles}",
    }


# WHAT ARCHIVOS DOES NOT LIST, because it is the agent's machinery and another
# tab already shows it. QA's second round (2026-09-23) read, in Archivos,
# `imagenes/` with every picture next to a `.json` of the same name, and the
# folders `flows`, `memoria/instagram-creator` and `memoria/main`:
#
# - an image's SIDECAR (`imagenes/2026-09-23-1.json` beside `…-1.png`, the
#   image plugin's `BRIEF`): the prompt it was drawn from, which the creator
#   reads and the owner has no use for;
# - `flows/`, which is what the Flujos tab draws;
# - a sub-agent's notebook (`memoria/<delegate>/`): what the creator noted for
#   itself. The face's own, `memoria/main/`, stays: it is what her agent
#   remembers about her, and she reads it.
#
# LISTING ONLY. `GET /portal/files/{path}` still serves every one of them by
# path — another tab, or a chat chip, may name one.
IMAGES = (".png", ".jpg", ".jpeg", ".webp", ".gif")
HIDDEN_FOLDERS = ("flows/",)
OWN_MEMORY = "memoria/main/"


def listed_in_files(path: Path, relative: str) -> bool:
    if relative.startswith(HIDDEN_FOLDERS):
        return False
    if relative.startswith("memoria/") and not relative.startswith(OWN_MEMORY):
        return False
    if path.suffix == ".json" and any(path.with_suffix(ext).is_file() for ext in IMAGES):
        return False
    return True


@router.get("/portal/files")
def files():
    root = config.WORKSPACE
    listed = []
    for path in sorted(root.rglob("*")):
        if not path.is_file() or any(part.startswith(".") for part in path.parts):
            continue
        if not listed_in_files(path, str(path.relative_to(root))):
            continue
        stat = path.stat()
        relative = str(path.relative_to(root))
        listed.append({
            "path": relative,
            "size": stat.st_size,
            # Epoch seconds: what the Files tab, Inicio and Activity read.
            "mtime": int(stat.st_mtime),
            # What the portal offers to edit: the same rule `PUT` enforces.
            "editable": editable(relative),
        })
    return {"files": listed}


# What is served as what it is. Everything else goes out as `text/plain`,
# including every type a browser would RUN — html, svg, xml, js — because this
# route is on the agent's origin and a file the agent wrote is not a page of
# ours. The portal never reads the header to decide how to draw a file: it
# names the type from the extension and builds its own Blob out of the bytes
# (`lib/agent.ts`'s `getFileBytes`), so the header is for curl and for a
# browser's sniffing, and `portal-check` asserts the text half of it.
AS_ITSELF = (
    "image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp",
    "application/pdf", "audio/", "video/", "application/zip",
    "application/vnd.openxmlformats-officedocument.", "application/vnd.ms-excel",
    "application/msword", "application/vnd.ms-powerpoint",
)
TEXT = "text/plain; charset=utf-8"


def media_type(path: Path) -> str:
    guessed = mimetypes.guess_type(path.name)[0] or ""
    return guessed if guessed.startswith(AS_ITSELF) else TEXT


@router.get("/portal/files/{path:path}")
def file_bytes(path: str):
    """The file's BYTES, never its decoded text.

    It was `read_text()`, and every PNG, PDF and spreadsheet in the workspace
    was a 500 — on the one route the Files tab's preview, its download and the
    chat's file chips all go through. A text file is the same bytes it always
    was, as `text/plain`.

    A path that is not a file inside the workspace is a 404 — a name that is
    not there and a `../` that tries to leave read the same from outside, which
    is the point. The portal reads a 404 as "not here" and a 500 as an outage.
    """
    try:
        target = under(config.WORKSPACE, path)
        found = target.is_file()
    except ValueError:
        found = False
    if not found:
        raise HTTPException(404, NO_FILE.format(path=path))
    # `nosniff`: a `text/plain` the browser decides is html after all is the
    # one thing the fallback above exists to stop.
    return FileResponse(
        target, media_type=media_type(target), headers={"X-Content-Type-Options": "nosniff"}
    )


# WHAT THE OWNER MAY EDIT FROM ARCHIVOS, and nothing else. Her own uploads
# (`entrada/`, where `/portal/upload` puts them) and the files the agent writes
# FOR her to correct — the business draft, whose note says «corregí lo que no
# sea así» and which QA could not correct (2026-09-23). Everything else is the
# agent's work: a deliverable edited behind its back is a file that no longer
# says what the agent thinks it said, and memory or flows edited by hand are
# the agent's state changed with nobody noticing. A new file joins by name here.
EDITABLE_PREFIXES = ("entrada/",)
EDITABLE_FILES = ("negocio/borrador.md",)
NOT_EDITABLE = "{path} es de tu agente: desde acá se puede leer, no editar."
NOT_TEXT = "{path} no es un archivo de texto: descargalo y editalo con su programa."


def editable(relative: str) -> bool:
    return relative in EDITABLE_FILES or relative.startswith(EDITABLE_PREFIXES)


@router.put("/portal/files/{path:path}")
async def edit_file(path: str, request: Request):
    """The owner's edit of a text file, raw UTF-8 body, replacing it whole.

    Only a file that is already there (this edits, it does not create: new
    files come in through `/portal/upload`), that `editable` allows, and whose
    old and new contents are both text — an .xlsx in `entrada/` saved as text
    would be a broken spreadsheet. The rule is read on the RESOLVED path, so a
    `../` or a symlink out of `entrada/` is judged by where it lands.

    NO STAMP ON THE FILE. What she saved is what she reads back: the endpoint
    does not rewrite the draft's note to «corregido por vos», because a line
    she did not type appearing in her own edit is a surprise, and the face
    already reads everything in the draft as possibly hers (`instructions.md`).
    """
    try:
        target = under(config.WORKSPACE, path)
    except ValueError:
        raise HTTPException(404, NO_FILE.format(path=path)) from None
    if not target.is_file():
        raise HTTPException(404, NO_FILE.format(path=path))
    relative = str(target.relative_to(config.WORKSPACE.resolve()))
    if not editable(relative):
        raise HTTPException(403, NOT_EDITABLE.format(path=relative))
    try:
        target.read_bytes().decode("utf-8")
        text = (await request.body()).decode("utf-8")
    except UnicodeDecodeError:
        raise HTTPException(400, NOT_TEXT.format(path=relative)) from None
    target.write_text(text)
    return {"ok": True, "path": relative, "bytes": len(text.encode())}


@router.post("/portal/upload")
async def upload(request: Request):
    payload = await request.json()
    # `validate=True` on purpose: without it b64decode drops whatever is not an
    # alphabet character and writes a file out of the remains, so a truncated
    # upload lands as a plausible-looking corrupt file instead of a 400.
    try:
        blob = base64.b64decode(payload["content_b64"], validate=True)
    except binascii.Error:
        raise HTTPException(400, BAD_UPLOAD) from None
    target = under(config.WORKSPACE / "entrada", Path(payload["name"]).name)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(blob)
    # No event: Activity derives the file rows from `/portal/files` itself
    # (`app/app/activity/page.tsx`), and a second row would be the same fact twice.
    return {"ok": True, "path": str(target.relative_to(config.WORKSPACE)), "bytes": len(blob)}
