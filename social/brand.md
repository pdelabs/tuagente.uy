# tuagente.uy on Instagram — brand identity

Internal doc (English). Everything the audience reads is Spanish, rioplatense,
`vos`. This file is what the `post` skill reads before writing anything.

## Who we are talking to

The owner or manager of a small company in Uruguay (later LATAM): a clinic, a
workshop, a store, a studio, a service business. They answer WhatsApp
themselves at 11pm. They are not technical and do not want to become
technical. They have been sold chatbots before. They buy trust, not features.

## The one idea

**Un agente de IA que trabaja solo, adentro de tu empresa.** One agent per
company, with the name and face the client gives it. It does concrete jobs
(plugins) written with the client's own process inside. Nothing leaves the
company without the client's ok.

Everything we post is a facet of that idea. If a post does not connect back
to it, it does not go out.

## Voice

- **Plain and concrete.** Name the job, not the technology: "los turnos que
  perdés de noche", never "integración con WhatsApp Business API".
- **Honest to the point of being disarming.** We say what it never does. We
  say we are just starting. We do not invent numbers, logos or testimonials.
- **Rioplatense, `vos`, spoken register.** "Le ponés nombre", "sin vueltas",
  "al toque". No neutral-Spanish marketing voice ("descubre", "optimiza").
- **Short sentences. One idea per slide.** A slide is read in two seconds.
- **The limit makes the promise believable.** Whenever we show a job, we show
  its "nunca". This is the single most distinctive thing in our copy.
- **No hype words:** revolucionario, potenciá, transformá, el futuro es hoy,
  IA de última generación. No exclamation marks in headlines.
- **No emojis.** Not in images, not in captions. Icons and the agentito do
  that work. Hashtags only at the end of the caption.

## Claims we can make (and only these)

Everything verifiable against the landing (`app/page.tsx`):

- Trabaja 24/7. Un agente por empresa, aislado, con su propia clave.
- Lo bautizás vos: nombre y cara (el dado).
- Cada trabajo es un plugin escrito con tu proceso adentro, con su "nunca".
- Portal: ves qué hizo, qué espera tu ok, qué produjo. Lo frenás con un botón.
- Lo que sale para afuera (mail, posteo, presupuesto) espera tu aprobación.
- El diagnóstico sale **USD 200** y se descuenta si seguís. Es el único precio
  que existe: setup y mensual "se cotizan en el diagnóstico". Never post any
  other number.
- Corre sobre Hermes (Nous Research), open source.
- Hecho en Montevideo por pdelabs. Somos nuestro propio cliente: Mr. Wobbles.
- Conexiones listas hoy: Telegram, correo, Google Planillas/Drive/Agenda/Docs,
  Slack, WhatsApp. Anything else is "lo escribimos a medida".

Never: client names, counts of clients, productivity multipliers, "el #1",
screenshots of real client data.

## The jobs (the content that sells)

Each one with its "nunca". Reuse verbatim or tighten, never soften the limit.

| Job | Nunca |
|---|---|
| Los turnos que perdés de noche (WhatsApp fuera de hora) | inventa un precio ni una fecha; si no lo tiene escrito, avisa que lo confirmás vos |
| Presupuestos y seguimiento | manda un presupuesto sin tu ok, ni cierra un precio ni promete una entrega |
| Facturas de proveedores | factura, paga ni presenta nada; mira, ordena y avisa |
| Instagram sin escribir los domingos | publica nada sin tu aprobación |
| Audios y reuniones, en texto | manda para afuera nada de lo que escuchó |

## Content pillars (rotate; never two of the same in a row)

1. **Qué le pedís** — one job per post, with its "nunca". Formats: `job`,
   carousel of jobs, `chat` showing the job happening.
2. **Quién manda** — control, portal, approvals, pause button. Formats:
   `statement`, `chat` (owner asks, agent reports), `list` carousel.
3. **Sin humo** — education from the blog: agente vs chatbot, qué es un
   agente, cuánto cuesta, por qué la gente normal no usa agentes. Formats:
   `list` carousel, `stat`, `statement` with a quote.
4. **Somos nuestro propio cliente** — Mr. Wobbles, our own agent, working for
   pdelabs, building in public, Uruguay. He is named, not drawn (see Visual
   identity). At most one post in ten is about him.
5. **El bautismo** — name + face, the dice, why a name changes how people
   treat it. Formats: `statement` with agentito large, carousel of faces.

## Visual identity — two looks, one per post

The slides are generated, one prompt each, and the model never sees the
previous slide. So the look is not improvised: it is one of TWO fixed looks,
`ink` or `light`, chosen once per post and used on every slide of it, and the
whole block for that look goes **verbatim into every brief**, before the
slide's text. A feed of these has to look like one account with two moods,
not like five templates.

Which look: `ink` is the default and the one for the jobs, the control and
the honest posts. `light` is for the money, the process and the
behind-the-scenes posts, and for breaking a run of three ink posts in the
feed. Never both inside one carousel.

Shared by both looks:

- **Type:** one geometric sans-serif (Plus Jakarta Sans), extra bold,
  sentence case, left aligned, tight line height. Never ALL CAPS, never
  italics, never a second font.
- **Size by role:** the hook (slide 1) is the biggest, 3 to 5 lines. Middle
  slides one short sentence, a size down. The close is the hook's size again.
