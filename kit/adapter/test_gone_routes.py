"""The routes 0.43.0 removed, and what a portal that still calls them gets.

The roster and the shared room left the adapter with the team. A browser tab
open on an older portal does not know that, so the door has to answer the four
paths properly rather than by accident.

THE 404 HAS TO BE READABLE, and that is the part with a history. This handler
closes the connection after every response, and closing it with request bytes
still unread makes the kernel send an RST: the caller reads the status line,
then loses the socket while reading the body, and ends up with a transport
error where a 404 was already on the wire. It is the same failure 6a7aa24
fixed on the 401, and until 0.43.0 it was unreachable on the not-found path --
every POST a shipped portal sends matched some route. `/portal/roles/request`
and `/portal/rooms/<id>` are the first two that do not.

Measured on this handler before the drain, 20 calls each: 6/20 reset with a
27-byte body, 10/20 with 60KB. Hence the loop below rather than one call --
one call passes half the time with the bug in place.

Run from the monorepo root:
    python3 -m unittest discover -s kit/adapter -p "test_*.py"
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


class GoneRoutes(unittest.TestCase):
    KEY = "test-key"

    def setUp(self):
        self.previous = adapter.TOKEN
        adapter.TOKEN = self.KEY
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), adapter.Handler)
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        adapter.TOKEN = self.previous

    def call(self, method, path, body=None):
        """(status, body). The body IS read: that is where a reset lands."""
        request = urllib.request.Request(
            self.base + path, method=method,
            data=json.dumps(body).encode() if body is not None else None)
        if body is not None:
            request.add_header("Content-Type", "application/json")
        request.add_header("Authorization", f"Bearer {self.KEY}")
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                return response.status, json.loads(response.read())
        except urllib.error.HTTPError as error:
            status, payload = error.code, json.loads(error.read())
            error.close()
            return status, payload

    # --- the roster ---------------------------------------------------------

    def test_the_roster_is_not_served(self):
        self.assertEqual(self.call("GET", "/portal/roles")[0], 404)

    def test_the_manifest_does_not_offer_a_team_tab(self):
        self.assertNotIn("roles", self.call("GET", "/portal/manifest")[1]["modules"])

    # --- the room -----------------------------------------------------------

    def test_no_room_is_listed_read_renamed_or_deleted(self):
        self.assertEqual(self.call("GET", "/portal/rooms")[0], 404)
        self.assertEqual(self.call("GET", "/portal/rooms/sala1")[0], 404)
        self.assertEqual(self.call("POST", "/portal/rooms/sala1", {"title": "x"})[0], 404)
        self.assertEqual(self.call("DELETE", "/portal/rooms/sala1")[0], 404)

    # --- the answer has to arrive whole -------------------------------------

    def test_a_hire_request_is_refused_without_resetting_the_socket(self):
        """Twenty of them: with the body left unread, half of these die."""
        for attempt in range(20):
            status, payload = self.call(
                "POST", "/portal/roles/request",
                {"role": "sales", "name": "Coca", "look": {"tono": 2}})
            self.assertEqual(status, 404, attempt)
            self.assertIn("error", payload)

    def test_a_big_body_to_a_gone_route_is_refused_the_same_way(self):
        """The bigger the body, the likelier the reset was: 10/20 at 60KB."""
        for attempt in range(20):
            status, _ = self.call(
                "POST", "/portal/rooms/sala1", {"title": "x" * 60000})
            self.assertEqual(status, 404, attempt)


if __name__ == "__main__":
    unittest.main()
