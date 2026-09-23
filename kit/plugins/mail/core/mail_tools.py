"""The two tools: read the mailbox, and answer one mail through the gate.

`fetch_mail` is not gated — reading changes nothing outside the client's own
portal — and `send_email` is, because it is the one thing this plugin does
outwards. They are two toolsets for that reason and not one
(`plugin.py` wraps only the second in `approval_required()`).

**A MAIL IS A TICKET, AND THE TICKET IS THE BOARD'S.** There is no mail store
of our own: `board.create(source="mail", source_ref=<Message-ID>)` is the whole
mechanism, and the board's UNIQUE index on that pair is what makes finding the
same message twice answer with the ticket that is already there instead of
opening a second one. What this file adds is the THREAD: `mail_seen` maps every
Message-ID to its ticket, so a reply lands as a comment on the conversation it
answers, and `mail_threads` holds the recipient and the subject, so the model
never supplies either.

**WHAT `fetch_mail` RETURNS IS WHAT THE RUN COSTS.** With nothing new it is one
line — «Sin mails nuevos.» — and the flow's turn ends there. That is the whole
reason reading is a flow and not a loop: five minutes of nothing costs a cent.

**THE CARD IS DRAWN HERE**, because only this plugin knows what a mail thread
is (`engine.provide("approval.render.send_email", card)`). The conversation
goes above a one-row table and the draft below it: the portal cuts a request's
EDITABLE text after the LAST table row (`splitProposal` in
`app/app/approvals/page.tsx`), so what the correction box preloads is the
answer and nothing else. Everything above it is quoted with `>`, which is also
what stops a mail that contains a `|` line from moving that cut.

**A CORRECTION REPLACES THE BODY; IT IS NOT APPENDED TO IT.** Same reasoning as
the caption in `social/core/publishing.py`: the box the client edits is
preloaded with the draft, so what comes back is a finished answer, not an
instruction about one. Appending it would mail the reply twice.
"""

from pathlib import Path

import board_store as board
import mail_imap
import mail_smtp
import mail_store as store
from pydantic import BaseModel, Field
from pydantic_ai import ModelRetry, RunContext
from pydantic_ai.toolsets import FunctionToolset

from core import db, scheduler

TOOL = "send_email"

# What the run reads back. All Spanish: the model answers the client with it.
NOTHING = "Sin mails nuevos."
ONE_NEW = "1 mail nuevo:"
MANY_NEW = "{count} mails nuevos:"
REPLY_OF = "respuesta sobre una tarea que ya estaba"
DISCARDED = "Descartados: {count}."
NOT_CONNECTED_LISTING = "{reason} Por eso no pude mirar la casilla."

# What `send_email` reads back.
NO_THREAD = (
    "La tarea {ticket_id} no salió de un mail, así que no hay a quién"
    " contestarle. Si hay que escribirle a alguien que no escribió primero,"
    " decíselo al cliente: todavía no puedo hacerlo."
)
SENT = "Le contesté a {to}: «{subject}». La tarea {ticket_id} quedó en Completado."
FAILED = "No salió nada: {reason}. La tarea {ticket_id} sigue esperando."

# How much of the mail the listing shows. Enough to decide whether it matters,
# not enough to pay for the whole inbox in tokens — the ticket has all of it.
PREVIEW = 240
# And how much of the conversation the approval card shows.
CARD_MAIL = 2000

# Who signs the comments this plugin writes. The sender's own address and the
# address the answer went out as: `authorLabel` in the portal shows any author
# it does not recognise EXACTLY as it came, "because it's a person at the
# company and their name is the datum" (`app/app/lib/agent.ts`).


