# Pending (2026-08-04)

What's left open, and who unblocks it. Close it here once it's resolved.

## Migration to English (2026-08-23)

- **Migrate live agents (Mr.Wobble, East) to the English on-disk layout**
  with `tools/migrate-agent-to-english.sh` and install SOUL v13 — pending,
  untested against live hosts.

## Waiting on Luis (nobody else can)

- **Google credentials** for the CFEHYL email task. Need to download
  `google_credentials.json` from Google Cloud Console and run the
  `google-workspace` skill's `scripts/setup.py` once (it opens OAuth in the
  browser). The task is **paused** until then; without this it runs and fails
  every 10 min.
- **"Revisar leads e informe Uruguay" reminder**: paused. If you want it, it
  needs reactivating **by switching delivery to `telegram`** — with `origin`
  it points at a portal session, which can't receive messages.
- **Vercel variables** for pdelabs-landing: `EMAIL_USER` / `EMAIL_APP_PASSWORD`
  (the contact form has been fixed in code since 8/3).
- **Luna vs Sonnet verdict.** Evidence so far: Luna completes everything, ~1
  guard block per batch and a few tics; zero security or honesty failures.

## Open product decisions

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
  editing `SOUL.md` by hand in the agent's repo — meaning, we do it. Luis's
  rule (8/4): anything client-specific gets requested **as the client,
  through the portal**; if the portal can't do it, that's a product gap.
  Still need to decide the shape: probably an "Instructions" tab that writes
  a bounded block of the SOUL, versioned and reversible, without letting the
  client override the hard rules (the approval gate is non-negotiable).
  **Naming is already solved end-to-end (8/7)** and serves as the template
  for what's missing: the client gives it a name and a look during
  onboarding, the portal does `POST /portal/identity`, the adapter (0.26)
  saves it to the volume, reports it in the manifest, **writes it into the
  SOUL inside a block bounded by markers** (without touching the onboarding
  prose) and hits the Telegram bot with a `setMyName`. That delimited,
  rewritable block is exactly the shape we were looking for for the
  "Instructions" tab: copy it.
  What's still missing on this front:
  - The **bot's photo** on the channels: there's no method for it in the Bot
    API, it goes by hand through `@BotFather` (`/setuserpic`). The SVG in
    `lib/agentito.tsx` can generate the PNG, but the export step is still
    missing.
  - The client **can't change the look afterward**, once onboarding is done:
    there's nowhere to do it. Once the customization tab exists, it goes
    there.

## Technical, prioritized

1. ~~The `kanban` toolset gate~~ **RESOLVED on 8/4**: needs
   `toolsets: [kanban]` **and** `platform_toolsets` with kanban per platform.
   The plugin was removed from the kit. Recipe and repro in
   `hermes-kit/notes/native-kanban.md`. Still need to **file the issue
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
6. **Watch** that the `kanban.db-shm` error doesn't come back (fixed with
   `PRAGMA query_only`, but worth watching for a couple of days).
7. **43 dossiers in `workspace/leads/`** whose tickets the 8/3 purge deleted.
   They're real research on 43 companies: **recommend keeping them**, they're
   the raw material for the prospecting list. Close unless decided otherwise.

## Open after the night of 8/4→8/5

- **Create tuagente's Google OAuth app.** It's the step that unblocks
  Sheets/Drive/Calendar for every client, and also the stalled email task.
  Full runbook in `hermes-kit/connections/google-workspace.md`.
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
- **Worker orchestration** (assign, claim, dispatch, swarm): Hermes's native
  tools don't expose it outside a dispatcher worker, and we don't need it.

## Artifacts → "Entregas" merge (decided 8/7, pending)

A single main tab with EVERYTHING the agent produces — deliverables
(md/xlsx/files) + artifacts (HTML) — grouped by flow. Today Artifacts (HTML
only) got promoted to a main tab as an interim step; the `artifact` skill
needs to gain `--flow` the way `deliverable` already has it. Once merged,
Files stays under "Más" as a raw view of the workspace.

