#!/usr/bin/env python3
"""What a hired role's profile config carries, and what it deliberately does not.

    python3 -m unittest discover -s tools -p "test_*.py"

THE BUG THIS EXISTS FOR. A secondary Hermes profile reads its OWN config.yaml
over the engine's defaults and inherits nothing from `data/config.yaml` -- that
file belongs to the DEFAULT profile. Until this module every hired role
therefore ran the engine's product: another model, no kanban toolset, no gate
hooks, the curator loose over the only copy of its craft skills. Measured on the
local agent 2026-08-23 by resolving the engine's own loader under each home.

The projection is a copy, so most of what could break is silent: a top-level key
that stops travelling, a denied key that starts, a comment paragraph left
hanging over the wrong knob. All three are invisible in the output of a hire and
visible here.
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

KIT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(KIT / "tools"))
sys.path.insert(0, str(KIT / "roles"))

import profile_config  # noqa: E402

BASE_CONFIG = (KIT / "compose" / "config.base.yaml").read_text(encoding="utf-8")

# A config with one key of each kind: a block, a scalar, and three of the four
# that must stay behind. Written here rather than taken from the kit so the test
# still says what it means the day config.base.yaml changes shape.
SAMPLE = """# a header nobody's key owns
model:
  provider: openrouter
  default: openai/gpt-5.6-luna

# THE LISTENER. This paragraph belongs to the key below it.
api_server:
  enabled: true
  key: ${API_SERVER_KEY}

toolsets:
  - kanban

gateway:
  multiplex_profiles: true

hooks_auto_accept: true

plugins:
  enabled:
    - promises

platforms:
  telegram:
    enabled: true
