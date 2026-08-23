# Hermes engine knobs, v2026.7.30 — what's configurable and how

**Phase A of the custody plan. Investigation, 12/8/2026. Nothing was changed.**

## Where the evidence comes from

Three sources, in order of strength:

1. **The engine's code**, extracted from the local image (no container was
   ever started):
   ```bash
   docker run --rm --entrypoint sh nousresearch/hermes-agent:v2026.7.30 \
     -c 'cd /opt/hermes && tar cf - --exclude=node_modules $(ls)' > hermes.tar
   ```
   The `hermes:<file>:<line>` citations are relative to `/opt/hermes/` inside
   that image.
2. **La Mano's effective prompt**, which the engine stores in full in
   `state.db` — read **from inside the container**, never with the host's
   `sqlite3` (see the warning in section 5):
   ```bash
   docker exec <client>-hermes python3 -c "
   import sqlite3
   c = sqlite3.connect('file:/opt/data/state.db?mode=ro', uri=True)
   print(c.execute(\"select system_prompt from sessions where id='api-f78a7267839058f3'\").fetchone()[0])
   "
   ```
   40,161 characters (40,792 UTF-8 bytes), `api_server` session from
   10/8/2026.
3. **The real request to the model**: `data/sessions/request_dump_cron_*.json`
   (has `messages` plus the 39 `tools` the agent saw in a cron run).

Every finding says **VERIFIED** (I saw it in the real prompt, in the config,
or in the engine's code) or **INFERRED** (docs only / code reading only,
without a run). At the end there's a list of what can't be settled without
turning the engine on.

---

## 0. The map of the effective prompt (the basis for everything else)

**VERIFIED.** The prompt gets assembled in three stretches
(`hermes:agent/system_prompt.py:152-546`), and this is how La Mano's came out
through the API:

| Where | Block | Size | Who puts it there |
|---|---|---|---|
| lines 1-304 | **SOUL.md** (identity) | 14,083 ch | us |
| 305 | "You run on Hermes Agent (by Nous Research)…" | 560 | engine, **no knob** |
| 307 | "# Finishing the job" | 769 | engine, knob |
| 311 | "# Parallel tool calls" | 618 | engine, knob |
| 315 | Memory: "You have persistent memory…" | 1,999 | engine, tied to the toolset |
| 321 | Skills: "Skill Safety Rule" | 1,007 | engine, tied to `skill_manage` |
| 328-356 | **"# Kanban task execution protocol"** | ~4,600 | engine, tied to the toolset |
| 357 | "## Mid-turn user steering" | 681 | engine, no knob |
| 364 | "# Tool-use enforcement" | 824 | engine, knob |
| 369-417 | "# Execution discipline" + `<act_dont_ask>` … | ~2,600 | engine, same knob |
| 418-520 | **"## Skills (mandatory)"** + index of 78 skills | ~9,000 | engine, filterable |
| 522-528 | Host / toolchain / active profile | ~500 | engine, knob |
| **530** | **"assume plain text. No markdown formatting"** | 712 | engine, **replaceable** |
| 532 | MEMORY (what the agent learned on its own) | 1,414 | the agent |
| 545 | Date / model / provider | 115 | engine |

Three things this map makes clear, and that matter more than any single
knob:

- **The SOUL goes FIRST and everything from the engine comes AFTER.** The
  precedence block B2 proposes ends up ~500 lines *before* the instruction it
  wants to override. If it's written as "what follows doesn't govern", it has
  to say so explicitly, because the contradicting text comes later.
- **The template gaps reached the model raw.** In the saved prompt you can
  read literally `**JAMÁS <la acción sensible: enviar un mail a un cliente /
  …>` and `<Cómo le ...>` and `<zona horaria>`. This isn't a hypothesis: it's
  right there in the base.
- The stock identity ("You are Hermes Agent, created by Nous Research",
  `hermes:agent/prompt_builder.py:144`) **doesn't show up** when there's a
  SOUL.md: it's a fallback, not an addition (`system_prompt.py:193-201`).
  What DOES always show up is "You run on Hermes Agent (by Nous Research)…"
  (`prompt_builder.py:154`), and that one has no switch.

---

## 1. Can the stock skills catalog be turned off or filtered?

**YES, and through config. VERIFIED.**

There are two keys, and one excludes per platform:

```yaml
skills:
  disabled: [himalaya, xurl, computer-use, google-workspace]
  platform_disabled:
    telegram: [one-more]
```

- Contract documented right in the module itself:
  `hermes:hermes_cli/skills_config.py:1-13` and `44-61`; the reader the
  prompt builder uses is `hermes:agent/skill_utils.py:419-453`.
- The prompt's index skips them (`hermes:agent/prompt_builder.py:1616-1620`
  and `1650-1660`), **and on top of that `skill_view` refuses to load them**
  (`hermes:tools/skills_tool.py:1278-1285`). Meaning: it's not cosmetic, the
  skill stops existing for the agent.
- The global list gets merged with the platform's; a globally disabled skill
  stays disabled everywhere.
