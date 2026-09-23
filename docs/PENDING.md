# Pending (2026-08-04)

What's left open, and who unblocks it. Close it here once it's resolved.

## The engine: Pydantic AI, decided (2026-09-14)

Luis decided on 2026-09-14: **the product moves to the Pydantic AI engine
(`engine/`) and Hermes gets killed slowly.** Nothing is maintained for
both engines any more. Rules from that day on:

- New work targets `engine/` only. No feature, plugin surface, check or doc
  gets a Hermes variant.
- **No conditionals to keep both engines working.** The seams added
  to coexist with Hermes are the first things to remove, not to extend:
  `SKILLS = []` overrides in `approval/core/plugin.py` and
  `social/core/plugin.py` (they exist to hide Hermes-only `SKILL.md`s;
  `kanban` needs none — `engine/core/plugins.py` says why each of the two
  remaining ones is still there), `CORE_ONLY` in
  `kit/tools/test_check_plugins.py` (the check itself, `check-plugins.py`,
  carries no such list — it was misfiled here). **Closed 2026-09-23**: the
  `flow` plugin's "no scheduled flows on this engine" prose is gone —
  since 14/9 that plugin is only the catalog of curated flows
  (`kit/plugins/flow/plugin.json`); the mechanism moved whole into
  `engine/core/flows.py` and `engine/core/scheduler.py`.
- The Hermes agents in `kit/fleet.md` (the local demo, the VPS
  `tuagente`, and `east-v2`, the kit's own validation agent — not a
  client, but still on Hermes) stay up until they get rebuilt on the new
  engine, then the Hermes half of the kit (`adapter/`, `compose/`,
  `mcp-guard/`, `install.sh`, `new-agent.sh`, `deploy-remote.sh`, `notes/`
  on engine knobs, `engine/` and `mcp` plugin surfaces) is deleted, not
  archived. **"Flows and cron" is no longer what they're waiting on — both
  are built**, and so is the board: `engine/core/flows.py`,
  `engine/core/scheduler.py`, `kit/plugins/kanban/core/board_store.py`
  (`docs/inbox-plan.md`). What is left is the rebuild itself, plus
  whatever each live agent's own connections still need (WhatsApp,
  Mercado Pago, Instagram's curated MCP — see "Only while the Hermes
  fleet runs" near the end), not a missing engine capability.

The record of why: `docs/engine-plan.md`, `docs/engine-verdict.md`.

First workload on the engine, built 2026-09-14: our own agent posting daily,
which brought flows into the engine, an image plugin and a social plugin with
its Posts tab. `docs/own-agent-plan.md`, `docs/own-agent-verdict.md`. Open
after it, and whose:

- **The mascot** (Luis): generative 3D robot that drifts daily, or the HTML
  renderer in `social/` for the brand's SVG agentito.
- **The agent's name** (Luis): «Tu Agente» for now.
- **Telling the owner: BUILT, waiting on Luis for the account** (2026-09-22,
  replaces Telegram, which was taken out). The `notify` plugin mails the owner
  when something waits for an ok, a reminder, and when a flow breaks
  (`engine/README.md`, «Telling the owner»). Luis: create the Resend account,
  verify `tuagente.uy` (DNS records in Cloudflare), and put `RESEND_API_KEY`
  and `NOTIFY_FROM` in each instance's `secrets.env`. Open: nothing in the
  portal lets the owner change the address after onboarding.
- The **VPS deploy** of an instance.
- **Publishing: BUILT, waiting on Luis for the credentials.** `publish_instagram`
  is on the face behind the gate, the approval card shows the slides and the
  caption read off `post.json`, and Posteos has the button and the «Publicado»
  chip (`engine/README.md`, «Publishing»). Both gates are green — the sequence
  with no network (`engine/tests/test_instagram.py`) and the gate live
  (`engine/tests/test_publish_gate.sh`) — and nothing has touched Instagram
  yet. What is missing is only credentials, and they are Luis': the
  **`IG_ACCESS_TOKEN` and `IG_USER_ID`** of tuagente.uy's own professional
  account (Instagram API with Instagram Login, no Facebook page, no app review
  for our own account), and a **Cloudflare R2 bucket** with its five variables
  — Instagram fetches the pictures itself and only takes public URLs. They go
  in `engine/instances/tuagente/secrets.env`. Then one real publish, by hand.
  **The 60 days are no longer anybody's job**: the `instagram` plugin's flow
  refreshes the token as its first step when fewer than ten are left, and the
  new one is stored in `instagram_account` — the env is the seed and the table
  is what every Graph call reads first, because `secrets.env` is outside the
  container (`engine/README.md`, «The comments»). `POST /portal/instagram/
  refresh` is still there to do it by hand, and it writes through the same
  table. DMs ARE BUILT TOO, and the claim that they could not be was wrong:
  `GET /me/conversations?platform=instagram` answers under Standard Access with
  the token we already have. What Luis still has to do for them is one toggle in
  the Instagram app — «Permitir acceso a mensajes» — and what nobody can change
  is Meta's 24-hour window: an approval that waits until tomorrow cannot be
  sent, so the window is on the card.
  **Our own agent has to be brought up with `--build` before anything else**:
  `boto3` is new in the image, the kit reaches the container by bind mount and
  a dependency does not, so a plain restart fails on `import boto3` and the
  container does not come up at all. It is still running the code it loaded
  before any of this, so nothing is broken until somebody restarts it.
- **The inbox: BUILT, waiting on Luis for the mailbox.** `kit/plugins/mail/`
  reads the casilla every five minutes, leaves every mail as a ticket on the
  board and the answer in Aprobaciones; `send_email` is gated, has no `to`, and
  goes out as `EMAIL_FROM`. Three gates are green against the lab's stub
  mailbox — `engine/tests/test_mail.py` 7/7 with no model,
  `engine/tests/test_mail_gate.sh` 0 failures live, and the two gate tests that
  moved onto the real tool (`test_approval_crash.sh` 32/32,
  `test_flow_gate.sh` 0 failures) — and nothing has touched a real address.
  What is missing is Luis', and it is one afternoon:
  a **Gmail app password** for the account `info@tuagente.uy` is routed to, IMAP
  ON, **«Enviar como info@tuagente.uy» verified** in that account so the SMTP
  `From` is accepted, and a **filter + label** for what arrives at that address
  (`EMAIL_FOLDER`), because IMAP's seen flag is the state and a mail he opens on
  his phone first is one the agent never sees. Then six lines in
  `engine/instances/tuagente/secrets.env`:

  ```
  EMAIL_ADDRESS=<la cuenta de Gmail>
  EMAIL_PASSWORD=<app password, 16 letras>
  EMAIL_IMAP_HOST=imap.gmail.com
  EMAIL_SMTP_HOST=smtp.gmail.com
  EMAIL_FROM=info@tuagente.uy
  EMAIL_FOLDER=<la etiqueta, o INBOX>
  ```

  and `mail` is already in the instance's `CORE_PLUGINS` — it inherits
  `instance.yml`'s default list, which `instance.env` does not override.

  **Done 2026-09-23: the order no longer matters.** The flow can arrive
  `active` with the six lines still missing — the scheduler now skips an
  active flow that names a connection nobody set up
  (`waiting_for_a_connection` in `engine/core/scheduler.py`), logs
  `flow.incomplete` once, and stays quiet instead of spending a turn every
  five minutes to answer «Falta conectar el correo». The lab's own copy is
  still PAUSED (`engine/workspace/flows/bandeja-de-entrada/FLOW.md`), but
  that is a preference now, not a defense against the every-five-minutes
  bug.

## Migration to English (2026-08-23)

