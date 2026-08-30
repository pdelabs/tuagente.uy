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
              that is what lets any client plugin depend on one of the six
              defaults without asking whether this client bought it.
  base        a plugin some `level: base` capability declares under
              `installs.plugins`. The catalog promises those as already there on
              every agent ("ya viene puesta"), so they are not optional either.
              Today: `transcribe`, via `transcription`.
  purchased   a plugin some capability the client BOUGHT declares under
              `installs.plugins`, read off this agent's own
              `policy/capabilities/purchased.json`. `quotes` is sales work and
              `invoices-to-data` is accounting work, and neither belongs on an
              agent whose client never bought them.

THE PURCHASE IS THE RECORD, AND IT USED TO BE THE ROSTER. This third source read
`data/profiles/<role>/` — a hired role's profile directory — because the product
sold a TEAM of agents and a role was the thing a client bought. One baptized
agent per client is the decision that replaced it, and the question the source
answers did not change: which of the things we sell did this client say yes to.
`policy/capabilities/purchased.json` answers it in the vocabulary the client
already reads, the ids of `capabilities/catalog.json`, which is also what the
adapter draws the card from and what `policy/capabilities/requests.jsonl`
records the ask in.

NO FILE IS A STATE, NOT A FAILURE. A client who has bought nothing yet is every
client on their first day; the set is the six defaults plus the base capability
and the install says so in one line. A file that IS there and is malformed, or
that names a capability the catalog does not have, is a different thing
entirely and stops here by name.

WHY IT LIVES IN policy/ AND NOT IN data/. `data/` belongs to the agent, which
runs as root inside its own container; what the client bought decides what code
reaches the agent, so an agent that could rewrite it could install itself a
plugin nobody sold. It is the same reason `policy/capabilities/catalog.json` —
the text the client reads — moved out of `data/` before it.

CLOSURE IS ASSERTED, NOT REPAIRED. Quietly adding a missing dependency would
install a plugin nobody bought and hide the build-time rule that a capability
installing a plugin installs its non-system dependencies too
(`plugin_registry.check_capability_installs`). If the set is not closed, that is
a kit bug and it stops here.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

KIT = Path(__file__).resolve().parents[1]
CAPABILITIES = KIT / "capabilities" / "catalog.json"

sys.path.insert(0, str(KIT / "tools"))
import plugin_registry

# Why a plugin is in the set. Printed by `--why`, and by install.sh and
# agent-check when they have to explain themselves to whoever is reading.
SYSTEM = "system"
BASE = "base capability"
PURCHASED = "purchased"

# The per-agent record of what the client bought, relative to the agent's root
# (the parent of `data/`). Closed like every other catalog in this kit: the only
# key is the list, and `_comment` is how they all carry their reasoning.
PURCHASED_FILE = Path("policy") / "capabilities" / "purchased.json"
PURCHASED_KEYS = ("capabilities", "_comment")


def purchased_file(data: Path) -> Path:
    """Where this agent keeps what its client bought."""
    return Path(data).resolve().parent / PURCHASED_FILE


