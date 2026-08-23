# hermes-kit

What tuagente.uy installs on each client's agent. It used to live inside
pdelabs' agent, so onboarding someone new meant copying files from another
client's agent. This turns it into a procedure.

```
new-agent.sh                creates a new client's repo and installs the kit on it
install.sh                  installs or diffs the kit against an existing agent
adapter/portal_adapter.py   the sidecar the portal consumes (:8643)
skills/                     artifact · deliverable · approval · capability · the shadow ones
plugins/<id>/plugin.json    the plugin registry: reusable units of custom work (plugins/README.md)
capabilities/catalog.json   which capabilities can be requested, and how they get installed
policy/hooks/               the gate: what the agent CANNOT do, in code
soul/                       the system-prompt blocks, with placeholders
soul/versions/vN.md         each version of the block exactly as it shipped, frozen
onboarding/                 the agent's first task (the company brief)
compose/                    docker-compose template
tools/agent-check.py        checks an agent's data/ without powering it on (offline)
tools/portal-check.py       verifies that an agent meets the portal's contract
tools/reset-agent.sh        wipes an agent to zero (--delivery: onboarding's final step)
tools/install-soul.sh       drops the SOUL block onto an agent that doesn't have it
tools/clean-obsolete.sh     removes from the agent what the kit stopped shipping, nothing else
tools/compare-installers.sh  do a local and a remote agent get the same kit?
tools/test-remote-deploy-ssh.sh  deploys against a real sshd (GNU rsync)
tools/check-plugins.py      is the plugin registry whole? ids, versions, dependencies, surfaces
tools/skills-knob.py        generates the list of engine skills to turn off
tools/replace-block.py      swaps a SOUL's kit:base block without touching the rest
fleet.md                    which agent runs where, with what SOUL and what engine
```

An installed agent looks like this:

```
data/           the AGENT's own: it writes here, and anything living here it can
                rewrite (inside its container it runs as root).
policy/         what the agent executes but CANNOT edit: the gate (`hooks/`),
                the MCP guard with each connection's permissions, the pairing
                patch that s6 runs on every boot, and the capabilities catalog
                with its request log. Protected by its container's `:ro` mount
                —verified: inside it returns "Read-only file system" even for
                root—, not by ownership.
kit-skills/     the kit's skills, `:ro` in both services, so neither the agent
                rewrites them nor the engine's curator archives them.
kit-adapter/    the adapter's CODE, `:ro`. It used to live in `data/scripts/`
                and that was a privilege escalation: the agent could rewrite
                the file and the adapter's container would execute it **as
                root** over `policy/`. Today the adapter also runs as uid
                10000.
secrets.env     the keys. root:root 600 and OUTSIDE data/: it was the
                `env_file` of both services, so with the keys inside data/ the
                agent could write itself a `PYTHONPATH` and run its own code
                inside the adapter (measured). Nobody mounts it.
.kit-installed  which files the kit put there and with what sha256 (see below).
```

All of that is put there by `install.sh` on a local agent and by
`deploy-remote.sh` on one on the VPS — which runs the same `install.sh`
against a staging box; `install.sh --diff` compares what's installed against
the kit. The why of each mount is in `notes/knobs-applied.md` and in the
comments inside `compose/`.

## Onboarding a new client

```bash
./new-agent.sh acme "Acme SA" ~/Desktop/Luis/Projects/agent-acme [8642]
```

Creates the agent's repo — compose with the name and ports already set,
`data/` with its structure, `secrets.env`, `.gitignore`, a SOUL draft
assembled from the blocks — installs the kit on it, and makes the first
commit. Then, by hand:

1. **Compose the SOUL** from the blocks in `soul/` — see `soul/README.md`.
   It's the only genuinely hand-crafted work, and where the value is.
