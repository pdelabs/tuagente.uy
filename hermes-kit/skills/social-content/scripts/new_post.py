#!/usr/bin/env python3
"""Build the skeleton of an Instagram post: format x type, with today's limits.

The skeleton is deterministic on purpose. Writing the words is a language job
and the model does it well; deciding how many slides a carousel has, where the
caption gets cut, how many hashtags are allowed and in what order the ideas go
is NOT a language job, and a model improvising it gets it wrong in a way nobody
notices until the post is live.

Refuses to build anything when there is no brand kit: a post written without the
client's voice sounds like every other agent's post. See references/tipos.md and
references/formatos.md for the reasoning behind these tables.
"""

import argparse
import json
import os
from pathlib import Path

CAPTION_MAX = 2200
HASHTAGS_MAX = 5          # bajo de 30 en diciembre de 2025
SWEET_SPOT = (138, 150)

FORMATS = {
    "feed": {
        "corte": 125,
        "slides": None,
        "aspecto": ["4:5", "1:1", "1.91:1"],
        "nota": "4:5 ocupa mas pantalla que 1:1.",
    },
    "carrusel": {
        "corte": 125,
        "slides": (2, 20),
        "slides_api": 10,
        "aspecto": ["4:5", "1:1", "1.91:1"],
        "nota": "Todas las slides comparten la misma relacion de aspecto.",
    },
    "reel": {
        "corte": 58,
        "slides": None,
        "aspecto": ["9:16"],
        "duracion": "3 a 90 segundos",
        "nota": "Los primeros 3 segundos son el hook, y son visuales antes que hablados.",
    },
    "historia": {
        "corte": None,
        "slides": (1, 5),
        "aspecto": ["9:16"],
        "nota": "No lleva pie. Dejar margen arriba y abajo: ahi hay botones de la interfaz.",
    },
}

TYPES = {
    "educativo": ["El problema, en la lengua del que lo sufre",
                  "Por que pasa (una sola causa)",
                  "Los pasos, numerados y accionables hoy",
                  "Como se ve cuando salio bien",
                  "El pedido: guardalo"],
    "prueba": ["Quien era y que le pasaba",
               "Que se hizo, concreto",
               "El resultado, con numero o con plazo",
               "Que quiere decir para el que lee"],
    "oferta": ["Para quien es, dicho de manera que se reconozca",
               "Que incluye",
               "Que NO incluye (este es el que la hace creible)",
               "Precio, o como se cotiza",
               "El pedido: escribinos"],
    "detras": ["Una escena concreta, con hora y lugar",
               "Que cuesta o que salio mal",
               "Que se hace igual, y por que",
               "Cerrar en la escena, sin moraleja"],
    "opinion": ["Lo que 'todo el mundo' hace",
                "Por que no funciona",
                "Que hacemos nosotros en su lugar",
                "Invitar a la discusion de verdad"],
    "anuncio": ["Que cambio",
                "Desde cuando",
                "Que tiene que hacer el que lee",
                "Donde pregunta si no entendio"],
    "faq": ["La pregunta tal cual la hacen",
            "La respuesta corta, en la primera linea",
            "El matiz, o el 'depende'",
            "Que hacer ahora"],
}

# De references/tipos.md. "no" no es prohibido: es "sabes por que lo haces".
FIT = {
    "educativo": {"feed": "ok", "carrusel": "ideal", "reel": "ok", "historia": "no"},
    "prueba": {"feed": "ideal", "carrusel": "ideal", "reel": "ok", "historia": "ok"},
    "oferta": {"feed": "ideal", "carrusel": "ok", "reel": "ok", "historia": "ok"},
    "detras": {"feed": "ok", "carrusel": "no", "reel": "ideal", "historia": "ideal"},
    "opinion": {"feed": "ideal", "carrusel": "ok", "reel": "ok", "historia": "no"},
    "anuncio": {"feed": "ideal", "carrusel": "no", "reel": "ok", "historia": "ideal"},
    "faq": {"feed": "ideal", "carrusel": "ideal", "reel": "ok", "historia": "ok"},
}

FALTA_KIT = (
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
    parser.add_argument("--formato", required=True, choices=sorted(FORMATS))
    parser.add_argument("--tipo", required=True, choices=sorted(TYPES))
    parser.add_argument("--slides", type=int, default=0, help="solo carrusel; 0 = lo sugiere el tipo")
    parser.add_argument("--por-api", action="store_true",
                        help="el posteo va a salir programado o por herramienta: el techo baja a 10")
    parser.add_argument("--brand-dir", default=os.environ.get("BRAND_DIR", "/opt/data/workspace/brand"))
    args = parser.parse_args()

    brand = load_brand(args.brand_dir)
    if brand is None:
        print(json.dumps({
            "ok": False,
            "falta_kit": True,
            "pregunta": FALTA_KIT,
            "como_seguir": "si el cliente dice que si: skill brand-kit. Si dice que no, escribi igual "
                           "pero avisale que va a sonar generico.",
        }, ensure_ascii=False))
        return 2

    spec = FORMATS[args.formato]
    beats = TYPES[args.tipo]
    warnings = []

    slides = None
    if spec["slides"]:
        low, high = spec["slides"]
        if args.formato == "carrusel":
            high = spec["slides_api"] if args.por_api else high
            slides = args.slides or min(max(len(beats) + 1, low), high)
            if args.slides and args.slides > high:
                warnings.append(
                    f"pediste {args.slides} slides y el techo es {high}"
                    + (" porque sale por API" if args.por_api else "") + ": lo bajo a ese numero")
                slides = high
            if not args.por_api:
                warnings.append("si termina saliendo programado o por herramienta, el techo real es 10 slides")
        else:
            slides = args.slides or low

    fit = FIT[args.tipo][args.formato]
    if fit == "no":
        warnings.append(
            f"un posteo '{args.tipo}' en formato '{args.formato}' rara vez funciona; "
            "si vas igual, tene claro por que")

    voz = (brand.get("voz") or {})
    vetadas = voz.get("palabras_vetadas") or ""
    if not voz.get("tono"):
        warnings.append("el kit no tiene voz.tono cargado: preguntaselo antes de escribir "
                        "(fill_kit.py --set voz.tono=...)")

    structure = [{"golpe": i + 1, "objetivo": beat} for i, beat in enumerate(beats)]
    if slides:
        for item in structure[:slides]:
            item["slide"] = item["golpe"]

    print(json.dumps({
        "ok": True,
        "formato": args.formato,
        "tipo": args.tipo,
        "encaje": fit,
        "limites": {
            "pie_max": CAPTION_MAX,
            "corte_primera_linea": spec["corte"],
            "punto_dulce": f"{SWEET_SPOT[0]}-{SWEET_SPOT[1]} caracteres",
            "hashtags_max": HASHTAGS_MAX,
            "slides": slides,
            "aspecto": spec["aspecto"],
            "duracion": spec.get("duracion"),
        },
        "estructura": structure,
        "voz": {"tono": voz.get("tono", ""), "palabras_vetadas": vetadas},
        "colores": (brand.get("colors") or {}).get("roles", {}),
        "reglas_duras": [
            f"la primera linea tiene que cerrar antes del caracter {spec['corte']}" if spec["corte"]
            else "sin pie: el texto va sobre la imagen",
            "un solo pedido por posteo",
            f"maximo {HASHTAGS_MAX} hashtags",
            "no arrancar saludando, describiendo la foto ni con hashtags",
        ],
        "nota": spec["nota"],
        "avisos": warnings,
        "despues": "escribi el borrador y pasalo por check_post.py antes de mostrarlo",
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
