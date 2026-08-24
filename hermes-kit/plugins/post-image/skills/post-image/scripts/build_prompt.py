#!/usr/bin/env python3
"""Assemble the image-generation brief from the brand kit.

The pixels are the model's job now. THE BRIEF IS NOT: the exact hexes, the font
name, the voice and the client's own style references have to arrive complete on
every single request, and an agent writing them from memory drops one every few
posts -- which is how a feed slowly stops looking like one brand.

So this is the deterministic half of a generative skill: it reads brand.json,
lists the reference images the client picked, and prints one brief plus the
checklist the result must be verified against.

Every rule in RULES was learned by watching a generator break it. Read the
comments before deleting one.
"""

import argparse
import json
import os
from pathlib import Path

# The third value is what `image_generate` expects: the tool does NOT take
# "9:16", it takes a semantic name. Passing the raw ratio does not fail: it
# falls back to the default and returns a HORIZONTAL image, which is useless
# in a story. Measured.
# THE FEED CANNOT BE 4:5 AND SHOULD NOT BE REQUESTED AS ONE. `image_generate`
# only understands three aspects -- square (1:1), landscape (16:9), portrait
# (9:16) -- so 4:5 does not exist through this path. Asking for "portrait" on
# a feed post returned a 9:16 piece: the agent checked it, saw it was not the
# requested format and rightly refused to deliver it. 1:1 is a valid feed
# format and the one that CAN be honoured; promising 4:5 in the brief was
# promising something that never arrives.
CANVAS = {
    "feed": ("1080x1080", "1:1 cuadrado", "square"),
    "carousel": ("1080x1080", "1:1 cuadrado", "square"),
    "story": ("1080x1920", "9:16 vertical", "portrait"),
    "reel": ("1080x1920", "9:16 vertical", "portrait"),
}

MISSING_KIT = (
    "Para que esto salga con tu identidad necesito tu kit de marca: colores, "
    "tipografias y como le hablas a tu cliente. Lo armo leyendo tu web en un par "
    "de minutos. Lo hacemos?"
)


def rules(exact_texts, canvas_note, is_story):
    """Hard rules for the generator. Each one has a scar behind it."""
    items = [
        # gpt-image-2 writes text well, but it ADDS text nobody asked for:
        # dates, filler domains, English subtitles. Enumerating what goes in
        # and forbidding the rest is the only thing that contains it.
        "El UNICO texto que puede aparecer en la imagen es, palabra por palabra: "
        + " | ".join(f'"{t}"' for t in exact_texts),
        "No agregues NINGUN otro texto: ni fechas, ni etiquetas, ni subtitulos, "
        "ni marcas de agua, ni texto decorativo de relleno.",
        # Seen: a piece came out with WWW.REALLYGREATSITE.COM, the tool's own
        # placeholder, where the client's domain should have gone.
        "Nunca inventes un dominio, un telefono, un precio ni un dato. Si no esta "
        "en la lista de arriba, no va.",
        # Seen: the palette's own hex codes came out PAINTED inside the artwork.
        "Los codigos de color de la paleta son para que PINTES con ellos, no para "
        "dibujarlos: no escribas ningun codigo hexadecimal adentro de la imagen.",
        "Todo el texto va en espaniol rioplatense, con sus tildes. Nada en ingles.",
        f"Lienzo {canvas_note}.",
    ]
    if is_story:
        items.append(
            "Deja libre el 13% de arriba y el 13% de abajo: ahi Instagram dibuja "
            "sus propios botones y tapa lo que pongas.")
    return items