class ApprovalNote(BaseModel):
    """The words the client reads on the approval card.

    The same four fields as `approval/core/sensitive.py` used to declare and as
    `social/core/publishing.py` declares, and declared again here for the same
    reason: the contract with `approval/core/render.py` is the four KEYS of the
    dict the tool call carries, not a Python class, and a plugin's surface
    modules share one `sys.modules` namespace — `import sensitive` from here
    returns whichever plugin got there first.
    """

    what: str = Field(description="Qué vas a hacer, en una línea y en criollo.")
    if_approved: str = Field(description="Qué pasa si el cliente te dice que sí.")
    if_rejected: str = Field(description="Qué pasa si el cliente te dice que no.")
    why: str = Field(description="Por qué lo estás proponiendo ahora.")


def quoted(text: str) -> str:
    """A block nobody can mistake for the answer, and no line of which can be
    read as a table row: `|` at the start of a line is what the portal cuts a
    request's editable text on."""
    return "\n".join(f"> {line}" if line.strip() else ">" for line in text.strip().splitlines())


def clipped(text: str, limit: int) -> str:
    """As much of it as fits, with its line breaks."""
    text = text.strip()
    return text if len(text) <= limit else text[:limit].rstrip() + "…"


def one_line(text: str, limit: int = PREVIEW) -> str:
    """The first thing the mail says, on one line: enough to decide whether it
    matters. The whole of it is on the ticket."""
    return clipped(" ".join(text.split()), limit)


# ── reading ─────────────────────────────────────────────────────────────────


def parent_ticket(mail: mail_imap.Mail) -> str | None:
    """The ticket this message answers, if we have seen its conversation.

    Newest first: a long chain quotes every message it ever had, and the one
    that matters is the last one that landed on a ticket.
    """
    for message_id in reversed(mail.parents):
        ticket_id = store.ticket_of(message_id)
        if ticket_id and board.row_of(ticket_id):
            return ticket_id
    return None


def land(mail: mail_imap.Mail, workspace: Path, session_id: str) -> tuple[str, str]:
    """One message on the board. Answers the ticket's id and what happened to it.

    Three outcomes and each one is a different ticket: the mail nobody wrote
    (discarded, closed with the reason), the answer to a conversation we
    already have (a comment, and the ticket goes back to «Por hacer»), and a
    new one.
    """
    if mail.discard:
        ticket_id, _ = board.create(
            title=mail.subject, body=mail_imap.body_of(mail), source=store.SOURCE,
            source_ref=mail.message_id, session_id=session_id,
        )
        said = f"Descartado: {mail.discard}."
        board.comment(ticket_id, board.AGENT, said, session_id=session_id)
        board.move(ticket_id, board.DONE, said=said, session_id=session_id)
        return ticket_id, "discarded"

    parent = parent_ticket(mail)
    if parent:
        board.comment(
            parent, mail.address,
            f"**{mail.when}**\n\n{mail.text}".strip(), session_id=session_id,
        )
        board.move(parent, board.READY, session_id=session_id)
        keep_thread(parent, mail)
        attach(parent, mail, workspace, board.row_of(parent)["body"])
        return parent, "reply"

    ticket_id, _ = board.create(
        title=mail.subject, body=mail_imap.body_of(mail), source=store.SOURCE,
        source_ref=mail.message_id, session_id=session_id,
    )
    keep_thread(ticket_id, mail)
    attach(ticket_id, mail, workspace, mail_imap.body_of(mail))
    return ticket_id, "new"


def attach(ticket_id: str, mail: mail_imap.Mail, workspace: Path, body: str) -> None:
    """The attachments on disk and named in the ticket's body.

    The body is rewritten and not commented, because the ticket's body is the
    mail: the files came with it and the client reads them where she reads it.
    It happens after the ticket exists, which is the only moment its id — and
    therefore the folder the files go in — exists.
    """
    saved = mail_imap.save_attachments(workspace, ticket_id, mail)
    if saved:
        board.set_body(ticket_id, body + mail_imap.attachments_block(saved))


