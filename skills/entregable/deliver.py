#!/usr/bin/env python3
"""Guarda un entregable para el cliente en el lugar correcto del workspace.

El script es DUENO DE LA UBICACION Y EL FORMATO: el agente pasa titulo, tipo y
contenido; el script decide ruta, nombre de archivo y metadatos. Asi el portal
siempre encuentra lo entregable y no se mezcla con el andamiaje interno.

Uso:
    python3 deliver.py --title "Prospeccion Uruguay" --kind informe \\
        [--tags "uruguay,logistica"] [--slug prospeccion-uruguay] [--replace] \\
        < contenido.md
"""
import argparse
import json
import os
import re
import sys
import time
import unicodedata
from pathlib import Path

ENTREGABLES = Path(os.environ.get("ENTREGABLES_DIR", "/opt/data/workspace/entregables"))
KINDS = ("informe", "lista", "borrador", "nota", "analisis")
MAX_BYTES = 5 * 1024 * 1024


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
    args = ap.parse_args()

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
    ENTREGABLES.mkdir(parents=True, exist_ok=True)
    path = ENTREGABLES / f"{day}-{slug}.md"

    if path.exists() and not args.replace:
        # No pisamos trabajo previo por accidente: sufijo incremental.
        n = 2
        while (ENTREGABLES / f"{day}-{slug}-{n}.md").exists():
            n += 1
        path = ENTREGABLES / f"{day}-{slug}-{n}.md"

    tags = [t.strip() for t in args.tags.split(",") if t.strip()]
    front = [
        "---",
        f"titulo: {args.title}",
        f"tipo: {args.kind}",
        f"fecha: {time.strftime('%Y-%m-%d %H:%M', time.localtime(now))}",
    ]
    if tags:
        front.append(f"tags: {', '.join(tags)}")
    front.append("---")

    path.write_text("\n".join(front) + f"\n\n# {args.title}\n\n{body}\n", "utf-8")
    rel = path.relative_to(Path("/opt/data/workspace"))

    # DOS rutas, y los nombres importan: el agente elegia `referencia` para
    # releer el archivo y fallaba. Cuando corre como worker de un ticket, su
    # directorio de trabajo es el scratch del ticket
    # (/opt/data/kanban/workspaces/t_xxx), asi que una ruta relativa apunta a
    # otro lado. Verificado el 5/8 con "File not found:
    # /opt/data/kanban/workspaces/t_f218256d/workspace/entregables/...".
    print(json.dumps({
        "ok": True,
        "ruta_para_releer": str(path),          # absoluta: funciona desde cualquier lado
        "referencia_para_citar": f"workspace/{rel.as_posix()}",  # la que entiende el portal
        "titulo": args.title,
        "tipo": args.kind,
        "nota": "Para volver a abrir el archivo usa ruta_para_releer. "
                "Para nombrarselo al cliente usa referencia_para_citar.",
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
