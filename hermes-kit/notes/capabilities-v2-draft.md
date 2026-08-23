# Capabilities v2 — draft to prune

> SUPERSEDED on 8/19: the final list with evidence and a devil's-advocate
> pass is in `capabilities-50-verdict.md` (research in
> `capabilities-research/`). This draft stays as the history of rounds 1-2.

8/18/2026, round 2 on 8/19. Proposal for an expanded catalog (6 entries
today, all content). This is the **what**: labels, purpose, and technical
backing. The **how** for each entry (`detects`/`verifies`/`installs`, which
is the expensive part) only gets written once the entry survives the
pruning. Mark rows with ~~strikethrough~~ or delete them.

## Curation rules (proposed, up for debate)

1. **The border with connections**: if it needs one of the client's own
   accounts (WhatsApp, Google, Mercado Pago, Instagram, email, DGI), it's a
   **connection** and lives in `connections/catalog.json`. Capability = an
   in-house skill of the agent, no client credential involved.
2. **What the model already does isn't a capability**: translating,
   summarizing, drafting. We don't sell empty rows.
3. **A role's flow ≠ a capability**: "content calendar" is a marketing flow;
   "generate images" is a capability. Capabilities are cross-cutting tools
   any role can request.
4. **One entry = one job the client understands** (a rule already in the
   catalog). Under the hood it can be a toolset + config + kit skill.

## Schema change

Every entry gets a `level: "base" | "menu"`:

- **base** — ships on EVERY agent, it's not chosen or billed separately. On
  the role's profile it shows as "included" (it sells, but it isn't a
  button).
- **menu** — chosen per role; generates a request; we install it.

And a `status` (only during the build): `existing` | `new-engine` (just an
engine knob/config) | `new-kit` (a skill needs to be written) |
`under-evaluation`.

## BASE level (3)

| id | label | purpose | backing |
|---|---|---|---|
| `calc-and-spreadsheets` (calculo-y-planillas) | Cálculos, planillas y documentos | Procesa tus datos, arma planillas y documentos (Excel, Word, PDF) sin pedirte nada. | the `code_execution` toolset + stock `xlsx`/`docx`/`pdf` (already on the allowlist) |
| `vision` | Ver lo que le mandás | Le mandás una foto de la factura, una captura o un PDF escaneado y lo lee. | the `vision` toolset + stock `ocr-and-documents` |
| `web-search` (busqueda-web) | Buscar en internet | Busca y lee páginas para responderte con datos de hoy. | the `web` toolset + Tavily (decided 8/19: moves from menu to base) |

Notes: `calc-and-spreadsheets` unlocks accounting's main work; `vision`
unlocks "just send a photo" across every role. WATCH OUT with `web-search`
at base level: the search key adds to the **fixed cost of every agent** —
measure it together with the per-role cost. `browse-sites` (navegar-sitios)
is a base candidate but stays on the menu until the toolset is tamed (a
history of problems; a 6.2 KB schema on every request).

## MENU level

### group: content

| id | label | purpose | backing | status |
|---|---|---|---|---|
| `images` (imagenes) | Imágenes para publicaciones | (unchanged) | `image_gen` openrouter | existing |
| `social-formats` (formato-redes) | Medidas y formatos de redes | (unchanged) | kit skill | existing (skill not written yet) |
| `brand-kit` | Kit de marca | (unchanged) | kit skill | existing |
| `social-content` | Contenido para Instagram | (unchanged) | kit skill | existing |
| `post-image` | Placas de tus posteos | (unchanged) | kit skill | existing |
| `linkedin-content` (contenido-linkedin) | Contenido para LinkedIn | Posteos con la estructura y los límites de LinkedIn, que no son los de Instagram: más texto, otro tono, sin hashtags de relleno. | a new kit skill (sibling of social-content, reuses brand-kit) | new-kit |
| `video` | Clips cortos | Videos breves generados para historias y reels. | the `video_gen` toolset | under-evaluation — the bfl plugin requires a paid Nous account; don't promise it until cost and the path are tested |
| `image-editing` (edicion-de-imagenes) | Retocar tus fotos | Recortar, sacar el fondo, llevar a la medida que pide cada red: tus fotos, no generadas. | code_execution + image libraries | under-evaluation — check which libraries the engine's image ships with |
| `simple-pages` (paginas-simples) | Páginas web simples | Una landing, un menú, una invitación: páginas armadas y listas para compartir. | HTML artifacts (already exist) + kit skill | new-kit |
| `product-catalog` (catalogo-de-productos) | Catálogo de productos | Tu catálogo armado y al día: fotos, precios, en PDF o como página. | a new kit skill on top of base + artifacts | new-kit |
| `qr-and-labels` (qr-y-etiquetas) | QR y etiquetas | Códigos QR y etiquetas para tus productos, listos para imprimir. | code_execution + a qr library | under-evaluation — check the library is in the image |

### group: information

| id | label | purpose | backing | status |
|---|---|---|---|---|
| `browse-sites` (navegar-sitios) | Entrar y usar páginas | Para lo que una búsqueda no alcanza: entrar a un sitio, apretar botones, llenar un formulario, leer lo que solo se ve navegando. | the `browser` toolset | new-engine — a base candidate once it's tamed |
| `web-monitoring` (monitoreo-web) | Vigilar páginas | Mira una página cada tanto —precios de la competencia, licitaciones, stock de un proveedor— y te avisa cuando cambia. | a new kit skill on top of `web` + native cron | new-kit |
| `uy-public-records` (registros-publicos-uy) | Registros públicos de Uruguay | Consulta lo público: el RUT de un cliente, licitaciones, BPS. | a new kit skill on top of `web`/`browser` | under-evaluation — test which sites can actually be read |
| `knowledge-base` (base-de-conocimiento) | Preguntas y respuestas de tu negocio | Arma la base de respuestas de tu negocio y la usa para contestar siempre igual. | a new kit skill (files in the workspace) | new-kit |

