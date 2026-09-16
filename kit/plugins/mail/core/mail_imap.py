"""Reading the mailbox: IMAP, and turning a message into something readable.

Nothing in here decides anything about the board — that is `mail_tools.py`.
This file opens the folder, hands back what is unread, renders each message the
way a person would read it, and marks it `\\Seen` when it is told to.

**WHAT IS FETCHED IS `UNSEEN`, OLDEST FIRST, CAPPED AT 20.** The cap is what
keeps one tick from being an afternoon: a backlog drains twenty at a time, in
the order the messages arrived, so nobody waits longer than the person before
them. And the flag is set AFTER the ticket exists, never by the fetch itself
(`BODY.PEEK[]`): a message marked read by a tick that then died is a message
nobody will ever see again.

**THE BODY IS TEXT, AND THE CODE IS WHAT MAKES IT TEXT.** `text/plain` when the
message has one; otherwise `text/html` run through the stdlib's `html.parser` —
no dependency, and nothing that tries to be a browser. What the model reads is
what a person would read; the markup is not information about the client's
customer.

**WHAT IS DISCARDED IS DISCARDED BY CODE, BEFORE THE MODEL SEES IT.** Four
headers say "nobody wrote this to you" — `List-Unsubscribe`, `Auto-Submitted`,
`Precedence: bulk|list|junk`, and our own address as the sender. Asking the
model to recognise a newsletter is asking it to be right every five minutes
forever; asking it not to answer a mail it never saw is free. The rest —
"is this worth answering" — is the skill's, where judgement belongs.
"""

import email
import email.utils
import hashlib
import imaplib
import re
from contextlib import contextmanager
from dataclasses import dataclass, field
from email.header import decode_header, make_header
from email.message import Message
from html.parser import HTMLParser
from pathlib import Path
from zoneinfo import ZoneInfo

import mail_store as store
from core import config

# How many messages one tick may take. Twenty is the plan's number: a run that
# reads a hundred mails is a run that costs a hundred mails' worth of tokens
# before anybody decided it should.
LIMIT = 20

# Every `<id@host>` in a header. `In-Reply-To` carries one and `References`
# carries the whole chain; both are parsed the same way, so a client that
# writes only one of them still threads.
MESSAGE_ID = re.compile(r"<[^<>@\s]+@[^<>\s]+>")

# What the client reads on the ticket of a mail nobody wrote her. Spanish: it
# is the comment the discarded ticket closes with.
DISCARDS = {
    "list": "es de una lista de correo (List-Unsubscribe)",
    "auto": "es un mensaje automático (Auto-Submitted)",
    "bulk": "viene marcado como correo masivo (Precedence: {value})",
    "ours": "lo mandamos nosotros",
}

# The characters a file name may not carry into the workspace. An attachment's
# name is written by whoever sent the mail, and it lands on the client's disk.
UNSAFE = re.compile(r"[^\w.\- ]+", re.UNICODE)

# Where the attachments of a ticket's mails live, under the workspace. The
# client reads them in the Files tab and the portal turns the path into a chip.
ATTACHMENTS = "correo"


@dataclass
class Mail:
    """One message, already readable. Everything a ticket needs and no headers."""

    uid: bytes
    message_id: str
    sender: str            # the display name and the address, as it was written
    address: str           # the bare address, which is who an answer goes to
    subject: str
    when: str              # dd/mm/YYYY HH:MM on the business's clock
    text: str              # the body, as a person reads it
    parents: list[str]     # every id this message answers, oldest first
    discard: str | None    # why nobody should answer it, or None
    attachments: list[tuple[str, bytes]] = field(default_factory=list)


# ── the folder ──────────────────────────────────────────────────────────────


@contextmanager
def mailbox():
    """The folder the agent reads, open, logged in and selected.

    `EMAIL_TLS=0` is a plain `IMAP4` with no encryption anywhere: that is the
    lab's stub and nothing else, and it is a variable and not a hostname rule
    on purpose — a rule that reads the host name is a rule that one day lets a
    real mailbox through in the clear.
    """
    host, port = store.imap_host()
    conn = imaplib.IMAP4_SSL(host, port) if store.tls() else imaplib.IMAP4(host, port)
    try:
        conn.login(store.address(), store.password())
        # Quoted: on Gmail a label is a folder and a label has spaces in it.
        conn.select(f'"{store.folder()}"')
        yield conn
    finally:
        try:
            conn.logout()
        except OSError:
            # The mailbox is already gone; there is nothing left to close and
            # nothing the client could do about it either way.
            pass


def unseen(conn, limit: int = LIMIT) -> list[bytes]:
    """The unread messages, oldest first, at most `limit`."""
    _, data = conn.search(None, "UNSEEN")
    return data[0].split()[:limit]


def mark_seen(conn, uid: bytes) -> None:
    """After the ticket exists, and only then."""
    conn.store(uid, "+FLAGS", "\\Seen")


# ── one message, read the way a person reads it ─────────────────────────────


