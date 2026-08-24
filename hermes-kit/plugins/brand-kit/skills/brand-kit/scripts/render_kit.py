#!/usr/bin/env python3
"""Render brand.json as the HTML body of a portal artifact.

Prints an HTML FRAGMENT on stdout, ready to pipe into create_artifact.py, which
wraps it in the portal shell. Everything is inlined as data: URIs because the
portal draws artifacts inside an isolated iframe with no guaranteed network --
a relative <img src="logos/logo.svg"> renders as a broken image there.
"""

import argparse
import base64
import html
import json
import mimetypes
import os
from pathlib import Path

MAX_EMBED_BYTES = 400 * 1024   # per asset
MAX_TOTAL_BYTES = 1400 * 1024  # the artifact hard cap is 2 MB, leave room
ROLE_LABELS = {
    "primary": "Primario", "secondary": "Secundario", "accent": "Acento",
    "background": "Fondo", "surface": "Superficie", "text": "Texto", "muted": "Apagado",
}


class Budget:
    """Keeps the embedded bytes under the artifact cap, first come first served."""

    def __init__(self, limit=MAX_TOTAL_BYTES):
        self.left = limit

    def take(self, size):
        if size > MAX_EMBED_BYTES or size > self.left:
            return False
        self.left -= size
        return True


def data_uri(path, budget):
    """Inline a file as a data: URI, or None when it does not fit."""
    try:
        raw = Path(path).read_bytes()
    except OSError:
        return None
    if not budget.take(len(raw)):
        return None
    mime = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
    return f"data:{mime};base64,{base64.b64encode(raw).decode('ascii')}"


def esc(value):
    return html.escape(str(value or ""), quote=True)


def swatches(kit):
    roles = kit["colors"]["roles"]
    if not roles:
        return "<p class='sub'>El escaneo no pudo asignar roles de color.</p>"
    cells = []
    for role, hex_color in roles.items():
        label = ROLE_LABELS.get(role, role)
        why = esc(kit["colors"].get("why", {}).get(role, ""))
        cells.append(
            f"<div class='bk-swatch'>"
            f"<div class='bk-chip' style='background:{esc(hex_color)}'></div>"
            f"<div class='kpi-label'>{esc(label)}</div>"
            f"<div class='bk-hex'>{esc(hex_color.upper())}</div>"
            f"<div class='bk-why'>{why}</div></div>"
        )
    return f"<div class='bk-swatches'>{''.join(cells)}</div>"


def contrast_table(kit):
    pairs = kit.get("accessibility", {}).get("pairs", [])
    if not pairs:
        return ""
    rows = []
    for pair in pairs:
        ok = pair["aa_normal"]
        chip = ("<span class='chip chip-g'>AA</span>" if ok
                else "<span class='chip chip-c'>no llega</span>")
        sample = (f"<span style='background:{esc(pair['bg'])};color:{esc(pair['fg'])};"
                  f"padding:2px 10px;border-radius:6px'>Texto</span>")
        rows.append(
            f"<tr><td>{esc(pair['pair'])}</td><td>{sample}</td>"
            f"<td class='num'>{pair['ratio']}:1</td><td>{chip}</td></tr>"
        )
    return (
        "<h2>Contraste</h2>"
        "<p class='sub'>WCAG 2.1. Texto normal necesita 4,5:1 para cumplir AA.</p>"
        "<div class='card'><table><thead><tr><th>Par</th><th>Se ve así</th>"
        "<th class='num'>Medido</th><th>Estado</th></tr></thead>"
        f"<tbody>{''.join(rows)}</tbody></table></div>"
    )


def typography_block(kit, brand_dir, budget):
    typography = kit.get("typography", {})
    faces = typography.get("faces", [])
    files = {f.get("family", "").lower(): f for f in typography.get("files", [])}
    if not faces:
        return "<h2>Tipografía</h2><p class='sub'>No se detectaron tipografías propias.</p>"

    css, blocks = [], []
    for index, face in enumerate(faces):
        family = face.get("family", "")
        record = files.get(family.lower())
        css_family = f"bkfont{index}"
        rendered = "font-family:inherit"
        if record:
            uri = data_uri(Path(brand_dir) / record["file"], budget)
            if uri:
                css.append(f"@font-face{{font-family:'{css_family}';src:url({uri});font-display:swap}}")
                rendered = f"font-family:'{css_family}'"
        stack = ", ".join(typography.get("heading", [])[:3])
        blocks.append(
            f"<div class='card'><div class='kpi-label'>{esc(family)}</div>"
            f"<div style=\"{rendered};font-size:30px;line-height:1.2;margin:8px 0\">Aa Bb Cc 123</div>"
            f"<div class='bk-why'>{face.get('weights', 0)} peso(s) declarado(s)"
            + (f" · cascada: {esc(stack)}" if stack else "") + "</div></div>"
        )
    style = f"<style>{''.join(css)}</style>" if css else ""
    return f"<h2>Tipografía</h2>{style}<div class='grid'>{''.join(blocks)}</div>"


