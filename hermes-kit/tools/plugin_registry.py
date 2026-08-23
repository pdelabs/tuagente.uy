#!/usr/bin/env python3
"""The plugin registry: read `plugins/`, validate it, resolve it.

The library behind `tools/check-plugins.py`. Everything that needs to know
which plugins exist, or where a plugin's skill lives on disk, comes through
here — `roles/build_role.py`, `roles/skills_split.py` and, via
`skills_split.py --dirs`, `install.sh`.

WHY IT VALIDATES ON EVERY READ. There is one registry and it is small; the
alternative is a caller that half-reads a broken one and installs half a
plugin. `registry()` either returns a whole, closed, acyclic graph or it
raises `SystemExit` with the reason. The design (`notes/plugin-system-plan.md`)
says fail loud twice — build time here, boot time in phase 3 — and this is the
build-time half.

PHASE 1: PACKAGING ONLY. A plugin's skills flatten back into the container
layout the agent already has (`/opt/kit/skills/<name>/` or the profile's
`skills/<name>/`), so `skill_sources()` returns exactly what a caller would
have found under `skills/<name>/` before the move. `/opt/plugins/<id>/` is
phase 3; nothing here knows about it yet.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

KIT = Path(__file__).resolve().parents[1]

MANIFEST = "plugin.json"

# English kebab-case, and it must equal the folder name. The id travels into
# paths, ticket text and (phase 3) URLs, so it is the same shape everywhere.
ID = re.compile(r"^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$")
# MAJOR.MINOR.PATCH, no leading zeros, no pre-release tail. The plan wants
# semver for ordering agent updates, not for expressing release channels.
SEMVER = re.compile(r"^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$")

REQUIRED_KEYS = ("id", "version", "description", "client_copy", "requires", "surfaces", "system")
# `_comment` is how every closed catalog in this kit carries its reasoning.
ALLOWED_KEYS = REQUIRED_KEYS + ("_comment",)
REQUIRES_KEYS = ("plugins", "connections", "toolsets")
# The six surfaces, in the order notes/plugin-system-plan.md lists them.
SURFACE_KEYS = ("skills", "engine", "mcp", "service", "adapter", "tab")


def fail(where: str, message: str) -> None:
    raise SystemExit(f"{where}: {message}")


def _read(path: Path) -> dict:
    where = str(path)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        fail(where, f"is not valid JSON: {exc}")
    if not isinstance(data, dict):
        fail(where, "must be a JSON object")
    return data


def _check_shape(path: Path, data: dict, folder: str) -> None:
    where = str(path)

    unknown = sorted(set(data) - set(ALLOWED_KEYS))
    if unknown:
        fail(where, f"has keys the manifest does not define: {unknown}")
    missing = [k for k in REQUIRED_KEYS if k not in data]
    if missing:
        fail(where, f"is missing required keys: {missing}")

    if not isinstance(data["id"], str) or not ID.match(data["id"]):
        fail(where, f"id {data['id']!r} is not English kebab-case")
    if data["id"] != folder:
        fail(where, f"id is {data['id']!r} but the folder is {folder!r}; they must be the same")
    if not isinstance(data["version"], str) or not SEMVER.match(data["version"]):
        fail(where, f"version {data['version']!r} is not semver MAJOR.MINOR.PATCH")
    for key in ("description", "client_copy"):
        if not isinstance(data[key], str) or not data[key].strip():
            fail(where, f"{key} must be a non-empty string")
    if not isinstance(data["system"], bool):
        fail(where, "system must be true or false")

    requires = data["requires"]
    if not isinstance(requires, dict):
        fail(where, "requires must be an object")
    unknown = sorted(set(requires) - set(REQUIRES_KEYS))
    if unknown:
        fail(where, f"requires has keys the manifest does not define: {unknown}")
    for key in REQUIRES_KEYS:
        value = requires.get(key, [])
        if not isinstance(value, list) or not all(isinstance(v, str) for v in value):
            fail(where, f"requires.{key} must be a list of strings")

    surfaces = data["surfaces"]
    if not isinstance(surfaces, dict):
        fail(where, "surfaces must be an object")
    unknown = sorted(set(surfaces) - set(SURFACE_KEYS))
    if unknown:
        fail(where, f"surfaces has keys the manifest does not define: {unknown}")


def _check_surfaces(path: Path, data: dict, folder_dir: Path) -> None:
    """Every declared surface points at something that is really there.

    A manifest that promises `endpoints.py` and ships nothing is a plugin that
    installs and then does not work; the install is the wrong place to find
    that out.
    """
    where = str(path)
    surfaces = data["surfaces"]

    # Absent and `null` are the same thing -- no skills surface -- and anything
    # else has to be a list. `or []` also read `0`, `""`, `false` and `{}` as
    # "no skills": a typo in the one key that says what a plugin carries,
    # passing the check and installing a plugin with nothing in it. The four
    # surfaces below already ask the question this way.
    skills = surfaces.get("skills")
    if skills is None:
        skills = []
    if not isinstance(skills, list) or not all(isinstance(s, str) for s in skills):
        fail(where, f"surfaces.skills must be a list of skill names, not {skills!r}")
    for name in skills:
        if not (folder_dir / "skills" / name / "SKILL.md").is_file():
            fail(where, f"surfaces.skills declares {name!r} but there is no "
                        f"skills/{name}/SKILL.md in the plugin")

    for key in ("engine", "mcp", "service", "adapter"):
        value = surfaces.get(key)
        if value is None:
            continue
        if not isinstance(value, str) or not value.strip():
            fail(where, f"surfaces.{key} must be a path inside the plugin, or absent")
        if not (folder_dir / value).exists():
            fail(where, f"surfaces.{key} points at {value!r}, which does not exist in the plugin")

    # TWO SHAPES, NEVER BOTH. `label` is a page the portal does not have yet:
    # the client reads the word and phase 5 draws the generic plugin page under
    # it. `builtin` names a page app/app/ ALREADY has, which is the only shape a
    # system plugin can honestly declare -- its screens were written years before
    # anybody called it a plugin, and inventing a second Pipeline tab next to the
    # real one is worse than declaring nothing.
    #
    # THE CHECK STOPS AT THE SHAPE. It does not open app/ to see whether the page
    # is there: the kit validates manifests and the portal owns its own routes,
    # and a check that reached across that line would make the kit's tests fail
    # on a portal refactor that has nothing to do with plugins.
    tab = surfaces.get("tab")
    if tab is None:
        return
    if not isinstance(tab, dict) or sorted(tab) not in (["builtin"], ["label"]):
        fail(where, "surfaces.tab must be an object with exactly one of `label` (the "
                    "word the client reads, for a page the portal does not have yet) "
                    "or `builtin` (the name of a portal page that already exists)")
    key = "builtin" if "builtin" in tab else "label"
    if not isinstance(tab[key], str) or not tab[key].strip():
        fail(where, f"surfaces.tab.{key} must be a non-empty string")


def _check_graph(plugins: dict[str, dict]) -> None:
    for pid, data in sorted(plugins.items()):
        where = str(data["_dir"] / MANIFEST)
        for dependency in data["requires"].get("plugins", []):
            if dependency not in plugins:
                fail(where, f"requires plugin {dependency!r}, which is not in the registry")
            # A system plugin is on every agent, so anything may lean on it. The
            # other direction cannot hold: a default that needs a plugin only
            # some clients bought is a default that breaks on the rest.
            if data["system"] and not plugins[dependency]["system"]:
                fail(where, f"is a system plugin and requires {dependency!r}, which is not")

    # Cycles, reported as the path that closes them: "a -> b -> a" is the only
    # form of this error anybody can act on.
    state: dict[str, int] = {}
    stack: list[str] = []

    def walk(pid: str) -> None:
        state[pid] = 1
        stack.append(pid)
        for dependency in plugins[pid]["requires"].get("plugins", []):
            if state.get(dependency) == 1:
                cycle = stack[stack.index(dependency):] + [dependency]
                fail(str(plugins[pid]["_dir"] / MANIFEST),
                     "the registry has a dependency cycle: " + " -> ".join(cycle))
            if not state.get(dependency):
                walk(dependency)
        stack.pop()
        state[pid] = 2

    for pid in sorted(plugins):
        if not state.get(pid):
            walk(pid)


def _check_skill_slots(root: Path, plugins: dict[str, dict]) -> None:
    """One skill name, one source. The flattened layout has a single slot.

    `skills/<name>/` and `plugins/<id>/skills/<name>/` install into the same
    directory on the agent, so two of them with the same name is not a merge:
    it is one of the two silently winning.
    """
    seen: dict[str, str] = {}
    for path in sorted((root / "skills").glob("*/SKILL.md")):
        seen[path.parent.name] = f"skills/{path.parent.name}/"
    for pid, data in sorted(plugins.items()):
        for name in data["surfaces"].get("skills") or []:
            here = f"plugins/{pid}/skills/{name}/"
            if name in seen:
                fail(str(data["_dir"] / MANIFEST),
                     f"skill {name!r} also ships as {seen[name]}; a skill name has one "
                     "source, because the installed layout has one directory for it")
            seen[name] = here


def registry(root: Path = KIT) -> dict[str, dict]:
    """Every plugin in `<root>/plugins/`, validated. Keyed by id.

    Each value is the manifest as written plus `_dir`, the plugin's directory.
    """
    plugins_dir = root / "plugins"
    if not plugins_dir.is_dir():
        fail(str(plugins_dir), "does not exist; the plugin registry is part of the kit")

    manifests: list[tuple[Path, dict]] = []
    for folder in sorted(p for p in plugins_dir.iterdir() if p.is_dir()):
        path = folder / MANIFEST
        if not path.is_file():
            fail(str(folder), f"is in plugins/ and has no {MANIFEST}")
        manifests.append((folder, _read(path)))

    by_id: dict[str, dict] = {}
    for folder, data in manifests:
        pid = data.get("id")
        if isinstance(pid, str) and pid in by_id:
            fail(str(folder / MANIFEST),
                 f"declares id {pid!r}, already declared by "
                 f"{by_id[pid]['_dir'].name}/{MANIFEST}")
        _check_shape(folder / MANIFEST, data, folder.name)
        _check_surfaces(folder / MANIFEST, data, folder)
        data["_dir"] = folder
        by_id[data["id"]] = data

    _check_graph(by_id)
    _check_skill_slots(root, by_id)
    return by_id


def skill_sources(root: Path = KIT) -> dict[str, Path]:
    """Every skill that ships inside a plugin -> the directory holding it."""
    out: dict[str, Path] = {}
    for data in registry(root).values():
        for name in data["surfaces"].get("skills") or []:
            out[name] = data["_dir"] / "skills" / name
    return dict(sorted(out.items()))


def check_kit_skills(names: list[str], owner: str, root: Path = KIT) -> None:
    """A role's `skills:` list may only name skills that live in `skills/`.

    THE OTHER HALF OF THE ONE-SOURCE RULE. `_check_skill_slots` stops a skill
    name from having two homes in the REGISTRY; this stops a ROLE from asking
    for a plugin's skill by name instead of declaring the plugin.

    THE TWO READERS OF A role.json USED TO DISAGREE ABOUT IT. `skills_split.py`
    checked the name against every skill in the kit, plugin-owned ones included,
    so `skills: ["artifact"]` passed -- and passing CHANGED THE SPLIT: with
    support and assistant declaring artifact it turned SHARED, and install.sh
    wrote it into kit-skills/ on every team agent, which is the fat agent the
    team pivot exists to replace. `build_role.py` refused the same file, with
    "skill 'artifact' does not exist in skills/" -- pointing at the one place it
    was never going to be. Install said yes, build said no, and the message was
    wrong. One rule, one message, both sides.
    """
    owned = {name: data["id"]
             for data in registry(root).values()
             for name in data["surfaces"].get("skills") or []}
    misplaced = [n for n in names if n in owned]
    if misplaced:
        raise SystemExit(
            f"{owner}: {misplaced} listed under `skills`, but they ship inside a plugin "
            f"({', '.join(f'{n} -> plugins/{owned[n]}/' for n in misplaced)}). A skill has "
            "one source: take the name out of `skills` and declare the plugin under "
            "`plugins`, in roles/catalog.json and in the role manifest.")


def role_skills(ids: list[str], owner: str, root: Path = KIT) -> dict[str, Path]:
    """The skills a role's plugin list contributes, in declaration order.

    A dependency on a NON-system plugin has to be declared by the role too: the
    role's skill index is what its plugins put there, and quietly pulling in a
    dependency's skills would grow a role nobody asked to grow. A system plugin
    is on every agent by definition, so depending on one needs no declaration.
    """
    available = registry(root)
    out: dict[str, Path] = {}
    for pid in ids:
        if pid not in available:
            raise SystemExit(
                f"{owner}: plugin '{pid}' is not in the registry (hermes-kit/plugins/)")
        for dependency in available[pid]["requires"].get("plugins", []):
            if available[dependency]["system"] or dependency in ids:
                continue
            raise SystemExit(
                f"{owner}: plugin '{pid}' requires '{dependency}' and this role does not "
                f"declare it. Add '{dependency}' to its plugins list.")
        for name in available[pid]["surfaces"].get("skills") or []:
            out[name] = available[pid]["_dir"] / "skills" / name
    return out
