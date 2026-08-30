# East: cutover to the English layout, SOUL v13 and the plugin set

> **SUPERSEDED — 30/8/2026, Luis' decision: East is a TEST client and restarts
> from zero on the single-agent + plugins model. This cutover will never be
> run, and every East instance has been deleted** (see `hermes-kit/fleet.md`,
> "East: what remains, and what does not"). **The file stays because the
> migration-script fixes it documents are real**: `tools/migrate-agent-to-english.sh`
> had three bugs that only a run against a real agent could find, they are
> fixed here, and the next old agent that turns up will hit them. What East
> actually needed is in `docs/east-requirements.md`.

Rehearsed end to end on **30/8/2026** against a copy of the live agent, plus a
second pass over the real client data on Luis' laptop. **Result: PASS** —
`agent-check` 30 ok / 0 failures, `portal-check` 11 ok / 3 warnings / 0
failures. It found three bugs in `tools/migrate-agent-to-english.sh`, all
fixed and re-validated before this file was written; a live cutover done
before those fixes would have left the agent unable to write its own `data/`.

**The live cutover still needs Luis' explicit go.** Nothing here has been run
against `/opt/agentes/east`.

## The finding that changes what this job is

The brief for this migration described an agent with Cata's interview material
in `workspace/`, a 66 MB `state.db`, her own flows and a Google client secret.
**None of that is on the VPS.** There are two East trees and they are not
copies of each other:

| | `east:/opt/agentes/east` (LIVE) | `~/Desktop/Luis/Projects/agente-east/` (laptop) |
|---|---|---|
| Containers | up, 2 weeks | gone |
| `state.db` | 188 KB, **0 sessions, 0 messages** | 66 MB, real history |
| Tickets | 0 | the board Cata worked |
| `workspace/` | **empty** | interviews, deliverables, her scratch |
| Flows | **none** | `entrevistas-tv`, `radio-viva`, `comparar-nyt-elpais` |
| Crons | **none** | 1 job, `*/15`, 191 runs |
| Baptism | **none** | `Selastian` + look |
| `google_client_secret.json` | **absent** | present |
| Her own skills | none | `frases-zocalo`, `redactar-noticia` |

Every non-404 request the live gateway has ever logged is one of Luis' own
`curl /health` probes from 10–11/8. The last container boot was 11/8 16:40.
**Cata has never connected to the agent on the VPS.** What she used was the
laptop tree, and its containers are gone.

So this cutover migrates a **shell**. It is low risk precisely because there is
nothing of hers on it — and that same fact means finishing it does not give
Cata her agent back. That is the separate decision at the bottom of this file.

**Her name is `Selastian`, not `Eco`.** `Eco` is what the SOUL prose proposes
("Te pusimos **Eco**…"); the baptism she actually did from the portal wrote
`{"nombre": "Selastian"}`, and the same SOUL says the portal's name wins. The
migration maps that file correctly (`nombre`→`name`, the eight look axes); it
is only on the laptop tree, so the cutover has to carry it across by hand.

## Before you start

The backup already exists, taken 30/8 with the containers **running**:

```
/opt/agentes/east-backup-20260830.tgz   9 307 208 bytes
sha256 97f6fb3132ea1d9284059d492e0515a47892c4895e3940863f56bb8829588ff0
```

Take a fresh one **after** stopping the containers — a tar of a live SQLite
file is a tar of a file mid-write. Keep both; the old one costs 9 MB.

## The cutover

Everything below is run from `hermes-kit/` on Luis' machine, except where it
says otherwise. Expected client-visible downtime: **none, because there is no
client on it.** Wall-clock for the operator: about 25 minutes, of which ~4 are
the two container restarts.

### 1. Stop, and back up the stopped tree

```bash
ssh east 'cd /opt/agentes/east && docker compose stop'
ssh east 'tar -czf /opt/agentes/east-backup-$(date +%Y%m%d)-stopped.tgz -C /opt/agentes east && \
          sha256sum /opt/agentes/east-backup-*-stopped.tgz'
```

### 2. Migrate the layout

Preview first — it touches nothing and prints every action:

```bash
./tools/migrate-agent-to-english.sh east --dry-run
```

Then for real:

