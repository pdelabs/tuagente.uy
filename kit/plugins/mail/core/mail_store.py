"""The connection, and what the plugin remembers about a thread.

Two things live here because both halves of the plugin — the one that reads
(`mail_imap.py`) and the one that answers (`mail_smtp.py`) — need both, and a
module that belonged to either one would be imported sideways by the other.

**THE CONNECTION IS READ AT CALL TIME, NEVER AT IMPORT.** A missing variable is
`NotConnected`, whose message is Spanish and is the one sentence of this plugin
the client reads: it is not a guard against a bug, it is the connection not
being set up, which is the state every agent is in until its client hands over
the mailbox. Same shape as `social/core/instagram.py`.

    EMAIL_ADDRESS     the IMAP/SMTP login. On Gmail and on every provider
                      worth having it is the full address, which is why it
                      is named this and why it is what `EMAIL_FROM` falls
                      back to; a server whose login is the local part (the
                      lab's stub is one) takes the local part here
    EMAIL_PASSWORD    its password. On Gmail, an app password
    EMAIL_IMAP_HOST   host[:port] — 993 by default, over SSL
    EMAIL_SMTP_HOST   host[:port] — 587 by default, STARTTLS
    EMAIL_FROM        the address the replies go out as (`info@…`). Defaults to
                      EMAIL_ADDRESS, because most mailboxes are their own sender
    EMAIL_FOLDER      the IMAP folder to read. `INBOX` by default; on Gmail a
                      LABEL is a folder, which is how the agent reads what was
                      filtered to it and not the client's whole mailbox
    EMAIL_TLS         `0` for a plain IMAP/SMTP with no TLS at all. The lab's
                      stub (`greenmail`) is that, and it is decided by a
                      variable and not by the hostname: a rule that reads a host
                      name is a rule that one day lets a real mailbox through

**TWO TABLES, MADE WHEN THIS MODULE IS IMPORTED**, which is when the plugin
loads — in the engine's own SQLite, through `core/db.py`, exactly like the
board's. An engine without `mail` has neither.

`mail_seen(message_id, ticket_id, seen_at)` is the second lock under IMAP's
`\\Seen` flag, and it is more than a lock: it is the map from a Message-ID to
the ticket that message ended up on, which is how a REPLY finds its thread. The
id of every message we send goes in it too, because the next answer from the
client's customer quotes ours in `In-Reply-To`, not theirs.

`mail_threads(ticket_id, to_address, subject, last_message_id, reference_ids)`
is what `send_email` answers INTO: the recipient and the subject are written by
the code when the mail arrives, so the model never supplies either.

THE TWO COLUMNS THAT ARE NOT SPELLED THE WAY THE HEADERS ARE: `to_address` and
`reference_ids`. `REFERENCES` is SQL's own word and `TO` reads like one; a
column that has to be quoted forever is a column named wrong once.
"""

import logging
import os
import time

from core import db

log = logging.getLogger(__name__)

# What the client reads when the mailbox is not connected — the model repeats
# it to her. It used to name the variable (`EMAIL_ADDRESS`), and the QA client
# read «falta conectar el correo (EMAIL_ADDRESS)» in Activity. The name is for
# whoever sets it up, and it goes to the log.
MISSING = "El correo de la empresa todavía no está conectado."

# Where a mail's ticket says it came from (`board_store`'s `source`). The pair
# `(mail, <Message-ID>)` is the board's UNIQUE index, so finding the same
# message twice answers with the ticket that is already there.
SOURCE = "mail"

IMAP_PORT = 993
SMTP_PORT = 587

SCHEMA = (
    """
    CREATE TABLE IF NOT EXISTS mail_seen (
        message_id TEXT PRIMARY KEY,
        ticket_id  TEXT NOT NULL,
        seen_at    REAL NOT NULL
    )
    """,
    "CREATE INDEX IF NOT EXISTS mail_seen_by_ticket ON mail_seen(ticket_id)",
    """
    CREATE TABLE IF NOT EXISTS mail_threads (
        ticket_id       TEXT PRIMARY KEY,
        to_address      TEXT NOT NULL,
        subject         TEXT NOT NULL,
        last_message_id TEXT,
        reference_ids   TEXT NOT NULL DEFAULT ''
    )
    """,
)

for statement in SCHEMA:
    db.write(statement)


