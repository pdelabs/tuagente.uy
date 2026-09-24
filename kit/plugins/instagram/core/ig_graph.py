"""The Graph calls this plugin makes: the feed, the comments, the numbers, the token.

**THE INSTAGRAM API WITH INSTAGRAM LOGIN**, `graph.instagram.com` v21.0 — the
same door the social plugin publishes through: a professional account and a
long-lived USER token, no Facebook Page and no Page token. The token we have
carries `instagram_business_manage_comments`, which is what makes replying and
hiding possible without an app review of the account's own owner.

WHY THIS FILE EXISTS NEXT TO `social/core/instagram.py` INSTEAD OF IMPORTING
IT. Every enabled plugin's surface modules share ONE `sys.modules` namespace
and load in `CORE_PLUGINS` order (`core/plugins.py`): `import instagram` from
here would be a bet on who got there first, and the bet changes the day a
client buys the two capabilities in the other order. So publishing keeps its
own Graph module and reading has this one. What they DO share is the token, and
they share it the way this engine shares anything — by name:

    engine.provide("instagram.token", ig_store.current_token)
    engine.provide("instagram.token.refreshed", remember_token)

**THE ENV IS THE SEED AND THE TABLE IS THE CURRENT VALUE.** `IG_ACCESS_TOKEN`
comes from the instance's `secrets.env`, which lives outside the container and
cannot be written from in here; a refreshed token therefore goes into
`instagram_account` and every call reads the table first and the env second.
Before this, a refresh only touched `os.environ` of one process: a restart
threw the new token away and the sixty days were counted from a value nobody
could see.

**EVERY VARIABLE IS READ AT CALL TIME.** A missing one is `NotConnected`, whose
message is Spanish and is the one sentence in this file the client reads: it is
not a guard against a bug, it is the connection not being set up — the state
every agent is in until its client connects the account.

    IG_ACCESS_TOKEN   the long-lived user token. LASTS 60 DAYS
    IG_USER_ID        the Instagram professional account's id

`IG_USERNAME` IS NOT ONE OF THEM, and that is deliberate: it is a fact about the
token, not a decision the client makes. It is read once from `/me` and cached in
`instagram_account` (`ig_store.py`), and it is what tells our own replies apart
from a stranger's — the comments endpoint hands back the account's own answers
nested under the comment they answer.

**AND THE MESSAGES ARE HERE TOO**, which the connection's README said for a year
could not be: the Conversations API answers under STANDARD ACCESS on this
flavor — `GET /me/conversations?platform=instagram` came back `{"data": []}` on
our own account with the token we already had, no permission error — and what
Advanced Access buys is the same thing it buys for publishing, ANY client
connecting without a role in our Meta app. Two things gate it instead, and both
are the client's: a professional account, and «Permitir acceso a mensajes» on in
the Instagram app, which is a consumer setting no dashboard can see.

**THE FIELDS ARE THE DOCUMENTED ONES AND NOTHING ELSE** (Instagram API with
Instagram Login, «Conversations» and «Send Messages»): a conversation is `id`
and `updated_time`, a message is `id,created_time,from,to,message`, and `from`
is `{username, id}` — that id is the IGSID, which is what a reply is addressed
to. There is no `participants` field on this flavor and no `attachments` on a
message: a field Graph does not know fails the whole call, so the WHO of a
conversation is read off its messages, where it is documented.

**AND THE MESSAGES COME BACK EXPANDED, IN ONE CALL PER CONVERSATION.** The
documented alternative is `?fields=messages` for the ids and then one call per
message for its content — 20 calls per conversation against a budget of 200 an
hour, which a tick every fifteen minutes would spend on one busy thread. So the
edge is expanded (`?fields=messages{…}`, the Graph's own syntax, which the
Facebook-login flavor of this same API documents) and the newest 20 are kept.

**SENDING IS THE ONE CALL THAT IS NOT FORM-ENCODED.** `POST /{IG_USER_ID}/
messages` takes a JSON body — `{"recipient": {"id": IGSID}, "message": {"text":
…}}` — and the token as a Bearer header, which is how Meta documents it. And it
only works INSIDE THE 24-HOUR WINDOW: an app may answer a person up to 24 hours
after that person's last message, and every new message of theirs starts it
again. Past it the send fails, so the window is checked before the call and
the listing says how much of it is left, so the threads about to close are
answered first.
"""

