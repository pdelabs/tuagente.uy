"""One skill, one home — asked of an agent install.sh really built.

    python3 -m unittest discover -s hermes-kit/tools -p "test_*.py"

THE BUG THIS EXISTS FOR. A skill that ships inside a plugin is on the agent
TWICE on purpose: `plugins/<id>/skills/<name>/` is the registry — what says the
plugin is installed — and `kit-skills/<name>/` is the delivery, which is what
the ENGINE indexes (`skills.external_dirs`). A third copy, or two sources
flattening into one name, is not a merge: the engine refuses to resolve it.

    Ambiguous skill name 'deliverable/SKILL.md': 2 skills match across your
    local skills dir and external_dirs. Refusing to guess.

Thirteen refusals in one day's `errors.log` on the local agent (2026-08-24),
and the agent flails around them: one turn burned 42 tool calls and US$0.0485
and never produced the approval it had been asked for. The second copy was born
in `roles/build_role.py`, which packed a role's craft skills into its profile
while install.sh had already left them in kit-skills/ — that whole shape is
gone, and the rule it broke is not, because `install.sh` still writes two
copies of every plugin skill and they have to be the same two.

THIS RUNS THE INSTALLER, over a throwaway agent, which is the only way to ask
the question that used to be asked of a distribution. The engine-side half is
`tools/agent-check.py` («plugins: skills delivered from the registry»), which
fails over an agent that is already installed.
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

TOOLS = Path(__file__).resolve().parent
KIT = TOOLS.parent
sys.path.insert(0, str(TOOLS))

import plugin_registry  # noqa: E402
import plugin_set  # noqa: E402
import skill_sources  # noqa: E402

# A client who bought the two menu rows that install one plugin each, which is
# the smallest purchase that changes the answer: `quotes` is sales work,
# `invoices-to-data` is accounting's, and neither is on an agent without them.
BOUGHT = ["quotes", "invoices-to-data"]


def install(bought=()):
    """A throwaway agent, built by install.sh. Returns its root."""
    root = Path(tempfile.mkdtemp(prefix="agent-"))
    (root / "data").mkdir()
    if bought:
        purchased = root / plugin_set.PURCHASED_FILE
        purchased.parent.mkdir(parents=True)
        purchased.write_text(
            json.dumps({"capabilities": list(bought)}, ensure_ascii=False),
            encoding="utf-8")
    done = subprocess.run([str(KIT / "install.sh"), str(root / "data")],
                          capture_output=True, text=True, timeout=300)
    if done.returncode != 0:
        raise AssertionError(done.stdout + done.stderr)
    return root


class WhatTheAgentGets(unittest.TestCase):
    """Two agents, installed once for the whole class: a fresh one and a buyer."""

    @classmethod
    def setUpClass(cls):
        cls.fresh = install()
        cls.buyer = install(BOUGHT)

    def delivered(self, root):
        directory = root / "kit-skills"
        return {d.name for d in directory.iterdir() if (d / "SKILL.md").is_file()}

    def test_every_skill_in_the_kit_is_delivered_and_the_index_is_the_clients(self):
        """One agent per client, one index, and it holds the whole kit.

        There was a second answer for the length of the team pivot: with a
        roster, kit-skills/ got only the skills EVERY role declared, because the
        mount is for the whole installation and a teammate paid prompt for the
        other teammates' craft. There are no teammates.
        """
        self.assertEqual(self.delivered(self.fresh), set(skill_sources.skill_dirs()))
        self.assertEqual(self.delivered(self.buyer), set(skill_sources.skill_dirs()))

    def test_a_skill_is_on_the_agent_exactly_once_per_home(self):
        """No name is delivered twice, and nothing lands in data/skills/.

        `data/skills/<name>/` is the copy the engine resolves FIRST -- a stale
        one there wins over the kit's and the install has no effect at all, with
        not a single error.
        """
        for root in (self.fresh, self.buyer):
            with self.subTest(agent=root.name):
                delivered = sorted(d.name for d in (root / "kit-skills").iterdir())
                self.assertEqual(delivered, sorted(set(delivered)))
                inside = [d for d in (root / "data" / "skills").iterdir()
                          if (d / "SKILL.md").is_file()]
                self.assertEqual(inside, [])

    def test_a_plugins_delivered_skill_is_the_registrys_byte_for_byte(self):
        """The delivered copy is the one that RUNS. A stale one is old code."""
        for root in (self.fresh, self.buyer):
            for pid in sorted(d.name for d in (root / "plugins").iterdir()):
                manifest = json.loads(
                    (root / "plugins" / pid / "plugin.json").read_text(encoding="utf-8"))
                for name in manifest["surfaces"].get("skills") or []:
                    source = root / "plugins" / pid / "skills" / name
                    for path in sorted(source.rglob("*")):
                        if not path.is_file() or path.suffix not in (".md", ".py"):
                            continue
                        if "evals" in path.relative_to(source).parts:
                            continue
                        with self.subTest(agent=root.name, skill=f"{name}/{path.name}"):
                            there = root / "kit-skills" / name / path.relative_to(source)
                            self.assertTrue(there.is_file(), there)
                            self.assertEqual(there.read_bytes(), path.read_bytes())

    def test_what_a_base_capability_promises_is_really_delivered(self):
        """"Ya viene puesta: no hay que pedirla" is a claim about every agent.

        The checkable half of the card. A base row that installed something
        nobody ships would put a promise in front of the client with nothing
        behind it -- which is exactly what happened once, when the rule lived
        somewhere only a team agent ever reached.
        """
        promised = skill_sources.base_capability_skills()
        self.assertIn("transcribe", promised)
        self.assertLessEqual(promised, self.delivered(self.fresh))

    def test_the_manifest_says_what_was_delivered(self):
        """`data/skills/.kit_manifest` is how the portal tells ours from theirs."""
        for root in (self.fresh, self.buyer):
            with self.subTest(agent=root.name):
                listed = (root / "data" / "skills" / ".kit_manifest").read_text(
                    encoding="utf-8").split()
                self.assertEqual(sorted(listed), sorted(self.delivered(root)))


class WhatFollowsThePurchase(unittest.TestCase):
    """The plugin folder, its engine surface and its curated flows."""

    @classmethod
    def setUpClass(cls):
        cls.fresh = install()
        cls.buyer = install(BOUGHT)

    def installed(self, root):
        return sorted(d.name for d in (root / "plugins").iterdir() if d.is_dir())

    def flows(self, root):
        return sorted(d.name for d in (root / "data" / "flows").iterdir()
                      if (d / "FLOW.md").is_file())

    def test_the_folder_is_the_set_the_kit_computed(self):
        for root, bought in ((self.fresh, []), (self.buyer, BOUGHT)):
            with self.subTest(agent=root.name):
                self.assertEqual(
                    self.installed(root),
                    sorted(plugin_set.plugin_set(root / "data")))

    def test_a_fresh_client_gets_the_defaults_and_the_base_capability(self):
        self.assertEqual(self.installed(self.fresh),
                         ["approval", "artifact", "capability", "deliverable",
                          "flow", "kanban", "transcribe"])

    def test_buying_two_capabilities_brings_two_plugins(self):
        self.assertEqual(sorted(set(self.installed(self.buyer))
                                - set(self.installed(self.fresh))),
                         ["invoices-to-data", "quotes"])

    def test_the_curated_flows_are_the_ones_this_agents_plugins_own(self):
        """A flow about quotes never lands on an agent that cannot write one."""
        for root in (self.fresh, self.buyer):
            with self.subTest(agent=root.name):
                self.assertEqual(
                    self.flows(root),
                    sorted(plugin_registry.flow_sources(self.installed(root), KIT)))
        self.assertNotIn("presupuesto-nuevo", self.flows(self.fresh))
        self.assertIn("presupuesto-nuevo", self.flows(self.buyer))

    def test_a_delivered_flow_is_the_plugins_byte_for_byte(self):
        """data/flows/<slug>/ is where the portal reads and the agent edits."""
        for root in (self.fresh, self.buyer):
            for slug, source in plugin_registry.flow_sources(
                    self.installed(root), KIT).items():
                with self.subTest(agent=root.name, flow=slug):
                    there = root / "data" / "flows" / slug / "FLOW.md"
                    self.assertEqual(there.read_bytes(),
                                     (source / "FLOW.md").read_bytes())

    def test_the_engine_surface_lands_where_the_engine_reads_it(self):
        """`flow` is a system plugin, so the promises guard reaches everyone."""
        for root in (self.fresh, self.buyer):
            with self.subTest(agent=root.name):
                guard = root / "policy" / "plugins" / "promises"
                self.assertTrue((guard / "plugin.yaml").is_file())
                self.assertEqual(
                    (guard / "promises.py").read_bytes(),
                    (KIT / "plugins" / "flow" / "engine" / "promises"
                     / "promises.py").read_bytes())


if __name__ == "__main__":
    unittest.main()
