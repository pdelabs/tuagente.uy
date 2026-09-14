#!/usr/bin/env python3
"""Build the skeleton of an Instagram post: format x type, with today's limits.

The skeleton is deterministic on purpose. Writing the words is a language job
and the model does it well; deciding how many slides a carousel has, where the
caption gets cut, how many hashtags are allowed and in what order the ideas go
is NOT a language job, and a model improvising it gets it wrong in a way nobody
notices until the post is live.

Refuses to build anything when there is no brand kit: a post written without the
client's voice sounds like every other agent's post. See references/types.md and
references/formats.md for the reasoning behind these tables.
"""

import argparse
import json
import os
from pathlib import Path

CAPTION_MAX = 2200
HASHTAGS_MAX = 5          # down from 30 in December 2025
SWEET_SPOT = (138, 150)

FORMATS = {
    "feed": {
        "cutoff": 125,
        "slides": None,
        "aspect_ratios": ["4:5", "1:1", "1.91:1"],
        "note": "4:5 ocupa mas pantalla que 1:1.",
    },
    "carousel": {
        "cutoff": 125,
        "slides": (2, 20),
        "slides_via_api": 10,
        "aspect_ratios": ["4:5", "1:1", "1.91:1"],
        "note": "Todas las slides comparten la misma relacion de aspecto.",
    },
    "reel": {
        "cutoff": 58,
        "slides": None,
        "aspect_ratios": ["9:16"],
        "duration": "3 a 90 segundos",
        "note": "Los primeros 3 segundos son el hook, y son visuales antes que hablados.",
    },
    "story": {
        "cutoff": None,
        "slides": (1, 5),
        "aspect_ratios": ["9:16"],
        "note": "No lleva pie. Dejar margen arriba y abajo: ahi hay botones de la interfaz.",
    },
}

TYPES = {
    "educational": ["El problema, en la lengua del que lo sufre",
                    "Por que pasa (una sola causa)",
                    "Los pasos, numerados y accionables hoy",
                    "Como se ve cuando salio bien",
                    "El pedido: guardalo"],
    "social-proof": ["Quien era y que le pasaba",
                     "Que se hizo, concreto",
                     "El resultado, con numero o con plazo",
                     "Que quiere decir para el que lee"],
    "offer": ["Para quien es, dicho de manera que se reconozca",
              "Que incluye",
              "Que NO incluye (este es el que la hace creible)",
              "Precio, o como se cotiza",
              "El pedido: escribinos"],
    "behind-the-scenes": ["Una escena concreta, con hora y lugar",
                          "Que cuesta o que salio mal",
                          "Que se hace igual, y por que",
                          "Cerrar en la escena, sin moraleja"],
    "opinion": ["Lo que 'todo el mundo' hace",
                "Por que no funciona",
                "Que hacemos nosotros en su lugar",
                "Invitar a la discusion de verdad"],
    "announcement": ["Que cambio",
                     "Desde cuando",
                     "Que tiene que hacer el que lee",
                     "Donde pregunta si no entendio"],
    "faq": ["La pregunta tal cual la hacen",
            "La respuesta corta, en la primera linea",
            "El matiz, o el 'depende'",
            "Que hacer ahora"],
}

# From references/types.md. "no" doesn't mean forbidden: it means "know why
# you're doing it".
FIT = {
    "educational": {"feed": "ok", "carousel": "ideal", "reel": "ok", "story": "no"},
    "social-proof": {"feed": "ideal", "carousel": "ideal", "reel": "ok", "story": "ok"},
    "offer": {"feed": "ideal", "carousel": "ok", "reel": "ok", "story": "ok"},
    "behind-the-scenes": {"feed": "ok", "carousel": "no", "reel": "ideal", "story": "ideal"},
    "opinion": {"feed": "ideal", "carousel": "ok", "reel": "ok", "story": "no"},
    "announcement": {"feed": "ideal", "carousel": "no", "reel": "ok", "story": "ideal"},
    "faq": {"feed": "ideal", "carousel": "ideal", "reel": "ok", "story": "ok"},
}

