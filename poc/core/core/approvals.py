"""The approval thread: one row with a stable id, from the pause to the end.

An approval is not a yes/no flag, it is a negotiation. The engine stops at a
gated tool and writes the row; the client rejects with a reason and the agent
proposes again ON THE SAME ROW; the client approves, maybe with a correction,
and the tool finally runs with the correction in its arguments. The row only
leaves the queue when the agent stops asking.

Two things live here that nothing else can do:

- THE ROW CARRIES ITS OWN HISTORY. The message list the resumed run replays is
  on the row, not on the session, because a history that ends in an unanswered
  tool call is not replayable by the next chat turn. It is also what makes the
  pause survive a restart: the row has the messages AND the serialized
  `DeferredToolRequests` (tool call ids, names and arguments), so approving
  after `docker kill` resumes exactly where the gate stopped.
- THE CLIENT'S WORDS ARE STORED AS A COMMENT SIGNED `cliente` before the agent
  is resumed, in the shape `app/app/lib/agent.ts` parses (`readComment`), so
  the portal shows her what she said and not the instruction the code wrapped
  it in.
"""

import secrets
import time
from dataclasses import dataclass

from fastapi import HTTPException
from pydantic import TypeAdapter
from pydantic_ai import DeferredToolRequests, DeferredToolResults, ToolApproved, ToolDenied
from pydantic_ai.messages import ModelMessagesTypeAdapter

from . import db, render

REQUESTS = TypeAdapter(DeferredToolRequests)

AGENT = "agente"
CLIENT = "cliente"

PENDING = "pending"
# Where a row sits while its resumed run is in flight. It is off the queue and
# nothing can act on it, and a crash mid-run leaves it HERE and not back in
# `pending`: the tool may already have run, and a second click is not how the
# client should find that out.
RESOLVING = "resolving"

# The instruction the model reads on a "no". The client's own words travel
# inside it; the portal strips the wrapper before showing them to her.
DENIED = (
    "El cliente RECHAZÓ el pedido. Motivo, con sus palabras: «{reason}»"
    " Corregí eso y volvé a pedirle la aprobación con la misma herramienta."
)
DENIED_FINAL = (
    "El cliente RECHAZÓ el pedido. Motivo, con sus palabras: «{reason}»"
    " No lo vuelvas a proponer."
)
# The client's side of the same two moments, the way `readComment` reads it.
REJECTION = (
    "RECHAZADO POR TU CLIENTE. No hagas lo que pediste aprobar, ni algo parecido.\n"
    "Motivo, con sus palabras: «{reason}»"
)
CORRECTION = "Aprobado CON CORRECCIONES. Tu versión: {correction}"
APPROVED = "Aprobado desde el portal"

# The two refusals the client can read. In Spanish: the portal shows what comes
# back in `error.message` on the card she just clicked.
MISSING = "No existe el pedido {approval_id}."
ALREADY = (
    "Ese pedido ya no está esperando tu respuesta: o lo resolviste, o el agente"
    " lo está resolviendo ahora. Recargá Aprobaciones para ver cómo terminó."
)


@dataclass
class Outcome:
    """What the resumed run left behind: an answer, or another request."""

    text: str
    pending: bool


def comment(approval_id: str, author: str, body: str) -> None:
    db.write(
        "INSERT INTO approval_comments (approval_id, author, body, created_at)"
        " VALUES (?, ?, ?, ?)",
        (approval_id, author, body, time.time()),
    )


def row_of(approval_id: str):
    return db.one("SELECT * FROM approvals WHERE id = ?", (approval_id,))


def record_pending(
    session_id: str,
    requests: DeferredToolRequests,
    history: str,
    continues: str | None = None,
) -> str:
    """The row for a run that stopped at the gate.

    `continues` is the row whose resumed run made this proposal, and it is THE
    ONLY way a row is reused. A rejection the agent answers with another
    proposal is the same request, not a new one, and reusing the row is what
    keeps the queue from growing by one card every time the client says no —
    but a proposal from a FRESH turn is a different request, even on the same
    conversation. Reusing the session's open row for it overwrote the card the
    client was about to approve with something she had never seen, and her yes
    then ran the other thing.

    The re-proposal puts the row back in `pending` with the NEW tool call ids;
    the ones the previous proposal carried are gone from the row, and since
    approve and reject resume from the row, they can never be resumed again.
    """
    call = requests.approvals[0]
    args = call.args_as_dict()
    title = render.approval_title(call.tool_name, args)
    body = render.approval_body(call.tool_name, args)
    open_row = db.one("SELECT id FROM approvals WHERE id = ?", (continues,)) if continues else None
    blob = REQUESTS.dump_json(requests).decode()
    now = time.time()
    if open_row:
        approval_id = open_row["id"]
        db.write(
            "UPDATE approvals SET status = ?, decision = NULL, title = ?, summary = ?,"
            " body = ?, tool_name = ?, requests = ?, history = ?, updated_at = ?"
            " WHERE id = ?",
            (PENDING, title, render.approval_summary(args), body, call.tool_name, blob,
             history, now, approval_id),
        )
        kind, label = "approval_reproposed", f"Te propuse otra versión: {title}"
    else:
        approval_id = f"apr_{secrets.token_hex(6)}"
        db.write(
            "INSERT INTO approvals (id, session_id, status, title, summary, body,"
            " tool_name, requests, history, created_at, updated_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (approval_id, session_id, PENDING, title, render.approval_summary(args), body,
             call.tool_name, blob, history, now, now),
        )
        kind, label = "approval_requested", f"Te pedí permiso: {title}"
    comment(approval_id, AGENT, body)
    db.append_event(kind, label, "pendiente", session_id, {"approval_id": approval_id})
    return approval_id


