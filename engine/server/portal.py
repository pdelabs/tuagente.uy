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


@router.get("/portal/files")
def files():
    root = config.WORKSPACE
    listed = []
    for path in sorted(root.rglob("*")):
        if not path.is_file() or any(part.startswith(".") for part in path.parts):
            continue
        stat = path.stat()
        listed.append({
            "path": str(path.relative_to(root)),
            "size": stat.st_size,
            # Epoch seconds: what the Files tab, Inicio and Activity read.
            "mtime": int(stat.st_mtime),
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
