"""Which plugins an agent gets: the three sources, and the closure.

The kit is real here and the AGENT is a fixture — an `<agent>/` with a `data/`
and, when the client has bought something, a
`policy/capabilities/purchased.json` — because that is exactly the split the
module makes: the kit says what a capability installs, the agent's disk says
which capabilities its client bought.

Run from the monorepo root:
    python3 -m unittest discover -s kit/tools -p "test_*.py"
"""

import json
import shutil
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

SYSTEM_PLUGINS = {"kanban", "approval", "deliverable", "artifact", "flow",
                  "capability"}


def agent(*bought):
    """A throwaway agent whose client bought those capabilities.

    With none, no `purchased.json` is written at all: that is the fresh client,
    and its absence is the state under test, not an empty list.
    """
    root = Path(tempfile.mkdtemp(prefix="agent-"))
    data = root / "data"
    data.mkdir()
    if bought:
        purchased = root / plugin_set.PURCHASED_FILE
        purchased.parent.mkdir(parents=True)
        purchased.write_text(
            json.dumps({"capabilities": list(bought)}, ensure_ascii=False),
            encoding="utf-8")
    return data


def broken(payload):
    """An agent whose purchased.json holds exactly this text."""
    root = Path(tempfile.mkdtemp(prefix="agent-"))
    (root / "data").mkdir()
    purchased = root / plugin_set.PURCHASED_FILE
    purchased.parent.mkdir(parents=True)
    purchased.write_text(payload, encoding="utf-8")
    return root / "data"


class TheSet(unittest.TestCase):
    def test_a_fresh_agent_gets_the_system_plugins_and_the_base_capability(self):
        """No purchase: what is left is what every agent has anyway.

        `transcribe` is the whole point of the base-capability rule — nobody
        buys it, and the capabilities catalog promises `transcription` as
        already installed on every agent.
        """
        found = plugin_set.plugin_set(agent())
        self.assertEqual(set(found), SYSTEM_PLUGINS | {"transcribe"})
        self.assertEqual(found["kanban"], ["system"])
        # THE REASON NAMES THE CAPABILITY, not a skill: `installs.plugins` is
        # what is read, and `transcription` is the row a client would point at.
        self.assertEqual(found["transcribe"], ["base capability (transcription)"])

    def test_no_file_is_a_state_and_not_a_failure(self):
        """A client on their first day has bought nothing, and that installs."""
        data = agent()
        self.assertFalse(plugin_set.purchased_file(data).is_file())
        self.assertEqual(plugin_set.purchased_capabilities(data), [])

    def test_a_bought_capability_brings_its_plugins(self):
        found = plugin_set.plugin_set(agent("invoices-to-data"))
        self.assertIn("invoices-to-data", found)
        self.assertEqual(found["invoices-to-data"], ["purchased (invoices-to-data)"])

    def test_a_capability_nobody_bought_brings_nothing(self):
        """`quotes` is sales work, and only on an agent whose client bought it."""
        self.assertNotIn("quotes", plugin_set.plugin_set(agent("invoices-to-data")))
        self.assertNotIn("quotes", plugin_set.plugin_set(agent()))

    def test_one_capability_may_install_several_plugins(self):
        """`social-package` is the case: the kit, the writer and the images."""
        found = plugin_set.plugin_set(agent("social-package"))
        for pid in ("brand-kit", "social-content", "post-image"):
            self.assertEqual(found[pid], ["purchased (social-package)"], pid)

    def test_two_capabilities_that_install_the_same_plugin_name_the_first(self):
        """`brand-kit` is behind three menu rows; the folder ships once."""
        found = plugin_set.plugin_set(agent("branded-reports", "linkedin-content"))
        self.assertEqual(found["brand-kit"], ["purchased (branded-reports)"])

    def test_the_set_is_closed_for_every_row_we_sell(self):
        """A plugin's dependencies are in the set, for any purchase we can build.

        The closure is what the adapter refuses to boot without, so it is not
        enough for it to hold on today's shopping list: it is asserted for each
        menu row on its own and for all of them at once.
        """
        available = plugin_registry.registry(KIT)
        menu = [row["id"] for row in plugin_registry.capability_rows(KIT)
                if row.get("level") != plugin_registry.BASE]
        baskets = [()] + [(cid,) for cid in menu] + [tuple(menu)]
        for bought in baskets:
            with self.subTest(bought=bought or "nothing"):
                found = plugin_set.plugin_set(agent(*bought))
                for pid in found:
                    for dependency in available[pid]["requires"].get("plugins") or []:
                        self.assertIn(dependency, found)