```bash
./tools/migrate-agent-to-english.sh east
```

Expect `done 11 · skipped-not-present 29 · manual-steps 5`. The five
manual-steps are the old Spanish kit skills; step 5 deals with them.

> **The three bugs this script had until 30/8**, all found by running it
> against a real copy of East and all fixed now. They are written down because
> each one was invisible in the unit tests, and because the same shapes will
> come back:
>
> 1. **Only the host half of the compose bind was renamed.** A
>    pre-translation compose reads `- ./politica:/opt/politica`; the script
>    turned it into `- ./policy:/opt/politica`, which mounts fine. The adapter
>    then defaults `POLICY_DIR` to `/opt/policy`, **creates it empty**, and the
>    client's connection permissions read as defaults while the capability
>    cards come up blank. Nothing errors. The test fixture had the container
>    half already in English — a file no agent of that era has — so
>    `assertNotIn("politica", …)` passed over it.
> 2. **The ssh round trip rewrote every owner.** The staging copy is pulled to
>    the Mac as an unprivileged user, and `rsync -a` back up (receiver is root)
>    wrote that ownership onto the server: `data/` measured going from
>    `10000:10000` to `501:0`. The container user then cannot write `state.db`,
>    the logs or the workspace — the gateway starts and everything it saves
>    fails. Now the ownership is read before the move and restored after.
> 3. **Only the first retired path was ever deleted.** `ssh` inside the
>    `while read` loop consumed the rest of removed-paths.txt on its first
>    iteration: 8 paths listed, 1 removed, no error. `politica/` survived next
>    to `policy/` carrying the pre-migration guard and `policy.json`, for the
>    next person to edit by mistake. Fixed with `ssh -n`.

### 3. Carry the identity across

The live tree has no identity at all, and `agent-check` fails on it. Take the
baptism from the laptop tree and add the company, which the v1-era baptism
never recorded (the portal only learned to ask in adapter 0.32):

```bash
ssh east 'cat > /opt/agentes/east/data/portal_identity.json' <<'JSON'
{
  "name": "Selastian",
  "look": {"tone": 4, "antenna": 1, "accessory": 1, "pupil": 0,
           "mouth": 2, "skin": 0, "suit": 0, "brows": 1},
  "company": "East Comunicación"
}
JSON
ssh east 'chown 10000:10000 /opt/agentes/east/data/portal_identity.json'
```

The SOUL needs the identity prose too — the block that says who it works for.
Take everything above `## REGLA DURA` from the laptop tree's `data/SOUL.md`
(3.2 KB: who it is, who Cata is, her programs, its scope) and put it **before**
the `kit:base` block, with the `portal:identity` block **after**. That order is
what `05-precedence.md` assumes.

### 4. SOUL v13

`replace-block.py` will refuse on East: its block is the bare `<!-- kit:base -->`
marker from before versioning, and there is no canonical v1 to diff a client's
hand-written additions against. **There are none** — checked line by line on
30/8, the v1 block is generic kit prose with nothing about Cata in it — so
`--no-canonical` is the honest flag here, not a shortcut:

```bash
./tools/install-soul.sh --block > /tmp/v13-block.md
rsync -a east:/opt/agentes/east/data/SOUL.md /tmp/east-soul.md
python3 tools/replace-block.py /tmp/east-soul.md /tmp/v13-block.md --no-canonical > /tmp/east-soul-v13.md
# add the identity prose from step 3, then:
rsync -a /tmp/east-soul-v13.md east:/opt/agentes/east/data/SOUL.md
ssh east 'chown 10000:10000 /opt/agentes/east/data/SOUL.md'
```

The 516 bytes of Nous' stock English preamble sitting after the old block are
kept by `replace-block.py` as "outside the block". Delete them by hand: the
v13 block says the same things in Spanish and better.

### 5. Install the kit

**No `purchased.json`.** Cata's work needs `transcription`, which is a
`level: base` row and installs on every agent with no file at all. Nothing on
her flows maps to a menu row: `radio-viva` is her own `redactar-noticia`
skill, not the kit's `social-content`, so `social-package` would install three
plugins she does not use. Writing an empty file would be worse than none —
`plugin_set.py` reads no file as "fresh client", which is exactly right.