- ~~**Migrate live agents (Mr.Wobble, East) to the English on-disk layout**~~
  — **CLOSED 30/8/2026: there is nobody left to migrate.** Mr.Wobble was
  decommissioned 24/8; East was retired and every instance deleted 30/8 (test
  client, restarting from zero — `kit/fleet.md`, "East: what remains,
  and what does not", and `docs/east-requirements.md` for what it needed).
  Every agent alive was built by the current installer. The script and its
  runbook (`docs/east-cutover.md`) stay for the next old agent that turns up;
  the three bugs a real run found are fixed.

## Waiting on Luis (nobody else can)

- **Google credentials** for the CFEHYL email task. Need to download
  `google_credentials.json` from Google Cloud Console and run the
  `google-workspace` skill's `scripts/setup.py` once (it opens OAuth in the
  browser). The task is **paused** until then; without this it runs and fails
  every 10 min.
- **Vercel variables** for pdelabs-landing: `EMAIL_USER` / `EMAIL_APP_PASSWORD`
  (the contact form has been fixed in code since 8/3).
- **Luna vs Sonnet verdict.** Evidence so far: Luna completes everything, ~1
  guard block per batch and a few tics; zero security or honesty failures.

## Found building East from zero (2026-08-30)

The gate run: `interview-production` + `drive-inbox` on a fresh agent, two
requirements end to end. What got fixed in the same pass is in the commits and
in `docs/east-requirements.md` §5; what is left is here.

- **DECISION — where the model key lives, and who holds it.** The engine
  blocklists `OPENROUTER_API_KEY` out of every `terminal`/`execute_code`
  subprocess, so `transcribe.py` could not run inside ANY agent we ever shipped
  (`kit/notes/auxiliary-models.md`). It runs now because
  `TUAGENTE_MODELS_KEY` carries the same value under a name the engine does not
  strip — **which means any command the agent runs can read a spendable model
  key**, exactly what the blocklist exists to prevent. Bounded by the per-client
  key with a limit we set, rotated with one `PATCH`. **The narrower answer is
  for the ADAPTER to do the transcription**: it already has the key, already has
  `./data` mounted, and the agent cannot execute code inside it — so the agent
  would POST a path and never see a credential. That is an adapter surface and a
  statement about where credentials live, so it is Luis's call, not a patch.
  Until then the key is on the agent and this line is the record of it.

- **`transcription`'s `detects` answers the wrong question.**
  `connections/catalog.json` detects `auxiliary-models` by the presence of
  `OPENROUTER_API_KEY` — which is true on every agent and says nothing about
  whether the agent can transcribe. The card reads active either way, which is
  how the capability stayed sold and dead for months. Should also check
  `TUAGENTE_MODELS_KEY`, or whatever survives the decision above.

- **Seventeen `level: menu` rows still install a `kit_skills` name nobody has
  written** (dossier §3.2). `check-plugins.py` does not catch it, on purpose —
  a menu row may name work that starts when a client buys it — but the count is
  what a salesperson would want to know before promising one. `interview-production`
  and `drive-inbox` are now two of the eight rows that are real.

- **The zócalos run shipped TWO DIFFERENT client-facing lists, and this file
  said it shipped the same one twice.** The entry here used to read "the agent
  asked twice, `deliver.py` correctly refused to overwrite, costs a file, not a
  client". Checked on 30/8 against the files: the md5s differ, and so do FIVE of
  the ten zócalos («16 ALLANAMIENTOS PERMITIERON DESARTICULAR UNA ORGANIZACIÓN»
  vs «16 ALLANAMIENTOS SIMULTÁNEOS EN EL DEPARTAMENTO DE MALDONADO», …) plus one
  timecode (zócalo 8: `02:41–02:53` vs `02:41–02:45`). `-zo-2.md` is a revision,
  not a duplicate: it is the better list, it is the one the approval request
  cites, and `-zo.md` is a superseded, slightly worse version of the same
  deliverable sitting in `entregables/` with NOTHING marking it stale. A client
  opening Archivos sees two conflicting zócalo lists for one interview and no
  way to tell which is live. `deliver.py` never refused anything — it was handed
  two different payloads under two names, which is exactly what it is for. Not
  "costs a file": decide whether a deliverable can supersede another one, and
  whether re-delivering into the same flow+ticket should say so.

- **`news-copy`'s emoji rule now has a second data point, and it holds.** The
  entry used to say the reworded spec ("the copy CARRIES 1-3 emojis" rather than
  "up to") was untested, the first run having produced zero before the wording
  changed. A fresh run through the same skill on 30/8 (a Radio Viva note on the
  Piriápolis school, session `api-0d53fa3b`, US$0.044) produced TWO — 🏫 and 📍,
  both inside the copy, neither decorative. One run is not a rule, but the
  reword is no longer unobserved.

- ~~**THE NEWS FLOW OPENS NO TICKET AND ASKS FOR NO APPROVAL, measured on a
  re-run.**~~ — **CLOSED 30/8/2026: the promise has a supplier.**
  `skills/news-copy/open_news_ticket.py` opens the ticket before the note is
  read, keyed on something the code can compute twice with the same answer:
  the NORMALIZED url for a link (`www.`, `http`, a trailing slash, `?utm_*`
  and a `#fragment` all fold into one key; the path's case and a routing
  `?id=` do not), the file's bytes for a file, the text for a paste — so the
  other two entry paths are covered too. Step 1 of `news-copy/SKILL.md` is
  running it, with the firmness the interview side uses, and the approval is
  asked for in that ticket. Where it is FIRMER than `fetch_video.py`: a board
  that refuses the ticket stops the work instead of carrying on with a
  warning — that one still has the audio, worth keeping; here the ticket is
  the approval's only address. `tools/test_open_news_ticket.py` (32 tests) is
  the proof, and the interview side still has none of its own.

  Measured end to end on `east-v2`, two real notes from subrayado.com.uy:
  the script is the first tool call, the draft is saved with `deliverable` and
  named in the ticket, the request goes in as a comment and the card is
  blocked `needs_input` — `t_db70d562`, pending in `/portal/approvals`.
  Idempotency, live: the same URL again, and the same URL mangled with
  `www.`/`http`/`?utm_source=whatsapp`/a trailing slash/a fragment, both
  answered `t_db70d562` and the board stayed at five cards. US$0.0225 +
  US$0.0252 (sessions `api-36d062a2`, `api-40d6c71b`).

## Open product decisions

- **A way for a plugin or a sub-agent to FAIL OUT LOUD instead of delivering
  bad work** (Luis, 2026-09-20: «prefiero que falle a que me escriba un post
  con imágenes mal»). Today a delegate that cannot do the job well has one
  channel, its report to the face, and the face decides what the client hears;
  nothing marks the work as failed, nothing notifies, and a half-good post is
  saved like a good one. The first case was handled in prose (`creator.md`:
  what cannot be confirmed does not go into a post, save nothing and say why).
  What is undecided is the mechanism: a typed «could not» result a delegate
  returns and the engine turns into an event + a notification, and quality
  checks owned by code (a slide whose text does not match the brief) that can
  refuse a `save_post`. Not designed yet.
  Measured on the lab on 2026-09-21: two delegations of a slide fix crashed
  (a bug since fixed), the face hit the delegation cap, and it went on alone —
  copied a file over the post's slide with `bash` and then edited the picture
  with Pillow, cropping and enlarging the text. `instructions.md` tells it
  post files are not its to edit; prose did not hold once the proper path was
  closed. Whatever the mechanism is, «the delegate could not» has to end the
  turn with that sentence, not open the face's workshop.

- **Pricing and offer structure**: the proposal on the table is a small paid
  diagnostic (USD 200-250) that gets deducted from setup, instead of a
  USD 1000 upfront fee.
- **Skills and MCP integrations catalog**: proposed stance — the client
  requests, we install and audit; a curated catalog instead of open
  registries. Undecided.
- **Multi-board in the portal** (the "project" axis): the adapter can already
  read any board; missing the selector and making writes respect the chosen
  one.
