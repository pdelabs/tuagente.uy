#!/usr/bin/env python3
"""A post speaks `vos`, says whose it is, and a text fix keeps the picture.
`python3 engine/tests/test_post_voice.py`.

What the blind QA of 2026-09-23 found in a fresh client's first carousel
(Panadería Verdun, 6.5/10), each one turned into a check the code makes, and
each check called DIRECTLY INSIDE THE CONTAINER with no model and no
generation. Free, a second:

  a. THE `tú` LIST CATCHES `tú` AND NOTHING ELSE — «¿Cuál va contigo?»,
     «tienes», «escríbenos» are caught; «tenés», «sabés», «estás», «el cliente
     elige», «mantiene», a noun like «prueba» are not. A refusal on a correct
     sentence teaches the creator to ignore the check, so the false positives
     are half the test.
  b. `save_post` REFUSES A SLIDE OR A CAPTION IN `tú` — with the word and its
     `vos` form in the refusal, and `imagenes/` exactly as it was: every
     picture and every sidecar still there.
  c. THE CLOSING SLIDE NAMES THE BUSINESS — with a company set, a carousel
     whose last brief does not quote the name is refused; «PASÁ POR PANADERIA
     PRUEBA» passes (case and accents are design, not a different name). A
     single picture has no closing slide and is not asked for one.
  d. AN EDIT TRAVELS AS AN EDIT — `generate_image`'s request with `reference`
     carries the picture as `input_references` (one `image_url` with a data URL
     of its bytes) and the change inside the code's frame; without it, no
     reference key at all. A reference outside the workspace is words. The
     sidecar says `reference`.
  e. AN EDIT IS FILED WITH ITS WHOLE BRIEF — `replace_slide` with an edited
     picture and no `brief` is refused and moves nothing; with one, the
     slide's brief is that one, the old slide is kept, and the return carries
     no file name. `save_post` refuses an edit as a slide of a new post.
  f. THE CREATOR IS HANDED THE BUSINESS — `creator.business()` carries the
     company's name and the draft's text when there is a draft, and says there
     is none when there is not.
  g. THE CLOSING'S NAME IS THE CREATOR'S TO ADD — on the QA agent (AQUA
     Bicicletería, 2026-09-23) a text fix of the closing slide ran twice and
     ended with the owner asked «el sistema exige incluirlo, ¿autorizás?». A
     closing fix whose brief keeps the name goes through the first time; the
     refusal of one that drops it carries the text with the name already added
     and, for a fix, the exact edit call on the new picture, says it is not the
     client's question, and never talks about a system.

IT CLEANS UP AFTER ITSELF, and it never touches the agent's identity: the
company is set by replacing `posts.company` inside the throwaway process.

WHERE IT POINTS. `CORE_CONTAINER` moves it onto a second instance; the default
is the main compose's `tuagente-core`.
"""

import json
import os
import subprocess
import sys

CONTAINER = os.environ.get("CORE_CONTAINER", "tuagente-core")

