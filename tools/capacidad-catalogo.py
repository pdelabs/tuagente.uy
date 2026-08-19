#!/usr/bin/env python3
"""Genera el catálogo que lee el agente, desde capacidades/catalogo.json.

    python3 tools/capacidad-catalogo.py            # lo imprime
    python3 tools/capacidad-catalogo.py --aplicar  # lo escribe en la skill

POR QUE GENERADO: el JSON es la fuente (lo lee el adapter para dibujar la
tarjeta) y el markdown es lo que el agente abre cuando carga la skill. Escritos
a mano por separado se separan, y el día que se separen el agente va a pedir un
id que el portal no sabe dibujar.

Lo que el agente ve es DELIBERADAMENTE menos que el JSON: no ve `instala`, ni
`verifica`, ni `nota_interna`. No los necesita para elegir un id, y son
exactamente las columnas que hablan de máquina.
"""
import argparse
import json
import os
import sys

KIT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CATALOGO = os.path.join(KIT, "capacidades", "catalogo.json")
DESTINO = os.path.join(KIT, "skills", "capacidad", "references", "catalogo.md")

CABECERA = """# Catálogo de capacidades

Lo que se puede pedir hoy. **Elegí un `id` de esta lista**: la mención va sola
en una línea, así — `capacidad:paquete-social` — y el portal la convierte en una
tarjeta con el texto ya escrito.

Si lo que necesitás no está acá, **no inventes un id**: decilo en una frase y
seguí con lo que puedas. No prometas que alguien lo va a resolver.

GENERADO desde `capacidades/catalogo.json` con `tools/capacidad-catalogo.py`.
"""


def _ficha(c, partes):
    partes.append(f"### `{c['id']}` — {c['label']}\n")
    partes.append(f"{c['para_que']}\n")
    detalle = []
    if c.get("como"):
        detalle.append(f"- Cómo se consigue: {c['como']}")
    if c.get("costo"):
        detalle.append(f"- Costo: {c['costo']}")
    if detalle:
        partes.append("\n".join(detalle) + "\n")


def render(datos):
    """El markdown que lee el agente: primero lo que ya tiene, después el menú.

    `nivel: base` va en su propia sección arriba de todo. No es cosmética: el
    agente elige de esta lista, y ofrecer una capacidad que YA está puesta es la
    forma más rápida de que su cliente aprenda a ignorar las tarjetas.
    """
    partes = [CABECERA]
    base = [c for c in datos["capacidades"] if c.get("nivel") == "base"]
    menu = [c for c in datos["capacidades"] if c.get("nivel") != "base"]
    if base:
        partes.append("\n## Ya incluidas en todos los agentes\n")
        partes.append("Estas ya las tenés puestas: **no se piden ni se ofrecen.** "
                      "Están acá para que sepas con qué contás.\n")
        for c in base:
            _ficha(c, partes)
    por_grupo = {}
    for c in menu:
        por_grupo.setdefault(c.get("grupo") or "otras", []).append(c)
    for grupo in sorted(por_grupo):
        partes.append(f"\n## {grupo}\n")
        for c in por_grupo[grupo]:
            _ficha(c, partes)
    return "\n".join(partes)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--aplicar", action="store_true",
                    help="escribirlo en skills/capacidad/references/catalogo.md")
    args = ap.parse_args()
    with open(CATALOGO, encoding="utf-8") as fh:
        datos = json.load(fh)
    texto = render(datos)
    if not args.aplicar:
        print(texto)
        return 0
    os.makedirs(os.path.dirname(DESTINO), exist_ok=True)
    with open(DESTINO, "w", encoding="utf-8") as fh:
        fh.write(texto)
    print(f"escrito: {DESTINO} ({len(datos['capacidades'])} capacidades)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
