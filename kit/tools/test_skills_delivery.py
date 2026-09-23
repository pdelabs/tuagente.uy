"""One skill, one home — asked of an agent install.sh really built.

    python3 -m unittest discover -s kit/tools -p "test_*.py"

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

import importlib.util
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


def agent_check():
    """agent-check.py, whose file name is not an identifier."""
    spec = importlib.util.spec_from_file_location(
        "agent_check", TOOLS / "agent-check.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

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

    def test_the_index_is_the_harness_plus_what_this_client_bought(self):
        """NOT the whole kit, which is what a solo agent used to get.

        Before the menu there was nothing else it could mean; now it is wrong in
        both directions. `quotes` in the index of an agent that never bought it
        is prompt paid on every request for a SKILL.md whose plugin folder — its
        tab, its routes, its flows — is not on the agent at all.
        """
        for root in (self.fresh, self.buyer):
            with self.subTest(agent=root.name):
                self.assertEqual(self.delivered(root),
                                 set(skill_sources.agent_skills(root / "data")))
        whole_kit = set(skill_sources.skill_dirs())
        self.assertLess(self.delivered(self.fresh), whole_kit)
        self.assertLess(self.delivered(self.fresh), self.delivered(self.buyer))

    def test_the_harness_is_on_every_agent_whatever_anybody_bought(self):
        """The fallback notes: the only thing between a missing tool and a
        faked result, and they answer to the engine's index, not to a sale."""
        for root in (self.fresh, self.buyer):
            with self.subTest(agent=root.name):
                self.assertLessEqual(skill_sources.harness_skills(),
                                     self.delivered(root))
        self.assertIn("no-web-search", skill_sources.harness_skills())

    def test_a_skill_nobody_bought_is_not_on_the_agent(self):
        """`quotes` arrives with the purchase and not before it."""
        self.assertNotIn("quotes", self.delivered(self.fresh))
        self.assertIn("quotes", self.delivered(self.buyer))
        # And `drive-inbox` is in nobody's set: no capability sells it.
        self.assertNotIn("drive-inbox", self.delivered(self.buyer))

    def test_agent_check_expects_exactly_what_the_installer_wrote(self):
        """The two have to be one answer, which is why they are one function.

        `agent-check.py` demanding a skill install.sh does not ship is an
        eternal red line that says "run install.sh" and re-running it changes
        nothing — which is exactly what the whole-kit answer did the day an
        agent stopped getting the whole kit.
        """
        for root in (self.fresh, self.buyer):
            with self.subTest(agent=root.name):
                self.assertEqual(agent_check().expected_skills(str(root / "data")),
                                 self.delivered(root))

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
                          "flow", "kanban", "notify", "transcribe"])

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

    def test_no_plugin_carries_an_engine_surface_any_more(self):
        """The promises guard was the only one, and it moved into our engine.

        `plugins/flow/engine/promises/` was a plugin of HERMES' that install.sh
        copied to `policy/plugins/promises/`. The guard lives in
        `engine/core/promises.py` now, next to the flows it reads
        (docs/own-agent-plan.md, wave 1), so a Hermes agent installed from this
        kit no longer gets one -- which is what Hermes dying looks like from
        here, and is pinned so it is a decision and not a regression.
        """
        self.assertEqual(
            [pid for pid, data in plugin_registry.registry(KIT).items()
             if data["surfaces"].get("engine")], [])
        for root in (self.fresh, self.buyer):
            with self.subTest(agent=root.name):
                self.assertFalse((root / "policy" / "plugins" / "promises").exists())


if __name__ == "__main__":
    unittest.main()