- **Accent:** at most ONE phrase per slide gets a violet `#5B4BE8` rounded
  marker behind it, white text on top. On the close slide that is the call's
  key phrase; on the others the word the sentence turns on, or nothing.
- **Ornament:** thin violet `#5B4BE8` line geometry, 2px, and nothing else:
  one large arc or rounded-rectangle outline running off the edge, a small
  solid violet dot where a line ends, optionally a small grid of violet dots
  in a corner. Never touching the text.
- **No character drawn by the model.** No robot, no mascot, no person, no
  hand, no icon, no 3D object, no illustration. A fixed asset (Mr. Wobbles,
  `social/logo/kit/mr-wobbles.png`) gets onto a slide only through
  `place_image`, composited by code, and only on a post that is about him.
  The mark never goes on a slide.
- **Nothing on the image but the piece itself.** No mark, no wordmark, no
  `tuagente.uy`, no handles, no URLs, no slide counter, no color codes drawn:
  the account name is already on the post. The only text is the slide's
  line, character by character: the model adds an opening «¿» to anything
  it is told is Spanish, so the brief never mentions the marks; a question
  carries its own «¿» in the text.
- **Layout:** feed `1080x1350` (4:5). Text block starts 9% in from the left,
  is at most 75% wide, and sits at the vertical center. Keep the top and
  bottom 12% empty: Instagram crops them in the feed. A slide that will get
  an asset placed bottom-right keeps its text in the top 55%.
- **One shapes-only slide per carousel, optional:** a middle slide with no
  text at all, only the look's ornament grown into a composition (arcs,
  outlines, dots, one violet solid shape) as a breath between two ideas.
  Never the hook, never the close, never more than one.
- **Formats:** carousel of 3 to 6 slides (default), first is the hook, last
  is the close. Square `1080x1080` and story `1080x1920` only if asked.

### The `ink` block

```
Instagram slide, 1080x1350 portrait. Flat solid dark background #14131F, no
gradient, no texture, no photo. Headline in a geometric sans-serif like Plus
Jakarta Sans, extra bold, white #FFFFFF, sentence case, left aligned, tight
line height, text block starting 9% from the left edge, at most 75% wide,
vertically centered, top and bottom 12% of the image empty. Decoration: thin
2px violet #5B4BE8 line geometry only — one large arc or rounded-rectangle
outline running off the edge, a small solid violet dot where a line ends,
optionally a small grid of violet dots in one corner — never touching the
text. No characters, no robots, no mascots, no people, no hands, no icons,
no 3D objects, no illustrations, no logos, no watermarks, no URLs, no slide
numbers, no color codes. The ONLY text on the image is the headline below,
reproduced character by character: same words, same accents, same
punctuation, nothing added — no question mark or exclamation mark that is
not in it.
```

### The `light` block

```
Instagram slide, 1080x1350 portrait. Flat solid off-white background
#FBFAFF, no gradient, no texture, no photo. Headline in a geometric
sans-serif like Plus Jakarta Sans, extra bold, dark ink #14131F, sentence
case, left aligned, tight line height, text block starting 9% from the left
edge, at most 75% wide, vertically centered, top and bottom 12% of the image
empty. Decoration: thin 2px violet #5B4BE8 line geometry only — one large
arc or rounded-rectangle outline running off the edge, a small solid violet
dot where a line ends, optionally a small grid of violet dots in one corner
— never touching the text. No characters, no robots, no mascots, no people,
no hands, no icons, no 3D objects, no illustrations, no logos, no
watermarks, no URLs, no slide numbers, no color codes. The ONLY text on the
image is the headline below, reproduced character by character: same words,
same accents, same punctuation, nothing added — no question mark or
exclamation mark that is not in it.
```

For a shapes-only slide, the same block with the last two sentences replaced
by: «No text at all on this image. The decoration grows into the whole
composition: two or three arcs and outlines in violet, one solid violet
rounded shape, a grid of dots, balanced, with most of the image empty.»

Then the slide's own two lines: the headline, and which phrase (if any)
gets the violet marker highlight.

## Caption formula

```
Hook (one line, the strongest sentence of the post, no hashtag)

2 to 4 short lines that add what the image does not say. Concrete. `vos`.

Cierre con una sola acción: "Escribinos" / "Link en la bio" / "tuagente.uy".

#tuagente #agentesdeia #iaparaempresas #uruguay #pymesuruguay + up to 3 topical
```

- 400 to 900 characters. First line is the only one shown before "más".
- Alt text per slide (`alt` in `post.json`): what is on the image, in
  Spanish, one sentence. Instagram accepts it; we always ship it.
- CTA per pillar: jobs and control → "Escribinos y te decimos si ya lo
  tenemos escrito"; sin humo → "El artículo completo está en el blog, link en
  la bio"; bautismo and own-client → "tuagente.uy".
- The diagnóstico (USD 200, se descuenta) may appear in the caption of a CTA
  post, never on the image unless the post is about pricing.

## Assumptions to confirm with Luis

- Handle: `@tuagente.uy` is assumed and does not appear on images anyway.
- Link in bio: `https://tuagente.uy`.
- Posting cadence: 3 per week, pillars rotating. Not enforced by tooling.
