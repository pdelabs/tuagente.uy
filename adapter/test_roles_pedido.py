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
            "id": "soporte",
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
            "id": "ventas",
            "label": "Ventas",
            "does": "Arma presupuestos.",
            "state": "ready",
            "identity": {"name": "Nina", "look": {"tono": 2}},
        },
        {
            "id": "logistica",
            "label": "Logística",
            "does": "Todavía no existe.",
            "state": "unwritten",
            "identity": {"name": "Sara", "look": {"tono": 3}},
        },
    ]
}


class RolePedidoTests(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        root = Path(self.temporary_directory.name)
        self.previous = {
            name: getattr(adapter, name)
            for name in ("ROLES_DIR", "ROLES_CATALOG", "ROLES_PEDIDOS",
                         "ROLES_IDENTIDADES", "PROFILES_DIR")
        }
        adapter.ROLES_DIR = root / "politica" / "roles"
        adapter.ROLES_CATALOG = adapter.ROLES_DIR / "catalogo.json"
        adapter.ROLES_PEDIDOS = adapter.ROLES_DIR / "pedidos.jsonl"
        adapter.ROLES_IDENTIDADES = adapter.ROLES_DIR / "identidades.json"
        adapter.PROFILES_DIR = root / "data" / "profiles"
        adapter.ROLES_DIR.mkdir(parents=True)
        adapter.PROFILES_DIR.mkdir(parents=True)
        adapter.ROLES_CATALOG.write_text(json.dumps(CATALOG), encoding="utf-8")

    def tearDown(self):
        for name, value in self.previous.items():
            setattr(adapter, name, value)
        self.temporary_directory.cleanup()

    # --- helpers -----------------------------------------------------------

    def contratar(self, role_id):
        """A hired role is a profile directory. Nothing else -- see _role_installed."""
        (adapter.PROFILES_DIR / role_id).mkdir(parents=True)

    def anotar(self, fila):
        with adapter.ROLES_PEDIDOS.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(fila, ensure_ascii=False) + "\n")

    def fila_del_roster(self, role_id):
        return next(r for r in adapter.roles()["roles"] if r["id"] == role_id)

    # --- the ask -----------------------------------------------------------

    def test_a_role_that_is_not_on_offer_cannot_be_asked_for(self):
        """404 for an id nobody sells, and for one whose SOUL is not written."""
        self.assertEqual(adapter.pedido_de_rol("recepcion", "Ana", None)[0], 404)
        self.assertEqual(adapter.pedido_de_rol("logistica", "Sara", None)[0], 404)
        self.assertFalse(adapter.ROLES_PEDIDOS.exists())

    def test_the_ask_is_answered_with_what_was_written_down(self):
        status, body = adapter.pedido_de_rol("soporte", "  Juana  ", {"tono": 2, "antena": 1})
        self.assertEqual(status, 201)
        pedido = body["pedido"]
        self.assertEqual(pedido["rol"], "soporte")
        self.assertEqual(pedido["nombre"], "Juana")
        self.assertEqual(pedido["pinta"], {"tono": 2, "antena": 1})
        self.assertTrue(pedido["pedido_en"])
        self.assertEqual(set(pedido), {"rol", "nombre", "pinta", "pedido_en"})

        fila = json.loads(adapter.ROLES_PEDIDOS.read_text(encoding="utf-8").strip())
        self.assertEqual(fila["evento"], "pedido")
        self.assertEqual(fila["nombre"], "Juana")

    def test_a_role_can_be_asked_for_without_a_face(self):
        """The name is the decision; the face is the portal's editor, optional."""
        status, body = adapter.pedido_de_rol("ventas", "Coca", None)
        self.assertEqual(status, 201)
        self.assertIsNone(body["pedido"]["pinta"])

    def test_a_nameless_ask_is_refused(self):
        for vacio in ("", "   ", None, "<<>>"):
            self.assertEqual(adapter.pedido_de_rol("soporte", vacio, None)[0], 400, vacio)
        self.assertFalse(adapter.ROLES_PEDIDOS.exists())

    def test_asking_twice_for_the_same_role_is_a_conflict(self):
        """The double click of a portal button must not show two people arriving."""
        self.assertEqual(adapter.pedido_de_rol("soporte", "Juana", None)[0], 201)
        status, body = adapter.pedido_de_rol("soporte", "Otra", None)
        self.assertEqual(status, 409)
        self.assertIn("error", body)
        self.assertEqual(len(adapter.ROLES_PEDIDOS.read_text(encoding="utf-8").strip().splitlines()), 1)
        # Otro rol del catalogo no queda bloqueado por el pendiente del primero.
        self.assertEqual(adapter.pedido_de_rol("ventas", "Coca", None)[0], 201)

    def test_a_role_already_hired_cannot_be_asked_for(self):
        self.contratar("soporte")
        status, _ = adapter.pedido_de_rol("soporte", "Juana", None)
        self.assertEqual(status, 409)
        self.assertFalse(adapter.ROLES_PEDIDOS.exists())

    # --- what the roster says ---------------------------------------------

    def test_a_pending_ask_is_served_with_the_roster(self):
        adapter.pedido_de_rol("soporte", "Juana", {"tono": 2})

        fila = self.fila_del_roster("soporte")
        self.assertFalse(fila["contratado"])
        self.assertFalse(fila["hired"])
        self.assertEqual(fila["pedido"]["nombre"], "Juana")
        self.assertEqual(fila["pedido"]["pinta"], {"tono": 2})
        self.assertTrue(fila["pedido"]["pedido_en"])
        # Sin pedido, `pedido` es null y no falta la clave: el portal lee la
        # misma forma para todos.
        self.assertIsNone(self.fila_del_roster("ventas")["pedido"])
        # Y lo comercial sigue sin salir.
        self.assertNotIn("routing", fila)
        self.assertNotIn("internal_note", fila)

    def test_a_hire_closes_the_ask(self):
        adapter.pedido_de_rol("soporte", "Juana", {"tono": 2})
        self.anotar({"evento": "atendido", "rol": "soporte", "nombre": "Juana",
                     "atendido_en": "2026-08-19T10:00:00"})
        self.contratar("soporte")

        fila = self.fila_del_roster("soporte")
        self.assertTrue(fila["contratado"])
        self.assertIsNone(fila["pedido"])
        # Y despues de eso se puede volver a pedir el mismo rol si lo dieron de
        # baja: el log no deja el rol trabado para siempre.
        adapter.PROFILES_DIR.joinpath("soporte").rmdir()
        self.assertEqual(adapter.pedido_de_rol("soporte", "Otra", None)[0], 201)

    def test_a_half_written_line_costs_that_line_and_not_the_log(self):
        adapter.pedido_de_rol("soporte", "Juana", None)
        with adapter.ROLES_PEDIDOS.open("a", encoding="utf-8") as handle:
            handle.write("{esto no es json\n")
        adapter.pedido_de_rol("ventas", "Coca", None)

        self.assertEqual(self.fila_del_roster("soporte")["pedido"]["nombre"], "Juana")
        self.assertEqual(self.fila_del_roster("ventas")["pedido"]["nombre"], "Coca")

    # --- the baptism -------------------------------------------------------

    def test_the_name_the_client_chose_wins_over_the_one_it_ships_with(self):
        self.contratar("soporte")
        adapter.ROLES_IDENTIDADES.write_text(json.dumps({
            "soporte": {"nombre": "Juana", "pinta": {"tono": 4, "boca": 2},
                        "bautizado_en": "2026-08-19T10:00:00"},
        }), encoding="utf-8")

        fila = self.fila_del_roster("soporte")
        self.assertEqual(fila["name"], "Juana")
        self.assertEqual(fila["look"], {"tono": 4, "boca": 2})
        # El default del catalogo sigue abajo para los que nadie bautizo.
        self.assertEqual(self.fila_del_roster("ventas")["name"], "Nina")

    def test_a_baptism_without_a_face_keeps_the_face_it_shipped_with(self):
        self.contratar("soporte")
        adapter.ROLES_IDENTIDADES.write_text(json.dumps({
            "soporte": {"nombre": "Juana", "pinta": None},
        }), encoding="utf-8")

        fila = self.fila_del_roster("soporte")
        self.assertEqual(fila["name"], "Juana")
        self.assertEqual(fila["look"], {"tono": 1, "antena": 3})

    def test_an_agent_with_no_catalog_has_no_team(self):
        adapter.ROLES_CATALOG.unlink()
        self.assertEqual(adapter.roles(), {"available": False, "roles": []})
        self.assertEqual(adapter.pedido_de_rol("soporte", "Juana", None)[0], 404)


if __name__ == "__main__":
    unittest.main()
