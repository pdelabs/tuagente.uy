"""What arrives, what the run reads, and the one tool that answers.

INGEST IS CODE. Every event the bridge pushes lands in `ingest()`: written down
once (`whatsapp_events` is the dedupe), the chat brought up to date, the message
kept, and the Bandeja ticket written — by code, the way the Instagram DMs are
(`instagram/core/ig_tools.py`'s `land`): a person who writes to a business is a
conversation by definition, so there is nothing for the model to decide and
nothing for it to remember. The webhook then POKES the flow
(`scheduler.poke`), so the run starts seconds after the message and not on the
next 30-second look.

THE PERSON IS THE UNIT, NOT THE MESSAGE — the rule the Instagram DMs paid for on
16/9/2026. The watcher hands the run every chat with something new WHOLE: the
last messages oldest first, ours named «Vos», the owner's own named as hers, the
new ones marked, the ticket and its column.

ANSWERING GOES OUT AT ONCE, with no yes in between — Luis, 24/9/2026, for every
channel: a person writing is a person waiting. What keeps an answer from being a
mistake is the skill (`skills/whatsapp/SKILL.md`: what is the owner's goes to the
board unanswered), and what code CAN hold it holds here:

- ONE ANSWER PER MESSAGE. `send_whatsapp` sends only when the last thing in the
  chat is the person's; an answer that already went out is quoted back and
  nothing leaves. What the person writes next opens the door again.
- THE OWNER'S TAKEOVER. A message the OWNER types on her own phone
  (`origin: owner_phone`) means she is answering that chat herself: for
  `WHATSAPP_TAKEOVER_MINUTES` (120) after her last one, the watcher does not
  hand the chat to a run and `send_whatsapp` refuses it. Her message also marks
  what the person had written as dealt with — she answered it — and the portal
  can end the takeover early (`POST /portal/whatsapp/chats/{jid}/resume`).
- NOBODY IS WRITTEN TO FIRST. The tool takes a chat the agent already has, and
  the bridge refuses anything that is not a one-to-one chat.

HOW A TICKET'S THREAD IS SIGNED, which is how the Inbox tells the two sides
apart (`app/app/inbox/conversation.ts`): the person's messages carry their
PHONE (`+598…`, or their name when WhatsApp hid the number), what the agent
sent carries `agente`, and what the owner typed on her phone carries `cliente`.
"""

import logging
import os
import time
from datetime import datetime
from zoneinfo import ZoneInfo

from pydantic_ai import ModelRetry, RunContext
from pydantic_ai.toolsets import FunctionToolset

import board_store as board
import wa_bridge
import wa_store
from core import config, db, scheduler

log = logging.getLogger(__name__)

# The name the curated flow asks for (`event:`), and how often the scheduler
# looks when nothing pushed. The push is what makes it fast; this is the net.
WATCHER = "whatsapp.inbox"
WATCH_EVERY = 30

# What this plugin calls itself on the board, and the ticket is keyed by the
# chat's phone JID: one person, one ticket.
SOURCE = "whatsapp"

# How much of a chat the run reads.
SHOWN = 12

# Seconds of «escribiendo…» before an answer goes out.
TYPING_SECONDS = 2

# The states in which the number is LINKED — the connection exists, even while
# the socket reconnects. `unpaired`, `pairing`, `logged_out` and `banned` are
# not: there is nothing to answer through.
LINKED = ("connected", "connecting", "disconnected")


def takeover_minutes() -> int:
    return int(os.environ.get("WHATSAPP_TAKEOVER_MINUTES", "120"))


# ── Spanish: what the client reads, or the model on her behalf ──────────────

KINDS = {
    "image": "una foto", "video": "un video", "document": "un documento",
    "audio": "un audio", "sticker": "un sticker", "location": "una ubicación",
    "contact": "un contacto",
}
TITLE = "Mensaje de {name} por WhatsApp"
BODY = "**Fecha:** {when}\n\n{text}"
NO_CHAT = (
    "No tengo ninguna conversación de WhatsApp {chat}. Las que podés contestar son "
    "las que te llegaron en «Lo que llegó», con el id tal cual."
)
NO_MESSAGE = "En esa conversación no hay ningún mensaje {message_id} para citar."
EMPTY = "El mensaje está vacío: escribí lo que le querés contestar."
TAKEN_OVER = (
    "A {name} lo está atendiendo tu cliente desde su teléfono, hasta las {until}. "
    "No mandé nada: no te metas en esa conversación."
)
ALREADY = (
    "A {name} ya le contestaste: «{text}». No salió nada. Si vuelve a escribir, "
    "le contestás lo nuevo."
)
OWNER_ANSWERED = (
    "A {name} ya le contestó tu cliente desde su teléfono. No salió nada."
)
SENT = "Le contesté a {name} por WhatsApp. Ya le llegó."
NOT_CONNECTED = "No está conectado tu WhatsApp, así que no salió nada."
SLOW_DOWN = (
    "WhatsApp pidió que bajemos el ritmo, así que por media hora no mando nada. "
    "No salió nada: dejalo en el tablero para tu cliente."
)
FAILED = "No pude mandar el mensaje por WhatsApp: {reason}. No salió nada."