- **The client has no way to customize their agent from the portal.** Today
  all customization (business rules, tone, what needs approval) happens by
  editing the SOUL by hand in the agent's repo — meaning, we do it. Luis's
  rule (8/4): anything client-specific gets requested **as the client,
  through the portal**; if the portal can't do it, that's a product gap.
  Still need to decide the shape: probably an "Instructions" tab that writes
  a bounded, versioned block, without letting the client override the hard
  rules (the approval gate is non-negotiable). Naming already shows the
  shape on the engine: `POST /portal/identity` → `identity.save()`
  (`engine/core/identity.py`) merges whatever the client sent into
  `identity.json`, no SOUL markers, no bot to rename — there is no channel
  bot any more since Telegram came out. The **look**, same story: the
  client picks it once at onboarding and there's nowhere to change it
  afterward; once the customization tab exists, it goes there.

## Technical, prioritized

1. ~~The `kanban` toolset gate~~ **RESOLVED on 8/4**: needs
   `toolsets: [kanban]` **and** `platform_toolsets` with kanban per platform.
   The plugin was removed from the kit. Recipe and repro in
   `kit/notes/native-kanban.md`. Still need to **file the issue
   upstream** with that repro (a toolset gated by `check_fn` and not declared
   configurable is unreachable via config, with no message saying so).
2. ~~Migrate La Mano to the new recipe~~ **DONE on 8/5 (overnight)**: plugin
   removed, `platform_toolsets` added, gateway restarted with no work in
   flight. Verified: 12 native tools across api_server/telegram/cron, and the
   agent closed a test ticket using them.
3. ~~Test the full onboarding with a disposable agent~~ **DONE on 8/4**:
   "Acme" was created from scratch, passed `portal-check` with 11 ok /
   0 failures, and the agent created and displayed a ticket using the native
   tools. What came out of it: the offline `agent-check.py` check, the kanban
   recipe, and the missing frontmatter.
4. ~~Cut down the fixed context~~ **PARTLY DONE on 8/5**: `new-agent.sh`
   already creates agents with `agent.disabled_toolsets: [tts, delegation]`
   — schemas drop from 67.6 to 60.0 KB. Still need to evaluate
   `session_search` (6.3 KB) and `browser` (6.2 KB), the next candidates, but
   they are actually used. **A finding that changes the intuition:** tool
   schemas weigh almost twice as much as the entire system prompt, so
   trimming SOUL prose is the wrong place to save.
5. **Graduate the portal's local fetchers to `lib/agent.ts`** (pipeline,
   approvals, artifacts, tasks each have their own copy, marked with a TODO).
6. **A ticket has no way to name the approval that was opened about it**
   (found 9/16 building the Inbox). A row in `approvals` carries the session
   the run stopped in and the tool call it stopped at, not the ticket
   (`kit/plugins/approval/core/store.py`), and `/portal/approvals` publishes
   `id, title, summary, body, created_at, status`. So the Inbox's «Ver en
   Aprobaciones» finds the card by looking for the ticket's id INSIDE the
   card's text — the mail plugin writes it there, an Instagram reply's card has
   no ticket to write — and falls back to the tab. What would close it: the
   gate reading a `ticket_id` out of the stopped tool call's arguments when it
   has one, storing it on the row, and `list_pending` publishing it. Then the
   chip points at the card, always, and Aprobaciones could show which
   conversation a request belongs to.
7. **Watch** that the `kanban.db-shm` error doesn't come back (fixed with
   `PRAGMA query_only`, but worth watching for a couple of days).
8. **43 dossiers in `workspace/leads/`** whose tickets the 8/3 purge deleted.
   They're real research on 43 companies: **recommend keeping them**, they're
   the raw material for the prospecting list. Close unless decided otherwise.

## Open after the night of 8/4→8/5

- **Create tuagente's Google OAuth app.** It's the step that unblocks
  Sheets/Drive/Calendar for every client, and also the stalled email task.
  Full runbook in `kit/connections/google-workspace.md`.
- **Connections: the write path is missing.** Today the portal shows status
  and lets you *request* the connection (creates a ticket); we still do the
  actual connecting by hand. This is deliberate: asking a non-technical
  client to paste credentials into a screen teaches them to hand out
  secrets. Revisit once a connection has repeated ten times.
- **The agent still reaches for the terminal before its own tools.** It
  tried `sqlite3` and `bs4` via Python on tasks where the native tool was
  right there. Nothing broke (it fails in hundredths of a second and
  recovers), but it costs turns. Its memory already tells it not to, so
  **one more prompt rule isn't the fix**; noted as behavior to measure, not
  patch.
- **From the Uruguay market survey** (`docs/uruguay-connections.md`), what
  needs checking before we promise anything: whether Uruware gives API
  access to an integrator, what sandbox Plexo has, whether Tiendanube
  requires publishing an app, and how long WhatsApp verification really
  takes in Uruguay.

## Out of scope by decision

- **Railway / getting the agent off the Mac**: deliberately postponed until
  we're done iterating on the interface.

## Entregas — decided removed, not merged (2026-09-23)

**Superseded.** The merge below assumed an `artifact` (HTML) skill that no
longer exists: since 2026-09-23 `deliverable` is the only one, it uses
engine paths (`/opt/kit/plugins/deliverable/skills/deliverable/deliver.py`,
`/workspace`), and the extra mount that put a copy at `/opt/kit/skills/` is
gone from both composes (`engine/README.md`, gate G3). The portal dropped
the Entregas/artifacts tab the same day — nothing produces an HTML artifact
today. Open: whether a deliverables view (what `deliverable` writes to
`workspace/entregables/`, today only reachable through Files) is wanted as
its own tab later. Nobody has asked for it since the removal.

~~A single main tab with EVERYTHING the agent produces — deliverables
(md/xlsx/files) + artifacts (HTML) — grouped by flow. Today Artifacts (HTML
only) got promoted to a main tab as an interim step; the `artifact` skill
needs to gain `--flow` the way `deliverable` already has it. Once merged,
Files stays under "Más" as a raw view of the workspace.~~

Email being the only connection prospecting waited on (from the 8/9
Connections work, below) is moot — `mail` is a native engine plugin now.

## Open from today's audit (2026-09-23)

- **Onboarding promises to keep reading the client's site; the engine
  doesn't.** The overview/notify step says *"Mientras tanto sigo leyendo tu
  web: lo que saque queda en Archivos"* (`app/app/lib/onboarding.tsx:622`)
  whenever a URL was typed, and the identity payload does carry `url`
  (`identity.save()` merges whatever the portal sends,
  `engine/core/identity.py`). But nothing on the engine ever reads it back —
  no scraper, no flow, no plugin. Decision pending with Luis: build the read
  (so the promise is true), or drop the line (so the portal stops promising
  it).