2. Fill in `secrets.env` (at the agent's root, **not** in `data/`).
3. `python3 tools/agent-check.py <path>/data` → **0 failures before powering
   on.**
4. `docker compose up -d`
5. `python3 tools/portal-check.py --key <API_SERVER_KEY>` → **0 failures or it
   doesn't ship.**
6. `tools/reset-agent.sh --local <path> --delivery` → **leave it at zero**,
   and `portal-check.py --delivery` to verify it (see below).

**The fourth argument is the gateway port on the host** (the adapter takes
the next one). Default is 8642/8643, which is right when the client has their
own VPS; on a host that already runs another agent it has to move. The
script checks that both ports are free **before creating anything**: the
collision used to only show up at `up -d` — container names carry the slug
and don't collide — i.e. with the SOUL already written and the keys already
loaded.

### Onboarding ends at zero

Verifying leaves a mess: the loop that sells the product is talking to it,
asking for an artifact, and approving something. If that isn't cleaned up,
**the client opens their portal on day one and finds a conversation of ours
and spend on the Usage tab.**

```bash
tools/reset-agent.sh --local <agent-path> --delivery
python3 tools/portal-check.py --key <API_SERVER_KEY> --delivery \
    --endpoint http://127.0.0.1:<port> --adapter http://127.0.0.1:<port+1>
```

The `--delivery` reset wipes the footprint (conversations, usage, board,
approvals, deliverables, artifacts, memories, naming, and the bot photo) and
**keeps what was written for this client**: the SOUL — minus the
`portal:identity` block, which the naming step writes — the flows and their
scheduled tasks. Without `--delivery` the reset is the usual full one, which
also wipes the SOUL: that one is for recycling an agent, not for delivering
it.

`portal-check.py --delivery` is what keeps this from depending on remembering:
if a conversation, a ticket, a file, spend, or the naming is still there, it
**fails** and prints the command to fix it. Without the flag it changes
nothing — on a production agent, having conversations is expected.

The full runbook, with the channels (Telegram, official WhatsApp vs. the QR
bridge) and the real timings, is in `tuagente.uy/docs/client-onboarding.md`.

## Keeping it in sync

```bash
./install.sh /path/to/agent/data --diff
```

Tells you which files differ between the kit and an already-installed agent.
**The kit is the source of truth**: if you fixed something inside an agent,
copy it to the kit before reinstalling or you'll overwrite it. Run it before
every update.

## A single installer

`install.sh` is the only place that decides what the kit installs.
`deploy-remote.sh` **has no list of its own**: it assembles a fake agent in
`/tmp`, runs `install.sh` against it, and uploads that. Before, there were two
hand-kept lists and they diverged four times without anything failing — the
capabilities catalog never reached any remote agent, the pairing patch
reached no local one — nothing breaks, nobody notices, the client gets a
worse version.

```bash
tools/compare-installers.sh        # do both paths install the same thing? 0 = yes
tools/test-remote-deploy-ssh.sh    # deploys against a real sshd (docker)
```

The first one builds both agents and diffs them file by file: run it whenever
you touch either script. **It doesn't validate the rsync protocol** — it uses
local mode, and the Mac's rsync is openrsync, not the VPS's GNU one — so
**any rsync option gets tested with the second one**, which spins up an
alpine box with sshd and does a real deploy. `--no-implied-dirs` passed the
first one with "29 identical files" and broke the remote deploy 100% of the
time.

**What the kit stops shipping is removed by manifest, never by mirroring
folders.** Every agent has a `.kit-installed` (path + sha256 of every file
we put there). For a file to be deleted, all **three** must hold:

1. it's on the **list of paths the kit is allowed to own**
   (`ALLOWED_PREFIXES`, in `tools/clean-obsolete.sh`) — these are exact
   files, except `policy/hooks|plugins|tools|mcp/` and `kit-skills/`, which
   are entirely ours as whole folders. `policy/` on its own is **not** in the
   list: it holds `policy.json` and `capabilities/requests.jsonl`, which the
   client writes;
2. it's in the previous manifest and no longer in the new one;
3. it still has the sha256 we wrote.

A client file fails rule 1 even if someone adds it to the manifest by hand —
tested. And if someone edited a file of ours that we no longer ship, it fails
rule 3: it gets flagged and left alone.

## Looking at an agent's databases

`state.db` and `kanban.db` open **only from inside the container**:

```bash
docker exec <client>-hermes sqlite3 'file:/opt/data/state.db?mode=ro' '...'
```

Never with the host's `sqlite3` over the bind mount, **not even read-only**.
SQLite locks don't cross the host↔VM boundary: the outside process thinks
it's the only one with the database open and touches the WAL index (`-shm`)
that the engine has memory-mapped. The engine then dies with `Fatal Python
error: Bus error` in `hermes_state.py … list_sessions_rich`, and s6 brings it
back up. Reproduced on 12/8/2026 on a local agent: reading `state.db` from
the host under parallel load, **57 of 60 requests to `/api/sessions` got no
response**. The soft variant of the same collision is an intermittent
`sqlite3.OperationalError: disk I/O error`, which shows up in the portal as
*"Couldn't reach your agent"* and sends people looking for the bug in the
portal, which has nothing to do with it.

And writes to the kanban always go through the CLI
(`docker exec <client>-hermes hermes kanban ...`), never via SQL.

## Why the adapter exists

Hermes' gateway exposes chat, sessions and jobs, but not the board, the
files, the approvals, or the artifacts. And it serves the chat stream of
sessions **without CORS headers**, so the browser drops it: the adapter
proxies it. Everything that writes to the kanban goes through Hermes' CLI,
never SQL.

Contract and verified endpoints: `tuagente.uy/docs/COMPACT.md`.

## The kit is a dependency, not a template

`agent-<client>` doesn't *come from* the kit: the kit gets **installed
inside it** and stays linked. That's why an adapter improvement reaches every
agent with an `install.sh`. If it were a template that gets cloned, every
client would stay frozen at the version they were onboarded with.
