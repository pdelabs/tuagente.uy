"""Publishing a post to Instagram: the plugin's ONE outward action.

Everything else this plugin does stays inside the client's agent — a folder in
`posteos/`, a tab, a picture. This file is the only place where something
leaves the building, which is why the tool that calls it is the only gated one
of the social plugin (`publishing.py`) and why the creator sub-agent cannot
reach it: a delegate never talks to the client, and publishing is a decision
the client makes.

**THE INSTAGRAM API WITH INSTAGRAM LOGIN**, `graph.instagram.com`, not the
Facebook Graph path: a professional account (Business or Creator) and a
long-lived USER token, no Facebook Page and no Page token. Content publishing
has been on this API since 2024, which is what makes the connection one screen
instead of a Meta app review.

**INSTAGRAM FETCHES THE PICTURES ITSELF, so they have to be PUBLIC.** The
engine serves every byte behind a bearer, so a slide's `/portal/posts/...` URL
is a 401 to Instagram's fetcher. The slides go up to a public bucket —
Cloudflare R2, S3-compatible — for the length of the publish and are deleted
on the way out, on the failure path too. They are a copy of what is already in
the post; the bucket is a doorstep, not a store.

**WHAT IT DOES, IN ORDER** (Graph v21.0):

    POST /{ig-user-id}/media          one container per slide, is_carousel_item
    POST /{ig-user-id}/media          the carousel, children + caption
    GET  /{container-id}?fields=status_code   until FINISHED, at most a minute
    POST /{ig-user-id}/media_publish  creation_id -> the media id
    GET  /{media-id}?fields=permalink the URL the client opens

A post of ONE picture is not a carousel — Instagram's carousel takes 2 to 10
children — so a single slide goes up as one container with the caption on it.
That is the API's shape, not a special case of ours.

**EVERY VARIABLE IS READ AT CALL TIME, AND ALL OF THEM BEFORE ANYTHING GOES
OUT.** A missing one is `NotConnected`, whose message is Spanish and is the ONE
sentence in this file the client reads: it is not a guard against a bug, it is
the connection not being set up, which is a real state of an agent whose client
bought the capability and has not connected the account yet. Reading them all
up front is what keeps a half-done publish from existing: the pictures are
never uploaded to find out that `R2_BUCKET` is empty.

    IG_ACCESS_TOKEN   the long-lived user token. LASTS 60 DAYS (see below)
    IG_USER_ID        the Instagram professional account's id
    R2_ACCOUNT_ID     the Cloudflare account the bucket is in
    R2_ACCESS_KEY_ID · R2_SECRET_ACCESS_KEY   the bucket's S3 credentials
    R2_BUCKET         the bucket the slides are handed to Instagram from
    R2_PUBLIC_URL     its public base, e.g. https://pub-xxxx.r2.dev

**THE TOKEN DIES ON ITS OWN, SILENTLY, EVERY 60 DAYS.** `refresh_token()` is
the other half of this file and `POST /portal/instagram/refresh` is how it is
called today, by hand; a flow will call it later. It extends the token it is
given, so refreshing again from the stored one keeps working as long as it
happens inside the window — which is why the route answers WHEN it expires and
never the token itself. The adapter never returns a credential.
"""

import json
import os
import time
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import boto3
import httpx
import posts
from fastapi import APIRouter, HTTPException

from core import config, db

GRAPH = "https://graph.instagram.com/v21.0"
# Unversioned on purpose: this is the endpoint Meta documents for the refresh,
# and it is the one that answers.
REFRESH = "https://graph.instagram.com/refresh_access_token"

# What the client reads when the connection is not there. One line, Spanish,
# and it names the variable: whoever sets it up needs the name, and the client
# needs to know why nothing went out.
MISSING = (
    "Falta conectar Instagram: no está {name}. Sin eso no puedo publicar; "
    "el posteo te queda igual en Posteos."
)

# A container is a fetch Instagram does on its own, so the read is generous and
# the connect is not: a provider that does not pick up the phone is not
# thinking about it (same reasoning as the image plugin's `generate.py`).
TIMEOUT = httpx.Timeout(60.0, connect=10.0)

# How long the pictures may take to be fetched, and how often that is asked.
# A minute is Instagram's own order of magnitude for five slides; past that,
# the run says so instead of hanging on the client's turn.
READY_SECONDS = 60
POLL_SECONDS = 3
READY = "FINISHED"
BROKEN = ("ERROR", "EXPIRED")


