"""`publish_instagram`: the one gated tool of the social plugin, on the FACE.

The creator makes the post; the client decides whether it goes out. That
sentence is the whole design of this file:

- IT IS ON THE FACE AND NOT ON THE CREATOR. A sub-agent never talks to the
  client, and the gate IS a conversation with her — measured: a gated tool
  inside `delegate_task` does not pause, it kills the turn
  (`core/plugins.py`'s `subagent`). So the creator has no way to publish
  anything, by construction and not by prose.
- IT IS GATED THE WAY `send_email` IS, by wrapping the whole toolset in
  `approval_required()` at registration (`plugin.py`): asking is not something
  the model can forget, because asking is not something it does.
- IT PUBLISHES A POST THAT ALREADY EXISTS, by id. Nothing about the post is an
  argument — not the caption, not the pictures — so there is no way for the
  model to publish a version of the post the client never saw. `instagram.py`
  reads the post off disk and sends what is in it.

**WHAT THE CARD SHOWS IS READ FROM DISK, NOT FROM THE TOOL CALL.** The approval
plugin renders a card from a tool's arguments, and this tool's arguments are an
id: a card built from them would say nothing about what is going out. So the
social plugin hands the approval plugin a renderer for this one tool through
`engine.provide("approval.render.publish_instagram", card)` — the mechanism
`core/plugins.py` already has for one plugin offering something to another —
and `card()` opens `post.json` and lays out the slides, the caption and the
hashtags that are about to be published.

**THE REFUSALS RUN AFTER THE YES, AND THAT IS THE GATE'S SHAPE.** A gated
tool's body does not run until the client approves, so a `ModelRetry` in here
is read by the model on the resumed run and comes back as another proposal on
the same row — which is the negotiation the approval plugin already is. What
keeps the client from approving something impossible is the CARD: it says when
the post is not there, and it says when it is already published, with its
permalink.

**A CORRECTION REPLACES THE CAPTION; IT IS NOT APPENDED TO IT.** This is the
one place this file does not do what `approval/core/sensitive.py`'s
`corrected()` does, and the reason is in the portal: the correction box is
PRELOADED with the text of the request and the client EDITS it —
`app/app/approvals/page.tsx`, «a correction sends whatever's in the box as "use
exactly this version"» — so what arrives is a finished caption, not an
instruction about one. Appending it would publish the caption twice with
«Corrección que pidió el cliente, aplicada:» in the middle of it, on the
client's real account. The card's last block is exactly the caption, so what
the portal preloads is exactly what a caption is.

**THE PICTURES ARE NEVER TOUCHED BY A CORRECTION.** A slide that is wrong is
fixed before publishing, with «Arreglar esta imagen» in Posteos, which is the
creator's `replace_slide`. Half-publishing a carousel the client edited in a
textarea is not a thing this product does.
"""

import posts
from pydantic import BaseModel, Field
from pydantic_ai import ModelRetry, RunContext
from pydantic_ai.toolsets import FunctionToolset

import instagram

TOOL = "publish_instagram"

# What the client reads under the card, and what the model reads to decide.
ALREADY = "El posteo «{post_id}» ya está publicado: {permalink}"
NO_IMAGES = (
    "El posteo «{post_id}» no tiene ninguna imagen, y en Instagram no se "
    "publica un pie solo"
)
FAILED = (
    "No pude publicar el posteo «{post_id}» en Instagram: {reason}. No salió "
    "nada; el posteo sigue en Posteos."
)
DONE = "Publicado en Instagram: {permalink}"


class ApprovalNote(BaseModel):
    """The words the client reads on the approval card.

    THE SAME FOUR FIELDS AS `approval/core/sensitive.py`'s, and declared again
    here instead of imported. The contract with `approval/core/render.py` is
    the four KEYS of the dict the tool call carries, not a Python class, and
    neither way of reaching that class is worth it: a plugin's surface modules
    share one `sys.modules` namespace (`import sensitive` from here returns
    whichever plugin got there first — `posts.py`'s docstring has the measured
    story), and `engine.use()` would tie this plugin's startup to the approval
    plugin's position in `CORE_PLUGINS` for four field descriptions.

    They are Spanish because they are what the model answers and what the
    client reads.
    """

    what: str = Field(description="Qué vas a hacer, en una línea y en criollo.")
    if_approved: str = Field(description="Qué pasa si el cliente te dice que sí.")
    if_rejected: str = Field(description="Qué pasa si el cliente te dice que no.")
    why: str = Field(description="Por qué lo estás proponiendo ahora.")


