"""The Approvals tab: the queue, the thread, and the client's two verbs.

Approve and reject answer AFTER the resumed run finished. It blocks the
request for as long as the model takes, and for the engine that is the right
trade: the portal reloads the queue the moment the call returns, and what it
reads is the outcome — the tool ran, or the agent proposed again — instead of
a row that is still what it was a second ago.
"""

import json

from fastapi import APIRouter, HTTPException, Request

import store

router = APIRouter()


async def payload(request: Request) -> dict:
    """The portal sends NO body when there is nothing to say (`lib/agent.ts`
    posts `undefined` when there is no correction), and an empty body is not
    JSON."""
    raw = await request.body()
    return json.loads(raw) if raw else {}


@router.get("/portal/approvals")
def pending():
    return {"approvals": store.list_pending()}


@router.get("/portal/tickets/{ticket_id}")
def ticket(ticket_id: str):
    found = store.detail(ticket_id)
    if found is None:
        raise HTTPException(404, f"there is no request {ticket_id}")
    return found


@router.post("/portal/approvals/{approval_id}/approve")
async def approve(approval_id: str, request: Request):
    body = await payload(request)
    return await store.approve(approval_id, body.get("correction"))


@router.post("/portal/approvals/{approval_id}/reject")
async def reject(approval_id: str, request: Request):
    body = await payload(request)
    return await store.reject(approval_id, body["reason"], bool(body.get("final")))