INSIDE = r"""
import asyncio, base64, json, shutil, sqlite3, sys, types
from datetime import datetime
from pathlib import Path
from PIL import Image

sys.path.insert(0, "/opt/kit/plugins/social/core")
sys.path.insert(0, "/opt/kit/plugins/image/core")
import generate
import posts
import voseo

SESSION = "prueba-post-voice"
SLUG = "prueba-de-voz"
WS = Path("/workspace")
IMG = WS / "imagenes"
COMPANY = "Panadería Prueba"
made = []


def picture(name, prompt, reference=None):
    path = IMG / name
    # A real picture: `save_post` cuts every slide to Instagram's shape.
    Image.new("RGB", (12, 16), "white").save(path)
    made.append(path)
    record = {"prompt": prompt, "format": "feed", "model": "prueba",
              "created_at": "2026-09-23T09:00:00-03:00"}
    if reference:
        record["reference"] = reference
    path.with_suffix(".json").write_text(json.dumps(record, ensure_ascii=False))
    made.append(path.with_suffix(".json"))
    return f"imagenes/{name}"


def call(tool, *args, **kwargs):
    try:
        return {"ok": tools[tool](ctx, *args, **kwargs)}
    except Exception as exc:
        return {"raised": type(exc).__name__, "said": str(exc)}


def untouched(paths):
    return all((WS / p).is_file() and (WS / p).with_suffix(".json").is_file() for p in paths)


IMG.mkdir(parents=True, exist_ok=True)
tools = {name: tool.function for name, tool in posts.toolset().tools.items()}
ctx = types.SimpleNamespace(deps=types.SimpleNamespace(workspace=WS, session_id=SESSION))
report = {}
directory = None
try:
    # (a) the list, as a pure function.
    report["caught"] = {text: voseo.found(text) for text in [
        "¿Cuál va contigo?", "Si tienes hambre, pasá", "Escríbenos hoy",
        "Esto es para ti", "¿Tú qué pedís?", "Puedes elegir",
    ]}
    report["clean"] = {text: voseo.found(text) for text in [
        "¿Con cuál te quedás?", "Si tenés hambre, pasá", "Sabés dónde estás",
        "El cliente elige y la panadería mantiene la receta",
        "Una prueba de masa madre", "Escribinos hoy", "Tu pan, tu merienda",
        "Estás a una cuadra",
    ]}
    report["quoted"] = voseo.quoted('Foto cálida. Texto: «Hola vos» y "chau"')

    # (b) tú on a slide, tú in a caption.
    posts.company = lambda: None
    tu_slide = [picture("voz-a.png", "Pan en la mesa. Texto: «¿Cuál va contigo?»"),
                picture("voz-b.png", "Cierre. Texto: «Pasá a buscarlo»")]
    report["tu_slide"] = call("save_post", SLUG, "Pan de prueba", "Pasá hoy.", ["pan"], "carousel",
                              tu_slide, None, ["a", "b"], False, False, "lista", "mandar")
    report["tu_slide_untouched"] = untouched(tu_slide)
    report["tu_caption"] = call("save_post", SLUG, "Pan de prueba", "Si tienes hambre, vení.", ["pan"],
                                "carousel",
                                [picture("voz-c.png", "Texto: «Pan»"),
                                 picture("voz-d.png", "Texto: «Pasá»")],
                                None, ["a", "b"], False, False, "lista", "mandar")

    # (c) the closing slide's name.
    posts.company = lambda: COMPANY
    unsigned = [picture("voz-e.png", "Texto: «Pan de hoy»"),
                picture("voz-f.png", "Texto: «Pasá a buscarlo»")]
    report["unsigned"] = call("save_post", SLUG, "Pan de prueba", "Pasá hoy.", ["pan"], "carousel",
                              unsigned, None, ["a", "b"], False, False, "lista", "mandar")
    report["unsigned_untouched"] = untouched(unsigned)
    report["single"] = call("save_post", SLUG + "-sola", "Pan de prueba", "Pasá hoy.", ["pan"], "feed",
                            [picture("voz-g.png", "Texto: «Pan de hoy»")], "a")
    if "ok" in report["single"]:
        shutil.rmtree(posts.folder(report["single"]["ok"]["saved"]))
    signed = [picture("voz-h.png", "Texto: «Pan de hoy»"),
              picture("voz-i.png", "Texto: «¿Con quién lo compartís?» y abajo «PASÁ POR PANADERIA PRUEBA»")]
    report["signed"] = call("save_post", SLUG, "Pan de prueba", "Pasá hoy.", ["pan"], "carousel",
                            signed, None, ["a", "b"], False, False, "lista", "mandar")
    post_id = report["signed"]["ok"]["saved"]
    directory = posts.folder(post_id)

    # (d) the request an edit makes.
    edit = generate.request("el texto «A» pasa a decir «B»", "feed", f"posteos/{post_id}/01.png")
    plain = generate.request("Un pan", "feed", None)
    ref = edit["input_references"][0]
    report["edit"] = {
        "keys": sorted(edit),
        "plain_keys": sorted(plain),
        "type": ref["type"],
        "data_url": ref["image_url"]["url"].startswith("data:image/png;base64,"),
        "same_bytes": base64.b64decode(ref["image_url"]["url"].split(",", 1)[1])
                      == (directory / "01.png").read_bytes(),
        "framed": edit["prompt"].startswith("Editá la imagen de referencia")
                  and "«A» pasa a decir «B»" in edit["prompt"],
        "plain_prompt": plain["prompt"],
    }
    try:
        generate.request("x", "feed", "../../etc/passwd")
        report["outside"] = "accepted"
    except Exception as exc:
        report["outside"] = type(exc).__name__
    scratch = IMG / "voz-brief.png"
    made.append(scratch.with_suffix(".json"))
    generate.write_brief(scratch, "el cambio", "feed", datetime.now(), f"posteos/{post_id}/01.png")
    report["sidecar"] = json.loads(scratch.with_suffix(".json").read_text())

    # (e) filing an edit.
    edited = picture("voz-j.png", "el texto «Pan de hoy» pasa a decir «Pan de ayer»",
                     reference=f"posteos/{post_id}/01.png")
    report["edit_no_brief"] = call("replace_slide", post_id, 1, edited, "otra frase")
    report["edit_no_brief_untouched"] = untouched([edited])
    report["edit_tu_brief"] = call("replace_slide", post_id, 1, edited, "otra frase",
                                   None, "Texto: «¿Tienes hambre?»")
    whole = "Texto: «Pan de ayer»"
    report["edit_fix"] = call("replace_slide", post_id, 1, edited, "otra frase", None, whole)
    data = json.loads((directory / "post.json").read_text())
    report["edit_after"] = {
        "prompts": data["prompts"],
        "kept": [v["file"] for v in data["versions"].get("01.png", [])],
        "kept_prompt": [v["prompt"] for v in data["versions"].get("01.png", [])],
    }
    closing_edit = picture("voz-k.png", "el texto pasa a decir «Vení»",
                           reference=f"posteos/{post_id}/02.png")
    report["closing_edit_unsigned"] = call("replace_slide", post_id, 2, closing_edit,
                                           "otra frase", None, "Texto: «Vení»")
    report["closing_edit_path"] = closing_edit
    # The fix QA asked for: one phrase of the closing changes, the name stays.
    report["closing_edit_signed"] = call("replace_slide", post_id, 2, closing_edit,
                                         "otra frase", None,
                                         "Texto: «Vení a buscarlo» y abajo «PANADERIA PRUEBA»")
    report["edit_as_new"] = call("save_post", SLUG + "-nuevo", "Pan de prueba", "Pasá hoy.", ["pan"], "feed",
                                 [picture("voz-l.png", "el cambio", reference="imagenes/x.png")],
                                 "a")

    # (f) the business, in the creator's prompt.
    import creator
    creator.posts.company = lambda: COMPANY
    creator.DRAFT = "negocio/.prueba-borrador.md"
    draft = WS / creator.DRAFT
    draft.parent.mkdir(parents=True, exist_ok=True)
    report["no_draft"] = creator.business()
    draft.write_text("# Tu negocio\n\nHorno a leña en la calle Prueba 123.\n")
    made.append(draft)
    report["with_draft"] = creator.business()

    db = sqlite3.connect("/state/core.db")
    db.row_factory = sqlite3.Row
    report["events"] = [dict(row) for row in db.execute(
        "SELECT kind, label FROM events WHERE session_id = ? ORDER BY id", (SESSION,))]
    print(json.dumps(report, ensure_ascii=False))
finally:
    if directory is not None and directory.is_dir():
        shutil.rmtree(directory)
    for path in posts.root().iterdir() if posts.root().is_dir() else []:
        if path.name.startswith(posts.BUILDING) or path.name.startswith(
                datetime.now().strftime("%Y-%m-%d") + "-" + SLUG):
            shutil.rmtree(path)
    for path in made:
        if path.is_file():
            path.unlink()
    db = sqlite3.connect("/state/core.db")
    db.execute("DELETE FROM events WHERE session_id = ?", (SESSION,))
    db.commit()
"""


