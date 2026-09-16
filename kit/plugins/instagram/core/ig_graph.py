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

**DMs ARE NOT HERE.** `instagram_manage_messages` needs Advanced Access even on
our own account, so there is nothing to write yet (`plugin.json` names it as a
known limit).
"""

import os
import time

import httpx
import ig_store

GRAPH = "https://graph.instagram.com/v21.0"
# Unversioned on purpose: this is the endpoint Meta documents for the refresh,
# and it is the one that answers.
REFRESH = "https://graph.instagram.com/refresh_access_token"

# What the client reads when the connection is not there. One line, Spanish,
# and it names the variable: whoever sets it up needs the name, and the client
# needs to know why nothing came back.
MISSING = (
    "Falta conectar Instagram: no está {name}. Sin eso no puedo leer ni "
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
        raise NotConnected(MISSING.format(name=name))
    return value


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
               fields="id,caption,permalink,timestamp", limit=limit).get("data") or []


def comments(media_id: str) -> list[dict]:
    """One post's comments, each with its replies nested.

    The replies come in the same call (`replies{…}`) because a conversation
    under a post is one thing: a question asked as a reply to somebody else's
    comment is still a question at us.
    """
    return get(f"{media_id}/comments",
               fields="id,text,username,timestamp,"
                      "replies{id,text,username,timestamp}").get("data") or []


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
    data = answer(http().get(
        f"{GRAPH}/{media_id}/insights",
        params={"metric": METRICS, "access_token": token()},
    )).get("data") or []
    return {row["name"]: row["values"][0]["value"] for row in data}


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
    body = answer(http().get(REFRESH, params={
        "grant_type": "ig_refresh_token",
        "access_token": token(),
    }))
    seconds = int(body["expires_in"])
    remember_token(body["access_token"], seconds)
    return seconds