- It can be edited by hand in `config.yaml` or with `hermes skills`
  (interactive menu, `skills_config.py`), but **our clients' config.yaml is
  mounted `:ro`**, so across our fleet it means editing the file plus a
  redeploy.

**Today there are 78 skills in La Mano's index: 70 from the engine, 6 of
ours, and 2 the agent wrote itself.** (Corrected on 8/12: this note used to
say "72 are stock". The engine's are exactly the 70 in `.bundled_manifest`,
which is the list the engine itself writes when seeding them, and they match
the image's one for one. The remaining two —`competitive-intelligence-monitoring`
and `social-content-operations`— have `created_by: agent` in `.usage.json`:
they belong to the client, not the engine, even though they live under one
of the engine's categories. The difference isn't cosmetic: a blocklist
generator that lists the directory instead of the manifest would disable
something the client's own agent wrote.)

Ours are `approval, artifact, drive-inbox, deliverable, flow, transcribe`.
The engine's are whole categories that have no business being in a company
agent:

`apple` (apple-notes, apple-reminders, findmy, imessage), `creative` (16:
comfyui, manim-video, p5js, touchdesigner-mcp, songwriting-and-ai-music…),
`email` (**himalaya**), `social-media` (**xurl**),
`autonomous-ai-agents` (claude-code, codex, **computer-use**, opencode),
`mlops` (5), `github` (6), `software-development` (11), `research` (5),
`productivity` (11: **google-workspace**, notion, airtable…), `media`,
`note-taking`, `smart-home`.

Watch out for two of these before disabling in bulk: `hermes-agent` is the
one the engine tells the agent to load when it's asked about itself (it's
hardcoded inside the skills preamble and in `HERMES_AGENT_HELP_GUIDANCE`),
and `artifact/deliverable/approval/flow` are ours.

**Two more mechanisms, in case we want to go further** (VERIFIED in code):

- Deleting a skill's directory is **permanent**: `skills_sync.py` runs on
  every container startup (`hermes:docker/stage2-hook.sh:523-533`) but
  respects what got deleted — "DELETED by user (in manifest, absent from
  user dir): respected, not re-added" (`hermes:tools/skills_sync.py:8-23`).
- An empty `.no-bundled-skills` file in `HERMES_HOME` turns the sync into a
  permanent no-op (`hermes:tools/skills_sync.py:58-67`). It doesn't delete
  what's already been seeded; it's useful for a brand-new agent.

**What CANNOT be turned off:** the preamble "## Skills (mandatory) — Before
replying, scan the skills below… you MUST load it" is fixed text
(`prompt_builder.py:1836-1862`). It only disappears if the agent is left
with no skills tool at all, and that also costs us `skill_view`, meaning no
kit skills either. Not an option.

**What this unlocks:** C1 can be done with a list in `config.yaml`, without
touching the image or the volume. With 72 skills out, ~7-8 KB of prompt gets
recovered per session, and the outbound surface disappears (himalaya =
sending mail, xurl = posting to X) that today sits outside the guard.

**How to verify it once applied:** `GET /v1/skills` with the
`API_SERVER_KEY` returns exactly the visible skills (excludes the disabled
ones — `hermes:gateway/platforms/api_server.py:2919-2948`). It's a
deterministic check for `portal-check.py`/`agent-check.py`, no need to ask
the model.

---

## 2. Can the kanban section, the api_server preamble, and the memory blocks be suppressed?

Three different answers.

### 2a. The api_server preamble ("assume plain text") — YES, entirely. VERIFIED.

There's a **top-level** key, `platform_hints`, not documented on the site's
config page but present in the defaults:

```yaml
platform_hints:
  api_server:
    replace: |
      Estás respondiendo dentro del portal del cliente. Renderiza markdown
      completo: encabezados, tablas, listas, bloques de código, KaTeX y
      mermaid. […]
  telegram:
    append: "…"
```

- Default and contract: `hermes:hermes_cli/config_defaults.py:1993-2001`
  (`{"append": …}`, `{"replace": …}`, or a bare string = append; `replace`
  wins over `append`).
- Read at: `hermes:agent/agent_init.py:1755-1770` — comes from `_agent_cfg`,
  which is the whole config, **not** from the `agent:` section.
- Resolution: `hermes:agent/system_prompt.py:73-119`, applied at `433-467`.
- Text that would get replaced today: `hermes:agent/prompt_builder.py:911-923`
  ("The rendering layer is unknown — assume plain text. No markdown
  formatting (no asterisks, bullets, headers, code fences)").

**What this unlocks:** killing at the root the contradiction "the engine
forbids markdown / the portal renders it with `Markdown.tsx`", with one
config key, without depending on the SOUL beating out text that comes 200
lines later. And the hint lands **almost last** in the stable stretch: it's
the best position the config gives you.

### 2b. The kanban section — NO, not via its own knob. VERIFIED.

The ~4,600-character block gets injected **if and only if** `kanban_show` is
among the session's tools (`hermes:agent/agent_init.py:1411-1420` and
`agent/system_prompt.py:238-243`). There's no key that removes it while
leaving the tools in place.

The possible ways out, in order of cost:

