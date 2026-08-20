"""Regression tests for the capacity matcher and the capacities a pedido carries.

The asistente is the only role that is not written in advance: the client says
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


CATALOGO = {
    "capacidades": [
        {"id": "vision", "label": "Ver lo que le mandás", "nivel": "base",
         "para_que": "Que lea la foto de una factura."},
        {"id": "presupuestos", "label": "Presupuestos al toque", "grupo": "administracion",
         "nivel": "menu", "para_que": "Que armes el presupuesto en minutos."},
        {"id": "turnos-y-agenda", "label": "Agenda de turnos", "grupo": "administracion",
         "nivel": "menu", "para_que": "Que tome los turnos y los recuerde."},
        # Sin `nivel`: un catalogo viejo. Cuenta como `menu`, que es como se
        # comportaba todo antes de que el campo existiera.
        {"id": "monitoreo-web", "label": "Vigilar páginas", "grupo": "informacion",
         "para_que": "Que mire las páginas que te importan."},
    ]
}

CATALOGO_DE_ROLES = {
    "roles": [
        {"id": "asistente", "label": "Asistente", "does": "Lo que le pidas.",
         "state": "ready", "identity": {"name": "Tino"}},
        {"id": "ventas", "label": "Ventas", "does": "Arma presupuestos.", "state": "ready"},
    ]
}


class SugerirCapacidadesTests(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        root = Path(self.temporary_directory.name)
        self.previous = {
            name: getattr(adapter, name)
            for name in ("CAPACIDADES_DIR", "CAPACIDADES_CATALOG", "ROLES_DIR",
                         "ROLES_CATALOG", "ROLES_PEDIDOS", "ROLES_IDENTIDADES",
                         "PROFILES_DIR", "_preguntar_al_modelo")
        }
        adapter.CAPACIDADES_DIR = root / "politica" / "capacidades"
        adapter.CAPACIDADES_CATALOG = adapter.CAPACIDADES_DIR / "catalogo.json"
        adapter.ROLES_DIR = root / "politica" / "roles"
        adapter.ROLES_CATALOG = adapter.ROLES_DIR / "catalogo.json"
        adapter.ROLES_PEDIDOS = adapter.ROLES_DIR / "pedidos.jsonl"
        adapter.ROLES_IDENTIDADES = adapter.ROLES_DIR / "identidades.json"
        adapter.PROFILES_DIR = root / "data" / "profiles"
        adapter.CAPACIDADES_DIR.mkdir(parents=True)
        adapter.ROLES_DIR.mkdir(parents=True)
        adapter.PROFILES_DIR.mkdir(parents=True)
        adapter.CAPACIDADES_CATALOG.write_text(json.dumps(CATALOGO), encoding="utf-8")
        adapter.ROLES_CATALOG.write_text(json.dumps(CATALOGO_DE_ROLES), encoding="utf-8")
        self.preguntas = []

    def tearDown(self):
        for name, value in self.previous.items():
            setattr(adapter, name, value)
        self.temporary_directory.cleanup()

    # --- helpers -----------------------------------------------------------

    def contesta(self, respuesta):
        """El proveedor, stubbeado en la costura: `_preguntar_al_modelo`.

        Es la unica funcion que sale a la red para esto, y stubbearla ahi -- y
        no urlopen -- deja el test hablando de la decision (que contesto el
        modelo, que hace el adapter con eso) y no del transporte.
        """
        def falso(prompt, max_tokens):
            self.preguntas.append(prompt)
            if isinstance(respuesta, Exception):
                raise respuesta
            return respuesta
        adapter._preguntar_al_modelo = falso

    # --- la sugerencia -----------------------------------------------------

    def test_lo_que_escribio_el_cliente_vuelve_como_ids_del_catalogo(self):
        self.contesta('["presupuestos", "turnos-y-agenda"]')
        estado, cuerpo = adapter.sugerir_capacidades(
            "necesito que me arme los presupuestos y que me lleve los turnos")

        self.assertEqual(estado, 200)
        self.assertEqual(cuerpo, {"sugeridas": ["presupuestos", "turnos-y-agenda"]})
        # UNA sola llamada, y con el menu adentro del prompt.
        self.assertEqual(len(self.preguntas), 1)
        self.assertIn("presupuestos", self.preguntas[0])
        self.assertIn("me lleve los turnos", self.preguntas[0])

    def test_lo_que_ya_viene_puesto_no_entra_en_el_menu_que_ve_el_modelo(self):
        """`nivel: base` no se elige: ofrecerla es ofrecer lo que ya tiene."""
        self.contesta("[]")
        adapter.sugerir_capacidades("quiero que lea las facturas que le mando")
        self.assertNotIn("vision", self.preguntas[0])
        self.assertIn("monitoreo-web", self.preguntas[0])   # sin `nivel` = menu

    def test_un_id_inventado_por_el_modelo_se_cae(self):
        self.contesta('["presupuestos", "agenda-google", "presupuestos"]')
        estado, cuerpo = adapter.sugerir_capacidades("presupuestos y agenda de google")
        self.assertEqual(estado, 200)
        # El inventado no esta, y el repetido cuenta una vez.
        self.assertEqual(cuerpo["sugeridas"], ["presupuestos"])
        self.assertNotIn("sin_matching", cuerpo)

    def test_una_respuesta_envuelta_igual_se_lee(self):
        """Un ```json adelante es un modelo que contesto bien, no un fallo."""
        self.contesta('Claro:\n```json\n["turnos-y-agenda"]\n```')
        self.assertEqual(
            adapter.sugerir_capacidades("tomar los turnos de la peluqueria")[1],
            {"sugeridas": ["turnos-y-agenda"]})

    def test_una_respuesta_que_no_es_una_lista_no_sugiere_nada(self):
        self.contesta("no se, depende de lo que necesite")
        estado, cuerpo = adapter.sugerir_capacidades("hacer cosas de la oficina todos los dias")
        self.assertEqual(estado, 200)
        self.assertEqual(cuerpo, {"sugeridas": []})

    def test_nunca_vuelven_mas_de_cinco(self):
        adapter.CAPACIDADES_CATALOG.write_text(json.dumps({"capacidades": [
            {"id": f"cap-{n}", "label": f"Cap {n}", "nivel": "menu", "para_que": "x"}
            for n in range(9)
        ]}), encoding="utf-8")
        self.contesta(json.dumps([f"cap-{n}" for n in range(9)]))
        cuerpo = adapter.sugerir_capacidades("necesito de todo un poco en la oficina")[1]
        self.assertEqual(len(cuerpo["sugeridas"]), 5)

    def test_sin_texto_no_hay_pregunta(self):
        self.contesta('["presupuestos"]')
        for flojo in ("", "   ", None, "turnos", "hola"):
            estado, cuerpo = adapter.sugerir_capacidades(flojo)
            self.assertEqual(estado, 400, flojo)
            self.assertIn("error", cuerpo)
        # Y sobre todo: no se gasto una llamada al proveedor en ninguna.
        self.assertEqual(self.preguntas, [])

    def test_sin_proveedor_el_alta_sigue_con_el_menu_entero(self):
        """La clave que falta cuesta la SUGERENCIA, nunca la contratacion."""
        self.contesta(OSError("no hay clave"))
        estado, cuerpo = adapter.sugerir_capacidades("quiero que me ordene la administracion")
        self.assertEqual(estado, 200)
        self.assertEqual(cuerpo, {"sugeridas": [], "sin_matching": True})

    def test_sin_catalogo_tampoco_se_cae(self):
        self.contesta('["presupuestos"]')
        adapter.CAPACIDADES_CATALOG.unlink()
        self.assertEqual(
            adapter.sugerir_capacidades("quiero que me ordene la administracion"),
            (200, {"sugeridas": [], "sin_matching": True}))
        self.assertEqual(self.preguntas, [])

    # --- lo que el pedido se lleva ----------------------------------------

    def test_las_capacidades_marcadas_quedan_anotadas_y_se_sirven(self):
        estado, cuerpo = adapter.pedido_de_rol(
            "asistente", "Tina", {"tono": 2}, ["presupuestos", "turnos-y-agenda"])
        self.assertEqual(estado, 201)
        self.assertEqual(cuerpo["pedido"]["capacidades"], ["presupuestos", "turnos-y-agenda"])

        # En el libro, que es lo que lee contratar-rol.sh horas despues.
        fila = json.loads(adapter.ROLES_PEDIDOS.read_text(encoding="utf-8").strip())
        self.assertEqual(fila["capacidades"], ["presupuestos", "turnos-y-agenda"])

        # Y en el roster, que es de donde las lee el portal.
        rol = next(r for r in adapter.roles()["roles"] if r["id"] == "asistente")
        self.assertEqual(rol["pedido"]["capacidades"], ["presupuestos", "turnos-y-agenda"])

    def test_un_pedido_sin_capacidades_queda_igual_que_siempre(self):
        """Los otros cuatro roles no cambian en nada: la clave ni aparece."""
        cuerpo = adapter.pedido_de_rol("ventas", "Coca", None)[1]
        self.assertEqual(set(cuerpo["pedido"]), {"rol", "nombre", "pinta", "pedido_en"})
        self.assertNotIn("capacidades", json.loads(
            adapter.ROLES_PEDIDOS.read_text(encoding="utf-8").strip()))
        rol = next(r for r in adapter.roles()["roles"] if r["id"] == "ventas")
        self.assertNotIn("capacidades", rol["pedido"])

    def test_una_capacidad_que_no_existe_no_se_anota(self):
        estado, cuerpo = adapter.pedido_de_rol(
            "asistente", "Tina", None, ["presupuestos", "agenda-google"])
        self.assertEqual(estado, 400)
        self.assertIn("agenda-google", cuerpo["error"])
        # Nada a medias: el pedido entero no entra.
        self.assertFalse(adapter.ROLES_PEDIDOS.exists())

    def test_lo_que_ya_viene_puesto_no_se_puede_pedir(self):
        """`nivel: base` esta en todos los agentes: pedirla no significa nada."""
        estado, cuerpo = adapter.pedido_de_rol("asistente", "Tina", None, ["vision"])
        self.assertEqual(estado, 400)
        self.assertIn("vision", cuerpo["error"])
        self.assertFalse(adapter.ROLES_PEDIDOS.exists())

    def test_una_lista_que_no_es_una_lista_se_rechaza(self):
        for basura in ("presupuestos", {"id": "presupuestos"}, [{"id": "presupuestos"}], [None]):
            estado, _ = adapter.pedido_de_rol("asistente", "Tina", None, basura)
            self.assertEqual(estado, 400, basura)
        self.assertFalse(adapter.ROLES_PEDIDOS.exists())

    def test_la_misma_capacidad_dos_veces_se_anota_una(self):
        cuerpo = adapter.pedido_de_rol(
            "asistente", "Tina", None, ["presupuestos", " presupuestos "])[1]
        self.assertEqual(cuerpo["pedido"]["capacidades"], ["presupuestos"])


if __name__ == "__main__":
    unittest.main()
