"""Regression tests for the identity block the portal writes into the SOUL.

THE BUG. `_soul_block` used to emit the baptism paragraph unconditionally, and
a team client's onboarding never sends a name -- it opens at the business step
(`app/app/lib/onboarding.tsx`: a team's solo agent is never named, the roles
are named as they are hired). So the first thing the portal did to a team
agent was write «Tu cliente te bautizo **** desde el portal. Ese es tu nombre»
into its prompt, and `agent-check`'s «SOUL: identity» went green on it because
it only looked for the block, not for a name inside.

Run from the monorepo root:
    python3 -m unittest discover -s hermes-kit/adapter -p "test_*.py"
"""

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import portal_adapter as adapter


class SoulBlock(unittest.TestCase):
    """The two shapes onboarding produces: with a name, and without one."""

    def test_a_named_agent_is_told_its_name_and_its_company(self):
        block = adapter._soul_block("Nina", "Panaderia Rosa", "https://rosa.uy")
        self.assertIn("te bautizo **Nina** desde el portal", block)
        self.assertIn("Trabajas para **Panaderia Rosa**.", block)
        self.assertIn("Su sitio es https://rosa.uy.", block)
        self.assertTrue(block.startswith(adapter.SOUL_START))
        self.assertTrue(block.endswith(adapter.SOUL_END))

    def test_with_no_name_the_baptism_paragraph_does_not_exist(self):
        """The team shape: who it works for, and not a word about a name."""
        block = adapter._soul_block("", "Panaderia Rosa", "https://rosa.uy")
        self.assertNotIn("bautizo", block)
        self.assertNotIn("Ese es tu nombre", block)
        self.assertNotIn("****", block)
        self.assertIn("Trabajas para **Panaderia Rosa**.", block)
        self.assertIn("## Quien sos y para quien trabajas", block)

    def test_a_name_with_no_company_still_baptizes(self):
        """Solo onboarding writes the name BEFORE asking for the business."""
        block = adapter._soul_block("Nina")
        self.assertIn("te bautizo **Nina** desde el portal", block)
        self.assertNotIn("Trabajas para", block)


class WriteIdentityToSoul(unittest.TestCase):
    """Same two shapes, through the file it rewrites."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.soul = Path(self._tmp.name) / "SOUL.md"
        self.soul.write_text("# Sos el agente\n\nReglas de la casa.\n", encoding="utf-8")
        self._previous = adapter.SOUL
        adapter.SOUL = self.soul

    def tearDown(self):
        adapter.SOUL = self._previous
        self._tmp.cleanup()

    def test_the_team_shape_leaves_no_empty_name_in_the_prompt(self):
        self.assertEqual(adapter.write_identity_to_soul("", "Panaderia Rosa"), "ok")
        text = self.soul.read_text(encoding="utf-8")
        self.assertIn("Trabajas para **Panaderia Rosa**.", text)
        self.assertNotIn("bautizo", text)
        self.assertIn("Reglas de la casa.", text)

    def test_naming_it_later_rewrites_the_same_block(self):
        """A team agent that IS named afterwards gets the paragraph back."""
        adapter.write_identity_to_soul("", "Panaderia Rosa")
        adapter.write_identity_to_soul("Nina", "Panaderia Rosa")
        text = self.soul.read_text(encoding="utf-8")
        self.assertEqual(text.count(adapter.SOUL_START), 1)
        self.assertIn("te bautizo **Nina** desde el portal", text)
        self.assertIn("Trabajas para **Panaderia Rosa**.", text)


if __name__ == "__main__":
    unittest.main()
