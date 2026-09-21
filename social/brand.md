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

## Visual identity — four looks, one per post

The slides are generated, one prompt each, and the model never sees the
previous slide. So the look is not improvised: it is one of FOUR fixed looks,
chosen once per post and used on every slide of it, and the whole block for
that look goes **verbatim into every brief**, before the slide's text.

One real slide of each look, as the blocks below produce it, is in
`social/looks/`.

A feed of these has to look like ONE ACCOUNT THAT IS ALIVE: the same voice,
the same type, the same three colors — and not the same picture every day.
What makes it one account is pinned below. What makes it alive is the look,
and the look ROTATES: the creator is told which looks the last posts used and
may not repeat them. No look is the default.

There used to be two more, `ink` and `light`: type on a flat dark or
off-white background with thin violet line geometry. They were the only looks
for the first posts, and Luis retired them on 2026-09-21 once the object look
existed: the lines read as a template. They are in the git history.

Which look fits what (a preference, never a reason to repeat one):

- `violet` — a strong opinion, an announcement, a post that has to stop the
  scroll by color alone.
- `amber` — the warm ones: our own agent, a small win, a thank-you, humor.
- `photo` — the jobs. A real place where the work happens, at the hour it
  happens: the counter at eleven at night, the desk with the invoices.
- `object` — one idea as one thing: the clock, the inbox, the receipt.

Pinned, whatever the look:

- **Type:** one geometric sans-serif (Plus Jakarta Sans), extra bold,
  sentence case, left aligned, tight line height. Never ALL CAPS, never
  italics, never a second font.
- **Size by role:** the hook (slide 1) is the biggest, 3 to 5 lines. Middle
  slides one short sentence, a size down. The close is the hook's size again.
- **The three colors:** violet `#5B4BE8`, ink `#14131F`, amber `#F0B429`,
  over white or off-white `#FBFAFF`. Nothing else, in any look: a photo is
  graded toward them, an object is made of them.
- **Accent:** at most ONE phrase per slide gets a rounded marker behind it.
  Which color the marker is belongs to the look. On the close slide it is the
  call's key phrase; on the others the word the sentence turns on, or nothing.
- **No character drawn by the model.** No robot, no mascot, no person's face,
  no icon set. A fixed asset (Mr. Wobbles, `social/logo/kit/mr-wobbles.png`)
  gets onto a slide only through `place_image`, composited by code, and only
  on a post that is about him. The mark never goes on a slide.
- **Nothing on the image but the piece itself.** No mark, no wordmark, no
  `tuagente.uy`, no handles, no URLs, no slide counter, no color codes drawn:
  the account name is already on the post. The only text is the slide's
  line, character by character: the model adds an opening «¿» to anything
  it is told is Spanish, so the brief never mentions the marks; a question
  carries its own «¿» in the text.
- **Layout:** feed `1080x1350` (4:5). Keep the top and bottom 12% empty:
  Instagram crops them in the feed. A slide that will get an asset placed
  bottom-right keeps its text in the top 55% and the brief says only that:
  «the lower-right third of the image stays empty». The brief never mentions
  the asset, a placeholder, or what will go there: told that, the model draws
  a blob for it.
- **One breath per carousel, optional:** a middle slide with no text at all.
  In the two flat looks it is the look's ornament grown into a composition;
  in `photo` it is the photograph alone, with no band; in `object` it is the
  object alone, bigger. Never the hook, never the close, never more than one.
- **One number slide per carousel, optional:** when the idea IS a number
  («23:00», «24 h», «USD 200»), a middle slide can be that number alone, as
  large as the image allows, with one short line under it. Same block, and
  the two lines of text are the number and the line.
- **Formats:** carousel of 3 to 6 slides (default), first is the hook, last
  is the close. Square `1080x1080` and story `1080x1920` only if asked.

After the block, every brief ends with the slide's own two lines: the
headline, and which phrase (if any) gets the marker.

### The `violet` block

```
Instagram slide, 1080x1350 portrait. Flat solid saturated violet background
#5B4BE8, edge to edge, no gradient, no texture, no photo. Headline in a
geometric sans-serif like Plus Jakarta Sans, extra bold, white #FFFFFF,
sentence case, left aligned, tight line height, text block starting 9% from
the left edge, at most 75% wide, vertically centered, top and bottom 12% of
the image empty. If a phrase is marked, it sits on a dark ink #14131F rounded
marker, white text on top. Decoration: big flat shapes only, in a slightly
darker violet than the background, tone on tone — one very large circle or
quarter-circle running off a corner, and one small solid amber #F0B429 dot
as the only other color — never touching the text. No lines, no characters,
no robots, no mascots, no people, no hands, no icons, no 3D objects, no
illustrations, no logos, no
watermarks, no URLs, no slide numbers, no color codes. The ONLY text on the
image is the headline below, reproduced character by character: same words,
same accents, same punctuation, nothing added — no question mark or
exclamation mark that is not in it.
```