- **`portal-check.py` caught up — done 2026-09-23.** The docstring no longer says Hermes, and the files check asserts that nothing is served as html/svg/js and that `nosniff` is set, instead of `text/plain` for everything.
- **The seams kept on purpose, until the Hermes fleet dies** (`CLAUDE.md`'s
  rule against NEW ones — these are old, and none is being extended):
  two base URLs (`endpoint` + `adapter`) in `app/app/lib/agent.ts`, which the
  engine plays along with on purpose (`engine/server/app.py`: one process,
  two ports, so the portal needs no engine-specific branch); `chatStream`'s
  OpenAI dialect, in both the request and the SSE response shape
  (`lib/agent.ts`); `/api/jobs` tying a flow to its cron by the name
  `flujo-<slug>` instead of a real id (closed on the engine itself —
  `trigger_job` publishes a real one, `engine/server/flows.py:89` — but the
  portal's matching code hasn't been simplified to use it yet); parsing the
  Hermes gateway's OpenAI-style `{error: {message}}` alongside the engine's
  flat `{error: "…"}` (`lib/agent.ts:211-219,954-959`); and `SKILLS = []` in
  `approval/core/plugin.py` and `social/core/plugin.py` (see "The engine:
  Pydantic AI, decided" at the top).

## Skills of its own the adapter can't edit — REMOVED

The whole question is moot: the portal's Habilidades tab is read-only by
design now (`app/app/skills/page.tsx`: "a change to how the agent works is
asked for over the chat"), so there is no Edit button to gate on
`editable` any more, on either engine.

## Approvals and comments — what was left open after the 8/12 batch

**Who unblocks it:** the portal, except where it says otherwise.

What got closed in that batch is in the code and in
`docs/portal-routes.md`: the comment filter now checks **who signed it**
before applying the machine formats (`readComment` in `lib/agent.ts`), a
rejection with no reason block shows the raw text instead of going blank,
the reason no longer gets cut at the first quote mark, the **close the
request** checkbox sends `{"final": true}`, and the negotiation status gets
read from the thread. What's still open:

- **The proposal box can still be showing the old version.**
  `chooseProposal` grabs the latest proposal that has a **markdown table**,
  and the agent can't be forced to use one: if it answers in prose, what's
  on top stays what the client already rejected. The big hole got patched —
  the screen no longer **claims** that's the current one: when the proposal
  predates the last "no", "Le dijiste que no a esto" shows up — but
  correctly picking the new version is still unresolved. The real fix is on
  the kit: either the `approval` skill goes back to always proposing in the
  same format, or the adapter marks which proposal is current instead of
  letting the portal guess from the shape of the text.
- **The derived "Le dijiste que no" note only shows up with the card
  expanded**, because the ticket detail gets fetched on expand (one call per
  request). That covers the case that matters — the buttons are in there
  too — but the collapsed list doesn't distinguish a request mid-negotiation
  from a fresh one. If that chip is ever wanted, it should come from
  `/portal/approvals` saying whether the last comment is a client rejection,
  not from N detail calls.
- **`splitProposal` drags the agent's closing remark into the editor.** It
  cuts after the last table row, so if the agent writes something after the
  sendable text ("avisame si querés que lo mande hoy"), that ends up inside
  "Corregir y aprobar" as if it were part of the email. It's the same kind
  of coupling as the rest: the portal parsing the agent's free-form text.
- **`loadAgentName()` empty = two names on the same screen.** The sidebar
  says "Tero" (comes from the manifest) and the new copy says "Tu agente"
  (comes from localStorage, which is empty if the client didn't do the
  naming from THIS browser). While it stays this way, it's better to write
  new copy without interpolating the name — the close-the-request checkbox
  was left this way on purpose — because interpolated it shows up
  capitalized mid-sentence ("y Tu agente no lo vuelve a traer"). The real
  fix is for the name to come from the manifest everywhere.

**REMOVED — G-4, the "doesn't exist" notice in Connections.** Measured as
not reproducing on 8/12, over a route (`/portal/connections`) that no
longer exists: the portal dropped the Conexiones tab 2026-09-23. Moot on
both counts now.

## Kit installers — Hermes-only (8/12)

`install.sh`/`deploy-remote.sh` gaps and closures — none of it runs on an
engine instance, which is stood up by hand under `engine/instances/`, not
installed: the "keeping it" orphan notice fires once and never again (needs
`.kit-orphans`), the two composes (`docker-compose.example.yml`,
`docker-compose.remote.yml`) are hand-maintained and can silently drift (the
audit dropped `HERMES_DASHBOARD=0` and the check stayed green), `find -type f`
doesn't see symlinks. Three privilege-escalation bugs found and closed the
same day (P1 command injection through `data/config.yaml` into a root
`ssh`, P2 the deployer reopening `data/config.yaml` on every run, P3 the
secrets migration dropping `TELEGRAM_ALLOWED_USERS`), plus the
adapter-migration guard that failed open and was removed outright (23/8).
The adapter's own privilege model (`data/scripts/`, `data/.env`, `policy/`
write access) is under "Only while the Hermes fleet runs" near the end —
none of these paths exist in the engine's shape.

## The pattern behind the last three rounds, and what to build (8/12)

Seven bugs across three rounds in a row are **the same bug**: *a file the
agent can write ends up interpreted by something that runs with more
privilege than it has* — the adapter's code, `data/.env`, `data/config.yaml`,
the `cont-init` that runs s6, the cleaner's manifest, the `default:` that
`observability.sh` fed into a root `ssh`.

The proposal was a **consumer inventory**: a table of *who reads X · with
what privilege · who can write X*, and a check that fails when the writer
has less privilege than the reader. It still stands, with three corrections
that came out of the audit and are the real lesson learned:

1. **It's missing a fourth column: WITH WHAT GRAMMAR IT READS IT.** That's
   literally today's bug. `data/.env` was already in the table, we already
   knew who reads it and with what privilege, and the guardrail failed
   anyway: the kit parsed it with a bash regex (`^NAME=`), and the consumer
   with godotenv, which accepts `export` and trims whitespace. `export
   PYTHONPATH=/opt/data/evil` was invisible to ours and perfectly visible to
   theirs. **A three-column check would have come back GREEN on the
   poisoned file.**

2. **Validate with the consumer's parser, not ours.** For `secrets.env`
   this is already implemented and it's cheap: after migrating,
   `migrate-secrets.sh` runs `docker compose config` and checks that no
   dangerous variable reaches the services' environment; if one does, it
   undoes the move. The general rule: when a check of ours asserts something
   about a file another program reads, the assertion is only as good as our
   parser — so you have to ask the one that actually reads it.

3. **The inventory has to include consumers that are NOT on the server.**
   `observability.sh` runs on the operator's Mac and was the first path to
   root on the VPS; `bot-photo.sh` and `avatar-bot.py` also read agent data
   outside the container. A table built from the compose mounts doesn't see
   them.

And a warning that has to be **printed by the check itself**, not just live
here: *the check can assert that the table is complete with respect to the
declared mounts, but NOT that it enumerates every consumer — that's still
human work.* Nobody should read "0 failures" as "there are no more paths".

## Minor: the kit's config is born stale for the engine

`compose/config.base.yaml` doesn't declare `_config_version`, and the engine
logs on every boot that the config "predates version 12 (~2 years old)" and
that it can no longer auto-migrate it. It doesn't break the boot — it falls
back to compatible defaults and the knobs get applied, verified — but it's
the kind of thing that on an engine bump silently stops being benign,
everywhere, all at once. Still need to decide the number, set it, and have
`agent-check.py` require it.

## The last five from the 8/12 batch — closed, and what they left open

**Who unblocks it:** the portal.

Closed and measured against the lab agent (Tero), not from memory:

- **"Corregir y aprobar" turned off the warning and preloaded the rejected
  text.** The warning had `!correcting` in its condition, so it disappeared
  right when you hit the button it was warning against; and the draft came
  from `sendable`, which comes from the old box. Approving with a correction
  sends that text as "use exactly this version", which made it worse than a
  plain Approve. Now the warning stays up while correcting (with different
  text), the box **starts empty** when the only thing there is to copy is
  what she rejected, and "Lo que hablaron" — where the prose re-proposal
  lives — **stays visible while editing**, which used to get hidden.
- **The author label lied on the approval screen.** Approvals had a binary
  ternary (`isFromClient ? "Vos" : "Tu agente"`) and the founder's comment
  read as «Tu agente». `authorLabel()` moved up to `lib/agent.ts` and all
  **three** screens use it now (Approvals, Pipeline, and the entity viewer,
  which was a third copy and the most divergent one: it showed `portal` as
  "Portal").
- **There were three definitions of "the client".** Now there's one:
  `isTheClient = /^(cliente|portal)$/i` in `lib/agent.ts`. `user`/`usuario`
  came out of the **trusted** set — the one that decides what content gets
  hidden — and moved into the **labels** one (`AGENT_SIGNATURES`), because
  `user` is `hermes kanban comment`'s default and showing that word on
  screen is a machine identifier stuck in the client's face. Measured: a
  comment signed `user` with "RECHAZADO POR TU CLIENTE…" no longer shows as
  «user · Lo rechazaste» with the body hidden, but as an agent comment
  **with its full text visible**.
- **`?request=` didn't bring the card into view.** One call to
  `bringIntoView()`. Along the way the helper learned something all of its
  callers were missing: **what doesn't fit in the window doesn't get
  centered, it gets aligned to the top.** The request card measures 1208 px
  against an 806 px window, and `block: "center"` left it starting at
  −201 — with the title and "Le dijiste que no" above the fold.
- **`docs/portal-routes.md` said the opposite of the code** (rAF where the
  code deliberately uses `setTimeout`, and "two causes" where there are
  three). Fixed, with the reasoning written down so nobody "fixes" it back.

What's **still open** after this batch:

- **`answered` doesn't distinguish the agent from a third party.** In
  Approvals, `negotiationStatus` treats the "no" as answered as soon as
  anyone who isn't the client comments, so a comment from the founder makes
  the screen say "Tu agente ya te contestó" when the agent said nothing.
  Now that the label distinguishes third parties, this is the last piece
  that doesn't. It can't be fixed with a list of names: the adapter needs to
  say which comment is the agent's. The same goes for `chooseProposal`,
  which could pick a third party's comment as the current proposal if it
  comes with a table.
- **A reason with an unclosed quote comes out with the opening one stuck
  inside.** `rejectionReason` cuts up to the LAST closing quote; if the
  client writes a single opening quote, that quote stays inside the
  excerpt. Cosmetic, but it's their own text inside quotes.
- **Closing a request asks for no confirmation.** The "esto no va más"
  checkbox plus Enter in the input are enough to close it, and closing is
  the only action on that screen that can't be undone from there (you have
  to ask for it again over chat). It should confirm, the way "Archivar"
  does in the Pipeline.