class NotConnected(RuntimeError):
    """Instagram (or the bucket) is not set up on this agent.

    NOT a failure and not a bug: an agent whose client has not connected the
    account yet is in a state the product has, and the message is written for
    the client because that is who has to do something about it.
    """


class Refused(RuntimeError):
    """The provider said no, in its own words.

    `error.message` travels inside it untranslated: «rejected by the safety
    system» and «the account is not a professional account» are different
    problems, and nothing here is in a position to summarise them.
    """


def flat(text) -> str:
    """One line, short enough to sit inside a sentence the client reads."""
    return " ".join(str(text).split())[:300]


def env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise NotConnected(MISSING.format(name=name))
    return value


def http() -> httpx.Client:
    """The client every Graph call goes through. A function so a test can hand
    the module a transport of its own without touching what it is testing."""
    return httpx.Client(timeout=TIMEOUT)


def r2():
    """The bucket, as S3. Same reason as `http()`: one seam, replaceable.

    `region_name="auto"` is R2's: it has one region and rejects a real one.
    """
    return boto3.client(
        "s3",
        endpoint_url=f"https://{env('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com",
        aws_access_key_id=env("R2_ACCESS_KEY_ID"),
        aws_secret_access_key=env("R2_SECRET_ACCESS_KEY"),
        region_name="auto",
    )


