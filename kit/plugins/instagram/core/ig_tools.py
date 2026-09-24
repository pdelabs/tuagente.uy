"""The tools: read the comments, answer one, hide one, and keep the token alive.

WHAT IS GATED AND WHAT IS NOT. Until 24/9/2026 everything that went out was:
`reply_comment`, `send_message` and `hide_comment` all stopped the run for the
client's yes. Luis decided that day that AN ANSWER GOES OUT DIRECTLY — a
comment or a message is a person waiting, Meta gives a DM 24 hours, and a reply
that sits in Aprobaciones until the owner looks is the lead going cold. So the
two answering tools are plain tools on the face, and what used to be the gate's
work is the tool's own now: the Activity line with the words that went out,
the ticket closed with them, the 24-hour clock checked before sending.
`hide_comment` is still gated — it is not an answer, it takes something the
person wrote out of sight — and it is the one card this plugin still draws.

WHAT KEEPS AN ANSWER FROM BEING A MISTAKE IS NOW THE SKILL, NOT THE CLIENT:
`skills/comments/SKILL.md` says which comment gets an answer, which gets
nothing, which gets hidden, and which one is NOT the agent's to answer (a price
the brand does not publish, a complaint, a refund, anything it is not sure of)
and goes to the owner on the board instead. What code CAN hold, it holds: a
comment is answered once (`ALREADY`), our own comments carry no id and are never
in `instagram_seen`, so there is nothing of ours to answer.

THE HIDE CARD IS DRAWN HERE AND NOT BY THE APPROVAL PLUGIN. A card built from a
comment id would say nothing about what is being hidden, so this plugin hands
the gate a renderer — `engine.provide("approval.render.hide_comment",
hide_card)`, the mechanism `core/plugins.py` already has — and the renderer
reads the comment out of `instagram_seen` and the post out of `posteos/`. READ
OFF DISK, NEVER OFF THE GRAPH: the card is rendered inside the pause path, and
a network call there is a turn that dies holding a request the client never
sees.

**THE PERSON IS THE UNIT, NOT THE MESSAGE**, and that rule was bought on
16/9/2026 with a real conversation on our own account. `fetch_messages` handed
back only what was new — «hola buenas leyeron mi mensaje?» — so the agent
answered «sí, vimos tu mensaje» and asked its qualifying question, without ever
answering the one two messages up («quería saber más de qué es lo que hacen»).
Everything it needed was on the ticket and nothing made it read it. So a tick
now hands back the WHOLE THREAD of every conversation that has something new —
ours marked «Vos», the new ones marked «(nuevo)», the ticket named when there is
one — and the same for a comment: its post, its parent and the replies already
under it. What is NEW is a fact about a row; what to answer is a fact about a
conversation, and the model cannot be asked to go and find it.

WHY `import board_store` AND NOT `engine.use`. `provide`/`use` exists because
plugin modules share one `sys.modules` namespace and a `store.py` here would BE
another plugin's `store` (`core/plugins.py`). `board_store` carries its prefix
for exactly that reason — it is unique across `kit/plugins` — and `kanban` is in
this plugin's `requires.plugins`, which is what orders the load. It is the same
import the `mail` plugin makes, for the same one-line need: the ticket a thread
already has.
"""

import json
import time
from datetime import datetime
from zoneinfo import ZoneInfo

from pydantic import BaseModel, Field
from pydantic_ai import ModelRetry, RunContext
from pydantic_ai.toolsets import FunctionToolset

import board_store as board
import ig_graph
import ig_store
from core import config, db, scheduler

# The one tool name the approval plugin looks a card up by.
HIDE = "hide_comment"

# How much of the feed a tick looks at. Ten posts is more than a fortnight of
# a client posting every day, and a comment older than that is not news.
FEED = 10

# How many posts the creator reads the numbers of before writing.
PERFORMANCE = 10

# WHAT THIS PLUGIN CALLS ITSELF ON THE BOARD. A comment's ticket is keyed by the
# comment; a conversation's by the conversation, because a thread is one person
# and one ticket, and the second message of the same person is not a second lead.
FROM_COMMENT = "instagram"
FROM_DM = "instagram-dm"

# How many message threads a tick looks at, and how much of one is shown in the
# listing a tick comes back with. TEN AND NOT SIX: what the agent answers is a
# conversation, and it cannot answer one it only sees half of.
THREADS = 50
SHOWN = 10