def list_pending() -> list[dict]:
    return [
        {
            "id": row["id"],
            "title": row["title"],
            "summary": row["summary"],
            "body": row["body"],
            "created_at": int(row["created_at"]),
            "status": row["status"],
        }
        for row in db.query(
            "SELECT * FROM approvals WHERE status = ? ORDER BY created_at", (PENDING,)
        )
    ]


def detail(approval_id: str) -> dict | None:
    """The ticket shape the portal reads a request's thread from."""
    row = row_of(approval_id)
    if row is None:
        return None
    comments = db.query(
        "SELECT author, body, created_at FROM approval_comments WHERE approval_id = ?"
        " ORDER BY id",
        (approval_id,),
    )
    return {
        "ticket": {
            "id": row["id"],
            "title": row["title"],
            "body": row["body"],
            "status": "blocked" if row["status"] == PENDING else "done",
            "tenant": None,
            "assignee": None,
            "created_at": int(row["created_at"]),
        },
        "outcome": None,
        "comments": [
            {"author": c["author"], "body": c["body"], "created_at": int(c["created_at"])}
            for c in comments
        ],
        "events": [],
    }


async def resume(row, results: DeferredToolResults, closed_status: str) -> Outcome:
    """Run the rest of the turn with the client's answer in its hands."""
    from . import session

    history = ModelMessagesTypeAdapter.validate_json(row["history"])
    resumed = await session.run_resumed(row["session_id"], history, results)
    if resumed.requests is not None:
        # It asked again. Same row, new body, new tool call id: the negotiation
        # continues where the client is already looking. The row is named
        # explicitly because it is no longer the session's pending one — it is
        # `resolving` until this run says how it ended.
        record_pending(row["session_id"], resumed.requests, resumed.history, row["id"])
        return Outcome("", True)
    comment(row["id"], AGENT, resumed.text)
    db.write(
        "UPDATE approvals SET status = ?, updated_at = ? WHERE id = ?",
        (closed_status, time.time(), row["id"]),
    )
    return Outcome(resumed.text, False)


def claim(approval_id: str, decision: str):
    """The row this decision is allowed to act on, taken out of the queue first.

    Approve and reject both resume a run with a real side effect at the end of
    it, so the row has to leave `pending` BEFORE the run starts and not after
    it finishes. Two clicks on the same card sent the mail twice; a crash
    between the tool running and the row being updated left the row `pending`
    with the mail already sent, and the retry sent a second one.

    Read and write with no `await` between them, so nothing else on the loop
    gets in the middle.
    """
    row = row_of(approval_id)
    if row is None:
        raise HTTPException(404, MISSING.format(approval_id=approval_id))
    if row["status"] != PENDING:
        raise HTTPException(409, ALREADY)
    db.write(
        "UPDATE approvals SET status = ?, decision = ?, updated_at = ? WHERE id = ?",
        (RESOLVING, decision, time.time(), approval_id),
    )
    return row


async def approve(approval_id: str, correction: str | None = None) -> dict:
    row = claim(approval_id, "approve")
    requests = REQUESTS.validate_json(row["requests"])
    comment(approval_id, CLIENT,
            CORRECTION.format(correction=correction) if correction else APPROVED)
    db.append_event(
        "approval_approved", f"Aprobaste: {row['title']}", "completado",
        row["session_id"], {"approval_id": approval_id, "corrected": bool(correction)},
    )
    # `override_args` REPLACES the model's arguments, so the merge is ours: the
    # client corrects the action, she does not rewrite it.
    results = DeferredToolResults(approvals={
        call.tool_call_id: ToolApproved(
            override_args={**call.args_as_dict(), "client_correction": correction}
            if correction else None
        )
        for call in requests.approvals
    })
    await resume(row, results, "approved")
    return {"ok": True}


async def reject(approval_id: str, reason: str, final: bool = False) -> dict:
    """Rejecting is answering, not closing.

    The row leaves the queue only while the resumed run is in flight: the agent
    proposes again ON IT and it goes back to `pending`. Only `final` ends the
    thread, and only because the client said she does not want it at all.
    """
    row = claim(approval_id, "reject")
    requests = REQUESTS.validate_json(row["requests"])
    comment(approval_id, CLIENT, REJECTION.format(reason=reason))
    db.append_event(
        "approval_rejected", f"Rechazaste: {row['title']}", "rechazado",
        row["session_id"], {"approval_id": approval_id, "final": final},
    )
    template = DENIED_FINAL if final else DENIED
    results = DeferredToolResults(approvals={
        call.tool_call_id: ToolDenied(template.format(reason=reason))
        for call in requests.approvals
    })
    outcome = await resume(row, results, "rejected")
    still_pending = outcome.pending and not final
    if final and outcome.pending:
        db.write(
            "UPDATE approvals SET status = 'rejected', updated_at = ? WHERE id = ?",
            (time.time(), approval_id),
        )
    return {
        "ok": True,
        "status": "blocked" if still_pending else "done",
        # Rejecting never spends the unblock: that is the whole lesson the
        # portal's `doReject` is written around.
        "unblocked": False,
        "closed": final,
        "in_approvals": still_pending,
        "notified": True,
        "block_recurrences": None,
    }