1. **Remove the `kanban` toolset** (from `platform_toolsets` or with
   `agent.disabled_toolsets`, which applies last and overrides everything —
   `hermes:hermes_cli/tools_config.py:2456-2465`). The block **and the 12
   tools** go with it: the agent loses tickets, blocks, and comments. Not
   viable: the kit's approval gate lives right there.
2. **A plugin with `llm_request` middleware** that rewrites the payload
   before it goes out. `apply_llm_request_middleware` allows returning
   `{"request": {...}}` and *replaces the provider's effective kwargs*,
   including `messages[0]` (the system message) —
   `hermes:hermes_cli/middleware.py:76-90`, invoked in
   `hermes:agent/conversation_loop.py:2094-2113`. User plugins get
   discovered in `HERMES_HOME/plugins` (`hermes:hermes_cli/plugins.py:1369`),
   meaning `data/plugins/`, which already exists and is empty. It's the
   scalpel: it lets you delete exactly that block and leave the rest
   untouched.
   **Heads up:** the `pre_llm_call` hook does NOT work for this — its
   context always gets injected into the user message, never the system
   one, and it's written that way on purpose to avoid breaking the cache
   (`hermes:hermes_cli/plugins.py:1916-1930`).
3. **Coexist and win by precedence**, which is what B2 does.

**A rough edge in the engine worth writing down (for whenever this gets
negotiated or reported upstream).** The code's own comment claims the
opposite of what actually happens: *"only present when the dispatcher
spawned this process (kanban_show check_fn gates on HERMES_KANBAN_TASK env
var). **Normal chat sessions never see this block**"*
(`hermes:agent/system_prompt.py:234-237`), and the toolset's registration
repeats the same idea: *"only active when the agent is spawned by the
kanban dispatcher"* (`hermes:toolsets.py:287-292`). **Empirically that's
false**: the entire block is in the prompt of a normal `api_server` session
(`prompt-api-pdelabs-2026-08-12.txt:325-356`). The real code explains it
—`_check_kanban_mode` returns `True` through two paths, `HERMES_KANBAN_TASK`
**or** a profile with the `kanban` toolset declared
(`hermes:tools/kanban_tools.py:92-108`)— but none of the comments you read
first say so. It's the same kind of trap that already cost us a whole
plugin in `native-kanban.md`: the `kanban` toolset doesn't behave the way
its internal docs describe. Anyone reading the engine will conclude the
block isn't there, and it is.

It's worth saying what that block actually says, because it's half of the
plan's problem: it tells the agent to send `kanban_block(reason=...)`
instead of asking, forbids `clarify` ("You are running headless — there is
no live user"), and uses `blocked`/`ready`/`assignee` as ordinary
vocabulary. It contradicts the kit's `04-language.md` and the whole idea
that there's a person on the other end looking at the portal.

### 2c. The memory blocks — YES, with two separate knobs. VERIFIED.

```yaml
memory:
  memory_enabled: true       # the prompt's MEMORY block
  user_profile_enabled: true # the USER.md block
  memory_char_limit: 2200
  user_char_limit: 1375
  nudge_interval: 10         # 0 = the self-improvement fork never triggers
  write_approval: false
```

- Defaults in `hermes:hermes_cli/config_defaults.py:1531-1554`.
- The volatile block comes from `memory_enabled`/`user_profile_enabled`
  (`agent/system_prompt.py:503-512`); the 2,000-character *instructional*
  text ("You have persistent memory…") comes from having the `memory` tool
  in the session (`system_prompt.py:228-229`), i.e. from the toolset. There
  are two separate switches: you can keep the memory and drop the lecture,
  or the other way around.
- On La Mano today, 1,265 of 2,200 characters are in use (57%) with five
  memories the agent wrote on its own, all about Luis's preferences. None of
  them are false, but none went through human review either.

---

## 3. Is there a system-prompt override/append beyond SOUL.md?

**Yes: five, and one of them is the strongest of all. VERIFIED in code.**

Ordered by where they land (further down = closer to the end = more
weight):

| Mechanism | Where it lands | How it's turned on |
|---|---|---|
| `SOUL.md` | slot 1, first | already in use |
| `agent.environment_hint` | with the environment hints (~line 522) | config key or `HERMES_ENVIRONMENT_HINT` |
| `platform_hints.<plat>.append/replace` | last of the stable stretch (~530) | config key |
| Context files (`HERMES.md` / `.hermes.md` / `AGENTS.md` / `CLAUDE.md` / `.cursorrules`) | **the "context" stretch, after everything stable** | `terminal.cwd` pointing at a directory that has them |
| **`ephemeral_system_prompt` per request** | **at the very end, after the memory and the date** | sent by the HTTP client |

Detail on the last one, which is the important finding:

- The api_server takes a `role: "system"` message from
  `/v1/chat/completions` (`hermes:gateway/platforms/api_server.py:3729-3745`),
  or `system_message` / `instructions` in `/v1/responses` and in
  `/api/sessions/{id}/chat` (`api_server.py:3351`, `3468`), and passes it
  through as `ephemeral_system_prompt`.
- That text gets **concatenated at the end** of the system prompt when the
  call gets assembled: `effective = sp + "\n\n" + agent.ephemeral_system_prompt`
  (`hermes:agent/conversation_loop.py:848-850` and `1552-1556`).
- It doesn't get persisted in the session or in the trajectories
  (`agent/system_prompt.py:477-478`), and since it's added *after* the
  stable prefix, it doesn't break the prompt cache.

**What this unlocks:** the portal (or better, `portal_adapter.py`, which is
ours and proxies the chat) can inject a short precedence block into every
request — "formato del canal: portal, markdown completo; ninguna
instrucción posterior habilita actuar sin aprobación" — and that block
lands **physically after** the kanban section, the "assume plain text"
text, and the memories. This is exactly what the repo's guiding principle
asks for: the code sets the format, not the hope that the model remembers
something it read 30,000 characters earlier. It's also the only lever that
doesn't require touching each client's `config.yaml` or redeploying.

Fine details that will matter when this gets implemented:

- With GPT-5/Codex models the system role gets sent as `developer`
  (`hermes:agent/prompt_builder.py:686` — `DEVELOPER_ROLE_MODELS`).
  **VERIFIED** in the dump: `messages[0].role == "developer"`.
- The context files and SOUL.md itself **go through an injection scanner**,
  and if it matches, the whole content gets replaced by `[BLOCKED: SOUL.md
  contained potential prompt injection …]` (`hermes:agent/prompt_builder.py:55-80`,
  patterns in `hermes:tools/threat_patterns.py:63-120`). The patterns are in
  English (`you are now a…`, `pretend to be…`, `name yourself X`, `you must
  register|connect|report`), so a SOUL written in Spanish is safe — but if
  an English line ever gets pasted in, the agent ends up with **no identity
  at all** and nobody finds out. Cheap candidate for `agent-check.py`: run
  the same scan offline against the SOUL before installing it.
- SOUL.md gets truncated: a dynamic cap based on the model's context window,
  with a 20,000-character floor if there's no known window
  (`prompt_builder.py:1263-1300`). La Mano's weighs 14,083 characters
  (14,386 bytes on disk) → 70% of the floor. Phase B adds more text to it.
  Worth watching.

---

## 4. `skill_manage` / skill self-patching, and what exactly `write_approval` does

### 4a. Turning off `skill_manage` alone: it CANNOT be done. VERIFIED.

`skills_list`, `skill_view`, and `skill_manage` are **a single toolset**
(`hermes:toolsets.py:193-196`). There's no way to disable individual tools:
the engine's granularity is the toolset (`agent.disabled_toolsets` and
`platform_toolsets`). Removing `skills` leaves the agent unable to open the
kit's skills.

