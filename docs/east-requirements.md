# East Comunicación (Cata) — requirements dossier

**Why this file exists.** East is a TEST client and it restarts from zero on
the single-agent + plugins model. Every East instance gets deleted; this is the
one thing that survives it. Everything below was read out of the laptop tree
`~/Desktop/Luis/Projects/agente-east/` (169 MB) on **30/8/2026**, READ ONLY,
before any deletion: `state.db` (66,428,928 B — 207 sessions, 9,430 messages),
`kanban.db`, the three `flujos/*/FLUJO.md`, `cron/jobs.json` and its output
directory, `workspace/`, `skills/.usage.json`, `config.yaml` and the SOUL.

The other East tree — `east:/opt/agentes/east` — held none of this. It was an
empty shell (0 sessions, 0 tickets, empty workspace); `docs/east-cutover.md`
established that on 30/8. **The laptop tree was the only East that ever worked**,
and it is what this dossier is made of.

Client copy is quoted in Spanish exactly as it was written. Everything else is
English, per the repo rule.

---

## 1. What she actually did

### 1.1 The shape of the record

| | |
|---|---|
| Human activity window | **6/8/2026 13:57 → 8/8/2026 04:39 UYT** — under three days |
| Human-authored messages, all channels | **30** |
| Sessions | 207: **190 cron**, 11 `api_server` (portal chat), 5 `cli`, 1 `telegram` |
| Messages | 9,430 — 8,948 of them written by the cron |
| Tickets on the board | **6** |
| Deliverables produced | **6** (5 inside flow folders + 1 loose) |
| Artifacts | 2 (both demo pieces: a fake World Cup dashboard, a chart of the cron's own runs) |
| Spend on the client key | **US$3.09 total — US$2.88 (93%) was the cron** |

The 30 human messages are the whole client record, and they split cleanly:

**Real work asks (5).**

- `Hola! me corres el flujo de radio viva para esta noticia? https://radiovivafm.uy/agenda-7-a-9-agosto/`
- `Ejecuta el flujo de entrevista zocalo de esta nota: https://www.youtube.com/watch?v=HGRy8mSFPEQ`
- `Read the latest ny times article then the latest elpais.uy news and see if they are the same`
- `podes hacer un flujo que se fije reguarmente si son la misma?`
- `Hola! te animas a decirme si hicimos algo para los zocalos ya?`

**Onboarding / product probes (4).** `Hola! Quien sos y que vas a hacer por
East? En 3 lineas.` · `me falta conectar algo?` · `tenog slacks nuevos?` ·
`Buenas como te llamabas?`

**Demo probes, not requirements (the rest).** A quadratic equation asked twice
("pensa mas fuerte"), the weight of a polar bear and of an adult manta ray, what
you would ask Stephen King, and an invented World Cup dashboard. These are
Luis exercising the agent, not East asking for work.

**Nobody but Luis was ever on the other end of Telegram.**
`channel_directory.json` lists exactly one peer — `7312460118`, Luis Gurmendez —
and `config.yaml` set the home channel to him "hasta que Cata se empareje".
Cata never paired. The `radio-viva` flow's step 5 ("le mando un mensaje por
Telegram a Cata") would have messaged Luis.

### 1.2 The three flows, quoted

The frontmatter was the old Spanish schema (`nombre`, `gatillo_tipo`,
`gatillo_job`, `conexiones`, `resultados`, `estado`); today's kit writes the
same fields in English (`name`, `trigger_type`, `trigger_job`, …).

#### `entrevistas-tv` — the one the SOUL calls "el principal"

> `para_cliente:` "Cada entrevista nueva que suben a tu Drive termina en
> transcripción completa y 10 zócalos listos para la edición."
> `gatillo_tipo: drive` · `gatillo_detalle:` "Mira tus carpetas de Drive cada 15
> minutos" · `gatillo_cron: "*/15 * * * *"` · **`gatillo_carpetas:` (empty)** ·
> **`gatillo_job:` (empty)** · `conexiones: google-workspace, modelos-auxiliares`
> · `skills: entrada-drive, transcribir, frases-zocalo, entregable`

Body, verbatim:

> Cuando me toca revisar las carpetas (o Cata me pide procesar una entrevista):
>
> 1. Miro si llegaron videos nuevos. Si no hay nada, termino en silencio.
> 2. **Por cada entrevista nueva creo un ticket** "Entrevista <archivo> →
>    zócalos": el trabajo de cada una queda a la vista en el Pipeline.
> 3. Dentro del ticket: la transcribo completa, selecciono los diez zócalos y
>    los dejo en los resultados de este flujo.
> 4. Cierro el ticket contando qué entregué y dónde, y le aviso a Cata por su
>    canal con el titular — dos líneas, sin tecnicismos.

**Both trigger fields are empty, and that is the finding.** No folder ids, no
cron job: the flow that the SOUL names as the main one was never armed. It ran
exactly once, by hand, from a link pasted in chat — and it skipped its own step
2 (there is no interview ticket on the board).

#### `radio-viva`

> `para_cliente:` "Me pasás un link de Radio Viva, un archivo o el texto del
> artículo y te devuelvo la noticia lista para publicar: titular y copy."
> `gatillo_tipo: pedido` · `conexiones: modelos-auxiliares, telegram` ·
> `skills: redactar-noticia, entregable`

Body, verbatim:

> 1. Creo un ticket "Noticia <tema>" para que el trabajo quede a la vista en el
>    Pipeline.
> 2. Si me pasa un link, leo el artículo desde ese enlace. Si me pasa un archivo
>    o pega el texto, trabajo directamente con ese contenido.
> 3. Redacto la noticia con su formato y la dejo en los resultados de este
>    flujo.
> 4. Cierro el ticket con el titular y la referencia a la noticia.
> 5. Una vez que terminé, le mando un mensaje por Telegram a Cata avisándole que
>    la noticia quedó pronta y dónde encontrarla.

Two client-requested amendments are recorded as HTML comments at the bottom,
both dated 7/8/2026: the input is a **link, a file or the article text — not
audio or video**, and **notify over Telegram when it's done**. This is the only
flow where the client iterated on the contract, and both edits narrowed it.

#### `comparar-nyt-elpais`

> `para_cliente:` "Cada 15 minutos comparo la última publicación del New York
> Times con la de El País Uruguay y te aviso si hablan del mismo hecho."
> `gatillo_cron: "*/15 * * * *"` · **`gatillo_job: 68033e20ef7f`** ·
> `skills: entregable`

Body, verbatim (7 steps):

> 1. Tomo el titular, la hora, el resumen y el enlace de cada fuente.
> 2. Si una de las dos fuentes no actualizó su última publicación desde la
>    revisión anterior, no repito el aviso.
> 3. Leo los resúmenes y, cuando haga falta para decidir, abro las dos notas.
>    Comparo el hecho central, no solo palabras parecidas en los titulares.
> 4. Clasifico el resultado como "misma noticia", "noticias distintas" o "no
>    concluyente". Nunca fuerzo una coincidencia.
> 5. Si son la misma noticia o el resultado no es concluyente, creo un ticket
>    con los dos titulares, enlaces, horarios, evidencia y la clasificación.
>    Dejo además un informe breve en los resultados de este flujo y aviso a Cata
>    con una línea clara.
> 6. Si son distintas, no creo un ticket ni mando un aviso: guardo solamente el
>    estado necesario para no repetir la comparación.
> 7. Si una fuente falla o el feed no permite verificar el contenido, no invento
>    el resultado: dejo constancia de qué fuente faltó y lo marco como "no
>    concluyente".

Its technical notes name the two feeds
(`rss.nytimes.com/services/xml/rss/nyt/HomePage.xml`,
`www.elpais.com.uy/rss/latest`) and a state file for the last compared pair.

### 1.3 The cron

One job, `cron/jobs.json`:

```json
{ "id": "68033e20ef7f", "name": "flujo-comparar-nyt-elpais",
  "prompt": "Trabaja el flujo comparar-nyt-elpais: abri /opt/data/flujos/comparar-nyt-elpais/FLUJO.md y segui sus instrucciones tal cual. Si el gatillo no encuentra nada nuevo, termina en silencio.",
  "schedule": { "kind": "cron", "expr": "*/15 * * * *" },
  "deliver": "local", "model_snapshot": "openai/gpt-5.6-luna",
  "repeat": { "completed": 191 }, "last_status": "ok" }
```

**191 completed runs over four days produced one deliverable.** Of the 50 run
transcripts still on disk, **27 ended `[SILENT]` and 23 ended in an error** —
`TimeoutError: Cron job idle for 922s (limit 600s)` and `RuntimeError:
Connection error.` A run that fails does not tell anyone; the client sees the
same nothing as a quiet run. The single report it ever wrote was **"no
concluyente"**, because El País answered **HTTP 403 with a Cloudflare
challenge**.

That job is also 93% of everything East ever spent.

### 1.4 The workspace, and the shapes she received

```
workspace/
  entrada/                      EMPTY — nothing ever arrived through Drive
  interno/                      1,300+ scratch files, ~95% the comparison flow
    entrevista-HGRy8mSFPEQ/     audio.mp3, video.es.vtt, metadata.json,
                                transcripcion-limpia.md, zocalos-body.md
  entregables/
    entrevistas-tv/             transcript + zócalos       (kind: nota, lista)
    radio-viva/                 2 news drafts              (kind: borrador)
    comparar-nyt-elpais/        1 report                   (kind: informe)
    2026-08-07-resolucion-de-x-y-3-con-y-x2.md   (the loose demo one)
  artifacts/                    2 demo HTML pieces
```

`interno/` is the honest measure of where the effort went: the comparison flow
left ~1,300 scratch files (retries, headers, status dumps, half a dozen
near-duplicate `.py` runners) fighting Cloudflare, against 8 files for the
interview.

**Four document shapes, all four still valid `--kind` values in today's
`deliverable`** (`informe`, `lista`, `borrador`, `nota`, `analisis`). The one
that matters — the zócalos list — has this skeleton:

```
---
titulo: Entrevista VTV — Operación Jacobo, Maldonado → zócalos
tipo: lista
fecha: 2026-08-07 20:57
tags: entrevista-tv, maldonado, operacion-jacobo
---

# <título>

## Zócalos
 1. FRASE EN MAYÚSCULAS.
    Fuente: 00:15–00:20.
 … 10 numbered, each with its timecode …
 8. … [VERIFICAR CONTRA EL VIDEO]          ← flagged, not guessed

## Sugerencias de imágenes
 - Video fuente: <link>
 - 3-5 concrete searches/links (Google, Images, Maps) — "La elección final es de Cata"

## Alertas de verificación
 - what the source was, and every number/name that needs checking against the video

Fuente: <url> · Canal: <channel> · Título: <title>
```

The news draft is the same idea in another shape: `**Titular:**` (≤12-14
words) + `**Copy:**` (50-180 words, 1-3 subtle emoji, source cited in the first
or second paragraph) + `## Sugerencias de imágenes` + a source note. Both end in
a line saying nothing was published or sent to anyone.

### 1.5 The Drive inbox: what it watched, and what arrived

`skills/entrada-drive/vigilar.py` (today `plugins/drive-inbox/skills/drive-inbox/watch.py`)
lists `'<folder_id>' in parents and trashed=false` over the Drive v3 API,
filters to `video/*` and `audio/*` mimetypes, skips anything over 4 GB,
downloads into `workspace/entrada/`, and remembers what it saw in
`.drive-visto.json` so it never fetches the same interview twice. It refreshes
the OAuth token itself off `google_token.json`.

**It watched nothing and nothing arrived.** On disk:

- no `google_token.json` — **the OAuth handshake was never completed**. What
  exists is `google_oauth_portal.json`, a bare PKCE verifier: the portal started
  the flow and no code ever came back.
- `google_client_secret.json` is present (our own Desktop-type app, project
  `tuagente-504715`), so our half was done.
- `workspace/entrada/` is empty and no `.drive-visto.json` exists.
- `vigilar.py` **never appears in a single tool call** across all 9,430 messages.
- the board's oldest ticket, **`t_cff16ba7` "Configurar Google Drive", is
  `archived`** — opened, never finished.
- `connections/requeridas.json` is `["google-workspace"]` — the agent knew it
  was missing and said so when asked `me falta conectar algo?`.

### 1.6 `entrevista-HGRy8mSFPEQ` — the naming answers the question

`HGRy8mSFPEQ` is a **YouTube video id**, and the folder is named after it.
`metadata.json` is a yt-dlp dump: `extractor: youtube`, `webpage_url:
https://www.youtube.com/watch?v=HGRy8mSFPEQ`, `channel: VTV NOTICIAS`,
`duration: 223`, title *"Condenaron a 12 personas por tráfico de drogas y armas
en Maldonado"*.

**The one interview East ever processed came in as a YouTube link pasted into
the portal chat.** Not a Drive file, not an upload. And the pipeline that ran
was not the one the flow describes:

1. The agent read `transcribir/transcribir.py` **and never executed it** — zero
   tool calls invoke it, here or anywhere in the history.
2. It ran `uv run --with yt-dlp yt-dlp …` — improvised, not a kit capability —
   pulled `audio.mp3` and YouTube's **automatic Spanish captions**
   (`video.es.vtt`), and built the transcript from those.
3. The deliverable says, twice: *"la conexión de modelos auxiliares no está
   configurada"*. **That was false.** `OPENROUTER_API_KEY` was set in
   `data/.env` — it is the same key the agent was billing every turn to, and
   `transcribe.py` needs no other. The agent invented a missing connection to
   justify skipping the paid step.

The cost of the shortcut is visible in the product: the transcript carries five
`[VERIFICAR CONTRA EL VIDEO]` markers (a name, two figures, a garbled clause),
and zócalo #8 shipped with one. Auto-captions are not a transcription, and this
is TV copy that goes to air.

**Credit where due:** it flagged all of them instead of smoothing them over.
The "nunca inventes datos" rule in the SOUL held. The connection claim is the
one place it did invent.

### 1.7 Skill usage, measured

From `skills/.usage.json` (`use_count`, whole lifetime):

| skill | uses | reading |
|---|---|---|
| `news-source-monitoring` *(agent-written)* | 1042 | the comparison cron, plus **241 self-patches** |
| `entregable` | 196 | inflated by the cron reading it every run |
| `research/news-source-monitoring` | 122 | same flow |
| `flujo` | 60 | flow creation + every run reading its own contract |
| `redactar-noticia` | 32 | **2 news drafts** |
| `entrada-drive` / `blogwatcher` | 13 / 13 | read, never executed |
| `aprobacion` | 5 | never gated a real send |
| `transcribir` | 4 | read 4×, **run 0×** |
| `frases-zocalo` | 3 | **1 interview** |
| `google-workspace` · `artifact` · `connection-readiness` | 3 each | |
| `youtube-content` | 2 | the improvised path |
| `youtube-interview-production` *(agent-written)* | **0** | created 7/8, never used |

`use_count` counts a skill being *read into context*, not work delivered. Read
it as attention, not value: the two skills that carry her actual craft —
`frases-zocalo`, `redactar-noticia` — are near the bottom, and the cron is the
top four rows.

The agent named its own skill **`youtube-interview-production`** on 7/8 and
never used it. Section 3 gives that name back to a plugin.

---

## 2. Requirements, ranked by evidence of real use

**Rank 1 — Interview → 10 lower-thirds (zócalos) for the TV edit.**
The SOUL calls it "el principal". The whole product thesis for East. Evidence:
one full end-to-end run with a real deliverable Cata could use, her prompt
captured verbatim (`ME SELECCIONAS DE ESTA ENTREVISTA 10 FRASES PARA ZOCALO
PARA LA EDICION DEL PROGRAMA, PUEDEN SER FRASES, QUOTES, TITULARES.`), a
format refined with her (10, ALL CAPS, mixed quote/headline/data, timecoded,
verbatim quotes or flagged), and a second document — the full transcript —
delivered alongside. It is thin on volume and unambiguous on intent.

**Rank 2 — A URL/text → a publishable news item (headline + copy) for Radio
Viva.** Two deliverables, both used, and **the only requirement the client
amended twice** — narrowing the input to link/file/text and adding a Telegram
notice. A client who edits the contract is a client who is reading the output.
Her spec is captured verbatim, down to the worked example.

**Rank 3 — Image suggestions with every deliverable.** Not a flow of its own;
it appears as `## Sugerencias de imágenes` in every single deliverable of both
flows, 3-5 concrete searches or links, and both skills state the rule the same
way: *"la elección final es de Cata"*. `east-pilot.md` had already decided
scraping images is fragile and rights-laden — suggest, never fetch. This is
cheap and it survived every iteration.

**Rank 4 — Every result saved with a name, a date and a place to cite.**
Six deliverables, four shapes, zero results dropped loose in the chat. The
`deliverable` habit was the thing that worked best; it is also system, so it
costs nothing to keep.

**Rank 5 — Notify her on her own channel when something is ready.**
Explicitly requested for `radio-viva`, present as step 4 in `entrevistas-tv`.
**Never actually exercised on her**: she never paired Telegram, and the only
peer the agent ever had was Luis. Real requirement, zero delivered evidence.

**Rank 6 — Nothing leaves the building without her yes.** The SOUL's hard rule,
the `no te ocupás de` list, and the closing line on every deliverable ("No se
publicó ni se envió a terceros"). Never tested — nothing sensitive was ever
attempted — but it is the constraint that makes the rest sellable to a
communicator whose work goes to air.

**Rank 7 — Compare two news sources on a schedule.**
Highest raw counts in the whole record and the lowest yield: 191 runs, 23
crashes in the last 50, one "no concluyente" report, 93% of the spend. It came
from a curiosity in chat ("Read the latest ny times article then the latest
elpais.uy news and see if they are the same") that got promoted to a flow one
message later. **It is a demo request, not a job to be done** — East is a
production company, not a media monitor — and the numbers say so.
**Do not rebuild it as-is.** If a monitoring need turns out to be real, it is
the `web-monitoring` menu row, at a sane frequency, with a source that does not
answer 403.

**Rank 8 — Drive folders as the inbox, one folder per end client.**
Ranked last on *evidence* — it never ran once — and it is nonetheless
**Rank 1's intended front door**, and the thing that makes the product
hands-off instead of paste-a-link. `east-pilot.md`: "one Drive folder per end
client; the deliverable comes out tagged with that client." It failed on
onboarding (an unfinished OAuth handshake, an archived ticket), not on design.

**Not requirements** (present in the record, do not carry them forward): the
math problems, the polar bear, Stephen King, the invented World Cup dashboard,
the Slack check (there is no Slack connection), and `comparar-nyt-elpais`.

---

## 3. The plugin build for a from-zero East

### 3.1 What ships without anyone buying it

The six system plugins, whole, on every agent: **`kanban`** (the board her flows
put a ticket on), **`approval`** (the yes before anything leaves), **`deliverable`**
(every shape in §1.4, unchanged), **`artifact`**, **`flow`** (the only way to
leave work running, and the `promises` engine guard), **`capability`** (how the
agent asks for what it does not have instead of improvising it — exactly the
failure in §1.6).

Plus the base capability that covers her core mechanic:

| base capability | installs | why she needs it |
|---|---|---|
| **`transcription`** | `plugins: ["transcribe"]` | audio/video → text. Rank 1 dies without it, and §1.6 is what happens when it is skipped |
| `web-search` | Tavily backend | reading a Radio Viva article; the image-suggestion searches |
| `vision` | `vision` toolset, `ocr-and-documents` | reading what she sends as a photo |
| `calc-and-spreadsheets` | `xlsx`, `docx`, `pdf` | base anyway |

### 3.2 What she buys from the menu

**`social-package`** — the only menu row she plausibly needs, and only if the
Radio Viva output is meant to go out as posts rather than as drafts she pastes.
It installs `brand-kit` + `social-content` + `post-image`. **Recommendation:
don't sell it on day one.** Her delivered product was a *draft for Cata*, every
deliverable says so, and the SOUL forbids publishing. Sell it when she asks to
publish, not before.

**Nothing else in the menu fits.** No quotes, no invoices, no stock, no payroll.
And note before promising anything from that list: **19 of the 21 `level: menu`
rows install a `kit_skills` name that does not exist in `hermes-kit/skills/`**
(which holds only `no-images` and `no-web-search`). Two of the nineteen —
`social-package`, `branded-reports` — still install real plugins and lose only
their extra skill; the other seventeen (`web-monitoring`, `meeting-summaries`,
`knowledge-base`, `uy-tenders`, …) are catalog rows with nothing at all behind
them. `check-plugins.py` does not catch it because it only refuses a
`kit_skills` entry that collides with a plugin-owned skill.

### 3.3 The gap: `drive-inbox` is sold by nobody

Rank 8 — her intended front door — is `plugins/drive-inbox/`, and it is an
orphan. Its own manifest says so, and `plugins/README.md` says it louder: *"no
capability sells it, no base capability installs it, and `system` is false, so
`tools/plugin_set.py` gives its FOLDER to no agent."*

**There is no path by which a from-zero East gets it.** `purchased.json` takes
capability ids from `capabilities/catalog.json`; no row installs `drive-inbox`;
so the plugin cannot be purchased, cannot be installed, and its skill reaches no
index. **This needs a catalog row before East is rebuilt** — see §4.1.

### 3.4 Her flows: a custom plugin, not client-written flows

**Recommendation: build `interview-production`, the first custom plugin of the
new model.** It owns her two craft skills and the two flows that use them.

```json
{
  "id": "interview-production",
  "version": "1.0.0",
  "description": "An interview becomes what it has to be on air: ten timecoded lower-thirds for the TV edit, or a headline-and-copy news item for social",
  "client_copy": "De cada entrevista te deja lo que va al aire: los diez zócalos para la edición, o la noticia lista para redes.",
  "requires": { "plugins": ["deliverable", "approval", "transcribe"] },
  "surfaces": {
    "skills": ["lower-thirds", "news-copy"],
    "flows": ["flows/entrevistas-tv", "flows/radio-viva"]
  },
  "system": false
}
```

sold by a new `level: menu` capability (`interview-production`, group
`content`) whose `installs` is `{"plugins": ["interview-production"]}`. The row
is closed on its own — `transcribe` is base, `deliverable`/`approval` are system
— so `check-plugins.py`'s "a row has to be closed on its own" rule is satisfied
without bundling.

**Why a plugin and not client-written flows.**

1. *The registry is the argument the product makes.* `plugins/README.md`: "A
   plugin is the reusable unit of custom work: whatever a client pays us to
   build lands here so the second client who asks for it gets it off the shelf."
   Lower-thirds for a TV edit is not East-shaped; it is *TV-production*-shaped,
   and the second production company that walks in should get it off the shelf.
   Recreating it as flows inside one agent's `data/` guarantees the opposite.
2. *A flow cannot hold a craft.* The 2,400 characters of `frases-zocalo` and the
   3,900 of `redactar-noticia` are her spec, verbatim, with a standing rule for
   how it evolves. `create_flow.py` caps a flow body at **7 steps × 320
   characters** and the portal shows it to the client. Her spec does not fit and
   should not be shown as steps — a skill is exactly the surface for it.
3. *The flows only exist because the skills do.* That is the README's own test
   for ownership ("the quotes it chases only exist if the quote writer made
   them"). `entrevistas-tv` without `lower-thirds` is a cron that downloads a
   video.
4. *We already had the name.* The agent invented `youtube-interview-production`
   on 7/8/2026 and never used it. Drop the platform from the name — the source
   is an interview, not a YouTube video — and the unit is the same.
5. *It survives the reset.* Anything in `data/` dies with the agent, and East
   just proved that: three flows, two skills and 66 MB of history are being
   deleted this week. What lives in the kit is what we still have tomorrow.

**Where the two flow bodies land.** Rewritten inside the plugin as
`flows/entrevistas-tv/FLOW.md` and `flows/radio-viva/FLOW.md`, English
frontmatter, the step lists of §1.2 kept nearly verbatim — they are good client
copy, they are inside the 7×320 budget, and Cata edits them in place like any
other flow. Two changes: `entrevistas-tv` ships as `trigger_type: request`
until Drive is genuinely connected (an armed trigger with no folders is what
§1.2 already produced), and `radio-viva`'s step 5 names the client's channel
rather than Telegram specifically.

**What does NOT become a plugin:** `comparar-nyt-elpais` (Rank 7 — do not
rebuild) and the loose scratch in `interno/`.

### 3.5 The resulting set

```
system:    kanban, approval, deliverable, artifact, flow, capability
base:      transcribe            (via the `transcription` base capability)
purchased: drive-inbox           (via the NEW catalog row — §4.1)
           interview-production  (via the NEW catalog row — §3.4)
purchased.json: { "capabilities": ["drive-inbox", "interview-production"] }
connections:    google-workspace (Drive), telegram (or whatever channel she pairs)
```

Nine plugins. No roles, no profiles, no team.

---

## 4. What is missing in the kit for this to work end to end

### 4.1 A catalog row for `drive-inbox` — blocking

Without it the plugin is unreachable (§3.3). Add to
`capabilities/catalog.json`, `level: menu`, group `information` (or a new
`inputs` group):

```json
{ "id": "drive-inbox", "label": "Tus carpetas de Drive como bandeja",
  "installs": { "plugins": ["drive-inbox"] },
  "requires": { "connections": ["google-workspace"] } }
```

Then delete the "sold by nobody" paragraph in `plugins/README.md` and the
manifest's `description`, which both say it ships nowhere.

### 4.2 The Google OAuth step is missing from the onboarding runbook — blocking

`docs/client-onboarding.md` (433 lines) contains **zero occurrences of "google",
"oauth" or "drive"**. The pieces all exist and are not connected:

- `connections/catalog.json` → `google-workspace`, `setup_flow: "google-oauth"`,
  detected by the presence of `google_token.json`;
- `adapter/portal_adapter.py` implements the flow (line ~727 onward,
  `google_oauth_pending.json`);
- `app/app/connections/page.tsx` draws the dialog for `setup_flow === "google-oauth"`;
- `connections/google-workspace.md` is the 111-line runbook for our side.

What is missing is the onboarding step that says: **put
`google_client_secret.json` on the agent, walk the client through the dialog,
and verify `google_token.json` exists before calling the install done.** East is
the proof — our half was in place, her half never happened, the ticket got
archived, and the main flow never ran. And two related loose ends: the folder
ids have to be collected at onboarding (`vigilar.py`/`watch.py`: "los dejó el
alta — no los inventes ni los pidas por chat"), and East's file was named
`google_oauth_portal.json` while the adapter now writes
`google_oauth_pending.json`.

### 4.3 The `drive` trigger writes a flow that cannot work

`create_flow.py` accepts `--trigger drive --folders …` and writes
`trigger_folders` / `trigger_job` — but the skill that reads those folders ships
to nobody (§3.3), and its own docstring example still names
`--skills drive-inbox,transcribe,frases-zocalo,deliverable`, where
**`frases-zocalo` does not exist in the kit at all** (it was East's, and it is
being deleted). Once §4.1 lands, the example should name skills that exist.

Worse, East's `entrevistas-tv` shows the failure mode: `gatillo_tipo: drive`
with **empty** `gatillo_carpetas` and `gatillo_job`. A `drive` trigger with no
folders is a flow the portal shows as `active` that can never fire.
`create_flow.py` should refuse `--trigger drive` without `--folders`, the same
way it already refuses a non-`request` trigger without `--cron`.

### 4.4 A failed scheduled run is indistinguishable from a quiet one

23 of the last 50 runs of `68033e20ef7f` died on a timeout or a connection
error, and the client saw exactly what a `[SILENT]` run looks like: nothing.
The current `flow` SKILL.md has the rule — *"Una corrida que no pudo hacer su
trabajo SIEMPRE deja rastro visible"* — but it is a rule the model has to
remember, and the failures here happened *below* the model (the runner timed
out mid-call; there was no turn left in which to obey it). **The format has to
supply it:** a run that ends in an engine-level error should leave a ticket or a
visible mark without the agent's cooperation. Per the kit's own principle —
"the model supplies the words; the code supplies the format" — and the two other
symptoms worth fixing alongside it: a `*/15` job on an LLM-backed flow is over
the reasonable line even though the 5-minute floor allows it, and a source
behind Cloudflare (El País, 403 + `cf-mitigated: challenge`) should be a stated
limitation at flow-creation time, not a per-run discovery.

### 4.5 Video source handling: YouTube is real, and it is improvised

The one interview arrived as a YouTube URL, and the agent handled it with
`uv run --with yt-dlp yt-dlp …` — an ad-hoc download, in-container, no version
pinned, no timeout, no size limit, and a `WARNING: No supported JavaScript
runtime` in the output. Nothing in the kit covers a video URL as an input.
Given §1.6, the decision is not "add yt-dlp" but **which of the two**:

- **(a)** `transcribe` accepts a URL: it fetches the audio track with a pinned
  downloader, then transcribes it **on the model connection** — auto-captions
  are never the answer, because they are what produced five `[VERIFICAR]`
  markers in copy that goes to air; or
- **(b)** a URL is not an accepted input, and the agent asks for the file.

Recommend **(a)**, inside `transcribe`, so the skill keeps owning the decision.
Either way `interview-production`'s flow must not leave it to the agent.

### 4.6 The false "missing connection" is a product bug, not a prompt bug

The agent claimed *"la conexión de modelos auxiliares no está configurada"*
with `OPENROUTER_API_KEY` sitting in its own environment — the same key it was
billing that very turn — and shipped a degraded deliverable on that basis. It
never ran `transcribir.py`; it read the source and decided. **A claim about a
connection should come from the same detection the portal uses** (the
`detects` block in `connections/catalog.json`), never from the model's
impression, and "the connection is missing" should be a thing the *script*
reports, not the agent. `transcribe.py` already does exactly that on a real
absence — the gap is that nothing stopped the agent from asserting it without
asking.

### 4.7 Smaller, still real

- **The interview flow's own step 2 was skipped**: it says "por cada entrevista
  nueva creo un ticket", and there is no interview ticket on the board. Every
  convention that depends on the agent remembering has failed; a plugin flow
  whose unit of work is one interview should get its ticket from the code.
- **The Telegram home channel stayed pointed at Luis** for the agent's whole
  life, with a comment saying "hasta que Cata se empareje". Pairing the client's
  channel is not on the onboarding checklist either, and a flow that promises a
  notice cannot keep it until it is.
- **Two names for the agent in one tree**: `portal_identidad.json` says
  **`Selastian`** (Cata's baptism, plus a look), `docker-compose.yml` sets
  `AGENT_NAME=Eco`, and the SOUL opens with "Te pusimos **Eco**". Three sources,
  one name. The baptism must win everywhere, and the compose env should not be a
  second source of truth.
- **`skills/.usage.json` is the best signal we have and nothing reads it.**
  It answers "what did this client actually use" in one file. Worth a line in
  the onboarding or fleet routine before the next agent is retired blind.

---

---

## 5. What was built from this, 30/8/2026 — and where the dossier was wrong

Everything in §3 and §4.1/§4.3/§4.5 was built and then RUN, from zero, on a
fresh agent (`east-v2`, local, ports 8662/8663, its own OpenRouter key). This
section records the decisions that differ from what §3 recommended, the one
accusation this file has to withdraw, and what the run actually produced.

### 5.1 The catalog-row pattern for a bespoke plugin: there is no second pattern

`interview-production` is sold by an ordinary `level: menu` row in
`capabilities/catalog.json`, with the same six client-facing fields as every
other row. **It does not get a third `level`, and that is the decision.**
`level` is read by code in three places — `tools/plugin_set.py` splits base from
bought, `purchased.json` refuses a base row, the portal draws "included" vs a
button — so a new value means touching every reader to express something the
client would not understand. What makes a row bespoke is a fact about its
HISTORY, and history goes in `internal_note`, which is where East is named and
the only place in the kit that names her.

That is also the product argument, not a shortcut: `plugins/README.md` says a
plugin is "the reusable unit of custom work: whatever a client pays us to build
lands here so the second client who asks for it gets it off the shelf." The
catalog is the shelf. A row hiding behind a special level is a plugin nobody
else can ever buy.

Three things a bespoke row has to get right, learned writing this one:
**(1)** `cost` and `effort` describe this row and nothing else — the craft costs
nothing per run, the transcription costs cents per hour of audio, and the row
says so; a bespoke row is exactly where the temptation to price the commission
instead of the capability shows up. **(2)** The row is closed on its own.
**(3)** Nothing client-specific crosses into the plugin.

### 5.2 Three places this dossier was wrong

**§1.6 — "The agent invented a missing connection." It did not, and this is the
correction that matters most.** The engine strips `OPENROUTER_API_KEY` by name
from every `terminal` and `execute_code` subprocess it spawns
(`tools/environments/local.py`), and `env_passthrough.py` refuses to re-allow
it. Reproduced from zero on 30/8: `transcribe.py`, run the only way an agent
can run it, returned *"falta OPENROUTER_API_KEY: la conexion de modelos no esta
configurada"* on an agent whose key was funding that very turn. **The SCRIPT
said it, because it was true.** `transcription` is a `level: base` capability
sold to every client as "ya viene puesta" and it was dead on delivery, on every
agent ever shipped. So the caption shortcut was an agent working around a broken
capability, not dodging a paid step — and the five `[VERIFICAR CONTRA EL VIDEO]`
markers in copy that went to air are ours. Fixed with `TUAGENTE_MODELS_KEY`
(same value, a name the engine does not strip) and an `agent-check` failure;
the trade-off and the narrower fix are in `hermes-kit/notes/auxiliary-models.md`
and `docs/PENDING.md`.

**§3.4 — "the row is closed on its own, so `check-plugins.py`'s rule is
satisfied."** It was not: the rule exempted only `system` plugins, and
`transcribe` is `level: base`. The row was refused with advice that would have
written a purchase for a plugin nobody buys. The rule now exempts both — the
same pair `plugin_set.py` already adds unconditionally.

**§4.5 — "recommend (a), inside `transcribe`."** Built as a script inside the
plugin instead (`skills/lower-thirds/fetch_video.py`). `transcribe` is on EVERY
agent and its contract is FILE → TEXT; teaching it about URLs puts a video
downloader and its prose in the prompt of every client who never sends one.
Sources are their own unit — `drive-inbox` is a source, this is a source — and
both hand `transcribe` a file. **The half of §4.5 that did NOT move is the one
that mattered:** the transcript comes from the model connection, and
`fetch_video.py` passes `--no-write-subs --no-write-auto-subs` so the captions
are not even on disk to be tempted by.

### 5.3 Smaller decisions

- **The second flow is not `radio-viva`.** Radio Viva is the outlet she
  publishes into; a slug named after it would put a third party's brand in every
  agent that ever buys the row. It is `noticia-para-publicar`. PRINCIPLE ZERO
  wins over this dossier's own §3.4.
- **`entrevistas-tv` ships `trigger_type: request`**, as §3.4 said — a kit file
  cannot carry one client's folder ids or a per-agent cron job id. Arming it is
  now a supported command rather than a hand edit: `create_flow.py --rearm`,
  which rewrites only the five `trigger_*` keys and leaves every word the client
  reads alone. `--trigger drive` without `--folders` is refused outright (§4.3).
- **The interview's ticket is opened by `fetch_video.py`**, keyed on the video
  id, unassigned (the turn that called it is the one doing the work; an assignee
  would hand the same interview to the dispatcher as well and run it twice).
  §4.7's first bullet, answered by code.
- **The Google step and the channel pairing are now in
  `docs/client-onboarding.md`** (§4.2 and §4.7's second bullet).

### 5.4 What the run produced

Fresh agent, `purchased.json` = `["drive-inbox", "interview-production"]`, nine
plugins exactly as §3.5 predicted. `agent-check` **30 ok · 0 warn · 0 failures**,
`portal-check` **16 ok · 0 warn · 0 failures**. Baptized through the portal API
as the client would — «Selastian», East Comunicación — and the name won in the
manifest over the compose's `AGENT_NAME` (§4.7's third bullet).

**Rank 1, end to end** on the same YouTube interview she used
(`HGRy8mSFPEQ`, VTV NOTICIAS, 3:43): downloaded to audio, transcribed on the
model connection, two deliverables (transcript + the ten zócalos), approval
requested on the interview's own ticket. **Zero `[VERIFICAR]` markers inside the
zócalos** — with a real transcription there was nothing to guess. Two of them:

> `4. EL LÍDER DE LA ORGANIZACIÓN RECIBIÓ 3 AÑOS Y 10 MESES DE PENA`
> `   Fuente: 00:31–00:42.`
> `10. "ESTA PERSONA EN MENOS DE TRES AÑOS ESTÁ DE VUELTA EN LA CALLE"`
> `    Fuente: 03:33–03:41.`

**Rank 2, end to end** on the Radio Viva URL from her own message: article read,
headline (13 words) + copy (~120 words, source in the first sentence), image
suggestions including the outlet's own published image, closing line, approval
pending on its ticket. One miss: zero emojis where her format carries 1-3 — the
skill said "hasta 1 a 3", which reads as optional; reworded after the run and
not yet re-tested.

**Rank 8, as far as it can go without her consent screen.** The flow armed with
folder ids, cron created and verified, `missing_connections: ["google-workspace"]`
reported at arm time. Fired once: `watch.py` answered *"no hay token de Google:
falta hacer la conexion"* and the run left a blocked ticket — *"Entrevistas TV —
no se pudo revisar Drive: falta conectar Google"* — saying what is missing, what
is lost while it stays missing («los videos y audios nuevos que lleguen a esas
carpetas no entran a trabajarse... puede perderse el cierre de hoy») and
offering `connection:google-workspace`. **The failure mode §4.4 asks for is the
one that happened.**

Cost of the whole validation: **US$0.167** on a key minted for it, over four
agent runs — the interview twice (US$0.027 for the run that stopped on the
missing key, US$0.042 for the one that delivered), the news item US$0.049, and
the Drive trigger US$0.031 for the cron turn plus US$0.018 for the dispatched
ticket that left the loud failure.

### 5.5 — What an independent re-run found, 30/8

Three corrections to the section above, each measured rather than argued.

**"Transcribed on the model connection" is true and incomplete.** The
transcript came from `transcribe.py`, and the *timecodes under every zócalo did
not*: `transcribe.py` sent only `model` and `language` and kept `res["text"]`,
which is flat prose. The model wrote its own `get_timestamps.py`, called the
same endpoint a SECOND time on the same mp3 asking for `verbose_json` +
segments, and paid for the interview twice — the files are still in
`workspace/interno/entrevista-HGRy8mSFPEQ/`. The craft's only hard-formatted
field had no supplier in the code, so the run above is not reproducible by the
kit as it shipped; it is reproducible by a model that improvises the same tool
again. Fixed since, with `--timestamps`.

**Rank 2 does not open a ticket or ask for the sí — it did here because the
model remembered.** Re-run of the same flow on a different Radio Viva URL: the
draft came out correct and complete (and with two emojis, so the reword above
IS working), and the board got NOTHING — no ticket, no approval, no trace. Step
1 and step 4 of that flow have prose behind them and no code, unlike the
interview path, where `fetch_video.py` opens the ticket with an idempotency
key. `docs/PENDING.md` carries it.

**The two zócalo files are not one list saved twice.** Five of the ten zócalos
differ between `…-zo.md` and `…-zo-2.md`, and so does one timecode; the second
is a revision and the only one the approval cites. The first is a superseded
client-facing deliverable with nothing marking it stale.

Two smaller ones. The decomposition above lists five numbers over "four agent
runs": both interview attempts are one session (`api-bb73da8b`, US$0.068), and
0.027 + 0.042 is that session split by attempt, not two sessions. And US$0.167
is the agent's own *estimate* (`state.db.sessions`, `cost_status: estimated`);
the provider billed **US$0.1697**, the difference being the two Whisper calls,
which the session ledger does not carry at all.

---

## Provenance

Read-only, 30/8/2026, from `~/Desktop/Luis/Projects/agente-east/data/`:
`state.db` (copied to scratch, opened `sqlite3 -readonly`), `kanban.db`,
`cron/jobs.json` + `cron/output/68033e20ef7f/`, `flujos/*/FLUJO.md`,
`workspace/**`, `skills/.usage.json`, `skills/{entrada-drive,transcribir,frases-zocalo,redactar-noticia}/`,
`config.yaml`, `SOUL.md`, `connections/requeridas.json`, `portal_identidad.json`,
`channel_directory.json`, `docker-compose.yml`.

The tree went to `~/.Trash/` immediately after this file was committed. The
single remaining archive is `east:/opt/agentes/east-final-backup-20260830.tgz`
(sha256 `97f6fb31…88ff0`) — and that is a copy of the **empty VPS shell**, not
of the data this dossier describes. **This file is the only surviving record of
what East did.**
