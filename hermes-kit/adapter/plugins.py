"""The kit plugins this agent booted with: read `/opt/plugins`, or refuse.

`/opt/plugins/<id>/` is a whole plugin folder copied in from the kit's registry
(`hermes-kit/plugins/<id>/`), manifest and all. This module is the BOOT-TIME
half of "fail loud twice" (notes/plugin-system-plan.md): the build-time half is
`tools/check-plugins.py` reading the repo, and this one runs the very same
validator over what actually landed on the agent.

ONE VALIDATOR, NEVER TWO. `tools/plugin_registry.py` is imported, not copied. A
second implementation of "is this manifest good" is a second answer, and the two
would disagree the first time anybody adds a rule -- which is the failure this
whole design exists to prevent, only moved from the manifest to the checker.
`install.sh` ships that file next to this one inside the container; in the repo
it is still `tools/plugin_registry.py` and the import below finds it there.

ONE VALIDATOR, AND ONE RULE THAT READS DIFFERENTLY UNDER THIS ROOT. Everything
it says about a MANIFEST means the same thing here as in the repo. The one
exception is the duplicate-skill-source check, which seeds itself from
`<root>/skills/`: `hermes-kit/skills/` in the repo, `/opt/skills` here -- and an
agent's kit skills are at `/opt/kit/skills/`, one level down. At boot that check
therefore refuses two PLUGINS claiming one skill name and never a plugin
colliding with a kit skill. The build refuses that one, over the repo, where
both halves are real; `_check_skill_slots` carries the reason the gap is phase
3b's call and not a line to close quietly from this side.

WHY A BROKEN SET IS NOT A DEGRADED BOOT. A plugin's surfaces are load-bearing: a
skill a role's SOUL promises, a tab the portal draws, an endpoint that tab calls.
An adapter that came up with four plugins out of five would serve a portal that
offers the fifth and 404s on it, and the client reads that as the product being
broken, not the install. Exiting nonzero puts it in the container's restart loop
and in the operator's face instead, which is where it belongs.
"""

import os
import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent
if not (_HERE / "plugin_registry.py").is_file():
    # Repo layout: the validator lives in the kit's tools/. Inside a container
    # install.sh puts a copy next to us, and this line never runs.
    sys.path.insert(0, str(_HERE.parent / "tools"))
import plugin_registry

# The directory that CONTAINS `plugins/` -- `/opt` on an agent, so the registry
# is `/opt/plugins/<id>/`. It is the same shape the kit has in the repo (root
# `hermes-kit/`, registry `hermes-kit/plugins/`), which is why the one validator
# reads both with no argument about layout.
#
# IT IS SETTABLE FOR EXACTLY ONE REASON: the test suite boots a real adapter
# against a fixture registry and asserts the process leaves nonzero. A refusal
# that is mocked is not a refusal.
ROOT = Path(os.environ.get("PLUGINS_ROOT", "/opt"))


def load(root: Path = ROOT) -> dict:
    """Every plugin installed on this agent, validated, keyed by id.

    NO `plugins/` IS NOT AN ERROR, IT IS THE NORMAL STATE. Every agent alive
    today was installed before the folder started shipping and stays that way
    until the layout flip lands (phase 3b). An empty set plus a line naming the
    state is the honest answer; refusing to boot on it would take every live
    client down to announce a feature none of them have yet.
    """
    directory = root / "plugins"
    if not directory.is_dir():
        print(f"plugins: pre-plugin layout, no {directory}", file=sys.stderr)
        return {}
    try:
        loaded = plugin_registry.registry(root)
    except SystemExit as broken:
        # `registry()` already names the offending manifest and the rule it
        # broke; what it cannot know is that its caller is a service coming up.
        # Re-raised, never swallowed -- the process still leaves nonzero. This
        # only adds the sentence an operator staring at a crash loop needs.
        raise SystemExit(f"plugins: refusing to boot -- {broken}") from None
    print(f"plugins: {len(loaded)} loaded from {directory} "
          f"({', '.join(sorted(loaded))})", file=sys.stderr)
    return loaded


def summary(loaded: dict) -> list:
    """What `/portal/plugins` publishes, sorted by id.

    THE MANIFEST MINUS WHAT IS NOBODY'S BUSINESS BUT OURS. `_dir` is a path on
    the agent's filesystem and `_comment` is a note we left ourselves; neither
    means anything to a browser. `client_copy` is not here either: this endpoint
    is the REGISTRY -- what is installed -- and the words a client reads about
    what they bought come from the capabilities catalog, which is the commercial
    face of the same thing (notes/plugin-system-plan.md).
    """
    out = []
    for pid in sorted(loaded):
        data = loaded[pid]
        surfaces = data["surfaces"]
        out.append({
            "id": pid,
            "version": data["version"],
            "description": data["description"],
            "system": data["system"],
            # Normalized to all three lists. A manifest may leave a sub-list
            # out, and a consumer that has to ask whether the key is there
            # before reading it is a consumer that forgets once.
            "requires": {key: list(data["requires"].get(key, []))
                         for key in plugin_registry.REQUIRES_KEYS},
            "surfaces": {
                # WHICH surfaces the plugin has, not what is inside them: those
                # values are paths into the agent's filesystem and mean nothing
                # off it. Canonical order, taken from the validator.
                "present": [key for key in plugin_registry.SURFACE_KEYS
                            if surfaces.get(key)],
                # The one exception, because the tab's CONTENT is the portal's:
                # `label` is the word to draw, `builtin` the page that already
                # exists. Verbatim, so the portal reads the shape
                # plugins/README.md documents and not a translation of it.
                "tab": surfaces.get("tab"),
            },
        })
    return out
