# tuagente.uy brand kit

Built by `build.py` (needs `fontTools`; PNGs rendered with headless Chrome).
Every SVG has the wordmark outlined, so nothing depends on a font being
installed. PNGs are 2x the SVG size, transparent where no page colour is set.

| File | What it is |
|---|---|
| `lockup-horizontal-<variant>` | mark + «tuagente.uy» side by side, the default |
| `lockup-vertical-<variant>` | mark above the wordmark, for square spaces |
| `wordmark-<variant>` | «tuagente.uy» alone |
| `mark-square-<variant>` | the mark as the landing draws it, 22% radius |
| `mark-circle-<variant>` | the mark for round avatars (Instagram, WhatsApp) |
| `mark-{circle,square}-{1080,512,192,32}.png` | avatar and favicon sizes, colour |

Variants: `color` (transparent), `on-white`, `on-ink` (`#14131F`), `on-violet`
(white mark, violet bot), `mono-black`, `mono-white`.

Rules: the mark is Lucide's `bot` on `#5B4BE8`, never redrawn; the wordmark is
Plus Jakarta Sans ExtraBold with -0.02em tracking, «.uy» in violet on light
and dark, white on violet; clear space around any lockup is the mark's width;
the wordmark's x-height is centred on the mark. Don't stretch, outline,
shadow or recolour outside these variants.
