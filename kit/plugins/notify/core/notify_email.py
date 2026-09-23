"""The email channel: Resend's HTTP API, from our domain, to the owner.

FROM OUR DOMAIN AND NOT THE CLIENT'S. Sending from the company's own inbox
needs its credentials (the `mail` plugin's IMAP/SMTP, or Google's OAuth), and a
notice to the owner does not deserve that: it goes out as
`"<agent name> <avisos@tuagente.uy>"` and the owner reads it as her agent
writing. One key for the whole fleet, in each instance's `secrets.env`.

THE MAIL CARRIES LITTLE. What is waiting and a link to it: the draft, the
message, the reply stay in the portal. What passes through Resend is a subject
and a few lines, which is also what fits on a phone's lock screen.

THE LINKS NEVER CARRY A HASH: that is where the portal's credential travels
(`docs/portal-routes.md`). A link is a route; the browser that already signed
in opens it.
"""

import html
import os

import httpx

from core import identity

API = "https://api.resend.com/emails"
KEY = os.environ.get("RESEND_API_KEY", "").strip()
FROM = os.environ.get("NOTIFY_FROM", "avisos@tuagente.uy").strip()
PORTAL = os.environ.get("PORTAL_URL", "http://localhost:8090").rstrip("/")

# Read by the owner, at the foot of every mail.
OPEN = "Lo ves acá: {link}"


def url(route: str) -> str:
    return PORTAL + route


def post(payload: dict) -> None:
    """The one network call, swapped out in the tests."""
    r = httpx.post(API, json=payload, headers={"Authorization": f"Bearer {KEY}"}, timeout=20)
    r.raise_for_status()


def body(text: str, link: str | None, name: str) -> tuple[str, str]:
    """The plain text and its HTML twin, signed with the agent's name."""
    parts = [text] + ([OPEN.format(link=link)] if link else []) + [name]
    plain = "\n\n".join(parts)
    paragraphs = ["<p>" + html.escape(text).replace("\n", "<br>") + "</p>"]
    if link:
        paragraphs.append(f'<p><a href="{html.escape(link)}">Abrir en el portal</a></p>')
    paragraphs.append(f"<p>{html.escape(name)}</p>")
    return plain, "\n".join(paragraphs)


def send(to: str, subject: str, text: str, link: str | None) -> None:
    name = identity.load()["name"]
    plain, rich = body(text, link, name)
    post({
        "from": f"{name} <{FROM}>",
        "to": [to],
        "subject": subject,
        "text": plain,
        "html": rich,
    })