"""


def parsed(text: str) -> dict:
    import yaml
    return yaml.safe_load(text) or {}


class WhatTravels(unittest.TestCase):
    def test_the_four_denied_keys_stay_behind(self):
        out = parsed(profile_config.project(SAMPLE, "marketing"))
        self.assertNotIn("api_server", out)
        self.assertNotIn("gateway", out)
        self.assertNotIn("plugins", out)
        # `platforms` comes back, but as the PIN and not as the agent's channels.
        self.assertEqual(out["platforms"], {"api_server": {"enabled": False}})

    def test_everything_else_travels_unchanged(self):
        agent, out = parsed(SAMPLE), parsed(profile_config.project(SAMPLE, "marketing"))
        for key in set(agent) - profile_config.NOT_PROJECTED:
            self.assertEqual(agent[key], out[key], f"{key} did not travel intact")
        self.assertEqual(set(out), (set(agent) - profile_config.NOT_PROJECTED) | {"platforms"})

    def test_a_denied_key_takes_its_own_paragraph_with_it(self):
        """Or the reason for a knob ends up standing over the next one.

        `# THE LISTENER.` explains `api_server`, which does not travel. Left
        behind it would sit above `toolsets`, saying the wrong thing about the
        knob that opens the kanban tools.
        """
        text = profile_config.project(SAMPLE, "marketing")
        self.assertNotIn("THE LISTENER", text)
        self.assertIn("- kanban", text)

    def test_env_references_travel_as_references(self):
        """`${VAR}` is expanded by the engine at load, per home. Never resolved here.

        The agent's config holds the reference and not the secret; a projection
        that expanded it would write the client's provider key into a second
        file, in a directory the agent itself can read.
        """
        text = profile_config.project(BASE_CONFIG, "accounting")
        self.assertIn("${OPENROUTER_API_KEY}", text)
        # The listener's key rode away with `api_server`. The pin's paragraph
        # still says the WORD -- it explains why silence is not enough -- so the
        # reference is what gets looked for, not the name.
        self.assertNotIn("${API_SERVER_KEY}", text)

    def test_the_real_config_projects_the_knobs_item_13_measured(self):
        """model, platform_hints, skills.disabled and skills.external_dirs.

        The four the local agent came up short on, crossed against the kit's own
        config rather than against a fixture: these are the ones a client pays
        for and the ones every per-role cost number was measured without.
        """
        agent, out = parsed(BASE_CONFIG), parsed(
            profile_config.project(BASE_CONFIG, "accounting"))
        self.assertEqual(out["model"]["default"], agent["model"]["default"])
        self.assertEqual(out["platform_hints"], agent["platform_hints"])
        self.assertEqual(out["skills"]["disabled"], agent["skills"]["disabled"])
        self.assertEqual(out["skills"]["external_dirs"], agent["skills"]["external_dirs"])
        # And the two keys that turn the kanban tools on, which need each other:
        # with only one the agent sees no kanban tool at all (notes/native-kanban.md).
        self.assertIn("kanban", out["toolsets"])
        self.assertIn("kanban", out["platform_toolsets"]["api_server"])

    def test_an_empty_config_is_a_refusal_and_not_an_empty_profile(self):
        with self.assertRaises(SystemExit):
            profile_config.project("# nothing but a comment\n", "marketing")


class ThePin(unittest.TestCase):
    """The one line that keeps the profile served survives the projection."""

    def test_api_server_is_pinned_off_after_projecting_a_config_that_had_it_on(self):
        out = parsed(profile_config.project(SAMPLE, "marketing"))
        self.assertIs(out["platforms"]["api_server"]["enabled"], False)

    def test_the_distribution_config_is_the_pin_alone(self):
        out = parsed(profile_config.distribution_config("marketing"))
        self.assertEqual(out, {"platforms": {"api_server": {"enabled": False}}})

    def test_both_writers_name_the_role_and_leave_no_placeholder(self):
        for text in (profile_config.distribution_config("sales"),
                     profile_config.project(SAMPLE, "sales")):
            self.assertIn("/p/sales/", text)
            self.assertNotIn("{role}", text)

    def test_build_role_writes_exactly_what_this_module_says(self):
        """One source for the pin, or the hire and the build ship two files."""
        import build_role
        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp)
            build_role.write_profile_config("support", dest)
            written = (dest / "config.yaml").read_text(encoding="utf-8")
        self.assertEqual(written, profile_config.distribution_config("support"))


class WhatTheCheckReads(unittest.TestCase):
    """`differing_keys` is what `agent-check.py` turns into a red line."""

    def test_a_profile_that_carries_the_projection_differs_on_nothing(self):
        text = profile_config.project(BASE_CONFIG, "accounting")
        self.assertEqual(profile_config.differing_keys(text, text), [])

    def test_a_profile_stuck_on_the_pin_alone_is_missing_every_knob(self):
        expected = profile_config.project(BASE_CONFIG, "accounting")
        drifted = profile_config.differing_keys(
            expected, profile_config.distribution_config("accounting"))
        for knob in ("model", "toolsets", "platform_hints", "skills", "hooks"):
            self.assertIn(knob, drifted)

    def test_it_names_the_knob_that_changed_and_only_that_one(self):
        expected = profile_config.project(BASE_CONFIG, "accounting")
        stale = expected.replace("default: openai/gpt-5.6-luna",
                                 "default: z-ai/glm-5.2")
        self.assertEqual(profile_config.differing_keys(expected, stale), ["model"])


class TheCommandLine(unittest.TestCase):
    """`tools/hire-role.sh` calls this as a command, not as a module."""

    def run_it(self, *args):
        return subprocess.run(
            [sys.executable, str(KIT / "tools" / "profile_config.py"), *args],
            capture_output=True, text=True)

    def test_projecting_a_file_prints_the_config(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "config.yaml"
            path.write_text(SAMPLE, encoding="utf-8")
            done = self.run_it("marketing", "--agent-config", str(path))
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertEqual(done.stdout, profile_config.project(SAMPLE, "marketing"))

    def test_the_distribution_flag_prints_the_pin(self):
        done = self.run_it("marketing", "--distribution")
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertEqual(done.stdout, profile_config.distribution_config("marketing"))

    def test_a_missing_source_is_an_error_and_not_an_empty_config(self):
        done = self.run_it("marketing")
        self.assertNotEqual(done.returncode, 0)


class EveryRoleTheKitSells(unittest.TestCase):
    """The projection is role-agnostic, and the roster is where the ids are."""

    def test_each_role_gets_a_config_naming_itself(self):
        catalog = json.loads(
            (KIT / "roles" / "catalog.json").read_text(encoding="utf-8"))
        for role in catalog["roles"]:
            text = profile_config.project(BASE_CONFIG, role["id"])
            self.assertIn(f"/p/{role['id']}/", text)
            self.assertIs(parsed(text)["platforms"]["api_server"]["enabled"], False)


if __name__ == "__main__":
    unittest.main()
