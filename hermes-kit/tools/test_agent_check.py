#!/usr/bin/env python3
"""Tests for agent-check.py's «SOUL: identity» guard.

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

The check is exercised through its module-level function rather than by running
the script: the rest of agent-check needs a whole conforming agent to say
anything.
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
