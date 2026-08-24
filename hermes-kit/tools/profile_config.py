#!/usr/bin/env python3
"""The config.yaml a role's profile carries, and where its knobs come from.

    python3 tools/profile_config.py <role> --agent-config <agent>/data/config.yaml
    python3 tools/profile_config.py <role> --distribution

The first prints what a HIRED role's profile must hold on THIS agent; the
second, what a distribution ships when there is no agent in sight. Both are
written to stdout, and `tools/hire-role.sh` is what puts the first one into the
build before `hermes profile install`.

WHY A PROJECTION AND NOT INHERITANCE. There is no inheritance to lean on: the
engine loads `HERMES_HOME/config.yaml` over its OWN defaults and merges nothing
from the parent home (`hermes:hermes_cli/config.py:3263-3330`), and a secondary
profile's home is `data/profiles/<role>/`. `data/config.yaml` is therefore the
DEFAULT profile's config, not the agent's, and a role that says nothing runs the
engine's product instead of ours. Measured on the local agent (2026-08-23) by
resolving the engine's own loader under each home, side by side:

    default profile              a hired role
    model    gpt-5.6-luna        model    None -> the engine's default, and the
                                          live turn ran on z-ai/glm-5.2
    api_server toolsets: the     the same list WITHOUT kanban and WITH browser,
    twelve, kanban included      cronjob and delegation -- the teammate cannot
                                          touch the board and gets back the
                                          three doors the kit closes
    hooks    3 pre_tool_call     hooks    0 -> the gate is not there: installing
                                          software, signing as `portal`,
                                          unblocking its own ticket
    curator  off                 curator  on -> over `profiles/<role>/skills/`,
                                          which is the ONLY copy of that role's
                                          craft
    platform_hints api_server    (none) -> the engine's "assume plain text, no
                                          markdown" preamble, the one the kit
                                          replaces on purpose
    skills.disabled 66           0    -> all 70 engine skills in the index
    skills.external_dirs         (none) -> /opt/kit/skills unread
    display.file_mutation_verifier off   on -> the engine staples a host path
                                          onto the client's answer
    plugins  enabled: [promises]  (none) -> `promises`, the guard that stops it
                                          announcing a flow it never created,
                                          and its plugins/ dir was missing too
                                          (measured 2026-08-24)

THE DISTRIBUTION CANNOT DECIDE THIS. It is generic and the model is the
client's, so the copy happens where the agent's own config is at hand: the hire.
`tools/hire-role.sh` reads `/opt/data/config.yaml` out of the container and
rewrites the built distribution's `config.yaml` with the result, on a first hire
and on `--update` alike. `roles/build_role.py` keeps writing the pin alone,
because a distribution sitting in `dist/` belongs to no agent.

A DENYLIST, NOT AN ALLOWLIST, and that is the decision this file rests on. The
knobs are the AGENT's -- every one of them was written into
`compose/config.base.yaml` as how this product behaves, not as how the default
profile behaves -- so the default is that they travel, and each exception is
named below with the reason it cannot. An allowlist would have to be extended by
whoever adds the next knob, and a list somebody has to remember to extend is how
`toolsets: [kanban]` would quietly stop reaching a teammate.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

# WHAT DOES NOT TRAVEL. Three top-level keys, each measured, and nothing else.
NOT_PROJECTED = {
    # The single HTTP listener belongs to the default profile. Copying this
    # block is exactly the port-binding config error 032b271 fixed: under
    # `gateway.multiplex_profiles` the gateway starts NO adapters for a
    # secondary profile that declares one, and the pin at the bottom of this
    # file is the opposite of this key.
    "api_server",
    # The channels are the agent's one set. A second Telegram adapter on the
    # same bot token is two pollers on one chat, and `platforms` is also where
    # port-binding platforms are declared -- which is why the pin lives there.
    "platforms",
    # `multiplex_profiles` is read once, from the profile the gateway boots
    # under. A secondary profile repeating it changes nothing and invites the
    # next reader to believe it does.
    "gateway",
}

# `plugins` WAS THE FOURTH EXCEPTION AND IS NOT ONE ANY MORE. The reason it was
# withheld was true and has been fixed underneath it: `plugins.enabled` only
# means something next to `HERMES_HOME/plugins`, the engine's user-plugin
# directory (`hermes:hermes_cli/plugins.py:1369`), and a role's home had none --
# the compose mounts the guard over `/opt/data/plugins`, the DEFAULT profile's
# home. Projecting the list would have claimed a plugin the profile could not
# see: installed, off, and the config saying it was on, which is the exact shape
# of failure that guard exists to catch.
#
# `tools/hire-role.sh` now links `profiles/<role>/plugins` -> `../../plugins` on
# every hire and every --update, so the role's home resolves the agent's own
# plugin set. Measured in the container 2026-08-24, one step at a time: with no
# link the role's home discovers 54 plugins and `promises` is not among them;
# with the link it discovers the same 55 as the default profile but `promises`
# comes back `enabled: False`, because user plugins are opt-in and this key was
# staying behind. It takes BOTH, which is why they land together.

# A key at column zero. YAML block style is all `compose/config.base.yaml`
# writes, and it is what `agent-check.py` scans by hand for the same reason:
# PyYAML is optional in this kit and a comment-losing round trip would throw
# away the reasons every knob carries.
TOP_LEVEL = re.compile(r"^([A-Za-z_][A-Za-z0-9_.-]*):")

PROJECTION_HEADER = """# Generated by tools/profile_config.py -- do not edit by hand.
#
# THE {role} PROFILE'S CONFIG: THE AGENT'S OWN, PROJECTED IN. The engine loads
# HERMES_HOME/config.yaml over its defaults and merges nothing from the parent
# home, so data/config.yaml is the DEFAULT profile's config and this file is
# everything this role knows. A role whose config said only the pin below ran
# the engine's product: another model, no kanban tools, no gate hooks, the
# curator loose over the only copy of its craft skills.
#
# THREE KEYS DO NOT TRAVEL, each for a reason that is in
# tools/profile_config.py: api_server and platforms (the listener and the
# channels are the default profile's -- and the pin below is what keeps this
# profile served) and gateway (multiplex_profiles is read once, at boot).
# `plugins` DOES travel, and only works because this home's plugins/ is a link
# to the agent's: the two are one change and heal with the same command.
#
# Refresh it with `tools/hire-role.sh {role} <agent> --update`, which is also
# what heals a role hired before the projection existed. `tools/agent-check.py`
# fails, naming the knob, when this file and the agent's config drift apart.
"""

PIN_SECTION = """# THE ONE LINE THIS FILE HAD BEFORE, AND IT IS STILL LOAD-BEARING.
#
# THE SHARED LISTENER IS THE DEFAULT PROFILE'S. Under gateway.multiplex_profiles
# every role is served through /p/{role}/ on the one HTTP port the default
# profile binds. This profile must NOT declare a port-binding platform of its
# own (api_server, webhook, sms, ...), and saying nothing is not enough: the
# container's API_SERVER_KEY would turn api_server on from the environment and
# the gateway would refuse to start this profile's adapters.
platforms:
  api_server:
    enabled: false
