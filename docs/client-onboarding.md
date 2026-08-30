# Onboarding a new client — step by step

Drawn from having done it once (La Mano). Anything marked "verified" we've already tested.

---

## Phase 0 — What to gather before touching anything

**From the client:**
- The concrete **process** they want solved, with their people and their steps.
- **What can never happen without their OK.** This answer defines the whole SOUL.
- Access to the systems the agent will use (inbox, spreadsheet, CRM).
- Who the responsible human is: the one who approves and the one who gets notified.

**From us:**
- `API_SERVER_KEY` (`openssl rand -hex 32`) — unique per client, never reused.
- **A server SSH key, also one per client**, on the same principle:
  `ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519_tuagente_<slug> -C "tuagente_<slug>"`.
  On Hetzner it's uploaded under that same name (`tuagente_east`), the same way
  the bots are `tuagente_<slug>_bot`. If one client's key gets compromised, it
  doesn't open the other clients' servers.
- Model provider key (OpenRouter, in our case).
- **Server: one VPS per client** — Hetzner CX23 (2 vCPU, 4 GB, 40 GB,
  20 TB) at USD 7.09 with the IPv4. Not a shared box: Hermes executes code
  and a container isn't a hard boundary against an agent that's had
  instructions injected into it. At that price, isolation is nearly free.
  - When creating it: **an SSH key, no question** (without one Hetzner emails
    the root password), **backups turned on** (+20%; that's where all of the
    client's memory lives), and then a **Hetzner Firewall** with only
    22, 80 and 443 open.
  - Hetzner's firewall beats `ufw` **because it lives outside the VM**:
    Docker can't route around it by writing iptables underneath, which is
    exactly what `docker publish` does.
  - Onboarding is run by `hermes-kit/deploy-remote.sh`.

**Real operating cost** (measured over one month of La Mano): **USD 2 of
compute**. What gets charged is the operation, not the tokens.

---

## Phase 1 — Choose the channel (the decision with the most consequences)

### Telegram — 5 minutes, free, works today
1. `@BotFather` → `/newbot` → name and username → returns the **token**.
   **Username is ALWAYS `tuagente_<slug>_bot`** (e.g. `tuagente_east_bot`): they're
   our brand on the client's phone, and that's how they recognize each other.
   WATCH OUT: BotFather doesn't let you change the username afterward — get it
   right the first time (East's ended up `east_eco_bot`, predating this rule).
2. The client does NOT need to share their user id: they say hi to the bot,
   get the pairing code, and paste it into the portal (Connections tab, "Lista
   para vos" status) — the activation runs on its own through the adapter. The
   initial `TELEGRAM_ALLOWED_USERS` carries only our support id.
3. `TELEGRAM_BOT_TOKEN` and `TELEGRAM_ALLOWED_USERS` in the `.env`, and the home
   channel for proactive notices.
4. **The bot's photo**: when the client names their agent, the portal
   captures the chosen agentito and drops it at `data/bot_avatar.png`. It gets
   uploaded with `hermes-kit/tools/avatar-bot.py` (Telethon via MTProto — the
   Bot API doesn't let a bot change its own photo). Needs, once: my.telegram.org's
   api_id/api_hash in `.secrets/telegram_api.json`, and
   `python3 -m venv ~/.tuagente-tools && ~/.tuagente-tools/bin/pip install telethon`.
   Manual fallback: `@BotFather` → `/setuserpic`.
   The **name**, though, works: when the client names their agent in the portal, the
   adapter hits the bot with a `setMyName` (adapter 0.26+). So after naming,
   the bot is already called the same as the agent; only the little face is
   still missing.

It's the channel to start with, for pilots, and for the internal team. Verified.

### WhatsApp — two paths, and one is a trap
- **`hermes whatsapp` (QR bridge, Baileys/whatsmeow):** pairs by scanning a QR
  code with a regular WhatsApp. Fast and free, but **it's an unofficial
  client: Meta can ban the number**. Never on a client's business line. At
  most, on a disposable number for an internal test.
- **`hermes whatsapp-cloud` (Meta's official API):** what gets used in production.
  Requires:
  - A verified **WhatsApp Business** account and Business Manager.
  - A **number that is NOT already active on regular WhatsApp** (if it is, it
    needs migrating and loses normal use).
  - A **public webhook URL** → forces real hosting (Railway), an office
    machine won't do.
  - **Meta-approved templates** to start a conversation outside the 24 h
    window. Without this the agent can only reply, not reach out.
  - Meta approval: days, not minutes. **Start the project with this.**

### Other
- **Email:** the client's own mailbox + app password (or SMTP). Verified.
- **Web form:** a POST to the API server, the way the pdelabs landing page does.

---

## Phase 2 — Bring up the agent (LOCAL: a Mac, a dev box)

**Read the label.** This phase is the local topology, and it was unlabelled
long enough to send someone onboarding a VPS client through the wrong
instructions (`docs/PENDING.md`, item 7 of the 24/8 report). A client's agent
lives on a VPS; the remote path is Phase 2b and it is a different script, a
different compose and no published ports at all.

The compose file **isn't copied by hand**: it's generated by
`hermes-kit/new-agent.sh`, with the slug, the name and the ports already resolved.

```bash
./new-agent.sh acme "Acme SA" ~/Desktop/Luis/Projects/agent-acme [8642]
```

Two services, **one per client**, each with its own volume and its own key —
never shared:

- `hermes` — gateway, 8642 (API) and 9119 (dashboard, off), **loopback only**.
- `portal-adapter` — our sidecar, 8643, same image and same volume.

**The ports are the host's and get passed as the fourth argument** (the
adapter takes the next one). Default is 8642/8643, which is correct with one
VPS per client; if another agent already lives on that host, it needs moving
(8742, 8842…). The script checks they're free before creating anything: they
used to be hardcoded in the template, and the clash only showed up at
`up -d`, with the SOUL already written.

Variables that break something silently if they're missing:

| Variable | Service | If missing |
|---|---|---|
| `AGENT_NAME` | adapter | the portal shows "Agente" |
| `API_SERVER_CORS_ORIGINS` | hermes | the browser drops everything |
| `PORTAL_CORS_ORIGINS` | adapter | same |
| `TZ` | both | tasks run at the wrong time |

**Both CORS vars carry both loopback spellings** — `http://localhost:8090`
and `http://127.0.0.1:8090` — and they already come that way in the template.
To the browser these are different origins: with just one, `curl` works (it
doesn't send `Origin`) and the portal shows "No pude hablar con tu agente".
It's the classic "works over curl, doesn't work in the browser", and
`portal-check.py` verifies it when `--origin` is loopback.

---

## Phase 2b — Bring up the agent (VPS: what a client actually gets)

`hermes-kit/deploy-remote.sh` does the whole thing: it uploads a staging copy,
runs `install.sh` against it, and brings the containers up from
`compose/docker-compose.remote.yml`. Three things about it differ from Phase 2
and each one has bitten:

- **The remote compose publishes NO port.** 8642/8643 exist inside the Docker
  network and nowhere else; the browser reaches the agent through Caddy on the
  two `*.agentes.tuagente.uy` hostnames, over TLS. Any instruction that says
  `http://<host>:8643` is the local one.
- **The `API_SERVER_KEY` is generated ON THE SERVER and no step brings it
  back**, yet `portal-check --key` (Phase 6) and the magic link (Phase 7) both
  need it on your machine. Fetch it yourself, into a 600 file, and do not
  upload it in the other direction:

  ```bash
  ssh <host> "grep '^API_SERVER_KEY=' /opt/agentes/<slug>/secrets.env" \
    | cut -d= -f2- > ~/.tuagente/<slug>.key && chmod 600 ~/.tuagente/<slug>.key
  ```

- **`agent-check.py` needs the WHOLE tree, not `data/`.** The script's own
  closing step still prints an `rsync … /data/` that gives **8 failures, 7 of
  them invented** — the gate, the promises guard, the pairing patch, the
  capabilities catalog, the kit skills and the credentials all live NEXT to
  `data/`, not inside it. Mirror the tree:

  ```bash
  rsync -rlpt --delete <host>:/opt/agentes/<slug>/ <local-mirror>/
  python3 hermes-kit/tools/agent-check.py <local-mirror>/data
  ```

  That mirror is worth keeping: it is what the checks read. Decide, once, what
  of it gets versioned — `.gitignore` is an allowlist over `data/*` and there
  is no rule saying it covers everything `agent-check` looks at
  (`docs/PENDING.md`, items 3, 4 and 13 of the 24-25/8 reports, all three still
  open in the script).

**Never pipe `deploy-remote.sh` into `head`.** SIGPIPE kills it mid-run, the
cleanup half never happens, and the pipe masks the exit status. Redirect to a
file; re-running the deploy converges.

---

## Phase 3 — Install the kit

Nothing gets copied by hand: `hermes-kit/install.sh <path>/data` puts it
there (and `new-agent.sh` already ran it). The kit's skills and the adapter's
code **live outside `data/`** — in `kit-skills/` and `kit-adapter/`, mounted
read-only — because `data/` belongs to the agent and it could rewrite them.
To see what differs between an installed agent and the kit:
`install.sh <path>/data --diff`.

**Every `SKILL.md` has to have frontmatter with `name` and `description`.**
That's the only thing the agent reads to decide whether to open the skill;
without frontmatter it gets indexed with an empty description and ends up as
a loose name it never uses. The description says **what it does and when to
use it**.

Hermes handles the rest: it detects new files by date and size and rebuilds
its index on its own, no commands or restarts needed — but **it's not
instant** (~20 minutes in our test). If you just copied the kit and the agent
says it doesn't know a skill, wait and try again before diagnosing anything.

**An agent created before 23/8/2026 has to be migrated first.** Its on-disk
layout still uses the old Spanish names (`politica/`, `secretos.env`,
`data/flujos/<slug>/FLUJO.md`, `portal_identidad.json`, …), which this kit no
longer knows: installing over it leaves two parallel layouts and the agent
keeps reading the old one. Run `hermes-kit/tools/migrate-agent-to-english.sh
<host> --dry-run` first, then without the flag; the full runbook (including
the `docker compose up -d` that a `restart` can't replace, and the SOUL v13
reinstall that goes with it) is in `hermes-kit/fleet.md`, under "Migrating a
live agent to the English layout". It has not been run against a live host
yet.

---

## Phase 3b — What the client bought

One agent per client; what varies between two clients is which capabilities
they paid for. That is **one file, and it goes in before the installer runs**:

```json
{
  "_comment": "What this client bought. Ids from capabilities/catalog.json.",
  "capabilities": ["quotes", "invoices-to-data"]
}
```

at `<agent-path>/policy/capabilities/purchased.json`. The ids are the ones the
client already reads on the Capacidades card — `capabilities/catalog.json` —
and a typo is a hard stop, not a shrug: what is in this file decides which
code reaches the agent.

**Nothing else is a switch.** `tools/plugin_set.py` computes this agent's
plugin set from three facts: the six `system` plugins (unconditional), the
plugins a `level: base` capability promises as already installed (today
`transcribe`, via `transcription`), and the plugins the purchased capabilities
declare under `installs.plugins`. `install.sh` ships exactly those folders to
`<agent>/plugins/`, and `tools/skill_sources.py` narrows the skill index to
match — so a client who never bought `quotes` does not pay prompt on every
request for a quote-writer whose tab, routes and flows are not on the agent.
`agent-check.py` asks the same functions, which is the only way "what should be
there" and "what is there" can be one answer.

**No file is a state, not a failure.** A client who has bought nothing is every
client on their first day: **7 plugins and 8 skills**, and the install says so
in one line.

**The purchased flows come with the plugin.** A curated `FLOW.md` belongs to
the plugin whose skill it exercises (`surfaces.flows`), and `install.sh` lands
it in `data/flows/<slug>/` — where `create_flow.py` writes, where the adapter
reads, and where the client can edit it exactly like the ones their agent
wrote. Buying `invoices-to-data` is what puts `planilla-del-mes`,
`conciliar-cobros` and `facturas-vencidas` on the agent.

**On a VPS, the file lives over there and the deploy reads it.**
`deploy-remote.sh` copies `policy/capabilities/purchased.json` off the server
into its staging *before* running the installer, precisely so the install is
computed against what this client bought and not against an empty fake
directory. So: put the file on the server first, then deploy.

```bash
scp purchased.json <host>:/opt/agentes/<slug>/policy/capabilities/purchased.json
ssh <host> "chown 10000:10000 /opt/agentes/<slug>/policy/capabilities/purchased.json"
```

The `chown` is not decoration: the adapter runs as uid 10000 and writes
`requests.jsonl` in that same folder. And the file **never travels back** — it
is written where the client's agent lives, it is in no manifest, and the deploy
reads it without rewriting it.

**Selling one more capability later** is: add the id, re-run the deploy (or
`install.sh` locally). Removing one is the same edit in reverse, and the
installer says out loud which plugin is leaving and why.

---

## Phase 4 — Write the SOUL

The only truly hand-crafted part, and where the value is. At minimum:
- Who the agent is and who it works for.
- **The hard approval rule** (what we pulled out in Phase 0).
- Where everything goes: deliverables by skill, scaffolding to
  `workspace/interno/`.
- When an artifact beats plain text.
- What to do with the portal's references and with files in `entrada/`.

Golden rule: if a convention matters, have a script enforce it. The SOUL
decides *when*; the code defines *how*.

---

## Phase 5 — Scheduled tasks

They're created **via CLI** (`hermes cron create`), not with a yaml — we
already tried that and it doesn't work.

**Trap found on 2026-08-04:** a task created from a portal session ends up
delivering to that session, which is HTTP request-response and **can't
receive messages**. It runs fine and nothing arrives, with no warning. Always
pin a channel that can receive (Telegram/WhatsApp) when creating the task.

---

## Phase 6 — Verify before delivery

```bash
# LOCAL agent (the ports are the host's; on a shared box they move)
python3 tools/portal-check.py --key <API_SERVER_KEY> \
    --adapter http://127.0.0.1:8643 --endpoint http://127.0.0.1:8642 \
    --origin http://localhost:8090

# VPS agent — through the two hostnames, which is the ONLY way to test what
# the client's browser actually traverses (Caddy, TLS, CORS). The remote
# compose publishes no port, so `http://<host>:8643` is unreachable by design.
python3 tools/portal-check.py --key "$(cat ~/.tuagente/<slug>.key)" \
    --endpoint https://<slug>.agentes.tuagente.uy \
    --adapter  https://<slug>-portal.agentes.tuagente.uy \
    --origin https://app.tuagente.uy
```

**THE TWO URLS ARE NOT OPTIONAL.** The script defaults them to 8642/8643, and
on a host that already runs an agent the ports move — without them the check
greets the OTHER agent and passes green.

**0 failures** or it doesn't ship. After that, by hand, the loop that sells
the product:

1. Ask it something over chat → it answers.
2. Ask for a visualization → it creates the artifact and cites it.
3. Ask for something that needs permission → it shows up in Approvals with
   its table.
4. Correct and approve → it unblocks with your version locked in.
5. Create a task from the board and comment on it → the agent sees it.
6. Schedule a reminder → **it reaches the channel** (see Phase 5).

---

## Phase 6b — Zeroing it out (the step that was missing)

**Phase 6 dirties the agent, and the client opens their portal on day one.**
If it doesn't get cleaned up, the first thing they see is *one of our
conversations* in the chat, spend in the Usage tab, and test deliverables in
Files: they learn their agent came pre-used. The fix isn't to verify less —
the Phase 6 loop is exactly what needs testing — the fix is to clean up
afterward:

```bash
# local agent
hermes-kit/tools/reset-agent.sh --local <agent-path> --delivery
# agent on the VPS
hermes-kit/tools/reset-agent.sh <host-ssh> [slug] --delivery
```

Erases the footprint (conversations, usage, pipeline, approvals,
deliverables, artifacts, memories, the naming, and the bot's photo) and
**keeps what was written for this client**: the SOUL — minus the
`portal:identity` block, which the naming writes — the flows and their
scheduled tasks. It leaves a backup before touching anything. Without
`--delivery` the reset is the full one, which also takes out the SOUL: that
one is for recycling an agent, not for delivering it.

And it gets verified, so it doesn't depend on someone remembering:

```bash
python3 hermes-kit/tools/portal-check.py --key <API_SERVER_KEY> --delivery \
    --endpoint http://<host>:<port> --adapter http://<host>:<port+1>
```

With `--delivery`, if a conversation, a ticket, a file, spend, or the naming
is still in place, it **fails** and says how to fix it. **0 failures or it
doesn't ship.**

On the browser side: open the portal in an incognito window. `localStorage`
remembers the name and the look even after the agent no longer does, and
without this it looks like the reset didn't work.

---

## Phase 7 — Hand over access

`https://app.tuagente.uy/app#endpoint=<api>&adapter=<adapter>&key=<key>`

**The link is the credential**: whoever has it, has the agent. Send it over
a private channel, with a different key per client.

---

## Phase 8 — The naming, which is the client's job and nobody else's

The agent is delivered **deliberately empty of a name**, and the first screen
behind the link is where it gets one. Six steps, in this order, and the order
is the product:

1. **Name and face.** «Tu empresa tiene un empleado nuevo» → the client types a
   name and rolls a look. `POST /portal/identity` writes both to the volume,
   reports them in the manifest (`agent`, `look`, `named`), writes the name
   into `SOUL.md` inside the `<!-- portal:identity -->` markers so the agent
   introduces itself that way, and pushes a `setMyName` to the Telegram bot.
   Everything outside the agent is best-effort; the naming still went through.
2. **The business** — what the company does and its site. Same endpoint,
   same block, and it spawns the `Conocer <empresa>` ticket. **That ticket is
   the day-one spend**, ~US$0.0165 over 12 calls, and it is worth knowing that
   the setup itself costs nothing and the client's first minute costs a turn.
3. **The overview** — the agent, now named, says in three lines what it is
   going to do; it reads the site given in step 2 while the client reads this.
4. **The channel** to notify them on (`contact.channel`).
5. **What it can take off their hands** — the automations carousel.
6. **The first message**, prefilled from whatever they picked.

**Do not write the identity by hand to make a check pass.** `agent-check.py`'s
`SOUL: identity` reads INSIDE the block, and a block with neither a name nor a
company fails by name — which is correct and is the whole point: an agent that
reaches a client nameless is the failure the check exists to catch. As of
adapter 0.43.0 a `POST /portal/identity` that would leave the agent nameless is
a **400**: the name comes first, the business and the channel after.

**Fixed 30/8, and worth knowing it existed:** the layout refetches the manifest
every 60 s, and once the channel step had written `contact.channel` that poll
unmounted onboarding mid-flow — dropping the client into the portal without the
automations carousel or the chat step. The gate reads the agent's answer once
now, at the start of the session; see `docs/PENDING.md`.

---

## How long it takes today

Telegram + a simple process: **1 to 2 days** of real work, most of it in
Phase 0 and Phase 4. With official WhatsApp: **add Meta's wait**, which is
out of our hands — that's why it's the first thing to kick off.

## What's missing for this to take one day

- A `hermes-kit` repo with the skills + the adapter + an onboarding script.
- SOUL templates by business type.
- A Terraform/Railway template instead of copying the compose by hand.
