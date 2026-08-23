"""Regression tests for the capability matcher and the capabilities a request carries.

The assistant is the only role that is not written in advance: the client says
what they need, one short provider call turns that sentence into ids of the
catalog, and those ids ride along with the hire request. Two things have to hold
for that to be worth anything -- an id we cannot install never gets stored, and
a provider that is down costs the SUGGESTION and never the sign-up.
"""

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import portal_adapter as adapter


CATALOG = {
    "capabilities": [
        {"id": "vision", "label": "Ver lo que le mandás", "level": "base",
         "purpose": "Que lea la foto de una factura."},
        {"id": "quotes", "label": "Presupuestos al toque", "group": "administration",
         "level": "menu", "purpose": "Que armes el presupuesto en minutos."},
        {"id": "appointments-and-scheduling", "label": "Agenda de turnos", "group": "administration",
         "level": "menu", "purpose": "Que tome los turnos y los recuerde."},
        # No `level`: an old catalog. Counts as `menu`, which is how everything
        # behaved before the field existed.
        {"id": "web-monitoring", "label": "Vigilar páginas", "group": "information",
         "purpose": "Que mire las páginas que te importan."},
    ]
}

ROLES_CATALOG = {
    "roles": [
        {"id": "assistant", "label": "Asistente", "does": "Lo que le pidas.",
         "state": "ready", "identity": {"name": "Tino"}},
        {"id": "sales", "label": "Ventas", "does": "Arma presupuestos.", "state": "ready"},
    ]
}