- **`BLOCKED:` gets filtered in Approvals but shows up in the Pipeline**,
  where it also repeats what the "POR QUÉ SE FRENÓ" banner already says
  three lines up. `isMarker()` lives in `approvals/page.tsx`: it needs to
  move up to the lib and get used in the Pipeline too.
- ~~**In Tasks the same line shows two different times**~~ — **Done
  2026-09-23**: the manifest now publishes `timezone`
  (`engine/server/portal.py:54`, see "Flows that tell the truth" below,
  item 4), which is the fix this bullet was asking for.

## Flows that tell the truth — closed on 8/13, updated 2026-09-23

The blind QA session on 8/12 turned up the portal's worst finding: **the
screen was lying in green.** The vet clinic had two flows showing the
"Activo" banner; both had already run and **failed**. She found it in
Activity — tucked under "Más" — and when she asked the agent about it, it
told her the truth: *"todavía no te podés olvidar del tema: la última
revisión automática falló"*. Her verdict: *"lo pagaría, pero mientras la
pantalla mienta en verde sigo con la misma carga mental"*.

**Closed in the portal (8/13), without touching the agent:** Flows
cross-references `/portal/flows` with `/api/jobs` and each card says whether
it ran, when, how it went, when the next one is, and — if it failed — why,
in plain language, with the raw error collapsed underneath. Pause, resume
and "probarlo ahora" are real buttons now. Activity comes out from under
"Más" and gains the sources it was missing.

What was needed next, in Hermes-kit terms back then — restated for the
engine, where a flow is a file and there is no separate job store
(`engine/core/flows.py`):

1. **Still open — changing a flow's day or time.** Not a gateway CORS
   problem any more: on the engine there is no separate job to PATCH,
   changing the schedule is editing the `cron:` line of the flow's own
   `FLOW.md`. What's missing is a verb: `POST /api/jobs/{id}/{action}`
   (`engine/server/flows.py`) only knows `pause`/`resume`/`run`, so the
   portal still sends the client to chat instead of writing the file
   itself.
2. **Done, closed.** `trigger_job` is published (`engine/server/flows.py:89`).
3. **Still open — deleting a flow.** Same shape as #1: a flow IS the
   `FLOW.md`, so deleting it is deleting one file — there is no separate
   cron entry left to orphan, unlike the Hermes worry this item was
   written against. What's missing is the same verb gap as #1: nothing
   exposes it yet.
4. **Done, closed.** The manifest publishes `timezone`
   (`engine/server/portal.py:54`); the portal no longer needs to borrow an
   offset from another date.
5. **Still open, in a smaller shape.** The engine's events are already
   ONE table (`core/db.py`'s `append_event`, written from flows, kanban,
   mail, notify, memory, delegation…), which is far more than the old
   two-source `executions`/`task_events` split. But the portal still does
   the patch job itself, in the frontend — merging `/portal/files` and
   `/api/sessions` into the timeline (`app/app/activity/page.tsx`) — so
   the actual fix (the endpoint hands over a log already folding in files
   and sessions) still hasn't happened.
6. **Done, closed.** The `notify` plugin raises the alarm now — a broken
   flow reaches the owner through their channel
   (`kit/plugins/notify/core/notify_loop.py`; "Telling the owner" above).

---

## Second round on 8/13 — what the audit closed and what it left open

The 8/13 fixes (flows, clock, onboarding) went through **three independent
audits**: one on onboarding, one on flows and activity, and one on the whole
portal against the served build. All three measured on screen and against
the lab agents, not by reading code. All 15 declared points came back
**passing**.

What they found IN ADDITION, and is already closed (commits `b5fe118`,
`3cf0e4a`):

- **The lie survived in the Flows summary**, which is the first line anyone
  reads: it lumped "falló", "no arrancó" and "ya no está programado" into a
  single *"N no pudieron terminar la última vez"*, contradicting the cards
  below. Now it names them separately and **the total matches the cards** —
  there's a check that cross-verifies it mechanically, so the lie doesn't
  come back.
- **"Trabajando ahora" showed the start time of the previous run.**
- **Chat counted days with the browser's clock**: a conversation from
  02:40 fell under "AYER" while Activity put it under "HOY".
- **The timezone was a learned fact that only 3 of the 11 screens actually
  learned.** The fix moved out of the screens and into the single network
  entry point: `get()` learns from any date carrying an offset, and startup
  goes looking for it. It only learns **from known keys**: sweeping the
  whole JSON would let a ticket's markdown set the clock.
- **Onboarding repeated itself over an already-named agent** when switching
  agents, and answering it would write to it. Now the manifest wins over
  what the browser remembers.

### What was left open

1. **`overdue` masks an earlier failure.** In `runs.ts` the "didn't start
   when it was due" state gets evaluated **before** "the last run failed",
   so a flow that failed *and* also ended up overdue only shows the
   overdue state. Fixing it halfway throws the summary out of sync with the
   cards: it's its own batch of work.
2. **The modal for a client request still offers "Aprobar".** It's the same
   lie that got pulled out of the label (those tickets aren't waiting on
   anything from the client), but removing the action leaves them with no
   way to unblock from the portal except Archive. Pending product decision.
3. **The "Completados" column ended up singular** ("Completado"): that's
   the price of adopting the shared word from `labels.ts`. If the plural is
   wanted, it needs its own label again.
4. **Three of Tero's tickets arrive with `status: "todo"`**, which neither
   `columnOf` nor `taskStatus` recognizes; both send it to "En curso". It
   works by accident.

### A trap in the engine's API, for whoever sets up the next client

`GET /api/jobs` **hides paused ones**: you have to ask for
`?include_disabled=true` (`gateway/platforms/api_server.py:5262`). The
portal has done this since its first commit, but anyone testing with plain
curl will read "doesn't exist" where the engine means "paused". Verified on
8/13 by pausing one of Pulga's crons: the job disappears entirely from the
list.

### What was verified live and is worth not re-litigating

Against Pulga, on 8/13, with real POSTs:

- `POST /api/jobs/{id}/run` on a paused flow **unpauses it**
  (`enabled:true`, `paused_at:null`): the engine implements "run now" as
  "bring the next trigger forward".
