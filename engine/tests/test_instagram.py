#!/usr/bin/env python3
"""Publishing to Instagram, without Instagram. `python3 engine/tests/test_instagram.py`.

`instagram.publish` called DIRECTLY INSIDE THE CONTAINER over a throwaway post,
with the Graph behind an `httpx.MockTransport` and the bucket behind a recorder.
Free, a second, no model and no network — and it is where the whole sequence
can be asserted, because a real publish is one irreversible thing on a real
account and cannot be run twice.

  a. THE SEQUENCE IS THE ONE INSTAGRAM DOCUMENTS — one container per slide with
     `is_carousel_item`, then the CAROUSEL carrying their ids and the caption,
     then the container polled until `FINISHED`, then `media_publish` with the
     creation id, then the permalink. In that order and nothing else in it.
  b. THE PICTURES WENT UP AND THE URLS INSTAGRAM WAS GIVEN ARE THE PUBLIC ONES
     — `R2_PUBLIC_URL/<post>/<NN>.png`, in the order the slides are flipped
     through, with the right content type. Instagram fetches them itself, so a
     URL behind the bearer would be a 401 nobody sees.
  c. THE CAPTION IS WHAT THE CLIENT COPIES — the pie, a blank line, the
     hashtags with their `#`: the same string `caption.md` carries, built by
     the same function, so what she pastes by hand and what the agent publishes
     cannot differ.
  d. IT IS WRITTEN DOWN — `published` in `post.json` with the media id, the
     permalink and when, which is what the Posts tab draws its «Publicado» chip
     from, and one `post.published` event with the permalink in its label.
  e. AND THE BUCKET IS LEFT EMPTY — the objects are deleted on the way out.
     They are a doorstep for one publish, not a copy of the client's posts on
     somebody else's disk.
  f. A POST OF ONE PICTURE IS NOT A CAROUSEL — one container with the caption
     on it, because Instagram's carousel takes 2 to 10 children.
  g. AND WITH NOTHING CONNECTED, NOTHING HAPPENS — `NotConnected` naming the
     variable that is missing, in Spanish, before a single byte is uploaded.
     That is the state every agent is in until Luis' token lands.

IT CLEANS UP AFTER ITSELF: the throwaway posts and the event it wrote are gone
by the end, whatever happened.

WHERE IT POINTS. `CORE_CONTAINER` moves it onto a second instance; the default
is the main compose's `tuagente-core`.
"""

import json
import os
import subprocess
import sys

CONTAINER = os.environ.get("CORE_CONTAINER", "tuagente-core")

SLIDES = 3
POST_ID = "2020-01-01-prueba-de-publicacion"
ONE_ID = "2020-01-02-prueba-de-una-sola"
CAPTION = "La prueba de la puerta.\nSegunda línea del pie."
HASHTAGS = ["ferreteria", "montevideo"]
PUBLIC = "https://pub-prueba.r2.dev"
BUCKET = "prueba-bucket"
USER = "17841400000000000"
MEDIA_ID = "18000000000000000"
PERMALINK = "https://www.instagram.com/p/PRUEBA123/"