### group: audio-and-voice

| id | label | purpose | backing | status |
|---|---|---|---|---|
| `transcription` (transcripcion) | Audios a texto | Le mandás un audio o la grabación de una reunión y te la devuelve escrita. | the `transcribe` kit skill (already exists in the kit, not installed by default today) | new-kit (package it) |
| `meeting-summaries` (resumen-de-reuniones) | Minutas de reuniones | De la grabación a la minuta: qué se acordó, qué quedó pendiente y de quién. | a new kit skill; needs `transcription` | new-kit |
| `voice` (voz) | Que te conteste con audio | Respuestas habladas por los canales que lo soportan. | the `tts` toolset (turned off for everyone today to save context; this capability turns it back on) | new-engine |
| `subtitles` (subtitulos) | Subtítulos para tus videos | Subtitula los videos que le mandás, listos para publicar. | a new kit skill; needs `transcription` | new-kit — doubtful, does anyone actually ask for it? |

### group: documents-and-data

| id | label | purpose | backing | status |
|---|---|---|---|---|
| `invoices-to-data` (facturas-a-datos) | Cargar facturas | De la foto o el PDF de la factura a la fila de la planilla, sin tipear. | a new kit skill on top of base (`vision` + `calc-and-spreadsheets`) | new-kit — accounting ships with it on |
| `branded-reports` (reportes-con-marca) | Informes con tu identidad | Los informes salen en PDF con tus colores, tu logo y tu tipografía. | a new kit skill; needs `brand-kit` | new-kit |
| `quotes` (presupuestos) | Presupuestos y cotizaciones | Arma presupuestos con tu formato y tus condiciones, listos para mandar. | a new kit skill on top of base | new-kit — sales ships with it on |
| `presentations` (presentaciones) | Presentaciones | Arma la presentación desde tus datos, lista para proyectar. | code_execution + pptx | under-evaluation — check python-pptx is in the image |
| `diagrams` (diagramas) | Diagramas y organigramas | Procesos, equipos, flujos: dibujados y listos para presentar. | mermaid (the portal already renders it) + kit skill | new-kit |
| `data-analysis` (analisis-de-datos) | Análisis de tus números | Te dice qué ve en tus planillas y te lo grafica. | code_execution + kit skill | new-kit |
| `documents-from-templates` (documentos-desde-modelos) | Documentos desde tus modelos | Tu modelo de contrato, nota o remito, completado con los datos de cada caso. | stock `docx` + a templates kit skill | new-kit |

## Assistant: how it picks capabilities (closed 8/19)

One mechanism, three moments:

1. **Sign-up**: "¿qué necesitás que haga?" as free text → the adapter
   matches it against the catalog with a short prompt straight to the
   provider (same pattern as the room router, ~300 tokens; the role doesn't
   exist yet but the adapter does) → suggested capabilities, already
   checked, editable → naming.
2. **While working** (already exists): the `capability` skill — delivers,
   says what was missing, `capability:id` card.
3. **Building a flow** (new): "for this flow I'd need to learn: …" → same
   cards, always asking, never installing on its own.

Guardrail that does NOT get touched: the agent only picks IDs from the
catalog — it has nowhere to write a free-text request. Whatever isn't in
the catalog, it says in the conversation, and if the client wants, the
request travels **in the client's own words** as a ticket for us: it
reaches us as a candidate for a new entry. We keep writing the catalog
ourselves.

For the sign-up screen: the Assistant adds a step — role → "¿qué vas a
hacer?" → suggested capabilities → naming.

## Out of the menu (decided earlier, written down for the record)

`computer_use`, `terminal` (for the client; the agent still uses it),
`delegation`, `homeassistant`, `spotify`, `discord_admin`.

## Cut from this draft (revive if you want)

- `content-calendar` (calendario-de-contenido), `lead-tracking`
  (seguimiento-de-leads) — role flows, not capabilities (rule 3).
- `translation` (traduccion), `summaries` (resumenes) — the model already
  does this (rule 2).
- `e-invoice-dgi` (factura-electronica-dgi), `read-email` (leer-correo),
  `calendar` (agenda) — connections (rule 1).
- `reminders` (recordatorios) — native cron, everyone already has it (it's
  the Tasks tab).
- `maps` (mapas) — no real backing in the engine, and no client use case.
- `forms-and-surveys` (formularios-y-encuestas) — collecting responses
  needs a backend that doesn't exist.

## What each role ships with out of the box (proposal)

| role | included menu capabilities |
|---|---|
| marketing | brand-kit, social-content, post-image, images, social-formats |
| support | transcription, knowledge-base |
| sales | quotes, product-catalog |
| accounting | invoices-to-data |
| **assistant** (still to be created) | none fixed: base + whatever comes out of "¿qué vas a hacer?" during sign-up |

## Proposed build order (post-pruning)

1. The three base ones — engine knobs, no new skill, and they unlock
   accounting and search for everyone.
2. `transcription` (the skill already exists, it's just packaging).
3. `browse-sites` (a knob; test whether it can be tamed → base).
4. The new kit skills, by real demand: `invoices-to-data` and `quotes`
   first (roles already sold ask for them), then the content and office
   ones.
5. The `under-evaluation` ones only after checking libraries/cost in the
   image.
6. `voice`, `video`, `subtitles` last, or never.

Cost reminder: every installed capability enters the system prompt on
EVERY request the role makes (tool schemas weigh ~2x the SOUL). The
per-role menu isn't just commercial: it's context control.