## Connections — open after 8/9

- **Mercado Pago: written and audited, NOT TESTED against a real account.**
  No endpoint has touched Mercado Pago yet. It needs to run against
  **sandbox** credentials (not production) and get verified end to end: the
  four read ones, the payment link, the refund (with its idempotency and its
  pre-check) and a **genuinely signed** webhook. Until that happens, no
  client gets promised this. The code is in
  `hermes-kit/connections/mercadopago/`, with three bugs already fixed that
  came out of reading the currently popular reference integration — the two
  most popular unofficial MCPs still have them.

- **The guard isn't registered in Hermes.** It's built and tested (against a
  fake MCP and against Mercado Pago), but the `hermes mcp add` that puts it
  in the agent's path is still missing. Confirmed on 8/9 with
  `hermes mcp list`: *No MCP servers configured*. Until then the agent sees
  NONE of the **41** curated tools (12 WhatsApp + 6 Mercado Pago +
  23 Instagram).
  - **Where `guard.py` lives matters**: it has to go in `/opt/policy/`
    (mounted `:ro`), not in `/opt/data/`. If the agent can edit the guard,
    there is no guard.

- **A third path around the policy is still open, unclosed.** The adapter
  **runs** `/opt/data/scripts/portal_adapter.py` — which lives on the
  agent's volume — and the adapter has `./policy` mounted read-write. If the
  agent overwrites that file and the adapter restarts, it runs the agent's
  code with permission to rewrite the policy.
  - On the Mac the agent can overwrite it, **but that's a Docker Desktop
    artifact**: bind mounts ignore ownership (the file got created as
    `hermes` inside a `root` directory with no write permission). On Linux
    it should be denied.
  - **This has to be confirmed on the VPS, not assumed.** If Linux doesn't
    block it either, the fix is to mount the script from a separate
    directory `:ro`, the same as the policy.

- **WhatsApp: pairing pending.** The bridge is running and the QR shows up
  in the portal, but nobody has scanned it. When it happens, it has to be
  with a **disposable number**: the QR path uses whatsmeow and Meta can
  block the number.

- **Email still isn't connected**, and it's the only connection a flow
  requests today (prospecting is sitting amber waiting on it).

