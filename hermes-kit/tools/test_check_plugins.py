"""What a broken plugin registry has to do: stop, and say which manifest.

Run from the monorepo root:
    python3 -m unittest discover -s hermes-kit/tools -p "test_*.py"

Every failure case is a whole fixture registry in a tempdir, checked through
the command line the way an operator runs it, because the exit code and the
message ARE the feature: `roles/build_role.py` and `install.sh` both stop on
this and the person reading the output has to know which file to open.

The classes after `BrokenRegistry` go at the resolver directly
(`plugin_registry`), which is where a ROLE's declaration is turned into skills —
the registry can be perfect and the role still ask for a plugin that is not
there, or ask for a plugin's skill by name instead of declaring the plugin.
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

    def test_a_plugin_may_carry_no_skills_at_all(self):
        """Every surface is optional: absent, `null` and `[]` all mean none."""
        for none in ({}, {"skills": None}, {"skills": []}):
            with tempfile.TemporaryDirectory() as tmp:
                write(tmp, "alpha", manifest("alpha", surfaces=none), skills=[])
                code, out = check(tmp)
                self.assertEqual(code, 0, out)

    def test_a_tab_may_name_a_page_the_portal_already_has(self):
        """The system plugins' shape: `builtin`, not a label to draw."""
        with tempfile.TemporaryDirectory() as tmp:
            write(tmp, "alpha", manifest(
                "alpha", surfaces={"skills": ["alpha"], "tab": {"builtin": "pipeline"}}))
            code, out = check(tmp)
            self.assertEqual(code, 0, out)
            self.assertIn("tab:builtin/pipeline", out)

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

    def test_a_skills_surface_that_is_not_a_list(self):
        """The falsy ones too: they used to pass as "this plugin has no skills"."""
        for bad in (0, "", {}, False, "alpha", ["alpha", 7]):
            with tempfile.TemporaryDirectory() as tmp:
                write(tmp, "alpha", manifest("alpha", surfaces={"skills": bad}),
                      skills=["alpha"])
                self.fails_with(tmp, "surfaces.skills must be a list of skill names")

    def test_a_file_surface_that_is_not_there(self):
        with tempfile.TemporaryDirectory() as tmp:
            write(tmp, "alpha", manifest(
                "alpha", surfaces={"skills": ["alpha"], "adapter": "endpoints.py"}),
                skills=["alpha"])
            self.fails_with(tmp, "surfaces.adapter points at 'endpoints.py'")

    def test_an_engine_surface_that_is_a_file_and_not_a_folder(self):
        """The engine loads a DIRECTORY: a lone .py is not a plugin of theirs."""
        with tempfile.TemporaryDirectory() as tmp:
            where = write(tmp, "alpha", manifest(
                "alpha", surfaces={"skills": ["alpha"], "engine": "hook.py"}),
                skills=["alpha"])
            (where / "hook.py").write_text("# hook\n", encoding="utf-8")
            self.fails_with(tmp, "which is not a directory")

    def test_an_engine_surface_with_no_plugin_yaml(self):
        """Without it the engine discovers the folder and loads nothing at all.

        Which is the promises guard's own failure mode: installed, off, and the
        fleet table saying it is there.
        """
        with tempfile.TemporaryDirectory() as tmp:
            where = write(tmp, "alpha", manifest(
                "alpha", surfaces={"skills": ["alpha"], "engine": "engine/guard"}),
                skills=["alpha"])
            (where / "engine" / "guard").mkdir(parents=True)
            (where / "engine" / "guard" / "guard.py").write_text("", encoding="utf-8")
            self.fails_with(tmp, "has no plugin.yaml")

    def test_a_tab_that_declares_both_shapes(self):
        """A page the portal has AND a word to draw is two different tabs."""
        with tempfile.TemporaryDirectory() as tmp:
            write(tmp, "alpha", manifest("alpha", surfaces={
                "skills": ["alpha"], "tab": {"builtin": "pipeline", "label": "Pipeline"}}))
            self.fails_with(tmp, "surfaces.tab must be an object with exactly one of")

    def test_a_tab_with_neither_shape(self):
        for bad in ({}, {"page": "pipeline"}, "pipeline", ["pipeline"]):
            with tempfile.TemporaryDirectory() as tmp:
                write(tmp, "alpha",
                      manifest("alpha", surfaces={"skills": ["alpha"], "tab": bad}))
                self.fails_with(tmp, "surfaces.tab must be an object with exactly one of")

    def test_a_tab_whose_one_key_is_empty(self):
        for key in ("builtin", "label"):
            for bad in ("", "   ", 7, None):
                with tempfile.TemporaryDirectory() as tmp:
                    write(tmp, "alpha", manifest(
                        "alpha", surfaces={"skills": ["alpha"], "tab": {key: bad}}))
                    self.fails_with(tmp, f"surfaces.tab.{key} must be a non-empty string")

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