INSIDE = r"""
import json, sys, types
from pathlib import Path

sys.path.insert(0, "/opt/kit/plugins/social/core")
import httpx
import instagram
import posts
from PIL import Image

from core import db

SLIDES, POST_ID, ONE_ID, CAPTION, PUBLIC, BUCKET, USER, MEDIA_ID, PERMALINK = (
    int(sys.argv[1]), sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5],
    sys.argv[6], sys.argv[7], sys.argv[8], sys.argv[9],
)
HASHTAGS = sys.argv[10].split(",")

CONNECTED = {
    "IG_ACCESS_TOKEN": "el-token", "IG_USER_ID": USER,
    "R2_ACCOUNT_ID": "cuenta", "R2_ACCESS_KEY_ID": "llave",
    "R2_SECRET_ACCESS_KEY": "secreto", "R2_BUCKET": BUCKET,
    "R2_PUBLIC_URL": PUBLIC + "/",     # the trailing slash is stripped by the code
}


def make(post_id, slides):
    "A post on disk, the shape `save_post` leaves."
    directory = posts.folder(post_id)
    directory.mkdir(parents=True, exist_ok=True)
    names = []
    for number in range(1, slides + 1):
        name = f"{number:02d}.png"
        Image.new("RGB", (8, 10), (20, 19, 31)).save(directory / name)
        names.append(name)
    data = {
        "id": post_id, "slug": post_id.split("-", 3)[3], "date": post_id[:10],
        "format": "carousel" if slides > 1 else "feed", "caption": CAPTION,
        "alt": "una prueba", "alts": ["una prueba"] * slides, "hashtags": HASHTAGS,
        "images": names, "prompts": ["brief"] * slides, "versions": {},
        "created_at": "2020-01-01T09:00:00-03:00", "flow": None,
    }
    (directory / posts.POST).write_text(json.dumps(data, ensure_ascii=False, indent=2))
    (directory / posts.CAPTION).write_text(posts.caption_file(CAPTION, HASHTAGS))
    return directory


class Bucket:
    "The recorder that stands in for R2: what went up, and what came off."

    def __init__(self):
        self.put, self.deleted = [], []

    def put_object(self, Bucket, Key, Body, ContentType):
        self.put.append({"bucket": Bucket, "key": Key, "bytes": len(Body),
                         "type": ContentType})

    def delete_objects(self, Bucket, Delete):
        self.deleted += [o["Key"] for o in Delete["Objects"]]


def graph(calls, polls):
    "The Graph, as a transport. `polls` is how many IN_PROGRESS before FINISHED."
    seen = {"status": 0}

    def handle(request):
        form = dict(httpx.QueryParams(request.content.decode())) if request.content else {}
        note = {"method": request.method, "path": request.url.path,
                "query": dict(request.url.params), "form": form}
        calls.append(note)
        if request.method == "POST" and request.url.path.endswith("/media"):
            if form.get("media_type") == "CAROUSEL":
                return httpx.Response(200, json={"id": "carrusel-1"})
            return httpx.Response(200, json={"id": f"item-{len(calls)}"})
        if request.method == "POST" and request.url.path.endswith("/media_publish"):
            return httpx.Response(200, json={"id": MEDIA_ID})
        if request.method == "GET" and "status_code" in request.url.params.get("fields", ""):
            seen["status"] += 1
            ready = "FINISHED" if seen["status"] > polls else "IN_PROGRESS"
            return httpx.Response(200, json={"status_code": ready})
        if request.method == "GET" and "permalink" in request.url.params.get("fields", ""):
            return httpx.Response(200, json={"permalink": PERMALINK, "id": MEDIA_ID})
        return httpx.Response(400, json={"error": {"message": "nadie pidió esto"}})

    return httpx.MockTransport(handle)


def run(post_id, slides, polls):
    "One publish against the doubles. Answers what happened."
    calls, bucket = [], Bucket()
    instagram.r2 = lambda: bucket
    instagram.http = lambda: httpx.Client(transport=graph(calls, polls))
    made = make(post_id, slides)
    answer = instagram.publish(post_id, session_id="prueba-instagram")
    return {
        "answer": answer,
        "calls": calls,
        "put": bucket.put,
        "deleted": bucket.deleted,
        "written": json.loads((made / posts.POST).read_text()).get("published"),
    }


out = {}
made = []
try:
    # (g) NOTHING CONNECTED. Read before anything else, with the environment
    # still empty, so what it proves is that nothing went out — not that the
    # variables were unset again afterwards.
    for name in CONNECTED:
        assert not __import__("os").environ.get(name), f"{name} is set in the lab"
    empty = Bucket()
    instagram.r2 = lambda: empty
    made.append(make(POST_ID, SLIDES))
    try:
        instagram.publish(POST_ID)
        out["missing"] = ""
    except instagram.NotConnected as exc:
        out["missing"] = str(exc)
    out["missing_put"] = empty.put

    for name, value in CONNECTED.items():
        __import__("os").environ[name] = value
    # No sleeping between polls: the poll is asserted by how many times the
    # status was asked, and three seconds of it prove nothing.
    instagram.POLL_SECONDS = 0

    out["carousel"] = run(POST_ID, SLIDES, polls=1)
    made.append(posts.folder(ONE_ID))
    out["single"] = run(ONE_ID, 1, polls=0)
    out["caption_file"] = posts.caption_file(CAPTION, HASHTAGS).strip()
    out["events"] = [dict(r) for r in db.query(
        "SELECT kind, label, status, payload FROM events WHERE kind = ? AND session_id = ?",
        ("post.published", "prueba-instagram"))]
    print(json.dumps(out, ensure_ascii=False, default=str))
finally:
    import shutil
    for directory in made:
        shutil.rmtree(directory, ignore_errors=True)
    db.write("DELETE FROM events WHERE session_id = ?", ("prueba-instagram",))
"""


def judge(name: str, problems: list[str]) -> list[str]:
    """One line per claim, so a failure is read where it happened."""
    print(f"  {name}: " + ("PASS" if not problems else "FAIL — " + "; ".join(problems)))
    return problems


