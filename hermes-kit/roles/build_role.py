#!/usr/bin/env python3
"""Assemble a role into a Hermes profile distribution.

    python3 roles/build_role.py marketing [--out DIR]

Produces a directory `hermes profile install` accepts:

    dist/marketing/
      distribution.yaml    manifest the engine reads (version, env, ownership)
      SOUL.md              kit:base block + the role's identity.md
      skills/              only the skills this role owns, whether they come
                           from skills/ or from a plugin's skills surface
      cron/                nothing yet; flows land in flows/
      flows/               the curated flows shipped with the role
      role.json            identity (name + face) for the portal

WHY A BUILDER AND NOT A COMMITTED DIRECTORY. Two things must exist exactly once
in this repo or they drift:

* The `kit:base` SOUL block. It carries the approval rule. Five roles with five
  editable copies means that in three months one of them says something else,
  and that shows up as a role publishing without asking.
* The skills. `brand-kit` belongs to marketing today and may belong to two roles
  tomorrow; copying it per role guarantees the copies diverge.

So roles/<role>/ holds only what is genuinely the role's own — its identity
block, its flows, its manifest — and everything shared is composed at build
time from the single source.

The build FAILS, loudly, if a role's identity.md tries to restate a rule that
belongs to the base block. A role that redefines approval is exactly the drift
this design exists to prevent, and a warning would get skipped.

PLUGINS FLATTEN HERE. A role.json may list `plugins` next to `skills`; each id
is resolved against hermes-kit/plugins/ and its skills are copied into
skills/<name>/ exactly where a kit skill of that name would have gone. That is
the whole of phase 1 (notes/plugin-system-plan.md): the plugin folder is
repo-side packaging and the container layout does not change, so the role.json
that TRAVELS in the distribution is written flattened too -- plugins folded
back into `skills`, no `plugins` key -- because nothing on the agent knows what
a plugin is until phase 3. A plugin id that is not in the registry, or one
whose own `requires.plugins` the role does not declare, fails the build.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

KIT = Path(__file__).resolve().parent.parent
ROLES = KIT / "roles"

sys.path.insert(0, str(KIT / "tools"))
import plugin_registry

# A role's identity block says how it APPLIES the shared rules to its craft --
# that is the whole point of it. What it must never do is restate the rules
# themselves, so only a heading-level redefinition counts as drift.
BASE_TERRITORY_HEADINGS = re.compile(
    r"^#{1,3}\s+.*(regla de aprobaci|antes de actuar|precedencia)", re.I | re.M
)


def read_version() -> str:
    return (KIT / "soul" / "VERSION").read_text(encoding="utf-8").strip()


def build_base_soul() -> str:
    """The shared SOUL block, straight from the one tool that knows how to make it."""
    out = subprocess.run(
        ["bash", str(KIT / "tools" / "install-soul.sh"), "--block"],
        capture_output=True, text=True, check=True,
    )
    return out.stdout


def check_identity(identity: str, role: str) -> None:
    heading = BASE_TERRITORY_HEADINGS.search(identity)
    if heading:
        raise SystemExit(
            f"{role}/identity.md redefines a base-block rule:\n"
            f"    {heading.group(0).strip()}\n"
            "The approval rule lives in soul/01-approvals.md and nowhere else. "
            "State how this role APPLIES it, never what it is."
        )


# Where a skill's files live INSIDE THE CONTAINER depends on who ships it.
# Shared skills stay in kit-skills/ (/opt/kit/skills); a role's craft skills
# travel inside its profile (/opt/data/profiles/<rol>/skills). The kit sources
# are all written against /opt/kit/skills -- true before the team split, and
# still true for a no-roster agent -- so packing a craft skill means rewriting
# those references, or the SKILL.md tells the agent to run scripts from a path
# that no longer exists (found on the lab, 19/8: brand-kit pointing at a
# trimmed kit-skills/). A reference to a skill that ships NEITHER with this
# role NOR shared is a build error, not a silent broken path.
KIT_SKILLS_RE = re.compile(r"/opt/kit/skills/([a-z0-9-]+)/")


def rewrite_kit_paths(dest: Path, role: str, packed: set[str]) -> None:
    import skills_split
    shared = set(skills_split.shared_skills())
    for path in dest.rglob("*"):
        if not path.is_file() or path.suffix not in (".md", ".py", ".txt"):
            continue
        text = path.read_text(encoding="utf-8")

        def cambio(m: "re.Match[str]") -> str:
            name = m.group(1)
            # Shared wins over packed: the plumbing skills ship BOTH shared and
            # inside every profile, and their canonical copy is the kit's --
            # rewriting them per-profile indexes the same skill twice with
            # diverging texts.
            if name in shared:
                return m.group(0)
            if name in packed:
                return f"/opt/data/profiles/{role}/skills/{name}/"
            raise SystemExit(
                f"{role}: {path.relative_to(dest)} references /opt/kit/skills/{name}/ "
                f"but '{name}' ships neither with this role nor shared -- the path "
                f"would be dead on a team agent")

        nuevo = KIT_SKILLS_RE.sub(cambio, text)
        if nuevo != text:
            path.write_text(nuevo, encoding="utf-8")


def skill_sources(cfg: dict, role: str) -> dict[str, Path]:
    """Every skill this role ships -> where its files are in the repo.

    The plugins first and the kit skills after. That is a resolution order, not
    a statement about the role: what the distribution's role.json LISTS is
    sorted (see write_role_json).
    """
    sources = plugin_registry.role_skills(cfg.get("plugins", []), role, KIT)
    plugin_registry.check_kit_skills(cfg.get("skills", []), role, KIT)
    for name in cfg.get("skills", []):
        sources[name] = KIT / "skills" / name
    return sources


def collect_skills(sources: dict[str, Path], dest: Path, role: str) -> int:
    dest.mkdir(parents=True, exist_ok=True)
    for name, source in sources.items():
        if not source.is_dir():
            raise SystemExit(f"{role}: skill '{name}' does not exist in skills/")
        # evals/ stay out of the distribution for the same reason install.sh
        # excludes them: they are our test material, not the client's agent.
        shutil.copytree(source, dest / name, ignore=shutil.ignore_patterns("evals", "__pycache__"))
    rewrite_kit_paths(dest, role, set(sources))
    return len(sources)


def write_role_json(role_dir: Path, dest: Path, sources: dict[str, Path]) -> None:
    """role.json as the agent reads it: the plugins folded back into `skills`.

    The distribution is today's container layout, and today's container has no
    /opt/plugins. A role that declares no plugins is copied byte for byte, so
    the transition cannot move a single distribution it does not have to.

    THE FLATTENED LIST IS SORTED, and that is a decision, not tidiness. Before
    phase 2 the order was an accident of where each name happened to be
    written: marketing said deliverable, artifact, approval and support said
    approval, deliverable, so no two roles even agreed with each other. Moving
    a skill into a plugin re-ordered it, which made every future move look like
    a change to the distribution and buried the ones that are. Nothing reads
    this order -- the agent indexes the skills/ DIRECTORY, and every consumer of
    role.json reads `identity` or compares sets -- so it is free to be
    canonical, and canonical is what stops the question from coming back.
    """
    source = role_dir / "role.json"
    cfg = json.loads(source.read_text(encoding="utf-8"))
    if "plugins" not in cfg:
        shutil.copy2(source, dest / "role.json")
        return
    # `skills` is WRITTEN, not rewritten. A role whose skills all arrive
    # through plugins has no `skills` key of its own, and folding into a key
    # that is not there shipped a distribution whose role.json listed nothing
    # while skills/ held the files -- the manifest and the directory
    # disagreeing, with the build exiting 0.
    flat = {k: v for k, v in cfg.items() if k != "plugins"}
    flat["skills"] = sorted(sources)
    (dest / "role.json").write_text(
        json.dumps(flat, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_manifest(role: str, cfg: dict, dest: Path) -> None:
    env_lines = []
    for entry in cfg.get("env_requires", []):
        env_lines.append(f"  - name: {entry['name']}")
        env_lines.append(f"    description: \"{entry['description']}\"")
        env_lines.append(f"    required: {'true' if entry.get('required') else 'false'}")
    env_block = "\n".join(env_lines) or "  []"

    (dest / "distribution.yaml").write_text(
        f"""# Generated by roles/build_role.py -- do not edit by hand.