"""

# What `roles/build_role.py` writes into a distribution: the pin and nothing
# else. Kept verbatim -- a distribution belongs to no agent, so there is nothing
# to project into it, and its bytes are what every dist comparison is measured
# against.
DISTRIBUTION_HEADER = """# Generated by roles/build_role.py -- do not edit by hand.
# The {role} profile's own config. One pin, and it is load-bearing.
#
# THE SHARED LISTENER IS THE DEFAULT PROFILE'S. Under gateway.multiplex_profiles
# every role is served through /p/{role}/ on the one HTTP port the default
# profile binds. This profile must NOT declare a port-binding platform of its
# own (api_server, webhook, sms, ...), and saying nothing is not enough: the
# container's API_SERVER_KEY would turn api_server on from the environment and
# the gateway would refuse to start this profile's adapters.
platforms:
  api_server:
    enabled: false
"""


def distribution_config(role: str) -> str:
    """The config.yaml a distribution ships: the pin, with no agent in sight."""
    return DISTRIBUTION_HEADER.format(role=role)


def chunks(text: str) -> list[tuple[str, str]]:
    """The YAML split into (top-level key, its text), in file order.

    A key OWNS the run of comment lines directly above it. That is not a
    formatting preference: in `compose/config.base.yaml` every knob's reason is
    written immediately above the key it explains, and a projection that dropped
    a key while keeping its paragraph would leave the reason hanging over the
    next one. Whatever sits before the first key -- a file header -- comes back
    under the empty key '' and is never projected.
    """
    lines = text.splitlines(keepends=True)
    starts: list[tuple[int, str]] = []
    for i, line in enumerate(lines):
        match = TOP_LEVEL.match(line)
        if not match:
            continue
        first = i
        while first and (lines[first - 1].lstrip().startswith("#")):
            first -= 1
        starts.append((first, match.group(1)))

    out: list[tuple[str, str]] = []
    if not starts:
        return [("", text)] if text else []
    if starts[0][0] > 0:
        out.append(("", "".join(lines[: starts[0][0]])))
    for index, (first, key) in enumerate(starts):
        end = starts[index + 1][0] if index + 1 < len(starts) else len(lines)
        out.append((key, "".join(lines[first:end])))
    return out


def project(agent_config: str, role: str) -> str:
    """The agent's config as this role's profile must carry it.

    Everything the agent declares, minus `NOT_PROJECTED`, plus the pin. The
    text travels as written, `${VAR}` references included: the engine expands
    those against the container's environment on every load, which is the same
    environment in both homes, so no secret is copied to disk that was not
    already there.
    """
    kept = [body for key, body in chunks(agent_config)
            if key and key not in NOT_PROJECTED]
    if not kept:
        raise SystemExit(
            "the agent's config.yaml declares no top-level key this profile can "
            "inherit -- is it the right file?")
    body = "".join(kept).rstrip("\n")
    return PROJECTION_HEADER.format(role=role) + "\n" + body + "\n\n" + \
        PIN_SECTION.format(role=role)


def differing_keys(expected: str, actual: str) -> list[str]:
    """Which top-level keys the two configs do not agree on, by name.

    Byte comparison per key, and that is the honest question: the projection is
    a copy, so anything but equality means the profile is running something
    else. Naming the KEY is what turns "the config drifted" into "this role is
    on another model".
    """
    left = dict(chunks(expected))
    right = dict(chunks(actual))
    return sorted(key for key in set(left) | set(right)
                  if key and left.get(key) != right.get(key))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("role", help="role id, e.g. marketing")
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--agent-config", metavar="FILE",
                        help="the agent's data/config.yaml, to project from")
    source.add_argument("--distribution", action="store_true",
                        help="what a distribution ships: the pin alone")
    args = parser.parse_args()

    if args.distribution:
        sys.stdout.write(distribution_config(args.role))
        return 0
    sys.stdout.write(project(
        Path(args.agent_config).read_text(encoding="utf-8"), args.role))
    return 0


if __name__ == "__main__":
    sys.exit(main())
