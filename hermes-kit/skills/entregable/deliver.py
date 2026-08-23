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
import shutil
import sys
import time
import unicodedata
from pathlib import Path

ENTREGABLES = Path(os.environ.get("ENTREGABLES_DIR", "/opt/data/workspace/entregables"))
# La raiz del workspace sale de ahi, no de una constante aparte: si alguien mueve
# el destino (o lo pisa en una prueba), las referencias que se le dan al portal
# siguen saliendo bien en vez de reventar con un relative_to.
WORKSPACE = ENTREGABLES.parent
KINDS = ("informe", "lista", "borrador", "nota", "analisis")
MAX_BYTES = 5 * 1024 * 1024

# EL TOPE DE LOS ADJUNTOS NO ES NUESTRO: es el que sirve el adapter
# (MAX_FILE_BYTES en portal_adapter.py). Un archivo mas grande se copia igual a
# entregables/ pero el portal contesta 413 y el cliente ve un error en vez de su
# archivo, asi que se avisa fuerte en vez de dejarlo pasar.
MAX_ADJUNTO = 5 * 1024 * 1024
# Lo que el portal sabe mostrar o bajar (app/app/archivos/page.tsx). Otras
# extensiones se copian igual —el portal las baja como binario— pero conviene
# nombrar las que tienen vista propia.
ADJUNTOS_CONOCIDOS = {
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
    # El flujo al que pertenece: el entregable cae en SU carpeta canonica y el
    # portal lo muestra dentro del flujo. Sin esto va a la raiz, como siempre.
    ap.add_argument("--flujo", default="")
    # LOS BINARIOS TAMBIEN SON ENTREGABLES. Sin esto la skill solo tomaba
    # markdown por stdin, asi que la imagen o el video del cliente terminaban en
    # workspace/interno/ —que el portal esconde— y el markdown apuntaba a un
    # archivo invisible. Pasó en la corrida de conducta del 12/8: el PNG y el
    # MP4, que era lo unico que el cliente habia pedido, quedaron ocultos.
    ap.add_argument("--adjunto", action="append", default=[],
                    help="archivo que acompaña al entregable (imagen, video, pdf). Repetible.")
    args = ap.parse_args()

    if args.flujo and not re.match(r"^[a-z0-9][a-z0-9-]{0,48}$", args.flujo):
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
    destino = ENTREGABLES / args.flujo if args.flujo else ENTREGABLES
    destino.mkdir(parents=True, exist_ok=True)
    path = destino / f"{day}-{slug}.md"

    if path.exists() and not args.replace:
        # No pisamos trabajo previo por accidente: sufijo incremental.
        n = 2
        while (destino / f"{day}-{slug}-{n}.md").exists():
            n += 1
        path = destino / f"{day}-{slug}-{n}.md"

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

    # Los adjuntos se copian AL LADO del entregable, con su nombre canonico, y
    # se citan en el cuerpo: el cliente abre la nota y el archivo esta ahi.
    adjuntos = []
    for i, origen_str in enumerate(args.adjunto, 1):
        origen = Path(origen_str)
        if not origen.is_file():
            print(json.dumps({"ok": False, "error": f"el adjunto no existe: {origen}"},
                             ensure_ascii=False))
            return 2
        peso = origen.stat().st_size
        if peso > MAX_ADJUNTO:
            print(json.dumps({
                "ok": False,
                "error": f"el adjunto {origen.name} pesa {peso / 1048576:.1f} MB y el portal "
                         f"sirve hasta {MAX_ADJUNTO // 1048576} MB: el cliente no lo va a poder "
                         "abrir. Achicalo (o entregá un recorte) antes de anunciarlo",
            }, ensure_ascii=False))
            return 2
        sufijo = origen.suffix.lower() or ".bin"
        nombre = f"{day}-{slug}{sufijo}" if len(args.adjunto) == 1 else f"{day}-{slug}-{i}{sufijo}"
        destino_adj = destino / nombre
        n = 2
        while destino_adj.exists() and not args.replace:
            destino_adj = destino / f"{day}-{slug}-{i}-{n}{sufijo}"
            n += 1
        shutil.copy2(origen, destino_adj)
        adjuntos.append({
            "ruta_para_releer": str(destino_adj),
            "referencia_para_citar":
                f"workspace/{destino_adj.relative_to(WORKSPACE).as_posix()}",
            "peso_kb": round(peso / 1024),
            "vista_en_el_portal": sufijo in ADJUNTOS_CONOCIDOS,
        })

    cuerpo = body
    if adjuntos:
        lineas = ["", "## Archivos", ""]
        lineas += [f"- `{a['referencia_para_citar']}`" for a in adjuntos]
        cuerpo = body + "\n" + "\n".join(lineas)

    path.write_text("\n".join(front) + f"\n\n# {args.title}\n\n{cuerpo}\n", "utf-8")
    rel = path.relative_to(WORKSPACE)

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
        "adjuntos": adjuntos,
        "nota": "Para volver a abrir el archivo usa ruta_para_releer. "
                "Para nombrarselo al cliente usa referencia_para_citar.",
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