- **Pausing with a run in flight does NOT kill it**: paused at 12:39:49,
  the run finished at 12:40:56 with `ok`, and the job stayed paused. That's
  why the portal's guard re-pauses *after* the engine has picked up the
  run, not before.
- The triggered run shows up as `latest_execution.status: "claimed"` after
  ~36 s. It's the only source of "it's running": the engine **never**
  writes `state: "running"`.

---

## 8/13 close-out — the real-estate agency's blind test

A fourth lab agent (new industry, never used) handed to someone with no
access to the repo, the docs, or any idea what the product is. They found
the worst bug of the day and half the list above.

**Her number:** US$150–250 a month for what she saw, US$300 "sin discutir"
with overdue payments and guarantor files. Today, **zero**, and the reason
is a sentence the other two clients had already said: *"no puede leer mis
contratos ni avisarme por WhatsApp, que son las dos cosas para las que lo
quiero"*.

### What got closed in the portal

`53ef4b9` the deliverable link couldn't be tapped (plus tokens, English,
file uploads) · `a4ae59b` "Aprobar" on a blocked ticket burned it (plus the
unified vocabulary, Home vs Flows, last activity, and the greeting) ·
`3e34d78` the welcome screens drew a fake interface.

### What got closed in the kit

`3e67a0c` the agent claimed work it hadn't done · `cdb9948` every chat
started from zero · `5541488` "el chat no me contestó nunca".

### OPEN AND SERIOUS — the gate fails open under load

Measured on 8/13: `shell hook timed out after 25.54s` with the machine
under load. The gate is declared with `timeout: 10` and **a hook that times
out lets the tool through** (`agent/shell_hooks.py:509-515`), with a
`logger.warning` nobody watches. In other words: **under load, the approval
barrier stops being a barrier**, and the only trace is left in a log. It
can't be closed from the config. Detail in
`kit/notes/engine-knobs.md` §8.

It's the most serious hole still open today, because it nullifies from the
outside all the day's work on the gate.

### Other open items from this round

- **The promises plugin's correction doesn't stick in the history.** The
  engine persists the turn (`turn_finalizer.py:352`) before transforming it
  (`:485`), so `state.db` stores the original text: the client sees the
  correction when it arrives, and it disappears if they refresh. This
  closes upstream.
- **A 422 s call to the provider with nothing on screen.** The SSE only
  sends `: keepalive` every 30 s and `delivery_ledger` doesn't cover that
  path, so the chat looks stuck. It's not the engine's fault: **it's a
  product issue, in the portal** — the client waited 15 minutes staring at
  a little banner that didn't say how much longer.
- **The plugin isn't on the remote agents.** `deploy-remote.sh` uploads the
  new compose but **doesn't overwrite an existing `config.yaml`**:
  Mr.Wobble and East need `plugins.enabled` added by hand. Tero, Faro and
  Pulga are still on SOUL v10 and without the guard. *(30/8: Mr.Wobble and
  East are both gone. The `config.yaml` gap is still real for any agent
  deployed over an existing one — that is what to keep from this line.)*
- **`flows/page.tsx` still shows the declared cadence** (`f.trigger`): if
  the FLOW.md goes stale, Flows contradicts itself. Home already got fixed;
  Flows didn't.
- **Writing to memory depends on the model calling the tool**: there's no
  knob for automatic extraction (`config_defaults.py:1531-1554`). The read
  side got fixed, which was our gap.

## Hidden usage, and the money we don't see (8/16) — RESOLVED on 8/19

**Already done:** adapter 0.39 exposes `GET /portal/usage`, which asks
OpenRouter for the agent's key and serves today / this month / all-time; the
tab came back (`HIDDEN_MODULES` is now empty) and the old `/portal/usage` —
a different, already-removed endpoint that carried the wrong number — is
gone. Only point 1 below is still open: **how we bill the client** — the
screen now tells the truth, but it still isn't an invoice. What follows is
kept as the record of why.

**The Usage tab and Home's "Consumo" block are outside the portal.** Home's
block got deleted; the tab sits behind a switch (`HIDDEN_MODULES` in
`app/app/layout.tsx`), which also redirects `/app/usage` to `/app/home` —
pulling it out of the nav wasn't enough, the route lived on in bookmarks and
in `portal-routes.md`.

Two reasons, and the first is the one that rules:

**1. It still isn't decided how we bill the client.** Showing them a
dollar figure before that answers a question nobody asked, and worse: it
suggests we're going to charge for usage, which is exactly what's
unresolved.

**2. The number was wrong, and wrong on the low side.** Measured on 8/16
against Mr.Wobble:

| | |
|---|---|
| litellm recorded (141 calls) | US$ 0.1675 |
| OpenRouter charged that day | US$ 1.5152 |
| **unrecorded** | **US$ 1.3477 — 9x** |

The whole difference is **image generation**. The cause is structural, not
a screen bug:

- `image_generate` is an engine plugin
  (`/opt/hermes/plugins/image_gen/openrouter/`) that hits OpenRouter
  **directly**. It doesn't go through litellm, which is where everything we
  record in `costs.jsonl` comes from.
- And the plugin **discards the `usage` OpenRouter returns**: it doesn't
  log it or include it in the tool's result (verified — there isn't a
  single mention of `usage` or `cost` in its code). From inside the agent,
  that money is invisible.

**The path that works, already tested:** `GET
https://openrouter.ai/api/v1/key` returns the key's `usage_daily`,
`usage_weekly` and `usage_monthly`. It's what the provider **actually
charged**, not an estimate of ours, and since each agent has its own key the
number already comes isolated per client. Tested from inside the container
on 8/16: it works.

What's left is a short cron that reads it and stores it, with the real
headline total up top and litellm's per-model breakdown below it (which the
key endpoint doesn't give).

**The one NOT to take without testing on a disposable agent:** pointing the
image plugin's `base_url` at litellm. The provider resolver already broke a
live agent this week, and `resolve_runtime_provider` resolves by provider
name, not by whatever `image_gen`'s config says.

None of this unblocks itself: while Usage stays hidden it bothers nobody,
but **the day the billing model gets decided, this is the first thing to
fix** — and if the screen gets switched on without fixing it, the client
plans around a number 9 times smaller than their actual bill.

## What the fresh deploy of 24/8 exposed

tuagente.uy's own agent was rebuilt from zero on the VPS where Mr.Wobble
lived, following the documented remote path end to end and writing down every
place the runbook made us deviate. It came out working — `portal-check` 13 ok
· 0 failures through both HTTPS hostnames — and it exposed nine things. The
first two are live bugs a client hits; the rest are the runbook lying.

**1 and 2 are CLOSED, twice over.** They were fixed on 25/8 in adapter 0.42.2
— `_soul_block` stopped emitting a paragraph whose datum is missing, and
`agent-check`'s «SOUL: identity» started reading INSIDE the block rather than
just finding it — and then, on 30/8, the shape that produced them stopped
existing. Kept in one paragraph because the failure mode is general and will be
back in another costume.

**1 and 2, the record.** The product's then-flagship shape could not satisfy
the identity check every runbook calls mandatory: a team client was never asked
to name their agent, so `POST /portal/identity` never carried a `name` and
nothing wrote one by hand. Worse, the step the client DID answer — the business
one — called `write_identity_to_soul("", company, url)`, and `_soul_block`
emitted its first paragraph unconditionally, so the block landed as *«Tu cliente
te bautizo **** desde el portal. Ese es tu nombre…»*: the first thing onboarding
did was instruct the agent to introduce itself as the empty string. And it
turned the check GREEN, because the check only looked for the block. **The
lesson, which is what survives: a check that asserts a block EXISTS asserts
nothing about what is in it, and a template that emits a field unconditionally
will one day emit an empty one into a prompt.** Both halves are now structural
— naming is the first step of the only onboarding there is, and as of adapter
0.43.0 a `POST /portal/identity` that would leave the agent nameless is a 400.

