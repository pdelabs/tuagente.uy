"""Regression tests for asking for a role from the portal.

The ask is the only step of hiring the client does themselves, and everything
after it happens hours later on another machine: the state has to survive in a
file, and it has to be derived from that file and not from a flag somebody keeps
current by hand.
"""

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import portal_adapter as adapter


CATALOG = {
    "roles": [
        {
            "id": "support",
            "label": "Soporte",
            "does": "Contesta los mensajes de tus clientes.",
            "never": "Manda un mensaje sin tu aprobación.",
            "routing": "no sale por el portal",
            "internal_note": "tampoco esto",
            "needs": ["whatsapp"],
            "flows": ["fuera-de-hora"],
            "state": "ready",
            "identity": {"name": "Beto", "look": {"tono": 1, "antena": 3}},
        },
        {
            "id": "sales",
            "label": "Ventas",
            "does": "Arma presupuestos.",
            "state": "ready",
            "identity": {"name": "Nina", "look": {"tono": 2}},
        },
        {
            "id": "logistics",
            "label": "Logística",
            "does": "Todavía no existe.",
            "state": "unwritten",
            "identity": {"name": "Sara", "look": {"tono": 3}},
        },
    ]
}


class RoleRequestTests(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        root = Path(self.temporary_directory.name)
        self.previous = {
            name: getattr(adapter, name)
            for name in ("ROLES_DIR", "ROLES_CATALOG", "ROLES_REQUESTS",
                         "ROLES_IDENTITIES", "PROFILES_DIR")
        }
        adapter.ROLES_DIR = root / "policy" / "roles"
        adapter.ROLES_CATALOG = adapter.ROLES_DIR / "catalog.json"
        adapter.ROLES_REQUESTS = adapter.ROLES_DIR / "requests.jsonl"
        adapter.ROLES_IDENTITIES = adapter.ROLES_DIR / "identities.json"
        adapter.PROFILES_DIR = root / "data" / "profiles"
        adapter.ROLES_DIR.mkdir(parents=True)
        adapter.PROFILES_DIR.mkdir(parents=True)
        adapter.ROLES_CATALOG.write_text(json.dumps(CATALOG), encoding="utf-8")

    def tearDown(self):
        for name, value in self.previous.items():
            setattr(adapter, name, value)
        self.temporary_directory.cleanup()

    # --- helpers -----------------------------------------------------------

    def hire(self, role_id):
        """A hired role is a profile directory. Nothing else -- see _role_installed."""
        (adapter.PROFILES_DIR / role_id).mkdir(parents=True)

    def record(self, row):
        with adapter.ROLES_REQUESTS.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")

    def roster_row(self, role_id):
        return next(r for r in adapter.roles()["roles"] if r["id"] == role_id)

    # --- the ask -----------------------------------------------------------

    def test_a_role_that_is_not_on_offer_cannot_be_asked_for(self):
        """404 for an id nobody sells, and for one whose SOUL is not written."""
        self.assertEqual(adapter.request_role("reception", "Ana", None)[0], 404)
        self.assertEqual(adapter.request_role("logistics", "Sara", None)[0], 404)
        self.assertFalse(adapter.ROLES_REQUESTS.exists())

    def test_the_ask_is_answered_with_what_was_written_down(self):
        status, body = adapter.request_role("support", "  Juana  ", {"tono": 2, "antena": 1})
        self.assertEqual(status, 201)
        request = body["request"]
        self.assertEqual(request["role"], "support")
        self.assertEqual(request["name"], "Juana")
        self.assertEqual(request["look"], {"tono": 2, "antena": 1})
        self.assertTrue(request["requested_at"])
        self.assertEqual(set(request), {"role", "name", "look", "requested_at"})

        row = json.loads(adapter.ROLES_REQUESTS.read_text(encoding="utf-8").strip())
        self.assertEqual(row["event"], "requested")
        self.assertEqual(row["name"], "Juana")

    def test_a_role_can_be_asked_for_without_a_face(self):
        """The name is the decision; the face is the portal's editor, optional."""
        status, body = adapter.request_role("sales", "Coca", None)
        self.assertEqual(status, 201)
        self.assertIsNone(body["request"]["look"])

    def test_a_nameless_ask_is_refused(self):
        for empty in ("", "   ", None, "<<>>"):
            self.assertEqual(adapter.request_role("support", empty, None)[0], 400, empty)
        self.assertFalse(adapter.ROLES_REQUESTS.exists())

    def test_asking_twice_for_the_same_role_is_a_conflict(self):
        """The double click of a portal button must not show two people arriving."""
        self.assertEqual(adapter.request_role("support", "Juana", None)[0], 201)
        status, body = adapter.request_role("support", "Otra", None)
        self.assertEqual(status, 409)
        self.assertIn("error", body)
        self.assertEqual(len(adapter.ROLES_REQUESTS.read_text(encoding="utf-8").strip().splitlines()), 1)
        # Another role in the catalog is not blocked by the first one's pending ask.
        self.assertEqual(adapter.request_role("sales", "Coca", None)[0], 201)

    def test_a_role_already_hired_cannot_be_asked_for(self):
        self.hire("support")
        status, _ = adapter.request_role("support", "Juana", None)
        self.assertEqual(status, 409)
        self.assertFalse(adapter.ROLES_REQUESTS.exists())

    # --- what the roster says ---------------------------------------------

    def test_a_pending_ask_is_served_with_the_roster(self):
        adapter.request_role("support", "Juana", {"tono": 2})

        row = self.roster_row("support")
        self.assertFalse(row["hired"])
        self.assertEqual(row["request"]["name"], "Juana")
        self.assertEqual(row["request"]["look"], {"tono": 2})
        self.assertTrue(row["request"]["requested_at"])
        # With no request, `request` is null and the key is not missing: the
        # portal reads the same shape for everyone.
        self.assertIsNone(self.roster_row("sales")["request"])
        # And the commercial fields still do not come out.
        self.assertNotIn("routing", row)
        self.assertNotIn("internal_note", row)

    def test_a_hire_closes_the_ask(self):
        adapter.request_role("support", "Juana", {"tono": 2})
        self.record({"event": "hired", "role": "support", "name": "Juana",
                     "hired_at": "2026-08-19T10:00:00"})
        self.hire("support")

        row = self.roster_row("support")
        self.assertTrue(row["hired"])
        self.assertIsNone(row["request"])
        # And after that the same role can be asked for again if it was let
        # go: the log does not leave the role stuck forever.
        adapter.PROFILES_DIR.joinpath("support").rmdir()
        self.assertEqual(adapter.request_role("support", "Otra", None)[0], 201)

    def test_a_half_written_line_costs_that_line_and_not_the_log(self):
        adapter.request_role("support", "Juana", None)
        with adapter.ROLES_REQUESTS.open("a", encoding="utf-8") as handle:
            handle.write("{esto no es json\n")
        adapter.request_role("sales", "Coca", None)

        self.assertEqual(self.roster_row("support")["request"]["name"], "Juana")
        self.assertEqual(self.roster_row("sales")["request"]["name"], "Coca")

    # --- the baptism -------------------------------------------------------

    def test_the_name_the_client_chose_wins_over_the_one_it_ships_with(self):
        self.hire("support")
        adapter.ROLES_IDENTITIES.write_text(json.dumps({
            "support": {"name": "Juana", "look": {"tono": 4, "boca": 2},
                        "named_at": "2026-08-19T10:00:00"},
        }), encoding="utf-8")

        row = self.roster_row("support")
        self.assertEqual(row["name"], "Juana")
        self.assertEqual(row["look"], {"tono": 4, "boca": 2})
        # The catalog's own default still stands for whoever nobody baptised.
        self.assertEqual(self.roster_row("sales")["name"], "Nina")

    def test_a_baptism_without_a_face_keeps_the_face_it_shipped_with(self):
        self.hire("support")
        adapter.ROLES_IDENTITIES.write_text(json.dumps({
            "support": {"name": "Juana", "look": None},
        }), encoding="utf-8")

        row = self.roster_row("support")
        self.assertEqual(row["name"], "Juana")
        self.assertEqual(row["look"], {"tono": 1, "antena": 3})

    def test_an_agent_with_no_catalog_has_no_team(self):
        adapter.ROLES_CATALOG.unlink()
        self.assertEqual(adapter.roles(), {"available": False, "roles": []})
        self.assertEqual(adapter.request_role("support", "Juana", None)[0], 404)


if __name__ == "__main__":
    unittest.main()
