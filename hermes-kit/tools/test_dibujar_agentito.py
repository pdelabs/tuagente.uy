"""Golden tests for the agentito geometry: same look -> same SVG, byte by byte.

Run from the monorepo root:
    python3 -m unittest discover -s hermes-kit/tools -p "test_*.py"

The geometry has ONE source (app/app/lib/agentito-svg.mjs) consumed by the
portal component AND by tools/dibujar-agentito.mjs, so these goldens guard all
consumers at once. If a trait changes on purpose, regenerate the goldens and
commit them with the change — a golden diff in a review is the feature.
"""
import json
import struct
import subprocess
import tempfile
import unittest
from pathlib import Path

TOOLS = Path(__file__).resolve().parent
ROOT = TOOLS.parent.parent
GOLD = TOOLS / "golden-agentitos"
CLI = TOOLS / "dibujar-agentito.mjs"


def cli(*args: str) -> str:
    out = subprocess.run(
        ["node", str(CLI), *args], capture_output=True, text=True, check=True,
    )
    return out.stdout


class GeometriaDorada(unittest.TestCase):
    def test_roles_del_catalogo(self):
        cat = json.loads((ROOT / "hermes-kit" / "roles" / "catalogo.json").read_text())
        for rol in [r["id"] for r in cat["roles"]]:
            with self.subTest(rol=rol):
                self.assertEqual(
                    cli("--rol", rol, "--svg", "-"),
                    (GOLD / f"{rol}.svg").read_text(),
                    f"la cara de {rol} cambió: si fue a propósito, regenerá el golden",
                )

    def test_look_default(self):
        self.assertEqual(cli("--look", "{}", "--svg", "-"), (GOLD / "default.svg").read_text())

    def test_ejes_invalidos_caen_al_default(self):
        # Same clamping the portal applies: out-of-range axes fall to default.
        raro = cli("--look", '{"tono": 99, "antena": -1}', "--svg", "-")
        self.assertEqual(raro, (GOLD / "default.svg").read_text())


class RasterTelegram(unittest.TestCase):
    def test_png_512_es_png(self):
        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp) / "cara.png"
            subprocess.run(
                ["node", str(CLI), "--rol", "asistente", "--para", "telegram", "--png", str(dest)],
                capture_output=True, check=True,
            )
            data = dest.read_bytes()
            self.assertEqual(data[:8], b"\x89PNG\r\n\x1a\n")
            width, height = struct.unpack(">II", data[16:24])
            self.assertEqual((width, height), (512, 512))


class ComponenteSinGeometria(unittest.TestCase):
    """The React wrapper must stay a wrapper: geometry re-inlined there would
    diverge from this tool silently. Cheap structural guard, loud on purpose."""

    def test_agentito_tsx_inyecta_el_modulo(self):
        src = (ROOT / "app" / "app" / "lib" / "agentito.tsx").read_text()
        self.assertIn("renderAgentitoSVG", src)
        self.assertNotIn("<svg viewBox", src)
        self.assertNotIn("<ellipse", src)


if __name__ == "__main__":
    unittest.main()
