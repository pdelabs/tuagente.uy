#!/usr/bin/env python3
"""Fill the blanks in brand.json, and record the client's sign-off.

The scan can only write what it observed. Everything that takes a decision --
which logo is official, how the brand speaks, what is never done with it --
arrives later, as an answer in the chat. This is what writes those answers down
without the agent hand-editing JSON.

Filling a field clears its matching entry from `gaps`, so "what is still open"
stays true by construction instead of by someone remembering to update it.
"""

import argparse
import json
import time
from pathlib import Path


def set_path(target: dict, dotted: str, value):
    """Assign a.b.c = value, creating the intermediate maps."""
    keys = dotted.split(".")
    for key in keys[:-1]:
        node = target.get(key)
        if not isinstance(node, dict):
            node = {}
            target[key] = node
        target = node
    target[keys[-1]] = value


def drop_gap(gaps, dotted):
    """A gap reads `voz.tono — explicacion`; the key is what comes before the dash."""
    return [g for g in gaps if g.split(" — ")[0].strip() != dotted]


def main():
    parser = argparse.ArgumentParser(description="Fill blanks and record sign-off on brand.json.")
    parser.add_argument("--brand-dir", default="/opt/data/workspace/brand")
    parser.add_argument("--set", action="append", default=[], metavar="RUTA=VALOR",
                        help="por ejemplo: voz.tono='de vos, cercano y sin marketines'")
    parser.add_argument("--approve", action="store_true", help="el cliente dijo que esta bien")
    parser.add_argument("--reject", action="store_true", help="el cliente pidio cambios")
    parser.add_argument("--by", default="", help="quien contesto")
    parser.add_argument("--note", default="", help="que dijo, en sus palabras")
    args = parser.parse_args()

    source = Path(args.brand_dir) / "brand.json"
    if not source.is_file():
        print(json.dumps({"ok": False, "error": f"no existe {source}; correr scan_site.py primero"},
                         ensure_ascii=False))
        return 1
    if args.approve and args.reject:
        print(json.dumps({"ok": False, "error": "--approve y --reject son excluyentes"},
                         ensure_ascii=False))
        return 1

    kit = json.loads(source.read_text("utf-8"))
    kit.setdefault("gaps", [])
    filled = []

    for pair in args.set:
        if "=" not in pair:
            print(json.dumps({"ok": False, "error": f"esperaba ruta=valor, vino: {pair}"},
                             ensure_ascii=False))
            return 1
        dotted, value = pair.split("=", 1)
        dotted, value = dotted.strip(), value.strip()
        if not value:
            print(json.dumps({
                "ok": False,
                "error": f"'{dotted}' vino vacio. Un hueco sin respuesta se queda como hueco.",
            }, ensure_ascii=False))
            return 1
        set_path(kit, dotted, value)
        kit["gaps"] = drop_gap(kit["gaps"], dotted)
        filled.append(dotted)

    if args.approve or args.reject:
        kit["signoff"] = {
            "status": "aprobado" if args.approve else "con cambios pedidos",
            "at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            "by": args.by or "el cliente",
            "note": args.note,
        }

    source.write_text(json.dumps(kit, ensure_ascii=False, indent=2), "utf-8")
    print(json.dumps({
        "ok": True,
        "filled": filled,
        "signoff": kit.get("signoff", {}).get("status", "sin responder"),
        "gaps_left": kit["gaps"],
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