class RoleSkillsListIsKitSkillsOnly(unittest.TestCase):
    """A role asks for a plugin's skill BY DECLARING THE PLUGIN, never by name.

    The role-side half of the one-source rule. Both readers of a role.json go
    through it, because they used to disagree: `skills_split.py` accepted a
    plugin-owned name under `skills:` -- and accepting it made the skill look
    declared by every role, which turned it SHARED and put it in kit-skills/ on
    every team agent -- while `build_role.py` refused the same file saying the
    skill "does not exist in skills/", which is the one place it was never
    going to be.
    """

    def test_a_kit_skill_under_skills_is_fine(self):
        with tempfile.TemporaryDirectory() as tmp:
            write(tmp, "alpha", manifest("alpha"))
            kit_skill(tmp, "quotes")
            plugin_registry.check_kit_skills(["quotes"], "sales", Path(tmp))

    def test_a_plugin_skill_under_skills_stops_it(self):
        with tempfile.TemporaryDirectory() as tmp:
            write(tmp, "artifact", manifest("artifact", system=True))
            with self.assertRaises(SystemExit) as raised:
                plugin_registry.check_kit_skills(["artifact"], "support", Path(tmp))
            message = str(raised.exception)
            self.assertIn("support", message)
            self.assertIn("plugins/artifact/", message)
            self.assertIn("one source", message)

    def test_declaring_it_on_both_sides_is_caught_too(self):
        """`skills: [approval]` AND `plugins: [approval]` is the same mistake."""
        with tempfile.TemporaryDirectory() as tmp:
            write(tmp, "approval", manifest("approval", system=True))
            with self.assertRaises(SystemExit) as raised:
                plugin_registry.check_kit_skills(["approval"], "support", Path(tmp))
            self.assertIn("plugins/approval/", str(raised.exception))

    def test_the_kits_own_roles_pass_it(self):
        for role_id in ("marketing", "support", "sales", "accounting", "assistant"):
            cfg = json.loads(
                (KIT / "roles" / role_id / "role.json").read_text(encoding="utf-8"))
            plugin_registry.check_kit_skills(cfg.get("skills") or [], role_id, KIT)


SYSTEM = ["approval", "artifact", "deliverable", "flow", "kanban"]
CLIENT = ["invoices-to-data", "transcribe"]


class TheKitsOwnRegistry(unittest.TestCase):
    """The five system plugins of phase 2, the two pilots of phase 1, and the
    flattening the rest of the kit relies on."""

    def test_the_registry_is_the_five_defaults_plus_the_two_pilots(self):
        plugins = plugin_registry.registry(KIT)
        self.assertEqual(sorted(plugins), sorted(SYSTEM + CLIENT))
        for pid in SYSTEM:
            self.assertTrue(plugins[pid]["system"], pid)
        for pid in CLIENT:
            self.assertFalse(plugins[pid]["system"], pid)
            self.assertEqual(plugins[pid]["surfaces"], {"skills": [pid]})
            self.assertEqual(plugins[pid]["requires"], {})

    def test_the_system_graph_is_the_one_the_plan_drew(self):
        """kanban is the root and everything else hangs off it."""
        plugins = plugin_registry.registry(KIT)
        needs = {pid: plugins[pid]["requires"].get("plugins", []) for pid in SYSTEM}
        self.assertEqual(needs, {
            "kanban": [],
            "approval": ["kanban"],
            "deliverable": ["kanban"],
            "artifact": ["kanban"],
            "flow": ["kanban", "approval"],
        })

    def test_flow_carries_the_promises_guard_as_its_engine_surface(self):
        """The one engine surface in the kit, and where it lands is not here.

        `plugins/flow/engine/promises/` is the SOURCE (phase 3b); install.sh
        copies it to the agent's `policy/plugins/promises/`, which is what the
        compose mounts at /opt/data/plugins. The kit's job is that the folder is
        a plugin the engine can actually load.
        """
        flow = plugin_registry.registry(KIT)["flow"]
        self.assertEqual(flow["surfaces"]["engine"], "engine/promises")
        surface = KIT / "plugins" / "flow" / "engine" / "promises"
        self.assertTrue((surface / "plugin.yaml").is_file())
        self.assertTrue((surface / "promises.py").is_file())
        self.assertTrue((surface / "__init__.py").is_file())

    def test_kanban_carries_no_skill_and_says_why(self):
        """The store is the engine's; the manifest exists for the dependency."""
        kanban = plugin_registry.registry(KIT)["kanban"]
        self.assertNotIn("skills", kanban["surfaces"])
        self.assertEqual(kanban["surfaces"]["tab"], {"builtin": "pipeline"})
        self.assertTrue(kanban["_comment"])

    def test_every_system_plugin_names_a_portal_page_that_already_exists(self):
        plugins = plugin_registry.registry(KIT)
        self.assertEqual({pid: plugins[pid]["surfaces"]["tab"] for pid in SYSTEM}, {
            "kanban": {"builtin": "pipeline"},
            "approval": {"builtin": "approvals"},
            "deliverable": {"builtin": "files"},
            "artifact": {"builtin": "artifacts"},
            "flow": {"builtin": "flows"},
        })

    def test_their_skills_resolve_to_the_directory_that_holds_the_skill_md(self):
        sources = plugin_registry.skill_sources(KIT)
        # kanban is the one with nothing to ship.
        self.assertEqual(sorted(sources), sorted(set(SYSTEM + CLIENT) - {"kanban"}))
        for name, where in sources.items():
            self.assertEqual(where, KIT / "plugins" / name / "skills" / name)
            self.assertTrue((where / "SKILL.md").is_file())

    def test_the_flattened_layout_still_has_one_directory_per_skill(self):
        """What install.sh and build_role.py copy: name -> one source, no plugins."""
        sys.path.insert(0, str(KIT / "roles"))
        import skills_split
        dirs = skills_split.skill_dirs()
        self.assertEqual(dirs["transcribe"], KIT / "plugins/transcribe/skills/transcribe")
        self.assertEqual(dirs["approval"], KIT / "plugins/approval/skills/approval")
        self.assertEqual(dirs["capability"], KIT / "skills/capability")
        self.assertEqual(len(dirs), len(set(dirs)))


