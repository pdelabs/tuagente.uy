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
| Mr.Wobble | `tuagente` → `/opt/agentes/tuagente` | **v12** (16/8/2026; already named by the portal, the `portal:identity` block exists) | `v2026.7.30` (verified with `docker ps`, not just the compose) | **16/8: SOUL v12 applied, `agent-check` OK on all six SOUL lines.** 14/8: business skills + `portal-check` 15 ok · 0 failures |
| East Comunicación | `east` → `/opt/agentes/east` | TODO | TODO | TODO |

> **Pending after this translation pass.** This rename introduced new inline
> chip syntax in the SOUL (`capability:<id>` etc., soul/VERSION → v13) and new
> on-disk paths (`policy/`, `secrets.env`, …). Neither live agent has received
> either change yet: both Mr.Wobble and East still need the on-disk
> English-layout migration (`tools/migrate-agent-to-english.sh` — written and
> unit-tested offline, **never run against a live host**) and a SOUL v13
> reinstall. The runbook is below, under "Migrating a live agent to the
> English layout". This is a statement of what's pending, not a report of
> results — update this table (and the row above) only once each migration
> has actually run and been checked.

**Mr.Wobble was wiped to zero and brought up to date on 13/8/2026** — a FULL
reset by Luis' decision, so the SOUL went with it, and with it the naming.
It's on v12 (was v11 until 16/8), the promises guard (tested against the
live agent, not just installed), the gate in code, the adapter outside
`data/`, the secrets in `secrets.env`, and the `config.yaml` with the four
knobs. **That one's closed now**: on 16/8 the SOUL has the `portal:identity`
block, written by the portal's naming step, and `agent-check` reports it OK.
It was the only failure still open from that reset.

**East is falling behind, now two versions** (the 13/8/2026 block: the
phrases you can't write without having done it — *"queda definido"*, *"queda
armado"*, *"todos los viernes a las 9:30 te dejo X"*; and, since v10,
rejection that doesn't unblock, plus vocabulary). We don't even know East's
version, which is worse than knowing it's old: it still doesn't understand
what a rejection is, so **rejecting from the portal leaves its ticket blocked
and the agent has no idea what to do with that**. Migrating it is one run of
`tools/replace-block.py` with `soul/versions/v11.md`, checking the diff of
whatever was hand-written first. No local client agents today: anything
created with `new-agent.sh` is born on v12.

**And East is missing the promises guard** (`policy/plugins/promises/`, from
13/8/2026), which is the only thing stopping an agent from saying *"queda
definido: viernes a las 9:30"* without having created anything. It's three
things and they go together: `install.sh` drops the plugin, the compose
mounts it (`./policy/plugins:/opt/data/plugins:ro`), and the config turns it
on (`plugins.enabled: [promises]`); then, `docker compose up -d hermes` — a
`restart` isn't enough, it's a new mount. `agent-check.py` fails if any of
the three is missing.

On Mr.Wobble all three are there, and the third one **isn't set by the
deploy**: `deploy-remote.sh` doesn't overwrite a `config.yaml` that already
exists, so `plugins.enabled` — and with it `hooks`, `hooks_auto_accept` and
`kanban.auto_decompose` — had to be hand-written into that agent's config.
It's the step people forget when updating an old client, because the deploy
finishes without saying anything.

**Retirements.** A retired agent leaves the table — the table says what runs
where — but not the record:

| Agent | Retired | What remains |
|---|---|---|
| La Mano (pdelabs, client 0) | 2026-08-12, Luis' decision | backup at `~/Desktop/Luis/Projects/_respaldo-lamano/lamano-final-20260812.tgz`; containers deleted and repo removed |

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

- **Mr.Wobble: confirmed on 13/8.** It's up and genuinely running
  `v2026.7.30`, read from the host's `docker ps`, not the compose.
- Whether East is still up, and what engine tag it's actually on (its row
  says what the kit's compose pins, not what that VPS's docker is actually
  running).
- Whether East ever got a SOUL, and with what marker.
- Whether there's any other agent that left no trace in this repo.
