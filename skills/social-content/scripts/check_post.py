#!/usr/bin/env python3
"""Check a written Instagram caption against the rules that are checkable.

Taste is not checkable and this does not try. Length, the truncation point, the
hashtag ceiling, two competing calls to action and the words the brand said it
never uses ARE checkable, and those are exactly the mistakes that survive a
reread because they look fine in a text editor and only break on a phone.

Reads the caption from stdin. Exits 1 when something is wrong, so it can gate.
"""

import argparse
import json
import os
import re
import sys
import unicodedata
from pathlib import Path

CAPTION_MAX = 2200
HASHTAGS_MAX = 5
CUTOFF = {"feed": 125, "carrusel": 125, "reel": 58, "historia": None}

HASHTAG_RE = re.compile(r"(?<!\w)#\w+", re.UNICODE)

# Aperturas que queman la unica linea que se ve.
OPENERS = [
    (re.compile(r"^\s*[¡!]*\s*(hola|buenas|buen d[ií]a|buenos d[ií]as|feliz \w+)", re.I),
     "arranca saludando: gasta la primera linea, que es lo unico que se ve"),
    (re.compile(r"^\s*#"), "arranca con hashtag"),
    (re.compile(r"^\s*@"), "arranca con una mencion"),
    (re.compile(r"^\s*(ac[aá] (estamos|les dejamos)|en esta (foto|imagen)|les (comparto|dejo) (una |la )?(foto|imagen))", re.I),
     "arranca describiendo la imagen: el lector ya la vio"),
    (re.compile(r"^\s*(bueno|che|hace (mucho )?tiempo que|venimos pensando)", re.I),
     "carraspea antes de decir algo"),
]

# Un pedido por posteo. Dos se parten la accion y no funciona ninguno.
CTA_PATTERNS = {
    "guardar": r"\bguard[aá](lo|te|en)?\b|\bguardate\b",
    "comentar": r"\bcoment[aá]\w*\b|\bdejanos\b.*\bcomentario\b|\bescrib[ií]\w* .*coment",
    "escribir": r"\bescrib[ií]nos\b|\bmandanos\b|\bmensaje directo\b|\bDM\b|\bwhats?app\b",
    "link": r"\blink (en|de) (la )?bio\b|\bentr[aá] a\b|\bvisit[aá]\b",
    "seguir": r"\bsegu[ií]\w*nos\b|\bseguime\b",
    "compartir": r"\bcompart[ií]\w*\b|\bmand[aá]selo\b",
}


def strip_accents(text):
    return "".join(c for c in unicodedata.normalize("NFD", text) if unicodedata.category(c) != "Mn")


def banned_words(brand_dir):
    source = Path(brand_dir) / "brand.json"
    if not source.is_file():
        return []
    try:
        brand = json.loads(source.read_text("utf-8"))
    except (OSError, ValueError):
        return []
    raw = (brand.get("voz") or {}).get("palabras_vetadas") or ""
    return [w.strip() for w in re.split(r"[,;]", raw) if w.strip()]


def main():
    parser = argparse.ArgumentParser(description="Validate an Instagram caption.")
    parser.add_argument("--formato", required=True, choices=sorted(CUTOFF))
    parser.add_argument("--slides", type=int, default=0)
    parser.add_argument("--por-api", action="store_true")
    parser.add_argument("--brand-dir", default=os.environ.get("BRAND_DIR", "/opt/data/workspace/brand"))
    args = parser.parse_args()

    caption = sys.stdin.read()
    stripped = caption.strip()
    problems, notes = [], []

    if not stripped:
        print(json.dumps({"ok": False, "problemas": ["el pie vino vacio"]}, ensure_ascii=False))
        return 1

    if len(caption) > CAPTION_MAX:
        problems.append(f"el pie tiene {len(caption)} caracteres y el techo es {CAPTION_MAX}")

    cutoff = CUTOFF[args.formato]
    first_line = stripped.splitlines()[0].strip()
    if cutoff:
        if len(first_line) > cutoff:
            problems.append(
                f"la primera linea tiene {len(first_line)} caracteres y se corta a los {cutoff}: "
                f"lo que va despues de '{first_line[:cutoff][-25:].strip()}' no lo ve nadie")
        else:
            notes.append(f"primera linea: {len(first_line)}/{cutoff} caracteres")

    hashtags = HASHTAG_RE.findall(caption)
    if len(hashtags) > HASHTAGS_MAX:
        problems.append(
            f"{len(hashtags)} hashtags y el limite es {HASHTAGS_MAX} desde diciembre de 2025: "
            f"sacar {len(hashtags) - HASHTAGS_MAX}")

    for pattern, why in OPENERS:
        if pattern.search(first_line):
            problems.append(why)
            break

    found_ctas = [name for name, pattern in CTA_PATTERNS.items()
                  if re.search(pattern, caption, re.I)]
    if len(found_ctas) > 1:
        problems.append(
            f"hay {len(found_ctas)} pedidos distintos ({', '.join(found_ctas)}): dejar uno solo")
    elif not found_ctas:
        notes.append("no se detecto ningun pedido; si es a proposito, esta bien")

    haystack = strip_accents(caption).lower()
    hits = [w for w in banned_words(args.brand_dir)
            if re.search(r"\b" + re.escape(strip_accents(w).lower()) + r"\b", haystack)]
    if hits:
        problems.append(f"usa palabras que la marca dijo no usar: {', '.join(hits)}")

    if args.formato == "carrusel" and args.slides:
        ceiling = 10 if args.por_api else 20
        if args.slides > ceiling:
            problems.append(f"{args.slides} slides y el techo es {ceiling}")
        if args.slides < 2:
            problems.append("un carrusel necesita al menos 2 slides")

    print(json.dumps({
        "ok": not problems,
        "problemas": problems,
        "datos": {
            "caracteres": len(caption),
            "primera_linea": len(first_line),
            "hashtags": len(hashtags),
            "pedidos": found_ctas,
        },
        "notas": notes,
    }, ensure_ascii=False, indent=2))
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