- **Instagram: curated, NOT CONNECTED and CODE NOT AUDITED.** 23 tools from
  the official MCP (`mcpware/instagram-mcp`, Graph API) classified as
  15 read / 8 act.
  - **The classification came from reading the repo's README, not the
    code.** With Mercado Pago we learned that's not enough: the three bugs
    (the missing `X-Idempotency-Key` among them) only surfaced once we read
    the implementation. **Still need to pull down mcpware and give it the
    same pass**: verify each function does what its name says, and that the
    read/act class matches what it actually touches.
  - Still need to connect a real account and run the read ones end to end.
  - Prerequisites on the client's side: a **Business professional** and
    **public** account, and a linked **Facebook page** (the chosen MCP uses
    Facebook Login; the lighter path, *Instagram API with Instagram Login*,
    doesn't need a page but leaves out DMs).
  - **Reading is the reason for the connection**, not posting: without
    `get_media_posts` the weekly flow writes blind, repeats topics and steps
    on what's already gone out.
  - **For our own account there's NO app review** — Standard Access is
    auto-approved and covers reading *and* posting. (An earlier note said
    2-4 weeks; that was wrong.) The 2-4 weeks are for Advanced Access, for
    operating **other people's** accounts: that's the day this gets sold as
    a product, and it's worth starting that process early since it's
    waiting, not work.
  - **DMs are not going to work**: `instagram_manage_messages` requires
    Advanced Access even on our own account. The 3 tools are declared but
    dead.
  - **The token lasts 60 days and dies silently.** Needs refreshing before
    it expires; without that the connection kills itself every two months.
  - The `instagrapi`-based MCPs were ruled out: detection within hours and
    escalation to a **permanent ban**. With WhatsApp the risk is acceptable
    because the number is disposable; a brand account isn't.

  The full reasoning is in `hermes-kit/connections/instagram/README.md`.

## Rejecting an approval — CLOSED on 8/12, and why the detail matters

**Status: done on both sides.** It stays written here because the shortcut —
the one that looks obvious — kills requests, and someone is going to propose
it again.

The contract: **rejecting is ONE comment signed `cliente` and the ticket's
status does NOT get touched.** The ticket stays `blocked`, stays in the tab,
and the unblock gets spent exactly once across the whole negotiation: on
approval.

**Why it doesn't unblock, which is the opposite of what looks obvious.** A
ticket only has one useful `unblock`: `block_recurrences` climbs every time
it re-blocks for the same cause after an unblock, and at two
(`BLOCK_RECURRENCE_LIMIT`, hardcoded in `kanban_db.py`) the ticket goes to
`triage`, where Approve returns 409 and no CLI verb brings it back.
Rejecting-while-unblocking spent that single unblock on the first "no": the
agent would re-propose, re-block, hit the limit, and the request died. With
the auto-decomposer on it was worse: it split the ticket using the **old
body**, leaving the client a task in the queue that said "use the prepared
order for 8 hinges" when she had already corrected it to 20. It's in the
lab, in `t_b1fb02ad`: `blocked → unblocked → blocked → unblocked →
block_loop_detected → decomposed`.

- **Kit** (`portal_adapter.py`, `_reject`): `POST /portal/approvals/{id}/reject`
  does a single write — the `cliente`-signed comment that starts with
  "RECHAZADO POR TU CLIENTE" —, notifies the agent via
  `notify_agent_of_comment`, and returns `{ok, status, unblocked:false,
  in_approvals, notified, block_recurrences}`.
- **Portal** (`app/app/approvals/page.tsx`, `doReject`): a single call to
  that endpoint, nothing else. Before it was three calls, not atomic: if the
  last one failed, the comment was already posted and the screen said "no se
  pudo" — and retrying commented twice. The card **doesn't disappear**: it
  stays with the "Le dijiste que no" notice inside, and the agent's answer
  shows up right there.

Verified in the browser against the lab agent (8/12): status stays
`blocked`, one new comment per rejection, no `unblocked` or `decomposed`
event, and the agent answered on the same ticket.

**What NOT to do again:** neither `setTicketStatus(ready)` nor
`hermes kanban unblock` in the rejection path, not here and not in the kit.
And the text the adapter writes is for the machine: the portal shows it
filtered (`readComment` in `lib/agent.ts`) because it's signed `cliente`, and
without that the client reads "RECHAZADO POR TU CLIENTE. No hagas lo que
pediste aprobar…" above a "Vos" — a prompt she never wrote.

## Skills of its own that the adapter can't edit

**Who unblocks it:** whoever touches `portal_adapter.py`.

`GET /portal/inventory` lists, as `source: "own"`, skills that live inside a
category folder (e.g. `skills/content/social-content/`) but **doesn't set
`editable`** on them, and `GET /portal/skills/{name}` only resolves
top-level ones: it answers 404 «esa habilidad no existe o no es editable».

The portal no longer over-promises (the Edit button only shows up with
`editable === true`, and they still get grouped as the client's own, which
is accurate). But the client has skills built for them that they can't
touch, and nothing explains why. The real fix is on the adapter: either
`_skill_editable` should also resolve one category level, or the list should
send an explicit `editable: false` so it's at least a decision and not an
oversight.


## Privilege: the agent's paths to something that runs with more permission (8/12)

Two were open and **both got closed**; one defense-in-depth item remains.
It's written up in full because the wrong reasoning cost us a day: we
thought getting the adapter's code out of `data/` closed "both hops", and it
didn't: they were still two hops, just with a different key.

**CLOSED — the adapter's code.** It lived in `data/scripts/`, which belongs
to the agent, and the container ran it as root with `policy/` mounted rw.
Now it lives in `kit-adapter/`, mounted `:ro`, and the adapter runs as
uid 10000.

**CLOSED — `data/.env` as the `env_file` for both services.** This wasn't
"can redirect directories": it was **arbitrary code execution inside the
adapter**. The chain, measured against the real image, the adapter as uid
10000 with its code mounted `:ro`:

```
the agent owns data/ (and inside its container it runs as root)
  → writes data/.env with PYTHONPATH=/opt/data/evil
  → docker injects that variable when starting the adapter
  → /opt/data/evil/json.py shadows a stdlib module
  → "AGENT CODE RUNNING INSIDE THE ADAPTER"
  → that process has policy/ in RW:
      · rewrites hooks/gate.py               (the gate, so it lets
        everything through)
      · rewrites cont-init-patches.sh        (which hermes mounts as
        /etc/cont-init.d/03-patches and s6 runs AS ROOT on every startup)
```

Closed by moving the secrets out to `<agent>/secrets.env`, root:root 600, at
the agent's root, which no container mounts. The PoC repeated after the
change no longer executes anything. And if someone recreates `data/.env` by
hand, the compose doesn't reference it: it stays inert (verified with
`docker compose config`).