# Read by the client, or by the model on her behalf. Spanish, all of it.
NOTHING_NEW = "Sin comentarios nuevos."
UNKNOWN = (
    "No tengo ningún comentario {comment_id}. Los que puedo contestar son los que "
    "te trajo `fetch_comments` en esta corrida o en una anterior."
)
REPLIED = "Contesté el comentario de @{username}. Ya salió: está publicado abajo del comentario."
# ONE ANSWER PER COMMENT, held by code: with no one reading the reply before it
# goes out, a turn that calls the tool twice for the same id — a retry, a
# resumed run, a second look at the same thread — is two public answers under
# one comment. What the person writes BACK is a new comment with its own id,
# so a conversation under a post is still possible; answering the same line
# twice is not.
ALREADY = (
    "Ese comentario ya lo contestaste: «{text}». No salió nada. Si la persona "
    "volvió a escribir, lo nuevo es otro comentario, con su propio id."
)
HIDDEN = "Oculté el comentario de @{username}. Lo sigue viendo quien lo escribió y nadie más."
FAILED_REPLY = "No pude contestar el comentario: {reason}. No salió nada."
FAILED_HIDE = "No pude ocultar el comentario: {reason}. Sigue visible."
FRESH = "El token de Instagram está al día: le quedan {days} días."
RENEWED = "Renové el token de Instagram: vuelve a durar {days} días."
NO_MESSAGES = "Sin mensajes nuevos."
NO_THREAD = (
    "No tengo ninguna conversación {conversation_id}. Las que puedo contestar son las "
    "que te trajo `fetch_messages`."
)
SENT = "Le respondí a @{username} por Instagram. Ya le llegó."
FAILED_SEND = "No pude mandarle el mensaje a @{username}: {reason}. No salió nada."
# META'S CLOCK, NOT OURS, and the sentence says what to do instead: a message
# that cannot be sent is still a person waiting, and the board is where she goes.
CLOSED = (
    "Se pasaron las 24 horas desde el último mensaje de @{username}, y después de eso "
    "Instagram no deja contestar hasta que vuelva a escribir. No mandé nada: si hace "
    "falta seguirlo, dejalo en el tablero."
)
OPEN = "Quedan {hours} h del plazo para contestarle"
CLOSING = "El plazo para contestarle YA VENCIÓ (Instagram da 24 h desde su último mensaje)"

# The events the client reads in Activity. The label is written by the code,
# in Spanish, with the handle in it (`app/app/lib/labels.ts` has the kinds).
# AN ANSWER'S LINE CARRIES THE WORDS THAT WENT OUT: nobody approved them, so
# Activity is where the owner reads what her account said, and a line that only
# says «contesté» is one she has to go to Instagram to check.
REPLIED_EVENT = "comment.replied"
HIDDEN_EVENT = "comment.hidden"
SENT_EVENT = "message.sent"
REPLIED_LABEL = "Le contesté a @{username}: «{text}»"
SENT_LABEL = "Le escribí a @{username} por mensaje: «{text}»"
# Where the one-answer-per-comment rule is written down: the watcher's own
# table, a kind of its own, and the words that went out as the mark — which is
# what `ALREADY` quotes back.
REPLIED_MARK = "replied"


class ApprovalNote(BaseModel):
    """The words the client reads on the approval card.

    THE SAME FOUR FIELDS AS THE APPROVAL PLUGIN'S, declared again here and not
    imported: the contract with `approval/core/render.py` is the four KEYS of
    the dict the tool call carries, and two plugins share one `sys.modules`
    namespace and nothing else (`social/core/publishing.py` has the same note
    and the measured story behind it).
    """

    what: str = Field(description="Qué vas a hacer, en una línea y en criollo.")
    if_approved: str = Field(description="Qué pasa si el cliente te dice que sí.")
    if_rejected: str = Field(description="Qué pasa si el cliente te dice que no.")
    why: str = Field(description="Por qué lo estás proponiendo ahora.")


def flat(text) -> str:
    """One line. A line break inside a markdown table cell breaks the table."""
    return " ".join(str(text or "").split())


def first_line(caption: str | None) -> str:
    """How a post is named on a card and in a listing: its caption's first line,
    which is the only part Instagram shows before the «más»."""
    return flat((caption or "").strip().splitlines()[0] if (caption or "").strip() else "")[:90]


