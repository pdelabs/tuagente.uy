#!/usr/bin/env python3
"""Which plugins THIS agent has, computed — never a list somebody keeps.

    python3 tools/plugin_set.py <agent>/data           one id per line
    python3 tools/plugin_set.py <agent>/data --why     id<TAB>why it is here

`install.sh` ships `plugins/<id>/` — the whole folder, manifest included — to
`<agent>/plugins/`, which the compose mounts read only at `/opt/plugins`, and
`tools/agent-check.py` asks the same question of an installed agent. Both call
THIS, so "what should be there" and "what is there" can never be two different
answers (notes/plugin-system-plan.md, phase 3b).

WHY IT IS COMPUTED. A hand-kept list of what each agent gets has failed in this
kit before: two skills went into the kit and the next agent shipped without
them, with the SOUL promising transcriptions the agent could not do. The set
comes out of three facts, each read where it already lives:

  system      `"system": true` in the manifest. Every agent, unconditionally --
              that is what lets any client plugin depend on one of the five
              defaults without asking whether this client bought it.
  base        the plugin that owns a kit skill some `level: base` capability
              installs. The catalog promises those as already there on every
              agent ("ya viene puesta"), so the plugin behind one is not
              optional either. Today: `transcribe`, via `transcription`. It is
              the same rule `roles/skills_split.py` applies to the SKILL, asked
              of the plugin that ships it.
  role        what each INSTALLED role declares in `roles/<id>/role.json`. A
              role that is not hired here contributes nothing: `invoices-to-data`
              is accounting's, and an agent without accounting has no reason to
              carry it.

AN INSTALLED ROLE IS A PROFILE DIRECTORY, the same test the adapter makes
(`_role_installed`: `data/profiles/<id>/`). By presence, never by a flag: a flag
has to be kept current and drifts exactly when it matters. And only ids the
roster knows are looked at -- whatever else the engine keeps under `profiles/`
is not a role we sell.

THE DECLARATION IS READ FROM THE KIT AND NOT FROM THE PROFILE, on purpose. The
`role.json` that TRAVELS in a distribution is flattened (its plugins folded into
`skills`, no `plugins` key) and is non-semantic by decision -- see
`plugins/README.md`. The kit is the source of truth for what a role is made of;
the agent's disk only says which roles it hired.

CLOSURE IS ASSERTED, NOT REPAIRED. Quietly adding a missing dependency would
install a plugin nobody's role declared and hide the build-time rule that a
non-system dependency has to be declared (`plugin_registry.role_skills`). If the
set is not closed, that is a kit bug and it stops here.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

KIT = Path(__file__).resolve().parents[1]
ROLES_CATALOG = KIT / "roles" / "catalog.json"

sys.path.insert(0, str(KIT / "tools"))
import plugin_registry

sys.path.insert(0, str(KIT / "roles"))
import skills_split

# Why a plugin is in the set. Printed by `--why`, and by install.sh and
# agent-check when they have to explain themselves to whoever is reading.
SYSTEM = "system"
BASE = "base capability"


def role_ids() -> list[str]:
    """Every role the roster knows, hired or not."""
    catalog = json.loads(ROLES_CATALOG.read_text(encoding="utf-8"))
    return [role["id"] for role in catalog.get("roles") or []]


def installed_roles(data: Path) -> list[str]:
    """The roles hired on this agent: their profile is on disk."""
    profiles = Path(data) / "profiles"
    return [rid for rid in role_ids() if (profiles / rid).is_dir()]


def base_capability_plugins() -> dict[str, str]:
    """Plugin -> the base-capability skill that makes it non-optional."""
    owner = {name: pid
             for pid, data in plugin_registry.registry(KIT).items()
             for name in data["surfaces"].get("skills") or []}
    out: dict[str, str] = {}
    for name in sorted(skills_split.base_capability_skills()):
        if name in owner:
            out[owner[name]] = name
    return out


def plugin_set(data: Path) -> dict[str, list[str]]:
    """Every plugin this agent gets -> the reasons it is in the set, sorted."""
    available = plugin_registry.registry(KIT)
    reasons: dict[str, list[str]] = {}

    def add(pid: str, why: str) -> None:
        reasons.setdefault(pid, [])
        if why not in reasons[pid]:
            reasons[pid].append(why)

    for pid, manifest in available.items():
        if manifest["system"]:
            add(pid, SYSTEM)
    for pid, skill in base_capability_plugins().items():
        add(pid, f"{BASE} ({skill})")
    for rid in installed_roles(data):
        manifest = json.loads(
            (KIT / "roles" / rid / "role.json").read_text(encoding="utf-8"))
        for pid in manifest.get("plugins") or []:
            if pid not in available:
                raise SystemExit(
                    f"roles/{rid}/role.json declares plugin '{pid}', which is not in "
                    "the registry (hermes-kit/plugins/)")
            add(pid, f"role {rid}")

    for pid in sorted(reasons):
        for dependency in available[pid]["requires"].get("plugins") or []:
            if dependency not in reasons:
                raise SystemExit(
                    f"plugins/{pid}/plugin.json requires '{dependency}' and this "
                    f"agent's set does not have it ({', '.join(sorted(reasons))}). "
                    "A role that declares a plugin declares its non-system "
                    "dependencies too — fix the role, not this set.")
    return {pid: reasons[pid] for pid in sorted(reasons)}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("data", help="the agent's data/ directory")
    parser.add_argument("--why", action="store_true",
                        help="print the reason each plugin is in the set")
    args = parser.parse_args()

    data = Path(args.data)
    if not data.is_dir():
        raise SystemExit(f"{data} does not exist — is it the agent's data/?")
    for pid, why in plugin_set(data).items():
        print(f"{pid}\t{', '.join(why)}" if args.why else pid)
    return 0


if __name__ == "__main__":
    sys.exit(main())