def judge(name: str, problems: list[str]) -> list[str]:
    print(f"  {name}: " + ("PASS" if not problems else "FAIL — " + "; ".join(problems)))
    return problems


def refused(result: dict, *words: str) -> list[str]:
    """A ModelRetry whose message carries every one of `words`."""
    if result.get("raised") != "ModelRetry":
        return [f"not refused: {result}"]
    return [f"the refusal lacks «{w}»: {result['said']}" for w in words if w not in result["said"]]


def main() -> int:
    print(f"container: {CONTAINER}")
    done = subprocess.run(["docker", "exec", CONTAINER, "python3", "-c", INSIDE],
                          capture_output=True, text=True)
    if done.returncode != 0:
        print(done.stderr.strip()[-2000:])
        print("POST VOICE: FAIL")
        return 1
    r = json.loads(done.stdout)
    failures = []

    problems = [f"missed: {text}" for text, words in r["caught"].items() if not words]
    problems += [f"false positive: {text} -> {words}" for text, words in r["clean"].items() if words]
    if r["quoted"] != ["Hola vos", "chau"]:
        problems.append(f"quoted: {r['quoted']}")
    failures += judge("a. the tú list catches tú and nothing else", problems)

    problems = refused(r["tu_slide"], "contigo", "con vos", "lámina 1")
    problems += refused(r["tu_caption"], "tienes", "tenés")
    if not r["tu_slide_untouched"]:
        problems.append("the refused save moved pictures out of imagenes/")
    print(f"  {r['tu_slide'].get('said', '')[:150]}")
    failures += judge("b. save_post refuses a slide or a caption in tú", problems)

    problems = refused(r["unsigned"], "Panadería Prueba")
    if not r["unsigned_untouched"]:
        problems.append("the refused save moved pictures out of imagenes/")
    if "ok" not in r["single"]:
        problems.append(f"a single picture was asked for a closing: {r['single']}")
    if "ok" not in r["signed"]:
        problems.append(f"a signed carousel was refused: {r['signed']}")
    print(f"  {r['unsigned'].get('said', '')[:150]}")
    failures += judge("c. the closing slide names the business", problems)

    problems = []
    edit = r["edit"]
    if "input_references" not in edit["keys"] or "input_references" in edit["plain_keys"]:
        problems.append(f"keys: {edit['keys']} / {edit['plain_keys']}")
    if edit["type"] != "image_url" or not edit["data_url"] or not edit["same_bytes"]:
        problems.append(f"the reference is not the slide as a data URL: {edit}")
    if not edit["framed"] or edit["plain_prompt"] != "Un pan":
        problems.append("the prompt is not framed as an edit, or a plain one was")
    if r["outside"] != "ModelRetry":
        problems.append(f"a reference outside the workspace gave {r['outside']}")
    if not r["sidecar"].get("reference", "").endswith("/01.png"):
        problems.append(f"the sidecar has no reference: {r['sidecar']}")
    failures += judge("d. an edit travels as an edit", problems)

    problems = refused(r["edit_no_brief"], "brief")
    if not r["edit_no_brief_untouched"]:
        problems.append("the refused fix moved the picture")
    problems += refused(r["edit_tu_brief"], "Tienes", "tenés")
    fix = r["edit_fix"]
    if "ok" not in fix:
        problems.append(f"the fix gave {fix}")
    else:
        if any(key in fix["ok"] for key in ("file", "kept")) or not fix["ok"].get("previous_kept"):
            problems.append(f"the return carries file names: {fix['ok']}")
        if r["edit_after"]["prompts"][0] != "Texto: «Pan de ayer»":
            problems.append(f"the brief filed is {r['edit_after']['prompts'][0]!r}")
        if r["edit_after"]["kept"] != ["anteriores/01-1.png"] or r["edit_after"]["kept_prompt"] != ["Texto: «Pan de hoy»"]:
            problems.append(f"the history is {r['edit_after']}")
    problems += refused(r["edit_as_new"], "edición")
    labels = [e["label"] for e in r["events"]]
    if any("slide" in label or "2026-" in label for label in labels):
        problems.append(f"an event names a slide or an id: {labels}")
    print(f"  events: {labels}")
    failures += judge("e. an edit is filed with its whole brief", problems)

    # g. The closing's name is the creator's to add, not the owner's to allow.
    problems = refused(r["unsigned"], "«Pasá a buscarlo. Panadería Prueba»", "rehacé")
    problems += refused(r["closing_edit_unsigned"], "«Vení. Panadería Prueba»",
                        "generate_image", f'reference="{r["closing_edit_path"]}"',
                        "no se le pregunta al cliente")
    for key in ("unsigned", "closing_edit_unsigned"):
        if "sistema" in r[key].get("said", "") or "exige" in r[key].get("said", ""):
            problems.append(f"{key} talks about a system: {r[key]['said']}")
    if "ok" not in r["closing_edit_signed"]:
        problems.append(f"a closing fix that keeps the name was refused: {r['closing_edit_signed']}")
    print(f"  {r['closing_edit_unsigned'].get('said', '')[:220]}")
    failures += judge("g. the closing's name is added by the creator, first time", problems)

    problems = []
    if "Panadería Prueba" not in r["no_draft"] or "Todavía no hay un borrador" not in r["no_draft"]:
        problems.append(f"without a draft: {r['no_draft']!r}")
    if "Horno a leña en la calle Prueba 123." not in r["with_draft"] or "Panadería Prueba" not in r["with_draft"]:
        problems.append(f"with a draft: {r['with_draft']!r}")
    failures += judge("f. the creator is handed the business", problems)

    print("POST VOICE: PASS" if not failures else "POST VOICE: FAIL")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