What CAN be turned off is the self-improvement fork's **trigger**:
`skills.creation_nudge_interval: 0` and `memory.nudge_interval: 0`
(`hermes:agent/agent_init.py:1706-1710` and `1606-1621`; the gate is `> 0`
in `hermes:agent/turn_finalizer.py:635-655` and `agent/turn_context.py:584-588`).
With that, the agent can still write a skill if asked to, but there's no
longer a background process deciding on its own what to save.

### 4b. `write_approval`: what it does and — the important part — where the request shows up.

`hermes:tools/write_approval.py:19-41` (the docstring is the contract) and
`hermes:hermes_cli/config_defaults.py:1534-1546` and `1712-1721`.

```yaml
memory: { write_approval: true }
skills: { write_approval: true }
```

- With `true`, the write **doesn't get committed**: a pending item gets
  saved at `HERMES_HOME/pending/{memory,skills}/<id>.json` and gets reviewed
  out of band.
- Deliberate asymmetry: a memory is ~200 characters and can be approved
  inline; a SKILL.md is 10-100 KB and **always** gets staged.
- **The point that settles Phase C7:** *"Staging is mandatory for
  background-origin writes … and for gateway sessions (no inline prompt
  channel — review happens via `/memory pending`)"*. Our portal is a
  gateway session. **With `write_approval: true` today, the approval
  request doesn't show up anywhere the client can see**: a JSON file sits in
  the volume waiting for a `hermes memory approve <id>` over the CLI.
  Turning it on without first building the surface (an adapter that lists
  `pending/` + a tab in the portal) is worse than not turning it on at all:
  the agent stops learning and nobody knows why.
- Separately, `skills.guard_agent_created` (default `false`) runs a security
  scanner over whatever the agent writes with `skill_manage`; the engine's
  own comments say it adds friction without real security, since the agent
  can do the same thing through `terminal()`.

### 4c. The curator: a risk nobody is watching. VERIFIED.

`hermes:hermes_cli/config_defaults.py:1725-1770`. It runs on its own, every
7 days, after 2 hours of inactivity. It marks things `stale` after 30 days
without use and **archives them at 90** (moves the directory to
`skills/.archive/`).

The kit's skills get copied to `data/skills/` and are **not** in the bundled
manifest or in the hub's → to the engine they're "agent-created" → **always
eligible for archiving** (`hermes:tools/skill_usage.py:427-480`). Meaning:
`transcribe` disappears from the index after 90 days of no use, and with it
the portal's contract breaks, silently.