import logging
import os
import time
from datetime import datetime

import httpx
import ig_store

log = logging.getLogger(__name__)

GRAPH = "https://graph.instagram.com/v21.0"
# Unversioned on purpose: this is the endpoint Meta documents for the refresh,
# and it is the one that answers.
REFRESH = "https://graph.instagram.com/refresh_access_token"

# What the client reads when the connection is not there — the model repeats
# it to her. One line, Spanish. The variable's name is for whoever sets it up,
# and it goes to the log: in the client's Activity it read as a code.
MISSING = (
    "Tu cuenta de Instagram todavía no está conectada. Sin eso no puedo leer ni "
    "contestar los comentarios de tus posteos."
)

# Reading a feed is a read, and a provider that does not pick up the phone is
# not thinking about it. Same shape as the social plugin's.
TIMEOUT = httpx.Timeout(60.0, connect=10.0)

# THE METRICS v21.0 SERVES FOR AN IMAGE OR A CAROUSEL. `impressions` is gone
# from v22 and was already unreliable here; `views` is video's. These five are
# what a post the creator can learn from is made of — how many people saw it,
# how many kept it, and the three ways somebody answered it.
METRICS = "reach,likes,comments,saved,shares"

# How close to the end of the sixty days is close enough to renew. Ten days is
# two weeks of an agent being off before the connection dies on its own.
RENEW_WITHIN_DAYS = 10
DAY = 86400

# WHAT A MESSAGE IS, in the documented order and with no field this flavor does
# not serve. `from` is `{username, id}` and that id is the IGSID a reply goes to.
MESSAGE_FIELDS = "id,created_time,from,to,message"

# Meta's own clock: an app may answer a person up to 24 hours after that
# person's last message, and every message of theirs starts it again. It is not
# a policy we chose and not one we can stretch.
WINDOW_HOURS = 24

# How many of a thread's messages are kept. Meta serves details for the 20 most
# recent and hands them back newest first.
THREAD = 20

# The timestamps Graph writes: `2026-09-16T10:00:00+0000`.
WHEN = "%Y-%m-%dT%H:%M:%S%z"


class NotConnected(RuntimeError):
    """Instagram is not set up on this agent.

    NOT a failure and not a bug: an agent whose client has not connected the
    account yet is a state the product has, and the message is written for the
    client, because that is who has to do something about it.
    """


class Refused(RuntimeError):
    """The provider said no, in its own words. `error.message` travels inside it
    untranslated: «the account is not a professional account» and «Unsupported
    get request» are different problems and nothing here can summarise them."""


def flat(text) -> str:
    return " ".join(str(text).split())[:300]


def env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        log.warning("instagram: %s is not set", name)
        raise NotConnected(MISSING)
    return value


def connected() -> bool:
    """Whether the account is set up, for a flow that names `instagram`
    (`engine.provide("connection.instagram", ...)`): a token in force and the
    account's id. Whether Graph accepts that token is a call, and the watcher
    makes it."""
    try:
        token()
        user_id()
    except NotConnected:
        return False
    return True


def user_id() -> str:
    return env("IG_USER_ID")


def token() -> str:
    """The token in force: the table first, the environment second.

    The table is written by the refresh and the env is what the client's
    `secrets.env` seeded; asking in this order is what makes a refreshed token
    survive a restart.
    """
    return ig_store.current_token() or env("IG_ACCESS_TOKEN")


def http() -> httpx.Client:
    """The client every Graph call goes through. A function so a test can hand
    the module a transport of its own without touching what it is testing."""
    return httpx.Client(timeout=TIMEOUT)


def answer(response: httpx.Response) -> dict:
    """The body, or why there isn't one, in the provider's words.

    Graph answers its errors as JSON with an `error` object and it can do that
    on a 200, so the body is asked first and the status second.
    """
    try:
        body = response.json()
    except ValueError:
        raise Refused(f"{response.status_code} {flat(response.text)}") from None
    if isinstance(body, dict) and "error" in body:
        error = body["error"]
        raise Refused(flat(error.get("message", error) if isinstance(error, dict) else error))
    if response.status_code != 200:
        raise Refused(f"{response.status_code} {flat(response.text)}")
    return body


