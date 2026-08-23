"""Regression tests for /portal/uso -- the money screen, after it lied 9x low.

The old number was ours: what litellm saw go by. Image generation never went
by, so the tab showed US$ 0,17 on a day the provider charged US$ 1,52. The fix
is to stop counting and ask whoever bills: the agent's own OpenRouter key.

That makes three things worth pinning down. The shape we serve is the shape the
real API answers with (the payload below is a real response, recorded on
19/8/2026 -- only the label is masked). A field the provider does not send is
null and never zero, because zero reads as "you spent nothing". And no key or a
provider that is down is a 200 with `disponible: False`, so the portal hides the
tab instead of drawing a broken screen where the money goes.
"""

import json
import sys
import unittest
import urllib.error
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import portal_adapter as adapter


# Respuesta real de `GET https://openrouter.ai/api/v1/key` (19/8/2026).
RESPUESTA_REAL = {
    "label": "sk-or-v1-xxx...xxx",
    "is_management_key": False,
    "is_provisioning_key": False,
    "limit": 5,
    "limit_reset": None,
    "limit_remaining": 4.218107879,
    "include_byok_in_limit": False,
    "usage": 0.781892121,
    "usage_daily": 0,
    "usage_weekly": 0.781892121,
    "usage_monthly": 0.781892121,
    "byok_usage": 0,
    "byok_usage_daily": 0,
    "byok_usage_weekly": 0,
    "byok_usage_monthly": 0,
    "is_free_tier": False,
    "expires_at": None,
    "creator_user_id": None,
    "rate_limit": {"requests": -1, "interval": "10s", "note": "deprecated"},
}


class UsoTests(unittest.TestCase):
    def setUp(self):
        self.previous_key = adapter.os.environ.get("OPENROUTER_API_KEY")
        adapter.os.environ["OPENROUTER_API_KEY"] = "sk-or-v1-test"
        self.previous_fetch = adapter.openrouter_key_info
        self.calls = []
        adapter._uso_cache["en"], adapter._uso_cache["valor"] = 0.0, None

    def tearDown(self):
        adapter.openrouter_key_info = self.previous_fetch
        adapter._uso_cache["en"], adapter._uso_cache["valor"] = 0.0, None
        if self.previous_key is None:
            adapter.os.environ.pop("OPENROUTER_API_KEY", None)
        else:
            adapter.os.environ["OPENROUTER_API_KEY"] = self.previous_key

    def stub(self, data=None, raises=None):
        """Replace the one network seam and count what goes through it."""
        def fake(key):
            self.calls.append(key)
            if raises is not None:
                raise raises
            return data
        adapter.openrouter_key_info = fake

    def test_serves_what_the_provider_charged(self):
        self.stub(RESPUESTA_REAL)
        r = adapter.uso()
        self.assertTrue(r["disponible"])
        self.assertEqual(r["hoy_usd"], 0)
        self.assertEqual(r["mes_usd"], 0.781892121)
        self.assertEqual(r["total_usd"], 0.781892121)
        self.assertEqual(r["limite_usd"], 5)
        self.assertTrue(r["actualizado"])
        # Nada de la clave viaja al browser: ni el label enmascarado.
        self.assertNotIn("sk-or", json.dumps(r))

    def test_a_field_the_provider_omits_is_null_not_zero(self):
        # Una clave sin tope y sin corte diario: lo que no viene no se inventa.
        self.stub({"usage": 3.5})
        r = adapter.uso()
        self.assertEqual(r["total_usd"], 3.5)
        self.assertIsNone(r["hoy_usd"])
        self.assertIsNone(r["mes_usd"])
        self.assertIsNone(r["limite_usd"])

    def test_asks_the_provider_once_every_five_minutes(self):
        self.stub(RESPUESTA_REAL)
        primero = adapter.uso()
        self.assertEqual(adapter.uso(), primero)
        self.assertEqual(len(self.calls), 1)
        # Vencido el cache, vuelve a preguntar.
        adapter._uso_cache["en"] -= adapter.USO_CACHE_SEGUNDOS + 1
        adapter.uso()
        self.assertEqual(len(self.calls), 2)

    def test_no_key_means_no_tab_and_no_call(self):
        adapter.os.environ["OPENROUTER_API_KEY"] = ""
        self.stub(RESPUESTA_REAL)
        r = adapter.uso()
        self.assertFalse(r["disponible"])
        self.assertIn("clave", r["motivo"])
        self.assertEqual(self.calls, [])

    def test_provider_down_hides_the_tab_and_is_not_cached(self):
        self.stub(raises=urllib.error.HTTPError(
            adapter.OPENROUTER_KEY_URL, 500, "Internal Server Error", {}, None))
        r = adapter.uso()
        self.assertFalse(r["disponible"])
        self.assertIn("no pude", r["motivo"])
        # Un pico del proveedor no puede apagar la pantalla cinco minutos.
        self.stub(RESPUESTA_REAL)
        self.assertTrue(adapter.uso()["disponible"])

    def test_the_tab_follows_the_key(self):
        self.assertTrue(adapter.manifest()["modules"]["usage"])
        adapter.os.environ["OPENROUTER_API_KEY"] = ""
        self.assertFalse(adapter.manifest()["modules"]["usage"])


if __name__ == "__main__":
    unittest.main()