**CLOSED — `data/config.yaml`, the second consumer.** It was `:ro` for
hermes but **rw for the adapter**, which had it through the `./data` mount.
The adapter only READS it (default model, disabled skills, preamble), so now
it's mounted `:ro` for it too.

**OPEN (defense in depth) — the adapter can rewrite the guardrails sitting
next to it.** It writes `policy/policy.json` and
`policy/capabilities/requests.jsonl`, and to replace the first one
atomically (tmp + rename) it needs write permission **on the directory**
`policy/` — the same one holding `guard.py`, `hooks/`, `tools/`, `mcp/` and
`capabilities/catalog.json`. Whoever can write the directory can delete
anything inside it; tested. **The sticky bit isn't enough**: it protects
against deleting other people's files except for the directory's owner, and
the owner here is exactly this process. Today there's no path from the
agent to that process (its code is `:ro` and no variables leave `data/`), so
it's defense in depth, not an open hole. It closes by moving the two files
the adapter writes into a folder of its own — `state/`, mounted rw only for
it — and making `policy/` `:ro` for the adapter too. Touches:
`PORTAL_POLICY_DIR` in the adapter, the path `mcp-guard/guard.py` reads,
both composes, `install.sh`, and a migration.


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
- **`block_loop_detected` doesn't say what to do.** `labels.ts` translates
  it, but unlike `triage` it doesn't carry the "now what" line: it's exactly
  the event that shows up when the request has died, and that's when the
  client needs to know they have to ask again.

### G-4 (the "doesn't exist" notice in Connections) — DOES NOT REPRODUCE, measured

It was noted that `?connection=<something>` showed "No tengo ninguna
conexión que se llame «correo»" on the first frame against a slow agent.
**It doesn't happen.** Measured in the browser on 8/12 by manually delaying
the `/portal/connections` response 5 seconds: at a second and a half the
screen shows the spinner, the notice doesn't appear, and once the response
arrives the correct message shows up ("Venís a conectar…"). The guard
exists and is the early `return` `if (connections === null) return
<Spinner/>`, which does the same thing as the explicit `X !== null` guard in
Files, Tasks, and Entregas. Nothing to fix here; it's written up so nobody
goes hunting for it again.

## Kit installers — two gaps the audit left open (8/12)

(This section was already written once and got lost in a concurrent write to
the file; here it is again.)

Context: `deploy-remote.sh` no longer has its own file list and runs
`install.sh` against a staging copy, with a manifest (`.kit-installed`, path
+ sha256) that's the only thing that authorizes deleting anything. Two
things were left open on purpose:

