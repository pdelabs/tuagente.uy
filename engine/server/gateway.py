"""What the portal calls the `endpoint` base (`/api/*`): the client's
conversations — list, read, rename, delete.

The same app answers the `adapter` base (`/portal/*`, `server/portal.py`); the
two bases are one container on two ports, and the split is only the portal's
(`lib/agent.ts`'s `endpoint` and `adapter`). The flows' tasks, `/api/jobs*`,
live with the flows in `server/flows.py`.
"""

from fastapi import APIRouter, HTTPException, Request

from core import db

router = APIRouter()

# Read by the client: the portal puts what comes back in `error.message` on the
# screen where she was working.
NO_TITLE = "Falta el nombre nuevo de la conversación."


@router.get("/api/sessions")
def sessions():
    """The conversations the client started. The runs of a flow are not here:
    each is opened from its flow (`/portal/flows/{slug}`, `runs`)."""
    return {
        "data": [
            {
                "id": row["id"],
                # `api_server` is what `lib/events.ts` counts as a human
                # conversation; any other value hides it from Chat and Activity.
                "source": row["source"],
                "title": row["title"],
                "preview": row["preview"],
                "message_count": row["message_count"],
                "started_at": int(row["created_at"]),
                "last_active": int(row["last_active"]),
            }
            for row in db.sessions()
        ]
    }


@router.get("/api/sessions/{session_id}/messages")
def messages(session_id: str):
    return {
        # What the conversation is called, for the one the portal opens WITHOUT
        # having it in its list: a flow's run, reached from the flow's page.
        "title": db.session_title(session_id),
        "data": [
            {"id": str(row["id"]), "role": row["role"], "content": row["content"]}
            for row in db.messages(session_id)
        ]
    }


@router.delete("/api/sessions/{session_id}")
def delete(session_id: str):
    db.delete_session(session_id)
    return {"ok": True}


@router.patch("/api/sessions/{session_id}")
async def rename(session_id: str, request: Request):
    title = (await request.json()).get("title")
    if title is None:
        raise HTTPException(400, NO_TITLE)
    db.rename_session(session_id, title)
    return {"ok": True}
