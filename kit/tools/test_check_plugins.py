"""What a broken plugin registry has to do: stop, and say which manifest.

Run from the monorepo root:
    python3 -m unittest discover -s kit/tools -p "test_*.py"

Every failure case is a whole fixture registry in a tempdir, checked through
the command line the way an operator runs it, because the exit code and the
message ARE the feature: `install.sh` stops on this, and the person reading the
output has to know which file to open.

The classes after `BrokenRegistry` go at the resolver directly
(`plugin_registry`), which is where the SALES layer meets it — the registry can
be perfect and `capabilities/catalog.json` still sell a plugin that is not
there, name a plugin's skill under `kit_skills`, or sell a row whose plugin
needs one nothing else installs.
"""
import json
import shutil
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


def flow(where, rel):
    """One curated flow inside a plugin: the directory and its FLOW.md."""
    directory = Path(where) / rel
    directory.mkdir(parents=True)
    (directory / "FLOW.md").write_text(
        f"---\nname: {directory.name}\nstatus: active\n---\n", encoding="utf-8")
    return directory


def kit_skill(root, name):
    skill = Path(root) / "skills" / name
    skill.mkdir(parents=True)
    (skill / "SKILL.md").write_text(f"---\nname: {name}\n---\n", encoding="utf-8")


def capabilities(root, *entries):
    """A `capabilities/catalog.json` with those rows and nothing else."""
    where = Path(root) / "capabilities"
    where.mkdir(parents=True, exist_ok=True)
    (where / "catalog.json").write_text(
        json.dumps({"version": 2, "capabilities": list(entries)}, ensure_ascii=False),
        encoding="utf-8")


def connections(root, *ids):
    """A `connections/catalog.json` offering those connections and no others."""
    where = Path(root) / "connections"
    where.mkdir(parents=True, exist_ok=True)
    (where / "catalog.json").write_text(
        json.dumps({"version": 1, "connections": [{"id": i} for i in ids]},
                   ensure_ascii=False),
        encoding="utf-8")


def base_config(root, **platforms):
    """A `compose/config.base.yaml` whose `platform_toolsets` says exactly this."""
    where = Path(root) / "compose"
    where.mkdir(parents=True, exist_ok=True)
    lines = ["platform_toolsets:"]
    for platform, toolsets in platforms.items():
        lines.append(f"  {platform}:")
        lines.extend(f"    - {name}" for name in toolsets)
    (where / "config.base.yaml").write_text("\n".join(lines) + "\n", encoding="utf-8")


def check(root):
    # `--root` means ANOTHER COPY OF THE KIT, and a kit has a capabilities
    # catalog, a connections catalog and a base config: the command checks the
    # sales layer and the two `requires` lists that are not plugins against
    # those three, so a fixture missing one is not a kit and would fail for the
    # wrong reason. A fixture that wrote its own is left alone -- that is the
    # case under test.
    if not (Path(root) / "capabilities" / "catalog.json").is_file():
        capabilities(root)
    if not (Path(root) / "connections" / "catalog.json").is_file():
        connections(root)
    if not (Path(root) / "compose" / "config.base.yaml").is_file():
        base_config(root, api_server=[])
    out = subprocess.run(
        [sys.executable, str(CHECK), "--root", str(root)],
        capture_output=True, text=True,
    )
    return out.returncode, out.stdout + out.stderr


