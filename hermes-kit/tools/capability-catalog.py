#!/usr/bin/env python3
"""Generates the catalog the agent reads, from capabilities/catalog.json.

    python3 tools/capability-catalog.py            # prints it
    python3 tools/capability-catalog.py --apply     # writes it into the skill

WHY GENERATED: the JSON is the source (the adapter reads it to draw the card)
and the markdown is what the agent opens when it loads the skill. Hand-written
separately, the two drift apart, and the day they do the agent will ask for an
id the portal doesn't know how to draw.

What the agent sees is DELIBERATELY less than the JSON: it never sees
`installs`, `verifies`, or `internal_note`. It doesn't need them to pick an id,
and those are exactly the columns that talk about the machine.
"""
import argparse
import json
import os
import sys

KIT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CATALOG = os.path.join(KIT, "capabilities", "catalog.json")
DESTINATION = os.path.join(KIT, "skills", "capability", "references", "catalog.md")

HEADER = """# Catálogo de capacidades

Lo que se puede pedir hoy. **Elegí un `id` de esta lista**: la mención va sola
en una línea, así — `capability:social-package` — y el portal la convierte en una
tarjeta con el texto ya escrito.

Si lo que necesitás no está acá, **no inventes un id**: decilo en una frase y
seguí con lo que puedas. No prometas que alguien lo va a resolver.

GENERADO desde `capabilities/catalog.json` con `tools/capability-catalog.py`.
"""


def _entry(c, parts):
    parts.append(f"### `{c['id']}` — {c['label']}\n")
    parts.append(f"{c['purpose']}\n")
    detail = []
    if c.get("how"):
        detail.append(f"- Cómo se consigue: {c['how']}")
    if c.get("cost"):
        detail.append(f"- Costo: {c['cost']}")
    if detail:
        parts.append("\n".join(detail) + "\n")


def render(data):
    """The markdown the agent reads: first what it already has, then the menu.

    `level: base` gets its own section at the very top. It's not cosmetic: the
    agent picks from this list, and offering a capability it ALREADY has is the
    fastest way to teach its client to ignore the cards.
    """
    parts = [HEADER]
    base = [c for c in data["capabilities"] if c.get("level") == "base"]
    menu = [c for c in data["capabilities"] if c.get("level") != "base"]
    if base:
        parts.append("\n## Ya incluidas en todos los agentes\n")
        parts.append("Estas ya las tenés puestas: **no se piden ni se ofrecen.** "
                      "Están acá para que sepas con qué contás.\n")
        for c in base:
            _entry(c, parts)
    by_group = {}
    for c in menu:
        by_group.setdefault(c.get("group") or "other", []).append(c)
    for group in sorted(by_group):
        parts.append(f"\n## {group}\n")
        for c in by_group[group]:
            _entry(c, parts)
    return "\n".join(parts)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--apply", action="store_true",
                    help="write it into skills/capability/references/catalog.md")
    args = ap.parse_args()
    with open(CATALOG, encoding="utf-8") as fh:
        data = json.load(fh)
    text = render(data)
    if not args.apply:
        print(text)
        return 0
    os.makedirs(os.path.dirname(DESTINATION), exist_ok=True)
    with open(DESTINATION, "w", encoding="utf-8") as fh:
        fh.write(text)
    print(f"written: {DESTINATION} ({len(data['capabilities'])} capabilities)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