- **The "keeping it" notice fires only once.** When the kit stops shipping a
  file and the client had edited it, it doesn't get deleted and a notice
  fires — good. But the new manifest no longer names it, so from the next
  run on that orphan never shows up again: not in `install.sh`, not in
  `--diff`, not in the deploy. A skill we removed from the kit that the
  client had touched can stay indexed forever without a trace (and a skill
  in `data/skills/` shadows the one in `kit-skills/`, a bug that already
  cost us a batch). Need to move orphans to a separate list —
  `.kit-orphans`, or have `agent-check.py` watch them — so the notice keeps
  repeating until someone decides.

- **Nobody compares the two composes.** `tools/compare-installers.sh`
  proves that a local agent and a remote one get the same files, but
  `docker-compose.example.yml` and `docker-compose.remote.yml` are still two
  hand-maintained templates. The audit dropped `HERMES_DASHBOARD=0` from the
  remote one — the 27x/min crash-loop bug — and the check still came back
  green. Still need to compare the keys that must match between the two
  (`HERMES_DASHBOARD`, `HERMES_ACCEPT_HOOKS`, the adapter's `user:`, the
  `policy/`, `kit-skills/`, `kit-adapter/` mounts and the `env_file`, the
  engine tag) and list the ones that differ on purpose.

Detail from the same family: the checks walk the tree with `find -type f`,
which **doesn't see symlinks**, so a symlink the agent leaves at a kit path
doesn't show up in any comparison.

## 8/12 audit — three things it found and got fixed, and one still missing

Writing these up because none of them were documented and all three are the
same family: data the agent writes ends up consumed by something running
with more privilege.

- **P1 — command injection as root on the VPS (CLOSED).**
  `tools/observability.sh` read the `default:` from `data/config.yaml` —
  which the agent writes — and interpolated it **unquoted** into the string
  that goes to `ssh`. With a `default: modelo'; touch
  /tmp/ROOT-ON-THE-VPS; echo 'x`, the injected command ran. Chain: the agent
  writes its config → the operator runs a documented kit tool → arbitrary
  command in the server's root shell. **It's the first path that got out of
  the container and reached the host.** Closed with shape validation
  (`^[A-Za-z0-9][A-Za-z0-9._:/-]{0,80}$`) plus passing the value through
  `printf %q` into a script that comes in over stdin, no `sed`. Swept the
  rest: it's the only interpolation of that kind in the kit (everything else
  read from an agent gets used in a local `echo`).

- **P2 — the deployer reopened `data/config.yaml` on every run (CLOSED).**
  A `sed` commented out the two `:ro` lines "for the first boot", so the
  agent could write its own config until someone ran `close-config.sh` by
  hand. The compose says what that enables ("could turn back into a
  cronjob and register an MCP around the guard; it just had to wait for a
  restart") and it was also what fed P1. The precaution was left over from
  an old engine: with v2026.7.30 it boots fine with the file `:ro` from the
  first boot, verified. `close-config.sh` is only left for old agents.

- **P3 — the secrets migration destroyed client configuration (CLOSED).**
  The first version only moved variables from an allowlist and deleted
  `data/.env`: it dropped `TELEGRAM_ALLOWED_USERS` — which the kit itself
  creates and is the bot's allowlist — and the value ended up nowhere.
  Without that variable the bot either answers nobody or answers anybody.
  It's now a **denylist** (only `PYTHONPATH`, `LD_PRELOAD` and family stay
  out), the file is moved **whole and unrewritten** when nothing dangerous
  is in it — so a multiline value, like a PEM key, doesn't get split — and
  when filtering is needed, the original stays at `data/.env.unmigrated`
  instead of getting deleted.

