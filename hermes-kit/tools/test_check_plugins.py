"""What a broken plugin registry has to do: stop, and say which manifest.

Run from the monorepo root:
    python3 -m unittest discover -s hermes-kit/tools -p "test_*.py"

Every failure case is a whole fixture registry in a tempdir, checked through
the command line the way an operator runs it, because the exit code and the
message ARE the feature: `roles/build_role.py` and `install.sh` both stop on
this and the person reading the output has to know which file to open.

The last two classes go at the resolver directly (`plugin_registry`), which is
where a ROLE's plugin list is turned into skills — the registry can be perfect
and the role still ask for a plugin that is not there.
"""
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

TOOLS = Path(__file__).resolve().parent
KIT = TOOLS.parent
CHECK = TOOLS / "check-plugins.py"

sys.path.insert(0, str(TOOLS))
import plugin_registry


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
    """One plugin directory: the manifest, and a SKILL.md per skill it claims."""
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


def kit_skill(root, name):
    skill = Path(root) / "skills" / name
    skill.mkdir(parents=True)
    (skill / "SKILL.md").write_text(f"---\nname: {name}\n---\n", encoding="utf-8")


def check(root):
    out = subprocess.run(
        [sys.executable, str(CHECK), "--root", str(root)],
        capture_output=True, text=True,
    )
    return out.returncode, out.stdout + out.stderr


class RealRegistry(unittest.TestCase):
    def test_the_kit_passes(self):
        code, out = check(KIT)
        self.assertEqual(code, 0, out)


class ValidRegistry(unittest.TestCase):
    def test_a_graph_with_dependencies_passes(self):
        with tempfile.TemporaryDirectory() as tmp:
            write(tmp, "kanban", manifest("kanban", system=True))
            write(tmp, "approval", manifest(
                "approval", system=True, requires={"plugins": ["kanban"]}))
            write(tmp, "webscraping", manifest(
                "webscraping",
                requires={"plugins": ["approval"], "connections": [], "toolsets": ["code_execution"]},
                surfaces={"skills": ["scrape"], "tab": {"label": "Scrapeos"}}),
                skills=["scrape"])
            code, out = check(tmp)
            self.assertEqual(code, 0, out)
            self.assertIn("3 plugin(s)", out)
            self.assertIn("PASS", out)

    def test_an_empty_registry_passes(self):
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "plugins").mkdir()
            code, out = check(tmp)
            self.assertEqual(code, 0, out)


class BrokenRegistry(unittest.TestCase):
    def fails_with(self, tmp, *fragments):
        code, out = check(tmp)
        self.assertEqual(code, 1, out)
        for fragment in fragments:
            self.assertIn(fragment, out)
        return out

    def test_duplicate_id(self):
        with tempfile.TemporaryDirectory() as tmp:
            write(tmp, "alpha", manifest("alpha"))
            write(tmp, "beta", manifest("alpha"), skills=["alpha"])
            self.fails_with(tmp, "already declared by", "alpha")

    def test_id_is_not_the_folder_name(self):
        with tempfile.TemporaryDirectory() as tmp:
            write(tmp, "alpha", manifest("beta"), skills=["beta"])
            self.fails_with(tmp, "id is 'beta' but the folder is 'alpha'")

    def test_id_is_not_kebab_case(self):
        with tempfile.TemporaryDirectory() as tmp:
            write(tmp, "Facturas", manifest("Facturas"), skills=["Facturas"])
            self.fails_with(tmp, "is not English kebab-case")

    def test_version_is_not_semver(self):
        with tempfile.TemporaryDirectory() as tmp:
            write(tmp, "alpha", manifest("alpha", version="1.0"))
            self.fails_with(tmp, "version '1.0' is not semver")

    def test_dependency_that_is_not_in_the_registry(self):
        with tempfile.TemporaryDirectory() as tmp:
            write(tmp, "alpha", manifest("alpha", requires={"plugins": ["kanban"]}))
            self.fails_with(tmp, "requires plugin 'kanban', which is not in the registry")

    def test_dependency_cycle(self):
        with tempfile.TemporaryDirectory() as tmp:
            write(tmp, "alpha", manifest("alpha", requires={"plugins": ["beta"]}))
            write(tmp, "beta", manifest("beta", requires={"plugins": ["gamma"]}))
            write(tmp, "gamma", manifest("gamma", requires={"plugins": ["alpha"]}))
            out = self.fails_with(tmp, "dependency cycle")
            self.assertIn("alpha -> beta -> gamma -> alpha", out)

    def test_a_system_plugin_depending_on_a_client_one(self):
        with tempfile.TemporaryDirectory() as tmp:
            write(tmp, "alpha", manifest("alpha", system=True,
                                         requires={"plugins": ["beta"]}))
            write(tmp, "beta", manifest("beta"))
            self.fails_with(tmp, "is a system plugin and requires 'beta', which is not")

    def test_a_skills_surface_with_no_skill_md(self):
        with tempfile.TemporaryDirectory() as tmp:
            write(tmp, "alpha", manifest("alpha"), skills=[])
            self.fails_with(tmp, "there is no skills/alpha/SKILL.md")

    def test_a_file_surface_that_is_not_there(self):
        with tempfile.TemporaryDirectory() as tmp:
            write(tmp, "alpha", manifest(
                "alpha", surfaces={"skills": ["alpha"], "adapter": "endpoints.py"}),
                skills=["alpha"])
            self.fails_with(tmp, "surfaces.adapter points at 'endpoints.py'")

    def test_malformed_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            write(tmp, "alpha", None, skills=["alpha"], text='{"id": "alpha",}')
            self.fails_with(tmp, "is not valid JSON")

    def test_a_key_the_manifest_does_not_define(self):
        with tempfile.TemporaryDirectory() as tmp:
            write(tmp, "alpha", manifest("alpha", installs=["whatever"]))
            self.fails_with(tmp, "has keys the manifest does not define: ['installs']")

    def test_a_missing_required_key(self):
        with tempfile.TemporaryDirectory() as tmp:
            data = manifest("alpha")
            del data["client_copy"]
            write(tmp, "alpha", data)
            self.fails_with(tmp, "is missing required keys: ['client_copy']")

    def test_a_directory_with_no_manifest(self):
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "plugins" / "alpha").mkdir(parents=True)
            self.fails_with(tmp, "is in plugins/ and has no plugin.json")

    def test_a_skill_name_that_also_ships_under_skills(self):
        with tempfile.TemporaryDirectory() as tmp:
            kit_skill(tmp, "transcribe")
            write(tmp, "transcribe", manifest("transcribe"))
            self.fails_with(tmp, "also ships as skills/transcribe/")