class FlattenedRoleJson(unittest.TestCase):
    """What the distribution's role.json says vs what its skills/ holds.

    Nothing on the agent knows what a plugin is until phase 3, so
    `roles/build_role.py` folds the resolved plugins back into `skills`. The two
    have to agree: a manifest that lists fewer skills than the directory holds
    is an agent whose role.json stopped describing it, and the build said
    nothing.

    AND THE LIST IS SORTED. Before phase 2 its order was wherever each name
    happened to be written, so moving a skill into a plugin re-ordered it and
    every future move would read as a change to the distribution. Nothing
    consumes the order, so it is canonical.
    """

    def setUp(self):
        sys.path.insert(0, str(KIT / "roles"))
        import build_role
        self.build_role = build_role

    def flatten(self, cfg, sources):
        with tempfile.TemporaryDirectory() as tmp:
            role_dir, dest = Path(tmp) / "role", Path(tmp) / "dist"
            role_dir.mkdir()
            dest.mkdir()
            (role_dir / "role.json").write_text(
                json.dumps(cfg, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            self.build_role.write_role_json(
                role_dir, dest, {name: Path(tmp) / name for name in sources})
            return json.loads((dest / "role.json").read_text(encoding="utf-8"))

    def test_a_role_with_no_plugins_travels_untouched(self):
        cfg = {"id": "sales", "skills": ["approval"]}
        self.assertEqual(self.flatten(cfg, ["approval"]), cfg)

    def test_the_plugins_key_never_reaches_the_agent(self):
        flat = self.flatten(
            {"id": "accounting", "skills": ["quotes"], "plugins": ["invoices-to-data"]},
            ["invoices-to-data", "quotes"])
        self.assertNotIn("plugins", flat)
        self.assertEqual(flat["skills"], ["invoices-to-data", "quotes"])

    def test_the_flattened_list_is_sorted_whoever_ships_each_skill(self):
        """Resolution order is plugins first; what SHIPS is alphabetical."""
        flat = self.flatten(
            {"id": "marketing", "skills": ["brand-kit", "capability"],
             "plugins": ["deliverable", "approval"]},
            ["deliverable", "approval", "brand-kit", "capability"])
        self.assertEqual(flat["skills"],
                         ["approval", "brand-kit", "capability", "deliverable"])

    def test_a_role_whose_skills_all_come_from_plugins_still_lists_them(self):
        """No `skills` key to fold into is not a reason to ship none."""
        flat = self.flatten(
            {"id": "accounting", "plugins": ["invoices-to-data"]}, ["invoices-to-data"])
        self.assertNotIn("plugins", flat)
        self.assertEqual(flat["skills"], ["invoices-to-data"])


if __name__ == "__main__":
    unittest.main()
