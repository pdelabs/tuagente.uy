"""The routes: the bridge's webhook, and what the portal's WhatsApp screens call.

`POST /internal/whatsapp/events` IS THE BRIDGE'S, NOT THE PORTAL'S. It checks the
bridge's token (`X-Bridge-Token`, generated per boot by the entrypoint), and it
is not something a browser can call: the preflight allows `Authorization` and
`Content-Type` only (`engine/server/app.py`), so a page cannot send the token
header at all. Like every plugin route it is also behind the client's key, which
the bridge — same container, same env — sends.

`/portal/whatsapp/*` IS THE PORTAL CONTRACT, and most of it is the bridge's own
answer passed through, because the bridge is where the number lives:

    GET    /portal/whatsapp/status             {state, phone, push_name, since, last_error}
    POST   /portal/whatsapp/pairing            {state}
    GET    /portal/whatsapp/pairing            {state, qr_png, expires_at}
    DELETE /portal/whatsapp/pairing            {ok}
    POST   /portal/whatsapp/logout             {ok}
    GET    /portal/whatsapp/avatar/{jid}       the picture's bytes, or 204
    GET    /portal/whatsapp/chats/{jid}        {jid, phone, name, taken_over_until}
    POST   /portal/whatsapp/chats/{jid}/resume {ok}

Every time is epoch SECONDS. A refusal from the bridge keeps its status (409 a
number already linked, 404 no pairing yet, 429 WhatsApp asked us to slow down,
503 not connected) and a bridge that does not answer is 502, all in the
`{error: {message}}` shape the portal reads.
"""

import hmac

from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import Response

import wa_bridge
import wa_store
import wa_tools
from core import scheduler

router = APIRouter()

STATUS_KEYS = ("state", "phone", "push_name", "since", "last_error")
PAIRING_KEYS = ("state", "qr_png", "expires_at")


def bridged(method: str, path: str, body: dict | None = None):
    try:
        return wa_bridge.call(method, path, body)
    except wa_bridge.BridgeError as exc:
        raise HTTPException(exc.status, str(exc)) from exc


@router.post("/internal/whatsapp/events")
async def events(request: Request, x_bridge_token: str = Header(default="")):
    """One event from the bridge. Async on purpose: the poke has to happen on
    the engine's loop, where the scheduler lives."""
    if not hmac.compare_digest(x_bridge_token, wa_bridge.token()):
        raise HTTPException(401, "not the bridge")
    if wa_tools.ingest(await request.json()):
        scheduler.poke(wa_tools.WATCHER)
    return {"ok": True}


@router.get("/portal/whatsapp/status")
def status():
    found = bridged("GET", "/status").json()
    return {key: found.get(key) for key in STATUS_KEYS}


@router.post("/portal/whatsapp/pairing")
def start_pairing():
    return {"state": bridged("POST", "/pairing").json()["state"]}


@router.get("/portal/whatsapp/pairing")
def pairing():
    found = bridged("GET", "/pairing").json()
    return {key: found.get(key) for key in PAIRING_KEYS}


@router.delete("/portal/whatsapp/pairing")
def cancel_pairing():
    bridged("DELETE", "/pairing")
    return {"ok": True}


@router.post("/portal/whatsapp/logout")
def logout():
    bridged("POST", "/logout")
    return {"ok": True}


@router.get("/portal/whatsapp/avatar/{jid}")
def avatar(jid: str):
    found = bridged("GET", f"/contacts/{jid}/avatar")
    if found.status_code == 204:
        return Response(status_code=204)
    return Response(found.content, media_type=found.headers.get("content-type", "image/jpeg"),
                    headers={"Cache-Control": "private, max-age=86400"})


def chat_or_404(jid: str):
    row = wa_store.chat(jid)
    if row is None:
        raise HTTPException(404, f"no WhatsApp chat {jid}")
    return row


@router.get("/portal/whatsapp/chats/{jid}")
def chat(jid: str):
    row = chat_or_404(jid)
    return {"jid": row["jid"], "phone": row["phone"], **{
        key: value for key, value in wa_tools.ticket_extra(jid).items() if key != "phone"}}


@router.post("/portal/whatsapp/chats/{jid}/resume")
async def resume(jid: str):
    chat_or_404(jid)
    if wa_tools.resume(jid):
        scheduler.poke(wa_tools.WATCHER)
    return {"ok": True}
