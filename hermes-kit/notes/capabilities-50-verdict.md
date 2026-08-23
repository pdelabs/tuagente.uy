# Capabilities: 50 candidates, evidence, and verdict

8/19/2026. Three independent research pieces (Uruguayan SMBs via
ANDE/INE/UTDT-Fundar; global/LATAM demand signal via pricing pages and churn
data; maturity and technical cost of each capability) cross-checked against
50 candidates, with a devil's-advocate pass. Supersedes the list in
`capabilities-v2-draft.md`. The three full reports, with every link, are in
`notes/capabilities-research/`.

## What the evidence screamed (read before the list)

1. **Our catalog was upside down.** The 6 current entries are
   marketing/content, but when a Uruguayan SMB PAYS for help, it's for
   admin/accounting/finance (65% of the consulting hired, ANDE/INE 2024).
   What gets bought with retention: answering the channel, scheduling,
   **quoting fast, collecting payment, reconciling, transcribing** — and only
   after that, the post with its image.
2. **A "single-verb" capability churns.** Jasper −87%, Midjourney −46%,
   Grammarly −29% in 90 days: the general-purpose assistant absorbs them.
   Retention lives in the ROLE that finishes the work; the capability is an
   enabler, not the product. The card's copy sells the finished work, never
   "image generation".
3. **The Uruguayan market is smaller and more precarious than we assumed**:
   93.3% of companies have 1-9 employees, two-thirds of micro-businesses are
   self-employment, only half keep records of income/expenses. The headroom
   is in basic back-office work, not sophistication.
4. **WhatsApp/IG/MELI ARE the storefront; a company's own website doesn't
   exist** (54.6% "don't need one"; messaging = the #1 online sales channel
   at 39-43%).
5. **Price**: the AI WhatsApp chatbot sells for US$45-199/month in LATAM.
   Our ~US$25/role sits BELOW that anchor — there's margin, don't give it
   away.
6. **What breaks the US$25/role isn't the capabilities** (image
   US$0.005-0.06; transcription US$0.006/min) **it's uncapped agentic
   loops** (5-50x the tokens of a chat) — plus video (US$1.5-12/clip),
   premium TTS, and hourly monitoring (US$36-58/month; daily costs US$1-2).

## BASE LEVEL (4) — on every agent

| id | label | why base |
|---|---|---|
| `calc-and-spreadsheets` (calculo-y-planillas) | Cálculos, planillas y documentos | Mature office skills; the precarious back-office IS the pain point; it unlocks accounting. |
| `vision` | Ver lo que le mandás | OCR 94-98% on clean documents; "just send a photo" is the LATAM interaction pattern (Pix-by-photo validated it). WATCH OUT: it hallucinates plausible amounts 1-3% of the time — anything headed to accounting goes through approval. |
| `web-search` (busqueda-web) | Buscar en internet | The #1 reported use of AI at work in Uruguay (UTDT 2025). With a usage cap: Tavily ~US$8/1k. |
| `transcription` (transcripcion) | Audios a texto | **PROMOTED from menu to base.** The #1 use case of Zapia (1M LATAM users); Meta made it native in WhatsApp (June 2026) ⇒ it's a hook, not a product: charging for it separately means selling what's already free. Costs pennies. |

## CORE MENU (10) — strong evidence, these sell