SENT_EVENT = "whatsapp.sent"
SENT_LABEL = "Le contesté a {name} por WhatsApp: «{text}»"
TAKEN_EVENT = "whatsapp.taken_over"
TAKEN_LABEL = "Estás atendiendo vos a {name}: no le contesto hasta las {until}"
RESUMED_EVENT = "whatsapp.resumed"
RESUMED_LABEL = "Vuelvo a atender yo a {name} por WhatsApp"
CONNECTION_EVENT = "whatsapp.connection"
PAIRED_LABEL = "Quedó conectado tu WhatsApp: desde ahora contesto los mensajes que lleguen"
LOGGED_OUT_LABEL = (
    "Se desvinculó tu WhatsApp y dejé de contestar ahí. Para volver, escaneá el "
    "código de nuevo desde el portal"
)
BANNED_LABEL = "WhatsApp frenó el número por un tiempo: hasta que lo libere no puedo contestar"


def flat(text) -> str:
    return " ".join(str(text or "").split())


def clock(stamp: float) -> str:
    return datetime.fromtimestamp(stamp, ZoneInfo(config.TIMEZONE)).strftime("%H:%M")


def when_of(stamp: float) -> str:
    return datetime.fromtimestamp(stamp, ZoneInfo(config.TIMEZONE)).strftime("%d/%m/%Y %H:%M")


def shown(kind: str, text: str) -> str:
    """A message as words: its text, or what it was when it had none."""
    if kind == "text":
        return text
    what = f"[Mandó {KINDS.get(kind, 'algo que no es texto')}]"
    return f"{what} {text}".strip()


def signature(row) -> str:
    """Who a person's message is signed as on the ticket: their phone."""
    return row["phone"] or wa_store.name_of(row)


# ── the connection ──────────────────────────────────────────────────────────


def connected() -> bool:
    """Whether a number is linked, for a flow that names `whatsapp`. A bridge
    that does not answer is a number nobody can answer through."""
    try:
        return wa_bridge.status()["state"] in LINKED
    except wa_bridge.BridgeError:
        return False


# ── the ticket IS the conversation, and code writes it ──────────────────────


def ticket_of(jid: str):
    return board.by_source(SOURCE, jid)


def on_board(chat, origin: str, text: str, when: float) -> None:
    """One message onto the chat's ticket.

    The person's first message OPENS it (its body), every later one is a comment
    and REOPENS it if it was closed or left for the owner — somebody is waiting
    again. The owner's own message closes it: she answered. What the agent sent
    is written by `send_whatsapp`.
    """
    jid = chat["jid"]
    if origin == "contact":
        ticket_id, opened = board.create(
            title=TITLE.format(name=wa_store.name_of(chat)),
            body=BODY.format(when=when_of(when), text=text),
            source=SOURCE, source_ref=jid,
        )
        if opened:
            return
        board.comment(ticket_id, signature(chat), text)
        if board.row_of(ticket_id)["status"] != board.READY:
            board.move(ticket_id, board.READY)
        return
    found = ticket_of(jid)
    if found is None:
        return
    board.comment(found["id"], board.CLIENT, text)
    if found["status"] != board.DONE:
        board.move(found["id"], board.DONE)


def ticket_extra(jid: str) -> dict:
    """What a WhatsApp ticket carries besides the board's own fields, so the
    Inbox draws the chat list with no request per row (`board_store.EXTRA`)."""
    row = wa_store.chat(jid)
    if row is None:
        return {}
    until = row["taken_over_until"]
    return {
        "name": wa_store.name_of(row),
        "phone": row["phone"],
        "taken_over_until": int(until) if until and until > time.time() else None,
    }


# ── what the bridge pushes ──────────────────────────────────────────────────


