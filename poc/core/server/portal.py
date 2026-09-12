"""What the portal calls the `adapter` base: everything the native gateway
does not expose.

Wave 2 adds `/portal/approvals*` and `/portal/tickets/{id}` here, Wave 3
`/portal/usage` and `/portal/inventory`, and each flips its module in
`core.config.MODULES`.
"""

import base64
import binascii
import json
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import PlainTextResponse, StreamingResponse

from core import config, db, session
from core.tools.workspace import under

from . import sse

router = APIRouter()

# The agent dir is a read-only mount (the SOUL and the seed identity), so what
# the client changes from the portal lands in /state and wins when it is there.
IDENTITY_SEED = config.AGENT_DIR / "identity.json"
IDENTITY_LIVE = config.STATE_DIR / "identity.json"

# Read by the client: the portal shows `error.message` on the tab she is on.
NO_FILE = "No hay ningún archivo {path} en el espacio de trabajo."
BAD_UPLOAD = "No pude leer el archivo: lo que llegó no es base64."


def identity() -> dict:
    return json.loads((IDENTITY_LIVE if IDENTITY_LIVE.exists() else IDENTITY_SEED).read_text())


def iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, ZoneInfo(config.TIMEZONE)).isoformat()


@router.get("/portal/manifest")
def manifest():
    who = identity()
    return {
        "agent": who["name"],
        "adapter_version": config.ADAPTER_VERSION,
        "modules": config.MODULES,
        "named": bool(who.get("name")),
        "look": who.get("look"),
        "company": who.get("company"),
        "notify_channel": who.get("contact", {}).get("channel"),
        "telegram_bot": None,
        "timezone": config.TIMEZONE,
    }


@router.post("/portal/identity")
async def save_identity(request: Request):
    who = identity() | await request.json()
    IDENTITY_LIVE.write_text(json.dumps(who, ensure_ascii=False))
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
    events = session.run_turn(session_id, messages[-1]["content"])
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
    events = session.run_turn(session_id, message)
    return StreamingResponse(
        sse.session_dialect(events, session_id),
        media_type="text/event-stream",
        headers=sse.HEADERS,
    )


# ── the rest of the tabs ────────────────────────────────────────────────────

@router.get("/portal/tickets")
def tickets():
    """No board in the POC: approvals are on the tool, not on a ticket."""
    return {"tickets": []}


@router.get("/portal/activity")
def activity():
    return {
        "events": [
            {"ts": iso(row["ts"]), "kind": row["kind"], "label": row["label"], "status": row["status"]}
            for row in db.recent_events(200)
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
            # `mtime` in epoch seconds is what `app/app/files/page.tsx` reads;
            # `modified` is the name the plan's table uses. Both travel.
            "mtime": int(stat.st_mtime),
            "modified": iso(stat.st_mtime),
        })
    return {"files": listed}


@router.get("/portal/files/{path:path}")
def file_text(path: str):
    """A path that is not a file inside the workspace is a 404 — a name that is
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
    return PlainTextResponse(target.read_text(), media_type="text/plain; charset=utf-8")


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