| id | label | evidence | DA / watch-out |
|---|---|---|---|
| `quotes` (presupuestos) | Presupuestos y cotizaciones al toque | The strongest finding of the research: quoting by hand takes 2-4h, the client expects <24h, speed closes sales; standalone products at US$30-40/month; ROMA AI (UY) automates it for 24 SMBs. Combo with `vision`: a quote straight from a photo. | The client's template first, the client's numbers always. |
| `invoices-to-data` (facturas-a-datos) | Cargar facturas | Data entry = 43% of what gets automated in accounting (Intuit); mandatory e-invoicing in Uruguay since 1/1/2026 is pushing small businesses to digitize. Mature OCR. | Human in the loop ALWAYS (amount hallucination). DGI stays read-only, untouchable. |
| `collections-followup` (seguimiento-de-cobranzas) | Cobranzas al día | AP/AR = 46% of what's automated (Intuit); ROMA lists it; bank transfer dominates in Uruguay (72-84%) ⇒ reconciling against the statement matters. | The capability tracks and drafts; SENDING goes through channels/approval. |
| `social-package` (paquete-social) | Tus redes con tu identidad | Marketing = the #1 adoption case (Verizon 28%); Canva with 45M SMBs. BUT a standalone image capability churns and "AI slop" burns brands. | The PACKAGE is what sells (brand-kit + social-content + post-image + images + social-formats as internal pieces), never standalone "images". brand-kit is the anti-slop moat. |
| `meeting-summaries` (resumen-de-reuniones) | Minutas de reuniones | THE proven combo of the moment (Fireflies/Fathom/Otter, a mature market). With transcription at base level, this is the natural upsell. | Whisper invents phrases ~1% of the time (silences): don't promise a literal transcript for anything legal. |
| `knowledge-base` (base-de-conocimiento) | Respuestas de tu negocio | FAQs = the #1 agent use case (Salesforce); it's what makes support sellable. | A bot that answers badly raises end-customer churn by 67%: a quality gate and an honest "I don't know". The typical failure is a stale knowledge base — keeping it current is part of the capability. |
| `web-monitoring` (monitoreo-web) | Vigilar páginas | Price-watching is a real market (US$1.2B); popular n8n templates. | Fixed DAILY cadence (hourly = US$36-58/month). Via a search API, not a browser: Cloudflare has blocked agents since 2025. |
| `uy-tenders` (licitaciones-uy) | Licitaciones y compras estatales | 4 local tools exist ONLY for this (Tenderis, Gubly, ialicitaciones, ProveedorUY) = a validated pain point; 8-business-day windows demand active monitoring. | Local competition exists; for us it's a role capability, not a standalone product. ARCE's open data as a stable path in. |
| `product-catalog` (catalogo-de-productos) | Tu catálogo en tus canales | REPOSITIONED: not a PDF or a website — a catalog FOR WhatsApp/IG/MELI, which is where they actually sell (messaging is #1; MELI is the reference for 72%). Gorillaz case: orders validated against inventory. | Publishing to the channel requires a connection; the capability builds and maintains it, connecting the channel goes through Connections. |
| `customer-memory` (memoria-de-clientes) | Ficha de cada cliente | The LATAM chatbot sells WITH a basic CRM (US$59-199/month); "personalized recommendations" is at the top of Salesforce's list. | CRM-lite inside the workspace, not a CRM: don't promise a pipeline. |

## EXTENDED MENU (12) — medium evidence, prunable additions

| id | label | short note |
|---|---|---|
| `data-analysis` (analisis-de-datos) | Qué dicen tus números | "Data analysis" = a top reported use case in Uruguay; only half of micro-businesses keep records ⇒ whoever does record wants to read them. Simple spreadsheets are mature; auditing someone else's spreadsheet succeeds <35% of the time — don't promise that. |
| `stock-control` (control-de-stock) | Stock con alertas | Gorillaz validates orders against inventory; neighborhood retail. In a spreadsheet, minimum-stock alerts. |
| `documents-from-templates` (documentos-desde-modelos) | Documentos desde tus modelos | Mature office tooling; contracts/delivery notes/memos. Medium demand. |
| `branded-reports` (reportes-con-marca) | Informes con tu identidad | Cheap, a visual differentiator; needs brand-kit. |
| `image-editing` (edicion-de-imagenes) | Fotos de producto listas | REFOCUSED on product photos (background, lighting, sizing): it's what Tiendanube/MELI validate with their own AI. Under evaluation: libraries in the engine's image. |
| `company-research` (investigacion-de-empresas) | Dossier de una empresa | Deep research is mature (93.9% SimpleQA); our own 43 dossiers prove it internally. For B2B/professional services. |
| `linkedin-content` (contenido-linkedin) | Contenido para LinkedIn | Niche: professional self-employment (2/3 of micro-businesses) lives there. Reuses brand-kit. |
| `bank-reconciliation` (conciliacion-bancaria) | Extracto vs planilla | Real demand (bookkeeping US$69-199/month); structured matching, a human confirms. Under evaluation. |
| `uy-payroll-calcs` (calculos-laborales-uy) | Aguinaldo, licencia, BPS | Proven recurrence (the press re-explains it every half-year; Clean-In case: settlements 15→1). LEGAL WATCH-OUT: a calculator citing an official source, "your accountant confirms" — never advice. Review before selling. |
| `presentations` (presentaciones) | Presentaciones | pptx is technically mature; soft demand among 1-9-employee SMBs. Under evaluation (library). |
| `appointments-and-scheduling` (turnos-y-agenda) | Agenda de turnos | STRONG demand (scheduling = a top-3 purchase driver) but the honest version needs the calendar/channel connection. WAITS on the google-workspace connection; don't sell the crippled version. |
| `review-replies` (respuestas-de-resenas)* | (evaluate as a support flow, not a capability) | Drafting is native to the model; publishing needs a connection. If it goes in, it goes in as a flow. |

## INTERNAL — they exist but don't sell as a row

- `browse-sites` (navegar-sitios) (browser): **DOWNGRADED from "base
  candidate" to internal.** The evidence was brutal: ~60% success vs 78%
  human, CAPTCHAs fail 36% of the time, Cloudflare blocks agents by default,
  Operator is deprecated. It stays as an enabler behind monitoring/tenders
  where the flow is narrow and tested. Don't promise a client "it goes in
  and handles the paperwork".
- `diagrams` (diagramas) (mermaid): garnish on deliverables, not a sellable
  row.
- `useful-pdfs` (pdf-utiles), `uy-indicators` (indicadores-uy),
  `prices-and-margins` (precios-y-margenes), `periodic-reports`
  (informes-periodicos): dissolve into base + cron; they're not rows.

## OUT (with the why, so it isn't reopened without new data)

| candidate | verdict |
|---|---|
| `video` (video_gen) | US$1.5-12 per 30s clip with retries ⇒ 2/week = US$40-240/month. ALWAYS breaks the price. Revisit once it drops 10x. |
| `voice` (voz) (tts) | The demo→prod gap kills 60% of deployments; premium TTS blows the budget; a16z: no willingness to pay among SMBs outside of "missed call" — and telephony isn't our infra today. Note as a future opportunity (receptionist = a US$49-299/month category that DOES pay). |
| `subtitles` (subtitulos), `template-videos` (videos-con-plantilla) | Riding on video; no signal of their own. |
| `simple-pages` (paginas-simples) | **Uruguay killed it**: 54.6% "don't need a website"; the storefront is WhatsApp/IG/MELI. HTML artifacts stay as a delivery FORMAT, not a sold capability. |
| `qr-and-labels` (qr-y-etiquetas) | No demand signal; if a client asks for it, it comes out of base via code_execution. |
| `translation` (traduccion), `email-drafting` (redaccion-de-mails) | Native to the model — empty rows (the Jasper/Grammarly pattern). |
| `customer-surveys` (encuestas-a-clientes) | Collecting responses needs a backend that doesn't exist. |
| `competitor-analysis` (analisis-de-competencia), `mercadolibre-monitoring` (monitoreo-mercadolibre) | Dissolve into web-monitoring + company-research. |
| `shipment-tracking` (seguimiento-de-envios) | Depends on browsing carrier sites that are hostile to scraping. |
| `bulk-ocr` (ocr-masivo) | A one-off onboarding job, not a subscription: handled with base capabilities when it comes up. |
| `content-calendar` (calendario-de-contenido), `lead-tracking` (seguimiento-de-leads) | Role flows (already decided). |

## Consequences outside the catalog (note them, decide separately)

1. **The accounting/admin role is the most sellable one according to the
   evidence**, not marketing: quoting+collecting+invoices+reconciling is the
   cluster with money in it. The capability build order should follow it.
2. **A token cap per role/capability** isn't optimization, it's price
   survival: the #1 risk to the US$25 is an uncapped loop, not an image.
3. **ANDE "Modo Digital" vouchers** (up to $U 800,000, 60% non-refundable,
   US$7M in 2025-26): a subsidized sales channel — check whether tuagente
   can register as a provider.
4. The #1 adoption barrier in Uruguay = "lack of awareness" (49%), not cost:
   it validates the "we install and audit it" model, and the copy should say
   so.
5. The gap is worse outside Montevideo (less digital capacity, more
   messaging-based sales): the remote-via-WhatsApp product fits there.

## Proposed build order (if the pruning gets approved)

1. Base 4: `calc-and-spreadsheets`, `vision`, `web-search` (knobs) +
   `transcription` (package the existing skill).
2. `quotes` and `invoices-to-data` — the paying cluster, and both are kit
   skills built on base.
3. `meeting-summaries` (riding on transcription) and `knowledge-base`.
4. `collections-followup`, `web-monitoring` (daily), `uy-tenders`.
5. Social package: 80% of it already exists (brand-kit, social-content,
   post-image); only the copy repositioning and `social-formats` are
   missing.
6. The extended menu, driven by real client demand.