def keep_thread(ticket_id: str, mail: mail_imap.Mail) -> None:
    """Who an answer goes to, under what subject, quoting what."""
    store.remember_thread(
        ticket_id,
        to_address=mail.address,
        subject=mail.subject,
        last_message_id=mail.message_id,
        reference_ids=" ".join([*mail.parents, mail.message_id]),
    )


def listing(new: list[tuple[str, mail_imap.Mail, str]], discarded: int) -> str:
    """What the run reads: the new mails, compact, and how many were dropped."""
    if not new:
        return NOTHING if not discarded else f"{NOTHING} {DISCARDED.format(count=discarded)}"
    lines = [ONE_NEW if len(new) == 1 else MANY_NEW.format(count=len(new))]
    for ticket_id, mail, kind in new:
        tail = f" · {REPLY_OF}" if kind == "reply" else ""
        lines.append(
            f"\n- {ticket_id} · {mail.sender} · {mail.when}{tail}"
            f"\n  «{mail.subject}»"
            f"\n  {one_line(mail.text)}"
        )
    if discarded:
        lines.append(f"\n{DISCARDED.format(count=discarded)}")
    return "\n".join(lines)


def reading() -> FunctionToolset:
    ts = FunctionToolset()

    @ts.tool
    def fetch_mail(ctx: RunContext) -> str:
        """Mirar si llegó algo nuevo a la casilla de la empresa.

        Cada mail nuevo queda como una tarea en el tablero —con quién escribió,
        cuándo y qué dice— y te devuelvo la lista con el id de cada una. Si es
        la respuesta de una conversación que ya teníamos, la agrego a esa tarea
        y la tarea vuelve a «Por hacer».

        Lo que es propaganda o un aviso automático lo descarto yo: queda
        anotado y cerrado en el tablero, y no te lo cuento como nuevo.

        Si no llegó nada, te digo «Sin mails nuevos.» y ahí termina el trabajo:
        no vuelvas a llamarla en la misma vuelta.
        """
        try:
            ours = store.sender()
            with mail_imap.mailbox() as conn:
                new: list[tuple[str, mail_imap.Mail, str]] = []
                discarded = 0
                for uid in mail_imap.unseen(conn):
                    mail = mail_imap.read(conn, uid, ours)
                    if store.ticket_of(mail.message_id):
                        # The second lock under IMAP's flag: a message whose id
                        # is already on a ticket was worked, whatever the
                        # mailbox says about it.
                        mail_imap.mark_seen(conn, uid)
                        continue
                    ticket_id, kind = land(mail, ctx.deps.workspace, ctx.deps.session_id)
                    store.remember(mail.message_id, ticket_id)
                    mail_imap.mark_seen(conn, uid)
                    if kind == "discarded":
                        discarded += 1
                    else:
                        new.append((ticket_id, mail, kind))
        except store.NotConnected as exc:
            # A run of the inbox flow that cannot read the inbox did not do its
            # work, whatever the model answers after this.
            scheduler.could_not(ctx.deps.session_id, str(exc))
            return NOT_CONNECTED_LISTING.format(reason=exc)
        return listing(new, discarded)

    return ts


# ── answering ───────────────────────────────────────────────────────────────


def card(args: dict) -> tuple[str, str]:
    """The title and the body of the approval card, READ FROM THE THREAD.

    The approval plugin calls this by tool name when a run stops, and
    everything it returns is Spanish: it is what the client reads on the screen
    where she decides. A ticket that is not a mail's is not an error here — the
    id came from the model — so the card says so and the client says no.
    """
    ticket_id = args["ticket_id"]
    ticket, thread = board.row_of(ticket_id), store.thread(ticket_id)
    if ticket is None or thread is None:
        return f"Contestar un mail ({ticket_id})", NO_THREAD.format(ticket_id=ticket_id)

    subject = mail_smtp.reply_subject(thread["subject"])
    title = f"Contestar el mail de {thread['to_address']}: {subject}"
    lines = [
        f"**Para:** {thread['to_address']}",
        f"**Asunto:** {subject}",
        f"\n**La conversación** — tarea «{ticket['title']}» ({ticket_id}):\n",
        quoted(clipped(ticket["body"], CARD_MAIL)),
    ]
    for said in board.comments(ticket_id):
        lines.append(f"\n*{said['author']}:*\n")
        lines.append(quoted(clipped(said["body"], CARD_MAIL)))
    # THE TABLE IS THE BOUNDARY, and it is load-bearing: the portal preloads the
    # correction box with everything after the LAST table row, so the draft
    # below it is exactly what the client edits and sends.
    lines.append("\n| La respuesta que propongo |\n|---|\n")
    lines.append(args["body"].strip())
    return title, "\n".join(lines)