def get(path: str, **params) -> dict:
    with http() as client:
        return answer(client.get(f"{GRAPH}/{path}", params=params | {"access_token": token()}))


def post(path: str, **data) -> dict:
    with http() as client:
        return answer(client.post(f"{GRAPH}/{path}", data=data | {"access_token": token()}))


# ── who we are ──────────────────────────────────────────────────────────────


def whoami() -> str:
    """The account's own handle, read once and kept.

    It is asked of `/me` and not of a variable because it is a fact about the
    token: a client who reconnects another account gets another username with
    no one having to remember to edit an env. What it is FOR is skipping our own
    answers — Instagram hands the account's replies back nested under the
    comment they answer, and a reply of ours that came back as new would be an
    agent answering itself every fifteen minutes.
    """
    known = ig_store.username()
    if known:
        return known
    handle = get("me", fields="username")["username"]
    ig_store.save_account(user_id(), username=handle)
    return handle


# ── the feed and its comments ───────────────────────────────────────────────


def media(limit: int = 10) -> list[dict]:
    """The account's own posts, newest first: what there is to read comments on."""
    return get(f"{user_id()}/media",
               fields="id,caption,permalink,timestamp,comments_count",
               limit=limit).get("data") or []


COMMENT_FIELDS = "id,text,username,from,parent_id,timestamp"


def author(item: dict) -> str | None:
    """Who wrote a comment. `username` is only there on OUR OWN; everybody
    else's handle comes in `from`."""
    return item.get("username") or (item.get("from") or {}).get("username")


def comments(media_id: str) -> list[dict]:
    """One post's comments, each with its replies nested, EVERY ONE WITH ITS
    AUTHOR in `username`. The rest of the plugin reads that shape and no other.

    WHAT THE GRAPH ACTUALLY SENDS is not that, measured on our own account on
    2026-09-20:

    - a stranger's comment has no `username`: the handle is in `from`;
    - the edge is FLAT: a reply is a row of its own, with `parent_id`, next to
      the comment it answers;
    - and the same reply nested under its parent (`replies{…}`) carries `id`,
      `text` and `timestamp` and NO AUTHOR AT ALL, whatever fields are asked
      for. So does `/{comment}/replies`.

    Reading the nested copy is what had our agent answer itself: our own reply
    came back with no author, so it was not ours, so it was new, so it got a
    draft («Gracias, nos alegra que te haya gustado», under our own «Gracias,
    nos alegra que te haya gustado»). And every stranger was «alguien».

    So: the top level is the rows with no `parent_id`; the replies are the
    nested ones, for their order; and each reply's author is looked up in the
    flat rows by id, or asked for by id when the flat page did not carry it. A
    reply whose author nobody can name is never handed over as a stranger's.
    """
    rows = get(f"{media_id}/comments",
               fields=f"{COMMENT_FIELDS},replies{{id,text,timestamp}}").get("data") or []
    authors = {row["id"]: author(row) for row in rows}
    found = []
    for row in rows:
        if row.get("parent_id"):
            continue
        nested = (row.get("replies") or {}).get("data") or []
        for item in nested:
            if not authors.get(item["id"]):
                authors[item["id"]] = author(get(item["id"], fields=COMMENT_FIELDS))
            item["username"] = authors[item["id"]]
        found.append({
            "id": row["id"], "text": row.get("text"), "username": authors[row["id"]],
            "timestamp": row.get("timestamp"), "replies": {"data": nested},
        })
    return found


def reply(comment_id: str, message: str) -> str:
    """The answer, published under the comment. The id of what went out."""
    return post(f"{comment_id}/replies", message=message)["id"]


def hide(comment_id: str) -> None:
    """Out of sight of everyone but its author. Instagram's own verb for spam:
    it is not deleting, which cannot be undone and which this plugin does not do.
    """
    post(comment_id, hide="true")


