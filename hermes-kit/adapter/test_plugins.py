"""What the adapter does with `/opt/plugins` at boot, and what it publishes.

Two features, and the second only exists because of the first:

BOOT. A broken plugin set must stop the process, not degrade it. The refusal
tests below run a REAL python that imports the REAL adapter against a fixture
registry and assert the exit code, because a mocked refusal proves the mock and
nothing else. The entrypoint the container runs is
`python3 /opt/kit/adapter/portal_adapter.py`; `-c "import portal_adapter"` runs
every line of it except the socket bind, and the scan is a module-level
statement that happens long before that bind -- which is the property being
tested.

/portal/plugins. Served over a real socket on an ephemeral port through the real
`Handler`, so what is checked is the route, the auth door and the payload,
rather than a function that happens to be called nearby.

Run from the monorepo root:
    python3 -m unittest discover -s hermes-kit/adapter -p "test_*.py"
"""

import io
import json
import os
import subprocess
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from contextlib import redirect_stderr
from http.server import ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
KIT = HERE.parent

sys.path.insert(0, str(HERE))
import plugins
import portal_adapter as adapter


def manifest(pid, **over):
    """A manifest that passes, so each test only writes what it breaks."""
    data = {
        "id": pid,
        "version": "1.0.0",
        "description": f"the {pid} plugin",
        "client_copy": f"Lo que {pid} hace por vos.",
        "requires": {},
        "surfaces": {"skills": [pid]},
        "system": False,
    }
    data.update(over)
    return data


def write(root, folder, data, skills=None, text=None):
    """One plugin directory under `<root>/plugins/`: manifest + its SKILL.md files."""
    where = Path(root) / "plugins" / folder
    where.mkdir(parents=True)
    if text is None:
        text = json.dumps(data, ensure_ascii=False, indent=2)
    (where / "plugin.json").write_text(text, encoding="utf-8")
    if skills is None:
        skills = (data or {}).get("surfaces", {}).get("skills") or []
    for name in skills:
        skill = where / "skills" / name
        skill.mkdir(parents=True)
        (skill / "SKILL.md").write_text(f"---\nname: {name}\n---\n", encoding="utf-8")
    return where


def load(root):
    """`plugins.load()` with its own stderr, so the log line can be asserted."""
    noise = io.StringIO()
    with redirect_stderr(noise):
        loaded = plugins.load(Path(root))
    return loaded, noise.getvalue()


class BootScan(unittest.TestCase):
    def test_no_plugins_directory_is_a_state_and_not_a_failure(self):
        """Every agent alive today, until the layout flip ships."""
        with tempfile.TemporaryDirectory() as tmp:
            loaded, log = load(tmp)
            self.assertEqual(loaded, {})
            self.assertIn("pre-plugin layout", log)
            self.assertIn(str(Path(tmp) / "plugins"), log)

    def test_an_empty_registry_is_not_the_same_as_no_registry(self):
        """The folder shipped and holds nothing yet: also fine, also not silent."""
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "plugins").mkdir()
            loaded, log = load(tmp)
            self.assertEqual(loaded, {})
            self.assertNotIn("pre-plugin layout", log)
            self.assertIn("0 loaded", log)

    def test_a_valid_registry_is_held_in_memory(self):
        with tempfile.TemporaryDirectory() as tmp:
            write(tmp, "kanban", manifest("kanban", system=True, surfaces={}))
            write(tmp, "approval", manifest(
                "approval", system=True, requires={"plugins": ["kanban"]}))
            loaded, log = load(tmp)
            self.assertEqual(sorted(loaded), ["approval", "kanban"])
            self.assertEqual(loaded["approval"]["version"], "1.0.0")
            self.assertIn("2 loaded", log)

    def test_the_kit_registry_itself_loads(self):
        """The real seven, read the way an agent will read them after the flip.

        The kit's own `plugins/` is the same shape `/opt/plugins` gets, which is
        the whole reason one validator can serve both.
        """
        loaded, log = load(KIT)
        folders = sorted(p.name for p in (KIT / "plugins").iterdir() if p.is_dir())
        self.assertEqual(sorted(loaded), folders)
        self.assertEqual(len(loaded), 7)
        self.assertIn(f"{len(folders)} loaded", log)
        # id == folder is a rule of the manifest; here it is also the promise
        # the endpoint's sort order rests on.
        for pid, data in loaded.items():
            self.assertEqual(data["id"], pid)
            self.assertEqual(data["_dir"].name, pid)