```bash
rsync -a east:/opt/agentes/east/ /tmp/east-tree/
./install.sh /tmp/east-tree/data
```

Expect 7 plugins (`approval artifact capability deliverable flow kanban` +
`transcribe`) and 8 kit skills. Sync back and fix ownership:

```bash
rsync -rlptD /tmp/east-tree/ east:/opt/agentes/east/
ssh east 'chown -R 10000:10000 /opt/agentes/east/data && \
          chown -R 0:0 /opt/agentes/east/{policy,plugins,kit-skills,kit-adapter}'
```

**Then delete the five leftover Spanish skills, and this is not optional:**

```bash
ssh east 'cd /opt/agentes/east/data/skills && \
          rm -rf aprobacion entrada-drive entregable flujo transcribir && \
          rm -rf /opt/agentes/east/data/scripts'
```

`data/skills/` wins over the external `kit-skills/` mount, so while they are
there the engine indexes the old copy. `flujo/crear_flujo.py` writes to
`/opt/data/flujos/` while the 0.43.0 adapter lists `/opt/data/flows/`: a flow
Cata asks for would be created, run, and never appear in her Flujos tab — the
exact silent failure the promises guard exists to catch, walked back in
through a leftover. No installer removes them (the cleaner only deletes what a
previous `.kit-installed` recorded, and East never had one) and
**`agent-check` does not catch it either** — its shadowing check is by name,
and these names no longer collide. `data/scripts/portal_adapter.py` is the old
0.36.0 adapter in the one directory the agent can rewrite; it goes for the
same reason.

### 6. Compose and config

The compose needs six lines. Add to the **hermes** service:

```yaml
    volumes:
      - ./kit-skills:/opt/kit/skills:ro
      - ./policy/plugins:/opt/data/plugins:ro
    env_file:
      - ./secrets.env        # was ./data/.env
```

and to **portal-adapter**:

```yaml
    entrypoint: ["python3", "/opt/kit/adapter/portal_adapter.py"]
    user: "10000:10000"
    volumes:
      - ./kit-skills:/opt/kit/skills:ro
      - ./kit-adapter:/opt/kit/adapter:ro
      - ./plugins:/opt/plugins:ro
    env_file:
      - ./secrets.env
```

Move the secrets out of the agent's own directory, which is the point of the
`env_file` change (`data/.env` is writable by the agent, and it is the
env_file of the container that runs code):

```bash
ssh east 'mv /opt/agentes/east/data/.env /opt/agentes/east/secrets.env && \
          chown 0:0 /opt/agentes/east/secrets.env && chmod 600 /opt/agentes/east/secrets.env'
```

The config gets the knobs East never had — it predates all of them:

```bash
python3 tools/skills-knob.py --image nousresearch/hermes-agent:v2026.7.30 \
        --apply /tmp/east-tree/data/config.yaml
```

That one command writes `skills.disabled` (66 engine skills off),
`skills.external_dirs`, `platform_hints`, `display.file_mutation_verifier` and
the three `platform_toolsets`. It needs the image locally — it reads the
bundled skill list out of it, and East's `data/skills/` has no
`.bundled_manifest` to read instead. Then add by hand, from
`compose/config.base.yaml`: the `hooks` block (three `pre_tool_call` matchers
pointing at `/opt/policy/hooks/gate.py`), `hooks_auto_accept: true`,
`kanban.auto_decompose: false`, `curator.enabled: false`, and

```yaml
plugins:
  enabled:
    - promises
```

Without the `hooks` block the gate is installed and **open**: the agent can
install software, sign comments as `cliente` and unblock its own tickets, with
only the SOUL in the way.

### 7. Start

```bash
ssh east 'cd /opt/agentes/east && docker compose up -d'
```

`up -d`, never `restart`: every mount above is new, and `restart` keeps the old
bind table.

## Verification — all of it, in this order

