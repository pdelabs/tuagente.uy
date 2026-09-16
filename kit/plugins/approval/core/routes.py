"""The Approvals tab: the queue and the client's two verbs.

THE THREAD IS NOT A ROUTE OF THIS PLUGIN ANY MORE. The portal opens a request
with `getTicketDetail(approvalId)` — `/portal/tickets/{id}`, the board's path —
and this router used to answer it because there was no board. There is one now
(`kit/plugins/kanban/core/`), two routers cannot answer the same path, and
whichever `CORE_PLUGINS` registers first silently wins. So `store.detail` is
handed to the board through `engine.provide` and the board asks for it when an
id is not one of its own (`plugin.py`).

Approve and reject answer AFTER the resumed run finished. It blocks the
request for as long as the model takes, and for the engine that is the right
trade: the portal reloads the queue the moment the call returns, and what it
reads is the outcome — the tool ran, or the agent proposed again — instead of
a row that is still what it was a second ago.
"""

import json

from fastapi import APIRouter, Request

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


@router.post("/portal/approvals/{approval_id}/approve")
async def approve(approval_id: str, request: Request):
    body = await payload(request)
    return await store.approve(approval_id, body.get("correction"))


@router.post("/portal/approvals/{approval_id}/reject")
async def reject(approval_id: str, request: Request):
    body = await payload(request)
    return await store.reject(approval_id, body["reason"], bool(body.get("final")))
