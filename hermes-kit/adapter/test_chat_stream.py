"""The two chat routes after the team left them: one agent, one key, one door.

Both used to fork. `POST /portal/chat/stream` read a `role` off the body,
swapped the upstream prefix to `/p/<role>/` and the credential to that
profile's own key; `POST /portal/sessions/<id>/chat/stream` read the same field
for the same swap. Both also carried a `room` id, the shared transcript's.

WHAT IS TESTED IS THE REFUSAL, not the absence. Dropping an unknown field
quietly is the failure that costs the most to diagnose: the sender believes a
specialist took the turn, the agent answers as itself, and it reads as the
agent behaving badly instead of as a caller that is out of date.

Served over a real socket on an ephemeral port through the real `Handler`, so
what is checked is the route and its auth door -- the same shape as
`test_plugins.py`, and for the same reason.

Run from the monorepo root:
    python3 -m unittest discover -s hermes-kit/adapter -p "test_*.py"
"""

import json
import sys
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import portal_adapter as adapter


class ChatStreamRoutes(unittest.TestCase):
    KEY = "test-key"

    def setUp(self):
        self.previous = adapter.TOKEN, adapter.AGENT_BASE
        adapter.TOKEN = self.KEY
        # A port with nothing behind it: anything that gets PAST the guard
        # fails at the socket, which is how a request that was let through is
        # told apart from one that was refused.
        adapter.AGENT_BASE = "http://127.0.0.1:1"
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), adapter.Handler)
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        adapter.TOKEN, adapter.AGENT_BASE = self.previous

    def post(self, path, body):
        request = urllib.request.Request(
            self.base + path, method="POST", data=json.dumps(body).encode())
        request.add_header("Content-Type", "application/json")
        request.add_header("Authorization", f"Bearer {self.KEY}")
        with self.assertRaises(urllib.error.HTTPError) as raised:
            urllib.request.urlopen(request, timeout=10)
        code = raised.exception.code
        detail = json.loads(raised.exception.read())
        raised.exception.close()
        return code, detail

    # --- the fields that are gone -------------------------------------------

    def test_a_role_on_a_new_conversation_is_refused(self):
        code, detail = self.post(
            "/portal/chat/stream",
            {"messages": [{"role": "user", "content": "hola"}], "role": "marketing"})
        self.assertEqual(code, 400)
        self.assertIn("role", detail["error"])

    def test_a_room_on_a_new_conversation_is_refused(self):
        code, detail = self.post(
            "/portal/chat/stream",
            {"messages": [{"role": "user", "content": "hola"}], "room": "sala1"})
        self.assertEqual(code, 400)
        self.assertIn("room", detail["error"])

    def test_both_at_once_are_named_in_one_answer(self):
        code, detail = self.post(
            "/portal/chat/stream",
            {"messages": [{"role": "user", "content": "hola"}],
             "role": "marketing", "room": "sala1"})
        self.assertEqual(code, 400)
        self.assertIn("role", detail["error"])
        self.assertIn("room", detail["error"])

    def test_a_role_on_an_existing_session_is_refused_too(self):
        """The other fork: it swapped the prefix on the session path as well."""
        code, detail = self.post(
            "/portal/sessions/abc123/chat/stream", {"message": "hola", "role": "support"})
        self.assertEqual(code, 400)
        self.assertIn("role", detail["error"])

    def test_an_empty_role_is_still_the_field_being_sent(self):
        """It used to fall back to the named agent, so an empty value passed."""
        code, _ = self.post(
            "/portal/chat/stream",
            {"messages": [{"role": "user", "content": "hola"}], "role": ""})
        self.assertEqual(code, 400)

    # --- what a message inside the body is ----------------------------------

    def test_the_role_of_a_message_is_not_the_field_that_is_gone(self):
        """`messages[].role` is OpenAI's, and every turn carries it.

        Refusing on it would take the chat down entirely, so the guard reads
        the TOP level and only the top level.
        """
        code, detail = self.post(
            "/portal/chat/stream",
            {"messages": [{"role": "user", "content": "hola"},
                          {"role": "assistant", "content": "buenas"}]})
        self.assertEqual(code, 502)                     # got through, no agent
        self.assertIn("no pude hablar con el agente", detail["error"])

    def test_a_session_turn_with_nothing_extra_gets_through(self):
        code, detail = self.post("/portal/sessions/abc123/chat/stream", {"message": "hola"})
        self.assertEqual(code, 502)
        self.assertIn("no pude hablar con el agente", detail["error"])


if __name__ == "__main__":
    unittest.main()