- **MISSING — the remote guard for the adapter migration fails OPEN.** In
  `deploy-remote.sh`, to avoid deleting `data/scripts/portal_adapter.py`
  while the container is still running it, it asks over ssh:
  `docker inspect … | grep /opt/data/scripts`. Any error — docker not
  responding, a container with a different name, ssh dropping — reads as
  "already migrated" and the old path gets removed anyway: a later
  `docker restart` leaves the portal in a crash loop. And nobody exercises
  it: the comparator doesn't speak ssh, and the judge
  (`tools/test-remote-deploy-ssh.sh`) has a fake `docker` that does
  `exit 0`. Still need to distinguish "the container doesn't use the old
  path" from "couldn't tell" — when in doubt, keep it — and cover it in the
  judge with a fake `docker` that returns the old entrypoint.

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
- **In Tasks the same line shows two different times** ("Los lunes a las
  09:00" and "Próxima lun 17 ago a las 06:00"): the cron comes in the
  agent's timezone and the time gets formatted with the browser's. Until
  both come from the same zone, the line contradicts itself.

## Flows that tell the truth — closed on 8/13, and what's left for the kit

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

What **the kit needs** (none of this can be done from the portal):

1. **PATCH in the gateway's CORS — it's what blocks changing the day and
   time.** Both clients asked for it separately, and it's the only one of
   the four actions that couldn't get implemented. The verb exists and
   works (`PATCH /api/jobs/{id}` with `{"schedule": {...}}`), but the
   preflight answers `Access-Control-Allow-Methods: GET, POST, DELETE,
   OPTIONS` — no PATCH — so the browser cuts it off before it goes out.
   Verified on 8/13 against the lab:

   ```
   curl -i -X OPTIONS http://127.0.0.1:8942/api/jobs/<id> \
     -H "Origin: http://localhost:8090" \
     -H "Access-Control-Request-Method: PATCH"
   → Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS
   ```

   Adding `PATCH` to that list is enough for the portal to stop sending the
   client to chat to ask for a schedule change. **In the meantime**, the
   "Cambiar día u hora" button leads to chat with the request already
   written out: it doesn't lie, but it's five minutes of waiting to move
   one hour.

2. **`trigger_job` in `/portal/flows`.** The adapter ALREADY reads it from
   the frontmatter (it uses it to compute `last_run`) but doesn't publish
   it. Without it, the portal ties each flow to its task **by the name
   `flujo-<slug>`**, which is what the kit gives the cron when it creates
   it. It works, and with duplicates it picks the live, most recent one —
   but that's a naming convention doing the job of a foreign key: the day
   someone renames a cron by hand, that flow silently loses its next run,
   its failure reason, and its buttons. Publishing the id closes this.

3. **Delete a flow.** The vet clinic also asked to be able to remove one.
   `DELETE /api/jobs/{id}` does pass CORS, but deleting the cron leaves the
   `FLOW.md` orphaned and the flow keeps showing up in the portal with no
   task: a half-deletion is worse than none. The adapter needs to expose a
   removal that takes out both halves (and is reversible, or at least warns
   that it isn't).

4. **The agent's declared timezone.** The portal no longer formats with the
   browser's clock: it uses the offset carried by the engine's own dates
   (`2026-08-17T08:30:00-03:00`). But the `mtime`s from `/portal/files` and
   the `started_at`s from `/api/sessions` are bare epoch, with no timezone,
   so Activity borrows the offset it found on another date from the same
   batch. It works, and it breaks exactly in the case that matters most:
   **an agent with no scheduled task yet** has nowhere to pull it from and
   falls back to the viewer's own clock. A `timezone` (or the offset) in
   `/portal/manifest` settles it once and for all and serves the whole
   portal.

5. **`/portal/activity` sees almost nothing the agent does.** The
   accountant read *"Todavía no hay actividad"* right after setting up
   three flows and having the agent write her three documents, and her
   conclusion was worse than the bug: *"si la bitácora me miente cuando
   estoy mirando, no la voy a creer cuando no estoy"*. The cause: the
   endpoint has **two sources, and only two** — `executions` (cron runs)
   and `task_events` (pipeline). She had neither: her crons hadn't run yet
   and her pipeline was empty. Everything her agent did, it did by
   conversing, and **writing files or setting up flows leaves no row in
   either of those two tables**. Measured on 8/13 against the lab:
   `/portal/activity` returned **1** event while `/portal/files` had **4**
   files and the session **128** messages. The portal papered over it from
   outside by mixing `/portal/files` and `/api/sessions` into the same
   timeline, but **that's three calls to assemble a log the adapter could
   hand over ready-made** — and inside it knows things the portal doesn't
   (which file a run wrote versus which one the client uploaded, without
   guessing from the folder). If `/portal/activity` folded in the workspace
   files and the human sessions, the portal could drop that patch job.

6. **No failing run raises an alarm outside the portal.** The cron's prompt
   already tells the agent that if it couldn't do the work it should leave
   a visible ticket — good — but both of the vet clinic's runs failed
   **before the agent even started** (`RuntimeError: No LLM provider
   configured`), so there was nobody left to leave a trace: the only
   footprint stayed in `executions`, where nobody looks. A flow that fails
   two Mondays in a row needs to go find the client on their channel, not
   wait for them to come in. That one's on the kit.

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

### What's left for the kit (in addition to the six from the previous block)

7. **A connection request needs to be born blocked in ONE round trip.**
   `adapter/portal_adapter.py:1723` (`create_ticket`) creates the ticket
   `ready` and assigned, so the worker picks it up within seconds. The
   portal today makes two round trips (create + block) and there's a ~2 s
   window against the dispatcher's ~6-22 s. A `{"waiting": true}` closes it.
8. **A dependency block on a ticket with NO PARENTS is an instant
   re-promote** (`hermes_cli/kanban_db.py:5530` + `recompute_ready` at
   `:3988`). It's the loop factory that burned US$0.09 in 13 minutes, and it
   happens to **any** ticket, not just ours. It's the engine's: a candidate
   to report upstream to Nous.
9. **`connections/catalog.json:31`** — Telegram's `how` claims *"El bot ya
   está creado"*, which is false when `TELEGRAM_BOT_TOKEN` is missing, and
   the portal shows it verbatim above "Pedir que la conecten".
10. **`notify_channel` in the manifest is what the client ANSWERED, not what
    ACTUALLY WORKS** (`adapter/portal_adapter.py:342`). If we connect the
    channel from our side, nobody updates `contact` and the banner keeps
    showing up. The correct fix is to derive it from the real state of the
    channels.
11. **`NOTIFY_CHANNELS` doesn't accept `whatsapp`**
    (`adapter/portal_adapter.py:165`): in the meantime it lives as a request
    and never as a channel.

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
`hermes-kit/notes/engine-knobs.md` §8.

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
  Pulga are still on SOUL v10 and without the guard.
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

## The proxy was getting in the way, and the deploy doesn't reach it (8/16)

While resetting Mr.Wobble, the first message after onboarding came back
like this:

```
HTTP 400: litellm.UnsupportedParamsError: openrouter does not support
parameters: ['reasoning_effort'], for model=hermes-agent
```

Hermes sends `reasoning_effort` on every request, and litellm, instead of
dropping the parameter the provider doesn't understand, returns 400.
**Fixed** with `drop_params: true` in `compose/litellm.yaml` (kit). It's the
same rule that was already written there for the callbacks: observability
got in the way of inference, so it can never be the one that cuts it off.

**What's still open: that fix doesn't travel with a normal deploy.**
`deploy-remote.sh` doesn't touch `litellm.yaml` — the proxy gets installed
and brought up by `tools/observability.sh`, with its own compose.
Consequences:

- The agent's compose **doesn't know about the service**:
  `docker compose up -d --force-recreate litellm` in `/opt/agentes/<slug>`
  answers `no such service` and **doesn't fail loudly if stderr gets
  silenced** — it looks like it restarted when it restarted nothing. It
  gets restarted with `docker restart <slug>-litellm` or via
  `observability.sh`.
- **The other agents with observability turned on still have the 400.**
  They need `observability.sh` run against them, or the yaml copied over
  and the proxy restarted. Mr.Wobble is already fixed.

It's worth having `deploy-remote.sh` sync `litellm.yaml` whenever the agent
has the proxy running: today a proxy fix depends on someone remembering to
run a separate script.
