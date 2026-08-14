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

CANVAS = {
    "feed": ("1080x1350", "4:5 vertical"),
    "carrusel": ("1080x1350", "4:5 vertical"),
    "historia": ("1080x1920", "9:16 vertical"),
    "reel": ("1080x1920", "9:16 vertical"),
}

FALTA_KIT = (
    "Para que esto salga con tu identidad necesito tu kit de marca: colores, "
    "tipografias y como le hablas a tu cliente. Lo armo leyendo tu web en un par "
    "de minutos. Lo hacemos?"
)


def rules(exact_texts, canvas_note, is_story):
    """Hard rules for the generator. Each one has a scar behind it."""
    items = [
        # gpt-image-2 escribe bien, pero AGREGA texto que nadie pidio: fechas,
        # dominios de relleno, subtitulos en ingles. Enumerar lo que va y
        # prohibir el resto es lo unico que lo contiene.
        "El UNICO texto que puede aparecer en la imagen es, palabra por palabra: "
        + " | ".join(f'"{t}"' for t in exact_texts),
        "No agregues NINGUN otro texto: ni fechas, ni etiquetas, ni subtitulos, "
        "ni marcas de agua, ni texto decorativo de relleno.",
        # Visto: una pieza salio con WWW.REALLYGREATSITE.COM, el placeholder de
        # la herramienta, en el lugar del dominio del cliente.
        "Nunca inventes un dominio, un telefono, un precio ni un dato. Si no esta "
        "en la lista de arriba, no va.",
        # Visto: los codigos hex del brief salieron PINTADOS adentro del dibujo.
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
    parser.add_argument("--formato", required=True, choices=sorted(CANVAS))
    parser.add_argument("--titulo", required=True)
    parser.add_argument("--bajada", default="")
    parser.add_argument("--cta", default="")
    parser.add_argument("--extra", default="", help="texto adicional que SI va en la pieza")
    parser.add_argument("--idea", default="", help="la idea visual, en una linea")
    parser.add_argument("--brand-dir", default=os.environ.get("BRAND_DIR", "/opt/data/workspace/brand"))
    args = parser.parse_args()

    source = Path(args.brand_dir) / "brand.json"
    if not source.is_file():
        print(json.dumps({"ok": False, "falta_kit": True, "pregunta": FALTA_KIT}, ensure_ascii=False))
        return 2
    brand = json.loads(source.read_text("utf-8"))

    roles = (brand.get("colors") or {}).get("roles", {})
    faces = (brand.get("typography") or {}).get("faces", [])
    identity = brand.get("identity") or {}
    voz = brand.get("voz") or {}

    # Las referencias son la parte que mas mueve el resultado: el estilo se
    # muestra, no se describe. Van como imagenes de entrada, no como texto.
    ref_dir = Path(args.brand_dir) / "referencias"
    referencias = sorted(str(p) for p in ref_dir.glob("*")
                         if p.suffix.lower() in (".png", ".jpg", ".jpeg", ".webp")) if ref_dir.is_dir() else []

    exact = [t for t in (args.titulo, args.bajada, args.cta, args.extra) if t.strip()]
    size, canvas_note = CANVAS[args.formato]
    is_story = args.formato in ("historia", "reel")

    paleta = ", ".join(f"{k} {v}" for k, v in roles.items() if v)
    tipografia = faces[0]["family"] if faces else ""

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
    if paleta:
        brief.append(f"Paleta de la marca (usar estos colores, no aproximarlos): {paleta}.")
    if tipografia:
        brief.append(f"Tipografia de la marca: {tipografia}, o una sans-serif geometrica muy parecida.")
    if voz.get("tono"):
        brief.append(f"Tono de la marca: {voz['tono']}.")
    if referencias:
        brief.append(f"Segui el estilo visual de las {len(referencias)} imagenes de referencia adjuntas: "
                     "composicion, densidad, uso del color y tipo de ilustracion.")
    else:
        brief.append("No hay referencias de estilo cargadas: pedile al cliente 2 o 3 posteos que le gusten "
                     "y guardalos en brand/referencias/ para que las proximas piezas sean consistentes.")
    brief.append("")
    brief.append("REGLAS:")
    brief.extend(f"  {i + 1}. {r}" for i, r in enumerate(rules(exact, canvas_note, is_story)))

    print(json.dumps({
        "ok": True,
        "prompt": "\n".join(brief),
        "referencias": referencias,
        "medidas": size,
        "textos_exactos": exact,
        "verificar": [
            "cada texto de 'textos_exactos' aparece completo, sin una letra cambiada",
            "no hay NINGUN texto de mas en la imagen",
            "no hay palabras con letras rotas o inventadas",
            "los colores se parecen a la paleta de la marca",
            "si es historia: nada importante en el 13% de arriba ni en el de abajo",
        ],
        "sin_referencias": not referencias,
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
