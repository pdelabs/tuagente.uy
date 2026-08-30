"""The baptism: what the door requires, and what lands in the system prompt.

THE BUG THAT MADE THIS FILE. `_soul_block` emitted the baptism paragraph
unconditionally, so an identity write that carried no name put
«Tu cliente te bautizo **** desde el portal. Ese es tu nombre» into the
agent's prompt -- the first thing the portal ever told it was to introduce
itself as the empty string. It was fixed by making the paragraph conditional,
which was right while a team existed: a team's solo agent was never named, so
their onboarding opened at the business step and a nameless write was a
legitimate state.

THE RULE NOW. There is one onboarding and it opens on the name
(`app/app/lib/onboarding.tsx`). So a nameless identity is not a state a client
can be in, and the two halves say so in different ways: the door refuses a
write that would leave the agent unnamed (400), and the formatter raises
rather than emit a block whose reason for existing is missing. A company-only
body is an UPDATE -- fine once there is a name, refused before.

Run from the monorepo root:
    python3 -m unittest discover -s hermes-kit/adapter -p "test_*.py"
"""

import json
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import portal_adapter as adapter


class SoulBlock(unittest.TestCase):
    """The two shapes onboarding produces, and the one it never does."""

    def test_a_named_agent_is_told_its_name_and_its_company(self):
        block = adapter._soul_block("Nina", "Panaderia Rosa", "https://rosa.uy")
        self.assertIn("te bautizo **Nina** desde el portal", block)
        self.assertIn("Trabajas para **Panaderia Rosa**.", block)
        self.assertIn("Su sitio es https://rosa.uy.", block)
        self.assertTrue(block.startswith(adapter.SOUL_START))
        self.assertTrue(block.endswith(adapter.SOUL_END))

    def test_a_name_with_no_company_still_baptizes(self):
        """Step 1 writes the name; step 2 is where the business arrives."""
        block = adapter._soul_block("Nina")
        self.assertIn("te bautizo **Nina** desde el portal", block)
        self.assertNotIn("Trabajas para", block)

    def test_with_no_name_it_raises_instead_of_writing_an_empty_baptism(self):
        """The shape that reached a live prompt. It is not written quietly."""
        for nameless in ("", "   ", None, "<>"):
            with self.assertRaises(ValueError):
                adapter._soul_block(nameless, "Panaderia Rosa")


