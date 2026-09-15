"""What the client reads when the engine stops at a gated tool.

The model supplies the words (the `ApprovalNote` on the tool call); the code
supplies the format. Every request the client sees has the same four sections
and the content to review underneath, whatever the tool did — the same shape
`../skills/approval/format_request.py` prints, which is the one
`app/app/approvals/page.tsx` already knows how to draw. The table
is load-bearing: `looksLikeProposal()` in the portal recognizes a proposal by
a markdown table row, and that is how the card shows the LAST proposal of a
negotiation instead of the one the client already rejected.

Everything this module returns is read by the client, so it is all in Spanish.

ANOTHER PLUGIN'S TOOL DRAWS ITS OWN CARD. The four sections above are this
plugin's and never move; what goes UNDER them is the thing being approved, and
only the plugin that owns the tool knows what that is — the social plugin's
`publish_instagram` takes one post id, and a card built from its arguments
would say nothing about the pictures and the caption about to go out. So a
plugin may hand over a renderer for one tool, by name:

    engine.provide("approval.render.publish_instagram", publishing.card)

and it is called here with the tool's arguments, answering `(title, content)`,
both in Spanish. `provide`/`use` is `core/plugins.py`'s own mechanism for one
plugin offering something to another, and it is read at RENDER time and not at
registration: the plugin that provides a renderer loads AFTER this one — a gate
with no tools to gate would be a strange thing to load first — so at
`register()` there is nothing to read yet. `SHARED` is the engine's own dict,
bound once, and it fills up as the other plugins register.
"""

# The engine's shared objects, bound by `plugin.register`. Empty until then,
# which is also what an engine with only this plugin looks like.
SHARED: dict = {}

# What a renderer is filed under. One per tool name.
RENDERER = "approval.render."

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


def drawn_by(tool_name: str, args: dict) -> tuple[str, str] | None:
    """The card another plugin draws for its own tool, or `None` for ours."""
    renderer = SHARED.get(RENDERER + tool_name)
    return renderer(args) if renderer else None


def approval_title(tool_name: str, args: dict) -> str:
    if tool_name == "send_email":
        return flat(f"Mail a {args['to']}: {args['subject']}")[:120]
    theirs = drawn_by(tool_name, args)
    if theirs:
        return flat(theirs[0])[:120]
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
    theirs = drawn_by(tool_name, args)
    if theirs:
        return theirs[1]
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


# WHO ASKED. A request that arrives while nobody is typing has no
# conversation around it to explain itself: the client opens Aprobaciones in
# the morning and finds a mail to send with no idea what asked for it. The
# flow's name is the answer, and it is the code's to write — asking the model
# to mention it in its `note` is the convention that always ends up forgotten.
def flow_title(name: str, title: str) -> str:
    return flat(f"Flujo «{name}»: {title}")[:120]


def flow_body(name: str, body: str) -> str:
    return f"Lo pidió el flujo «{name}».\n\n{body}"


def pause_message(title: str) -> str:
    """What the chat says when a run stops. Written by the code, not the model:
    the client has to read the same sentence every time this happens."""
    return (
        f"Te dejé un pedido en Aprobaciones: {title}. "
        "Cuando lo apruebes o lo rechaces, sigo desde ahí."
    )
