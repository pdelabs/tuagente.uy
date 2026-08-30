#!/usr/bin/env python3
"""The plugin registry: read `plugins/`, validate it, resolve it.

The library behind `tools/check-plugins.py`. Everything that needs to know
which plugins exist, or where a plugin's skill or curated flow lives on disk,
comes through here — `tools/plugin_set.py`, `tools/skill_sources.py` and, via
both, `install.sh` and `tools/agent-check.py`.

WHY IT VALIDATES ON EVERY READ. There is one registry and it is small; the
alternative is a caller that half-reads a broken one and installs half a
plugin. `registry()` either returns a whole, closed, acyclic graph or it
raises `SystemExit` with the reason. The design (`notes/plugin-system-plan.md`)
says fail loud twice — and as of phase 3a BOTH halves are this file:
`check-plugins.py` runs it over the repo at build time, `adapter/plugins.py`
runs it over `/opt` when an agent boots. That is the whole point of importing
it rather than copying it. It also means `root` is not always the kit, and one
rule reads differently when it is not — see `_check_skill_slots`.

TWO SHIPMENTS, AND THIS FILE RESOLVES BOTH. The DELIVERY is flat and always
was: a plugin's skills flatten back into the container layout the agent already
has (`/opt/kit/skills/<name>/` or the profile's `skills/<name>/`), so
`skill_sources()` returns exactly what a caller would have found under
`skills/<name>/` before the move, and that copy is the one the ENGINE indexes.
The REGISTRY is the whole folder at `/opt/plugins/<id>/`, which `install.sh` has
been writing since phase 3b and which is what says the plugin is INSTALLED --
what `adapter/plugins.py` scans at boot and `/portal/plugins` publishes. Both
copies are on the agent on purpose (`notes/plugin-system-plan.md`, phase 3b).
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
# The seven surfaces, in the order notes/plugin-system-plan.md lists them.
# `flows` is the one the team pivot left behind: a curated flow used to travel
# inside the role that claimed it (`roles/<id>/flows/`, packed by
# `build_role.py`), and with one agent per client the plugin whose skill the
# flow exercises is what owns it.
SURFACE_KEYS = ("skills", "flows", "engine", "mcp", "service", "adapter", "tab")
# The name of the directory a flow lands in on the agent, which the portal reads
# and the agent edits. The shape is the adapter's (`adapter/flows.py`,
# FLOW_SLUG_RE): a slug it cannot match is a flow the client will never see.
FLOW_SLUG = re.compile(r"^[a-z0-9][a-z0-9-]{0,48}$")


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

    # THE FLOWS SURFACE IS A LIST OF DIRECTORIES, and each one has to hold a
    # FLOW.md, because that file IS the flow: the frontmatter is what the portal
    # draws the card from and the body is what the agent follows. A directory
    # without it installs a folder the client sees nothing of.
    flows = surfaces.get("flows")
    if flows is None:
        flows = []
    if not isinstance(flows, list) or not all(isinstance(f, str) for f in flows):
        fail(where, f"surfaces.flows must be a list of directories inside the "
                    f"plugin, not {flows!r}")
    for rel in flows:
        if not (folder_dir / rel / "FLOW.md").is_file():
            fail(where, f"surfaces.flows declares {rel!r} but there is no "
                        f"{rel}/FLOW.md in the plugin")
        slug = rel.rstrip("/").rsplit("/", 1)[-1]
        if not FLOW_SLUG.match(slug):
            fail(where, f"surfaces.flows declares {rel!r}, whose directory name "
                        f"{slug!r} is not a flow slug — it installs at "
                        "data/flows/<slug>/ and the portal skips what it cannot match")

    for key in ("engine", "mcp", "service", "adapter"):
        value = surfaces.get(key)
        if value is None:
            continue
        if not isinstance(value, str) or not value.strip():
            fail(where, f"surfaces.{key} must be a path inside the plugin, or absent")
        if not (folder_dir / value).exists():
            fail(where, f"surfaces.{key} points at {value!r}, which does not exist in the plugin")

    # THE ENGINE SURFACE IS NOT A FILE OF OURS, IT IS A PLUGIN OF THEIRS. What
    # install.sh ships from there lands where the ENGINE looks for user plugins
    # (HERMES_HOME/plugins), and the engine identifies one by its `plugin.yaml`:
    # a directory without it is discovered and silently not loaded, which is the
    # exact failure the promises guard exists to prevent -- installed, off, and
    # `fleet.md` saying it is there. Checked here because "the file is there" is
    # not "it works", and this is the cheapest place to find that out.
    engine = surfaces.get("engine")
    if engine is not None:
        surface_dir = folder_dir / engine
        if not surface_dir.is_dir():
            fail(where, f"surfaces.engine points at {engine!r}, which is not a directory; "
                        "an engine plugin is a folder the engine loads whole")
        if not (surface_dir / "plugin.yaml").is_file():
            fail(where, f"surfaces.engine {engine!r} has no plugin.yaml — the engine "
                        "discovers a plugin by that file and loads nothing without it")

    # TWO SHAPES, NEVER BOTH. `label` is a page the portal does not have yet:
    # the client reads the word and phase 6 draws the generic plugin page under
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

    TWO HALVES, AND ONLY ONE OF THEM SURVIVES THE TRIP TO AN AGENT. The
    plugin-vs-plugin half is read entirely out of `plugins/` and holds under any
    root. The kit-skill half is seeded from `<root>/skills/` -- which is
    `hermes-kit/skills/` when the root is the repo, and `/opt/skills` when it is
    an agent, where nothing lives: an agent keeps its kit skills one level
    further down, at `/opt/kit/skills/`. So the boot-time caller
    (`adapter/plugins.py`) always seeds this from an empty directory and catches
    two PLUGINS claiming one name, never a plugin colliding with a kit skill.

    THE HALF THAT IS MISSING AT BOOT STAYS MISSING, AND 3b IS WHERE THAT WAS
    DECIDED. It looked like a gap to close once the paths were in front of us;
    it is not. An installed agent's `/opt/kit/skills/` is FULL of delivered
    copies of plugin skills, put there by the installer on purpose, so a boot
    check that read them would find `transcribe` under
    `/opt/plugins/transcribe/skills/` AND under `/opt/kit/skills/` and refuse to
    start -- on every correctly installed agent. The kit-vs-plugin half belongs
    to build time, where both homes are real and there is no delivery to
    confuse it with: `check-plugins.py`, over the repo, before there is an agent
    to install it onto. Do not "fix" it from the boot side
    (notes/plugin-system-plan.md, 3b).
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


def _check_flow_slots(plugins: dict[str, dict]) -> None:
    """One slug, one flow. `data/flows/` has a single directory per name.

    The same rule as `_check_skill_slots` and for the same reason: two plugins
    declaring `presupuesto-nuevo` install into one directory on the agent, which
    is not a merge -- it is one of the two silently winning, and which one
    depends on the order `install.sh` happened to walk the set in.

    PLUGIN AGAINST PLUGIN AND NOTHING ELSE. The other thing in `data/flows/` is
    the CLIENT's own flows, written by the `flow` skill, and a slug of theirs
    that collides with a curated one is a fact about their disk at install time,
    not about this registry -- `install.sh --diff` is what says it, next to
    every other file the kit is about to overwrite.
    """
    seen: dict[str, str] = {}
    for pid, data in sorted(plugins.items()):
        for rel in data["surfaces"].get("flows") or []:
            slug = rel.rstrip("/").rsplit("/", 1)[-1]
            if slug in seen:
                fail(str(data["_dir"] / MANIFEST),
                     f"flow {slug!r} also ships as {seen[slug]}; a flow slug has one "
                     "source, because the installed layout has one directory for it")
            seen[slug] = f"plugins/{pid}/{rel}/"


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
    _check_flow_slots(by_id)
    return by_id


def skill_sources(root: Path = KIT) -> dict[str, Path]:
    """Every skill that ships inside a plugin -> the directory holding it."""
    out: dict[str, Path] = {}
    for data in registry(root).values():
        for name in data["surfaces"].get("skills") or []:
            out[name] = data["_dir"] / "skills" / name
    return dict(sorted(out.items()))


def flow_sources(ids: list[str] | None = None, root: Path = KIT) -> dict[str, Path]:
    """Flow slug -> the directory holding its FLOW.md, for those plugins.

    `None` means the whole registry. What `install.sh` passes is THIS AGENT'S
    plugin set, so a curated flow reaches the client who bought the plugin whose
    work it is and nobody else -- the same rule the folder itself follows.
    """
    available = registry(root)
    out: dict[str, Path] = {}
    for pid in sorted(available if ids is None else ids):
        for rel in available[pid]["surfaces"].get("flows") or []:
            out[rel.rstrip("/").rsplit("/", 1)[-1]] = available[pid]["_dir"] / rel
    return dict(sorted(out.items()))


# A capability the catalog promises as already installed on every agent: the
# card says "ya viene puesta: no hay que pedirla". `tools/plugin_set.py` and
# `tools/skill_sources.py` both key off this word.
BASE = "base"


def capability_rows(root: Path = KIT) -> list[dict]:
    """`capabilities/catalog.json`'s rows, as written.

    THE SALES LAYER IS THE THIRD READER OF THIS REGISTRY, after the roles and
    the installer, and it is the one that says what a client BOUGHT. A capability
    installs a PLUGIN when what it installs lives in `plugins/`, and a bare
    `kit_skills` name only while it still lives in `skills/`.
    """
    catalog = root / "capabilities" / "catalog.json"
    if not catalog.is_file():
        fail(str(catalog), "does not exist; the capabilities catalog is part of the kit")
    data = _read(catalog)
    entries = data.get("capabilities")
    if not isinstance(entries, list):
        fail(str(catalog), "has no `capabilities` list")
    return entries


def capability_installs(root: Path = KIT) -> dict[str, dict]:
    """Each capability's `installs`, keyed by id."""
    return {row.get("id"): (row.get("installs") or {}) for row in capability_rows(root)}


