"""Regression tests for the shared room transcript."""

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from rooms import RoomStore


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


if __name__ == "__main__":
    unittest.main()
