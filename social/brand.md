# tuagente.uy on Instagram — brand identity

Internal doc (English). Everything the audience reads is Spanish, rioplatense,
`vos`. This file is what the `ig-post` skill reads before writing anything.

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
- Hecho en Montevideo por pdelabs. Somos nuestro propio cliente: Mr.Wobbles.
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
4. **Somos nuestro propio cliente** — Mr.Wobbles working for pdelabs, building
   in public, Uruguay. Formats: `chat`, `statement` light theme.
5. **El bautismo** — name + face, the dice, why a name changes how people
   treat it. Formats: `statement` with agentito large, carousel of faces.

## Visual identity

Same system as the landing and the portal. No new colors, no new fonts.

- **Type:** Plus Jakarta Sans (variable, in `social/fonts/`). Headlines 800,
  tight tracking, `line-height 1.05`. Body 500. Never ALL CAPS in headlines.
- **Colors:** primary `#5B4BE8`, ink `#14131F`, surface `#FBFAFF`. Tonal
  containers violet `#EAE6FF/#241663`, green `#CFF3E4/#0B3B2C`, coral
  `#FFDFD6/#4A1405`, amber `#FBEECB/#4A3608`. Dark card `#161522`.
- **Themes** (`theme` in `post.json`): `violet` (hero, the OG gradient),
  `ink` (dark, for the honest/serious posts), `light` (surface + aurora, for
  behind-the-scenes), `tonal-violet` / `tonal-green` / `tonal-coral` /
  `tonal-amber` (one per job, like the landing cards).
- **Shape:** big radii (32px cards, pill buttons), hairline borders, soft or
  no shadows. Lots of air. One agentito per image at most.
- **Mascot:** the agentito, always drawn by `app/app/lib/agentito-svg.mjs`
  (never a screenshot). Default brand look = the landing's baptism look
  `{tone:0, antenna:5, accessory:0, pupil:1, mouth:1, skin:1, suit:0, brows:1}`.
  Mr.Wobbles (pillar 4 only) = `{tone:3, antenna:0, accessory:1, pupil:0,
  mouth:0, skin:0, suit:1, brows:1}`. Other looks only for "el bautismo"
  posts showing the dice.
- **Nothing on the image but the piece itself.** No mark, no wordmark, no
  `tuagente.uy`, no handles, no URLs, no slide counter: the account name is
  already on the post. On a generated image the only text is the headline
  the brief lists, word for word. (The template renderer used to stamp the
  mark top-left; that rule is gone on 2026-09-14 by Luis' decision.)
- **Formats:** feed `1080x1350` (default, 4:5), square `1080x1080` (only if
  asked), story `1080x1920`. Carousels: 4 to 7 slides, first one is the hook,
  last one is the CTA (`statement` with `cta`).
- **Accent inside a headline:** wrap the one phrase that matters in `<em>`;
  the theme colors it. One `<em>` per headline, max.

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