class CapabilitiesSuggestTests(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        root = Path(self.temporary_directory.name)
        self.previous = {
            name: getattr(adapter, name)
            for name in ("CAPABILITIES_DIR", "CAPABILITIES_CATALOG", "ROLES_DIR",
                         "ROLES_CATALOG", "ROLES_REQUESTS", "ROLES_IDENTITIES",
                         "PROFILES_DIR", "_ask_the_model")
        }
        adapter.CAPABILITIES_DIR = root / "policy" / "capabilities"
        adapter.CAPABILITIES_CATALOG = adapter.CAPABILITIES_DIR / "catalog.json"
        adapter.ROLES_DIR = root / "policy" / "roles"
        adapter.ROLES_CATALOG = adapter.ROLES_DIR / "catalog.json"
        adapter.ROLES_REQUESTS = adapter.ROLES_DIR / "requests.jsonl"
        adapter.ROLES_IDENTITIES = adapter.ROLES_DIR / "identities.json"
        adapter.PROFILES_DIR = root / "data" / "profiles"
        adapter.CAPABILITIES_DIR.mkdir(parents=True)
        adapter.ROLES_DIR.mkdir(parents=True)
        adapter.PROFILES_DIR.mkdir(parents=True)
        adapter.CAPABILITIES_CATALOG.write_text(json.dumps(CATALOG), encoding="utf-8")
        adapter.ROLES_CATALOG.write_text(json.dumps(ROLES_CATALOG), encoding="utf-8")
        self.prompts = []

    def tearDown(self):
        for name, value in self.previous.items():
            setattr(adapter, name, value)
        self.temporary_directory.cleanup()

    # --- helpers -----------------------------------------------------------

    def answer_with(self, response):
        """The provider, stubbed at the seam: `_ask_the_model`.

        It is the only function that reaches the network for this, and
        stubbing it there -- not urlopen -- leaves the test talking about the
        decision (what the model answered, what the adapter does with it) and
        not about the transport.
        """
        def fake(prompt, max_tokens):
            self.prompts.append(prompt)
            if isinstance(response, Exception):
                raise response
            return response
        adapter._ask_the_model = fake

    # --- the suggestion -----------------------------------------------------

    def test_what_the_client_wrote_comes_back_as_catalog_ids(self):
        self.answer_with('["quotes", "appointments-and-scheduling"]')
        status, body = adapter.suggest_capabilities(
            "necesito que me arme los presupuestos y que me lleve los turnos")

        self.assertEqual(status, 200)
        self.assertEqual(body, {"suggested": ["quotes", "appointments-and-scheduling"]})
        # ONE single call, and with the menu inside the prompt.
        self.assertEqual(len(self.prompts), 1)
        self.assertIn("quotes", self.prompts[0])
        self.assertIn("me lleve los turnos", self.prompts[0])

    def test_what_already_ships_does_not_enter_the_menu_the_model_sees(self):
        """`level: base` is never chosen: offering it means offering what it already has."""
        self.answer_with("[]")
        adapter.suggest_capabilities("quiero que lea las facturas que le mando")
        self.assertNotIn("vision", self.prompts[0])
        self.assertIn("web-monitoring", self.prompts[0])   # no `level` = menu

    def test_an_id_the_model_invented_gets_dropped(self):
        self.answer_with('["quotes", "calendar-sync", "quotes"]')
        status, body = adapter.suggest_capabilities("presupuestos y agenda de google")
        self.assertEqual(status, 200)
        # The invented one is gone, and the repeated one counts once.
        self.assertEqual(body["suggested"], ["quotes"])
        self.assertNotIn("no_match", body)

    def test_a_wrapped_response_still_gets_read(self):
        """A ```json in front means a model that answered right, not a failure."""
        self.answer_with('Claro:\n```json\n["appointments-and-scheduling"]\n```')
        self.assertEqual(
            adapter.suggest_capabilities("tomar los turnos de la peluqueria")[1],
            {"suggested": ["appointments-and-scheduling"]})

    def test_a_response_that_is_not_a_list_suggests_nothing(self):
        self.answer_with("no se, depende de lo que necesite")
        status, body = adapter.suggest_capabilities("hacer cosas de la oficina todos los dias")
        self.assertEqual(status, 200)
        self.assertEqual(body, {"suggested": []})

    def test_never_more_than_five_come_back(self):
        adapter.CAPABILITIES_CATALOG.write_text(json.dumps({"capabilities": [
            {"id": f"cap-{n}", "label": f"Cap {n}", "level": "menu", "purpose": "x"}
            for n in range(9)
        ]}), encoding="utf-8")
        self.answer_with(json.dumps([f"cap-{n}" for n in range(9)]))
        body = adapter.suggest_capabilities("necesito de todo un poco en la oficina")[1]
        self.assertEqual(len(body["suggested"]), 5)

    def test_no_text_means_no_question(self):
        self.answer_with('["quotes"]')
        for weak in ("", "   ", None, "turnos", "hola"):
            status, body = adapter.suggest_capabilities(weak)
            self.assertEqual(status, 400, weak)
            self.assertIn("error", body)
        # And above all: not a single call to the provider was spent.
        self.assertEqual(self.prompts, [])

    def test_no_provider_and_the_sign_up_still_gets_the_whole_menu(self):
        """A missing key costs the SUGGESTION, never the hire."""
        self.answer_with(OSError("no hay clave"))
        status, body = adapter.suggest_capabilities("quiero que me ordene la administracion")
        self.assertEqual(status, 200)
        self.assertEqual(body, {"suggested": [], "no_match": True})

    def test_no_catalog_does_not_break_it_either(self):
        self.answer_with('["quotes"]')
        adapter.CAPABILITIES_CATALOG.unlink()
        self.assertEqual(
            adapter.suggest_capabilities("quiero que me ordene la administracion"),
            (200, {"suggested": [], "no_match": True}))
        self.assertEqual(self.prompts, [])

    # --- what the request carries with it ----------------------------------

    def test_checked_off_capabilities_get_recorded_and_served(self):
        status, body = adapter.request_role(
            "assistant", "Tina", {"tono": 2}, ["quotes", "appointments-and-scheduling"])
        self.assertEqual(status, 201)
        self.assertEqual(body["request"]["capabilities"], ["quotes", "appointments-and-scheduling"])

        # In the ledger, which is what hire-role.sh reads hours later.
        row = json.loads(adapter.ROLES_REQUESTS.read_text(encoding="utf-8").strip())
        self.assertEqual(row["capabilities"], ["quotes", "appointments-and-scheduling"])

        # And in the roster, which is where the portal reads them from.
        role = next(r for r in adapter.roles()["roles"] if r["id"] == "assistant")
        self.assertEqual(role["request"]["capabilities"], ["quotes", "appointments-and-scheduling"])

    def test_a_request_with_no_capabilities_stays_exactly_as_before(self):
        """The other four roles do not change at all: the key does not even show up."""
        body = adapter.request_role("sales", "Coca", None)[1]
        self.assertEqual(set(body["request"]), {"role", "name", "look", "requested_at"})
        self.assertNotIn("capabilities", json.loads(
            adapter.ROLES_REQUESTS.read_text(encoding="utf-8").strip()))
        role = next(r for r in adapter.roles()["roles"] if r["id"] == "sales")
        self.assertNotIn("capabilities", role["request"])

    def test_a_capability_that_does_not_exist_does_not_get_recorded(self):
        status, body = adapter.request_role(
            "assistant", "Tina", None, ["quotes", "calendar-sync"])
        self.assertEqual(status, 400)
        self.assertIn("calendar-sync", body["error"])
        # Nothing halfway: the whole request does not go in.
        self.assertFalse(adapter.ROLES_REQUESTS.exists())

    def test_what_already_ships_cannot_be_requested(self):
        """`level: base` is on every agent: asking for it means nothing."""
        status, body = adapter.request_role("assistant", "Tina", None, ["vision"])
        self.assertEqual(status, 400)
        self.assertIn("vision", body["error"])
        self.assertFalse(adapter.ROLES_REQUESTS.exists())

    def test_a_list_that_is_not_a_list_gets_rejected(self):
        for garbage in ("quotes", {"id": "quotes"}, [{"id": "quotes"}], [None]):
            status, _ = adapter.request_role("assistant", "Tina", None, garbage)
            self.assertEqual(status, 400, garbage)
        self.assertFalse(adapter.ROLES_REQUESTS.exists())

    def test_the_same_capability_twice_gets_recorded_once(self):
        body = adapter.request_role(
            "assistant", "Tina", None, ["quotes", " quotes "])[1]
        self.assertEqual(body["request"]["capabilities"], ["quotes"])


if __name__ == "__main__":
    unittest.main()
