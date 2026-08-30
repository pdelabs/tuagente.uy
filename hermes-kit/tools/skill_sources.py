#!/usr/bin/env python3
"""Where each of the kit's skills lives. One resolver, two homes.

    python3 tools/skill_sources.py --dirs      name<TAB>its directory in the kit

A SKILL LIVES IN ONE OF TWO PLACES and nothing outside this file has to care
which: `skills/<name>/`, or the skills surface of a plugin,
`plugins/<id>/skills/<name>/`. They install into the same directory on the agent
— `kit-skills/<name>/`, mounted read only at `/opt/kit/skills` — so the only
thing that moves when a skill is packaged into a plugin is where the installer
reads the source from. `install.sh` asks `--dirs` and copies; that is the whole
contract.

IT USED TO BE `roles/skills_split.py`, AND MOST OF THAT FILE WAS THE SPLIT. With
a roster, `install.sh` shipped only the skills EVERY role declared and the craft
ones travelled inside each hired role's profile — the intersection, the
fallback notes and the base capabilities, computed so nobody had to keep a list.
One baptized agent per client removes the split: there is one index and it is
the kit's, so what is left of that file is the resolver it always also was.

THE REGISTRY IS VALIDATED ON THE WAY IN, which is what makes "two homes" safe: a
skill name may exist under `skills/` or in one plugin's skills surface, never in
both, and `plugin_registry._check_skill_slots` is the rule. The flattened layout
has one directory per name; two sources for it is one of them silently winning.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

KIT = Path(__file__).resolve().parents[1]
SKILLS = KIT / "skills"
CAPABILITIES = KIT / "capabilities" / "catalog.json"

sys.path.insert(0, str(KIT / "tools"))
import plugin_registry


def skill_dirs() -> dict[str, Path]:
    """Every skill in the kit -> the directory its files live in.

    Both homes at once: `skills/<name>/` and the skills surface of a plugin.
    """
    out = {d.name: d for d in SKILLS.iterdir() if (d / "SKILL.md").is_file()}
    out.update(plugin_registry.skill_sources(KIT))
    return dict(sorted(out.items()))


def base_capability_skills() -> set[str]:
    """Skills that `level: base` capabilities install: promised to every agent.

    BOTH HOMES, BECAUSE `installs` NAMES BOTH. A base row installs a PLUGIN when
    what it installs lives in `plugins/` (today `transcription` -> `transcribe`)
    and a bare `kit_skills` name while it still lives in `skills/`. What this
    answers is skill NAMES -- kit-skills/ has one directory per name, whoever
    ships it -- so a declared plugin is expanded into the skills it carries.

    THE PROMISE IS THE POINT. The card says "ya viene puesta: no hay que
    pedirla", and that is a claim about every agent we install. This is the
    checkable half of it: what a base row installs has to be among the skills
    the installer actually ships.

    The catalog is validated first, loudly: a base row that named a plugin-owned
    skill under `kit_skills` used to work by accident, and it would stop working
    the day a plugin id and its skill name diverge. That validation is also
    where "the skill exists" lives, and it is reached on EVERY install through
    `tools/plugin_set.py` -- not only here.
    """
    plugin_registry.check_capability_installs(KIT)
    available = plugin_registry.registry(KIT)
    catalog = json.loads(CAPABILITIES.read_text(encoding="utf-8"))
    names: set[str] = set()
    for entry in catalog["capabilities"]:
        if entry.get("level") != plugin_registry.BASE:
            continue
        installs = entry.get("installs", {})
        names.update(installs.get("kit_skills", []))
        for pid in installs.get("plugins", []):
            names.update(available[pid]["surfaces"].get("skills") or [])
    return names


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dirs", action="store_true", required=True,
                        help="every skill and the directory holding it, tab separated")
    parser.parse_args()

    for name, directory in skill_dirs().items():
        print(f"{name}\t{directory.relative_to(KIT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