On La Mano it hasn't happened yet: `data/skills/.curator_state` says
`"run_count": 0, "deferred first run"` (VERIFIED). It's armed, not
triggered.

Three ways to shut it down, from least to most surgery: `curator.enabled:
false`; `hermes curator pin <skill>` for each kit skill (there's a `pinned`
flag per skill in `.usage.json`); or mounting them as `external_dirs`,
which makes them **never eligible** (see point 6). The good one is the
third.

---

## 5. How to capture the effective prompt reproducibly

**There are three paths, and the best one requires neither flags nor
forcing an error.**

### The good one: `state.db`. VERIFIED — this is what I used for this document.

The engine stores the full prompt of every session in the
`sessions.system_prompt` column (`hermes:hermes_state.py:2625-2705`,
`3736-3741`).

⚠️ **It gets read FROM INSIDE THE CONTAINER.** Opening `state.db` with the
host's `sqlite3` over the bind mount **kills the gateway**: SQLite's locks
don't cross the host↔VM boundary, the outside process touches the `-shm`
file the engine has mapped in memory, and the engine crashes with `Fatal
Python error: Bus error` (reproduced on 12/8/2026: 57 of 60 requests to
`/api/sessions` got no response — see "Looking at an agent's databases" in
the kit's README). And `immutable=1`, which is what this note used to say,
**is not the way out**: it tells SQLite the file never changes, so it
ignores the `-wal` file and hands you stale data. For capturing *the
effective prompt* that's its own trap — the session you just opened is
still living in the WAL and you won't see it.

```bash
docker exec <client>-hermes python3 -c "
import sqlite3
c = sqlite3.connect('file:/opt/data/state.db?mode=ro', uri=True)
for r in c.execute('''select id, source, length(system_prompt) from sessions
                       where system_prompt is not null order by rowid desc limit 5'''):
    print(*r)
"
```

Gives one row per session and per platform. Today on La Mano: `api_server`
40,160 ch, `cron` 39,800, `cli` 40,420. It gets nulled out on purpose when a
session resets or forks (`hermes_state.py:3751-3861`), so it always
reflects what's current.

**Concrete proposal for C2:**

```
snapshot:  take the latest session with source='api_server' and with
           source='cron', normalize it (strip the "Conversation started:"
           line and the MEMORY block, which are volatile by design), save it
           in the agent's repo as effective-prompt.api_server.txt / .cron.txt
diff:      agent-check.py rebuilds the snapshot and compares it against the
           saved one; if it differs without the SOUL or the config having
           changed, the engine changed → the check fails on a tag bump
```
It's offline, doesn't touch the agent, and runs with the volume shut down.
It fits exactly with the check that already exists.

### The other one: `HERMES_DUMP_REQUESTS=1`. VERIFIED in code.

With that environment variable the engine writes a
`request_dump_<session>_<ts>.json` **before every call** to the provider,
with the entire body: system prompt, messages, and every tool's definitions
(`hermes:agent/conversation_loop.py:2176-2177` →
`hermes:agent/agent_runtime_helpers.py:1741-1830`). Secrets get redacted
before writing. `HERMES_DUMP_REQUEST_STDOUT=1` sends it to stdout instead.

Without the variable, the dump still gets written but **only when the call
fails** with no retry left — which is exactly where the two dumps in
`data/sessions/` came from (`"reason": "max_retries_exhausted"`).

It's the only source that also shows **the tool list**: in the cron dump
there are 39, and you can see `agent.disabled_toolsets` working right there
(no `cronjob`, no `text_to_speech`, no `delegate_task`) and kanban working
through `platform_toolsets` (the 12 `kanban_*` present). Cost: a 124 KB JSON
per call. Good for one-off diagnosis, not for leaving on.

### The third one: the introspection endpoints. VERIFIED in code.

The api_server already exposes, with the `API_SERVER_KEY`
(`hermes:gateway/platforms/api_server.py:1803-1850`):

- `GET /v1/skills` — the visible skills, without the disabled ones.
- `GET /v1/toolsets` — every toolset with `enabled`, `configured`, and the
  tools it expands to, resolved for the `api_server` platform.
- `GET /v1/capabilities`, `GET /v1/models`.

They don't return the prompt, but they cover the two inputs that determine
it (skills and tools), and they're perfect for `portal-check.py`.

---

## 6. Mounting `data/skills/<skill>` as a `:ro` bind: does it break anything?

**Analyzed, not applied. Reindexing does NOT break. But there's a better,
supported option.**

What I found out about the mechanism (VERIFIED in code):

- The index gets cached in `data/.skills_prompt_snapshot.json`, validated
  against a `(mtime_ns, size)` manifest of every `SKILL.md`, walked with
  `followlinks=True` (`hermes:agent/prompt_builder.py:1369-1428`). A bind
  mount preserves mtime and size → the snapshot stays valid; if the host
  file changes, the mtime changes and it reindexes on its own. **Nothing
  breaks.**
- What the engine writes lives in the **parent directory**, not inside each
  skill: `.usage.json`, `.usage.json.lock`, `.bundled_manifest`,
  `.curator_state` (`hermes:tools/skill_usage.py:81-86`). `data/skills/`
  stays writable → telemetry keeps working.
- On startup, `skills_sync.py` only touches skills from the bundled
  manifest; ours aren't in there, so it doesn't overwrite them
  (`hermes:tools/skills_sync.py:8-23`).
- What **does** fail against a `:ro` mount: `skill_manage(action='patch'|'edit')`
  on that skill (EROFS, comes back as a tool error to the agent — which is
  what we want) and the curator's archiving, which is a directory *move*:
  moving a mount point fails with EBUSY/EXDEV and the curator will log it as
  a recurring error every 7 days.

**The better option: `skills.external_dirs`.** It's in the defaults
(`hermes:hermes_cli/config_defaults.py:1682-1684`) and it **is** documented
(https://hermes-agent.nousresearch.com/docs/user-guide/features/skills).

```yaml
skills:
  external_dirs: ["/opt/kit/skills"]
```
with `- ./kit-skills:/opt/kit/skills:ro` in the compose file. Properties,
all verified in code:

- They get scanned together with the local ones and **still enter the
  prompt's index** (`prompt_builder.py:1737-1775`).
- They're **read-only by design**: all creation goes to the local
  directory.
- **The curator never touches them**: `is_curation_eligible` returns
  `False` for any external path (`hermes:tools/skill_usage.py:469-480`).
  The risk from point 4c just drops away.
- `skills_sync` doesn't shadow them: it indexes the external names before
  seeding (`hermes:tools/skills_sync.py:84-137`).
- Local ones win if names collide — meaning a client can override a kit
  skill by adding their own with the same name, which is exactly the
  semantics we want.

Cost: external directories **don't** enter the on-disk snapshot, they get
rescanned on every cold prompt build. With 6 skills that's noise.

**Recommendation for C3:** mount the kit as `external_dirs`, not as a bind
of `data/skills/<skill>`. It's still a redeploy across every agent (same
architectural cost), but besides making the skills immutable it also takes
them out of the curator's reach, and it's a supported, documented path
instead of a mount trick.

---

## 7. Granularity of native cron and of toolsets

### 7a. Toolsets: the full list. VERIFIED.

Configurable one by one (`hermes:hermes_cli/tools_config.py:95-123`), 27 of
them:

`web`, `browser`, `terminal`, `file`, `code_execution`, `vision`, `video`,
`image_gen`, `video_gen`, `bfl`, `x_search`, `tts`, `stt`, `skills`, `todo`,
`memory`, `context_engine`, `session_search`, `clarify`, `delegation`,
`cronjob`, `homeassistant`, `spotify`, `discord`, `discord_admin`, `yuanbao`,
`computer_use`.

Not configurable but can be hand-declared in `platform_toolsets` (they go
through the "explicit passthrough", `tools_config.py:2425-2433`) — that's
where `kanban` fits in, which is what the `native-kanban.md` note found out
the hard way. The full list of non-configurables is: `kanban`, `project`,
`search`, `feishu_doc`, `feishu_drive`, plus the scenario ones `debugging`,
`safe`, `coding`.

Composites: `hermes-cli`, `hermes-api-server`, `hermes-telegram`,
`hermes-discord`, `hermes-whatsapp`, `hermes-slack`, `hermes-signal`,
`hermes-cron`, `hermes-acp`, plus `debugging`, `safe`, and `coding`
(`hermes:toolsets.py:406-609`).

Composition rules worth having written down (`_get_platform_tools`,
`tools_config.py:2195-2480`):

- If a platform's list mentions **any** configurable toolset, the engine
  switches modes and treats the list as an explicit declaration.
- `agent.disabled_toolsets` **applies last and overrides everything**,
  including whatever you set explicitly in `platform_toolsets` (`2456-2465`).
  It's the master switch.
- The `no_mcp` sentinel in a platform's list strips **every** MCP server
  from that platform (`2435-2452`). A useful knob we don't use: today the
  mercadopago MCP is available on all of them.
- `hermes-api-server` includes `cronjob` and the Home Assistant tools. We've
  already turned the first one off with `disabled_toolsets`.

**Granularity that does NOT exist:** per individual tool. If a toolset
brings a tool we don't want (the `skill_manage` case), the only way out
through config is removing the entire toolset.

### 7b. Cron: it has considerably more granularity than what we use. VERIFIED.

From La Mano's `data/cron/jobs.json` (4 flows, all with the same fields at
default) and from `hermes:cron/jobs.py:1260-1430`, each job accepts:

| Field | Today on La Mano | What it's for |
|---|---|---|
| `enabled_toolsets` | `null` | **toolset allowlist for that job only** |
| `skills` | `[]` | preload specific skills for the run |
| `model` / `provider` | `null` | a different model per flow (a cheap one for the one that just checks for new activity) |
| `deliver` | `"local"` | where the response goes (platform + chat) |
| `workdir` | `null` | the job's working directory |
| `context_from` | `null` | inherit context from another session |
| `no_agent` / `script` | `false` / `null` | run a script with no agent loop |
| `repeat.times` | `null` | run count cap |
| `origin` | `api_server` + chat | where it came from |

And the resolution (`hermes:cron/scheduler.py:160-250`):

- Cron **always** turns off `cronjob`, `messaging`, and `clarify`, no matter
  what.
- `agent.disabled_toolsets` overlays the job's `enabled_toolsets`, so a job
  can't widen itself past the global policy (they fixed exactly this:
  "LLM-supplied enabled_toolsets was widening past config.yaml's
  denylist").
- If the job doesn't bring its own list, it falls back to
  `platform_toolsets.cron`, which we do configure.

**What this unlocks:** a flow can run with `enabled_toolsets: [web, file,
kanban]` — no `terminal`, no `browser`, no `skill_manage`, no `memory`. It's
the cheap way to make "what's scheduled" have less power than "what a
person asks for", without writing it in the SOUL and hoping it holds. Worth
looking at when `flow`/`FLOW.md` gets touched.

