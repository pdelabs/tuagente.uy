"""Regression tests for the shared room transcript, and for the two routes
that let the client name and throw away one of their own conversations.

The routes are served over a real socket on an ephemeral port through the real
`Handler`, so what is checked is the route, the auth door and the payload --
not a store method that happens to be called nearby. Same shape as
`test_plugins.py`, and for the same reason.

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
from rooms import RoomStore
import portal_adapter as adapter


class RoomStoreTests(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.store = RoomStore(Path(self.temporary_directory.name) / "rooms")

    def tearDown(self):
        self.temporary_directory.cleanup()

    def test_a_room_keeps_who_answered_each_turn(self):
        """Attribution is the point: the same room holds several teammates."""
        self.store.append("sala1", "user", "armame un posteo")
        self.store.append("sala1", "assistant", "listo, va", "marketing")
        self.store.append("sala1", "user", "y el whatsapp?")
        self.store.append("sala1", "assistant", "lo contesto", "support")

        turns = self.store.read("sala1")
        self.assertEqual([t["role"] for t in turns],
                         ["user", "assistant", "user", "assistant"])
        self.assertEqual(turns[1]["by"], "marketing")
        self.assertEqual(turns[3]["by"], "support")
        # The client's own turns carry no author: they are the client.
        self.assertNotIn("by", turns[0])

    def test_an_answer_from_the_named_agent_has_no_author(self):
        """`by` absent means the agent the client named, which is never badged."""
        self.store.append("sala1", "assistant", "hola", None)
        self.assertNotIn("by", self.store.read("sala1")[0])

    def test_an_id_that_could_escape_the_directory_is_refused(self):
        """The id is joined onto a path, so it is checked before touching disk."""
        for bad in ("../fuga", "sala/otra", "", "Sala", "a" * 65):
            self.assertFalse(self.store.append(bad, "user", "hola"), bad)
            self.assertEqual(self.store.read(bad), [], bad)

    def test_an_empty_turn_is_not_recorded(self):
        self.assertFalse(self.store.append("sala1", "user", "   "))
        self.assertEqual(self.store.read("sala1"), [])

    def test_a_corrupt_line_costs_that_line_and_not_the_conversation(self):
        """A half-written line must not make the whole history unreadable."""
        self.store.append("sala1", "user", "primera")
        path = self.store.directory / "sala1.jsonl"
        with open(path, "a", encoding="utf-8") as handle:
            handle.write("{esto no es json\n")
        self.store.append("sala1", "user", "tercera")

        turns = self.store.read("sala1")
        self.assertEqual([t["content"] for t in turns], ["primera", "tercera"])

    def test_rooms_are_listed_newest_first_and_titled_by_the_client(self):
        self.store.append("vieja", "user", "lo de enero\ncon otra linea")
        self.store.append("nueva", "user", "lo de hoy")

        listed = self.store.rooms()
        self.assertEqual([r["id"] for r in listed], ["nueva", "vieja"])
        # The title is the client's first line, not a summary we invent, and
        # never more than that first line.
        self.assertEqual(listed[1]["title"], "lo de enero")

    def test_a_room_with_no_turns_is_not_listed(self):
        (self.store.directory).mkdir(parents=True, exist_ok=True)
        (self.store.directory / "vacia.jsonl").write_text("", encoding="utf-8")
        self.assertEqual(self.store.rooms(), [])

    def test_the_name_the_client_gave_it_wins_over_their_first_line(self):
        self.store.append("sala1", "user", "lo de enero")
        self.assertTrue(self.store.rename("sala1", "Cierre de enero"))
        self.assertEqual(self.store.rooms()[0]["title"], "Cierre de enero")
        # And it survives new turns: the title is not recomputed from the
        # transcript once the client has named it.
        self.store.append("sala1", "assistant", "listo", "accounting")
        self.assertEqual(self.store.rooms()[0]["title"], "Cierre de enero")

    def test_a_name_is_cut_to_the_row_like_a_first_line_is(self):
        self.store.append("sala1", "user", "lo de enero")
        self.store.rename("sala1", "  primera\nsegunda  ")
        self.assertEqual(self.store.rooms()[0]["title"], "primera")
        self.store.rename("sala1", "x" * 200)
        self.assertEqual(self.store.rooms()[0]["title"], "x" * 80)

    def test_naming_a_room_never_touches_the_transcript(self):
        """The .jsonl has no rewrite path, and a title is not something said."""
        self.store.append("sala1", "user", "lo de enero")
        before = (self.store.directory / "sala1.jsonl").read_bytes()
        self.store.rename("sala1", "Cierre de enero")
        self.assertEqual((self.store.directory / "sala1.jsonl").read_bytes(), before)
        self.assertEqual([t["content"] for t in self.store.read("sala1")], ["lo de enero"])

    def test_a_room_that_is_not_there_is_neither_renamed_nor_deleted(self):
        for bad in ("fantasma", "../fuga", ""):
            self.assertFalse(self.store.rename(bad, "algo"), bad)
            self.assertFalse(self.store.delete(bad), bad)

    def test_deleting_takes_the_name_with_it(self):
        """Otherwise the next room minted with this id inherits a stale title."""
        self.store.append("sala1", "user", "lo de enero")
        self.store.rename("sala1", "Cierre de enero")
        self.assertTrue(self.store.delete("sala1"))
        self.assertEqual(self.store.rooms(), [])
        self.assertFalse((self.store.directory / "sala1.title").exists())

    def test_the_name_is_not_a_room(self):
        """`rooms()` globs the transcripts; a sidecar must not become a row."""
        self.store.append("sala1", "user", "lo de enero")
        self.store.rename("sala1", "Cierre de enero")
        self.assertEqual([r["id"] for r in self.store.rooms()], ["sala1"])


class RoomRoutes(unittest.TestCase):
    """POST and DELETE /portal/rooms/<id>, through the real Handler.

    THE PORTAL USED TO SEND THESE TO THE ENGINE. The sidebar draws room rows
    and engine-session rows the same, and its rename/delete went to `PATCH` and
    `DELETE /api/sessions/{id}` for both -- so on a client with a team the two
    menu items on every row could only ever fail. The rooms live here.
    """

    KEY = "test-key"

    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.previous = adapter.ROOMS, adapter.TOKEN
        adapter.ROOMS = RoomStore(Path(self.temporary_directory.name) / "rooms")
        adapter.TOKEN = self.KEY
        adapter.ROOMS.append("sala1", "user", "lo de enero")
        # Port 0: the OS picks a free one, so this never fights the 8643 of
        # whatever agent the machine happens to be running.
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), adapter.Handler)
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        adapter.ROOMS, adapter.TOKEN = self.previous
        self.temporary_directory.cleanup()

    def call(self, method, path, body=None, key=KEY):
        request = urllib.request.Request(
            self.base + path, method=method,
            data=json.dumps(body).encode() if body is not None else None)
        if body is not None:
            request.add_header("Content-Type", "application/json")
        if key is not None:
            request.add_header("Authorization", f"Bearer {key}")
        with urllib.request.urlopen(request, timeout=10) as response:
            return response.status, json.loads(response.read())

    def refused(self, method, path, body=None, key=KEY):
        with self.assertRaises(urllib.error.HTTPError) as raised:
            self.call(method, path, body, key)
        # An HTTPError IS the response object; unclosed it leaks the socket and
        # unittest reports the ResourceWarning against whatever runs next.
        code = raised.exception.code
        detail = json.loads(raised.exception.read())
        raised.exception.close()
        return code, detail

    def rooms(self):
        return self.call("GET", "/portal/rooms")[1]["rooms"]

    def test_renaming_shows_up_in_the_listing(self):
        status, body = self.call("POST", "/portal/rooms/sala1", {"title": "Cierre de enero"})
        self.assertEqual((status, body), (200, {"ok": True}))
        self.assertEqual([r["title"] for r in self.rooms()], ["Cierre de enero"])

    def test_renaming_a_room_that_is_not_there_is_a_404(self):
        code, detail = self.refused("POST", "/portal/rooms/fantasma", {"title": "Algo"})
        self.assertEqual(code, 404)
        self.assertIn("no existe", detail["error"])

    def test_a_room_cannot_be_left_without_a_name(self):
        code, _ = self.refused("POST", "/portal/rooms/sala1", {"title": "   "})
        self.assertEqual(code, 400)
        self.assertEqual([r["title"] for r in self.rooms()], ["lo de enero"])

    def test_deleting_takes_the_conversation_off_the_list(self):
        status, body = self.call("DELETE", "/portal/rooms/sala1")
        self.assertEqual((status, body), (200, {"ok": True}))
        self.assertEqual(self.rooms(), [])

    def test_deleting_a_room_that_is_not_there_is_a_404_and_not_a_silent_ok(self):
        """A 200 over nothing tells the sidebar a row went away that never did."""
        self.call("DELETE", "/portal/rooms/sala1")
        code, detail = self.refused("DELETE", "/portal/rooms/sala1")
        self.assertEqual(code, 404)
        self.assertIn("no existe", detail["error"])

    def test_deleting_an_artifact_still_works(self):
        """do_DELETE grew a second resource; the first one keeps its 404."""
        code, detail = self.refused("DELETE", "/portal/artifacts/fantasma")
        self.assertEqual(code, 404)
        self.assertEqual(detail["error"], "artifact not found")

    def test_both_are_behind_the_same_door_as_everything_else(self):
        for method, body in (("POST", {"title": "Algo"}), ("DELETE", None)):
            code, _ = self.refused(method, "/portal/rooms/sala1", body, key="wrong")
            self.assertEqual(code, 401, method)
        # And the conversation is untouched: an unauthorized call changes nothing.
        self.assertEqual([r["title"] for r in self.rooms()], ["lo de enero"])


if __name__ == "__main__":
    unittest.main()
