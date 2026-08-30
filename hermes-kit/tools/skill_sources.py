#!/usr/bin/env python3
"""Which skills an agent gets, and where each one's files live. One resolver.

    python3 tools/skill_sources.py --dirs             every skill in the kit
    python3 tools/skill_sources.py --agent <data>     the ones THIS agent gets

Both print `name<TAB>its directory in the kit`. `install.sh` asks `--agent` and
copies exactly that; `--dirs` is the whole-kit view, for looking.

A SKILL LIVES IN ONE OF TWO PLACES and nothing outside this file has to care
which: `skills/<name>/`, or the skills surface of a plugin,
`plugins/<id>/skills/<name>/`. They install into the same directory on the agent
— `kit-skills/<name>/`, mounted read only at `/opt/kit/skills` — so the only
thing that moves when a skill is packaged into a plugin is where the installer
reads the source from.

WHAT AN AGENT GETS IS THE HARNESS PLUS ITS PLUGIN SET, and both halves are the
answer to a different question:

    the harness   everything under `skills/`. Today that is the two FALLBACK
                  NOTES, which the engine only puts in the index when the tool
                  is missing (`metadata.hermes.fallback_for_tools`): they cost
                  nothing when the capability is there and they are the only
                  thing between a missing tool and an agent that fakes the
                  result. They belong to every agent unconditionally and answer
                  to the engine's index, not to anything anybody bought
                  (plugins/README.md, "Harness skills").
    the product   the skills of the plugins in `tools/plugin_set.py`'s set:
                  system, the ones behind a `level: base` capability, and the
                  ones a PURCHASED capability installs.

THE SECOND HALF IS NEW, AND THE OLD ANSWER WAS WRONG IN BOTH DIRECTIONS. Before
the team pivot, a solo agent got every skill in the kit, because there was
nothing else it could mean: one client, one agent, no menu. So an agent whose
client never bought `quotes` still indexed the quote writer — every skill's
description is loaded on EVERY request — while the plugin folder behind it was
not installed, which is a SKILL.md promising work whose tab, routes and flows
are not there. During the pivot the split was per ROLE
(`roles/skills_split.py`); with one baptized agent per client it is per AGENT,
and the source is the same one the folder follows, so the index and the registry
cannot disagree about what this client has.

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
import plugin_set


def skill_dirs() -> dict[str, Path]:
    """Every skill in the kit -> the directory its files live in.

    Both homes at once: `skills/<name>/` and the skills surface of a plugin.
    """
    out = {d.name: d for d in SKILLS.iterdir() if (d / "SKILL.md").is_file()}
    out.update(plugin_registry.skill_sources(KIT))
    return dict(sorted(out.items()))


def harness_skills() -> set[str]:
    """The skills under `skills/`: every agent, unconditionally.

    Not product. A plugin is something a client can BUY, depend on, and lose
    when the capability that installed it is dropped; these answer to the
    engine's index instead, and wrapping them in a manifest would invite a
    capability to install them and `plugin_set.py` to take them away.
    """
    return {d.name for d in SKILLS.iterdir() if (d / "SKILL.md").is_file()}


def agent_skills(data: Path) -> dict[str, Path]:
    """Every skill THIS agent gets -> the directory its files live in.

    The harness plus the skills of the plugins in this agent's set. Asked by
    `install.sh` when it ships and by `tools/agent-check.py` when it verifies
    what is on disk, so "what should be there" and "what is there" cannot be two
    different answers -- the same reason both of them ask `plugin_set.py` about
    the folders.
    """
    available = plugin_registry.registry(KIT)
    names = harness_skills()
    for pid in plugin_set.plugin_set(Path(data)):
        names.update(available[pid]["surfaces"].get("skills") or [])
    dirs = skill_dirs()
    return {name: dirs[name] for name in sorted(names)}


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
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--dirs", action="store_true",
                       help="every skill in the kit and the directory holding it")
    group.add_argument("--agent", metavar="DATA",
                       help="only the skills this agent gets (its data/ directory)")
    args = parser.parse_args()

    if args.agent:
        data = Path(args.agent)
        if not data.is_dir():
            raise SystemExit(f"{data} does not exist — is it the agent's data/?")
        found = agent_skills(data)
    else:
        found = skill_dirs()
    for name, directory in found.items():
        print(f"{name}\t{directory.relative_to(KIT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