class WriteIdentityToSoul(unittest.TestCase):
    """Through the file it rewrites: the onboarding prose has to survive."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.soul = Path(self._tmp.name) / "SOUL.md"
        self.soul.write_text("# Sos el agente\n\nReglas de la casa.\n", encoding="utf-8")
        self._previous = adapter.SOUL
        adapter.SOUL = self.soul

    def tearDown(self):
        adapter.SOUL = self._previous
        self._tmp.cleanup()

    def test_the_block_is_appended_without_touching_what_was_there(self):
        self.assertEqual(adapter.write_identity_to_soul("Nina", "Panaderia Rosa"), "ok")
        text = self.soul.read_text(encoding="utf-8")
        self.assertIn("te bautizo **Nina** desde el portal", text)
        self.assertIn("Trabajas para **Panaderia Rosa**.", text)
        self.assertIn("Reglas de la casa.", text)

    def test_the_business_arriving_later_rewrites_the_same_block(self):
        """Two writes, one block: step 2 must not append a second one."""
        adapter.write_identity_to_soul("Nina")
        adapter.write_identity_to_soul("Nina", "Panaderia Rosa")
        text = self.soul.read_text(encoding="utf-8")
        self.assertEqual(text.count(adapter.SOUL_START), 1)
        self.assertIn("te bautizo **Nina** desde el portal", text)
        self.assertIn("Trabajas para **Panaderia Rosa**.", text)

    def test_a_nameless_write_never_reaches_the_file(self):
        adapter.write_identity_to_soul("Nina")
        before = self.soul.read_text(encoding="utf-8")
        with self.assertRaises(ValueError):
            adapter.write_identity_to_soul("", "Panaderia Rosa")
        self.assertEqual(self.soul.read_text(encoding="utf-8"), before)


class IdentityRoute(unittest.TestCase):
    """POST /portal/identity over a real socket, through the real Handler."""

    KEY = "test-key"

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        root = Path(self._tmp.name)
        self._previous = (adapter.IDENTITY, adapter.SOUL, adapter.TOKEN,
                          adapter.set_telegram_name)
        adapter.IDENTITY = root / "portal_identity.json"
        adapter.SOUL = root / "SOUL.md"
        adapter.SOUL.write_text("# Sos el agente\n\nReglas de la casa.\n", encoding="utf-8")
        adapter.TOKEN = self.KEY
        # A name change tells the Telegram bot about itself. Stubbed here so
        # the suite never reaches api.telegram.org on a machine that happens
        # to have a real TELEGRAM_BOT_TOKEN in its environment.
        adapter.set_telegram_name = lambda name: "no bot"
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), adapter.Handler)
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        (adapter.IDENTITY, adapter.SOUL, adapter.TOKEN,
         adapter.set_telegram_name) = self._previous
        self._tmp.cleanup()

    def post(self, body):
        request = urllib.request.Request(
            self.base + "/portal/identity", method="POST",
            data=json.dumps(body).encode())
        request.add_header("Content-Type", "application/json")
        request.add_header("Authorization", f"Bearer {self.KEY}")
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                return response.status, json.loads(response.read())
        except urllib.error.HTTPError as error:
            code, detail = error.code, json.loads(error.read())
            error.close()
            return code, detail

    def soul(self):
        return adapter.SOUL.read_text(encoding="utf-8")

    # --- the baptism --------------------------------------------------------

    def test_a_baptism_round_trips_and_reaches_the_prompt(self):
        status, body = self.post({"name": "Nina", "look": {"tono": 2}})
        self.assertEqual(status, 200)
        self.assertEqual(body["name"], "Nina")
        self.assertEqual(body["look"], {"tono": 2})
        # On the agent's own volume, so another machine's login finds it.
        saved = json.loads(adapter.IDENTITY.read_text(encoding="utf-8"))
        self.assertEqual(saved["name"], "Nina")
        # And in the system prompt, which is the point of the whole thing.
        self.assertIn("te bautizo **Nina** desde el portal", self.soul())
        self.assertEqual(body["applied"]["soul"], "ok")

    def test_the_business_is_an_update_once_there_is_a_name(self):
        self.post({"name": "Nina"})
        status, body = self.post({"company": "Panaderia Rosa"})
        self.assertEqual(status, 200)
        self.assertEqual((body["name"], body["company"]), ("Nina", "Panaderia Rosa"))
        text = self.soul()
        self.assertIn("te bautizo **Nina** desde el portal", text)
        self.assertIn("Trabajas para **Panaderia Rosa**.", text)
        self.assertEqual(text.count(adapter.SOUL_START), 1)

    # --- what the door refuses ----------------------------------------------

    def test_the_business_before_a_name_is_refused(self):
        """The team's onboarding started here. There is no team."""
        status, body = self.post({"company": "Panaderia Rosa"})
        self.assertEqual(status, 400)
        self.assertIn("nombre", body["error"])
        # Nothing halfway: neither the file nor the prompt was touched.
        self.assertFalse(adapter.IDENTITY.exists())
        self.assertNotIn(adapter.SOUL_START, self.soul())

    def test_a_channel_before_a_name_is_refused_too(self):
        status, _ = self.post({"contact": {"channel": "email", "value": "a@b.uy"}})
        self.assertEqual(status, 400)
        self.assertFalse(adapter.IDENTITY.exists())

    def test_an_empty_name_is_refused_whether_or_not_one_is_saved(self):
        self.assertEqual(self.post({"name": "   "})[0], 400)
        self.post({"name": "Nina"})
        self.assertEqual(self.post({"name": ""})[0], 400)
        # And the one that was already there survived the refusal.
        self.assertIn("te bautizo **Nina** desde el portal", self.soul())

    def test_a_body_with_nothing_of_the_identity_in_it_is_refused(self):
        self.post({"name": "Nina"})
        status, body = self.post({"nombre": "Nina"})
        self.assertEqual(status, 400)
        self.assertIn("identidad", body["error"])


if __name__ == "__main__":
    unittest.main()
