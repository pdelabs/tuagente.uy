#!/usr/bin/env python3
"""Is the plugin registry whole? Run it before building or installing anything.

    python3 tools/check-plugins.py            the kit's own plugins/, table + exit 0/1
    python3 tools/check-plugins.py --root DIR another copy of the kit

Exit 0 = the registry is a closed, acyclic graph and every declared surface is
really there. Exit 1 = it is not, and the line above says which manifest and
why. There is no WARN level here: unlike a clone score, none of these is a
judgement call. A duplicate id, an id that is not its folder name, a version
that is not semver, a dependency on a plugin nobody wrote, a cycle, a surface
whose file is missing, a system plugin leaning on one the client may not have
bought, malformed JSON — each of them ships something that does not work, so
each of them stops the build (`roles/build_role.py`) and the install
(`install.sh`, through `roles/skills_split.py`) too.

The rules and the manifest schema live next to the data, in `plugins/README.md`;
the design they come from is `notes/plugin-system-plan.md`. The checking itself
is `tools/plugin_registry.py`, which every consumer goes through, so this
command and a build cannot disagree about what a valid registry is.
"""

import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import plugin_registry


def describe(data: dict) -> str:
    """The surfaces a plugin actually declares, in the plan's order."""
    parts = []
    for key in plugin_registry.SURFACE_KEYS:
        value = data["surfaces"].get(key)
        if not value:
            continue
        if key == "skills":
            parts.append("skills:" + ",".join(value))
        elif key == "tab":
            parts.append("tab:" + value["label"])
        else:
            parts.append(f"{key}:{value}")
    return " ".join(parts) or "no surfaces"


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Whether the plugin registry is whole: ids, versions, dependencies, surfaces.")
    ap.add_argument("--root", metavar="DIR", default=str(plugin_registry.KIT),
                    help="another copy of the kit (defaults to this tools/'s own)")
    args = ap.parse_args()

    root = Path(os.path.abspath(args.root))
    print(f"Checking the plugin registry in {root / 'plugins'}\n")

    try:
        plugins = plugin_registry.registry(root)
    except SystemExit as exc:
        print(f"FAIL: {exc}")
        return 1

    if not plugins:
        print("The registry is empty.")
        return 0

    width = max(len(pid) for pid in plugins)
    for pid, data in sorted(plugins.items()):
        kind = "system" if data["system"] else "client"
        needs = data["requires"].get("plugins") or []
        after = ("  needs " + ", ".join(needs)) if needs else ""
        print(f"  {pid:<{width}}  {data['version']:<8} {kind}  {describe(data)}{after}")

    print(f"\n{len(plugins)} plugin(s), every dependency present, no cycles.")
    print("PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