class RefusesToBoot(unittest.TestCase):
    """A broken set stops the process. Not a warning, not four plugins out of five."""

    def boot(self, root):
        done = subprocess.run(
            [sys.executable, "-c", "import portal_adapter"],
            cwd=str(HERE), capture_output=True, text=True, timeout=60,
            env={**os.environ, "PLUGINS_ROOT": str(root)},
        )
        return done.returncode, done.stdout + done.stderr

    def refuses(self, root, *fragments):
        code, out = self.boot(root)
        self.assertNotEqual(code, 0, f"the adapter booted anyway:\n{out}")
        self.assertIn("refusing to boot", out)
        for fragment in fragments:
            self.assertIn(fragment, out)
        return out

    def test_a_broken_closure(self):
        with tempfile.TemporaryDirectory() as tmp:
            write(tmp, "alpha", manifest("alpha", requires={"plugins": ["missing"]}))
            self.refuses(tmp, "alpha/plugin.json", "'missing'", "not in the registry")

    def test_a_malformed_manifest(self):
        with tempfile.TemporaryDirectory() as tmp:
            write(tmp, "alpha", manifest("alpha"), skills=["alpha"], text="{ not json")
            self.refuses(tmp, "alpha/plugin.json", "is not valid JSON")

    def test_two_plugins_claiming_the_same_skill(self):
        """One skill name, one source: the installed layout has one directory."""
        with tempfile.TemporaryDirectory() as tmp:
            write(tmp, "alpha", manifest("alpha", surfaces={"skills": ["shared"]}),
                  skills=["shared"])
            write(tmp, "beta", manifest("beta", surfaces={"skills": ["shared"]}),
                  skills=["shared"])
            self.refuses(tmp, "beta/plugin.json", "'shared'", "a skill name has one")

    def test_something_that_is_not_a_directory_in_the_registry_s_place(self):
        """A file or a dead symlink where `plugins/` goes is a broken install.

        Not the pre-plugin layout: that one is the path being ABSENT. Reporting
        a present path as missing is the one wrong sentence this branch can say.
        """
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "plugins").write_text("not a directory", encoding="utf-8")
            out = self.refuses(tmp, "is not a directory")
            self.assertNotIn("pre-plugin layout", out)
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "plugins").symlink_to(Path(tmp) / "nowhere")
            out = self.refuses(tmp, "is not a directory")
            self.assertNotIn("pre-plugin layout", out)

    def test_an_id_that_is_not_its_folder(self):
        with tempfile.TemporaryDirectory() as tmp:
            write(tmp, "alpha", manifest("beta"), skills=["beta"])
            self.refuses(tmp, "alpha/plugin.json", "they must be the same")

    def test_a_whole_registry_boots_and_says_so(self):
        """The other half of the same subprocess: it comes up, before any bind."""
        code, out = self.boot(KIT)
        self.assertEqual(code, 0, out)
        self.assertIn("7 loaded", out)
        self.assertNotIn("refusing to boot", out)


class PluginsEndpoint(unittest.TestCase):
    """GET /portal/plugins, over a real socket, through the real Handler."""

    KEY = "test-key"

    def setUp(self):
        self.previous = adapter.PLUGINS, adapter.TOKEN
        adapter.TOKEN = self.KEY
        # Port 0: the OS picks a free one. The adapter's own 8643 is hardcoded
        # in `__main__`, and a test that grabbed it would fight whatever agent
        # the machine happens to be running.
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), adapter.Handler)
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        adapter.PLUGINS, adapter.TOKEN = self.previous

    def get(self, path, key=KEY):
        request = urllib.request.Request(self.base + path)
        if key is not None:
            request.add_header("Authorization", f"Bearer {key}")
        with urllib.request.urlopen(request, timeout=10) as response:
            return response.status, json.loads(response.read())

    def test_it_publishes_the_installed_set_sorted_by_id(self):
        adapter.PLUGINS, _ = load(KIT)
        status, body = self.get("/portal/plugins")
        self.assertEqual(status, 200)
        ids = [p["id"] for p in body["plugins"]]
        self.assertEqual(ids, sorted(ids))
        self.assertEqual(ids, sorted(adapter.PLUGINS))

    def test_each_entry_carries_the_manifest_and_not_our_notes(self):
        adapter.PLUGINS, _ = load(KIT)
        _, body = self.get("/portal/plugins")
        approval = next(p for p in body["plugins"] if p["id"] == "approval")
        self.assertEqual(set(approval),
                         {"id", "version", "description", "system", "requires", "surfaces"})
        self.assertEqual(approval["version"], "1.0.0")
        self.assertTrue(approval["system"])
        # `requires` arrives whole even where the manifest left sub-lists out.
        self.assertEqual(approval["requires"],
                         {"plugins": ["kanban"], "connections": [], "toolsets": []})
        # Surfaces: which ones exist, plus the tab object exactly as written.
        self.assertEqual(approval["surfaces"]["present"], ["skills", "tab"])
        self.assertEqual(approval["surfaces"]["tab"], {"builtin": "approvals"})
        # `_dir` is a path on the agent and `_comment` is a note to ourselves.
        self.assertNotIn("_dir", approval)
        self.assertNotIn("_comment", approval)
        self.assertNotIn("client_copy", approval)

    def test_a_plugin_with_no_tab_and_no_skills_says_so(self):
        """kanban is the case: a manifest that exists to be depended on."""
        adapter.PLUGINS, _ = load(KIT)
        _, body = self.get("/portal/plugins")
        kanban = next(p for p in body["plugins"] if p["id"] == "kanban")
        self.assertEqual(kanban["surfaces"]["present"], ["tab"])
        self.assertEqual(kanban["requires"]["toolsets"], ["kanban"])
        transcribe = next(p for p in body["plugins"] if p["id"] == "transcribe")
        self.assertEqual(transcribe["surfaces"]["present"], ["skills"])
        self.assertIsNone(transcribe["surfaces"]["tab"])
        self.assertFalse(transcribe["system"])

    def test_no_plugins_directory_is_an_empty_list(self):
        """Every live agent today: the endpoint answers, with nothing in it."""
        with tempfile.TemporaryDirectory() as tmp:
            adapter.PLUGINS, _ = load(tmp)
        status, body = self.get("/portal/plugins")
        self.assertEqual(status, 200)
        self.assertEqual(body, {"plugins": []})

    def test_it_is_behind_the_same_door_as_everything_else(self):
        adapter.PLUGINS, _ = load(KIT)
        with self.assertRaises(urllib.error.HTTPError) as refused:
            self.get("/portal/plugins", key="wrong")
        self.assertEqual(refused.exception.code, 401)
        # An HTTPError IS the response object; unclosed it leaks the socket and
        # unittest reports the ResourceWarning against whatever runs next.
        refused.exception.close()


if __name__ == "__main__":
    unittest.main()