def main() -> int:
    print(f"container: {CONTAINER}")
    done = subprocess.run(
        ["docker", "exec", CONTAINER, "python3", "-c", INSIDE,
         str(SLIDES), POST_ID, ONE_ID, CAPTION, PUBLIC, BUCKET, USER, MEDIA_ID,
         PERMALINK, ",".join(HASHTAGS)],
        capture_output=True, text=True,
    )
    if done.returncode != 0:
        print(done.stderr.strip()[-2000:])
        print("INSTAGRAM: FAIL")
        return 1
    measured = json.loads(done.stdout)
    carousel = measured["carousel"]
    calls = carousel["calls"]
    print(f"  {len(calls)} calls · {carousel['answer']['permalink']}")

    failures = []

    # (a) the sequence
    problems = []
    items = [c for c in calls if c["method"] == "POST" and c["path"].endswith("/media")
             and c["form"].get("is_carousel_item")]
    if len(items) != SLIDES:
        problems.append(f"{len(items)} item containers and the post has {SLIDES} slides")
    shape = [f"{c['method']} {c['path'].rsplit('/', 1)[-1]}" for c in calls]
    wanted = ["POST media"] * SLIDES + ["POST media", f"GET carrusel-1",
                                        "GET carrusel-1", "POST media_publish",
                                        f"GET {MEDIA_ID}"]
    if shape != wanted:
        problems.append(f"the order is {shape}")
    carousel_call = next((c for c in calls if c["form"].get("media_type") == "CAROUSEL"), None)
    if carousel_call is None:
        problems.append("no CAROUSEL container was created")
    elif carousel_call["form"].get("children", "").count(",") != SLIDES - 1:
        problems.append(f"the carousel carries {carousel_call['form'].get('children')!r}")
    if not all(c["path"].startswith(f"/v21.0/{USER}/") for c in calls
               if c["method"] == "POST"):
        problems.append("a POST did not go to the account's own media endpoint")
    failures += judge("a. the sequence Instagram documents", problems)

    # (b) the pictures, and the URLs Instagram was handed
    problems = []
    keys = [f"{POST_ID}/{n:02d}.png" for n in range(1, SLIDES + 1)]
    if [p["key"] for p in carousel["put"]] != keys:
        problems.append(f"what went up is {[p['key'] for p in carousel['put']]}")
    if {p["bucket"] for p in carousel["put"]} != {BUCKET}:
        problems.append("it did not go to R2_BUCKET")
    if {p["type"] for p in carousel["put"]} != {"image/png"}:
        problems.append(f"content types {[p['type'] for p in carousel['put']]}")
    if any(p["bytes"] == 0 for p in carousel["put"]):
        problems.append("an empty picture was uploaded")
    given = [c["form"]["image_url"] for c in items]
    if given != [f"{PUBLIC}/{key}" for key in keys]:
        problems.append(f"the URLs handed to Instagram are {given}")
    failures += judge("b. the pictures went up, public and in order", problems)

    # (c) the caption
    problems = []
    sent = carousel_call["form"].get("caption", "") if carousel_call else ""
    if sent != measured["caption_file"]:
        problems.append(f"what was sent is {sent!r} and caption.md is "
                        f"{measured['caption_file']!r}")
    if not sent.endswith(" ".join(f"#{t}" for t in HASHTAGS)):
        problems.append("the hashtags are not on the end, with their #")
    if "\n\n" not in sent:
        problems.append("there is no blank line between the pie and the hashtags")
    failures += judge("c. the caption is what the client copies", problems)

    # (d) written down
    problems = []
    written = carousel["written"]
    if not written:
        problems.append("post.json has no `published`")
    else:
        if written["media_id"] != MEDIA_ID:
            problems.append(f"the media id is {written['media_id']!r}")
        if written["permalink"] != PERMALINK:
            problems.append(f"the permalink is {written['permalink']!r}")
        if not written.get("at"):
            problems.append("it does not say when")
        if carousel["answer"] != {"media_id": MEDIA_ID, "permalink": PERMALINK,
                                  "published_at": written["at"]}:
            problems.append(f"the tool was answered {carousel['answer']}")
    events = measured["events"]
    if len(events) != 2:
        problems.append(f"{len(events)} post.published events for two publishes")
    elif PERMALINK not in events[0]["label"] or POST_ID not in events[0]["label"]:
        problems.append(f"the event reads {events[0]['label']!r}")
    failures += judge("d. it is written into the post and into Activity", problems)

    # (e) the bucket
    problems = []
    if carousel["deleted"] != keys:
        problems.append(f"what came off is {carousel['deleted']}")
    failures += judge("e. and the bucket is left empty", problems)

    # (f) one picture
    single = measured["single"]
    problems = []
    containers = [c for c in single["calls"] if c["method"] == "POST"
                  and c["path"].endswith("/media")]
    if len(containers) != 1:
        problems.append(f"{len(containers)} containers for one picture")
    elif containers[0]["form"].get("media_type") or containers[0]["form"].get("is_carousel_item"):
        problems.append(f"it was sent as {containers[0]['form']}")
    elif not containers[0]["form"].get("caption"):
        problems.append("the caption is not on the only container there is")
    failures += judge("f. a post of one picture is not a carousel", problems)

    # (g) nothing connected
    problems = []
    missing = measured["missing"]
    print(f"  {missing}")
    if "Falta conectar Instagram" not in missing:
        problems.append(f"it said {missing!r}")
    if "IG_ACCESS_TOKEN" not in missing:
        problems.append("it does not name the variable that is missing")
    if measured["missing_put"]:
        problems.append(f"it uploaded {measured['missing_put']} anyway")
    failures += judge("g. and with nothing connected, nothing happens", problems)

    print("INSTAGRAM: PASS" if not failures else "INSTAGRAM: FAIL")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
