#!/usr/bin/env python3
"""Save a deliverable for the client in the right place in the workspace.

The script OWNS THE LOCATION AND THE FORMAT: the agent passes title, kind and
content; the script decides the path, the file name and the metadata. That way
the portal always finds the deliverable and it never mixes with internal
scaffolding.

Usage:
    python3 deliver.py --title "Prospeccion Uruguay" --kind informe \\
        [--tags "uruguay,logistica"] [--slug prospeccion-uruguay] [--replace] \\
        < contenido.md
"""
import argparse
import json
import os
import re
import shutil
import sys
import time
import unicodedata
from pathlib import Path

DELIVERABLES = Path(os.environ.get("DELIVERABLES_DIR", "/opt/data/workspace/entregables"))
# The workspace root comes from there, not from a separate constant: if
# someone moves the destination (or overrides it in a test), the references
# handed to the portal still come out right instead of blowing up on a
# relative_to.
WORKSPACE = DELIVERABLES.parent
KINDS = ("informe", "lista", "borrador", "nota", "analisis")
MAX_BYTES = 5 * 1024 * 1024

# THE ATTACHMENT CAP IS NOT OURS: it is the one the adapter serves
# (MAX_FILE_BYTES in portal_adapter.py). A bigger file still gets copied to
# entregables/, but the portal answers 413 and the client sees an error
# instead of their file, so this warns loudly instead of letting it through.
MAX_ATTACHMENT = 5 * 1024 * 1024
# What the portal knows how to preview or download (app/app/files/page.tsx).
# Other extensions still get copied -- the portal downloads them as binary --
# but it's worth naming the ones that have their own preview.
KNOWN_ATTACHMENTS = {
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg",
    ".pdf", ".mp4", ".mov", ".mp3", ".wav", ".ogg",
    ".xlsx", ".xls", ".csv", ".docx", ".pptx", ".zip",
}


def slugify(text):
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    text = re.sub(r"[^\w\s-]", "", text).strip().lower()
    return re.sub(r"[\s_-]+", "-", text)[:56] or "entregable"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--title", required=True)
    ap.add_argument("--kind", default="informe", choices=KINDS)
    ap.add_argument("--tags", default="")
    ap.add_argument("--slug", default="")
    ap.add_argument("--replace", action="store_true")
    ap.add_argument("--body-file", default="")
    # The flow it belongs to: the deliverable falls into ITS canonical folder
    # and the portal shows it inside the flow. Without this it goes to the
    # root, as always.
    ap.add_argument("--flow", default="")
    # BINARIES ARE DELIVERABLES TOO. Without this the skill only took markdown
    # over stdin, so the client's image or video ended up in
    # workspace/interno/ -- which the portal hides -- and the markdown pointed
    # at an invisible file. Happened in the 12/8 conduct run: the PNG and the
    # MP4, which was the only thing the client had asked for, stayed hidden.
    ap.add_argument("--attachment", action="append", default=[],
                    help="archivo que acompaña al entregable (imagen, video, pdf). Repetible.")
    args = ap.parse_args()

    if args.flow and not re.match(r"^[a-z0-9][a-z0-9-]{0,48}$", args.flow):
        print(json.dumps({"ok": False, "error": "flujo invalido: minusculas, numeros y guiones"}))
        return 2

    body = Path(args.body_file).read_text("utf-8") if args.body_file else sys.stdin.read()
    body = body.strip()
    if not body:
        print(json.dumps({"ok": False, "error": "el contenido vino vacio"}))
        return 2
    if len(body.encode()) > MAX_BYTES:
        print(json.dumps({"ok": False, "error": "el entregable supera 5MB"}))
        return 2

    now = time.time()
    day = time.strftime("%Y-%m-%d", time.localtime(now))
    slug = slugify(args.slug or args.title)
    dest = DELIVERABLES / args.flow if args.flow else DELIVERABLES
    dest.mkdir(parents=True, exist_ok=True)
    path = dest / f"{day}-{slug}.md"

    if path.exists() and not args.replace:
        # Never overwrite previous work by accident: incremental suffix.
        n = 2
        while (dest / f"{day}-{slug}-{n}.md").exists():
            n += 1
        path = dest / f"{day}-{slug}-{n}.md"

    tags = [t.strip() for t in args.tags.split(",") if t.strip()]
    front = [
        "---",
        f"title: {args.title}",
        f"kind: {args.kind}",
        f"date: {time.strftime('%Y-%m-%d %H:%M', time.localtime(now))}",
    ]
    if tags:
        front.append(f"tags: {', '.join(tags)}")
    front.append("---")

    # Attachments get copied ALONGSIDE the deliverable, under its canonical
    # name, and cited in the body: the client opens the note and the file is
    # right there.
    attachments = []
    for i, source_str in enumerate(args.attachment, 1):
        source = Path(source_str)
        if not source.is_file():
            print(json.dumps({"ok": False, "error": f"el adjunto no existe: {source}"},
                             ensure_ascii=False))
            return 2
        size = source.stat().st_size
        if size > MAX_ATTACHMENT:
            print(json.dumps({
                "ok": False,
                "error": f"el adjunto {source.name} pesa {size / 1048576:.1f} MB y el portal "
                         f"sirve hasta {MAX_ATTACHMENT // 1048576} MB: el cliente no lo va a poder "
                         "abrir. Achicalo (o entregá un recorte) antes de anunciarlo",
            }, ensure_ascii=False))
            return 2
        suffix = source.suffix.lower() or ".bin"
        name = f"{day}-{slug}{suffix}" if len(args.attachment) == 1 else f"{day}-{slug}-{i}{suffix}"
        dest_attachment = dest / name
        n = 2
        while dest_attachment.exists() and not args.replace:
            dest_attachment = dest / f"{day}-{slug}-{i}-{n}{suffix}"
            n += 1
        shutil.copy2(source, dest_attachment)
        attachments.append({
            "reopen_path": str(dest_attachment),
            "client_reference":
                f"workspace/{dest_attachment.relative_to(WORKSPACE).as_posix()}",
            "size_kb": round(size / 1024),
            "viewable_in_portal": suffix in KNOWN_ATTACHMENTS,
        })

    content = body
    if attachments:
        lines = ["", "## Archivos", ""]
        lines += [f"- `{a['client_reference']}`" for a in attachments]
        content = body + "\n" + "\n".join(lines)

    path.write_text("\n".join(front) + f"\n\n# {args.title}\n\n{content}\n", "utf-8")
    rel = path.relative_to(WORKSPACE)

    # TWO paths, and the names matter: the agent used to pick `referencia` to
    # reread the file and it failed. When it runs as a ticket worker, its
    # working directory is the ticket's scratch dir
    # (/opt/data/kanban/workspaces/t_xxx), so a relative path points somewhere
    # else. Verified on 5/8 with "File not found:
    # /opt/data/kanban/workspaces/t_f218256d/workspace/entregables/...".
    print(json.dumps({
        "ok": True,
        "reopen_path": str(path),          # absolute: works from anywhere
        "client_reference": f"workspace/{rel.as_posix()}",  # the one the portal understands
        "title": args.title,
        "kind": args.kind,
        "attachments": attachments,
        "note": "Para volver a abrir el archivo usa reopen_path. "
                "Para nombrarselo al cliente usa client_reference.",
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