def logo_block(kit, brand_dir, budget):
    files = kit.get("logo", {}).get("files", [])
    if not files:
        return "<h2>Logo</h2><p class='sub'>No se encontró ningún archivo de logo en el sitio.</p>"
    cards = []
    for record in files:
        uri = data_uri(Path(brand_dir) / record["file"], budget)
        if not uri:
            continue
        kilobytes = record.get("bytes", 0) // 1024
        cards.append(
            f"<div class='card' style='text-align:center'>"
            f"<img src='{uri}' alt='{esc(record.get('kind'))}' "
            f"style='max-height:72px;max-width:100%;object-fit:contain'>"
            f"<div class='bk-why' style='margin-top:8px'>{esc(record.get('kind'))} · {kilobytes} KB</div></div>"
        )
    if not cards:
        return "<h2>Logo</h2><p class='sub'>Los archivos encontrados no entran en el artefacto.</p>"
    return f"<h2>Logo</h2><div class='grid'>{''.join(cards)}</div>"


def gaps_block(kit):
    gaps = kit.get("gaps", [])
    if not gaps:
        return ("<h2>Qué falta</h2><div class='card'>"
                "<p>Nada: el kit está completo.</p></div>")
    items = "".join(f"<li>{esc(gap)}</li>" for gap in gaps)
    return (
        "<h2>Qué falta decidir</h2>"
        "<p class='sub'>Esto no se puede leer de un sitio: son decisiones. "
        "Hasta que alguien las conteste, el kit las deja en blanco a propósito.</p>"
        f"<div class='card'><ul class='bk-gaps'>{items}</ul></div>"
    )


STYLE = """<style>
  .bk-swatches{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(140px,1fr))}
  .bk-swatch{border:1px solid var(--line);border-radius:14px;padding:12px;background:#fff}
  .bk-chip{height:56px;border-radius:10px;border:1px solid rgba(0,0,0,.08);margin-bottom:10px}
  .bk-hex{font-variant-numeric:tabular-nums;font-weight:700;font-size:13px}
  .bk-why{color:var(--ink-soft);font-size:11px;margin-top:2px}
  .bk-gaps{margin:0;padding-left:18px}
  .bk-gaps li{margin:4px 0}
</style>"""


def main():
    parser = argparse.ArgumentParser(description="Render brand.json as an artifact body.")
    parser.add_argument("--brand-dir", default=os.environ.get("BRAND_DIR", "/opt/data/workspace/brand"))
    args = parser.parse_args()

    brand_dir = Path(args.brand_dir)
    source = brand_dir / "brand.json"
    if not source.is_file():
        print(json.dumps({"ok": False, "error": f"no existe {source}; correr scan_site.py primero"},
                         ensure_ascii=False))
        return 1

    kit = json.loads(source.read_text("utf-8"))
    budget = Budget()
    identity = kit.get("identity", {})

    parts = [
        STYLE,
        "<div class='card'>",
        f"<div class='kpi-label'>Marca</div><div class='kpi'>{esc(identity.get('name'))}</div>",
        f"<p class='sub' style='margin:6px 0 0'>{esc(identity.get('tagline'))}</p>" if identity.get("tagline") else "",
        f"<div class='bk-why'>{esc(identity.get('url'))} · escaneado {esc((identity.get('scanned_at') or '')[:10])}</div>",
        "</div>",
        "<h2>Color</h2>",
        swatches(kit),
        contrast_table(kit),
        typography_block(kit, brand_dir, budget),
        logo_block(kit, brand_dir, budget),
        gaps_block(kit),
    ]
    print("\n".join(part for part in parts if part))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