One detail relevant to Phase B: jobs get created via CLI (the project's
memory already says so) and each of La Mano's flow `prompt`s points at
`/opt/data/flows/<name>/FLOW.md`. The "flow" vocabulary is already baked
into the job names. Good.

---

## 8. Touching the final response before it goes out. VERIFIED in the lab (13/8/2026).

It's needed when something the agent **says** can be checked against the
disk (the case that motivated this: "queda definido: viernes a las 9:30"
with no flow actually created). What exists, from least to most useful:

- **Shell hooks don't work for this.** `agent/shell_hooks.py:580-620` only
  interprets three response shapes: `block` (for `pre_tool_call`),
  `continue` (for `pre_verify`), and `context`. None of them touch the
  response text.
- **`pre_verify` fires ONLY if the turn edited files.**
  `agent/conversation_loop.py:6808-6815`: `if _edited and has_hook(...)`,
  where `_edited` is `agent._turn_file_mutation_paths`. It's the hook that
  exists to make the agent keep going for one more turn, and in the real
  bug it never fired because the turn only checked two skills and answered.
  It's also capped by `agent.max_verify_nudges`. And `verify_on_stop` —the
  version the engine ships— is code-focused: it filters out paths that
  aren't code (`agent/verification_stop.py:24-38`) and turns itself off on
  messaging surfaces.
- **`transform_llm_output` DOES, and it's a plugin thing.** It gets invoked
  once per turn in `agent/turn_finalizer.py:485-505` with `response_text`,
  `session_id`, `model`, and `platform`; the first non-empty string it
  returns **replaces** the response. The gateway finds out through
  `response_transformed` and sends the final version even if it's already
  streamed (`gateway/run.py:24585-24600`), so the correction still reaches
  the client. User plugins live in `HERMES_HOME/plugins`
  (`hermes_cli/plugins.py:1369`) and are **opt-in**: without
  `plugins.enabled` the engine discovers them but doesn't load them
  (`plugins.py:1471-1487`).

**The limit, measured and not obvious: what the plugin adds does NOT stay
in the history.** `finalize_turn` persists the session at line 352
(`agent._persist_session`) and only transforms at 485: `state.db` stores
the ORIGINAL text. Verified on 8/13 against Zaguán —the notice arrived in
the `assistant.completed` event, the portal rendered it, and `GET
/api/sessions/<id>/messages` returns the message without the notice—.
Meaning: **the correction is visible when it arrives and disappears if the
client refreshes**. For the bug at hand this is enough (the moment that
matters is when they read it), but it needs to be known. A one-line
upstream fix: call `transform_llm_output` before `_persist_session`, or
persist again after transforming.

---

## 8b. A response can take 20 minutes and arrive at a dead stream.