class NotConnected(RuntimeError):
    """The mailbox is not set up on this agent.

    NOT a failure and not a bug: an agent whose client bought the capability and
    has not handed over the mailbox yet is in a state the product has, and the
    message is written for the client, because she is the one who has to do
    something about it.
    """


# ── the connection ──────────────────────────────────────────────────────────


def env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        log.warning("mail: %s is not set", name)
        raise NotConnected(MISSING)
    return value


# The four without which neither half can work: what `connected()` means.
# `EMAIL_FROM`, `EMAIL_FOLDER` and `EMAIL_TLS` all have a default.
REQUIRED = ("EMAIL_ADDRESS", "EMAIL_PASSWORD", "EMAIL_IMAP_HOST", "EMAIL_SMTP_HOST")


def connected() -> bool:
    """Whether the mailbox is set up, for a flow that names `email`
    (`engine.provide("connection.email", ...)`). Read now, like everything
    else here: a secret added and a restart later, the answer changes."""
    return all(os.environ.get(name, "").strip() for name in REQUIRED)


def address() -> str:
    return env("EMAIL_ADDRESS")


def password() -> str:
    return env("EMAIL_PASSWORD")


def sender() -> str:
    """The address the answers go out as. The mailbox itself unless the client
    replies as another one — `info@` delivered into a personal Gmail is the
    usual shape, and Gmail has to have it verified as a send-as alias."""
    return os.environ.get("EMAIL_FROM", "").strip() or address()


def folder() -> str:
    """The IMAP folder the agent reads. On Gmail a label IS a folder, which is
    the mitigation for the one thing that breaks this plugin: a client who
    opens the mail on her phone first leaves it `\\Seen`, and the agent never
    sees it. A filter that labels what arrives at the company address, and this
    variable pointing at that label, is an inbox only the agent touches."""
    return os.environ.get("EMAIL_FOLDER", "").strip() or "INBOX"


def tls() -> bool:
    return os.environ.get("EMAIL_TLS", "1").strip() != "0"


def host_port(value: str, default: int) -> tuple[str, int]:
    """`host` or `host:port`. The port is the protocol's default when it is not
    written, which is what makes `smtp.gmail.com` a complete answer."""
    host, _, port = value.partition(":")
    return host.strip(), int(port) if port.strip() else default


def imap_host() -> tuple[str, int]:
    return host_port(env("EMAIL_IMAP_HOST"), IMAP_PORT)


def smtp_host() -> tuple[str, int]:
    return host_port(env("EMAIL_SMTP_HOST"), SMTP_PORT)


# ── what we already saw, and whose ticket it is ─────────────────────────────


def ticket_of(message_id: str) -> str | None:
    """The ticket a Message-ID landed on, ours or theirs."""
    row = db.one("SELECT ticket_id FROM mail_seen WHERE message_id = ?", (message_id,))
    return row["ticket_id"] if row else None


def remember(message_id: str, ticket_id: str) -> None:
    db.write(
        "INSERT INTO mail_seen (message_id, ticket_id, seen_at) VALUES (?, ?, ?)"
        " ON CONFLICT(message_id) DO UPDATE SET ticket_id = excluded.ticket_id",
        (message_id, ticket_id, time.time()),
    )


def thread(ticket_id: str):
    return db.one("SELECT * FROM mail_threads WHERE ticket_id = ?", (ticket_id,))


def remember_thread(
    ticket_id: str,
    to_address: str,
    subject: str,
    last_message_id: str | None,
    reference_ids: str = "",
) -> None:
    """Who the answer goes to, under what subject, quoting what.

    `reference_ids` is the `References` header as it will go out: every id of
    the conversation, oldest first, space-separated. Mail clients thread on it,
    so an answer that drops it starts a second conversation in the client's
    mailbox next to the first.
    """
    db.write(
        "INSERT INTO mail_threads (ticket_id, to_address, subject, last_message_id,"
        " reference_ids) VALUES (?, ?, ?, ?, ?)"
        " ON CONFLICT(ticket_id) DO UPDATE SET to_address = excluded.to_address,"
        " subject = excluded.subject, last_message_id = excluded.last_message_id,"
        " reference_ids = excluded.reference_ids",
        (ticket_id, to_address, subject, last_message_id, reference_ids),
    )