def ingest(event: dict) -> bool:
    """One event from the bridge, written down once. True when a flow run may
    have something to do now — the webhook pokes the watcher on it."""
    kind = event["type"]
    if not wa_store.first_time(event["event_id"], event.get("seq"), kind):
        return False
    if kind == "message.received":
        return received(event)
    if kind == "message.revoked":
        wa_store.revoke(event["chat_jid"], event["message_id"])
    elif kind == "message.edited":
        wa_store.edit(event["chat_jid"], event["message_id"], event.get("text") or "")
    elif kind == "pairing.updated" and event.get("state") == "completed":
        db.append_event(CONNECTION_EVENT, PAIRED_LABEL, "completed", None, {"state": "connected"})
    elif kind == "connection.changed" and event.get("state") in ("logged_out", "banned"):
        label = LOGGED_OUT_LABEL if event["state"] == "logged_out" else BANNED_LABEL
        db.append_event(CONNECTION_EVENT, label, "error", None,
                        {"state": event["state"], "reason": event.get("reason")})
    return False


def received(event: dict) -> bool:
    jid = event["chat_jid"]
    origin = event["origin"]
    when = float(event.get("timestamp") or time.time())
    inbound = origin == "contact"
    wa_store.save_chat(jid, event.get("sender_phone"), event.get("contact_name"),
                       event.get("push_name") if inbound else None,
                       when if inbound else None)
    text = shown(event["kind"], event.get("text") or "")
    if not wa_store.add_message(jid, event["message_id"], origin, event["kind"], text,
                                event.get("reply_to"), when, handled=not inbound):
        return False
    chat = wa_store.chat(jid)
    on_board(chat, origin, text, when)
    if inbound:
        return not wa_store.taken_over(chat)
    # THE OWNER ANSWERED FROM HER PHONE: what the person had written is dealt
    # with, and the chat is hers for the next two hours.
    wa_store.handle_inbound(jid)
    was_hers = wa_store.taken_over(chat)
    until = time.time() + takeover_minutes() * 60
    wa_store.take_over(jid, until)
    if not was_hers:
        db.append_event(
            TAKEN_EVENT, TAKEN_LABEL.format(name=wa_store.name_of(chat), until=clock(until)),
            "completed", None, {"chat_jid": jid, "taken_over_until": int(until)},
        )
    return False


def catch_up() -> None:
    """What the bridge has that the push did not bring — the engine was down,
    or restarting. A ticker, so it is also the net under a lost push."""
    while True:
        found = wa_bridge.events_after(wa_store.last_seq())
        for event in found:
            ingest(event)
        if len(found) < 500:
            return


def resume(jid: str) -> bool:
    """The owner hands the chat back before the clock does. True when there is
    something waiting for the agent to answer."""
    chat = wa_store.chat(jid)
    wa_store.release(jid)
    db.append_event(RESUMED_EVENT, RESUMED_LABEL.format(name=wa_store.name_of(chat)),
                    "completed", None, {"chat_jid": jid})
    return jid in wa_store.open_chats()


# ── what the run reads ──────────────────────────────────────────────────────


def said_by(row, chat) -> str:
    if row["origin"] == "agent":
        return "Vos"
    if row["origin"] == "owner_phone":
        return "Tu cliente, desde su teléfono"
    return wa_store.name_of(chat)


def ticket_line(jid: str) -> str:
    found = ticket_of(jid)
    if found is None:
        return "sin tarea"
    if found["status"] == board.BLOCKED:
        return (f"tarea {found['id']} (la dejaste para tu cliente: leela con "
                "`read_ticket` antes de contestar nada)")
    return f"tarea {found['id']} ({board.COLUMN[found['status']]})"


def listing(jid: str, new: set[str]) -> str:
    chat = wa_store.chat(jid)
    phone = f" ({chat['phone']})" if chat["phone"] else ""
    lines = [f"- `{jid}` · {wa_store.name_of(chat)}{phone} · {ticket_line(jid)}"]
    for row in wa_store.thread(jid, SHOWN):
        mark = f" (nuevo · id `{row['message_id']}`)" if row["message_id"] in new else ""
        lines.append(f"  {said_by(row, chat)}: «{flat(row['text'])}»{mark}")
    return "\n".join(lines)