def purchased_capabilities(data: Path) -> list[str]:
    """The capability ids this client bought, in the order they were written.

    No file means nothing bought yet, which is a fresh client and not an error.
    Anything else about the file is: it decides what code reaches the agent, so
    a typo in it has to be a stop and not a shrug.
    """
    path = purchased_file(data)
    if not path.is_file():
        return []

    where = str(path)
    try:
        data_read = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise SystemExit(f"{where}: is not valid JSON: {exc}")
    if not isinstance(data_read, dict):
        raise SystemExit(f"{where}: must be a JSON object with a `capabilities` list")
    unknown = sorted(set(data_read) - set(PURCHASED_KEYS))
    if unknown:
        raise SystemExit(f"{where}: has keys this file does not define: {unknown}")
    bought = data_read.get("capabilities")
    if not isinstance(bought, list) or not all(isinstance(c, str) for c in bought):
        raise SystemExit(
            f"{where}: `capabilities` must be a list of capability ids from "
            "capabilities/catalog.json")

    rows = {row.get("id"): row for row in plugin_registry.capability_rows(KIT)}
    unsold = [cid for cid in bought if cid not in rows]
    if unsold:
        raise SystemExit(
            f"{where}: names {unsold}, which capabilities/catalog.json does not "
            "have. The catalog is closed: a client buys a row that exists.")
    # A `level: base` row is not bought, it is included -- the card says "ya
    # viene puesta: no hay que pedirla" and `base_capability_plugins()` puts its
    # plugins on EVERY agent. Listing one here reads as a purchase somebody
    # could revoke, and the day they took it out of this file the plugin would
    # stay exactly where it was.
    included = [cid for cid in bought if rows[cid].get("level") == plugin_registry.BASE]
    if included:
        raise SystemExit(
            f"{where}: names {included}, which capabilities/catalog.json ships as "
            f"`level: {plugin_registry.BASE}` — already on every agent, not sold. "
            "Only menu rows go in here.")
    return bought


def base_capability_plugins() -> dict[str, str]:
    """Plugin -> the base capability that makes it non-optional.

    READ STRAIGHT OFF `installs.plugins`, AND IT USED TO BE INFERRED. The old
    code took the base rows' `kit_skills`, resolved each name to whichever plugin
    shipped a skill by that name, and called that the reason. It gave the right
    answer only while every plugin's id equalled its skill's name -- and it made
    the catalog's own key a lie, since the thing being installed was the plugin.
    Now the catalog says `plugins` and this reads it; `plugin_registry`
    guarantees the ids are real (check_capability_installs, which every install
    reaches through this function).

    THE REASON PRINTED IS THE CAPABILITY, not a skill: `base capability
    (transcription)` is the row a client would point at.
    """
    plugin_registry.check_capability_installs(KIT)
    out: dict[str, str] = {}
    catalog = json.loads(CAPABILITIES.read_text(encoding="utf-8"))
    for entry in catalog["capabilities"]:
        if entry.get("level") != plugin_registry.BASE:
            continue
        for pid in (entry.get("installs") or {}).get("plugins") or []:
            out.setdefault(pid, entry["id"])
    return dict(sorted(out.items()))


def purchased_plugins(data: Path) -> dict[str, str]:
    """Plugin -> the capability this client bought that installs it."""
    installs = plugin_registry.capability_installs(KIT)
    out: dict[str, str] = {}
    for cid in purchased_capabilities(data):
        for pid in installs[cid].get("plugins") or []:
            out.setdefault(pid, cid)
    return dict(sorted(out.items()))


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
    for pid, capability in base_capability_plugins().items():
        add(pid, f"{BASE} ({capability})")
    for pid, capability in purchased_plugins(data).items():
        add(pid, f"{PURCHASED} ({capability})")

    for pid in sorted(reasons):
        for dependency in available[pid]["requires"].get("plugins") or []:
            if dependency not in reasons:
                raise SystemExit(
                    f"plugins/{pid}/plugin.json requires '{dependency}' and this "
                    f"agent's set does not have it ({', '.join(sorted(reasons))}). "
                    "A capability that installs a plugin installs its non-system "
                    "dependencies too — fix capabilities/catalog.json, not this set.")
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
    # SAID OUT LOUD, ONCE, AND ONLY BY THE COMMAND. A fresh client has bought
    # nothing and that is the whole of it; the library stays quiet so
    # agent-check does not print a note in the middle of its table.
    if not purchased_file(data).is_file():
        print(f"no {PURCHASED_FILE}: nothing bought yet, so this agent gets the "
              "system plugins and the base capabilities", file=sys.stderr)
    for pid, why in plugin_set(data).items():
        print(f"{pid}\t{', '.join(why)}" if args.why else pid)
    return 0


if __name__ == "__main__":
    sys.exit(main())