class TheSalesLayerPointsAtTheRightHome(unittest.TestCase):
    """`installs` names a plugin when the thing lives in a plugin.

    THE ONE THAT CAN DO REAL DAMAGE. `tools/plugin_set.py` reads
    `installs.plugins` off the `level: base` rows to decide what ships on EVERY
    agent, so a base row naming the wrong key promises a capability as already
    installed ("ya viene puesta") that the installer never copies. It used to
    work by accident: the plugin was inferred from the skill name, which is only
    right while every plugin's id equals its skill's.
    """

    def test_kit_skills_naming_a_plugin_owned_skill_stops_it(self):
        with tempfile.TemporaryDirectory() as tmp:
            write(tmp, "transcribe", manifest("transcribe"))
            capabilities(tmp, {"id": "transcription", "level": "base",
                               "installs": {"kit_skills": ["transcribe"]}})
            with self.assertRaises(SystemExit) as raised:
                plugin_registry.check_capability_installs(Path(tmp))
            message = str(raised.exception)
            self.assertIn("transcription", message)
            self.assertIn("plugins/transcribe/", message)
            self.assertIn("installs.plugins", message)

    def test_plugins_naming_something_nobody_wrote_stops_it(self):
        with tempfile.TemporaryDirectory() as tmp:
            write(tmp, "transcribe", manifest("transcribe"))
            capabilities(tmp, {"id": "webscraping", "level": "menu",
                               "installs": {"plugins": ["scraper"]}})
            with self.assertRaises(SystemExit) as raised:
                plugin_registry.check_capability_installs(Path(tmp))
            message = str(raised.exception)
            self.assertIn("webscraping", message)
            self.assertIn("'scraper'", message)
            self.assertIn("not in the registry", message)

    def test_a_kit_skill_that_is_still_a_kit_skill_is_fine(self):
        with tempfile.TemporaryDirectory() as tmp:
            write(tmp, "transcribe", manifest("transcribe"))
            kit_skill(tmp, "social-formats")
            capabilities(tmp, {"id": "social-package", "level": "menu",
                               "installs": {"plugins": ["transcribe"],
                                            "kit_skills": ["social-formats"]}})
            plugin_registry.check_capability_installs(Path(tmp))

    def test_check_plugins_reports_it_and_exits_one(self):
        """The registry check is where a drifted catalog gets caught."""
        with tempfile.TemporaryDirectory() as tmp:
            write(tmp, "quotes", manifest("quotes"))
            capabilities(tmp, {"id": "quotes", "level": "menu",
                               "installs": {"kit_skills": ["quotes"]}})
            code, out = check(tmp)
            self.assertEqual(code, 1, out)
            self.assertIn("FAIL", out)
            self.assertIn("plugins/quotes/", out)

    def test_a_base_row_naming_a_kit_skill_nobody_wrote_stops_it(self):
        """"Ya viene puesta" about a directory that is not there."""
        with tempfile.TemporaryDirectory() as tmp:
            write(tmp, "transcribe", manifest("transcribe"))
            capabilities(tmp, {"id": "meeting-summaries", "level": "base",
                               "installs": {"kit_skills": ["meeting-summaries"]}})
            with self.assertRaises(SystemExit) as raised:
                plugin_registry.check_capability_installs(Path(tmp))
            message = str(raised.exception)
            self.assertIn("meeting-summaries", message)
            self.assertIn("level: base", message)

    def test_a_menu_row_may_name_one_and_most_of_them_do(self):
        """The menu is what we sell; the work starts when a client buys it."""
        with tempfile.TemporaryDirectory() as tmp:
            write(tmp, "transcribe", manifest("transcribe"))
            capabilities(tmp, {"id": "meeting-summaries", "level": "menu",
                               "installs": {"kit_skills": ["meeting-summaries"]}})
            plugin_registry.check_capability_installs(Path(tmp))

    def test_a_base_row_whose_kit_skill_is_written_passes(self):
        with tempfile.TemporaryDirectory() as tmp:
            write(tmp, "transcribe", manifest("transcribe"))
            kit_skill(tmp, "meeting-summaries")
            capabilities(tmp, {"id": "meeting-summaries", "level": "base",
                               "installs": {"kit_skills": ["meeting-summaries"]}})
            plugin_registry.check_capability_installs(Path(tmp))

    def test_the_kits_own_catalog_passes(self):
        plugin_registry.check_capability_installs(KIT)

    def test_every_base_row_installs_a_plugin_that_is_really_there(self):
        """What `tools/plugin_set.py` puts on every agent, read the same way."""
        available = plugin_registry.registry(KIT)
        installs = plugin_registry.capability_installs(KIT)
        catalog = json.loads(
            (KIT / "capabilities" / "catalog.json").read_text(encoding="utf-8"))
        base = [c["id"] for c in catalog["capabilities"] if c.get("level") == "base"]
        promised = {p for cid in base for p in installs[cid].get("plugins") or []}
        self.assertEqual(promised, {"transcribe"})
        for pid in promised:
            self.assertIn(pid, available)