def insights(media_id: str) -> dict:
    """One post's numbers, as `{metric: value}`.

    A metric this API does not serve for this media type comes back as a
    `Refused` and stays one: what the creator reads has to be the account's real
    numbers, and a dictionary quietly missing `saved` is a creator concluding
    that nothing gets saved.
    """
    data = get(f"{media_id}/insights", metric=METRICS).get("data") or []
    return {row["name"]: row["values"][0]["value"] for row in data}


# ── the messages ────────────────────────────────────────────────────────────


def post_json(path: str, payload: dict) -> dict:
    """The one call Meta documents as JSON with a Bearer header, not as a form.

    Sending a message is that call, and the shape is the docs': the body carries
    the recipient and the text, the token travels in the header.
    """
    with http() as client:
        return answer(client.post(
            f"{GRAPH}/{path}",
            json=payload,
            headers={"Authorization": f"Bearer {token()}",
                     "Content-Type": "application/json"},
        ))


def moment(stamp: str) -> float:
    """One of Graph's timestamps as an epoch."""
    return datetime.strptime(stamp, WHEN).timestamp()


def conversations(limit: int = 50) -> list[dict]:
    """The account's message threads, newest first: `id` and `updated_time`.

    `platform=instagram` is the documented parameter and the fields are the two
    documented keys. WHO is in a thread is NOT here — there is no `participants`
    field on this flavor — and it does not need to be: the person is on every
    message they wrote, where the docs put them.

    ONE CALL AND NO PAGING LOOP. `limit` is the Graph's own, the rows are sorted
    by `updated_time` here so «newest» is a fact and not a hope, and a client
    with more than fifty live threads is a client this tick is the wrong shape
    for anyway.
    """
    rows = get("me/conversations", platform="instagram",
               fields="id,updated_time", limit=limit).get("data") or []
    rows.sort(key=lambda row: row.get("updated_time", ""), reverse=True)
    return rows[:limit]


def messages(conversation_id: str) -> list[dict]:
    """One thread's messages, newest first, at most twenty.

    Expanded in the one call that asks for the thread, because the documented
    alternative — the ids here and then one call per message — spends twenty of
    the two hundred calls an hour on a single busy conversation.
    """
    found = get(conversation_id, fields=f"messages{{{MESSAGE_FIELDS}}}")
    return ((found.get("messages") or {}).get("data") or [])[:THREAD]


def send_message(recipient_igsid: str, text: str) -> str:
    """The answer, sent to that person. The id of what went out.

    The recipient is an IGSID read off a message they sent us, never a number
    the model picked: `ig_tools.py` looks it up on the conversation, which is
    the only argument the tool takes.
    """
    return post_json(f"{user_id()}/messages", {
        "recipient": {"id": recipient_igsid},
        "message": {"text": text},
    })["message_id"]


# ── the sixty days ──────────────────────────────────────────────────────────


def remember_token(new_token: str, expires_in: int) -> None:
    """The token in force, written down where a restart can find it.

    Also what the social plugin calls after its own
    `POST /portal/instagram/refresh`, through
    `engine.use("instagram.token.refreshed")`: two plugins on one account
    cannot each hold a different idea of which token is current.
    """
    os.environ["IG_ACCESS_TOKEN"] = new_token
    ig_store.save_account(
        user_id(), token=new_token, token_expires_at=time.time() + expires_in
    )


def due() -> bool:
    """Whether the token is close enough to the end of its sixty days.

    An unknown expiry is DUE: the first tick after a connection is set up is
    where the agent learns when the token it was handed dies, and refreshing a
    fresh token costs nothing and extends it.
    """
    when = ig_store.expires_at()
    return when is None or when - time.time() < RENEW_WITHIN_DAYS * DAY


def refresh() -> int:
    """The sixty days, started again. Answers how long the new one lasts.

    Meta extends the token it is given, so this keeps working forever as long as
    it happens inside the window — which is the whole reason the flow's first
    step is this one. What it never does is answer the token: the adapter never
    returns a credential and neither does a tool.
    """
    with http() as client:
        body = answer(client.get(REFRESH, params={
            "grant_type": "ig_refresh_token",
            "access_token": token(),
        }))
    seconds = int(body["expires_in"])
    remember_token(body["access_token"], seconds)
    return seconds
