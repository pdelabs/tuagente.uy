#!/usr/bin/env python3
"""Which skills belong to every agent, and which ones ride with a hired role.

    python3 roles/skills_split.py --shared        one name per line
    python3 roles/skills_split.py --role-only
    python3 roles/skills_split.py --orphan
    python3 roles/skills_split.py --dirs          name<TAB>its directory in the kit

WHY THIS EXISTS. `install.sh` copies `skills/` into `<agent>/kit-skills/`, which
the compose mounts read only for the WHOLE installation. Before the team pivot
that was right -- one client, one agent, every skill. With a roster it is not:
the accounting role was indexing the brand kit and the Instagram writer, and
every skill's description is loaded on EVERY request. A role carrying the whole
kit is the single fat agent this pivot exists to replace.

THE RULE, mechanical on purpose. A hand-kept list drifts the day someone adds a
skill, and that already cost us once: two skills went into the kit and the next
agent shipped without them.

    A skill is SHARED when every role ON OFFER declares it -- the plumbing a
    role needs to work at all, whatever its craft: ask for approval, deliver a
    file, leave something running, ask for a capability. Everything else belongs
    to the roles that claim it and ships inside their profile
    (roles/build_role.py packs it, tools/hire-role.sh installs it).

    "On offer" is the roster's `state: "ready"`, and it matters because the
    intersection is the whole rule: a half-written entry nobody can hire yet
    would drag it down and take a shared skill out of kit-skills/ on agents
    whose clients never even saw that role.

    Plus the FALLBACK NOTES, which no role claims and every agent needs. The
    engine only puts them in the index when the tool is missing
    (`metadata.hermes.fallback_for_tools`), so they cost nothing when the
    capability is there and they are the only thing standing between a missing
    tool and an agent that fakes the result. They are guardrails, not craft.

    Plus the kit skills behind BASE capabilities. capabilities/catalog.json
    promises every `level: base` row as already installed on every agent
    ("ya viene puesta: no hay que pedirla"), so whatever kit skill such a row
    installs is shared by definition -- a role-only copy would make the base
    card lie on every teammate that lacks that role. Today that is
    `transcribe` (the `transcription` base capability).

A skill that no role claims and is not a fallback reaches NOBODY on a team
agent: `--orphan` lists them so the installer can say so out loud instead of
dropping them in silence.

A SKILL LIVES IN ONE OF TWO PLACES and this file does not care which:
`skills/<name>/`, or the skills surface of a plugin,
`plugins/<id>/skills/<name>/`. They install into the same directory on the
agent (phase 1 of notes/plugin-system-plan.md is repo-side packaging only), so
the split is computed over both and `--dirs` is how `install.sh` finds the
source of each one without knowing about plugins at all.

THE TWO DECLARATIONS MUST AGREE. `roles/catalog.json` is what the client is
sold; `roles/<id>/role.json` is what gets built into the profile. A difference
between them is a role whose price does not match its contents, so this raises
instead of quietly picking one. They had drifted before this check existed: the
catalog was missing `transcribe` on support and `artifact` on sales and
accounting, and nothing said a word.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

KIT = Path(__file__).resolve().parent.parent
CATALOG = KIT / "roles" / "catalog.json"
CAPABILITIES = KIT / "capabilities" / "catalog.json"
SKILLS = KIT / "skills"

sys.path.insert(0, str(KIT / "tools"))
import plugin_registry

# THE ONLY STATE OF A ROLE SOMEBODY CAN HIRE. The roster's own vocabulary: an
# entry is born `unwritten` -- the id, the label and the face exist, the SOUL and
# the flows do not -- and turns `ready` when it can be sold. All four were
# `unwritten` until the phase that wrote them.
#
# WHY THE SPLIT CARES. Shared = declared by EVERY role, so an unwritten entry
# with a skeleton skill list drags the intersection down and pushes a genuinely
# shared skill out of kit-skills/ -- on agents whose clients cannot even hire the
# role that caused it. The draft of a role we have not sold yet must not be able
# to take a screen off a client's portal.
ON_OFFER = "ready"

# A frontmatter item under some key: `      - image_generate`.
ITEM = re.compile(r"^\s+-\s+\S")
# The key, with whatever it carries on its own line: nothing when the list is
# written below it, the list itself when it is written inline.
FALLBACK_KEY = re.compile(r"^\s*fallback_for_tools:\s*(.*?)\s*$")


def skill_dirs() -> dict[str, Path]:
    """Every skill in the kit -> the directory its files live in.

    Both homes at once: `skills/<name>/` and the skills surface of a plugin.
    The registry is validated on the way in, so a name can only come from one
    of the two.
    """
    out = {d.name: d for d in SKILLS.iterdir() if (d / "SKILL.md").is_file()}
    out.update(plugin_registry.skill_sources(KIT))
    return dict(sorted(out.items()))


def all_skills() -> set[str]:
    """Every skill in the kit: a directory with a SKILL.md, like the engine sees it."""
    return set(skill_dirs())


def is_fallback(name: str) -> bool:
    """Does the engine hide this skill until a tool is missing?

    Read by hand and not with a YAML parser for the same reason the rest of the
    kit's checks do: these tools run wherever the operator is, with whatever
    Python is installed, and one missing dependency would take the installer
    down with it.

    BOTH SHAPES OF THE SAME DECLARATION COUNT, because both are YAML and the
    engine cannot tell them apart: the list written under the key -- with a
    comment or a blank line in between, which is where somebody explains why the
    note exists -- and the inline `fallback_for_tools: [web_search]`. Only the
    literal next line used to count, and getting that wrong is expensive in one
    direction: a fallback note read as "not a fallback" stops being shared, no
    role claims it either, and on a team agent it reaches NOBODY -- exactly the
    missing-tool guardrail that keeps an agent from faking a search result. The
    block ends at the next key: an empty `fallback_for_tools:` still declares
    nothing, no matter what the key below it lists.
    """
    lines = (skill_dirs()[name] / "SKILL.md").read_text(encoding="utf-8").splitlines()
    if not lines or lines[0].strip() != "---":
        return False
    frontmatter = lines[1:]
    end = next((i for i, l in enumerate(frontmatter) if l.strip() == "---"), len(frontmatter))
    frontmatter = frontmatter[:end]
    for i, line in enumerate(frontmatter):
        match = FALLBACK_KEY.match(line)
        if not match:
            continue
        inline = match.group(1)
        if inline.startswith("#"):     # a trailing comment is not a value
            inline = ""
        if inline:
            return bool(inline.strip("[] \t"))     # `[]` declares nothing
        for following in frontmatter[i + 1:]:
            if not following.strip() or following.lstrip().startswith("#"):
                continue
            return bool(ITEM.match(following))
        return False
    return False


def declared_by_role() -> dict[str, set[str]]:
    """Each SOLD role's skills, read from the roster and checked against what ships.

    EVERY entry is validated, on offer or not: two declarations that disagree
    are a kit bug either way, and finding it the day the role goes on sale is
    finding it late. Only the ones in `state: "ready"` come back, because those
    are the only ones a client can hire.
    """
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    roles = catalog.get("roles") or []
    if not roles:
        raise SystemExit(f"{CATALOG} has no roles: there is no split to compute")

    existing = all_skills()
    out: dict[str, set[str]] = {}
    for role in roles:
        role_id = role["id"]
        manifest = json.loads(
            (KIT / "roles" / role_id / "role.json").read_text(encoding="utf-8"))
        for key in ("skills", "plugins"):
            sold = set(role.get(key) or [])
            built = set(manifest.get(key) or [])
            if sold != built:
                raise SystemExit(
                    f"{role_id}: the roster and the role manifest declare different {key}.\n"
                    f"    {'roles/catalog.json':<28}{sorted(sold)}\n"
                    f"    {f'roles/{role_id}/role.json':<28}{sorted(built)}\n"
                    "The catalog is what the client buys and role.json is what gets built: "
                    "fix whichever one is wrong before installing anything."
                )
        built = set(manifest.get("skills") or [])
        plugin_registry.check_kit_skills(sorted(built), role_id, KIT)
        missing = sorted(built - existing)
        if missing:
            raise SystemExit(f"{role_id} declares skills that do not exist in skills/: {missing}")
        # A plugin's skills count as the role's, because that is what reaches
        # the agent: the plugin folder is packaging, the installed layout is
        # the same one it always was.
        built |= set(plugin_registry.role_skills(manifest.get("plugins") or [], role_id, KIT))
        if role.get("state") == ON_OFFER:
            out[role_id] = built
    if not out:
        raise SystemExit(
            f"{CATALOG} has no role in state '{ON_OFFER}': nobody can be hired, "
            "so there is no split to compute"
        )
    return out


def base_capability_skills() -> set[str]:
    """Skills that `level: base` capabilities install: promised to every agent.

    BOTH HOMES, BECAUSE `installs` NAMES BOTH. A base row installs a PLUGIN when
    what it installs lives in `plugins/` (today `transcription` -> `transcribe`)
    and a bare `kit_skills` name while it still lives in `skills/`. What the
    SPLIT works in is skill names -- kit-skills/ has one directory per name,
    whoever ships it -- so a declared plugin is expanded into the skills it
    carries. The row promises "ya viene puesta" on every agent, so a role-only
    copy would make the base card lie on every teammate without that role.

    The catalog is validated first, loudly: a base row that named a plugin-owned
    skill under `kit_skills` used to work by accident, and it would stop working
    the day a plugin id and its skill name diverge.
    """
    plugin_registry.check_capability_installs(KIT)
    available = plugin_registry.registry(KIT)
    catalog = json.loads(CAPABILITIES.read_text(encoding="utf-8"))
    names: set[str] = set()
    for entry in catalog["capabilities"]:
        if entry.get("level") != "base":
            continue
        installs = entry.get("installs", {})
        names.update(installs.get("kit_skills", []))
        for pid in installs.get("plugins", []):
            names.update(available[pid]["surfaces"].get("skills") or [])
    missing = sorted(names - all_skills())
    if missing:
        raise SystemExit(
            f"base capabilities install skills that are nowhere in the kit: {missing}"
        )
    return names


def shared_skills() -> list[str]:
    """The plumbing, the guardrails and the base capabilities: every agent gets these."""
    declared = list(declared_by_role().values())
    every_role = set.intersection(*declared)
    fallbacks = {s for s in all_skills() if is_fallback(s)}
    return sorted(every_role | fallbacks | base_capability_skills())


def role_skills() -> list[str]:
    """The craft: what only reaches an agent through the role that claims it."""
    declared = list(declared_by_role().values())
    return sorted(set().union(*declared) - set(shared_skills()))


def orphan_skills() -> list[str]:
    """In the kit, claimed by nobody, and not a fallback: they reach no team agent."""
    return sorted(all_skills() - set(shared_skills()) - set(role_skills()))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--shared", action="store_true", help="skills every agent gets")
    group.add_argument("--role-only", action="store_true", help="skills that ship with a role")
    group.add_argument("--orphan", action="store_true", help="skills no role claims")
    group.add_argument("--dirs", action="store_true",
                       help="every skill and the directory holding it, tab separated")
    args = parser.parse_args()

    if args.dirs:
        for name, directory in skill_dirs().items():
            print(f"{name}\t{directory.relative_to(KIT)}")
        return 0

    if args.shared:
        names = shared_skills()
    elif args.role_only:
        names = role_skills()
    else:
        names = orphan_skills()
    for name in names:
        print(name)
    return 0


if __name__ == "__main__":
    sys.exit(main())