# Source: roles/{role}/role.json  ·  SOUL base: {read_version()}
name: {role}
version: {cfg['version']}
description: "tuagente.uy - rol {role}"
author: "tuagente.uy"
license: "proprietary"
env_requires:
{env_block}
# Ours, replaced on every update. Everything else -- memories/, sessions/,
# workspace/, .env -- belongs to the client and is never touched.
distribution_owned:
  - SOUL.md
  - skills/
  - cron/
  - flows/
  - role.json
""",
        encoding="utf-8",
    )


def build(role: str, out_root: Path) -> Path:
    role_dir = ROLES / role
    if not role_dir.is_dir():
        raise SystemExit(f"there is no roles/{role}/")

    cfg = json.loads((role_dir / "role.json").read_text(encoding="utf-8"))
    identity = (role_dir / "identity.md").read_text(encoding="utf-8")
    check_identity(identity, role)

    # Five roles that read the same are one role sold five times. The clone
    # check runs at build time for the same reason check_identity does: the
    # moment a copy-pasted identity would ship is the cheapest moment to stop it.
    clones = subprocess.run(
        [sys.executable, str(KIT / "tools" / "check-clones.py")],
        capture_output=True, text=True,
    )
    if clones.returncode != 0:
        raise SystemExit(
            f"{role}: tools/check-clones.py failed:\n{clones.stdout}{clones.stderr}")

    dest = out_root / role
    if dest.exists():
        shutil.rmtree(dest)
    dest.mkdir(parents=True)

    (dest / "SOUL.md").write_text(build_base_soul() + "\n\n" + identity, encoding="utf-8")
    sources = skill_sources(cfg, role)
    count = collect_skills(sources, dest / "skills", role)

    flows_src = role_dir / "flows"
    flows = 0
    if flows_src.is_dir():
        shutil.copytree(flows_src, dest / "flows")
        flows = len(list((dest / "flows").iterdir()))

    (dest / "cron").mkdir(exist_ok=True)
    write_role_json(role_dir, dest, sources)
    write_manifest(role, cfg, dest)

    soul_bytes = (dest / "SOUL.md").stat().st_size
    print(f"{role} v{cfg['version']}  ->  {dest}")
    print(f"  SOUL.md  {soul_bytes} bytes (base {read_version()} + identity)")
    print(f"  skills   {count}")
    print(f"  flows    {flows}")
    print(f"\n  hermes profile install {dest}")
    return dest


def main() -> int:
    parser = argparse.ArgumentParser(description="Build a role into an installable profile distribution.")
    parser.add_argument("role", help="role id, e.g. marketing")
    parser.add_argument("--out", default=str(KIT / "dist"), help="output root (default: kit/dist)")
    args = parser.parse_args()
    build(args.role, Path(args.out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