### The `amber` block

```
Instagram slide, 1080x1350 portrait. Flat solid warm amber background
#F0B429, edge to edge, no gradient, no texture, no photo. Headline in a
geometric sans-serif like Plus Jakarta Sans, extra bold, dark ink #14131F,
sentence case, left aligned, tight line height, text block starting 9% from
the left edge, at most 75% wide, vertically centered, top and bottom 12% of
the image empty. If a phrase is marked, it sits on a dark ink #14131F rounded
marker, white text on top. Decoration: a loose hand-drawn feeling made of
thick 6px dark ink #14131F strokes only — one wobbly underline or one open
loop running off the edge, and two or three small ink dots — never touching
the text. No characters, no robots, no mascots, no people, no hands, no
icons, no 3D objects, no illustrations, no logos, no
watermarks, no URLs, no slide numbers, no color codes. The ONLY text on the
image is the headline below, reproduced character by character: same words,
same accents, same punctuation, nothing added — no question mark or
exclamation mark that is not in it.
```

### The `photo` block

A `photo` post is ONE PLACE AND A STORY THAT MOVES THROUGH IT. The model
never saw the other slides, so the place is one sentence written once per
post — «a small hardware store in Montevideo, wooden counter, shelves of
boxes behind it» — and pasted word for word where the block says PLACE in
every brief. What comes after it is what changes, and it has to change:
THE MOMENT THIS SLIDE'S SENTENCE IS ABOUT. Another hour, another thing in
the foreground, another distance. The phone lighting up on the dark counter
at night; the shutter going up in grey morning light; a hand typing on the
phone; the door from the pavement with somebody walking in. The first
`photo` post we made said «same place from another angle» here, and came
out as four pictures of a lamp on a desk: a place is not a story, what
happens in it is. Never two slides with the same subject, the same hour or
the same framing.

```
Instagram slide, 1080x1350 portrait. A real editorial photograph, full
bleed, of PLACE. People only as a hand, a back or a silhouette; never a face. Natural light or one warm practical lamp, shallow depth of
field, 35mm, eye level, honest and a little imperfect, never a stock photo.
Color graded dark and warm, with violet #5B4BE8 or amber #F0B429 present in
one object of the scene and nowhere else. The lower 45% of the image fades
into a solid dark ink #14131F band. On that band, the headline in a
geometric sans-serif like Plus Jakarta Sans, extra bold, white #FFFFFF,
sentence case, left aligned, tight line height, starting 9% from the left
edge, set large so that it fills about 80% of the image's width on two or
three lines, bottom 12% of the image empty. If a phrase is
marked, it sits on a violet #5B4BE8 rounded marker, white text on top. No
signs, no screens with readable text, no labels, no brand names anywhere in
the photograph, no logos, no
watermarks, no URLs, no slide numbers, no color codes. The ONLY text on the
image is the headline below, reproduced character by character: same words,
same accents, same punctuation, nothing added — no question mark or
exclamation mark that is not in it.
```

### The `object` block

Every slide of an `object` post is ONE THING, a different one per slide, all
made of the same material. Where the block says OBJECT the brief names it in
a few words: «an old alarm clock», «a paper receipt curling at the end», «a
closed envelope».

```
Instagram slide, 1080x1350 portrait. Flat solid off-white background
#FBFAFF. One single 3D object, OBJECT, made of smooth matte clay in violet
#5B4BE8 with small amber #F0B429 details, soft studio light from the upper
left, a gentle contact shadow, seen at a slight three-quarter angle, sitting
in the lower right of the image and about 40% of its width. Nothing else in
the scene: no second object, no floor line, no props. Headline in a
geometric sans-serif like Plus Jakarta Sans, extra bold, dark ink #14131F,
sentence case, left aligned, tight line height, text block starting 9% from
the left edge, at most 70% wide, in the upper half of the image, top 12%
empty, never overlapping the object. If a phrase is marked, it sits on a
violet #5B4BE8 rounded marker, white text on top. No characters, no faces,
no robots, no mascots, no people, no hands, no logos, no
watermarks, no URLs, no slide numbers, no color codes. The ONLY text on the
image is the headline below, reproduced character by character: same words,
same accents, same punctuation, nothing added — no question mark or
exclamation mark that is not in it.
```

For a breath slide, the same block with the last two sentences replaced by:
«No text at all on this image.» and, in the two flat looks, «The decoration
grows into the whole composition, balanced, with most of the image empty.»

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
