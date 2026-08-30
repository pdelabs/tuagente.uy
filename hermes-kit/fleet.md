# Fleet

Which agent runs where, with what version of the SOUL block, and with what
engine.

This exists because the kit is a dependency, not a template: a new rule
doesn't reach anyone on its own. Without this table, "reinstall the SOUL on
everyone" is a list someone has to rebuild from memory, and the one that gets
forgotten is always the one nobody's looking at.

**Updated by hand, at the same moment an agent gets touched.** A row with an
old date isn't a problem; a row that says something no longer true is.

| Agent | Host | SOUL | Engine | Last check |
|---|---|---|---|---|
| tuagente demo (Luis' Mac) | `tuagente-local-agent`, local docker, `:8642`/`:8643` | **v13** — installed by `install.sh`, marker read back off disk | `v2026.7.30` | 30/8, wave 5: named «Tuca», works for «Ferretería Demo». `policy/capabilities/purchased.json` written by hand with `social-package` + `invoices-to-data` — the two rows whose installs are exactly what its former marketing and accounting roles carried — then `install.sh` and a restart of `hermes` + `portal-adapter`. `agent-check` **30 ok · 0 warn · 0 failures**, `portal-check` **14 ok · 2 warn · 0 failures**, `/portal/roles` **404**, `/portal/plugins` **11** (six system + transcribe + the four purchased), `hermes profile list` = `default` only, zero "Skipping secondary profile", US$0.53851965 on the key — unchanged by the visit. **30/8, revalidated independently**: every number in this row reproduced from scratch — same 30 ok · 0 warn · 0 failures, same 14 ok · 2 warn · 0 failures, same 404, same 11 — plus one chat turn that asked the agent its name and got «Tuca», on `openai/gpt-5.6-luna`, 22,486 in / 41 out, **US$0.00567055**. That turn is why the key now reads US$0.5441902 and not the figure above; nothing else on this agent moved |
| East Comunicación | `east` → `/opt/agentes/east` | **v1** — the bare `<!-- kit:base -->` marker, no version (read over ssh, 24/8/2026) | `v2026.7.30` (24/8: read from that host's `docker ps`, not the compose) | 24/8: alive only. Host up 14 days, `east-hermes` / `east-portal-adapter` / `east-caddy` up 13 days. No `agent-check` run — see below |
| tuagente.uy (our own) | `tuagente` → `/opt/agentes/tuagente` | **v13** — installed 24/8 by `deploy-remote.sh`, marker read back off disk | `v2026.7.30` (24/8: `docker inspect tuagente-hermes`) | 24/8, the day it was built: `agent-check` **30 ok · 1 warn · 1 failure**, and the failure is the identity, which is the pristine state (see below); `portal-check` **13 ok · 2 warn · 0 failures** through both HTTPS hostnames. 25/8, redeployed for adapter **0.42.2** (the empty-baptism fix) and `observability.sh tuagente on` re-run because the redeploy rewrites the root `.env`: `agent-check` **30 ok · 1 warn · 1 failure** over the WHOLE tree — still the identity, still the pristine state, now failing with the true reason (no block at all, nobody has onboarded it); `portal-check` **13 ok · 2 warn · 0 failures**, 0 sessions · 0 tickets · 0 hired · US$0.0000. **25/8, no longer pristine**: Luis onboarded through the portal as a client and hired `support` (Beto) from the request — `agent-check` over the whole tree **35 ok · 1 warn · 0 failures** (the identity closed itself: the business step wrote «Tu Agente»), `portal-check` **13 ok · 2 warn · 0 failures**, multiplex `['default', 'support']`, 1 session · 1 ticket · 1 hired · US$0.0165 — the onboarding brief, not the hire. **30/8: the roster is gone and so is Beto** — see «The team pivot, undone» below: `agent-check` **32 ok · 0 warn · 2 failures**, both of them the kit's team/solo skill split and not this agent. **30/8, wave 5, redeployed off the pivot-free kit** (adapter **0.43.0**, `deploy-remote.sh tuagente tuagente agentes.tuagente.uy`, then `multiplex_profiles` out of `data/config.yaml` and a restart): `agent-check` **29 ok · 0 warn · 1 failure**, and the failure is the identity again — «onboarding incomplete: the agent was never named». **That one is correct and expected**: its `portal:identity` block says «Tu Agente» and no name, which the team-era check called legitimate and wave 5 stopped doing. `/portal/manifest` reports `named:false`, so the portal opens at the naming step on Luis' next visit and the failure closes itself the moment he names it. **Nobody should invent a name to make it green.** `portal-check` **12 ok · 2 warn · 0 failures** through both HTTPS hostnames, `/portal/roles` **404**, `/portal/plugins` **7** (six system + transcribe), `hermes profile list` = `default` only, zero "Skipping secondary profile" in the logs, US$0.05497028 on the key — unchanged by the visit. No `policy/capabilities/purchased.json`: this client has bought nothing, which is the legitimate state and what `plugin_set.py` says out loud |

## The team pivot, undone — 30/8/2026, Luis' decision

**Back to ONE baptized agent per client.** The client names it and gives it a
face at onboarding, they talk to it, it owns everything. The plugin framework
stays; what goes is per-role exposure. This section records what changed on
the two live agents, which is the reversible half and went first.

**East was not touched and must not be.** It is the pre-pivot reference shape
— the only agent in the fleet that never saw a roster — and it is what the
portal is being brought back to.

| | `tuagente` (VPS) | `tuagente-local-agent` (demo, Luis' Mac) |
|---|---|---|
| Roles hired before | `support` (Beto) | `accounting` (Tino), `marketing` (Vera) |
| Rooms before | none, ever | 5 transcripts |
| Backup | `/opt/agentes/tuagente-roster-20260830.tgz`, 44 KB | `../tuagente-local-agent-roster-20260830.tgz`, 6.1 MB |
| `agent-check` before | 36 ok · 0 warn · 0 fail | 36 ok · 0 warn · 0 fail |
| `agent-check` after | 32 ok · 0 warn · **2 fail** | 31 ok · 0 warn · **3 fail** |

Three deletions on each, then `docker compose restart hermes
portal-adapter` — a restart is enough, no mount moved:

1. `policy/roles/catalog.json`. **One file turned the whole team UI off**:
   `manifest()` computed `"roles": ROLES_CATALOG.is_file()`, the portal read
   `modules.roles`, and every team surface was gated on it. (Wave 3 deleted the
   route and the gate outright — see the correction below.)
2. `data/profiles/<role>/`. The gateway multiplexes that directory, so the
   role's own door closes on the restart: `/p/support/`, `/p/accounting/`,
   `/p/marketing/` all went 200 → 404, and the default `/health` never moved.
   **The client's baptism is NOT in there** — it is `data/SOUL.md` and
   `data/portal_identity.json`, both untouched.
3. `policy/rooms/`. Only the demo had any.

`policy/roles/identities.json` and `requests.jsonl` were KEPT on the VPS.
They are the append-only record of what the client asked for and what they
named it, `roles()` never reads them without a catalog, and deleting the
roster is not the same as deleting the evidence that a hire happened.

**`/portal/roles` did not 404 THAT DAY — it answered 200 with
`{"available": false, "roles": []}`**, because `roles()` returned that shape
when the catalog was missing and `manifest()` gated the tab on the same file.
**That stopped being true in wave 3**: adapter 0.43.0 has no `roles()`, no
`/portal/roles` and no `roles` key in the manifest, so the route is a plain
404 — measured on both live agents on 30/8. A check written against the 200 is
checking for something that no longer exists.

### What the checks do now, and which ones misfire

Both agents came out with new failures, and **none of them is damage to the
agent**. They are the kit measuring a roster-less agent against the solo
shape for the first time:

- **`kit installed` and `kit skills: external mount` fail on both**, asking
  for `artifact`, `brand-kit`, `drive-inbox`, `invoices-to-data`,
  `post-image`, `quotes`, `social-content`. `expected_skills()` hands a team
  agent the SHARED split only, because the craft skills travel inside each
  hired role's profile; with `has_team()` false it falls through to
  `kit_skills()` and asks for all of them. **This one is real and it is a
  gap, not noise**: a roster-less agent today has fewer skills than a
  pre-pivot solo agent had. It closes with an `install.sh` pass once the kit
  drops the split (waves 3–6), not before.
- **`plugins: the agent's set` fails on the demo only**, naming `brand-kit`,
  `invoices-to-data`, `post-image`, `social-content` — the plugins its two
  hired roles pulled in, now orphaned at `plugins/`.
- **The four `roles: …` checks now pass trivially** ("no roles installed").
  They still RUN because `data/profiles/` survives as an empty directory;
  remove the directory too and they vanish instead. The other two
  (`roster vs profiles`, `the gateway multiplexes`) are already gone —
  they sit behind `has_team()`.
- **`SOUL: identity` LIES rather than fails.** It still reports OK with «with
  no name of its own (a team client never names theirs), works for
  "<empresa>"». That branch does not consult `has_team()` at all, so on both
  agents a solo agent with **no baptism at all** passes on a sentence about a
  shape that no longer exists. This is the one to delete first in wave 5: it
  is hiding the exact thing the product now requires.

### 30/8, wave 5: the checks stopped misfiring

Every bullet above was a measurement of the kit BEFORE waves 3-5 landed. What
those checks say now, measured on both agents after this wave's install:

- **`kit installed` / `kit skills: external mount` pass.** `expected_skills()`
  is one function now — the harness plus the skills of the plugins this client
  bought, through `tools/skill_sources.py` — and there is no split to fail to
  compute. The demo got its five delivered skills back; the VPS got `artifact`,
  which it had been missing.
- **`plugins: the agent's set` passes on both.** The demo's four orphans stopped
  being orphans the moment `policy/capabilities/purchased.json` said which two
  capabilities pay for them.
- **The six `roles: …` checks are gone**, and so is `data/profiles/` on both
  agents. Nothing runs trivially any more; it does not run.
- **`SOUL: identity` no longer lies.** A block with a company and no name is a
  FAIL — «onboarding incomplete: the agent was never named» — which is the VPS
  agent's true state and the reason its row above is 1 failure and stays that
  way until Luis names it.

`gateway.multiplex_profiles` is off on both, out of `compose/config.base.yaml`
and out of each agent's own `data/config.yaml`. `hermes profile list` shows only
`default` and neither log carries a single "Skipping secondary profile".

### What the portal did the moment the roster left

Observed at HEAD — pivot code untouched, built and served on :8090 against
the demo agent — before a single line was deleted:

- **Onboarding opens at the naming step.** «Tu empresa tiene un empleado
  nuevo» → «Empecemos por lo más importante: ponerle nombre» → the animated
  face with its dice → «¡Hola! Soy ____». The solo baptism was never removed
  from the code, only gated: `layout.tsx` suppressed it with
  `&& !manifest.modules.roles` and `manifest.modules.roles` is now false.
- **No «Equipo» tab.** The nav is Inicio · Chat · Flujos · Actividad ·
  Tablero · Entregas · Conexiones · Más. It is filtered by
  `manifest.modules[key]` like every other module.
- **Home already greets solo**: «Buen día» / «Agente Local, tu agente ·
  última actividad hace 6 días».
- **The chat sidebar lists engine sessions only** — the five rooms are gone
  and nothing replaced them with an error.
- Two things the portal still gets wrong on its own, which is wave 1's job:
  the composer says «Escribile a tu agente…» instead of «Escribile a
  <nombre>…», and the chat's empty state is the team one.

The portal, in other words, degrades to the solo shape by itself. Deleting
the pivot from it is removing dead branches, not restoring a lost path.

**Mr.Wobble is decommissioned — 24/8/2026, Luis' decision.** It left the table
because the table says what runs where, and nothing runs there any more.

It was never a client's, and that was checked before anything was stopped:
`portal_identidad.json` said `Mr.Wobbly`, empresa "Tu agente",
`https://tuagente.uy`; its only channel was a Telegram DM with Luis
(`channel_directory.json`, one entry); and every deliverable under
`workspace/` was tuagente.uy's own marketing — the daily Instagram pieces and
the blog articles about agents.

**What died with it: the `contenido-instagram-diario` cron** (`0 9 * * *`, day
10 of its run, last fire 24/8 09:21 `ok`). Nobody else produces tuagente.uy's
daily Instagram content today, and the successor does not either: it was born
solo, with the roster on offer and nobody hired. Its two domains
(`tuagente.agentes.tuagente.uy`, `tuagente-portal.agentes.tuagente.uy`)
answered nothing for eight hours and now answer the SUCCESSOR — same
hostnames, same certificates, a different agent. See "tuagente.uy's own agent,
rebuilt from zero" below.

The six containers — `tuagente-hermes`, `-portal-adapter`, `-caddy`,
`-litellm`, `-otel`, `-phoenix` — were removed with one `docker compose down`
over both compose files, **without `-v`**: instances die, data survives. That
VPS ran nothing else (one compose project, `/opt` had no other service), so
nothing else was affected.

> **Pending: the plugin registry (phase 3b, 23/8/2026).** `install.sh` now
> installs `<agent>/plugins/<id>/` and the compose mounts it `:ro` at
> `/opt/plugins`. East does not have it — it still answers `[]` at
> `/portal/plugins`, which is the pre-3b behaviour and not an outage.
> `agent-check.py` reports it as a warning ("PRE-PLUGIN LAYOUT, UPDATE
> PENDING") until the installer runs, and as a FAILURE if the folder is
> installed and the compose does not mount it — installed and unreadable is
> worse than absent. So the two steps go together, in one visit: run the
> installer (or `deploy-remote.sh`) and add
> `- ./plugins:/opt/plugins:ro` to the portal-adapter service, then
> `docker compose up -d portal-adapter` (a `restart` is not enough: it is a new
> mount). Not run against either agent yet — this line says what is pending,
> not what was done. **24/8: with Mr.Wobble gone this concerns East alone**,
> and East is further behind than 3b.

> **Pending after this translation pass.** This rename introduced new inline
> chip syntax in the SOUL (`capability:<id>` etc., soul/VERSION → v13) and new
> on-disk paths (`policy/`, `secrets.env`, …). Neither live agent has received
> either change yet: **24/8, this is East alone** — Mr.Wobble is
> decommissioned and its disk stays in the old layout on purpose. East
> still needs the on-disk
> English-layout migration (`tools/migrate-agent-to-english.sh` — written and
> unit-tested offline, **never run against a live host**) and a SOUL v13
> reinstall. The runbook is below, under "Migrating a live agent to the
> English layout". This is a statement of what's pending, not a report of
> results — update this table (and the row above) only once each migration
> has actually run and been checked.

## tuagente.uy's own agent, rebuilt from zero (24/8/2026)

**Mr.Wobble's successor, and NOT its continuation**: same VPS, same two
hostnames, same Telegram-less start, nothing of Wobble's on disk. No SOUL, no
workspace, no state, no bot token was carried across — the retired tree sits
next to it, read by nobody. Built the canonical way, `deploy-remote.sh tuagente
tuagente agentes.tuagente.uy`, off the kit at 29b961d.

It runs at `/opt/agentes/tuagente`, six containers: `tuagente-hermes`,
`-portal-adapter`, `-caddy`, `-litellm`, `-otel`, `-phoenix`. Only Caddy
publishes anything (80, 443). Its local mirror is
`~/Desktop/Luis/Projects/tuagente-agent`, its own git repo — the WHOLE tree
and not just `data/`, for the reason in the 14/8 note below.

**It is deliberately PRISTINE, which is the point of this build**: it exists
so we can watch what a brand-new client actually sees on day one. Nothing was
configured that a client would not find themselves. No role hired (the roster
was on offer, `GET /portal/roles` answered 5 available and 0 hired — both the
roster and the route are gone since wave 3; the route 404s), no Telegram
token, no business name, no identity, zero sessions, zero tickets, zero
deliverables, and **US$0.00 charged to its OpenRouter key** — a fresh one
named `tuagente`, limit 10, minted for it. Observability is on, because that
one is ours and invisible to the client: the chat and the image route both go
through litellm (`base_url` and `OPENROUTER_BASE_URL`, the two halves), so
`costs.jsonl` will hold the client's very first turn.

**And it stopped being pristine on 25/8, which is what it was built for**:
Luis walked in as a client — hired `support` (Beto) off the roster and
answered the business step. The day-one path is now measured instead of
assumed: `hire-role.sh --from-request` + `deploy-remote.sh` +
`observability.sh on` cost **US$0.00** and took 5 minutes from the request
line to `hired`; the first charge on the key, US$0.0165, is the
`Conocer <empresa>` ticket the business step spawns a minute later. Five more
runbook gaps came out of it — `docs/PENDING.md`, items 10 to 14.

**Its `agent-check` failure was the product's, not this build's — and 25/8
closed it.** The one failure was `SOUL: identity`, and on a TEAM agent nothing
ever closed it: the portal skips the naming step when a roster is present
(`onboarding.tsx`: `team ? "business" : …`), so `POST /portal/identity` never
carries a `name`, and no runbook step writes `00-identity.md` for a team
client. Worse, the step the client DOES answer made it wrong rather than
absent — see `docs/PENDING.md`, "What the fresh deploy of 24/8 exposed". Left
as-is on purpose: writing an identity here would have hidden exactly the thing
this agent was built to show — and it paid off. Adapter 0.42.2 stopped
`_soul_block` from emitting a paragraph whose datum is missing and made the
check read INSIDE the block;
Luis' business step then wrote «Trabajás para **Tu Agente**» with no baptism
paragraph at all, and the check went green on the identity a team's shared
agent legitimately has.

*(Everything about Mr.Wobble from here down is the record of an agent that
no longer runs — kept because it is where most of the kit's evidence was
measured, not because it describes the fleet today.)*

**Mr.Wobble was wiped to zero and brought up to date on 13/8/2026** — a FULL
reset by Luis' decision, so the SOUL went with it, and with it the naming.
It's on v12 (was v11 until 16/8), the promises guard (tested against the
live agent, not just installed), the gate in code, the adapter outside
`data/`, the secrets in `secrets.env`, and the `config.yaml` with the four
knobs. **That one's closed now**: on 16/8 the SOUL has the `portal:identity`
block, written by the portal's naming step, and `agent-check` reports it OK.
It was the only failure still open from that reset.

**East is on v1, and that was measured on 24/8** — the bare
`<!-- kit:base -->` marker, from before versioning. This paragraph used to
say "two versions behind" and that it was unknown; it is neither. East is
behind EVERY block: the 13/8 phrases you can't write without having done it
(*"queda definido"*, *"queda armado"*, *"todos los viernes a las 9:30 te dejo
X"*), the v10 rejection rules, the v12 "don't say you can't without having
tried". The rejection one bites in production: **rejecting from the portal
leaves its ticket blocked and the agent has no idea what to do with that.**
Migrating it is one run of `tools/replace-block.py`, checking the diff of
whatever was hand-written first — and East's SOUL is heavily hand-written
(it names Cata, her programs, her flows), so that check is the whole job.
**East is now the only agent in the fleet**, and the only live client one.
No local client agents run today: anything created with `new-agent.sh` is
born on the current version.

**And East is missing the promises guard** (`policy/plugins/promises/` on the
agent — in the kit it now lives at `plugins/flow/engine/promises/`, the `flow`
plugin's engine surface, and the destination did not change), which is the only
thing stopping an agent from saying *"queda definido: viernes a las 9:30"*
without having created anything. It's three things and they go together:
`install.sh` drops the plugin, the compose mounts it
(`./policy/plugins:/opt/data/plugins:ro`), and the config turns it on
(`plugins.enabled: [promises]`); then, `docker compose up -d hermes` — a
`restart` isn't enough, it's a new mount. `agent-check.py` fails if any of
the three is missing.

On Mr.Wobble all three are there, and the third one **isn't set by the
deploy**: `deploy-remote.sh` doesn't overwrite a `config.yaml` that already
exists, so `plugins.enabled` — and with it `hooks`, `hooks_auto_accept` and
`kanban.auto_decompose` — had to be hand-written into that agent's config.
It's the step people forget when updating an old client, because the deploy
finishes without saying anything.

**East has a second copy, on Luis' laptop**, found during the 24/8 sweep:
`~/Desktop/Luis/Projects/agente-east/` — a full agent tree (its own git
repo, `data/` with Eco's SOUL, `kanban.db`, `state.db` at 66 MB, real
interview material under `workspace/interno/`, and
`google_client_secret.json`). Its containers are gone; the directory is
not. It was NOT deleted in that sweep and must not be treated as scratch:
it is a client's data at rest outside the VPS. Whoever disposes of it
decides that with Cata's agent in mind, not as housekeeping.

**Retirements.** A retired agent leaves the table — the table says what runs
where — but not the record:

| Agent | Retired | What remains |
|---|---|---|
| La Mano (pdelabs, client 0) | 2026-08-12, Luis' decision | backup at `~/Desktop/Luis/Projects/_respaldo-lamano/lamano-final-20260812.tgz`; containers deleted and repo removed |
| Mr.Wobble (tuagente.uy's own agent) | 2026-08-24, Luis' decision | the tree on its VPS, moved aside and otherwise byte for byte: `/opt/agentes/retired-tuagente-20260824/` (178 MB — it WAS `/opt/agentes/tuagente/`, renamed the same day to free the slug for its successor) and `/opt/agentes/wobble-pre-reset-20260813.tgz` (39 MB). Containers removed with `compose down` **without `-v`**; the four volumes were kept, but three of them now belong to the successor — see the runbook below. Runbook below |

### Mr.Wobble: what remains, and how to bring it back

On the VPS `157.180.73.42`, ssh alias `tuagente`. **The box is no longer
empty**: since 24/8 its successor runs at `/opt/agentes/tuagente`, which is
why the retired tree was renamed out of that path.

- `/opt/agentes/retired-tuagente-20260824/` — 178 MB, byte for byte as it
  was, only moved (`mv`, 24/8). `data/` is
  the entire agent: SOUL v12 with its `portal:identity` block,
  `config.yaml` with the four hand-written knobs, `kanban.db`, `state.db`,
  `cron/jobs.json`, `flujos/contenido-instagram-diario/`, `costos.jsonl`,
  and `workspace/` with `brand/` (the tuagente.uy kit) and `entregables/`
  (ten days of Instagram pieces). Alongside it: `politica/`, `kit-skills/`,
  `kit-adapter/`, `secretos.env` (its Telegram bot token included), `.env`
  and both compose files.
- `/opt/agentes/wobble-pre-reset-20260813.tgz` — 39 MB, the pre-reset
  backup from the 13/8 wipe.
- Docker volumes: all four were kept, and **three of them are no longer
  only its own.** A compose project is named after its directory, the
  successor's directory is also `tuagente`, so `docker compose up -d` on
  24/8 attached `tuagente_caddy_data`, `tuagente_caddy_config` and
  `tuagente_phoenix_data` to the NEW containers. Only `tuagente_data` —
  orphaned from an older compose, referenced by neither — is untouched.
  That was not an accident and one half of it is a saving:
  `tuagente_caddy_data` still holds the Let's Encrypt certificates for
  those two hostnames (issued 10/8, good to 8/11), so the new agent came up
  on HTTPS without spending a single issuance against the weekly cap. The
  other half is a decision to make: `tuagente_phoenix_data` holds
  **Mr.Wobble's prompts**, and Phoenix now shows them next to the
  successor's. Nothing reads them today; deleting that volume is a
  one-liner whenever it is decided that the record has been kept long enough.

**It is still the OLD Spanish layout** (`politica/`, `secretos.env`,
`docker-compose.observabilidad.yml`): the English migration never ran
against it, and now never will. That matters if anyone resurrects it —
today's `install.sh` would install a second, English-named copy beside the
old one and the agent would keep reading the old one.

**And it can no longer be brought back where it stood.** Its compose
publishes 80 and 443 and its Caddyfile claims the same two hostnames the
successor now serves, so bringing it up as-is collides with a live agent on
both ports and both domains. Resurrecting it means stopping the successor
first, or giving the old tree different domains and ports. What used to be a
three-line runbook is now a decision:

```bash
ssh tuagente
cd /opt/agentes/tuagente && docker compose down          # the SUCCESSOR, first
cd /opt/agentes/retired-tuagente-20260824
docker compose -f docker-compose.yml -f docker-compose.observabilidad.yml up -d
```

`up -d` and not `start`: the containers were removed, not stopped. **The
compose project name changed with the directory**, so this comes up as
`retired-tuagente-20260824-*` with FRESH, empty volumes — its old
`tuagente_caddy_*` now belong to the successor. Nothing on disk changed, so
the agent itself comes back exactly as it was — SOUL v12, pre-pivot,
pre-English-layout — **with the daily cron still armed and its `next_run_at`
in the past, so it fires on the first tick.** Pause the job first if that is
not what you want.

If what you want is the agent and not the archaeology, it is cheaper to
build a new one with `new-agent.sh` and copy `workspace/` across.

La Mano was client 0 and the test fixture for the whole kit: almost all the
evidence in `notes/engine-knobs.md` and `notes/knobs-applied.md` was measured
on it, and those notes stay as they are — they're the record of what was
measured, not the fleet's current status. What no longer exists is a local
agent to run `agent-check.py` against: the fixture now comes from unpacking
that backup, or from a new agent made with `new-agent.sh`.

## Migrating a live agent to the English layout

Every agent created before 23/8/2026 has its on-disk layout in the old
Spanish names (`politica/`, `secretos.env`, `data/flujos/<slug>/FLUJO.md`,
`portal_identidad.json`, …). The kit no longer knows those names: `install.sh`
would install a second, English-named copy alongside them and the agent would
keep reading the old one. `tools/migrate-agent-to-english.sh` renames the
layout in place, in the order below.

```
./tools/migrate-agent-to-english.sh <host> --dry-run      # plan only
./tools/migrate-agent-to-english.sh <host>                # rsync-stage, migrate, upload, clean old paths
ssh <host> 'cd /opt/agentes/<slug> && docker compose up -d'   # not restart: mounts changed
./tools/install-soul.sh --replace <host> [slug]           # SOUL v13
python3 tools/agent-check.py <local-copy>/data
python3 tools/portal-check.py --key <API_SERVER_KEY> --endpoint … --adapter …
```

`docker compose up -d` and not `restart`: the compose's mount SOURCES changed
(`./politica` → `./policy`, `secretos.env` → `secrets.env`), and a restart
reuses the container with the old bind mounts.

**This has not been run against a live host yet.** It passes its offline
fixture test (`tools/test_migrate_agent_to_english.py`) and nothing more. The
first real run is Mr.Wobble's or East's, and it is the moment to check the
`--dry-run` plan line by line before letting it write.

## What each column means

- **Host** — the ssh alias. By convention it's named the same as the agent,
  and the tools assume that: the directory on the VPS is `/opt/agentes/<slug>`
  and the containers are `<slug>-hermes`. When they don't match — logging in
  as `user@ip`, for instance — the slug goes as a separate argument:
  `tools/<script>.sh <host> <slug>` (in `observability.sh`, which already
  uses the second argument for the action, it goes third).
- **SOUL** — the version of the generic block, the one stamped by the
  `<!-- kit:base vN -->` marker. `v1` is the bare marker, from before
  versioning; "no marker" means a SOUL pasted by hand or from before markers
  existed. The version this repo installs is in `soul/VERSION`.
- **Engine** — the `nousresearch/hermes-agent` tag that agent's compose
  pins. Never `latest`: see the note in `CLAUDE.md`.
- **Last check** — when `tools/agent-check.py` last ran against its `data/`,
  and with what result.

To fill in a row:

```bash
grep -o '<!-- kit:base[^>]*-->' <path>/data/SOUL.md    # or over ssh
grep image: <path>/docker-compose.yml
python3 tools/agent-check.py <path>/data
```

## Status as of 2026-08-13

**Mr.Wobble** — reset to zero and updated to that day's kit. What was done,
in order, all with kit tools: `tools/reset-agent.sh` in FULL mode (both the
client's footprint **and** the SOUL go), `deploy-remote.sh` — which uploads
the kit, changes the compose, moves the keys to `secrets.env`, and installs
the SOUL —, the four knobs that were missing by hand in `config.yaml`, and
`docker compose up -d hermes portal-adapter`, which is what picks up the new
`policy/plugins` mount. Comes out with 0 failures from `portal-check.py`, at
zero verified with `--delivery`, and 1 failure from `agent-check.py`: the
identity.

**16/8/2026 — SOUL v12: "don't say you can't without having tried."**

The agent reported, two days in a row, that it couldn't generate images. The
capability was in place and verified: `image_generate` in its list of 27
tools, the `imagenes` capability chip active, `auxiliary-models` connected.
It never tried.

IT WASN'T MEMORY — MEMORY.md was empty, zero lines. The belief traveled
through its own deliverables: on 15/8 it concluded "the connection is
missing," wrote that in the deliverable and in the title of a ticket it
closed as `done`, and on 16/8 the cron fired the same flow, read the flow's
folder, and quoted itself.

It's worse than a bad memory for three reasons: it's invisible (nobody
thinks of deliverables as state), it reinforces itself (every day adds
another copy), and clearing memory doesn't fix it.

The new rule mirrors the one that already existed ("phrases you can't write
without having done it"): saying you CAN'T is a claim about the world just
like saying you already did something, and the client acts on it — stops
asking for it, or pays for something they already had. And its complement:
what you can do is READ, not remembered; what you wrote yesterday is
history, not state.

HEADS UP: it's a rule, not a guarantee. The promises guard exists because
rules alone weren't enough for the symmetric case. If this repeats after
v12, what comes next is a hook, not another rule.

Applied with `tools/replace-block.py`, which confirmed there was nothing
hand-written inside the block and that `portal:identity` stayed intact.
WITHOUT restarting containers: the SOUL is read when each session is
assembled, so new sessions pick it up right away.

**14/8/2026 — the three business skills, running against the live agent.**
`brand-kit`, `social-content` and `post-image` deployed, plus the render
engine in `kit-render/`. Tested inside the container, not on a Mac: scanning
a real site returns the right roles, the footer validator catches the
problems, and the render produces a 1080×1350 PNG with the kit's typography
and colors. `portal-check`: 14 ok · 1 warning · 0 failures.

Two things from this deploy:

- **`kit-render/` is a NEW mount**, so it needed `up -d` and not a
  `restart` — the containers got recreated, which is how you know it took.
- **The render engine is NOT installed by `install.sh`**, on purpose: it's
  native binaries, and `install.sh` runs on staging that can be a Mac. It's
  installed by `install-render.sh` (ad-hoc script run on the host, never part
  of the kit) on the target, inside `node:22-slim`. Verified that what landed
  was `core-linux-x64-gnu`, not the darwin one.
- **`deploy-remote.sh` dropped `AGENT_MODEL` again**, for the third time.
  Restored by hand. It's not a surprise anymore: it's a step in the
  procedure.

**Mr.Wobble is NO LONGER AT ZERO.** The tests left it with `brand/` (the
tuagente.uy kit), `piezas/`, and some conversations. It's a demo
environment, not an agent ready to deliver: before handing it to anyone, run
`reset-agent.sh --delivery`.

**Second pass the same day, now with the split adapter.** Same procedure
(FULL reset → `deploy-remote.sh` → restore `AGENT_MODEL` → `up -d` →
`restart`), and it came out `portal-check` 13 ok · 0 failures and
`--delivery` 14 ok · 0 failures. Three things showed up that matter for next
time:

- **`install.sh` was uploading the adapter as ONE file.** The split left it
  importing `flows`/`kanban`/`workspace`, and the installer's list still had
  a single line: the deploy would have left an adapter that doesn't start,
  with the kit saying "installed." Fixed — the list is now built from the
  directory, like the hooks. It's the same failure mode the README already
  describes, and that makes five.
- **`docker compose up -d` does NOT reload the adapter.** The files in
  `kit-adapter/` change inside a bind mount, so compose sees nothing to
  recreate and leaves the old process running with the old code in memory.
  It says `Running` and looks updated. An explicit `restart` of
  `portal-adapter` is needed after uploading the kit.
- **`agent-check.py` lies, badly, over an rsynced `data/`**: it looks at
  `policy/`, `kit-skills/` and `secrets.env`, which live next to `data/`, not
  inside it. Syncing only `data/` — which is what step 3 of the deploy says —
  reports 8 made-up failures (the gate open, no guard, no credentials). Run
  it on the host, or sync the whole tree. And it needs
  `tools/capability-catalog.py` alongside it or it invents a ninth.

Two things from this agent that matter for any other one running on a host
shared with more of our services:

- **`deploy-remote.sh` rewrites the whole compose's `.env`**, with the five
  variables it knows about. Mr.Wobble had a sixth, `AGENT_MODEL`, read by the
  collector in `docker-compose.observability.yml`: it got lost across both
  runs and had to be restored. It's silent — the collector falls back to
  `unknown` and the traces still come out, just without a model — so
  **before deploying you have to check what else that `.env` has.**
- **`migrate-secrets.sh` moves `data/.env` to `secrets.env`, and the
  observability compose still named the old one.** The neighboring services
  keep running because nobody recreated them, but the next `up -d` with both
  `-f` flags failed with "env file not found." Fixed by also uploading
  `compose/docker-compose.observability.yml`, which in the kit already says
  `./secrets.env`. The two changes go together or the neighboring stack is
  left with a time bomb.

**East Comunicación** — first onboarding done with `deploy-remote.sh` (see
`notes/auxiliary-models.md`). You can't tell from the repo how it ended up:
if it was deployed before 11/8, it came out without a SOUL, because the
remote deploy didn't install one back then.

## Engine knobs: Mr.Wobble yes, East no

Batch C1 left the kit with the engine's own skills turned off, the portal's
preamble replaced, and the kit's skills mounted `:ro`. **That only reaches
new agents on its own.** Mr.Wobble has had it since 13/8 (the skills part
already landed on 12/8; on the 13th it gained the gate, the promises guard,
and `kanban.auto_decompose`, which the deploy doesn't set because it doesn't
overwrite an existing `config.yaml`). East predates this and still has all
70 of the engine's skills turned on; `agent-check.py` reports it as a
failure until it's applied. The runbook (it's a redeploy, and `config.yaml`
is `:ro`) is in `notes/knobs-applied.md`.

## Before updating someone's block

Each company's own sensitive actions live INSIDE the block, in the
approvals section. Replacing the block with a new version takes them along
with it, and the agent ends up with the generic hard rule and none of its
own: that's the worst possible outcome, because it looks like everything's
fine.

So the order is: pull whatever was added per-client out of the old SOUL,
install the new block, put it back, and only then `agent-check.py`. Nothing
checks this yet — it's manual and you have to remember.

## What's left to confirm (needs ssh, doesn't come from the repo)

- ~~Mr.Wobble~~ — moot: decommissioned 24/8, see the top of this file.
- **East is up, on `v2026.7.30` — confirmed 24/8**, read from that host's
  `docker ps` and not the compose. Host up 14 days; `east-hermes`,
  `east-portal-adapter` and `east-caddy` up 13 days.
- **East's SOUL is the bare `<!-- kit:base -->` marker — confirmed 24/8**,
  i.e. v1, from before versioning. It is not "two versions behind" as the
  note above guesses: it is behind *all* of them, and every rule added
  since v1 (rejection, promises, "don't say you can't without having
  tried") is missing.
- **No other agent left no trace — confirmed 24/8.** Every
  `docker-compose*.yml` under `~/Desktop/Luis/Projects/` that pins
  `nousresearch/hermes-agent` belongs to: this kit's templates, the old
  archived `hermes-kit` repo's templates, `agente-east`, or
  `tuagente-local-agent`. Nothing else.
- Still open: `agent-check.py` has never run against East. Its row says it
  is alive, not that it is healthy.
