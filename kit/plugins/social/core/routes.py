"""The Posts tab: the listing, one post, and the bytes of a piece.

Three routes and no verbs. A post is finished work sitting on disk — the
client reads it, copies the caption and downloads the pictures — and the only
thing that writes one is `save_post`, in the agent's own turn.

THE PIECES ARE SERVED HERE AND NOT FROM `/portal/files`, which answers
`text/plain` for everything it has: a PNG through that route arrives as
mojibake. The portal fetches these with the bearer header and makes an object
URL out of the answer, so the client's key never travels in a query string.
"""

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

import posts

router = APIRouter()

# Read by the client: the portal shows `error.message` on the tab she is on.
NO_POST = "No hay ningún posteo {post_id} en este agente."
NO_IMAGE = "El posteo {post_id} no tiene ninguna imagen {name}."


@router.get("/portal/posts")
def listing():
    return {"available": True, "posts": posts.read_all()}


@router.get("/portal/posts/{post_id}")
def detail(post_id: str):
    found = posts.read(post_id)
    if found is None:
        raise HTTPException(404, NO_POST.format(post_id=post_id))
    return found


@router.get("/portal/posts/{post_id}/{name}")
def piece(post_id: str, name: str):
    path = posts.image_path(post_id, name)
    if path is None:
        raise HTTPException(404, NO_IMAGE.format(post_id=post_id, name=name))
    # `inline` and not `attachment`: the tab draws the picture, and the
    # download is a link the portal builds from the same bytes.
    return Response(
        path.read_bytes(),
        media_type=posts.TYPES[path.suffix.lower()],
        headers={"Content-Disposition": f'inline; filename="{name}"'},
    )
