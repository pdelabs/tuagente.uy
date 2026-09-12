"""What the portal calls the `endpoint` base: Hermes's native gateway surface."""

from fastapi import APIRouter, Request

from core import db

router = APIRouter()


@router.get("/api/sessions")
def sessions():
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
    db.rename_session(session_id, (await request.json())["title"])
    return {"ok": True}


@router.get("/api/jobs")
def jobs():
    """No cron in the POC. The portal hits it anyway and so does portal-check."""
    return {"jobs": []}
