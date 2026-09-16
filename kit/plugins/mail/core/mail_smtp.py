"""Answering: SMTP, and the three headers that make it a reply and not a mail.

One function, and everything it needs comes off the ticket's thread — the
recipient, the subject, the ids to quote. Nothing here is an argument the model
supplies (`mail_tools.py`'s `send_email` has no `to`), so there is no way to
answer somebody who never wrote.

**`In-Reply-To` AND `References` ARE WHAT MAKE IT THREAD.** Without them the
answer lands in the customer's mailbox as a new conversation next to the one
they started, and two weeks later nobody can tell what was answered. `Subject:
Re: …` alone does not do it: it is what the client SEES, and the ids are what
the client's mail program reads.

**IT GOES OUT AS `EMAIL_FROM`.** Usually the company's address (`info@…`) even
when the mailbox being read is somebody's Gmail, because that is the shape the
product sells: mail to the company, answered by the company. Gmail refuses a
`From` it has not verified as a send-as alias, and that refusal is the
provider's, so it travels to the client in the provider's own words.
"""

import smtplib
from email.message import EmailMessage
from email.utils import formatdate, make_msgid

import mail_store as store

# What comes back when the provider says no, in the provider's words. Nothing
# here is in a position to summarise «Username and Password not accepted» or
# «Mail from must equal authorized user».
FAILED = "el servidor de correo no lo aceptó: {reason}"


class Refused(RuntimeError):
    """The mail server said no. The message travels to the client untranslated."""


def reply_subject(subject: str) -> str:
    """`Re: …`, once. A subject that already answers something is not answered
    twice: «Re: Re: Re: consulta» is what a client reads as a robot."""
    subject = subject.strip()
    return subject if subject[:3].lower() == "re:" else f"Re: {subject}"


def references(previous: str, last_message_id: str | None) -> str:
    """The `References` header that goes out: the whole chain, oldest last."""
    chain = previous.split()
    if last_message_id and last_message_id not in chain:
        chain.append(last_message_id)
    return " ".join(chain)


def send(
    to_address: str,
    subject: str,
    body: str,
    last_message_id: str | None = None,
    reference_ids: str = "",
) -> tuple[str, str]:
    """The reply, sent. Answers the subject that went out and its Message-ID.

    The id comes back because it is the next message's parent: the customer's
    answer to this one carries it in `In-Reply-To`, and that is how the NEXT
    tick finds this ticket (`mail_store.remember`).
    """
    sender = store.sender()
    host, port = store.smtp_host()

    message = EmailMessage()
    message["From"] = sender
    message["To"] = to_address
    message["Subject"] = reply_subject(subject)
    message["Date"] = formatdate(localtime=True)
    message["Message-ID"] = make_msgid(domain=sender.rpartition("@")[2] or None)
    if last_message_id:
        message["In-Reply-To"] = last_message_id
    chain = references(reference_ids, last_message_id)
    if chain:
        message["References"] = chain
    message.set_content(body)

    try:
        with smtplib.SMTP(host, port, timeout=30) as smtp:
            if store.tls():
                smtp.starttls()
            smtp.login(store.address(), store.password())
            smtp.send_message(message)
    except (smtplib.SMTPException, OSError) as exc:
        raise Refused(FAILED.format(reason=" ".join(str(exc).split())[:300])) from None
    return message["Subject"], message["Message-ID"]