class ABaseRowPromisesSomethingThatExists(unittest.TestCase):
    """A `level: base` capability whose kit skill nobody wrote.

    THE GAP THIS CLOSES. The rule lived in
    `roles/skills_split.base_capability_skills`, which only a TEAM agent ever
    reached: a solo agent got every skill in the kit and never computed a split.
    So the same catalog stopped a team install with "nowhere in the kit" and
    installed on a solo agent with rc=0 and no mention of it -- the client reads
    "ya viene puesta: no hay que pedirla" on a card behind which there is
    nothing at all.

    The rule is `plugin_registry.check_capability_installs` now, which
    `install.sh` reaches on EVERY agent through `tools/plugin_set.py` -- and
    since the pivot there is only the one path. This runs it over a copy of the
    kit with one menu row promoted: the measured repro.
    """

    # A menu row whose `installs.kit_skills` names a skill nobody has written.
    # Most menu rows are like this on purpose: the menu is what we SELL, and the
    # work starts when a client buys one.
    UNWRITTEN = "meeting-summaries"

    def kit_copy(self, tmp, promote=None):
        root = Path(tmp) / "kit"
        shutil.copytree(KIT, root, ignore=shutil.ignore_patterns(
            "node_modules", "__pycache__", "dist", ".git"))
        (Path(tmp) / "data").mkdir()
        if promote:
            catalog = root / "capabilities" / "catalog.json"
            data = json.loads(catalog.read_text(encoding="utf-8"))
            for row in data["capabilities"]:
                if row["id"] == promote:
                    row["level"] = "base"
            catalog.write_text(
                json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        return root

    def solo(self, tmp, root):
        """What install.sh asks on EVERY agent."""
        out = subprocess.run(
            [sys.executable, str(root / "tools" / "plugin_set.py"), str(Path(tmp) / "data")],
            capture_output=True, text=True)
        return out.returncode, out.stdout + out.stderr

    def test_the_install_refuses_and_names_the_row(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = self.kit_copy(tmp, promote=self.UNWRITTEN)
            code, out = self.solo(tmp, root)
        self.assertEqual(code, 1, out)
        self.assertIn(f"capability '{self.UNWRITTEN}'", out)
        self.assertIn("level: base", out)

    def test_the_same_row_on_the_menu_installs(self):
        """`base` is the word that turns a row into a promise. `menu` is a plan."""
        with tempfile.TemporaryDirectory() as tmp:
            root = self.kit_copy(tmp)
            code, out = self.solo(tmp, root)
        self.assertEqual(code, 0, out)


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
            # The toolset it asks for has to be one the kit turns on somewhere,
            # which is what `check_requires` crosses.
            base_config(tmp, api_server=["code_execution"])
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

    def test_a_core_surface_that_is_a_file_and_not_a_folder(self):
        """The engine imports a DIRECTORY's plugin.py and the siblings next to it."""
        with tempfile.TemporaryDirectory() as tmp:
            where = write(tmp, "alpha", manifest(
                "alpha", surfaces={"skills": ["alpha"], "core": "plugin.py"}),
                skills=["alpha"])
            (where / "plugin.py").write_text("def register(engine): pass\n", encoding="utf-8")
            self.fails_with(tmp, "which is not a directory")

    def test_a_core_surface_with_no_plugin_py(self):
        """Nothing to import means nothing registers: no toolset, no router, no
        prose, and a manifest claiming the plugin works on that engine."""
        with tempfile.TemporaryDirectory() as tmp:
            where = write(tmp, "alpha", manifest(
                "alpha", surfaces={"skills": ["alpha"], "core": "core/"}),
                skills=["alpha"])
            (where / "core").mkdir()
            (where / "core" / "instructions.md").write_text("Nada.\n", encoding="utf-8")
            self.fails_with(tmp, "has no plugin.py")

    def test_a_core_surface_that_is_there_passes(self):
        with tempfile.TemporaryDirectory() as tmp:
            where = write(tmp, "alpha", manifest(
                "alpha", surfaces={"skills": ["alpha"], "core": "core/"}),
                skills=["alpha"])
            (where / "core").mkdir()
            (where / "core" / "plugin.py").write_text(
                "def register(engine): pass\n", encoding="utf-8")
            plugins = plugin_registry.registry(Path(tmp))
            self.assertEqual(plugins["alpha"]["surfaces"]["core"], "core/")

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

    def test_a_flows_surface_with_no_flow_md(self):
        with tempfile.TemporaryDirectory() as tmp:
            where = write(tmp, "alpha", manifest(
                "alpha", surfaces={"skills": ["alpha"], "flows": ["flows/uno"]}))
            (where / "flows" / "uno").mkdir(parents=True)
            self.fails_with(tmp, "declares 'flows/uno' but there is no "
                                 "flows/uno/FLOW.md")

    def test_a_flows_surface_that_is_not_a_list(self):
        with tempfile.TemporaryDirectory() as tmp:
            write(tmp, "alpha", manifest(
                "alpha", surfaces={"skills": ["alpha"], "flows": "flows/uno"}))
            self.fails_with(tmp, "surfaces.flows must be a list of directories")

    def test_a_flow_directory_the_portal_could_not_draw(self):
        """The slug is the adapter's shape: what it cannot match, it skips."""
        with tempfile.TemporaryDirectory() as tmp:
            where = write(tmp, "alpha", manifest(
                "alpha", surfaces={"skills": ["alpha"], "flows": ["flows/Un Flujo"]}))
            flow(where, "flows/Un Flujo")
            self.fails_with(tmp, "is not a flow slug")

    def test_two_plugins_claiming_one_slug(self):
        """They install into one directory: one of them would silently win."""
        with tempfile.TemporaryDirectory() as tmp:
            for pid in ("alpha", "beta"):
                where = write(tmp, pid, manifest(
                    pid, surfaces={"skills": [pid], "flows": ["flows/presupuesto-nuevo"]}))
                flow(where, "flows/presupuesto-nuevo")
            self.fails_with(tmp, "flow 'presupuesto-nuevo' also ships as")


class TheFlowsSurface(unittest.TestCase):
    """A curated flow belongs to a plugin, and reaches the agents that have it.

    It used to belong to a ROLE — `roles/<id>/flows/`, packed into the profile
    distribution — because a role was what a client hired. With one agent per
    client the owner is the plugin whose work the flow is, and `flow_sources`
    is what `install.sh` asks so a flow about quotes never lands on an agent
    whose client did not buy them.
    """

    def test_the_whole_registry_by_slug(self):
        with tempfile.TemporaryDirectory() as tmp:
            where = write(tmp, "alpha", manifest(
                "alpha", surfaces={"skills": ["alpha"],
                                   "flows": ["flows/uno", "curated/dos"]}))
            flow(where, "flows/uno")
            flow(where, "curated/dos")
            got = plugin_registry.flow_sources(None, Path(tmp))
            self.assertEqual(sorted(got), ["dos", "uno"])
            self.assertTrue(got["uno"].joinpath("FLOW.md").is_file())

    def test_only_the_plugins_asked_for(self):
        with tempfile.TemporaryDirectory() as tmp:
            for pid, slug in (("alpha", "uno"), ("beta", "dos")):
                where = write(tmp, pid, manifest(
                    pid, surfaces={"skills": [pid], "flows": [f"flows/{slug}"]}))
                flow(where, f"flows/{slug}")
            self.assertEqual(sorted(plugin_registry.flow_sources(["alpha"], Path(tmp))),
                             ["uno"])

    def test_a_plugin_with_no_flows_contributes_none(self):
        with tempfile.TemporaryDirectory() as tmp:
            write(tmp, "alpha", manifest("alpha"))
            self.assertEqual(plugin_registry.flow_sources(["alpha"], Path(tmp)), {})

    def test_the_kits_eighteen_curated_flows_all_have_an_owner(self):
        """The real files: every FLOW.md under plugins/ is declared by one.

        A FLOW.md sitting in a plugin that does not declare it is a flow nobody
        installs — which is exactly how the four that moved out of `support`
        would have been lost.
        """
        declared = plugin_registry.flow_sources(None, KIT)
        on_disk = sorted(p.parent for p in KIT.glob("plugins/*/*/*/FLOW.md"))
        self.assertEqual(sorted(declared.values()), on_disk)
        self.assertEqual(len(declared), 18)

    def test_each_of_them_carries_the_frontmatter_the_portal_reads(self):
        """`name` and `trigger_type` are what the Flows page draws the card from."""
        for slug, directory in plugin_registry.flow_sources(None, KIT).items():
            with self.subTest(flow=slug):
                text = (directory / "FLOW.md").read_text(encoding="utf-8")
                self.assertTrue(text.startswith("---\n"), slug)
                head = text.split("---", 2)[1]
                for key in ("name:", "client_summary:", "trigger_type:", "status:"):
                    self.assertIn(key, head, slug)


class ACapabilityInstallsAClosedSet(unittest.TestCase):
    """A row is what a client buys ON ITS OWN, so a row has to be closed.

    THE RULE MOVED HERE FROM THE ROLE. `plugin_registry.role_skills` asked it of
    `roles/<id>/role.json` — a role that declares a plugin declares its
    non-system dependencies too — and a role is not what anybody buys any more.
    The capability is, and it is the only declaration left.

    Caught here and not at install time on purpose: `tools/plugin_set.py` also
    refuses an open set, but it refuses it on the CLIENT'S agent, naming a
    catalog the operator standing there cannot fix.
    """

    def catalog(self, tmp, *rows):
        capabilities(tmp, *rows)
        return Path(tmp)

    def test_a_dependency_no_row_installs_stops_it(self):
        with tempfile.TemporaryDirectory() as tmp:
            write(tmp, "post-image", manifest(
                "post-image", requires={"plugins": ["brand-kit"]}))
            write(tmp, "brand-kit", manifest("brand-kit"))
            root = self.catalog(tmp, {"id": "social-package", "level": "menu",
                                      "installs": {"plugins": ["post-image"]}})
            with self.assertRaises(SystemExit) as raised:
                plugin_registry.check_capability_installs(root)
            message = str(raised.exception)
            self.assertIn("social-package", message)
            self.assertIn("post-image", message)
            self.assertIn("brand-kit", message)

    def test_the_same_row_declaring_both_is_fine(self):
        with tempfile.TemporaryDirectory() as tmp:
            write(tmp, "post-image", manifest(
                "post-image", requires={"plugins": ["brand-kit"]}))
            write(tmp, "brand-kit", manifest("brand-kit"))
            plugin_registry.check_capability_installs(self.catalog(
                tmp, {"id": "social-package", "level": "menu",
                      "installs": {"plugins": ["post-image", "brand-kit"]}}))

    def test_a_system_dependency_needs_no_declaring(self):
        """A default is on every agent, so leaning on one is free."""
        with tempfile.TemporaryDirectory() as tmp:
            write(tmp, "quotes", manifest(
                "quotes", requires={"plugins": ["deliverable"]}))
            write(tmp, "deliverable", manifest("deliverable", system=True))
            plugin_registry.check_capability_installs(self.catalog(
                tmp, {"id": "quotes", "level": "menu",
                      "installs": {"plugins": ["quotes"]}}))

    def test_a_base_capabilitys_plugin_needs_no_declaring_either(self):
        """`level: base` is on every agent too, and the rule has to know it.

        `tools/plugin_set.py` adds what a base row installs unconditionally, next
        to the system plugins, so a menu row leaning on one is not selling a
        client something with nothing behind it. Before this, `interview-production`
        -- which runs `transcribe.py` by path -- was refused, and the message told
        the author to add `transcribe` to `installs.plugins`: that "fix" writes a
        purchase for something nobody buys, and the same client's plugin_set would
        then report it as bought AND included.
        """
        with tempfile.TemporaryDirectory() as tmp:
            write(tmp, "interview-production", manifest(
                "interview-production", requires={"plugins": ["transcribe"]}))
            write(tmp, "transcribe", manifest("transcribe"))
            plugin_registry.check_capability_installs(self.catalog(
                tmp,
                {"id": "transcription", "level": "base",
                 "installs": {"plugins": ["transcribe"]}},
                {"id": "interview-production", "level": "menu",
                 "installs": {"plugins": ["interview-production"]}}))

    def test_and_a_menu_row_is_not_a_base_row(self):
        """The exemption is the word `base` and nothing else.

        Same two plugins, same two rows, and `transcription` demoted to menu: now
        a client can buy the interview row and not the other one, so the set is
        open and this has to stop.
        """
        with tempfile.TemporaryDirectory() as tmp:
            write(tmp, "interview-production", manifest(
                "interview-production", requires={"plugins": ["transcribe"]}))
            write(tmp, "transcribe", manifest("transcribe"))
            root = self.catalog(
                tmp,
                {"id": "transcription", "level": "menu",
                 "installs": {"plugins": ["transcribe"]}},
                {"id": "interview-production", "level": "menu",
                 "installs": {"plugins": ["interview-production"]}})
            with self.assertRaises(SystemExit) as raised:
                plugin_registry.check_capability_installs(root)
            self.assertIn("transcribe", str(raised.exception))

    def test_another_row_installing_it_is_not_enough(self):
        """Two rows are two purchases, and a client may make only one."""
        with tempfile.TemporaryDirectory() as tmp:
            write(tmp, "post-image", manifest(
                "post-image", requires={"plugins": ["brand-kit"]}))
            write(tmp, "brand-kit", manifest("brand-kit"))
            root = self.catalog(
                tmp,
                {"id": "images", "level": "menu", "installs": {"plugins": ["post-image"]}},
                {"id": "branding", "level": "menu", "installs": {"plugins": ["brand-kit"]}})
            with self.assertRaises(SystemExit) as raised:
                plugin_registry.check_capability_installs(root)
            self.assertIn("images", str(raised.exception))

    def test_the_kits_own_catalog_is_closed(self):
        """Over the real rows: every menu row can be bought on its own."""
        plugin_registry.check_capability_installs(KIT)


class TheRequiresThatAreNotPlugins(unittest.TestCase):
    """A toolset is the engine's word and a connection is `connections/`'s.

    THE RULE MOVED OUT OF THIS FILE AND INTO THE COMMAND, which is why these
    tests run the command. It used to live here and only here: the connection
    half was crossed against `connections/catalog.json` and the toolset half
    against a literal three lines above it, under a comment naming
    `compose/config.base.yaml` (c92ad0b). A test is not a validator -- nobody
    runs the suite before hiring a role -- and `plugin_registry` cannot take the
    rule either, because it also runs at BOOT, over `/opt`, where neither file
    exists. `check-plugins.py` is the half that knows it stands in the repo.
    """

    def bench(self, tmp, **over):
        """A fixture kit whose registry is one plugin with the given `requires`."""
        write(tmp, "scraper", manifest("scraper", requires=over))
        connections(tmp, "google-workspace", "slack")
        base_config(tmp, api_server=["image_gen", "vision", "web"],
                    telegram=["image_gen", "vision", "web"])
        return check(tmp)

    def test_a_connection_nobody_wrote_stops_it(self):
        with tempfile.TemporaryDirectory() as tmp:
            code, out = self.bench(tmp, connections=["gmail"])
        self.assertEqual(code, 1, out)
        self.assertIn("plugins/scraper/plugin.json", out)
        self.assertIn("'gmail'", out)
        self.assertIn("connections/catalog.json", out)

    def test_a_toolset_no_platform_turns_on_stops_it(self):
        with tempfile.TemporaryDirectory() as tmp:
            code, out = self.bench(tmp, toolsets=["imagegen"])
        self.assertEqual(code, 1, out)
        self.assertIn("plugins/scraper/plugin.json", out)
        self.assertIn("'imagegen'", out)
        self.assertIn("compose/config.base.yaml", out)

    def test_a_toolset_the_kit_deliberately_switches_off_stops_it_too(self):
        """`tts` is in `agent.disabled_toolsets`, never in `platform_toolsets`.

        Requiring one of those is requiring something this product turns off on
        purpose, which is a refusal and not a pass -- so the scan reads the
        `platform_toolsets` block and nothing else.
        """
        with tempfile.TemporaryDirectory() as tmp:
            base_config(tmp, api_server=["web"])
            (Path(tmp) / "compose" / "config.base.yaml").write_text(
                "agent:\n  disabled_toolsets:\n    - tts\n"
                "platform_toolsets:\n  api_server:\n    - web\n", encoding="utf-8")
            write(tmp, "scraper", manifest("scraper", requires={"toolsets": ["tts"]}))
            connections(tmp)
            code, out = check(tmp)
        self.assertEqual(code, 1, out)
        self.assertIn("'tts'", out)

    def test_ids_that_exist_pass(self):
        with tempfile.TemporaryDirectory() as tmp:
            code, out = self.bench(
                tmp, connections=["slack"], toolsets=["vision", "web"])
        self.assertEqual(code, 0, out)

    def test_every_bad_id_is_printed_and_not_only_the_first(self):
        with tempfile.TemporaryDirectory() as tmp:
            code, out = self.bench(
                tmp, connections=["gmail"], toolsets=["imagegen"])
        self.assertEqual(code, 1, out)
        self.assertIn("'gmail'", out)
        self.assertIn("'imagegen'", out)

    def test_a_kit_with_no_connections_catalog_is_a_refusal(self):
        """Not "nothing to check": the catalog is part of the kit."""
        with tempfile.TemporaryDirectory() as tmp:
            write(tmp, "scraper", manifest("scraper",
                                           requires={"connections": ["slack"]}))
            base_config(tmp, api_server=["web"])
            code, out = check(tmp)
        self.assertEqual(code, 1, out)
        self.assertIn("connections/catalog.json", out)

    def test_the_kits_own_registry_passes_the_cross(self):
        """The sweep is over the WHOLE registry, run the way an operator runs it."""
        code, out = check(KIT)
        self.assertEqual(code, 0, out)
        self.assertIn("requires.connections and requires.toolsets name ids that exist",
                      out)


SYSTEM = ["approval", "artifact", "capability", "deliverable", "flow", "kanban"]
# The PORTED ones: a skill that already lived in `skills/` and got a manifest.
# Their shape is the packaging shape -- one skill, named after the plugin.
PORTED = ["brand-kit", "drive-inbox", "invoices-to-data", "post-image",
          "quotes", "social-content", "transcribe"]
# WRITTEN AS PLUGINS, WHICH IS THE OTHER HALF AND IT STARTS HERE. A plugin
# commissioned by a client is not a port: `interview-production` carries TWO
# skills and neither is called after it, because the unit is the WORK (an
# interview becoming what goes on air) and the crafts inside it have their own
# names. The registry always allowed this; until 2026-08-30 nothing used it, and
# these lists are what say which shape a given plugin is claiming.
WRITTEN = ["interview-production"]
CLIENT = sorted(PORTED + WRITTEN)
# THE THIRD SHAPE: a plugin of OUR ENGINE and of nothing else. Each one carries
# `core/` and no skills surface, because what it installs is a capability of
# `engine` — a Hermes agent has the engine's own memory, has nowhere to mount an
# `ImageGeneration`, and never opens either folder. They are `system: false` and
# no capability row installs them, which for any other client plugin would be
# the drive-inbox mistake; here it is the honest state, because `CORE_PLUGINS`
# is what decides that they run and `purchased.json` has nothing to say about
# it. `image` gets its row with the social capability that sells the pictures
# (docs/own-agent-plan.md, wave 3).
CORE_ONLY = ["image", "memory"]


class TheKitsOwnRegistry(unittest.TestCase):
    """The five system plugins of phase 2, every ported skill, and the
    flattening the rest of the kit relies on."""

    def test_the_registry_is_the_five_defaults_plus_every_ported_skill(self):
        plugins = plugin_registry.registry(KIT)
        self.assertEqual(sorted(plugins), sorted(SYSTEM + CLIENT + CORE_ONLY))
        for pid in SYSTEM:
            self.assertTrue(plugins[pid]["system"], pid)
        # A PLUGIN OF engine CARRIES `core/` AND NOTHING ELSE. The day one of
        # these grows a skills surface it stops being this shape: the skill
        # would be indexed on every Hermes agent that installs the folder, and
        # nothing on a Hermes agent can run it.
        for pid in CORE_ONLY:
            self.assertFalse(plugins[pid]["system"], pid)
            self.assertEqual(sorted(plugins[pid]["surfaces"]), ["core"], pid)
        for pid in CLIENT:
            self.assertFalse(plugins[pid]["system"], pid)
            # A client plugin carries its skills surface, the curated flows that
            # are its own work, AND NOTHING ELSE: no tab, no adapter, no service.
            # The day one of these grows a surface the portal has to draw, that
            # is a decision and this line is where it gets made.
            self.assertEqual(sorted(plugins[pid]["surfaces"]),
                             ["flows", "skills"] if plugins[pid]["surfaces"].get("flows")
                             else ["skills"], pid)
        # A PORT IS ONE SKILL WITH THE PLUGIN'S NAME, because that is what it was
        # before it had a manifest: `skills/transcribe/` became
        # `plugins/transcribe/skills/transcribe/` and every path in its SKILL.md
        # stayed true.
        for pid in PORTED:
            self.assertEqual(plugins[pid]["surfaces"]["skills"], [pid], pid)
        # A PLUGIN WRITTEN AS A PLUGIN NAMES ITS CRAFTS, and the slot rule is
        # what keeps that honest: whatever it calls them, no other plugin and no
        # kit skill may claim the same name (`_check_skill_slots`).
        self.assertEqual(plugins["interview-production"]["surfaces"]["skills"],
                         ["lower-thirds", "news-copy"])

    def test_the_client_graph_is_what_each_SKILL_md_actually_asks_for(self):
        """Written down whole, because `requires` is a claim about a text.

        Each entry below is a sentence in that plugin's SKILL.md, and the point
        of asserting the WHOLE map is that adding a dependency to a manifest
        without one fails here:

          quotes         runs `/opt/kit/skills/deliverable/deliver.py` by path,
                         and «eso pasa por la skill `approval`» for sending it
          brand-kit      pipes `render_kit.py` into artifact's
                         `create_artifact.py`, and a colour change «va como
                         pedido de aprobación»
          social-content «Sin kit de marca no se escribe» -- `new_post.py` stops
                         with `missing_kit` and names brand-kit in `next_steps`
          post-image     «Sin `brand.json` corta y te da la pregunta para
                         ofrecerle armar el kit»
          drive-inbox    nothing: transcribing after the download is «el caso
                         típico», and what follows «depende del flujo del cliente»
          interview-production
                         runs `/opt/kit/skills/transcribe/transcribe.py` by path
                         («nunca con los subtítulos automáticos»), saves both
                         documents with `deliverable`, and «te pido el sí sobre
                         la lista antes de que vaya a la edición» is `approval`
          transcribe,
          invoices-to-data
                         leaves, and they were leaves as pilots too
        """
        plugins = plugin_registry.registry(KIT)
        needs = {pid: plugins[pid]["requires"].get("plugins", []) for pid in CLIENT}
        self.assertEqual(needs, {
            "brand-kit": ["artifact", "approval"],
            "drive-inbox": [],
            "interview-production": ["transcribe", "deliverable", "approval"],
            "invoices-to-data": [],
            "post-image": ["brand-kit"],
            "quotes": ["deliverable", "approval"],
            "social-content": ["brand-kit"],
            "transcribe": [],
        })

    def test_what_the_two_non_plugin_requires_claim(self):
        """The ids themselves, pinned. That they EXIST is the command's job.

        `TheRequiresThatAreNotPlugins` runs `check-plugins.py` over the whole
        registry; what is left here is what these two manifests mean, which no
        cross-check can say.
        """
        plugins = plugin_registry.registry(KIT)
        # `image_gen` is step 2 of post-image and `vision` is step 4, the one
        # that looks at what came out. `image_generate` is the TOOL; the toolset
        # is what compose/config.base.yaml lists.
        self.assertEqual(plugins["post-image"]["requires"]["toolsets"],
                         ["image_gen", "vision"])
        # watch.py reads /opt/data/google_token.json, which is exactly the file
        # this connection's `detects.files` names. A plugin declares the
        # connection and never owns the credential.
        self.assertEqual(plugins["drive-inbox"]["requires"]["connections"],
                         ["google-workspace"])

    def test_the_system_graph_is_the_one_the_plan_drew(self):
        """kanban is the root of the board half, and capability stands apart.

        The four that write into a TICKET hang off kanban. `capability` does
        not: the ask is a `capability:<id>` mention inside the answer the agent
        is already giving, so nothing is blocked, approved or delivered. It is
        system for the other reason a plugin can be -- it is the product's own
        machinery, and a client plugin has to be able to depend on it.
        """
        plugins = plugin_registry.registry(KIT)
        needs = {pid: plugins[pid]["requires"].get("plugins", []) for pid in SYSTEM}
        self.assertEqual(needs, {
            "kanban": [],
            "approval": ["kanban"],
            "deliverable": ["kanban"],
            "artifact": ["kanban"],
            "flow": ["kanban", "approval"],
            "capability": [],
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

    def test_the_three_plugins_the_core_engine_runs_carry_their_surface(self):
        """`engine` runs `approval,deliverable,flow`, and each brings its own
        mechanics: the gate and its page, the deliverable folders' prose, the
        promises guard. Whatever that engine does about any of the three is in
        the plugin — which is the point: a rule about a mechanism reaches the
        model only where the mechanism is installed."""
        plugins = plugin_registry.registry(KIT)
        for pid in ("approval", "deliverable", "flow"):
            self.assertEqual(plugins[pid]["surfaces"]["core"], "core/", pid)
            surface = KIT / "plugins" / pid / "core"
            self.assertTrue((surface / "plugin.py").is_file(), pid)
            self.assertTrue((surface / "instructions.md").is_file(), pid)

    def test_kanban_carries_no_skill_and_says_why(self):
        """The store is the engine's; the manifest exists for the dependency."""
        kanban = plugin_registry.registry(KIT)["kanban"]
        self.assertNotIn("skills", kanban["surfaces"])
        self.assertEqual(kanban["surfaces"]["tab"], {"builtin": "pipeline"})
        self.assertTrue(kanban["_comment"])

    def test_every_system_plugin_with_a_tab_names_a_page_that_already_exists(self):
        """`builtin` is the only honest tab for a screen written long before
        anybody said the word plugin: a `label` would have phase 6 drawing a
        second Pipeline next to the real one."""
        plugins = plugin_registry.registry(KIT)
        tabs = {pid: plugins[pid]["surfaces"].get("tab") for pid in SYSTEM}
        self.assertEqual(tabs, {
            "kanban": {"builtin": "pipeline"},
            "approval": {"builtin": "approvals"},
            "deliverable": {"builtin": "files"},
            "artifact": {"builtin": "artifacts"},
            "flow": {"builtin": "flows"},
            # THE ONE SYSTEM PLUGIN WITH NO PAGE, and that is the honest answer:
            # there is no Capabilities tab in app/app/ and there should not be
            # one. The card is drawn inline in the chat where the agent said what
            # it could not do, out of a `capability:<id>` mention, and at hire
            # time by lib/hiring.tsx.
            "capability": None,
        })

    def test_their_skills_resolve_to_the_directory_that_holds_the_skill_md(self):
        sources = plugin_registry.skill_sources(KIT)
        # kanban is the one with nothing to ship; interview-production is the
        # first whose skills are not named after it.
        self.assertEqual(
            sorted(sources),
            sorted((set(SYSTEM + PORTED) - {"kanban"}) | {"lower-thirds", "news-copy"}))
        registry = plugin_registry.registry(KIT)
        for name, where in sources.items():
            owner = next(pid for pid, data in registry.items()
                         if name in (data["surfaces"].get("skills") or []))
            self.assertEqual(where, KIT / "plugins" / owner / "skills" / name)
            self.assertTrue((where / "SKILL.md").is_file())

    def test_the_flattened_layout_still_has_one_directory_per_skill(self):
        """What install.sh copies: name -> one source, whoever ships it."""
        import skill_sources
        dirs = skill_sources.skill_dirs()
        self.assertEqual(dirs["transcribe"], KIT / "plugins/transcribe/skills/transcribe")
        self.assertEqual(dirs["approval"], KIT / "plugins/approval/skills/approval")
        self.assertEqual(dirs["capability"],
                         KIT / "plugins/capability/skills/capability")
        self.assertEqual(len(dirs), len(set(dirs)))


if __name__ == "__main__":
    unittest.main()
