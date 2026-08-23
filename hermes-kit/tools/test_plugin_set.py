"""Which plugins an agent gets: the three sources, and the closure.

The kit is real here and the AGENT is a fixture — a `data/` with nothing but
`profiles/` in it — because that is exactly the split the module makes: the kit
says what a role is made of, the agent's disk says which roles it hired.

Run from the monorepo root:
    python3 -m unittest discover -s hermes-kit/tools -p "test_*.py"
"""

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
KIT = HERE.parent
sys.path.insert(0, str(HERE))
import plugin_registry
import plugin_set

SYSTEM_PLUGINS = {"kanban", "approval", "deliverable", "artifact", "flow"}


def agent(*hired):
    """A throwaway `data/` with those roles hired, i.e. their profile on disk."""
    data = Path(tempfile.mkdtemp(prefix="agent-")) / "data"
    for role in hired:
        (data / "profiles" / role).mkdir(parents=True)
    data.mkdir(exist_ok=True)
    return data


class TheSet(unittest.TestCase):
    def test_a_solo_agent_gets_the_system_plugins_and_the_base_capability(self):
        """No roster, no profiles: what is left is what every agent has anyway.

        `transcribe` is the whole point of the base-capability rule — no role
        declares it, and the capabilities catalog promises `transcription` as
        already installed on every agent.
        """
        found = plugin_set.plugin_set(agent())
        self.assertEqual(set(found), SYSTEM_PLUGINS | {"transcribe"})
        self.assertEqual(found["kanban"], ["system"])
        self.assertEqual(found["transcribe"], ["base capability (transcribe)"])

    def test_a_hired_role_brings_its_own_plugins(self):
        found = plugin_set.plugin_set(agent("accounting"))
        self.assertIn("invoices-to-data", found)
        self.assertEqual(found["invoices-to-data"], ["role accounting"])
        # A system plugin the role also declares says both things.
        self.assertEqual(found["approval"], ["system", "role accounting"])

    def test_a_role_nobody_hired_brings_nothing(self):
        """`invoices-to-data` is accounting's, and only on an agent that has it."""
        self.assertNotIn("invoices-to-data", plugin_set.plugin_set(agent("marketing")))
        self.assertNotIn("invoices-to-data", plugin_set.plugin_set(agent()))

    def test_a_profile_that_is_not_a_role_is_not_one(self):
        """Whatever else the engine keeps under profiles/ is not something we sell."""
        self.assertEqual(sorted(plugin_set.plugin_set(agent("default", "whatever"))),
                         sorted(plugin_set.plugin_set(agent())))

    def test_installed_roles_are_read_by_presence(self):
        data = agent("marketing", "sales")
        self.assertEqual(sorted(plugin_set.installed_roles(data)), ["marketing", "sales"])

    def test_the_set_is_closed_for_every_role_we_sell(self):
        """A plugin's dependencies are in the set, on every agent we can build.

        The closure is what the adapter refuses to boot without, so it is not
        enough for it to hold on the roster of the day: it is asserted for each
        role on its own and for all of them at once.
        """
        available = plugin_registry.registry(KIT)
        rosters = [()] + [(rid,) for rid in plugin_set.role_ids()]
        rosters.append(tuple(plugin_set.role_ids()))
        for hired in rosters:
            with self.subTest(hired=hired or "solo"):
                found = plugin_set.plugin_set(agent(*hired))
                for pid in found:
                    for dependency in available[pid]["requires"].get("plugins") or []:
                        self.assertIn(dependency, found)

    def test_a_role_declaring_a_plugin_the_registry_does_not_have_stops_it(self):
        """The message names the role, because that is the file to fix."""
        broken = KIT / "roles" / "accounting" / "role.json"
        original = broken.read_text(encoding="utf-8")
        cfg = json.loads(original)
        cfg["plugins"] = cfg["plugins"] + ["not-a-plugin"]
        try:
            broken.write_text(json.dumps(cfg, ensure_ascii=False, indent=2) + "\n",
                              encoding="utf-8")
            with self.assertRaises(SystemExit) as refused:
                plugin_set.plugin_set(agent("accounting"))
            self.assertIn("not-a-plugin", str(refused.exception))
            self.assertIn("accounting", str(refused.exception))
        finally:
            broken.write_text(original, encoding="utf-8")


class TheCommand(unittest.TestCase):
    """install.sh reads this over a pipe: one id per line, sorted, nothing else."""

    def run_it(self, data, *args):
        done = subprocess.run(
            [sys.executable, str(HERE / "plugin_set.py"), str(data), *args],
            capture_output=True, text=True, timeout=60)
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)
        return done.stdout.splitlines()

    def test_it_prints_one_sorted_id_per_line(self):
        lines = self.run_it(agent("accounting"))
        self.assertEqual(lines, sorted(lines))
        self.assertIn("invoices-to-data", lines)
        self.assertTrue(all(line.strip() == line and " " not in line for line in lines))

    def test_why_says_where_each_one_comes_from(self):
        rows = dict(line.split("\t", 1) for line in self.run_it(agent(), "--why"))
        self.assertEqual(rows["flow"], "system")
        self.assertEqual(rows["transcribe"], "base capability (transcribe)")

    def test_it_refuses_a_data_directory_that_is_not_there(self):
        done = subprocess.run(
            [sys.executable, str(HERE / "plugin_set.py"), "/nowhere/data"],
            capture_output=True, text=True, timeout=60)
        self.assertNotEqual(done.returncode, 0)
        self.assertIn("does not exist", done.stderr)


if __name__ == "__main__":
    unittest.main()