def sending() -> FunctionToolset:
    ts = FunctionToolset()

    @ts.tool
    def send_email(
        ctx: RunContext,
        ticket_id: str,
        body: str,
        note: ApprovalNote,
        client_correction: str | None = None,
    ) -> str:
        """Contestar el mail de una tarea del tablero. Frena hasta que el
        cliente lo apruebe desde el portal.

        A quién le contesta y con qué asunto sale de la tarea, no de vos: es el
        mail que llegó. Por eso no hay `to` ni `subject` acá, y por eso sólo
        podés contestar tareas que hayan salido de un mail.

        Antes de llamarla, movés la tarea a `blocked` con `update_ticket`
        diciendo que la respuesta está lista y espera el ok. Cuando el cliente
        aprueba, el mail sale y la tarea queda en Completado con lo que se
        mandó.

        `note` es lo que el cliente lee para decidir: llenala siempre, en
        criollo y sin tecnicismos. Decí de quién es el mail y qué le vas a
        contestar.

        `client_correction` NO LA ESCRIBÍS VOS: la completa el cliente cuando
        aprueba con correcciones, y es EL TEXTO ya editado por él, tal cual
        tiene que salir. Llega sola en la segunda vuelta; dejala vacía siempre.

        Args:
            ticket_id: el id de la tarea del mail, como `t_ab12cd34ef56`.
            body: la respuesta entera, tal como la va a leer quien escribió.
                Sin asunto y sin firma de máquina: el asunto lo pone la
                herramienta.
        """
        thread = store.thread(ticket_id)
        if thread is None:
            raise ModelRetry(NO_THREAD.format(ticket_id=ticket_id))
        text = (client_correction or body).strip()
        try:
            subject, sent_id = mail_smtp.send(
                thread["to_address"], thread["subject"], text,
                last_message_id=thread["last_message_id"],
                reference_ids=thread["reference_ids"],
            )
        except store.NotConnected as exc:
            return f"{exc} El mail no salió."
        except mail_smtp.Refused as exc:
            # NOT A RETRY, and the same reasoning as `publish_instagram`'s: the
            # client already said yes, the server already said no, and trying
            # again between two model calls changes nothing. What comes back is
            # a sentence the face reads out to her.
            return FAILED.format(reason=exc, ticket_id=ticket_id)
        sender = store.sender()
        board.comment(ticket_id, sender, text, session_id=ctx.deps.session_id)
        board.move(ticket_id, board.DONE, said=text, session_id=ctx.deps.session_id)
        # OUR OWN MESSAGE GOES INTO `mail_seen` TOO: the customer's next answer
        # quotes THIS id in `In-Reply-To`, so without it the reply to our reply
        # opens a second ticket.
        store.remember(sent_id, ticket_id)
        store.remember_thread(
            ticket_id, thread["to_address"], thread["subject"], sent_id,
            mail_smtp.references(thread["reference_ids"], sent_id),
        )
        db.append_event(
            "mail.sent", f"Le contesté el mail a {thread['to_address']}: «{subject}»",
            "completed", ctx.deps.session_id,
            {"ticket_id": ticket_id, "to": thread["to_address"]},
        )
        return SENT.format(to=thread["to_address"], subject=subject, ticket_id=ticket_id)

    return ts