**3. `deploy-remote.sh`'s closing step 3 tells you to run `agent-check.py`
over a copy of `data/` alone**, which fleet.md documented as broken on 14/8
and the script still prints. Reproduced against this deploy: syncing only
`data/` gives **8 failures, 7 of them invented** — the gate open, no promises
guard, no pairing patch, no capabilities catalog, no kit skills, no
credentials. All seven live NEXT to `data/`, not inside it. The instruction
has to be the whole tree (`rsync -rlpt --delete <host>:/opt/agentes/<slug>/
<local>/`), which is also what makes a durable local mirror worth having.
**Still open in the script** (re-confirmed 25/8: it printed the same
instruction verbatim). `docs/client-onboarding.md` Phase 2b now gives the
correct command, which is a workaround, not the fix.

**4. The runbook never brings the `API_SERVER_KEY` back.** Step 2 says to
generate it on the server, "not from here", and it is right about not
uploading it. But step 5 (`portal-check --key`) and step 7 (the magic link)
both need it on the operator's machine, and no step retrieves it. In practice
you `ssh <host> 'grep ^API_SERVER_KEY= …'` into a local 600 file; the runbook
should say so instead of leaving everyone to invent it. **Written into
`client-onboarding.md` Phase 2b on 30/8; still not printed by the script,
which is where an operator is actually reading.**

**5 and 6 are CLOSED — there is no roster to install.** They said that nothing
in the remote path installed `policy/roles/catalog.json` and that it had to go
in before the installer or the installer had to run twice. The file is gone. The
second half of 6 was never about the roster, though, and it is live: the deploy
computes the install against what it reads ON THE SERVER, so
`policy/capabilities/purchased.json` has the same before-the-installer ordering
requirement — which `deploy-remote.sh` now handles itself by copying it into its
staging, and which `docs/client-onboarding.md` Phase 3b spells out.

**7. CLOSED 30/8 — `docs/client-onboarding.md` Phase 2 was the LOCAL runbook, unlabelled.**
It says the compose is generated by `new-agent.sh` and gives a ports table with
8642/8643 on the host. On a VPS the compose comes from
`compose/docker-compose.remote.yml` via `deploy-remote.sh` and **publishes no
port at all** — that is the whole point of the remote compose. A reader
onboarding a VPS client is reading instructions for a different topology.
Phase 2 says so in its heading now and Phase 2b carries the remote path.

**8. CLOSED 30/8 — Phase 6 of the same doc said to run `portal-check` against
`http://<host>:8643`**, which on a remote agent is unreachable by design. It
has to go through the two hostnames, which is also the only way to test what
the client's browser actually traverses (Caddy, TLS, CORS). It gives both
commands now, local and remote, with the ports-are-not-optional warning.

**9. `deploy-remote.sh` leaves no `.gitignore`.** `new-agent.sh` writes one,
by allowlist, with `secrets.env` first — and the remote path, which is the one
that ends with a tree containing a live `secrets.env` being rsynced to a
laptop, writes neither it nor a README. Written by hand here; it belongs in
the script.

**And one operator lesson, not a kit bug:** piping `deploy-remote.sh` into
`head` SIGPIPE-kills it mid-run. It died inside `clean-obsolete.sh`, which
left `.kit-installed.new` unconsumed, one obsolete craft skill still mounted
`:ro`, and the final `chown` never run — so the freshly uploaded files stayed
`501:staff` on the VPS. The pipe masked the exit status. Redirect to a file;
re-running the deploy converged everything.

## HISTORICAL — the first hire, on a real client's request (25/8)

**The run this section reports cannot happen any more.** Hiring was removed on
30/8 (`docs/team-pivot-removal.md`); `tools/hire-role.sh`,
`policy/roles/requests.jsonl` and the roster are gone. The section stays because
three of its five findings were never about the hire — they are the deploy's,
the installer's and the mirror's — and they are still open.

The run, for the record: Luis onboarded through the portal as a new client and
hired `support`; fulfilled with `hire-role.sh --from-request`,
`deploy-remote.sh` and `observability.sh` — 82 s of hire, 5 min from request to
`hired`, 0 failures on both checks and **US$0.00 for the hire chain**.

**10. MOOT — a hire was three commands, not one.** `client-onboarding.md`
Phase 3b ended at `hire-role.sh`; the installer re-run was printed by the
script and the observability re-run lived only in a comment inside
`observability.sh` («RE-RUN THIS AFTER EVERY HIRE»), where no operator reads
it. **The transferable half is live and is now Phase 3b's job**: selling a
capability changes what `install.sh` ships, so it is edit `purchased.json` →
deploy, and on an agent with observability on, `observability.sh` after it.
A step that lives only in a comment inside the script that needs it is not
documented.

**11. `install.sh` tells you to delete the file `observability.sh` needs.**
Every deploy prints «there are keys in secrets.env AND in data/.env […]
delete the data/ one by hand». There is no key in `data/.env`: it holds
`OPENROUTER_BASE_URL=http://litellm:4000`, put there on purpose, and
`agent-check` reports the same file as OK — «credentials — 4 variables ·
data/.env holds OPENROUTER_BASE_URL». Two kit tools, opposite instructions
about one file. The warning should read what is in it instead of that it
exists. **STILL OPEN, and it is a solo bug**: nothing about it involved a role.

**12. MOOT — the hire ledger was stamped by two clocks and could read
backwards.** `requested_at` came from the adapter in the agent's TZ,
`hired_at`/`named_at` from `hire-role.sh` on the operator's machine, both naive:
a fulfilment six minutes after its request landed three hours before it. The
ledger is gone. **The rule it taught is not, and `requests.jsonl` — the
capability request log, which is still written — has the same shape**: a
timestamp written by two machines with no offset will eventually sort backwards,
and the first screen that subtracts them will lie. UTC with the offset, both
ends.

**13. The mirror does not version what the checks read.** `tuagente-agent/`'s
`.gitignore` keeps `data/*` out except `SOUL.md`, `config.yaml`, `connections/`
and the skills manifest. As written on 25/8 the casualty was
`data/profiles/support/`, which is gone with the profiles — but the allowlist is
unchanged and nobody has crossed it against what `agent-check.py` actually
reads. **STILL OPEN, and it is the general form that matters**: the mirror
exists to be what the checks read, and an allowlist that was never derived from
the checks will drift from them again. Decide, once, and write the rule down.

**14. The day-one spend is the brief, not the setup.** The pristine agent's
US$0.00 survived the deploy and the observability re-run untouched; the first
charge — US$0.0165 over 12 calls at ~22 k input tokens — is the `Conocer
<empresa>` ticket that onboarding's business step spawns a minute later. Worth
pinning: bringing an agent up costs nothing, and a client's first minute costs
a turn.

**Bug 3 is still exactly as reported**: `deploy-remote.sh`'s closing step 3
printed the `rsync -a … /data/` + `agent-check` instruction again, verbatim.
The whole tree gave 35 ok · 1 warn · 0 failures.

## The portal, 30/8 — onboarding was cut short by a background poll (CLOSED)

**CLOSED the same day, `3163a62`.** The gate reads the agent's answer ONCE,
with the session's first manifest, and onboarding owns its own completion: it
calls `onDone` when ITS flow ends and only then does the layout put it away.
Reproduced in jsdom against the real layout and the real onboarding, with a
mock agent that mutates its identity the way the adapter does — on the previous
HEAD the flow died at notify → carousel when the poll landed; now the five
steps survive a poll on every one of them. Kept written down because the shape
is general: anything long-lived that re-reads a value one of its own steps
writes has this bug.

The report, as found. Found in wave 1 of the team-pivot removal and
**pre-existing**: the gate condition is unchanged, wave 1 only
removed the `modules.roles` conjunct from it, which makes onboarding MORE
likely to render, not less. The pivot hid it, because on a team agent that gate
never fired at all.