def caption_of(data: dict) -> str:
    """What goes out as the caption: the pie, a blank line, the hashtags.

    `posts.caption_file` is the one place that shape is written, and it is the
    same text `caption.md` carries — so what the client copies by hand and what
    the agent publishes are the same string.
    """
    return posts.caption_file(data["caption"], data["hashtags"]).strip()


def card(args: dict) -> tuple[str, str]:
    """The title and the body of the approval card, READ FROM THE POST.

    The approval plugin calls this by tool name (`plugin.py` provides it) and
    everything it returns is in Spanish: it is what the client reads on the
    screen where she decides.

    A post that is not on disk is not an error here — the id came from the
    model and the model can be wrong — so the card says so and the client says
    no. Same for one already published: the permalink is on the card, which is
    the fact that decides it.
    """
    post_id = args["post_id"]
    title = f"Publicar en Instagram el posteo «{post_id}»"
    data = posts.read(post_id)
    if data is None:
        return title, posts.NO_POST.format(post_id=post_id)

    lines = [f"**Posteo:** «{post_id}» · {len(data['images'])} imágenes"]
    published = data.get("published")
    if published:
        lines.append(
            f"\n**Ojo: {ALREADY.format(post_id=post_id, permalink=published['permalink'])}.** "
            "Si aprobás, va a salir una segunda vez."
        )
    if data["images"]:
        # A TABLE, AND THAT IS LOAD-BEARING. The portal cuts the editable text
        # of a request after the LAST table row (`splitProposal`), so putting
        # the slides in one puts the caption — and only the caption — in the
        # box the client edits when she corrects.
        lines.append("\n| Las imágenes, en orden |\n|---|")
        lines += [
            f"| ![Imagen {number}](/portal/posts/{post_id}/{image['name']}) |"
            for number, image in enumerate(data["images"], 1)
        ]
    lines.append(f"\n{caption_of(data)}")
    return title, "\n".join(lines)


def toolset() -> FunctionToolset:
    ts = FunctionToolset()

    @ts.tool
    def publish_instagram(
        ctx: RunContext,
        post_id: str,
        note: ApprovalNote,
        client_correction: str | None = None,
    ) -> str:
        """Publicar en Instagram un posteo que ya está en Posteos, tal como está.

        Sale el carrusel con su pie y sus hashtags, como el cliente lo ve en la
        pestaña. Es la ÚNICA forma de publicar algo: frena hasta que el cliente
        lo apruebe desde el portal, y recién ahí sale.

        Si te piden cambiar una imagen, eso NO se arregla acá: se arregla antes,
        en Posteos, y después se publica.

        `note` es lo que el cliente lee para decidir: llenala siempre, en
        criollo y sin tecnicismos. Decí qué posteo es y cómo empieza el pie.

        `client_correction` NO LA ESCRIBÍS VOS: la completa el cliente cuando
        aprueba con correcciones, y es EL PIE ya editado por él, tal cual tiene
        que salir. Llega sola en la segunda vuelta; dejala vacía siempre.

        Args:
            post_id: el id del posteo, `<fecha>-<tema>`, tal como aparece en
                Posteos.
        """
        data = posts.read(post_id)
        if data is None:
            raise ModelRetry(posts.NO_POST.format(post_id=post_id))
        published = data.get("published")
        if published:
            raise ModelRetry(
                ALREADY.format(post_id=post_id, permalink=published["permalink"])
                + ". Si el cliente quiere otra cosa, es otro posteo."
            )
        if not data["images"]:
            raise ModelRetry(NO_IMAGES.format(post_id=post_id))
        try:
            done = instagram.publish(
                post_id,
                caption=client_correction.strip() if client_correction else None,
                session_id=ctx.deps.session_id,
            )
        except (instagram.NotConnected, instagram.Refused) as exc:
            # NEITHER ONE IS A RETRY. The connection is not going to appear
            # between two model calls, and a publish that failed halfway is the
            # last thing to attempt twice: what comes back is a sentence the
            # face reads out to the client, and she decides what happens next.
            if isinstance(exc, instagram.NotConnected):
                return str(exc)
            return FAILED.format(post_id=post_id, reason=exc)
        return DONE.format(permalink=done["permalink"])

    return ts
