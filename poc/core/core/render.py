"""What the client reads when the engine stops at a gated tool.

The model supplies the words (the `ApprovalNote` on the tool call); the code
supplies the format. Every request the client sees has the same four sections
and the content to review underneath, whatever the tool did — the same shape
`hermes-kit/plugins/approval/skills/approval/format_request.py` prints, which
is the one `app/app/approvals/page.tsx` already knows how to draw. The table
is load-bearing: `looksLikeProposal()` in the portal recognizes a proposal by
a markdown table row, and that is how the card shows the LAST proposal of a
negotiation instead of the one the client already rejected.

Everything this module returns is read by the client, so it is all in Spanish.
"""

BODY = """**Qué quiero hacer:** {what}

| | |
|---|---|
| Si aprobás | {if_approved} |
| Si rechazás | {if_rejected} |
| Por qué | {why} |

---

{content}
"""


def flat(text: str) -> str:
    """One line. A line break inside a markdown table cell breaks the table."""
    return " ".join(str(text).split())


def quoted(text: str) -> str:
    return "\n".join(f"> {line}" if line.strip() else ">" for line in text.strip().splitlines())


def approval_title(tool_name: str, args: dict) -> str:
    if tool_name == "send_email":
        return flat(f"Mail a {args['to']}: {args['subject']}")[:120]
    if tool_name == "publish_post":
        return flat(f"Publicación en {args['channel']}")[:120]
    return tool_name


def approval_summary(args: dict) -> str:
    return flat(args["note"]["what"])[:200]


def content(tool_name: str, args: dict) -> str:
    if tool_name == "send_email":
        return (
            f"**Para:** {args['to']}\n\n"
            f"**Asunto:** {args['subject']}\n\n"
            f"{quoted(args['body'])}"
        )
    if tool_name == "publish_post":
        return f"**Canal:** {args['channel']}\n\n{quoted(args['text'])}"
    return quoted(str(args))


def approval_body(tool_name: str, args: dict) -> str:
    note = args["note"]
    return BODY.format(
        what=flat(note["what"]),
        if_approved=flat(note["if_approved"]),
        if_rejected=flat(note["if_rejected"]),
        why=flat(note["why"]),
        content=content(tool_name, args),
    )


def pause_message(title: str) -> str:
    """What the chat says when a run stops. Written by the code, not the model:
    the client has to read the same sentence every time this happens."""
    return (
        f"Te dejé un pedido en Aprobaciones: {title}. "
        "Cuando lo apruebes o lo rechaces, sigo desde ahí."
    )