MISSING_KIT = (
    "Para que esto suene a vos y no a cualquiera necesito tu kit de marca: "
    "colores, tipografias y sobre todo como le hablas a tu cliente. "
    "Lo armo leyendo tu web, son un par de minutos. Lo hacemos?"
)


def load_brand(brand_dir):
    source = Path(brand_dir) / "brand.json"
    if not source.is_file():
        return None
    try:
        return json.loads(source.read_text("utf-8"))
    except (OSError, ValueError):
        return None


def main():
    parser = argparse.ArgumentParser(description="Skeleton for one Instagram post.")
    parser.add_argument("--format", required=True, choices=sorted(FORMATS))
    parser.add_argument("--type", required=True, choices=sorted(TYPES))
    parser.add_argument("--slides", type=int, default=0, help="solo carousel; 0 = lo sugiere el tipo")
    parser.add_argument("--via-api", action="store_true",
                        help="el posteo va a salir programado o por herramienta: el techo baja a 10")
    parser.add_argument("--brand-dir", default=os.environ.get("BRAND_DIR", "/opt/data/workspace/brand"))
    args = parser.parse_args()

    brand = load_brand(args.brand_dir)
    if brand is None:
        print(json.dumps({
            "ok": False,
            "missing_kit": True,
            "question": MISSING_KIT,
            "next_steps": "si el cliente dice que si: skill brand-kit. Si dice que no, escribi igual "
                          "pero avisale que va a sonar generico.",
        }, ensure_ascii=False))
        return 2

    spec = FORMATS[args.format]
    beats = TYPES[args.type]
    warnings = []

    slides = None
    if spec["slides"]:
        low, high = spec["slides"]
        if args.format == "carousel":
            high = spec["slides_via_api"] if args.via_api else high
            slides = args.slides or min(max(len(beats) + 1, low), high)
            if args.slides and args.slides > high:
                warnings.append(
                    f"pediste {args.slides} slides y el techo es {high}"
                    + (" porque sale por API" if args.via_api else "") + ": lo bajo a ese numero")
                slides = high
            if not args.via_api:
                warnings.append("si termina saliendo programado o por herramienta, el techo real es 10 slides")
        else:
            slides = args.slides or low

    fit = FIT[args.type][args.format]
    if fit == "no":
        warnings.append(
            f"un posteo '{args.type}' en formato '{args.format}' rara vez funciona; "
            "si vas igual, tene claro por que")

    voz = (brand.get("voz") or {})
    banned_words = voz.get("palabras_vetadas") or ""
    if not voz.get("tono"):
        warnings.append("el kit no tiene voz.tono cargado: preguntaselo antes de escribir "
                        "(fill_kit.py --set voz.tono=...)")

    structure = [{"beat": i + 1, "goal": beat} for i, beat in enumerate(beats)]
    if slides:
        for item in structure[:slides]:
            item["slide"] = item["beat"]

    print(json.dumps({
        "ok": True,
        "format": args.format,
        "type": args.type,
        "fit": fit,
        "limits": {
            "caption_max": CAPTION_MAX,
            "first_line_cutoff": spec["cutoff"],
            "sweet_spot": f"{SWEET_SPOT[0]}-{SWEET_SPOT[1]} caracteres",
            "hashtags_max": HASHTAGS_MAX,
            "slides": slides,
            "aspect_ratios": spec["aspect_ratios"],
            "duration": spec.get("duration"),
        },
        "structure": structure,
        "voz": {"tono": voz.get("tono", ""), "palabras_vetadas": banned_words},
        "colors": (brand.get("colors") or {}).get("roles", {}),
        "hard_rules": [
            f"la primera linea tiene que cerrar antes del caracter {spec['cutoff']}" if spec["cutoff"]
            else "sin pie: el texto va sobre la imagen",
            "un solo pedido por posteo",
            f"maximo {HASHTAGS_MAX} hashtags",
            "no arrancar saludando, describiendo la foto ni con hashtags",
        ],
        "note": spec["note"],
        "warnings": warnings,
        "next": "escribi el borrador y pasalo por check_post.py antes de mostrarlo",
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
