#!/usr/bin/env python3
"""Tests for `plugins/flow/skills/flow/create_flow.py`'s `--rearm`.

    python3 -m unittest test_create_flow.py

THE FILE HAD NONE. It is the script that decides whether a client's agent wakes
itself up, and the two bugs fixed in it on 30/8/2026 -- a `drive` trigger armed
with no folders, and re-arming back to `request` leaving the old cron alive --
were both found by running it against an agent, after shipping. Neither could
have survived a test, and there was no test file to put one in. This is it.

They live under `tools/` rather than next to the script because that is where
the kit's suite is discovered from (`python3 -m unittest discover -s
hermes-kit/tools`), and a test nobody runs is not a test. The script is loaded by
path, the way `test_agent_check.py` loads `agent-check.py`.

WHAT IS MOCKED AND WHY. `hermes cron` is the agent's real scheduler; these tests
replace `subprocess.run` so that "the removal failed" is a state we can produce
on purpose. That is the whole point: every one of these failures is invisible
from inside a run that went well.
"""
import importlib.util
import json
import io
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

KIT = Path(__file__).resolve().parent.parent


def load():
    spec = importlib.util.spec_from_file_location(
        "create_flow", KIT / "plugins" / "flow" / "skills" / "flow" / "create_flow.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


create_flow = load()


FRONT = """---
name: Entrevistas TV
client_summary: "Miro tus carpetas y preparo los zócalos."
trigger_type: drive
trigger_detail: Mira tus carpetas de Drive cada 15 minutos
trigger_cron: "*/15 * * * *"
trigger_folders: abc123
trigger_job: deadbeef
skills: drive-inbox,lower-thirds
status: active
---

## Cómo lo trabaja tu agente

1. Bajo el video.

---

Una regla horizontal en el cuerpo, que no es el frontmatter.
"""


def run(binary="/usr/bin/hermes", **runs):
    """Patch `hermes_binary` and `subprocess.run` with a scripted CLI.

    `runs` maps the cron subcommand to (returncode, stdout, stderr).
    """
    default = {"remove": (0, "", ""), "list": (0, "", ""), "create": (0, "", "")}
    default.update(runs)

    def fake(argv, **kwargs):
        sub = argv[2]
        code, out, err = default[sub]
        return SimpleNamespace(returncode=code, stdout=out, stderr=err)

    return (mock.patch.object(create_flow, "hermes_binary", lambda: binary),
            mock.patch.object(create_flow.subprocess, "run", fake))


class DropJob(unittest.TestCase):
    """Removing a cron job, and knowing whether it actually went."""

    def drop(self, **runs):
        a, b = run(**runs)
        with a, b:
            return create_flow.drop_job("deadbeef")

    def test_a_clean_removal_confirmed_against_the_list(self):
        self.assertEqual(self.drop(), ("deadbeef", ""))

    def test_a_non_zero_exit_is_a_problem_even_with_empty_stderr(self):
        """The old check read stderr for the word "error" and called this removed."""
        removed, problem = self.drop(remove=(1, "", ""))
        self.assertEqual(removed, "")
        self.assertIn("código 1", problem)

    def test_a_failure_that_never_says_error_is_still_a_failure(self):
        removed, problem = self.drop(remove=(2, "", "no such job: deadbeef"))
        self.assertEqual(removed, "")
        self.assertIn("no such job", problem)

    def test_a_silent_no_op_is_caught_by_the_list(self):
        """Exit 0, nothing on stderr, and the job is still scheduled."""
        removed, problem = self.drop(list=(0, "deadbeef  flujo-entrevistas-tv", ""))
        self.assertEqual(removed, "")
        self.assertIn("sigue", problem)

    def test_no_cli_is_a_problem_and_not_a_traceback(self):
        """`--rearm --trigger request` never calls `schedule`, which is what used
        to be the only thing checking the binary was there at all."""
        a, b = run(binary=None)
        with a, b:
            removed, problem = create_flow.drop_job("deadbeef")
        self.assertEqual(removed, "")
        self.assertIn("CLI de Hermes", problem)


class RearmBackToRequest(unittest.TestCase):
    """`--rearm --trigger request`: the flow stops waking itself up.

    The bug 8e33528 fixed was the removal being guarded on there being a NEW
    job, so this direction dropped `trigger_job` from the frontmatter and left
    the cron running -- a card that says "arranca cuando lo pedís" over a job
    billing every fifteen minutes.
    """

    def rearm(self, trigger="request", cron="", **runs):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        flow = Path(tmp.name) / "entrevistas-tv"
        flow.mkdir()
        (flow / "FLOW.md").write_text(FRONT, encoding="utf-8")
        args = SimpleNamespace(slug="entrevistas-tv", trigger=trigger, cron=cron,
                               detail="Arranca cuando lo pedís", folders="",
                               connections="ninguna")
        a, b = run(**runs)
        out = io.StringIO()
        with a, b, mock.patch.object(create_flow, "FLOWS", Path(tmp.name)), \
                redirect_stdout(out):
            create_flow.rearm(args)
        return json.loads(out.getvalue()), (flow / "FLOW.md").read_text(encoding="utf-8")

    def test_the_old_job_goes_even_though_there_is_no_new_one(self):
        result, text = self.rearm()
        self.assertEqual(result["removed_job"], "deadbeef")
        self.assertIsNone(result["orphan_job"])
        self.assertIsNone(result["cron_job"])
        self.assertNotIn("trigger_job:", text)
        self.assertIn("trigger_type: request", text)

    def test_a_removal_that_failed_is_not_reported_as_a_removal(self):
        """The residual half of the same bug: the job survives and nobody is told.

        The frontmatter no longer carries the id, so this line is the only place
        left that names what is still running.
        """
        result, text = self.rearm(remove=(1, "", "connection refused"))
        self.assertIsNone(result["removed_job"])
        self.assertEqual(result["orphan_job"], "deadbeef")
        self.assertIn("SIGUE VIVO", result["tell_the_client"])
        self.assertIn("deadbeef", result["tell_the_client"])
        self.assertTrue(result["ok"],
                        "the re-arm did happen; saying it failed invites a retry "
                        "that creates a second job")

    def test_it_rewrites_the_trigger_and_nothing_else(self):
        _, text = self.rearm()
        self.assertIn("name: Entrevistas TV", text)
        self.assertIn('client_summary: "Miro tus carpetas y preparo los zócalos."', text)
        self.assertIn("skills: drive-inbox,lower-thirds", text)
        self.assertIn("status: active", text)
        self.assertNotIn("trigger_cron:", text)
        self.assertNotIn("trigger_folders:", text)
        self.assertIn("## Cómo lo trabaja tu agente", text)
        self.assertIn("Una regla horizontal en el cuerpo", text,
                      "a `---` in the body is not the end of the frontmatter")

    def test_the_trigger_lands_where_the_portal_reads_it(self):
        _, text = self.rearm()
        lines = [l for l in text.splitlines() if l.strip()]
        self.assertEqual(lines[lines.index("trigger_type: request") - 1],
                         'client_summary: "Miro tus carpetas y preparo los zócalos."')

    def test_a_flow_that_does_not_exist_is_refused(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        args = SimpleNamespace(slug="no-existe", trigger="request", cron="",
                               detail="x", folders="", connections="ninguna")
        with mock.patch.object(create_flow, "FLOWS", Path(tmp.name)):
            self.assertEqual(create_flow.rearm(args), 2)  # `fail()`


class TheTriggerRules(unittest.TestCase):
    """The two argument rules, which apply to `--rearm` as much as to creating.

    Both are checked in `main()` BEFORE it dispatches to `rearm`, and that
    ordering is the whole rule: a re-arm is exactly when a `drive` trigger gets
    its folders, so it is exactly when arming one without them has to be refused.
    """

    def parse(self, *argv):
        with mock.patch.object(create_flow.sys, "argv", ["create_flow.py", *argv]):
            return create_flow.main()

    def test_a_drive_trigger_with_no_folders_is_refused_when_rearming(self):
        self.assertEqual(self.parse(
            "--slug", "entrevistas-tv", "--rearm", "--trigger", "drive",
            "--detail", "Mira tus carpetas", "--cron", "*/15 * * * *",
            "--connections", "ninguna"), 2)  # `fail()`

    def test_a_non_request_trigger_with_no_cron_is_refused_when_rearming(self):
        self.assertEqual(self.parse(
            "--slug", "entrevistas-tv", "--rearm", "--trigger", "schedule",
            "--detail", "Todos los lunes", "--connections", "ninguna"), 2)  # `fail()`

    def test_too_frequent_is_refused_when_rearming(self):
        self.assertEqual(self.parse(
            "--slug", "entrevistas-tv", "--rearm", "--trigger", "schedule",
            "--detail", "Cada minuto", "--cron", "* * * * *",
            "--connections", "ninguna"), 2)  # `fail()`


if __name__ == "__main__":
    unittest.main()