def answer(response: httpx.Response) -> dict:
    """The body, or why there isn't one, in the provider's words.

    Graph answers its errors as JSON with an `error` object and it can do that
    on a 200, so the body is asked first and the status second. A body that is
    not JSON at all (a proxy's HTML) travels raw behind the status code:
    unreadable is still more than nothing.
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


# ── the bucket: the doorstep the pictures wait on ───────────────────────────


def put(client, bucket: str, base: str, post_id: str, directory: Path,
        names: list[str]) -> tuple[list[str], list[str]]:
    """The slides in the bucket, in order: their keys and their public URLs.

    Keyed by the post and the slide's own file name, so two publishes of two
    posts never collide and a leftover object says which post it belonged to.
    """
    keys, urls = [], []
    for name in names:
        key = f"{post_id}/{name}"
        client.put_object(
            Bucket=bucket,
            Key=key,
            Body=(directory / name).read_bytes(),
            ContentType=posts.TYPES[Path(name).suffix.lower()],
        )
        keys.append(key)
        urls.append(f"{base}/{key}")
    return keys, urls


def drop(client, bucket: str, keys: list[str]) -> None:
    """The objects, gone. They exist for the length of one publish."""
    if keys:
        client.delete_objects(Bucket=bucket, Delete={"Objects": [{"Key": k} for k in keys]})


# ── the Graph calls ─────────────────────────────────────────────────────────


def container(client: httpx.Client, user: str, token: str, fields: dict) -> str:
    """One media container: what Instagram calls the thing before it is a post."""
    return answer(client.post(f"{GRAPH}/{user}/media",
                              data=fields | {"access_token": token}))["id"]


def wait(client: httpx.Client, creation_id: str, token: str) -> None:
    """Until Instagram has actually fetched the pictures.

    A container exists the moment it is asked for and is not publishable until
    its `status_code` says `FINISHED`: the fetch is asynchronous, and
    publishing early answers a container error with no picture in it.
    """
    deadline = time.monotonic() + READY_SECONDS
    while True:
        status = answer(client.get(
            f"{GRAPH}/{creation_id}",
            params={"fields": "status_code", "access_token": token},
        ))["status_code"]
        if status == READY:
            return
        if status in BROKEN:
            raise Refused(f"Instagram no pudo preparar las imágenes ({status})")
        if time.monotonic() >= deadline:
            raise Refused(
                f"Instagram tardó más de {READY_SECONDS} s en preparar las "
                f"imágenes (quedó en {status})"
            )
        time.sleep(POLL_SECONDS)


def publish(post_id: str, caption: str | None = None,
            session_id: str | None = None) -> dict:
    """A post of `posteos/` on Instagram, and the permalink back.

    `caption` is what actually goes out, already corrected by the client if she
    corrected it (`publishing.py` is where that is decided); `None` means the
    post's own caption plus its hashtags, exactly as `caption.md` has them.
    `session_id` is whose Activity the event lands in.

    THE PICTURES GO UP AND COME DOWN INSIDE THIS CALL, the failure path
    included: whatever happens to the Graph half, the bucket is left as it was
    found.
    """
    data = posts.read(post_id)
    directory = posts.folder(post_id)
    names = [image["name"] for image in data["images"]]
    text = caption if caption is not None else posts.caption_file(
        data["caption"], data["hashtags"]).strip()

    # EVERY CREDENTIAL FIRST. A missing one has to be read before a single byte
    # is uploaded, or a connection that is half set up leaves pictures in a
    # bucket for a publish that was never going to happen.
    token, user = env("IG_ACCESS_TOKEN"), env("IG_USER_ID")
    bucket, base = env("R2_BUCKET"), env("R2_PUBLIC_URL").rstrip("/")
    store = r2()

    keys, urls = put(store, bucket, base, post_id, directory, names)
    try:
        with http() as client:
            if len(urls) == 1:
                # ONE PICTURE IS NOT A CAROUSEL: Instagram's carousel takes 2
                # to 10 children, so a single slide is one container with the
                # caption on it.
                creation_id = container(client, user, token,
                                        {"image_url": urls[0], "caption": text})
            else:
                children = [
                    container(client, user, token,
                              {"image_url": url, "is_carousel_item": "true"})
                    for url in urls
                ]
                creation_id = container(client, user, token, {
                    "media_type": "CAROUSEL",
                    "children": ",".join(children),
                    "caption": text,
                })
            wait(client, creation_id, token)
            media_id = answer(client.post(
                f"{GRAPH}/{user}/media_publish",
                data={"creation_id": creation_id, "access_token": token},
            ))["id"]
            permalink = answer(client.get(
                f"{GRAPH}/{media_id}",
                params={"fields": "permalink", "access_token": token},
            ))["permalink"]
    finally:
        drop(store, bucket, keys)

    when = datetime.now(ZoneInfo(config.TIMEZONE)).isoformat(timespec="seconds")
    # THE POST'S OWN FILE IS RE-READ AND NOT `data`: what `posts.read` hands
    # back is expanded for the portal (images as objects, versions with URLs),
    # and writing that back would rewrite the post in a shape `save_post` never
    # produced.
    path = directory / posts.POST
    stored = json.loads(path.read_text())
    stored["published"] = {"at": when, "media_id": media_id, "permalink": permalink}
    path.write_text(json.dumps(stored, ensure_ascii=False, indent=2) + "\n")
    db.append_event(
        "post.published", f"Publiqué en Instagram «{post_id}»: {permalink}",
        "completed", session_id, {"id": post_id, "permalink": permalink},
    )
    return {"media_id": media_id, "permalink": permalink, "published_at": when}


def refresh_token() -> dict:
    """The 60 days, started again. Answers WHEN it expires, never the token.

    The refreshed token replaces the one this process is holding, so the agent
    keeps publishing without a restart; the instance's `secrets.env` still has
    the previous one, and that is fine — Meta extends the token it is given, so
    the next refresh from the stored value works as long as it happens inside
    the window. What is NOT fine is answering the token to the portal: the
    adapter never returns a credential.
    """
    body = answer(http().get(REFRESH, params={
        "grant_type": "ig_refresh_token",
        "access_token": env("IG_ACCESS_TOKEN"),
    }))
    os.environ["IG_ACCESS_TOKEN"] = body["access_token"]
    seconds = int(body["expires_in"])
    expires = datetime.now(ZoneInfo(config.TIMEZONE)) + timedelta(seconds=seconds)
    return {"ok": True, "expires_in": seconds,
            "expires_at": expires.isoformat(timespec="seconds")}


# ── the admin route ─────────────────────────────────────────────────────────

# A ROUTER OF ITS OWN and not `posts.router`: that one is the Posts tab, three
# routes the client's browser reads, and this is a maintenance call on the
# connection. Both are registered by `plugin.py` and both sit behind the
# bearer, like every other route of this engine.
router = APIRouter()


@router.post("/portal/instagram/refresh")
def refresh():
    """The two answers are the two states this call has: the connection is not
    set up (400, and the sentence says which variable), or Meta said no (502,
    in Meta's words). Anything else is a bug and goes out as one."""
    try:
        return refresh_token()
    except NotConnected as exc:
        raise HTTPException(400, str(exc)) from None
    except Refused as exc:
        raise HTTPException(502, f"Instagram no renovó el token: {exc}") from None
