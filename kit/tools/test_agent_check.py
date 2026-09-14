#!/usr/bin/env python3
"""Tests for agent-check.py's «SOUL: identity» and «credentials» guards.

    python3 -m unittest test_agent_check.py

THE BUG THE GUARD EXISTS FOR. An agent with no identity does not go to
production: the gap is not left empty, the engine's preamble fills it, and the
agent introduces itself as the generic assistant of whoever built it instead of
the agent of the company paying for it.

AND THE HOLE THIS CLOSES. While the product sold teams, an agent with a company
and no name was legitimate -- the roster's roles were named one by one and the
shared agent never was -- so `company and no name` passed green. There are no
teams any more: onboarding asks for the NAME first and the business second
(`app/app/lib/onboarding.tsx`), so that block is now an onboarding that stopped
halfway, and the portal sends the client back to the naming step on the next
visit. It has to be a failure here too, or the tool says an unfinished agent is
ready to deliver. Measured on the VPS agent, whose block says «Tu Agente» and
nothing else.

Both checks are exercised through their module-level functions rather than by
running the script: the rest of agent-check needs a whole conforming agent to
say anything.
"""
import importlib.util
import unittest
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


def soul(block):
    """A SOUL whose only identity is the portal's block, with the kit's around it.

    The sentences are the adapter's own (`adapter/portal_adapter.py:248`): the
    guard reads them with a regex, so a paraphrase here would test the wrong
    string.
    """
    return ("<!-- portal:identity -->\n" + block + "\n<!-- /portal:identity -->\n"
            "\n<!-- kit:base v13 -->\n## Cómo trabajás\n\nGenérico.\n"
            "<!-- /kit:base -->\n")


class SoulIdentity(unittest.TestCase):
    def test_a_named_agent_is_its_name(self):
        got = agent_check.soul_identity(
            soul("Tu cliente te bautizo **Tuca** desde el portal.\n\n"
                 "Trabajas para **pdelabs**."))
        self.assertIn("Tuca", got)

    def test_a_company_with_no_name_is_an_unfinished_onboarding(self):
        """The team-era green path, and the whole point of this file."""
        with self.assertRaises(AssertionError) as caught:
            agent_check.soul_identity(soul("Trabajas para **Tu Agente**."))
        message = str(caught.exception)
        self.assertIn("never named", message)
        self.assertIn("Tu Agente", message)
        self.assertLess(len(message), 300)  # `check` cuts them there

    def test_an_empty_block_says_so_without_naming_an_adapter_version(self):
        with self.assertRaises(AssertionError) as caught:
            agent_check.soul_identity(soul("Todavía nada."))
        message = str(caught.exception)
        self.assertIn("says NOTHING", message)
        self.assertLess(len(message), 300)

    def test_a_hand_written_identity_block_outside_the_kit_block_counts(self):
        got = agent_check.soul_identity(
            "# Sos Tuca, el agente de pdelabs\n\nAlgo.\n"
            "<!-- kit:base v13 -->\n## Cómo trabajás\n<!-- /kit:base -->\n")
        self.assertIn("00-identity", got)

    def test_a_heading_inside_the_kit_block_is_not_an_identity(self):
        with self.assertRaises(AssertionError) as caught:
            agent_check.soul_identity(
                "<!-- kit:base v13 -->\n# Genérico\n<!-- /kit:base -->\n")
        self.assertIn("does not say who it is", str(caught.exception))


if __name__ == "__main__":
    unittest.main()


class Credentials(unittest.TestCase):
    """The keys check, which used to read the NAME and not the VALUE.

    THE HOLE THIS CLOSES. `TUAGENTE_MODELS_KEY` exists because the engine strips
    `OPENROUTER_API_KEY` out of every subprocess the agent spawns, so
    `transcribe.py` -- the base `transcription` capability, sold to every client
    -- could not run at all (`notes/auxiliary-models.md`). The guard was written
    as a FAILURE and not a warning precisely because the symptom is invisible
    until a client sends their first audio.

    But it asked whether the NAME was in `secrets.env`, and `new-agent.sh` writes
    that name into every fresh agent with nothing after the `=`. So the single
    likeliest mistake -- the operator fills the two keys they recognise and
    leaves the new one at its template default -- passed green, with the
    capability sold and dead. Reproduced 30/8/2026 against a copy of east-v2's
    real `secrets.env` with the value blanked: `30 ok - 0 failures`.
    """

    def filled(self, **over):
        base = {"API_SERVER_KEY": "a" * 64,
                "OPENROUTER_API_KEY": "sk-or-v1-real",
                "TUAGENTE_MODELS_KEY": "sk-or-v1-real",
                "TELEGRAM_BOT_TOKEN": "123:abc"}
        base.update(over)
        return base

    def test_a_filled_secrets_file_is_fine(self):
        self.assertEqual(agent_check.credentials_problem(self.filled()), "")

    def test_a_missing_models_key_names_the_fix(self):
        secrets = self.filled()
        del secrets["TUAGENTE_MODELS_KEY"]
        problem = agent_check.credentials_problem(secrets)
        self.assertIn("TUAGENTE_MODELS_KEY is missing", problem)
        self.assertIn("same value as OPENROUTER_API_KEY", problem)

    def test_the_models_key_present_and_empty_is_the_template_default(self):
        """What `new-agent.sh` ships, and what used to pass."""
        problem = agent_check.credentials_problem(
            self.filled(TUAGENTE_MODELS_KEY=""))
        self.assertIn("TUAGENTE_MODELS_KEY is empty", problem)
        self.assertIn("sold", problem)

    def test_a_rotation_that_updated_only_one_of_the_two_is_caught(self):
        problem = agent_check.credentials_problem(
            self.filled(OPENROUTER_API_KEY="sk-or-v1-rotated"))
        self.assertIn("DIFFERENT values", problem)

    def test_another_provider_is_not_a_misconfiguration(self):
        """No OPENROUTER_API_KEY to compare against: nothing to say."""
        secrets = self.filled(TUAGENTE_MODELS_KEY="gsk-groq")
        del secrets["OPENROUTER_API_KEY"]
        self.assertEqual(agent_check.credentials_problem(secrets), "")

    def test_an_empty_api_server_key_is_not_an_api_server_key(self):
        problem = agent_check.credentials_problem(
            self.filled(API_SERVER_KEY=""))
        self.assertIn("API_SERVER_KEY is empty", problem)

    def test_the_parser_reads_the_file_new_agent_actually_writes(self):
        """Hints on their own lines, commented-out optionals, real `=` in values."""
        import tempfile, os as _os
        fd, path = tempfile.mkstemp(suffix=".env")
        with _os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write("# The agent's keys. NEVER committed.\n"
                     "\n"
                     "# openssl rand -hex 32 — unique per client\n"
                     "API_SERVER_KEY=abc123\n"
                     "\n"
                     "# same value as OPENROUTER_API_KEY\n"
                     "TUAGENTE_MODELS_KEY=\n"
                     "\n"
                     "# SMTP_APP_PASSWORD=\n"
                     "PADDING=a=b\n")
        try:
            values = agent_check.secrets_values(path)
        finally:
            _os.unlink(path)
        self.assertEqual(values["API_SERVER_KEY"], "abc123")
        self.assertEqual(values["TUAGENTE_MODELS_KEY"], "")
        self.assertEqual(values["PADDING"], "a=b")
        self.assertNotIn("SMTP_APP_PASSWORD", values,
                         "a commented-out optional is not a set variable")