def main():
    parser = argparse.ArgumentParser(description="Build the generation brief for one piece.")
    parser.add_argument("--format", required=True, choices=sorted(CANVAS))
    parser.add_argument("--title", required=True)
    parser.add_argument("--subhead", default="")
    parser.add_argument("--cta", default="")
    parser.add_argument("--extra", default="", help="texto adicional que SI va en la pieza")
    parser.add_argument("--idea", default="", help="la idea visual, en una linea")
    parser.add_argument("--brand-dir", default=os.environ.get("BRAND_DIR", "/opt/data/workspace/brand"))
    args = parser.parse_args()

    source = Path(args.brand_dir) / "brand.json"
    if not source.is_file():
        print(json.dumps({"ok": False, "missing_kit": True, "question": MISSING_KIT}, ensure_ascii=False))
        return 2
    brand = json.loads(source.read_text("utf-8"))

    roles = (brand.get("colors") or {}).get("roles", {})
    faces = (brand.get("typography") or {}).get("faces", [])
    identity = brand.get("identity") or {}
    voz = brand.get("voz") or {}

    # References are what moves the result the most: the style is shown, not
    # described. They travel as input images, not as text.
    ref_dir = Path(args.brand_dir) / "referencias"
    references = sorted(str(p) for p in ref_dir.glob("*")
                        if p.suffix.lower() in (".png", ".jpg", ".jpeg", ".webp")) if ref_dir.is_dir() else []

    exact = [t for t in (args.title, args.subhead, args.cta, args.extra) if t.strip()]
    size, canvas_note, aspect = CANVAS[args.format]
    is_story = args.format in ("story", "reel")

    palette = ", ".join(f"{k} {v}" for k, v in roles.items() if v)
    typography = faces[0]["family"] if faces else ""

    brief = [
        f"Pieza de Instagram para {identity.get('name') or 'la marca'}"
        + (f" ({identity.get('tagline')})" if identity.get("tagline") else "") + ".",
        f"Formato: {canvas_note}, {size} px.",
    ]
    if args.idea:
        brief.append(f"Idea visual: {args.idea}")
    brief.append("TEXTO EXACTO QUE VA EN LA PIEZA:")
    for t in exact:
        brief.append(f'  · "{t}"')
    if palette:
        brief.append(f"Paleta de la marca (usar estos colores, no aproximarlos): {palette}.")
    if typography:
        brief.append(f"Tipografia de la marca: {typography}, o una sans-serif geometrica muy parecida.")
    if voz.get("tono"):
        brief.append(f"Tono de la marca: {voz['tono']}.")
    # WATCH WHAT GOES INTO THE BRIEF: everything added to `brief` ends up
    # inside the prompt read by the IMAGE GENERATOR. The notice that
    # references are missing is an instruction for the AGENT -- "ask the
    # client for posts they like" -- and it used to live in here: it travelled
    # in the prompt, i.e. the only one reading it was the image model, which
    # cannot ask anyone anything. It now comes out through
    # `ask_for_references`, which the agent does read.
    if references:
        how_many = "la imagen" if len(references) == 1 else f"las {len(references)} imagenes"
        brief.append(f"Segui el estilo visual de {how_many} de referencia adjunta"
                     f"{'' if len(references) == 1 else 's'}: "
                     "composicion, densidad, uso del color y tipo de ilustracion.")
    brief.append("")
    brief.append("REGLAS:")
    brief.extend(f"  {i + 1}. {r}" for i, r in enumerate(rules(exact, canvas_note, is_story)))

    print(json.dumps({
        "ok": True,
        "prompt": "\n".join(brief),
        "references": references,
        "dimensions": size,
        "aspect_ratio": aspect,
        "exact_texts": exact,
        "checklist": [
            "cada texto de 'exact_texts' aparece completo, sin una letra cambiada",
            "no hay NINGUN texto de mas en la imagen",
            "no hay palabras con letras rotas o inventadas",
            "los colores se parecen a la paleta de la marca",
            "si es historia: nada importante en el 13% de arriba ni en el de abajo",
            "la imagen salio VERTICAL, no horizontal ni cuadrada",
        ],
        "no_references": not references,
        # The ask, already written out and in the client's language. It goes
        # as a field and not in the prompt: it is the agent's job, not the
        # generator's.
        "ask_for_references": (
            "Antes de seguir con las piezas: pasame dos o tres posteos que te gusten "
            "—de quien sea, no tienen que ser de tu rubro— y de ahi saco el estilo. "
            "Describir un estilo con palabras no funciona; mostrarlo si."
        ) if not references else None,
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