def watch() -> str | None:
    """Every chat with something new from the person, whole, or `None`. NO MODEL:
    the scheduler calls it, and a flow only becomes a turn when it answers
    something. What it hands over is marked dealt with here — between the look
    and the run, the flow's pending row is the only place it exists.

    A chat the owner took over is skipped and its messages stay open: if she
    answers them, her answer closes them; if the takeover ends first, the next
    look brings them.
    """
    now = time.time()
    blocks, total = [], 0
    for jid in wa_store.open_chats():
        if wa_store.taken_over(wa_store.chat(jid), now):
            continue
        new = set(wa_store.handle_inbound(jid))
        total += len(new)
        blocks.append(listing(jid, new))
    if not blocks:
        return None
    head = ("1 mensaje nuevo de WhatsApp, en esta conversación:" if total == 1
            else f"{total} mensajes nuevos de WhatsApp, en estas conversaciones:")
    return head + "\n\n" + "\n\n".join(blocks)


# ── the tool ────────────────────────────────────────────────────────────────


def waiting_ids(jid: str) -> list[str]:
    """The person's messages since the last thing our side said: what an answer
    answers, and what is marked read when it goes out."""
    ids = []
    for row in reversed(wa_store.thread(jid, SHOWN)):
        if row["origin"] != "contact":
            break
        ids.append(row["message_id"])
    return ids


def toolset() -> FunctionToolset:
    ts = FunctionToolset()

    @ts.tool
    def send_whatsapp(ctx: RunContext, chat: str, text: str, reply_to: str | None = None) -> str:
        """Contestarle a alguien por WhatsApp. SALE EN EL MOMENTO.

        Le llega a la persona desde el número de tu cliente. Nadie lo lee antes
        que ella: llamala sólo cuando la skill `whatsapp` dice que esa respuesta
        la das vos. Si no estás seguro, si pide un precio que la marca no
        publica, si es una queja, un reembolso o algo que tiene que decidir tu
        cliente, NO la llames: dejá la tarea de esa conversación para él.

        Una respuesta por mensaje: si ya le contestaste y no volvió a escribir,
        no sale nada y te lo digo. Si tu cliente está atendiendo esa
        conversación desde su teléfono, tampoco. La tarea del tablero la escribo
        y la cierro yo, y lo que salió queda en la Actividad.

        Args:
            chat: el id de la conversación tal cual vino, con su `@`.
            text: la respuesta, corta, con la voz de la marca.
            reply_to: el id de un mensaje de esa persona, sólo si hace falta
                citarlo porque escribió varias cosas y contestás una.
        """
        row = wa_store.chat(chat)
        if row is None:
            raise ModelRetry(NO_CHAT.format(chat=chat))
        if reply_to and wa_store.message(chat, reply_to) is None:
            raise ModelRetry(NO_MESSAGE.format(message_id=reply_to))
        message = text.strip()
        if not message:
            raise ModelRetry(EMPTY)
        name = wa_store.name_of(row)
        if wa_store.taken_over(row):
            return TAKEN_OVER.format(name=name, until=clock(row["taken_over_until"]))
        last = wa_store.last_message(chat)
        if last["origin"] == "agent":
            return ALREADY.format(name=name, text=flat(last["text"]))
        if last["origin"] == "owner_phone":
            return OWNER_ANSWERED.format(name=name)
        answered = waiting_ids(chat)
        try:
            wa_bridge.typing(chat)
            time.sleep(TYPING_SECONDS)
            sent = wa_bridge.send(chat, message, reply_to)
        except wa_bridge.BridgeError as exc:
            if exc.status in (502, 503):
                scheduler.could_not(ctx.deps.session_id, NOT_CONNECTED)
                return NOT_CONNECTED
            if exc.status == 429:
                return SLOW_DOWN
            return FAILED.format(reason=exc)
        wa_store.add_message(chat, sent["message_id"], "agent", "text", message, reply_to,
                             float(sent.get("timestamp") or time.time()), handled=True)
        try:
            # The blue ticks: what this answer answered, read. It already went
            # out, so a receipt that fails is a line in the log and not a
            # failure of the answer.
            wa_bridge.read(chat, answered)
        except wa_bridge.BridgeError as exc:
            log.warning("whatsapp: read receipt for %s failed: %s", chat, exc)
        db.append_event(
            SENT_EVENT, SENT_LABEL.format(name=name, text=message), "completed",
            ctx.deps.session_id,
            {"chat_jid": chat, "message_id": sent["message_id"], "text": message},
        )
        found = ticket_of(chat)
        if found is not None:
            board.comment(found["id"], board.AGENT, message, session_id=ctx.deps.session_id)
            board.move(found["id"], board.DONE, said=message, session_id=ctx.deps.session_id)
        return SENT.format(name=name)

    return ts