| # | Check | Expected |
|---|---|---|
| 1 | `python3 tools/agent-check.py /tmp/east-tree/data` (offline, before `up`) | **30 ok · 0 warnings · 0 failures** |
| 2 | `docker ps` | three containers up, engine `v2026.7.30` |
| 3 | `portal-check --key … --endpoint https://east.agentes.tuagente.uy --adapter https://east-portal.agentes.tuagente.uy --origin https://tuagente.uy` | **11 ok · 3 warnings · 0 failures** |
| 4 | `GET /portal/manifest` | `"agent":"Selastian"`, `"named":true`, `"company":"East Comunicación"`, `adapter-0.43.0` |
| 5 | `GET /portal/plugins` | 7 plugins — was `[]` (pre-3b) |
| 6 | `GET /portal/flows` | 8 curated flows, all `active` |
| 7 | `ssh east 'find /opt/agentes/east/data ! -user 10000'` | empty |
| 8 | `ssh east 'ls /opt/agentes/east'` | no `politica`, no `data/scripts` |
| 9 | `grep /opt/politica docker-compose.yml` | no match |

The three warnings in #3 are `approvals`, `usage` and `crons` "not declared",
and all three are correct: nothing is waiting for approval, and there are no
cron jobs. `usage` turns on by itself once `OPENROUTER_API_KEY` is in
`secrets.env`.

If #1 does not reach 0 failures, stop. It is offline and costs nothing to
re-run; the whole point is that it happens before the containers come up.

## Rollback

One command, and it is total:

```bash
ssh east 'cd /opt/agentes/east && docker compose down'
ssh east 'mv /opt/agentes/east /opt/agentes/east-failed-$(date +%Y%m%d) && \
          tar -xzf /opt/agentes/east-backup-<date>-stopped.tgz -C /opt/agentes && \
          cd /opt/agentes/east && docker compose up -d'
```

`down` without `-v`: the Caddy volumes hold the TLS certificates and Let's
Encrypt has a weekly issuance cap. Keep the failed tree rather than deleting
it — it is what says why.

## What Cata might notice

**Nothing.** She has never connected to this agent, no message of hers is on
it, and the two domains keep answering on the same certificates. If she opened
the portal today she would see an unnamed agent with an empty everything; after
the cutover she would see `Selastian`, seven plugins' worth of tabs and eight
flows she did not ask for (the kit's curated catalog — they are offers, not
promises, and they are what every new agent gets).

The one thing she would notice is a **Telegram reconnect**: the bot drops for
the ~2 minutes the gateway is down. Nobody is paired to it — `channel_directory.json`
lists zero Telegram users and the config's `home_channel` still says
`COMPLETAR_CHAT_ID` — so there is nothing to notice it.

## The window

**There isn't one to protect.** Zero sessions, zero messages, zero tickets,
zero crons; the last real traffic was Luis' own health checks on 11/8. Any
hour works.

Do it in a weekday morning anyway, for the operator's sake and not the
client's: `skills-knob.py` needs to pull a 4 GB image if it is not cached, the
Caddy certificates renew on their own schedule, and a cutover you can watch
for an hour afterwards is worth more than one done at midnight. Avoid a Friday
evening for the ordinary reason.

## Still open, and none of it blocks the cutover

- **What happens to the laptop tree.** 169 MB of a client's data at rest
  outside the VPS: her interviews, her flows, `state.db` with the real
  history, and `google_client_secret.json`. This cutover does not touch it and
  does not merge it. Merging it is a bigger job than a rename — the flows
  carry a `trigger_job` id pointing at a cron that no longer exists, and the
  deliverables would have to land under a workspace the live agent has never
  had. Decide it with Cata, not as housekeeping.
- **`drive-inbox` is an orphan.** Her `entrevistas-tv` flow declares it, and
  **no capability sells it** — not `system`, not behind a `level: base` row, so
  `plugin_set.py` gives its folder to no agent and this cutover does not
  install it. Her main flow's first step has no skill behind it. That is a
  catalog decision (which menu row installs `drive-inbox`), not a migration
  one.
- **Her own two skills**, `frases-zocalo` and `redactar-noticia`, exist only on
  the laptop tree. They are hers, not the kit's; whatever carries the flows
  across carries these.
- **`AGENT_NAME=Agente`** stays in `.env` as a fallback. It is dead once
  `portal_identity.json` exists — the baptism wins — but it is what the portal
  would show if that file were ever lost, and "Agente" is a worse thing to show
  than "Selastian".
