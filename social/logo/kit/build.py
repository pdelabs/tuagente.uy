"""Build the tuagente.uy brand kit: the mark, the wordmark and their lockups,
as SVG (text outlined, no font dependency) and PNG.

Run from the repo root with a Python that has fontTools:

    python3 social/logo/kit/build.py

The mark is Lucide's `bot` on the brand violet, exactly as the landing header
draws it (`public/tuagente-mark.svg`). The wordmark is «tuagente.uy» in Plus
Jakarta Sans ExtraBold, «.uy» in violet, outlined from `social/fonts/`.
PNGs are rendered with headless Chrome from the SVGs.
"""
import subprocess
from pathlib import Path

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent
FONT = ROOT / "social/fonts/PlusJakartaSans-Variable.ttf"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

VIOLET = "#5B4BE8"
INK = "#14131F"
WHITE = "#FFFFFF"

# Lucide `bot`, 24-unit box, stroke 2.
BOT = (
    '<g fill="none" stroke="{c}" stroke-width="2" stroke-linecap="round" '
    'stroke-linejoin="round"><path d="M12 8V4H8"/>'
    '<rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/>'
    '<path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></g>'
)


def mark(x, y, size, bg, fg, shape="square"):
    """The mark at `size` px: rounded square (r = 22%) or circle, bot inside."""
    r = size * 0.22
    if shape == "square":
        back = f'<rect x="{x}" y="{y}" width="{size}" height="{size}" rx="{r}" fill="{bg}"/>'
        scale, pad = size / 32, size * 0.125
    else:
        back = f'<circle cx="{x + size / 2}" cy="{y + size / 2}" r="{size / 2}" fill="{bg}"/>'
        scale, pad = size / 42.67, size * 0.219
    return (
        back
        + f'<g transform="translate({x + pad},{y + pad}) scale({scale})">'
        + BOT.format(c=fg)
        + "</g>"
    )


def glyphs():
    """«tuagente» and «.uy» outlined at wght 800, returned as (paths, advance)
    in font units, with -0.02em tracking. Y is flipped to SVG space."""
    font = instancer.instantiateVariableFont(TTFont(FONT), {"wght": 800})
    glyph_set = font.getGlyphSet()
    cmap = font.getBestCmap()
    upm = font["head"].unitsPerEm
    tracking = -0.02 * upm

    def run(text):
        pen_paths, x = [], 0
        for ch in text:
            name = cmap[ord(ch)]
            pen = SVGPathPen(glyph_set)
            glyph_set[name].draw(TransformPen(pen, (1, 0, 0, -1, x, 0)))
            pen_paths.append(pen.getCommands())
            x += glyph_set[name].width + tracking
        return " ".join(pen_paths), x - tracking

    return run, upm, font["hhea"].ascent


def wordmark(x, baseline, cap, color_main, color_tld):
    """«tuagente.uy» with the x-height set by `cap` px; returns (svg, width)."""
    run, upm, _ = glyphs()
    scale = cap / upm
    a, wa = run("tuagente")
    b, wb = run(".uy")
    svg = (
        f'<g transform="translate({x},{baseline}) scale({scale})">'
        f'<path fill="{color_main}" d="{a}"/>'
        f'<path fill="{color_tld}" transform="translate({wa},0)" d="{b}"/></g>'
    )
    return svg, (wa + wb) * scale


def svg(width, height, body, bg=None):
    back = f'<rect width="{width}" height="{height}" fill="{bg}"/>' if bg else ""
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}">{back}{body}</svg>\n'
    )


# Each variant: (mark background, bot color, wordmark color, tld color, page background)
VARIANTS = {
    "color": (VIOLET, WHITE, INK, VIOLET, None),
    "on-white": (VIOLET, WHITE, INK, VIOLET, WHITE),
    "on-ink": (VIOLET, WHITE, WHITE, VIOLET, INK),
    "on-violet": (WHITE, VIOLET, WHITE, WHITE, VIOLET),
    "mono-black": (INK, WHITE, INK, INK, None),
    "mono-white": (WHITE, INK, WHITE, WHITE, None),
}


def horizontal(name):
    mbg, mfg, wc, tc, page = VARIANTS[name]
    size, gap, pad = 120, 36, 60
    word, w = wordmark(0, 0, 100, wc, tc)
    width = pad + size + gap + w + pad
    height = pad + size + pad
    body = mark(pad, pad, size, mbg, mfg)
    # Baseline: the wordmark's x-height centered on the mark. Jakarta's
    # x-height at 100 units is ~54, ascender ~74; centering the lowercase body
    # on the mark's middle reads even, the «t» pokes above by design.
    baseline = pad + size / 2 + 27
    body += f'<g transform="translate({pad + size + gap},{baseline})">' + word + "</g>"
    return svg(width, height, body, page)


def vertical(name):
    mbg, mfg, wc, tc, page = VARIANTS[name]
    size, gap, pad = 160, 40, 60
    word, w = wordmark(0, 0, 76, wc, tc)
    width = pad + max(size, w) + pad
    height = pad + size + gap + 76 * 0.54 + 76 * 0.2 + pad
    body = mark((width - size) / 2, pad, size, mbg, mfg)
    baseline = pad + size + gap + 76 * 0.54
    body += f'<g transform="translate({(width - w) / 2},{baseline})">' + word + "</g>"
    return svg(width, height, body, page)


def wordmark_only(name):
    _, _, wc, tc, page = VARIANTS[name]
    pad = 60
    word, w = wordmark(0, 0, 100, wc, tc)
    width, height = pad + w + pad, pad + 100 + pad
    body = f'<g transform="translate({pad},{pad + 74})">' + word + "</g>"
    return svg(width, height, body, page)


def mark_only(name, shape):
    mbg, mfg, _, _, _ = VARIANTS[name]
    return svg(512, 512, mark(0, 0, 512, mbg, mfg, shape))


def png(svg_path: Path, png_path: Path, scale=2):
    head = svg_path.read_text().split(">", 1)[0]
    w = int(float(head.split('width="')[1].split('"')[0]) * scale)
    h = int(float(head.split('height="')[1].split('"')[0]) * scale)
    html = OUT / ".render.html"
    html.write_text(
        f'<body style="margin:0;background:transparent"><img src="{svg_path.name}" '
        f'style="width:{w}px;height:{h}px;display:block"></body>'
    )
    subprocess.run(
        [CHROME, "--headless", "--disable-gpu", "--hide-scrollbars",
         "--default-background-color=00000000", f"--window-size={w},{h}",
         f"--screenshot={png_path}", f"file://{html}"],
        check=True, capture_output=True,
    )
    html.unlink()


def main():
    files = {}
    for name in VARIANTS:
        files[f"lockup-horizontal-{name}"] = horizontal(name)
        files[f"lockup-vertical-{name}"] = vertical(name)
        files[f"wordmark-{name}"] = wordmark_only(name)
    for name in ("color", "mono-black", "mono-white", "on-violet"):
        files[f"mark-square-{name}"] = mark_only(name, "square")
        files[f"mark-circle-{name}"] = mark_only(name, "circle")
    for stem, content in files.items():
        (OUT / f"{stem}.svg").write_text(content)
        png(OUT / f"{stem}.svg", OUT / f"{stem}.png")
    # Instagram avatar and favicon sizes from the colour marks.
    for size in (1080, 512, 192, 32):
        for shape in ("circle", "square"):
            png(OUT / f"mark-{shape}-color.svg", OUT / f"mark-{shape}-{size}.png", size / 512)
    print(f"{len(files)} SVGs + PNGs in {OUT}")


if __name__ == "__main__":
    main()