class WhatTheFileHasToBe(unittest.TestCase):
    """It decides what code reaches the agent, so every doubt about it stops."""

    def test_malformed_json_names_the_file(self):
        with self.assertRaises(SystemExit) as refused:
            plugin_set.purchased_capabilities(broken("{not json"))
        self.assertIn("purchased.json", str(refused.exception))
        self.assertIn("not valid JSON", str(refused.exception))

    def test_a_bare_list_is_not_the_shape(self):
        with self.assertRaises(SystemExit) as refused:
            plugin_set.purchased_capabilities(broken('["quotes"]'))
        self.assertIn("JSON object", str(refused.exception))

    def test_a_key_the_file_does_not_define(self):
        with self.assertRaises(SystemExit) as refused:
            plugin_set.purchased_capabilities(
                broken('{"capabilities": [], "roles": ["sales"]}'))
        self.assertIn("roles", str(refused.exception))

    def test_capabilities_that_is_not_a_list_of_ids(self):
        with self.assertRaises(SystemExit) as refused:
            plugin_set.purchased_capabilities(broken('{"capabilities": "quotes"}'))
        self.assertIn("list of capability ids", str(refused.exception))

    def test_an_id_the_catalog_does_not_have(self):
        with self.assertRaises(SystemExit) as refused:
            plugin_set.purchased_capabilities(
                broken('{"capabilities": ["quotes", "telepathy"]}'))
        message = str(refused.exception)
        self.assertIn("telepathy", message)
        self.assertNotIn("quotes", message)
        self.assertIn("purchased.json", message)

    def test_a_base_row_is_included_and_therefore_not_bought(self):
        """Selling what already ships is how a client is charged twice.

        And it would be a lie in the other direction too: taking `transcription`
        out of this file would not take `transcribe` off the agent, because
        `base_capability_plugins()` puts it there whatever anybody bought.
        """
        with self.assertRaises(SystemExit) as refused:
            plugin_set.purchased_capabilities(
                broken('{"capabilities": ["transcription"]}'))
        message = str(refused.exception)
        self.assertIn("transcription", message)
        self.assertIn("base", message)

    def test_a_comment_is_allowed_like_every_other_catalog(self):
        data = broken(json.dumps(
            {"_comment": ["bought 2026-08-30, invoice 41"],
             "capabilities": ["quotes"]}))
        self.assertEqual(plugin_set.purchased_capabilities(data), ["quotes"])


class TheCommand(unittest.TestCase):
    """install.sh reads this over a pipe: one id per line, sorted, nothing else."""

    def run_it(self, data, *args):
        done = subprocess.run(
            [sys.executable, str(HERE / "plugin_set.py"), str(data), *args],
            capture_output=True, text=True, timeout=60)
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)
        return done

    def test_it_prints_one_sorted_id_per_line(self):
        lines = self.run_it(agent("invoices-to-data")).stdout.splitlines()
        self.assertEqual(lines, sorted(lines))
        self.assertIn("invoices-to-data", lines)
        self.assertTrue(all(line.strip() == line and " " not in line for line in lines))

    def test_why_says_where_each_one_comes_from(self):
        done = self.run_it(agent("quotes"), "--why")
        rows = dict(line.split("\t", 1) for line in done.stdout.splitlines())
        self.assertEqual(rows["flow"], "system")
        self.assertEqual(rows["transcribe"], "base capability (transcription)")
        self.assertEqual(rows["quotes"], "purchased (quotes)")

    def test_nothing_bought_is_said_on_stderr_and_not_on_the_pipe(self):
        """install.sh reads stdout: a note in there would be a plugin id."""
        done = self.run_it(agent())
        self.assertIn("nothing bought yet", done.stderr)
        self.assertNotIn("nothing bought", done.stdout)
        self.assertEqual(done.stdout.splitlines(), sorted(SYSTEM_PLUGINS | {"transcribe"}))

    def test_a_purchase_says_nothing_extra(self):
        self.assertEqual(self.run_it(agent("quotes")).stderr, "")

    def test_it_refuses_a_data_directory_that_is_not_there(self):
        done = subprocess.run(
            [sys.executable, str(HERE / "plugin_set.py"), "/nowhere/data"],
            capture_output=True, text=True, timeout=60)
        self.assertNotEqual(done.returncode, 0)
        self.assertIn("does not exist", done.stderr)

    def test_a_broken_file_stops_the_command(self):
        done = subprocess.run(
            [sys.executable, str(HERE / "plugin_set.py"), str(broken("{"))],
            capture_output=True, text=True, timeout=60)
        self.assertNotEqual(done.returncode, 0)
        self.assertIn("purchased.json", done.stderr)


class TheClosureIsAssertedAndNotRepaired(unittest.TestCase):
    """A capability that installs a plugin installs its dependencies too.

    THE CORRUPTION GOES IN A THROWAWAY KIT, NOT IN THIS ONE. Writing a broken
    `installs` into the real `capabilities/catalog.json` and putting it back in a
    `finally` leaves the tree clean afterwards — but for the length of the test
    the repo really does sell a capability that installs half a plugin, and
    anything else reading it in that window (another test, a `check-plugins.py`
    in a second terminal, an install) fails for a reason that is not there a
    second later.
    """

    def test_a_plugin_whose_dependency_nobody_bought_stops_it(self):
        kit = Path(tempfile.mkdtemp(prefix="kit-"))
        for entry in KIT.iterdir():
            if entry.name != "capabilities":
                (kit / entry.name).symlink_to(entry)
        shutil.copytree(KIT / "capabilities", kit / "capabilities")
        catalog = kit / "capabilities" / "catalog.json"
        rows = json.loads(catalog.read_text(encoding="utf-8"))
        for row in rows["capabilities"]:
            # `post-image` requires `brand-kit`; sold on its own it arrives
            # without the kit it reads the hexes out of.
            if row["id"] == "social-package":
                row["installs"]["plugins"] = ["post-image"]
        catalog.write_text(json.dumps(rows, ensure_ascii=False, indent=2) + "\n",
                           encoding="utf-8")
        original, plugin_set.KIT = plugin_set.KIT, kit
        plugin_set.CAPABILITIES = kit / "capabilities" / "catalog.json"
        try:
            with self.assertRaises(SystemExit) as refused:
                plugin_set.plugin_set(agent("social-package"))
            message = str(refused.exception)
            self.assertIn("post-image", message)
            self.assertIn("brand-kit", message)
        finally:
            plugin_set.KIT = original
            plugin_set.CAPABILITIES = original / "capabilities" / "catalog.json"
            shutil.rmtree(kit, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
