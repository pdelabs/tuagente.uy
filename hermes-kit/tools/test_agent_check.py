#!/usr/bin/env python3
"""Tests for agent-check.py's «roles: one skill, one home» guard.

    python3 -m unittest test_agent_check.py

THE BUG THE GUARD EXISTS FOR. A skill name that resolves BOTH inside a hired
role's profile and through its `skills.external_dirs` makes the engine refuse
the skill outright -- "Ambiguous skill name 'deliverable/SKILL.md': 2 skills
match across your local skills dir and external_dirs. Refusing to guess"
(hermes:tools/skills_tool.py:1180-1204). It shipped because `build_role.py`
packed the four shared plumbing skills into every profile as well as leaving
them in kit-skills/, which was invisible until ae377d5 gave each profile the
`external_dirs` knob and put both copies in scope at once. Thirteen refusals in
one day on the local agent, and the roles flail: 42 tool calls on the worst
turn, no approval filed.

`roles/test_skills_delivery.py` is the build-side half -- a distribution can no
longer carry a shared skill. This is the agent-side half: it catches an agent
hired before the fix, or a copy somebody put there by hand, which is a state no
rebuild can rule out.

The check is exercised through its module-level function rather than by running
the script: the rest of agent-check needs a whole conforming agent to say
anything, and the tree this needs is four files.
"""
import importlib.util
import unittest
import tempfile
from pathlib import Path

TOOLS = Path(__file__).resolve().parent


def load():
    """agent-check.py, whose name is not an identifier."""
    spec = importlib.util.spec_from_file_location(
        "agent_check", TOOLS / "agent-check.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


agent_check = load()

# What `tools/profile_config.py` projects into every hired role, and the reason
# the two copies can see each other at all.
EXTERNAL_DIRS = """skills:
  disabled:
    - arxiv
  external_dirs:
    - /opt/kit/skills
"""


def skill(root: Path, rel: str, name: str = None):
    path = root / rel / "SKILL.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(f"---\nname: {name or path.parent.name}\n"
                    "description: something\n---\n\nBody.\n", encoding="utf-8")
    return path


class OneSkillOneHome(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.agent = Path(self._tmp.name)
        self.data = self.agent / "data"
        skill(self.agent, "kit-skills/deliverable")
        skill(self.agent, "kit-skills/approval")
        (self.data / "profiles" / "marketing").mkdir(parents=True)
        self.config = self.data / "profiles" / "marketing" / "config.yaml"
        self.config.write_text(EXTERNAL_DIRS, encoding="utf-8")

    def tearDown(self):
        self._tmp.cleanup()

    def collisions(self):
        return agent_check.profile_skill_collisions(str(self.data))

    def test_a_craft_skill_inside_the_profile_is_not_a_collision(self):
        """The normal case, and the one the fix leaves standing: brand-kit is
        NOT in kit-skills/ on a team agent, so the profile is its only home."""
        skill(self.data, "profiles/marketing/skills/brand-kit")
        self.assertEqual(self.collisions(), [])

    def test_a_shared_skill_copied_into_the_profile_is_reported_with_both_paths(self):
        skill(self.data, "profiles/marketing/skills/deliverable")
        found = self.collisions()
        self.assertEqual(len(found), 1)
        role, name, local, external = found[0]
        self.assertEqual((role, name), ("marketing", "deliverable"))
        self.assertEqual(local, "data/profiles/marketing/skills/deliverable/SKILL.md")
        self.assertEqual(external, "kit-skills/deliverable/SKILL.md")

    def test_every_doubled_name_is_reported_and_not_just_the_first(self):
        skill(self.data, "profiles/marketing/skills/deliverable")
        skill(self.data, "profiles/marketing/skills/approval")
        skill(self.data, "profiles/marketing/skills/brand-kit")
        self.assertEqual([name for _, name, _, _ in self.collisions()],
                         ["approval", "deliverable"])

    def test_a_copy_filed_under_a_category_collides_all_the_same(self):
        """The engine walks the tree, so a nested copy is indexed and doubles
        the name exactly like one sitting at the top."""
        skill(self.data, "profiles/marketing/skills/productivity/deliverable")
        self.assertEqual([name for _, name, _, _ in self.collisions()], ["deliverable"])

    def test_a_profile_that_does_not_declare_external_dirs_is_skipped(self):
        """Without the knob the kit's copy is not in scope, so there is nothing
        to be ambiguous about -- and that profile is already red in «roles:
        profiles inherit the agent's knobs», which is where a missing knob is
        said. Reporting it here would be a second red line for another bug.
        """
        self.config.write_text("model: openai/gpt-5.6-luna\n", encoding="utf-8")
        skill(self.data, "profiles/marketing/skills/deliverable")
        self.assertEqual(self.collisions(), [])

    def test_a_profile_with_no_config_at_all_is_skipped(self):
        self.config.unlink()
        skill(self.data, "profiles/marketing/skills/deliverable")
        self.assertEqual(self.collisions(), [])

    def test_every_installed_profile_is_looked_at(self):
        (self.data / "profiles" / "accounting").mkdir()
        (self.data / "profiles" / "accounting" / "config.yaml").write_text(
            EXTERNAL_DIRS, encoding="utf-8")
        skill(self.data, "profiles/marketing/skills/deliverable")
        skill(self.data, "profiles/accounting/skills/deliverable")
        self.assertEqual([role for role, _, _, _ in self.collisions()],
                         ["accounting", "marketing"])

    def test_an_agent_with_no_kit_skills_directory_says_nothing(self):
        """A pre-external_dirs agent has no kit-skills/ at all. Its own check
        says so; this one has no second home to compare against."""
        for entry in (self.agent / "kit-skills").rglob("*"):
            if entry.is_file():
                entry.unlink()
        for entry in sorted((self.agent / "kit-skills").rglob("*"), reverse=True):
            entry.rmdir()
        (self.agent / "kit-skills").rmdir()
        skill(self.data, "profiles/marketing/skills/deliverable")
        self.assertEqual(self.collisions(), [])

    def test_a_solo_agent_has_no_profiles_and_is_not_a_false_positive(self):
        """Every skill in kit-skills/ and no roster: the default profile's own
        shadowing is «kit skills mounted outside data/», not this."""
        import shutil
        shutil.rmtree(self.data / "profiles")
        skill(self.data, "skills/deliverable")
        self.assertEqual(self.collisions(), [])


if __name__ == "__main__":
    unittest.main()