def days_left(seconds: float) -> int:
    return max(int(seconds // ig_graph.DAY), 0)


# ── the post a comment is under, when it is one of ours ─────────────────────


def slide_of(media_id: str) -> tuple[str, str] | None:
    """The post in `posteos/` that went out as this media, and its first slide.

    READ OFF THE FOLDER, not through the social plugin's module. `posteos/<id>/
    post.json` with `published.media_id` in it is a documented convention of
    this workspace (`engine/README.md`, «Publishing»), and a plugin that
    imported another plugin's module would be betting on which of the two
    `CORE_PLUGINS` loads first.

    `None` when the comment is on a post the agent did not make — a post from
    before the agent, or one the client published by hand — which is a normal
    state and not a failure: the card then shows the permalink and no picture.
    """
    root = config.WORKSPACE / "posteos"
    if not root.is_dir():
        return None
    for path in sorted(root.glob("*/post.json")):
        if path.parent.name.startswith("."):
            continue
        data = json.loads(path.read_text())
        published = data.get("published") or {}
        if published.get("media_id") == media_id and data.get("images"):
            return data["id"], data["images"][0]
    return None


# ── the hide card ───────────────────────────────────────────────────────


def about(row) -> list[str]:
    """What the hide card is: the post and the comment, as a table."""
    post = first_line(row["post_line"]) or "un posteo"
    where = f"«{post}»"
    if row["permalink"]:
        where += f" · {row['permalink']}"
    lines = ["| | |", "|---|---|", f"| El posteo | {where} |"]
    found = slide_of(row["media_id"])
    if found:
        post_id, name = found
        lines.append(f"| Lo que se ve | ![La primera slide](/portal/posts/{post_id}/{name}) |")
    who = f"@{row['username']}" if row["username"] else "alguien"
    kind = "El comentario" if not row["is_reply"] else "El comentario (es una respuesta)"
    lines.append(f"| {kind} | {who}: «{flat(row['text'])}» |")
    return lines


def hide_card(args: dict) -> tuple[str, str]:
    """The card of «ocultar este comentario», in Spanish. There is nothing to
    edit under the table: hiding is a yes or a no, and the client has the
    comment in front of her.

    A comment that is not in `instagram_seen` is not an error here — the id came
    from the model and the model can be wrong — so the card says so and the
    client says no.
    """
    comment_id = args["comment_id"]
    row = ig_store.seen(comment_id)
    if row is None:
        return (f"Ocultar el comentario {comment_id}",
                UNKNOWN.format(comment_id=comment_id))
    who = f"@{row['username']}" if row["username"] else "un comentario"
    title = f"Ocultar el comentario de {who} en Instagram"
    return title, "\n".join(about(row))


# ── the 24 hours Meta gives to answer a person ──────────────────────────────


def window_left(row) -> float:
    """Seconds left to answer this thread, negative once they are gone.

    It is Meta's rule and not ours: an app may answer up to 24 hours after the
    person's last message. The listing says how much is left, so the threads
    about to close are answered first, and `send_message` checks it again
    before sending, so a closed one is refused in words and not by Meta.
    """
    last = row["last_inbound_at"] or 0
    return last + ig_graph.WINDOW_HOURS * 3600 - time.time()


def window_line(row) -> str:
    left = window_left(row)
    if left <= 0:
        return CLOSING
    return OPEN.format(hours=int(left // 3600) or 1)


# ── the thread, and the ticket it may already have ──────────────────────────


def ticket_of(source: str, source_ref: str) -> str | None:
    """The board's ticket for this comment or this conversation, if there is one.

    `(source, source_ref)` is the board's own unique key, so this is a lookup and
    never a guess. It travels in the listing because the ticket is where what was
    already said and decided lives: an agent that does not know a thread has one
    answers the last message instead of the person.
    """
    found = board.by_source(source, source_ref)
    return found["id"] if found else None


def ticket_line(ticket_id: str) -> str:
    """The ticket and what its column MEANS for the agent reading the listing.

    `blocked` on a channel ticket is the agent's own doing now — nothing of this
    plugin waits on a request any more — and it means «this one is the owner's»:
    a price the brand does not publish, a complaint, anything the agent decided
    not to answer on its own (`skills/comments/SKILL.md`). So the line says so,
    and sends it to the ticket, where the owner may already have answered.
    """
    status = board.row_of(ticket_id)["status"]
    if status != board.BLOCKED:
        return f"tarea {ticket_id} ({board.COLUMN[status]})"
    return (f"tarea {ticket_id} (la dejaste para tu cliente: leela con `read_ticket` "
            "antes de contestar nada)")


def said_by(row, participant_id: str | None) -> str:
    """Who said it, the way the listing names them: «Vos» is us."""
    if row["from_id"] and participant_id and row["from_id"] != participant_id:
        return "Vos"
    return f"@{row['from_username']}" if row["from_username"] else "la persona"


def thread_lines(conversation_id: str, participant_id: str | None,
                 new: set[str], indent: str = "  ") -> list[str]:
    """The conversation as the model reads it: oldest first, ours named, new marked."""
    lines = []
    for row in ig_store.thread(conversation_id, SHOWN):
        mark = " (nuevo)" if row["message_id"] in new else ""
        lines.append(f"{indent}{said_by(row, participant_id)}: «{flat(row['text'])}»{mark}")
    return lines


# ── the ticket IS the conversation, and the code writes it ──────────────────

# WHO SIGNS A COMMENT ON A CHANNEL TICKET, and it is not a matter of taste: the
# Inbox tells the two sides apart with `isOurSide(author, person)`
# (`app/app/inbox/conversation.ts`), where `person.handle` is the `@usuario` it
# reads off the ticket's TITLE and everything that is not that handle is our
# side. So a message of theirs is signed with their handle, exactly; one the
# tool sent is signed `agente`, which the portal already draws under the name
# the client gave her agent; and one the CLIENT sent from her own phone is
# signed with the account's handle — our side, and not the agent claiming it
# wrote it.
TITLE = "Mensaje de @{username} en Instagram"
# `**Fecha:**` is a header the Inbox strips from the bubble and `**De:**` is one
# it would read as the person — and read wrong, because an Instagram handle is
# not an address. The handle travels in the TITLE, which is where that screen
# looks for it.
BODY = "**Fecha:** {when}\n\n{text}"
HIDDEN_ON_TICKET = "Oculté el comentario de @{username}: {text}"

# The three columns a channel ticket ever moves between, and what each one means
# on the Inbox: `ready` «Nuevo», `blocked` «Esperando tu ok» — the agent left it
# for the owner —, `done` «Respondido».


def when_of(stamp: float | None) -> str:
    """The date the client reads on a ticket, in her own timezone."""
    moment = datetime.fromtimestamp(stamp or time.time(), ZoneInfo(config.TIMEZONE))
    return moment.strftime("%d/%m/%Y %H:%M")


def signature(message: dict, mine: str | None) -> str:
    """Who the comment is from, in the one vocabulary the Inbox reads."""
    if not message["ours"]:
        return f"@{message['username']}" if message["username"] else "la persona"
    return f"@{mine}" if mine else board.AGENT


def land(conversation_id: str, new: list[dict], row, mine: str | None,
         session_id: str | None) -> str:
    """The conversation on the board: the ticket, and every new message on it.

    CODE OPENS IT AND CODE WRITES IT, which is the whole of what changed on
    16/9/2026. A direct message is a lead by definition — nobody writes to a
    business account by accident — so there is nothing for the model to decide
    and nothing for it to remember; and what the client reads on the thread has
    to be what was SAID, not the agent's account of what it was doing. The
    narration («la respuesta está lista», «nuevo mensaje de…») is gone with it.

    A NEW MESSAGE REOPENS THE TICKET, the same way a new mail does: `done`,
    `blocked` or `in_progress` all go back to `ready`, because somebody is
    waiting again. A ticket already `ready` is left alone.
    """
    who = row["participant_username"] if row else None
    first = new[0]
    ticket_id, opened = board.create(
        title=TITLE.format(username=who or "alguien"),
        body=BODY.format(when=when_of(first["when"]), text=first["text"]),
        source=FROM_DM, source_ref=conversation_id, session_id=session_id,
    )
    # The message the ticket was OPENED with is its body; everything else is a
    # comment. Opening with the first one and commenting it too would show the
    # client the same sentence twice, one above the other.
    for message in (new[1:] if opened else new):
        board.comment(ticket_id, signature(message, mine), message["text"],
                      session_id=session_id)
    if not opened and any(not message["ours"] for message in new):
        current = board.row_of(ticket_id)["status"]
        if current != board.READY:
            board.move(ticket_id, board.READY, session_id=session_id)
    return ticket_id


def answered(source: str, source_ref: str, text: str, session_id: str | None) -> None:
    """What the tool just sent, written on the ticket, and the ticket closed.

    The ticket of a thread nobody opened is nothing to write to — a comment the
    model answered without opening one is not a lead — so this is a lookup and
    never a create.
    """
    ticket_id = ticket_of(source, source_ref)
    if not ticket_id:
        return
    board.comment(ticket_id, board.AGENT, text, session_id=session_id)
    board.move(ticket_id, board.DONE, said=text, session_id=session_id)


# ── the messages of one thread ──────────────────────────────────────────────


def sift(conversation_id: str, found: list[dict], mine: str) -> list[dict]:
    """Every message written down, and the NEW INBOUND ones handed back.

    Ours are told apart by `from.id`, which is the account's own id — the same
    fact `IG_USER_ID` is — and never by the text. Writing ours down too is what
    lets the listing show a conversation instead of half of one.
    """
    new = []
    for item in reversed(found):          # oldest first: the ticket is a thread
        author = item.get("from") or {}
        from_id = str(author.get("id") or "")
        ours = from_id == mine
        text = item.get("message") or ""
        when = ig_graph.moment(item["created_time"]) if item.get("created_time") else None
        fresh = ig_store.record_message(
            item["id"], conversation_id, from_id, author.get("username"), text, when)
        if not ours:
            ig_store.save_conversation(
                conversation_id, participant_id=from_id,
                participant_username=author.get("username"), last_inbound_at=when)
        if fresh:
            # OURS COUNT AS NEW HERE AND NOT IN THE LISTING: a message the client
            # sent from her phone belongs on the ticket, where the thread is
            # read, and it is not work anybody has to do.
            new.append({"id": item["id"], "ours": ours, "text": text, "when": when,
                        "username": author.get("username")})
    return new


# ── the listing a tick comes back with ──────────────────────────────────────


def comment_line(item: dict, mine: str, new: set[str], indent: str) -> str:
    """One comment as the model reads it: ours named «Vos», the new ones marked.

    OURS CARRY NO ID because there is nothing to do with one: you do not answer
    or hide your own answer, and an id on the line is an invitation to try.
    """
    text = flat(item.get("text") or "")
    if item.get("username") == mine:
        return f"{indent}Vos: «{text}»"
    who = f"@{item['username']}" if item.get("username") else "alguien"
    mark = " (nuevo)" if item["id"] in new else ""
    return f"{indent}`{item['id']}` {who}: «{text}»{mark}"


def walk(comment: dict, media: dict, mine: str) -> str | None:
    """One comment's whole thread, if anything under it is new. `None` if not.

    THE THREAD AND NOT THE ROW, and that is the same rule the messages follow:
    a reply that says «yo también» means nothing without the question above it,
    and the agent has no other way to see it. So a comment with something new
    comes back with the post it is under, the comment itself and every reply
    already under it — OURS INCLUDED, named «Vos», because our own answer is the
    context that keeps the agent from answering twice.

    WHAT IS NEW IS STILL ONE ROW AT A TIME: `instagram_seen` is what decides it,
    ours are never new (they are skipped by username before being recorded), and
    a comment already handled is shown as context and not as work.
    """
    nested = (comment.get("replies") or {}).get("data") or []
    new = set()
    for item, is_reply in [(comment, False)] + [(r, True) for r in nested]:
        if item.get("username") == mine:
            continue
        if ig_store.record(
            comment_id=item["id"],
            media_id=media["id"],
            permalink=media.get("permalink"),
            post_line=first_line(media.get("caption")),
            username=item.get("username"),
            text=item.get("text") or "",
            is_reply=is_reply,
        ):
            new.add(item["id"])
    if not new:
        return None
    where = f"«{first_line(media.get('caption'))}»" if media.get("caption") else "un posteo"
    head = f"- En {where}"
    if media.get("permalink"):
        head += f" ({media['permalink']})"
    ticket = ticket_of(FROM_COMMENT, comment["id"])
    if ticket:
        head += f" · tarea {ticket}"
    lines = [head, comment_line(comment, mine, new, "  ")]
    lines += [comment_line(reply, mine, new, "    ") for reply in nested]
    return "\n".join(lines)


# ── looking for what is new, with no model in it ────────────────────────────
#
# The two functions below are the whole of «is there anything new», and they
# have two callers: the face's tools, when somebody asks in the chat, and
# `watch`, which is what fires the flow (`core/watchers.py`). `None` is «no».


def moved(kind: str, items: list[dict], field: str, everything: bool) -> list[dict]:
    """The items whose mark is not the one written down last time."""
    if everything:
        return items
    return [item for item in items if ig_store.mark(kind, item["id"]) != str(item.get(field))]


def new_comments(everything: bool = True) -> str | None:
    """The comment threads with something new, as the model reads them.

    `everything=False` is the watcher's cheap look: only the posts whose
    `comments_count` moved are opened. The mark is written AFTER the post was
    read, so a look that breaks halfway reads it again.
    """
    mine = ig_graph.whoami()
    feed = ig_graph.media(FEED)
    blocks = []
    for item in moved("media", feed, "comments_count", everything):
        for comment in ig_graph.comments(item["id"]):
            block = walk(comment, item, mine)
            if block:
                blocks.append(block)
        ig_store.set_mark("media", item["id"], str(item.get("comments_count")))
    if not blocks:
        return None
    head = ("1 comentario nuevo, en este hilo:" if len(blocks) == 1
            else f"Comentarios nuevos, en {len(blocks)} hilos:")
    return head + "\n\n" + "\n\n".join(blocks)


def new_messages(session_id: str | None, everything: bool = True) -> str | None:
    """The conversations with something new from the other side, whole.

    `everything=False` opens only the conversations whose `updated_time` moved.
    Every new message lands on its ticket here, by code, whoever is calling.
    """
    mine = ig_graph.user_id()
    threads = ig_graph.conversations(THREADS)
    handle = ig_store.username()
    found = {}
    for item in moved("conversation", threads, "updated_time", everything):
        new = sift(item["id"], ig_graph.messages(item["id"]), mine)
        if any(not message["ours"] for message in new):
            found[item["id"]] = new
        elif new:
            # Only our own, from her phone: it belongs on the ticket and it
            # is not work. The conversation is not listed.
            land(item["id"], new, ig_store.conversation(item["id"]), handle, session_id)
        ig_store.set_mark("conversation", item["id"], str(item.get("updated_time")))
    if not found:
        return None
    total = sum(len([m for m in v if not m["ours"]]) for v in found.values())
    head = (f"{total} mensaje nuevo, en estas conversaciones:" if total == 1
            else f"{total} mensajes nuevos, en estas conversaciones:")
    blocks = []
    for conversation_id, new in found.items():
        row = ig_store.conversation(conversation_id)
        who = (f"@{row['participant_username']}" if row["participant_username"]
               else "alguien")
        ticket_id = land(conversation_id, new, row, handle, session_id)
        title = (f"- `{conversation_id}` · {who} · {window_line(row)}"
                 f" · {ticket_line(ticket_id)}")
        blocks.append("\n".join(
            [title] + thread_lines(conversation_id, row["participant_id"],
                                   {m["id"] for m in new if not m["ours"]})))
    return head + "\n\n" + "\n\n".join(blocks)


# The name the curated flow asks for in its frontmatter (`event:`), and how
# often the scheduler calls `watch` when nothing is happening.
WATCHER = "instagram.inbox"
WATCH_EVERY = 30

# How often a look opens EVERY post and EVERY conversation whatever the marks
# say. The marks are a shortcut and Instagram owes us nothing about them: a
# comment deleted and another written between two looks leaves the count where
# it was. Fifteen minutes is what the whole flow used to run on.
SWEEP_EVERY = 900
_swept = 0.0


def watch() -> str | None:
    """What is new on the account, or `None`. NO MODEL: this is the function the
    scheduler calls every `WATCH_EVERY` seconds, and the flow only becomes a
    turn of the agent when it returns something.

    A quiet look is two calls, the feed and the conversation list. The token's
    sixty days are renewed from here too, since the flow that used to do it no
    longer runs when there is nothing to do. With no connection there is nothing
    to watch: the flow's card already says the connection is missing.
    """
    global _swept
    everything = time.time() - _swept >= SWEEP_EVERY
    found, broke = [], None
    try:
        if ig_graph.due():
            ig_graph.refresh()
        # EACH HALF ON ITS OWN. What a look finds is marked as seen the moment
        # it is found, so a Graph error in the messages must not take down with
        # it the comments already read: they are returned, and the error comes
        # back by itself on the next look if it is still there.
        for look in (lambda: new_comments(everything), lambda: new_messages(None, everything)):
            try:
                found.append(look())
            except ig_graph.Refused as exc:
                broke = exc
    except ig_graph.NotConnected:
        return None
    arrived = "\n\n".join(part for part in found if part)
    if broke and not arrived:
        raise broke
    if everything and not broke:
        _swept = time.time()
    return arrived or None


# ── the toolsets ────────────────────────────────────────────────────────────


def toolset() -> FunctionToolset:
    """What the face gets un-gated: reading, answering — a comment or a message,
    which go out the moment they are called (24/9/2026) — and the token's own
    maintenance."""
    ts = FunctionToolset()

    @ts.tool
    def fetch_comments(ctx: RunContext) -> str:
        """Los hilos de comentarios donde hay algo nuevo, enteros.

        Mira los últimos posteos de la cuenta y te trae, de cada comentario con
        algo nuevo, **el hilo completo**: en qué posteo está, el comentario, y
        las respuestas que ya tiene abajo —incluida la tuya, marcada «Vos»—.
        Lo nuevo va marcado «(nuevo)»: lo demás es contexto, no trabajo.

        Cada comentario que podés contestar viene con su id entre comillas
        invertidas —ese id va en `reply_comment` y en `hide_comment`—, y si el
        hilo ya tiene tarea en el tablero, con el id de la tarea: leela con
        `read_ticket` antes de escribir.

        Si no hay nada nuevo te lo dice en una línea, y ahí se termina la
        corrida: no inventes trabajo.
        """
        try:
            return new_comments() or NOTHING_NEW
        except ig_graph.NotConnected as exc:
            scheduler.could_not(ctx.deps.session_id, str(exc))
            return str(exc)

    @ts.tool
    def fetch_messages(ctx: RunContext) -> str:
        """Las conversaciones de Instagram donde hay algo nuevo, enteras.

        No te trae mensajes sueltos: te trae **la conversación completa** de
        cada persona que escribió algo nuevo, de lo más viejo a lo más nuevo,
        con lo tuyo marcado «Vos» y lo nuevo marcado «(nuevo)». Es a la persona
        a la que le contestás, no al último renglón: si preguntó algo hace tres
        mensajes y todavía no se lo contestaste, está ahí.

        Cada conversación viene con su id entre comillas invertidas —ese id es
        el que va en `send_message`—, con **cuánto queda del plazo para
        contestar** —Instagram sólo deja responder hasta 24 horas después del
        último mensaje de esa persona— y, si ya tiene tarea en el tablero, con
        el id de la tarea: leela con `read_ticket` antes de escribir.

        Las conversaciones donde no hay nada nuevo no aparecen. Si no hay nada
        nuevo en ninguna, te lo dice en una línea y ahí se termina la corrida.
        """
        try:
            return new_messages(ctx.deps.session_id) or NO_MESSAGES
        except ig_graph.NotConnected as exc:
            scheduler.could_not(ctx.deps.session_id, str(exc))
            return str(exc)

    @ts.tool
    def refresh_if_due(ctx: RunContext) -> str:
        """Renovar el token de Instagram si está por vencer.

        El token dura 60 días y se muere solo, sin avisar: cuando le quedan
        menos de 10 días esta herramienta lo renueva y anota hasta cuándo vale
        el nuevo. Si todavía está lejos, no hace nada y te lo dice.

        Se renueva solo mientras el flujo de Instagram está activo; usala si
        el cliente te pregunta por la conexión. Es mantenimiento, no trabajo
        suyo.
        """
        try:
            if not ig_graph.due():
                return FRESH.format(days=days_left(ig_store.expires_at() - time.time()))
            seconds = ig_graph.refresh()
        except ig_graph.NotConnected as exc:
            return str(exc)
        return RENEWED.format(days=days_left(seconds))

    @ts.tool
    def reply_comment(ctx: RunContext, comment_id: str, text: str) -> str:
        """Contestar un comentario de Instagram. SALE EN EL MOMENTO.

        Se publica abajo del comentario, con el nombre de la cuenta de tu
        cliente y a la vista de cualquiera. Nadie la lee antes que la persona:
        llamala sólo cuando la skill `comments` dice que ese comentario lo
        contestás vos. Si no estás seguro, si pide un precio que la marca no
        publica, si es una queja o algo que tiene que decidir tu cliente, NO la
        llames: dejalo en el tablero para él.

        Una respuesta por comentario: si ya lo contestaste, no sale nada y te
        lo digo. Si ya tenés el id, esto es lo que llamás: no vuelvas a pedir
        la lista para «verificar». Si falta algo —la conexión, el comentario—,
        te lo digo yo. Lo que salió queda en la Actividad de tu cliente y, si el
        comentario tiene tarea, en la tarea.

        Args:
            comment_id: el id que te dio `fetch_comments`.
            text: la respuesta, una o dos líneas, con la voz de la marca.
        """
        row = ig_store.seen(comment_id)
        if row is None:
            raise ModelRetry(UNKNOWN.format(comment_id=comment_id))
        before = ig_store.mark(REPLIED_MARK, comment_id)
        if before is not None:
            return ALREADY.format(text=before)
        message = text.strip()
        try:
            ig_graph.reply(comment_id, message)
        except ig_graph.NotConnected as exc:
            return str(exc)
        except ig_graph.Refused as exc:
            # NOT A RETRY: the thread is public and a reply that half went out
            # is the last thing to attempt twice. What comes back is a sentence
            # the face reads out, and the client decides what happens next.
            return FAILED_REPLY.format(reason=exc)
        ig_store.set_mark(REPLIED_MARK, comment_id, message)
        db.append_event(
            REPLIED_EVENT, REPLIED_LABEL.format(username=row["username"], text=message),
            "completed", ctx.deps.session_id,
            {"comment_id": comment_id, "media_id": row["media_id"], "text": message},
        )
        # On the lead's ticket, WHEN THERE IS ONE: a comment the agent answered
        # without opening a ticket is not a lead, and this is a lookup.
        answered(FROM_COMMENT, comment_id, message, ctx.deps.session_id)
        return REPLIED.format(username=row["username"])

    @ts.tool
    def send_message(ctx: RunContext, conversation_id: str, text: str) -> str:
        """Contestar un mensaje privado de Instagram. SALE EN EL MOMENTO.

        Le llega a la persona que escribió, en el mismo hilo, con el nombre de
        la cuenta de tu cliente. Nadie lo lee antes que ella: llamala sólo
        cuando la skill `comments` dice que esa respuesta la das vos. Si no
        estás seguro, si pide un precio que la marca no publica, si es un
        reclamo o algo que tiene que decidir tu cliente, NO la llames: dejá la
        tarea de esa conversación para él.

        **A quién le va lo decide la conversación**: vos pasás el id del hilo y
        nada más. Si ya lo tenés, esto es lo que llamás: no vuelvas a pedir los
        mensajes para «verificar». Si falta algo —la conexión, la conversación,
        el plazo—, te lo digo yo.

        Instagram sólo deja contestar hasta 24 horas después del último mensaje
        de esa persona. Si ya se pasó, no mando nada y te lo digo.

        De la tarea del tablero no te ocupás vos: la abro yo cuando llega el
        mensaje, le escribo lo que salió y la muevo a «Completado». Lo que
        salió también queda en la Actividad de tu cliente.

        Args:
            conversation_id: el id que te dio `fetch_messages`.
            text: la respuesta, corta, con la voz de la marca.
        """
        row = ig_store.conversation(conversation_id)
        if row is None:
            raise ModelRetry(NO_THREAD.format(conversation_id=conversation_id))
        who = row["participant_username"] or "esa persona"
        # META'S CLOCK, CHECKED BEFORE THE CALL: past 24 hours the Graph refuses
        # anyway, and the sentence here says what to do instead. NOT a
        # ModelRetry — sending the same message again cannot fix time.
        if window_left(row) <= 0:
            return CLOSED.format(username=who)
        message = text.strip()
        try:
            sent = ig_graph.send_message(row["participant_id"], message)
        except ig_graph.NotConnected as exc:
            return str(exc)
        except ig_graph.Refused as exc:
            return FAILED_SEND.format(username=who, reason=exc)
        ig_store.record_message(sent, conversation_id, ig_graph.user_id(), None,
                                message, time.time())
        db.append_event(
            SENT_EVENT, SENT_LABEL.format(username=who, text=message), "completed",
            ctx.deps.session_id,
            {"conversation_id": conversation_id, "message_id": sent, "text": message},
        )
        # WHAT WENT OUT, ON THE TICKET, BY THE CODE THAT SENT IT. The thread the
        # client reads in Inbox is the conversation and not the agent's account
        # of it, and the ticket is closed by the same call that answered it.
        answered(FROM_DM, conversation_id, message, ctx.deps.session_id)
        return SENT.format(username=who)

    return ts


def gated() -> FunctionToolset:
    """What still stops for the client's yes: hiding a comment. `plugin.py`
    registers this one wrapped in `approval_required()`, the whole toolset with
    no predicate, so a tool added here tomorrow is gated without anyone
    remembering a list. The two that ANSWER are not here (24/9/2026): they are
    on the face, in `toolset()`."""
    ts = FunctionToolset()

    @ts.tool
    def hide_comment(
        ctx: RunContext,
        comment_id: str,
        note: ApprovalNote,
        client_correction: str | None = None,
    ) -> str:
        """Ocultar un comentario de Instagram. Frena hasta que el cliente apruebe.

        Ocultarlo lo saca de la vista de todos menos de quien lo escribió, y se
        puede volver atrás desde la app. Es para spam, links raros e insultos, y
        no para una queja: una queja se contesta.

        No borra nada. Borrar no se puede deshacer y este agente no lo hace.

        `note` es lo que el cliente lee para decidir: decí qué dice el
        comentario y por qué lo querés ocultar.

        `client_correction` NO LA ESCRIBÍS VOS: llega si el cliente escribió algo
        al aprobar, y son sus palabras sobre este comentario. Dejala vacía.

        Args:
            comment_id: el id que te dio `fetch_comments`.
        """
        row = ig_store.seen(comment_id)
        if row is None:
            raise ModelRetry(UNKNOWN.format(comment_id=comment_id))
        try:
            ig_graph.hide(comment_id)
        except ig_graph.NotConnected as exc:
            return str(exc)
        except ig_graph.Refused as exc:
            return FAILED_HIDE.format(reason=exc)
        db.append_event(
            HIDDEN_EVENT, f"Oculté un comentario de @{row['username']} en Instagram",
            "completed", ctx.deps.session_id,
            {"comment_id": comment_id, "media_id": row["media_id"]},
        )
        ticket_id = ticket_of(FROM_COMMENT, comment_id)
        if ticket_id:
            board.comment(
                ticket_id, board.AGENT,
                HIDDEN_ON_TICKET.format(username=row["username"], text=flat(row["text"])),
                session_id=ctx.deps.session_id,
            )
        said = f" El cliente dijo: «{flat(client_correction)}»." if client_correction else ""
        return HIDDEN.format(username=row["username"]) + said

    return ts


def performance() -> FunctionToolset:
    """ONE READ-ONLY TOOL, AND IT IS NOT FOR THE FACE. It is handed to the
    social plugin's creator through `engine.provide("instagram.performance",
    …)`, because what it answers is only useful to whoever is about to write the
    next post: what got saved is what to do more of.

    Not gated, because it changes nothing — and it could not be: a sub-agent
    never talks to the client, so nothing it can call may stop the run to ask
    her (`core/plugins.py`'s `subagent`).
    """
    ts = FunctionToolset()

    @ts.tool
    def recent_performance(ctx: RunContext) -> str:
        """Cómo le fue a los últimos posteos de Instagram: los números de verdad.

        De cada uno: la fecha, la primera línea del pie, el link, a cuánta gente
        llegó, cuántos lo guardaron, cuántos le dieron me gusta y cuántos
        comentaron.

        Leelo antes de elegir el tema. **Lo que la gente guarda es lo que hay que
        hacer más**: guardar es el que dice «esto me sirve», y pesa más que un me
        gusta. Si la cuenta todavía no publicó nada, te lo dice y escribís igual.
        """
        try:
            feed = ig_graph.media(PERFORMANCE)
        except ig_graph.NotConnected as exc:
            return str(exc)
        if not feed:
            return "Todavía no hay ningún posteo publicado en la cuenta."
        lines = []
        for item in feed:
            numbers = ig_graph.insights(item["id"])
            when = (item.get("timestamp") or "")[:10]
            counted = " · ".join(
                f"{label} {numbers.get(key, 0)}"
                for label, key in (("alcance", "reach"), ("guardados", "saved"),
                                   ("me gusta", "likes"), ("comentarios", "comments"),
                                   ("compartidos", "shares"))
            )
            lines.append(f"- {when} · «{first_line(item.get('caption'))}» · "
                         f"{item.get('permalink', '')}\n  {counted}")
        return f"Los últimos {len(lines)} posteos:\n\n" + "\n".join(lines)

    return ts
