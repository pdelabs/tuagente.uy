"""How the agent tells its owner something when the owner is not looking.

THE AGENT DOES THINGS ON ITS OWN — an event flow answers a comment, a run stops
at the gate — and until this existed the owner found out when she opened the
portal, if she did. A request that waits a day for an ok nobody knew was being
asked for is the agent failing quietly.

A CHANNEL IS A PLUGIN'S, the choice is the owner's. A plugin registers how to
send (`engine.notifier("email", send)`); the owner picks one at onboarding and
it is written in `identity.json` as `contact: {channel, value}`. `notify_owner`
joins the two. What gets said, and when, is also not here: the `notify` plugin
decides that (`kit/plugins/notify/`), and any other plugin may call
`notify_owner` through `engine.use("notify.owner")`.

EVERY ATTEMPT IS A LINE IN ACTIVITY: sent, skipped because the owner chose no
channel, or failed. A failed send also RAISES — a notice that did not go out is
one the caller has to try again, not one it gets to believe was delivered.

Telegram was the channel on the Hermes engine, where the bot WAS the agent.
It never existed on this one and was taken out on 2026-09-22.
"""

from collections.abc import Callable

from . import db, identity, session

# `send(to, subject, text, link)`: `to` is the `contact.value` the owner left
# (an address, for email), `link` a portal URL or `None`. SYNC, since what it
# does is HTTP; raises when it did not send.
Send = Callable[[str, str, str, str | None], None]

CHANNELS: dict[str, Send] = {}

# Read by the client in Activity.
SENT = "Te avisé por {channel}: {subject}"
NOT_CHOSEN = "No te avisé de «{subject}»: todavía no elegiste por dónde."
FAILED = "No pude avisarte por {channel} de «{subject}»: {reason}"
UNAVAILABLE = "este agente no tiene cómo mandar por ahí"
CHANNEL_NAMES = {"email": "mail"}


def register(name: str, send: Send) -> None:
    if name in CHANNELS:
        raise ValueError(f"two plugins registered the notify channel {name!r}")
    CHANNELS[name] = send


def available() -> list[str]:
    """What the portal may offer the owner: the channels this agent can use."""
    return sorted(CHANNELS)


def contact() -> dict:
    return identity.load().get("contact") or {}


def chosen() -> str | None:
    """The channel the owner picked, or `None` when they picked none."""
    channel = contact().get("channel")
    return None if channel in (None, "", "none") else channel


def notify_owner(subject: str, text: str, link: str | None = None) -> bool:
    """Send it through the owner's channel. `False` when they chose none."""
    who = contact()
    channel = chosen()
    if channel is None:
        db.append_event("notify", NOT_CHOSEN.format(subject=subject), "skipped")
        return False
    name = CHANNEL_NAMES.get(channel, channel)
    try:
        if channel not in CHANNELS:
            raise RuntimeError(UNAVAILABLE)
        CHANNELS[channel](who.get("value") or "", subject, text, link)
    except Exception as exc:
        db.append_event(
            "notify",
            FAILED.format(channel=name, subject=subject, reason=session.one_line(exc)),
            "error",
        )
        raise
    db.append_event("notify", SENT.format(channel=name, subject=subject), "completed")
    return True
