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

## Mr. Wobbles, our own agent

`mr-wobbles.png` (416 px, transparent) is the one and only picture of
Mr. Wobbles: the amber `#F0B429` head with the glasses, the bow tie and the
antenna. He is the agent tuagente.uy runs for itself, the proof that we are
our own client. He is a character, not the brand: the brand is the mark above.

- **Where he goes:** the landing's "somos nuestro propio cliente" section, the
  portal's own instance (his avatar), a story or a post that is literally
  about him doing our work. Nothing else.
- **How often:** rarely. At most one post in ten, never two in a row, never
  as decoration on a post that is about something else. He is a cameo; if he
  shows up every day he becomes the mascot, and the brand is the mark.
- **Never with the mark in the same composition.** One face per piece: the
  mark stands for the product, Mr. Wobbles stands for one agent. Side by side
  they read as two brands.
- **Never redrawn.** Not by hand, not by an image model, not "in the style
  of". This file, scaled, is the only Mr. Wobbles. If a piece needs him at a
  size or in a pose this file doesn't give, the piece changes, not him.
- **Never recoloured, cropped through the face, flipped, or given a
  background gradient.** On ink or violet he sits as is; on amber he does not
  go at all (he disappears).
- **Clear space:** the width of his antenna ball on every side. Minimum size
  48 px tall; below that only the mark.