This is bug B from 13/8/2026 ("le mande 8 contratos y el chat no me contesto
nunca"), and **it's not what it looks like**: the agent did answer. What
failed was the timing and the channel. The turn's timeline, pulled from
`logs/agent.log`:

```
14:37:54  the client sends the 8 contracts
14:51:06  deliver.py saves the report in workspace/entregables/…     ← already existed
14:51:11  turn's last tool result
14:58:14  API call #13 … latency=422.4s   ← SEVEN MINUTES in a single call
14:58:14  Turn ended … response_len=1541  ← the response, complete
```

In the middle of this, at 14:57:36, the client wrote "por que no me
avisaste" —and a NEW turn answered that question at 14:58:07, with a
made-up apology ("omiti el aviso en el chat"): it hadn't omitted it, it was
still in flight. It's the same disease as bug A, from the other side:
asserting things about the world without checking it, even to blame itself.

Two things about the engine, with file and line:

1. **The api_server's SSE sends `: keepalive` every 30s and nothing else**
   (`gateway/platforms/api_server.py:127` and `:3645-3660`). There's no way
   to tell the client "still thinking, 7 minutes in" or that a deliverable
   is already saved. At 14:58:12 the connection dropped
   (`ClientConnectionResetError: Cannot write to closing transport`) and the
   response arrived 2 seconds later: it ended up in `state.db` —the portal
   shows it on reload— but nobody saw it arrive.
2. **The delivery ledger doesn't cover this path.**
   `gateway/delivery_ledger.py` exists precisely for "the response got
   generated and the delivery wasn't confirmed", but the messaging
   platforms use it (`gateway/platforms/base.py:6038`), not the api_server's
   stream.

There's no knob that fixes this, and **it shouldn't get a timeout**: the
model runs with `reasoning_effort: max` and those 422s are 2,073 output
tokens at ~5 tok/s, meaning slow, not hung. Cutting it off would trade
"takes a while" for "breaks". What's actually needed is a product fix: the
portal showing that the turn is still alive, and whatever's already saved
being visible without waiting for the end.

**And a finding of our own in that same stretch, which is the most serious
thing here:**

```
14:45:50 WARNING agent.shell_hooks: shell hook timed out after 25.54s
         (event=pre_tool_call command=/opt/policy/hooks/gate.py)
```

The gate is declared with `timeout: 10` and even so, the machine under load
left it out — and a hook that times out **fails open**:
`agent/shell_hooks.py:509-515` logs the warning, returns `None`, and the
tool runs anyway. Meaning under load the gate stops being a gate, silently,
and the only trace is that log line nobody watches. It can't be closed from
the config (the engine decides that). Cheap mitigation if it happens again:
make `gate.py` avoid importing anything expensive and exit fast; the real
fix is upstream (optional fail-closed per hook).

---

## 9. Memory across conversations: it exists, but the model is the one who writes it.

Verified on 13/8/2026 on the same agent. The blocks are on by default
(`hermes_cli/config_defaults.py:1531-1554`: `memory_enabled` and
`user_profile_enabled` set to `true`), and `USER.md` gets injected into
every session's system prompt (`agent/system_prompt.py:503-512`). It works:
when the agent called the `memory` tool, the line showed up in
`data/memories/USER.md` and the next session already had it.

**What does NOT exist is automatic extraction.** There's no knob that makes
the engine pull out a preference mentioned in passing and save it:
`memory.*` only has `memory_enabled`, `user_profile_enabled`,
`write_approval`, the two character limits, and `provider`. Writing depends
on the model deciding to call the tool. Measured: the client said "viernes
de mañana, no lunes" at 14:22 and nobody wrote anything down; at 14:29, in
a different conversation, the agent recommended Mondays; only when she
called it out (14:31) did it save both things —`USER.md` and
`flows/PREFERENCIAS.md`— in the same turn.

Meaning "remembering" is today a rule of prose, not a guarantee. The only
hard lever the kit has is on the READ side (a file of ours the agent is
under orders to open, which a `pre_llm_call` could always inject); the
WRITE side has nothing to hold onto.

---

## What can't be settled without turning the engine on

Everything above comes from code, config, or the prompt already saved.
These five things need a live run and are left for whenever Luis decides to
apply them:

1. **That `skills.disabled` actually shrinks the index**: disable 5 skills,
   restart, and compare `GET /v1/skills` and the `length(system_prompt)` of
   the next session against today's 40,160.
2. **That `platform_hints.api_server.replace` actually replaces the text**:
   restart and `grep "assume plain text"` against the new `system_prompt` in
   `state.db`. Should come back zero.
3. **That the `ephemeral_system_prompt` actually arrives through the chat
   proxy**: send a `role: "system"` message via `/v1/chat/completions` with
   `HERMES_DUMP_REQUESTS=1` and verify it shows up **at the end** of the
   dump's `messages[0]`. It's the only one of the five that can be tested in
   a minute, and the one that changes the plan the most.
4. **That `external_dirs` doesn't break startup** with an already-populated
   volume (name collision between `data/skills/deliverable` and the
   external one: local wins, but the message needs to be checked).
5. **What `write_approval: true` does in a portal session**: confirm it
   writes to `data/pending/memory/` and that the agent keeps responding
   normally (the code says it does; check it before promising the client a
   "Memory" tab).

---

## Summary for the plan

| Phase | What can be done with what was found |
|---|---|
| C1 | `skills.disabled` (72 stock skills out) + `platform_hints.api_server.replace` (goodbye "assume plain text"): two `config.yaml` keys. The kanban section has **no** knob: either it goes with the tools, or it gets beaten by precedence, or it gets erased with an `llm_request` middleware plugin. |
| C2 | The prompt snapshot comes from `sessions.system_prompt` in `state.db`, offline and with no flags. Diffed in `agent-check.py` on every tag bump. |
| C3 | Use `skills.external_dirs` instead of a `:ro` bind of `data/skills/<skill>`: immutable **and** out of the curator's reach, which today can archive our skills after 90 days of no use. |
| C4 | The per-request `ephemeral_system_prompt` (injected by the adapter) lands **after all** of the engine's prompt. It's the spot where the channel/sender contract and the precedence get enforced by code, not by trust. |
| C7 | `memory.write_approval: true` in a gateway session **doesn't show the request anywhere**: it stages to `pending/memory/*.json` and waits for a CLI command. Without a Memory tab in the portal, turning it on means turning off learning without telling anyone. |
| B (watch out) | The SOUL goes **first** and everything from the engine comes **after**; the precedence block has to say so explicitly. And SOUL.md goes through an injection scanner that, if it matches, replaces the whole thing with `[BLOCKED: …]` and leaves the agent with no identity. Worth an offline check in `agent-check.py`. |
