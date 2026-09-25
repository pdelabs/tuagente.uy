"""What the portal's «Marca» tab calls. The contract is in `plugin.py`'s docstring.

THE OWNER'S OWN CHANGES WRITE NO ACTIVITY LINE. She confirmed, edited, wrote a
note or dropped a file on the screen she is looking at, and a row saying so is
the same fact twice — the rule `/portal/upload` already follows. What DOES
write one is what happens without her hand: the research ending
(`business.researched`) and the face correcting a section with what she said
in the chat (`business.corrected`). Those are also the kinds the tab refetches
on through `/portal/changes`.

A SECTION THE OWNER EDITS GOES THROUGH THE FACE'S FORMATTING
(`business_draft.rewritten`): a list section is one item per line, whatever
bullet she typed or did not, and the draft keeps one shape whoever wrote it.
"""

import base64
import binascii

import business_context
import business_draft
import business_watch
from fastapi import APIRouter, HTTPException, Request

router = APIRouter()

# Read by the client: the portal shows `error.message` on the tab she is on.
NO_DRAFT = "Todavía no leí tu web: no hay nada que confirmar ni corregir."
NO_SECTION = "No hay ninguna sección «{key}» en tu negocio."
EMPTY = "Escribí cómo querés que quede; vacía no la puedo guardar."
NO_FILE = "No hay ningún archivo {name} en tu negocio."
BAD_NAME = "No puedo guardar un archivo con el nombre «{name}»."
BAD_UPLOAD = "No pude leer el archivo: lo que llegó no es base64."
BUSY = "Ya estoy leyendo tu web. Cuando termine lo vas a ver acá."
NO_WEBSITE = "No sé cuál es tu web: escribila y la leo."


def website(text: str | None) -> str | None:
    """The site the research reads: the one she left (onboarding or this tab),
    else the first page the last research read."""
    _, url = business_draft.company()
    if url:
        return url
    read = business_draft.items(text or "", "sources")
    return read[0] if read else None


def draft_or_404() -> str:
    text = business_context.draft_text()
    if text is None:
        raise HTTPException(404, NO_DRAFT)
    return text


def confirmable(key: str) -> str:
    if key not in business_draft.CONFIRMABLE:
        raise HTTPException(404, NO_SECTION.format(key=key))
    return key


def answer(text: str, key: str) -> dict:
    return {"ok": True, "section": business_context.section(
        text, key, business_draft.confirmations(text))}


@router.get("/portal/business")
def business():
    text = business_context.draft_text()
    return {
        "exists": text is not None,
        "researched_at": business_draft.researched_at(text) if text is not None else None,
        "sources": business_draft.items(text or "", "sources"),
        "website": website(text),
        "researching": business_watch.researching(),
        "sections": business_context.sections(text) if text is not None else [],
        "questions": business_context.questions(text or ""),
        "notes": business_context.notes(),
        "files": business_context.files(),
    }


@router.put("/portal/business/sections/{key}")
async def edit_section(key: str, request: Request):
    """Her version of the section, which is therefore confirmed. `text` is the
    section's markdown as the tab showed it: a list section splits by line and
    drops the bullet, the others keep their paragraphs."""
    confirmable(key)
    text = draft_or_404()
    written = (await request.json())["text"].strip()
    if not written:
        raise HTTPException(400, EMPTY)
    if key in business_draft.LISTS:
        content = [line.strip().removeprefix("- ").removeprefix("* ").strip()
                   for line in written.splitlines() if line.strip()]
    else:
        content = [written]
    text = business_draft.rewritten(text, key, content)
    business_draft.save(text, key)
    return answer(text, key)


@router.post("/portal/business/sections/{key}/confirm")
def confirm_section(key: str):
    confirmable(key)
    text = draft_or_404()
    business_draft.confirm(text, key)
    return answer(text, key)


@router.put("/portal/business/notes")
async def save_notes(request: Request):
    business_context.save_notes((await request.json())["text"])
    return {"ok": True}


@router.post("/portal/business/files")
async def upload_file(request: Request):
    """`{name, content_b64}`, the same body `/portal/upload` takes: the engine
    has no multipart parser (`python-multipart` is not in its image), and the
    portal already sends files this way. Same name, same file: it replaces it."""
    payload = await request.json()
    try:
        blob = base64.b64decode(payload["content_b64"], validate=True)
    except binascii.Error:
        raise HTTPException(400, BAD_UPLOAD) from None
    try:
        target = business_context.file_path(payload["name"])
    except ValueError:
        raise HTTPException(400, BAD_NAME.format(name=payload["name"])) from None
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(blob)
    found = next(f for f in business_context.files() if f["name"] == target.name)
    return {"ok": True, "file": found}


@router.delete("/portal/business/files/{name}")
def delete_file(name: str):
    try:
        target = business_context.file_path(name)
    except ValueError:
        raise HTTPException(404, NO_FILE.format(name=name)) from None
    if not target.is_file():
        raise HTTPException(404, NO_FILE.format(name=name))
    target.unlink()
    return {"ok": True}


@router.post("/portal/business/research")
async def research(request: Request):
    """Read the website again, in the background. `{website?}`; an empty body
    is the website already known. Async so the run is created on the engine's
    loop (`business_watch.start`)."""
    raw = await request.body()
    given = ((await request.json()).get("website") or "").strip() if raw else ""
    if business_watch.researching():
        raise HTTPException(409, BUSY)
    url = given or website(business_context.draft_text())
    if not url:
        raise HTTPException(400, NO_WEBSITE)
    business_watch.start(url)
    return {"ok": True}

