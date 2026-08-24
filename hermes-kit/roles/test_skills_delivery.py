#!/usr/bin/env python3
"""One skill, one home: what a role's distribution carries and what it does not.

    python3 roles/test_skills_delivery.py

THE BUG THIS EXISTS FOR. `approval`, `capability`, `deliverable` and `flow` are
the SHARED set -- every role on offer declares them -- so `install.sh` leaves
them in `<agent>/kit-skills/`, mounted read only at `/opt/kit/skills` for the
whole installation. `roles/build_role.py` ALSO copied them into every profile's
own `skills/`, so each of the four was on a team agent twice.

That was invisible for as long as a secondary profile declared no
`skills.external_dirs`: it could not see the kit's copy, so it resolved its own
and nobody was any the wiser. ae377d5 projected the agent's knobs into each
profile -- `external_dirs: [/opt/kit/skills]` among them, and correctly, because
without it a teammate cannot read the kit at all. Both copies became visible at
once and the engine stopped resolving any of the four:

    Ambiguous skill name 'deliverable/SKILL.md': 2 skills match across your
    local skills dir and external_dirs. Refusing to guess.

Thirteen refusals in one day's `errors.log` on the local agent (2026-08-24), and
the roles flail around them: one marketing turn burned 42 tool calls and
US$0.0485 -- half the tool spend of the whole measurement wave -- and never
produced the approval it had been asked for.

The engine-side guard is `tools/agent-check.py` («roles: one skill, one home»),
which fails over an INSTALLED agent. This is the build-side half: the
distribution is where the second copy was born.
"""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

KIT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(KIT / "roles"))
sys.path.insert(0, str(KIT / "tools"))

import build_role  # noqa: E402
import skills_split  # noqa: E402

ROLES = sorted(
    d.name for d in (KIT / "roles").iterdir() if (d / "role.json").is_file()
)


def built(role: str, root: Path) -> Path:
    """The role's distribution, built for real. Cached per root by build()."""
    return build_role.build(role, root)


class TheSharedSetNeverTravels(unittest.TestCase):
    """The rule, over the real roles rather than a fixture.

    Building five roles composes five SOULs and runs the clone check five
    times, so it happens once for the whole class.
    """

    @classmethod
    def setUpClass(cls):
        cls._tmp = tempfile.TemporaryDirectory()
        cls.root = Path(cls._tmp.name)
        cls.dists = {role: built(role, cls.root) for role in ROLES}
        cls.shared = set(skills_split.shared_skills())

    @classmethod
    def tearDownClass(cls):
        cls._tmp.cleanup()

    def packed(self, role: str) -> set:
        return {d.name for d in (self.dists[role] / "skills").iterdir() if d.is_dir()}

    def test_no_role_ships_a_shared_skill_inside_its_profile(self):
        """The collision, asked as a question about the distribution."""
        for role in ROLES:
            with self.subTest(role=role):
                self.assertEqual(
                    sorted(self.packed(role) & self.shared), [],
                    "kit-skills/ already has it: two homes is the ambiguity")

    def test_every_craft_skill_the_role_declares_does_ship(self):
        """The other half. kit-skills/ on a team agent holds ONLY the shared
        ones, so a craft skill left out of the profile reaches nobody."""
        for role in ROLES:
            with self.subTest(role=role):
                cfg = json.loads(
                    (KIT / "roles" / role / "role.json").read_text(encoding="utf-8"))
                declared = set(build_role.skill_sources(cfg, role))
                self.assertEqual(self.packed(role), declared - self.shared)

    def test_a_role_whose_skills_are_all_shared_still_ships_the_directory(self):
        """Empty is a valid payload, and the empty directory is load-bearing.

        `skills/` is `distribution_owned` and the engine's updater rmtree's a
        distribution-owned directory before copying it
        (hermes:hermes_cli/profile_distribution.py:576-579). Shipping it empty
        is what REMOVES the four stale copies from an agent hired before the
        fix; omitting it would leave them exactly where they are.
        """
        empty = [r for r in ROLES if not self.packed(r)]
        self.assertTrue(empty, "no role is all-shared any more: pick another case")
        for role in empty:
            with self.subTest(role=role):
                self.assertTrue((self.dists[role] / "skills").is_dir())

    def test_role_json_still_lists_every_skill_the_role_works_with(self):
        """The manifest describes the ROLE; the directory describes the payload.

        They stopped being the same list here, and on purpose: a marketing
        role.json that no longer mentioned `deliverable` would say the role
        cannot leave a file, which is false -- the file it reads is the kit's.
        """
        for role in ROLES:
            with self.subTest(role=role):
                manifest = json.loads(
                    (self.dists[role] / "role.json").read_text(encoding="utf-8"))
                cfg = json.loads(
                    (KIT / "roles" / role / "role.json").read_text(encoding="utf-8"))
                self.assertEqual(manifest["skills"],
                                 sorted(build_role.skill_sources(cfg, role)))
                self.assertTrue(set(manifest["skills"]) & self.shared,
                                "every role declares the plumbing")

    def test_a_packed_skill_that_cites_a_shared_one_keeps_the_kit_path(self):
        """`quotes` tells the agent to read /opt/kit/skills/deliverable/.

        That path is now the ONLY copy of `deliverable`, so the rewrite has to
        leave it alone. Rewriting it into the profile would name a directory
        this fix just emptied.
        """
        text = (self.dists["sales"] / "skills" / "quotes" / "SKILL.md").read_text(
            encoding="utf-8")
        self.assertIn("/opt/kit/skills/deliverable/", text)
        self.assertNotIn("/opt/data/profiles/sales/skills/deliverable/", text)

    def test_a_packed_skill_that_cites_another_packed_one_gets_rewritten(self):
        """`brand-kit` cites `artifact`, and both travel inside marketing."""
        text = (self.dists["marketing"] / "skills" / "brand-kit" / "SKILL.md").read_text(
            encoding="utf-8")
        self.assertIn("/opt/data/profiles/marketing/skills/artifact/", text)


class ThePackedSet(unittest.TestCase):
    """`packed_skills` on its own, with no build around it."""

    def test_it_drops_exactly_the_shared_names(self):
        shared = sorted(skills_split.shared_skills())
        self.assertTrue(shared, "the split says nothing is shared")
        sources = {name: Path("/nowhere") / name for name in shared}
        sources["brand-kit"] = Path("/nowhere/brand-kit")
        self.assertEqual(sorted(build_role.packed_skills(sources)), ["brand-kit"])

    def test_the_four_that_caused_the_outage_are_shared(self):
        """If one of them ever stops being shared it starts travelling again,
        and that has to be a decision somebody makes, not a diff nobody reads."""
        for name in ("approval", "capability", "deliverable", "flow"):
            self.assertIn(name, skills_split.shared_skills())


if __name__ == "__main__":
    unittest.main()