class RoleResolution(unittest.TestCase):
    """What a role's `plugins:` list is allowed to say."""

    def test_the_skills_come_back_in_declaration_order(self):
        with tempfile.TemporaryDirectory() as tmp:
            write(tmp, "alpha", manifest("alpha"))
            write(tmp, "beta", manifest("beta"))
            got = plugin_registry.role_skills(["beta", "alpha"], "accounting", Path(tmp))
            self.assertEqual(list(got), ["beta", "alpha"])
            self.assertTrue(got["beta"].joinpath("SKILL.md").is_file())

    def test_a_plugin_that_is_not_in_the_registry(self):
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "plugins").mkdir()
            with self.assertRaises(SystemExit) as raised:
                plugin_registry.role_skills(["alpha"], "accounting", Path(tmp))
            self.assertIn("plugin 'alpha' is not in the registry", str(raised.exception))

    def test_a_dependency_the_role_does_not_declare(self):
        with tempfile.TemporaryDirectory() as tmp:
            write(tmp, "alpha", manifest("alpha", requires={"plugins": ["beta"]}))
            write(tmp, "beta", manifest("beta"))
            with self.assertRaises(SystemExit) as raised:
                plugin_registry.role_skills(["alpha"], "accounting", Path(tmp))
            self.assertIn("requires 'beta' and this role does not declare it",
                          str(raised.exception))

    def test_a_system_dependency_needs_no_declaring(self):
        with tempfile.TemporaryDirectory() as tmp:
            write(tmp, "alpha", manifest("alpha", requires={"plugins": ["beta"]}))
            write(tmp, "beta", manifest("beta", system=True))
            got = plugin_registry.role_skills(["alpha"], "accounting", Path(tmp))
            self.assertEqual(list(got), ["alpha"])


class TheKitsOwnRegistry(unittest.TestCase):
    """The pilots of phase 1, and the flattening the rest of the kit relies on."""

    def test_the_two_pilots_are_there_with_a_skills_surface_only(self):
        plugins = plugin_registry.registry(KIT)
        self.assertEqual(sorted(plugins), ["invoices-to-data", "transcribe"])
        for pid, data in plugins.items():
            self.assertEqual(data["surfaces"], {"skills": [pid]})
            self.assertFalse(data["system"])
            self.assertEqual(data["requires"], {})

    def test_their_skills_resolve_to_the_directory_that_holds_the_skill_md(self):
        sources = plugin_registry.skill_sources(KIT)
        self.assertEqual(sorted(sources), ["invoices-to-data", "transcribe"])
        for name, where in sources.items():
            self.assertEqual(where, KIT / "plugins" / name / "skills" / name)
            self.assertTrue((where / "SKILL.md").is_file())

    def test_the_flattened_layout_still_has_one_directory_per_skill(self):
        """What install.sh and build_role.py copy: name -> one source, no plugins."""
        sys.path.insert(0, str(KIT / "roles"))
        import skills_split
        dirs = skills_split.skill_dirs()
        self.assertEqual(dirs["transcribe"], KIT / "plugins/transcribe/skills/transcribe")
        self.assertEqual(dirs["approval"], KIT / "skills/approval")
        self.assertEqual(len(dirs), len(set(dirs)))


if __name__ == "__main__":
    unittest.main()
