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
    parser.add_argument("--set", action="append", default=[], metavar="PATH=VALUE",
                        help="e.g.: voz.tono='de vos, cercano y sin marketines'")
    parser.add_argument("--approve", action="store_true", help="the client said it's fine")
    parser.add_argument("--reject", action="store_true", help="the client asked for changes")
    parser.add_argument("--by", default="", help="who answered")
    parser.add_argument("--note", default="", help="what they said, in their own words")
    args = parser.parse_args()

    source = Path(args.brand_dir) / "brand.json"
    if not source.is_file():
        print(json.dumps({"ok": False, "error": f"{source} does not exist; run scan_site.py first"},
                         ensure_ascii=False))
        return 1
    if args.approve and args.reject:
        print(json.dumps({"ok": False, "error": "--approve and --reject are mutually exclusive"},
                         ensure_ascii=False))
        return 1

    kit = json.loads(source.read_text("utf-8"))
    kit.setdefault("gaps", [])
    filled = []

    for pair in args.set:
        if "=" not in pair:
            print(json.dumps({"ok": False, "error": f"expected path=value, got: {pair}"},
                             ensure_ascii=False))
            return 1
        dotted, value = pair.split("=", 1)
        dotted, value = dotted.strip(), value.strip()
        if not value:
            print(json.dumps({
                "ok": False,
                "error": f"'{dotted}' came in empty. A gap with no answer stays a gap.",
            }, ensure_ascii=False))
            return 1
        set_path(kit, dotted, value)
        kit["gaps"] = drop_gap(kit["gaps"], dotted)
        filled.append(dotted)

    if args.approve or args.reject:
        kit["signoff"] = {
            "status": "approved" if args.approve else "changes requested",
            "at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            "by": args.by or "the client",
            "note": args.note,
        }

    source.write_text(json.dumps(kit, ensure_ascii=False, indent=2), "utf-8")
    print(json.dumps({
        "ok": True,
        "filled": filled,
        "signoff": kit.get("signoff", {}).get("status", "no answer yet"),
        "gaps_left": kit["gaps"],
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