class Plain(HTMLParser):
    """An HTML body as text. The stdlib's parser and nothing else."""

    SKIP = {"script", "style", "head"}
    BREAK = {"p", "br", "div", "tr", "li", "h1", "h2", "h3", "h4", "h5", "h6", "table"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.skipping = 0

    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP:
            self.skipping += 1
        elif tag in self.BREAK:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in self.SKIP and self.skipping:
            self.skipping -= 1
        elif tag in self.BREAK:
            self.parts.append("\n")

    def handle_data(self, data):
        if not self.skipping:
            self.parts.append(data)


def plain(html: str) -> str:
    parser = Plain()
    parser.feed(html)
    return tidy("".join(parser.parts))


def tidy(text: str) -> str:
    """No trailing spaces, no run of more than one blank line."""
    lines = [line.rstrip() for line in text.replace("\r\n", "\n").split("\n")]
    out: list[str] = []
    for line in lines:
        if not line and out and not out[-1]:
            continue
        out.append(line)
    return "\n".join(out).strip()


def decoded(value: str | None) -> str:
    """A header, with its `=?utf-8?…?=` words turned back into words."""
    if not value:
        return ""
    return str(make_header(decode_header(value))).strip()


def part_text(part: Message) -> str:
    charset = part.get_content_charset() or "utf-8"
    return part.get_payload(decode=True).decode(charset, errors="replace")


def body_and_files(message: Message) -> tuple[str, list[tuple[str, bytes]]]:
    """The text of the message and whatever came attached to it.

    `text/plain` wins over `text/html` wherever both exist, which is what a
    multipart/alternative is: the same thing said twice.
    """
    texts: list[str] = []
    htmls: list[str] = []
    files: list[tuple[str, bytes]] = []
    for part in message.walk():
        if part.get_content_maintype() == "multipart":
            continue
        name = decoded(part.get_filename())
        if name or part.get_content_disposition() == "attachment":
            files.append((safe_name(name), part.get_payload(decode=True) or b""))
            continue
        if part.get_content_type() == "text/plain":
            texts.append(part_text(part))
        elif part.get_content_type() == "text/html":
            htmls.append(part_text(part))
    text = tidy("\n\n".join(texts)) if texts else plain("\n".join(htmls))
    return text, files


def safe_name(name: str) -> str:
    """A file name written by a stranger, made safe to put on the client's disk."""
    name = Path(name or "adjunto").name
    return UNSAFE.sub("-", name).strip(" .-") or "adjunto"


def when_of(message: Message) -> str:
    """The date, on the business's clock, the way every other date in the
    portal is written. A mail with no readable `Date` is dated by nobody: the
    field stays empty rather than saying today."""
    raw = message.get("Date")
    if not raw:
        return ""
    stamp = email.utils.parsedate_to_datetime(raw)
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=ZoneInfo(config.TIMEZONE))
    return stamp.astimezone(ZoneInfo(config.TIMEZONE)).strftime("%d/%m/%Y %H:%M")


def parents_of(message: Message) -> list[str]:
    """Every message this one answers, oldest first, with no repeats."""
    chain: list[str] = []
    for header in ("References", "In-Reply-To"):
        for found in MESSAGE_ID.findall(message.get(header) or ""):
            if found not in chain:
                chain.append(found)
    return chain


def discard_reason(message: Message, address: str, ours: str) -> str | None:
    """Why nobody should answer this, or `None` if somebody should."""
    if message.get("List-Unsubscribe"):
        return DISCARDS["list"]
    auto = (message.get("Auto-Submitted") or "").strip().lower()
    if auto and not auto.startswith("no"):
        return DISCARDS["auto"]
    precedence = (message.get("Precedence") or "").strip().lower()
    if precedence in ("bulk", "list", "junk"):
        return DISCARDS["bulk"].format(value=precedence)
    if address and address.lower() == ours.lower():
        return DISCARDS["ours"]
    return None


def read(conn, uid: bytes, ours: str) -> Mail:
    """One message, whole, without marking it read."""
    _, data = conn.fetch(uid, "(BODY.PEEK[])")
    raw = data[0][1]
    message = email.message_from_bytes(raw)
    display, address = email.utils.parseaddr(message.get("From") or "")
    display = decoded(display)
    text, files = body_and_files(message)
    return Mail(
        uid=uid,
        message_id=message_id_of(message, raw),
        sender=f"{display} <{address}>" if display else address,
        address=address,
        subject=decoded(message.get("Subject")) or "(sin asunto)",
        when=when_of(message),
        text=text,
        parents=parents_of(message),
        discard=discard_reason(message, address, ours),
        attachments=files,
    )


def message_id_of(message: Message, raw: bytes) -> str:
    """The `Message-ID`, or one made from the bytes of the message.

    A mail without one is legal and rare, and it is the dedupe key of this whole
    plugin: with nothing there the board cannot tell two ticks apart, so the
    message's own content is what identifies it.
    """
    found = (message.get("Message-ID") or "").strip()
    return found or f"<sha256.{hashlib.sha256(raw).hexdigest()[:32]}@sin-message-id>"


# ── what a ticket says ──────────────────────────────────────────────────────


def body_of(mail: Mail) -> str:
    """The mail as the ticket's body: who wrote, when, and what they said."""
    return f"**De:** {mail.sender}\n**Fecha:** {mail.when}\n\n{mail.text}".strip()


def attachments_block(paths: list[str]) -> str:
    """The files, under the body, as paths the portal turns into chips."""
    listed = "\n".join(f"- `{path}`" for path in paths)
    return f"\n\n**Adjuntos:**\n{listed}"


def save_attachments(workspace: Path, ticket_id: str, mail: Mail) -> list[str]:
    """The attachments on disk, under the ticket they arrived on.

    Returns the paths relative to the workspace, which is what the body lists
    and what the Files tab opens.
    """
    if not mail.attachments:
        return []
    directory = workspace / ATTACHMENTS / ticket_id
    directory.mkdir(parents=True, exist_ok=True)
    saved = []
    for name, data in mail.attachments:
        target = directory / name
        target.write_bytes(data)
        saved.append(str(target.relative_to(workspace)))
    return saved
