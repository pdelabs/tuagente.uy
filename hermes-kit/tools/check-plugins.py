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

TWO RULES LIVE HERE AND NOT IN THE VALIDATOR, and that is deliberate.
`requires.connections` and `requires.toolsets` name things that exist OUTSIDE
`plugins/` -- in `connections/catalog.json` and in the `platform_toolsets` block
of `compose/config.base.yaml` -- and neither file is on an agent: the validator
also runs at boot, over `/opt`, through `adapter/plugins.py`. It shape-checks
those two lists and stops, on purpose. This command is the half that knows it is
standing in the repo, so it is the half that can cross the ids, and until now
NOBODY DID: the toolset half of the rule was written down in a comment and the
only reader was one test that compared against a literal three lines above it
(c92ad0b). A misspelt `imagegen` or `gmail` installed a plugin that asks the
engine for a word it does not know.
"""

import argparse
import json
import os
import re
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
            parts.append("tab:" + value["label"] if "label" in value
                         else "tab:builtin/" + value["builtin"])
        else:
            parts.append(f"{key}:{value}")
    return " ".join(parts) or "no surfaces"


def connection_ids(root: Path) -> set[str]:
    """Every connection the kit knows how to set up, by id."""
    catalog = root / "connections" / "catalog.json"
    if not catalog.is_file():
        raise SystemExit(f"{catalog}: does not exist; the connections catalog is "
                         "part of the kit, and it is what `requires.connections` names")
    data = json.loads(catalog.read_text(encoding="utf-8"))
    return {entry.get("id") for entry in data.get("connections") or []}


def platform_toolsets(root: Path) -> set[str]:
    """Every toolset `compose/config.base.yaml` turns on, on any platform.

    Read without PyYAML, which the kit's tools treat as optional (see
    `agent-check.py`'s `has_pyyaml`): the block is `platform_toolsets:`, one
    indented platform per key and one `- name` per line, and it is GENERATED
    (`tools/skills-knob.py --toolsets`), so its shape does not drift by hand.

    ANY PLATFORM COUNTS, NOT ALL THREE. What a plugin declares is that the
    engine knows the word; that the three lists agree with each other is
    `agent-check.py`'s job, against a real agent. What is NOT here is
    `agent.disabled_toolsets`: `tts` and `delegation` are named in that file too
    and a plugin requiring one of them is requiring something this product
    switches off, which is a refusal and not a pass.
    """
    base = root / "compose" / "config.base.yaml"
    if not base.is_file():
        raise SystemExit(f"{base}: does not exist; it is where the kit says which "
                         "toolsets the engine gets, and what `requires.toolsets` names")
    text = base.read_text(encoding="utf-8")
    start = re.search(r"^platform_toolsets:[ \t]*$", text, re.M)
    if not start:
        raise SystemExit(f"{base}: has no `platform_toolsets:` block, so there is "
                         "nothing to check a plugin's `requires.toolsets` against")
    rest = text[start.end():]
    end = re.search(r"^\S", rest, re.M)              # the next top-level key
    block = rest[: end.start()] if end else rest
    return set(re.findall(r"^[ \t]+- ([A-Za-z0-9_.-]+)[ \t]*$", block, re.M))


def check_requires(root: Path, plugins: dict) -> list[str]:
    """The two `requires` lists that are not plugins, crossed against their source.

    Returns one line per bad id, naming the manifest and the id, because those
    two are what the person reading has to act on. The sweep is over the WHOLE
    registry rather than the manifests that declare something today: the misspelt
    id that costs somebody an afternoon is in the plugin nobody has written yet.
    """
    connections = connection_ids(root)
    toolsets = platform_toolsets(root)
    bad = []
    for pid, data in sorted(plugins.items()):
        where = f"plugins/{pid}/{plugin_registry.MANIFEST}"
        for cid in data["requires"].get("connections") or []:
            if cid not in connections:
                bad.append(f"{where}: requires the connection {cid!r}, which "
                           f"connections/catalog.json does not have")
        for toolset in data["requires"].get("toolsets") or []:
            if toolset not in toolsets:
                bad.append(f"{where}: requires the toolset {toolset!r}, which no "
                           f"platform in compose/config.base.yaml turns on")
    return bad


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

    # THE TWO REQUIRES THAT ARE NOT PLUGINS, crossed against the files that own
    # those ids. Every bad one is printed, not only the first: a manifest written
    # from memory usually gets more than one word wrong.
    try:
        bad = check_requires(root, plugins)
    except SystemExit as exc:
        print(f"FAIL: {exc}")
        return 1
    if bad:
        for line in bad:
            print(f"FAIL: {line}")
        return 1

    # THE SALES LAYER IS CHECKED HERE TOO, because a drifted capability entry is
    # a broken registry from the client's side: `installs` is what a `level:
    # base` row promises as already installed, and tools/plugin_set.py reads it.
    try:
        plugin_registry.check_capability_installs(root)
    except SystemExit as exc:
        print(f"FAIL: {exc}")
        return 1

    print(f"\n{len(plugins)} plugin(s), every dependency present, no cycles.")
    print("      requires.connections and requires.toolsets name ids that exist, "
          "in connections/catalog.json and compose/config.base.yaml.")
    print("      capabilities/catalog.json installs only ids that exist, "
          "each from the home it lives in.")
    print("PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