def check_capability_installs(root: Path = KIT) -> None:
    """Every id `installs` names is in the home the key says it is.

    THE OTHER HALF OF THE ONE-SOURCE RULE. `_check_skill_slots` stops a skill
    name from having two homes in the registry; this stops the CATALOG from
    naming the wrong one -- and the catalog is the one that can do real damage,
    because
    `tools/plugin_set.py` reads `installs.plugins` off the `level: base` rows to
    decide what ships on EVERY agent. A base row that still named a skill would
    promise a plugin ("ya viene puesta") that the installer never copies, and
    nothing downstream would say a word: the old code inferred the plugin from
    the skill name, so the wrong key still happened to work, right up until a
    plugin's id stopped matching its skill's.

    AND A `level: base` ROW HAS TO EXIST, WHICH IS THE HALF THE SOLO AGENT WAS
    MISSING. `roles/skills_split.py` refused a base row whose kit skill nobody
    had written -- but only a TEAM agent computed the split, so on a solo agent
    the same catalog installed with rc=0 and said nothing. Measured: promote a
    menu row to base and the solo install exited 0 while the team fixture exited
    1 with "nowhere in the kit". Here it is one rule and one message, and there
    is one path to reach it: install.sh always asks `tools/plugin_set.py`, which
    asks this.

    A MENU ROW MAY NAME A SKILL NOBODY HAS WRITTEN and most of them do -- the
    menu is what we SELL, and the work starts when a client buys one. `base` is
    the word that turns a row into a promise ("ya viene puesta: no hay que
    pedirla"), and that promise is checkable.

    Run at BUILD time (`tools/check-plugins.py`) and at INSTALL time
    (`tools/plugin_set.py`, on every agent). Not at boot: an agent has no `capabilities/catalog.json` next to its
    `plugins/` -- the catalog it carries is `policy/capabilities/`, which is the
    text the CLIENT reads, and the registry validator runs over the agent's root.
    """
    available = registry(root)
    owned = {name: pid
             for pid, data in available.items()
             for name in data["surfaces"].get("skills") or []}
    where = str(root / "capabilities" / "catalog.json")
    rows = capability_rows(root)
    # WHAT A `level: base` ROW INSTALLS IS ON EVERY AGENT, exactly like a system
    # plugin, and the closure rule below has to know it. `tools/plugin_set.py`
    # adds these unconditionally -- `transcribe`, via `transcription` -- so a menu
    # row leaning on one is not selling a client something with nothing behind it.
    # Before this, the rule read `system` alone and refused the first row that
    # needed `transcribe`, with a message telling the author to add it to
    # `installs.plugins`: that "fix" would have written a purchase for a plugin
    # nobody buys, and `plugin_set.py` would then report it as bought AND
    # included. The two lists that decide what ships are system and base; this is
    # the same pair, asked at build time.
    base_installed = {pid
                      for row in rows if row.get("level") == BASE
                      for pid in (row.get("installs") or {}).get("plugins") or []}
    for row in rows:
        cid, installs = row.get("id"), (row.get("installs") or {})
        misplaced = [n for n in installs.get("kit_skills") or [] if n in owned]
        if misplaced:
            fail(where, f"capability {cid!r} installs {misplaced} under `kit_skills`, but "
                        f"they ship inside a plugin "
                        f"({', '.join(f'{n} -> plugins/{owned[n]}/' for n in misplaced)}). "
                        "Move the id to `installs.plugins`: the catalog names the plugin "
                        "when the plugin is where the source lives.")
        declared = installs.get("plugins") or []
        unknown = [p for p in declared if p not in available]
        if unknown:
            fail(where, f"capability {cid!r} installs plugins {unknown}, which are not in "
                        "the registry (hermes-kit/plugins/). A capability sells something "
                        "that exists.")
        # A CAPABILITY INSTALLS ITS PLUGINS' NON-SYSTEM DEPENDENCIES TOO, and the
        # rule is per ROW because a row is what a client buys on its own: a
        # `post-image` sold without `brand-kit` arrives with no hexes to read and
        # `tools/plugin_set.py` refuses the set on that agent, at install time,
        # naming a file the operator cannot fix from there. A system plugin is on
        # every agent by definition, and so is one a `level: base` row installs,
        # so leaning on either needs no declaring.
        #
        # THIS IS WHERE THE ROLE'S HALF OF THE RULE WENT. `role_skills` asked it
        # of `roles/<id>/role.json` -- "this role declares a plugin, so it
        # declares its dependencies" -- and a role is not what anybody buys any
        # more. The capability is, and it is the only declaration left.
        for pid in declared:
            for dependency in available[pid]["requires"].get("plugins") or []:
                if (available[dependency]["system"]
                        or dependency in base_installed
                        or dependency in declared):
                    continue
                fail(where, f"capability {cid!r} installs {pid!r}, which requires "
                            f"{dependency!r}, and this row does not install it. A client "
                            f"who buys only this row gets {pid!r} with nothing behind it, "
                            f"and tools/plugin_set.py refuses the set on their agent. Add "
                            f"{dependency!r} to this row's `installs.plugins` — another "
                            "row installing it is another purchase, not this one.")
        if row.get("level") != BASE:
            continue
        unwritten = [n for n in installs.get("kit_skills") or []
                     if not (root / "skills" / n / "SKILL.md").is_file()]
        if unwritten:
            fail(where, f"capability {cid!r} is `level: {BASE}` and installs kit skills "
                        f"{unwritten}, which nobody has written (skills/). A base row is a "
                        "promise that it is already on every agent, so what it installs has "
                        "to exist before the row says base. A menu row may name a skill "
                        "still to be built.")