`app/app/layout.tsx` refetches the manifest every 60 s. The channel step writes
`contact.channel`, which makes `onboardingAlreadyAnswered()` true, and the next
poll then unmounts `<Onboarding>` mid-flow: the client is dropped into the
portal without ever seeing the automations carousel or the chat step, and
`onDone` never runs, so the welcome screens are not marked seen either.

Reproduced by contrast on the demo agent, same build, same agent: a slow run
through the flow landed on `/app/home` straight after the channel question; a
fast one reached «¿Qué te saco de encima?» normally.

### Still open, and much rarer: a RELOAD in the same window loses the same tail

Found on 30/8 revalidating the fix in jsdom against the real `layout.tsx`. The
fix moved the decision to «once, on arrival» — `agentNeedsOnboarding` is read
from the session's FIRST manifest — and what closes the gate afterwards is the
browser's `seen.onboarding`, which only `onDone` sets. So a client who reloads
the tab (or reopens the magic link) **after the channel step and before
finishing** arrives with a manifest that is already `named` + `notify_channel`:
`agentNeedsOnboarding` is false on that new first read, onboarding does not
resume, and they land on the home welcome screen instead of the automations
carousel and the chat step. Same lost tail as the poll bug, triggered by a
reload rather than by a timer.

It is the trade-off the fix took deliberately, not a regression: the agent is
the only thing that knows anything across devices, and it cannot know how far
through the flow a browser got. **Closing it is a decision, not a patch** —
either onboarding writes its own progress somewhere durable (localStorage
resumes on that device only; a field on the agent resumes everywhere and adds a
write per step), or the last two steps stop being part of onboarding at all and
become something the client can reach from home whenever they want. Nobody has
picked, and nobody should pick it inside a bug fix.

Reproduced with the harness: an answered manifest plus `tuagente_intro_v2={}`
at `/app/home` renders no onboarding and a welcome screen instead.

It was a decision about onboarding, not a one-line guard: either onboarding
reads the manifest once at mount, or it holds its own completion flag and the
poll stops being able to speak for it. Both, in the end.

## Only while the Hermes fleet runs

Everything below only matters because `kit/fleet.md` still has three agents
on Hermes (the local demo, the VPS `tuagente`, and `east-v2`, the kit's own
validation agent). None of it describes the engine, and it isn't grown —
per "The engine: Pydantic AI, decided" at the top, a Hermes-only seam gets
removed when touched, never extended. It goes away whole, not item by item,
the day those three are rebuilt and the Hermes half of the kit is deleted.

**Ticket lifecycle guard, Hermes kanban CLI — CLOSED 30/8/2026.** A card
sitting in the client's approvals queue could be ended with `kanban complete`
or `kanban archive`, silently killing the approval it was blocked on. Closed
with a hook in `policy/hooks/gate.py` reading the real verbs off
`hermes_cli/kanban.py` and `tools/kanban_tools.py`, a `kanban_complete`
matcher added to `config.base.yaml`, and 21 new gate-battery cases. The
engine's own board (`kit/plugins/kanban/core/board_store.py`) has five plain
statuses and no verb that ends a ticket outright, so it needs no such guard.

**Naming mechanics, pre-engine.** The portal's `POST /portal/identity` used
to be saved by `portal_adapter.py` (0.26) into `portal_identity.json`,
written into the SOUL inside a `<!-- kit:base -->`-style bounded block, and
followed by a Telegram `setMyName` on the bot. The bot's photo had no Bot
API method — it went by hand through `@BotFather /setuserpic`, and the
SVG-to-PNG export for it (`lib/agentito.tsx`) was never finished. All
obsolete: Telegram is gone, so there is no bot to name or photograph, and
the engine's own naming (`engine/core/identity.py`) never touches a SOUL at
all — see "The client has no way to customize their agent" above.

**Worker orchestration** (assign, claim, dispatch, swarm): Hermes's native
tools don't expose it outside a dispatcher worker. Decided we don't need it,
for either engine.

**Connections — the MCP-guard-curated catalog and the kit-adapter's own
bugs (open after 8/9).** Mercado Pago written and audited but never run
against a real (sandbox) account (`kit/connections/mercadopago/`, three
bugs already fixed reading the popular reference integrations); the guard
never registered with `hermes mcp add` (`hermes mcp list` →
*No MCP servers configured*, so the agent sees none of the 41 curated
tools); WhatsApp pairing still pending, and has to be a disposable number
(whatsmeow can get a number blocked); Instagram's 23 `mcpware/instagram-mcp`
tools classified from its README, never audited against its code
(`kit/connections/instagram/README.md`) — all superseded, for our own
account, by the engine's direct-Graph-API `instagram` plugin, already
"BUILT, waiting on Luis for the credentials" at the top of this file. On
`portal_adapter.py` itself: a connection request takes two round trips to
be born blocked instead of one (`create_ticket`, `:1723`); a dependency
block on a ticket with no parents instant-re-promotes
(`hermes_cli/kanban_db.py:5530` + `recompute_ready`, `:3988` — a candidate
to report upstream to Nous, since it hits any ticket, not just ours);
`connections/catalog.json:31` claims Telegram's bot already exists when it
doesn't (moot outright — Telegram is gone); `notify_channel` in the
manifest is what the client answered, never checked against what actually
works (`:342`); `NOTIFY_CHANNELS` never accepted `whatsapp` (`:165`).

**Rejecting an approval — CLOSED 8/12, superseded rather than carried
forward.** `_reject` in `portal_adapter.py` made rejecting a single
`cliente`-signed comment that never spends an unblock —
`kanban_db.py`'s `BLOCK_RECURRENCE_LIMIT` is what made unblocking on
rejection kill requests after two rounds. The engine's own approval plugin
(`kit/plugins/approval/core/store.py`, `POST /portal/approvals/{id}/reject`)
is a from-scratch rewrite, not this code, and carries no `block_recurrences`
or `triage` state to spend in the first place. The lesson (never resolve
the permission you're asking for by spending its one real unblock on a
"no") is worth keeping in mind if the engine's board ever grows something
similar.

**Privilege — the kit-adapter's own security model (8/12).** Three hops
found chasing "a file the agent can write ends up interpreted by something
with more privilege": the adapter's code living in `data/scripts/`
(agent-owned, run as root) — closed by moving it to `kit-adapter/` `:ro`
under uid 10000; `data/.env` as arbitrary code execution inside the adapter
via a `PYTHONPATH` that shadows a stdlib module — closed by moving secrets
to `secrets.env`, outside any container mount; `data/config.yaml` writable
by the adapter through the shared `./data` mount — closed, now `:ro` for it
too. Left open as defense in depth: the adapter can still write inside
`policy/`, the same directory `guard.py` and the hooks live in — closes by
giving the adapter its own `state/` folder and making `policy/` `:ro` for
it too. None of these three hops exist in the engine's shape: no
`portal_adapter.py`, no `data/` the client's container writes to, no Hermes
`policy/` mount.

**A scheduled run that dies below the model leaves nothing (Hermes cron,
dossier §4.4).** 23 of the last 50 runs of an old comparison cron died on
`TimeoutError: Cron job idle for 922s` / `RuntimeError: Connection error`
with no turn left to obey the "leave a visible ticket" prompt, and nobody
looked at whether `hermes cron runs` exposes enough to build an
engine-level failure marker from the adapter. Superseded by the engine's
own shape: `scheduler.py` catches a run's exception itself and writes
`flow.failed` with no agent cooperation needed, and the `notify` plugin
raises the alarm to the owner on top of that — see "Telling the owner" at
the top and "Flows that tell the truth", item 6.

**The litellm proxy (`compose/litellm.yaml`).** `drop_params: true` fixed
Hermes sending `reasoning_effort`, a parameter OpenRouter rejects with a
400. The fix never travels with a normal `deploy-remote.sh` run — the proxy
is installed and brought up separately by `tools/observability.sh` — so any
Hermes agent with observability on needs it re-synced by hand. Moot for the
engine: it talks to OpenRouter directly, no litellm anywhere in `engine/`.
