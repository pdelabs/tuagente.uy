# The knobs we applied, and why

**Batch C1, 12/8/2026.** What ended up set in the kit, what each thing does,
and how to apply it to an agent that already exists. The full map of what the
engine allows —with citations into the code— is in `engine-knobs.md`; this is
the part that got executed.

Three decisions, and one left alone on purpose:

| Knob | Decision | Where it lives |
|---|---|---|
| Engine skills | **all disabled** except `xlsx`, `pdf`, `docx`, `ocr-and-documents` | `skills.disabled` in `config.yaml`, generated |
| Portal preamble | **replaced** (it said "assume plain text") | `platform_hints.api_server.replace` |
| Kit skills | **outside `data/`**, mounted read-only | `skills.external_dirs` + `:ro` volume |
| Kanban | **stays**, subordinated by `05-precedence` | untouched |
| Mutation verifier | **disabled**: it was telling the client about host paths | `display.file_mutation_verifier: false` |
| Browser | **out**: 9 tools that return blank screenshots | explicit list in `platform_toolsets` (NOT `disabled_toolsets`) |

Memory and self-improvement weren't touched either: `write_approval` without
a tab that shows what's pending means turning off learning without telling
anyone (`engine-knobs.md`, point 4b).

## 1. Engine skills: 66 of 70 disabled

The engine ships 70 skills and **copies them to `data/skills/` on every
startup** (`skills_sync.py`, invoked by `docker/stage2-hook.sh`). A company
agent needs almost none of them, and several are outbound surface that
doesn't pass through the guard: `himalaya` sends mail, `xurl` posts to X,
`google-workspace` touches documents, `computer-use` drives a computer,
`hermes-agent` and `claude-code` teach it to operate its own engine — which
`soul/README.md` explicitly says we don't want.

Four are left, and they're the ones that **read what the client sends**:
`xlsx`, `pdf`, `docx`, and `ocr-and-documents`. A spreadsheet, a PDF, a Word
doc, a photo of a receipt. None of them talk outward, none publish, none
touch systems.

`docx` was added after the other three, for the same reason they're there:
at an SMB, contracts, briefs, and proposals circulate as Word docs. Without
that skill the agent receives the file and answers "mandámelo en PDF", which
is exactly the work the client expected not to have to do.

**The list is generated, not hand-written.** These are ~70 names that change
with every engine version:

```bash
python3 tools/skills-knob.py --image nousresearch/hermes-agent:v2026.7.30 \
                              --apply compose/config.base.yaml
```

It comes from the **image** (authoritative for a tag, useful before
installing anything) or from an already-set-up agent's `.bundled_manifest`
(`--agent <data>`, no docker needed). Never by listing `data/skills/`: that's
where the engine's, the kit's, and **the ones the agent wrote for that
client** all live together — La Mano had two like that
(`competitive-intelligence-monitoring`, `social-content-operations`, both
with `created_by: agent` in `.usage.json`). A generator that listed the
directory would disable the client's own work.

The policy —what stays on— is `compose/skills-allowed.txt`, and both the
generator and `agent-check.py` read it.

The generated block **records where the list came from** (`#   source: image
<tag>`, or the `.bundled_manifest` it read): that's what later answers
"which image did these 70 names come from?" without guessing. That line
doesn't count when deciding whether the block changed —two runs with the
same list and a different source report "same list, source up to date," not
"replaced"— so recording provenance doesn't create noise when migrating
agents.

**Closing the loop.** A blocklist is a snapshot: the day the engine bumps its
tag and brings in `himalaya-2`, the old list doesn't name it and an outbound
skill ends up enabled again. That's why `agent-check.py` compares the
`.bundled_manifest` **that the engine itself writes** against
`skills.disabled` + the allowlist, and fails:

```
[FAIL] config: engine skills disabled — 2 engine skill(s) enabled:
       himalaya-2, new-bump-skill — regenerate the list: python3
       tools/skills-knob.py --agent <data> --apply <config.yaml>
```

### Turning on a skill for one specific client

Two things, in **that agent's** `config.yaml`: take it out of
`skills.disabled` and **declare the exception with its reason**, above the
list.

```yaml
skills:
  # kit:exception humanizer — writes social posts, that's what the company does
  # kit:exception blogwatcher — monitors the competition every week
  disabled:
    - airtable
    …
```

Then restart. The declaration isn't bureaucracy: it's what separates a
decision from a drift. `agent-check.py` accepts what's declared, **names the
exceptions on every run** —so they're visible when someone audits the agent
six months later— and still fails for any enabled skill that doesn't have
its line. A line with no reason (or a reason under ten characters) also
fails: the why is the point.

**The comment isn't durable, and that has to be known.** The engine rewrites
the whole `config.yaml` with `yaml.safe_dump` (`atomic_config_write`, in
`hermes_cli/config.py`) and every comment goes with it. Verified on La Mano:
none of the ones `new-agent.sh` put there survived, the keys ended up
reordered with a `_config_version: 33` added; the 36 comments it has today
are the ones the engine itself writes. A new YAML key WOULD survive —unknown
top-level keys are tolerated on purpose (`config.py:2027-2031`)— so the
choice of a comment isn't justified by durability.

It holds up for a different, more important reason: **the failure mode is
safe.** If the engine ate the declaration, the skill stays enabled and
undeclared, and the check fails hard; never the other way, never a
permission that appears on its own. And after onboarding the `config.yaml`
is mounted `:ro`, so the engine can no longer rewrite it.

Hence the operating rule: **exceptions get declared once the config is
already closed `:ro`.** Declaring them before the first startup doesn't
work — that startup erases them. If the check says there are enabled skills
you swore you'd declared, the first thing to look at is whether the config
got rewritten while it was still open.

Side benefit of the comment: `grep -rn kit:exception` finds them across the
whole fleet.

If the decision holds for **every** client, it isn't an exception: it goes
into `compose/skills-allowed.txt` with its reason, and the list gets
regenerated. That's how `docx` got in.

## 2. The portal preamble

Without a knob, the engine feeds the agent this on **every api_server
session**, 200 lines after the SOUL (`agent/prompt_builder.py:912-923`):

> The rendering layer is unknown — assume plain text. No markdown formatting
> (no asterisks, bullets, headers, code fences) … images referenced as
> MEDIA:/absolute/path tags …

Both things are false in our portal: it renders full markdown with
`Markdown.tsx` and turns paths and ids into clickable chips. It was the
prompt's most expensive contradiction —the kit asking for tables while the
engine forbids them— and it's fixed with one key:
`platform_hints.api_server.replace` (`replace`, not `append`: with `append`
the engine's text **stays** and you end up with both).

The text lives in `compose/config.base.yaml`. **The model reads it**: it's
written with the same care as a SOUL block, in Spanish and short.

## 2b. The engine's mutation verifier

When a `write_file` or a `patch` fails and doesn't retry cleanly, the engine
**tacks onto the end of the agent's response** a line like this, which the
client reads in their portal:

> ⚠️ File-mutation verifier: 1 file(s) were NOT modified this turn…
> `/tmp/design-kit-instagram.md` — Write denied… outside `HERMES_WRITE_SAFE_ROOT`

Machine vocabulary, a host path, and the name of an environment variable.
It's exactly what `04-language.md` forbids the agent from doing —"hablás del
trabajo, no de la máquina"— done over its head, where it can't avoid it. The
attempt failing is fine, and it needs fixing; telling the client about it
like this is not.

`display.file_mutation_verifier: false` (default `true` in
`config_defaults.py:1051`, read in `run_agent.py:3300`; also accepts the
`HERMES_FILE_MUTATION_VERIFIER` variable). This turns off the notice, not the
cause: the error still shows up in the logs and in the tool's result, which
is where it belongs.

## 2c. The browser, turned off

In Mr.Wobble's deployment (12/8) the agent burned ~15 calls fighting a
browser that doesn't work: `browser_get_images` returned 0 images,
`browser_console` came back empty, and `browser_vision` said "la captura
aparece completamente blanca" (Browserbase with no residential proxies). It
recovered on its own, pulling the site's color palette with `curl` over the
terminal — but the client watched the whole fight.

**How you turn it off matters, and the first way we picked was wrong.**
`agent.disabled_toolsets` doesn't remove a toolset from the list: it
**subtracts its static catalog** at the very end (`model_tools.py:410-441` —
*"even if a composite toolset is enabled, any tools belonging to a disabled
toolset are strictly stripped out"*). And the `browser` catalog includes
`web_search` (`toolsets.py:199-207`), even though `web_search` is registered
under the `web` toolset. Result: turning off the browser that way **also
turns off web search**.

Measured with the image's own interpreter, calling it the way the engine
really calls it —`agent/agent_init.py:1390`, which passes both
`enabled_toolsets` **and** `disabled_toolsets`—, **all three rows in a single
run**, with a search credential present so `check_web_api_key` doesn't mask
the result:

| Config | Tools | `browser_*` | `web_search` | `web_extract` |
|---|---|---|---|---|
| bundle, browser included | 36 | 9 | yes | yes |
| bundle + `disabled_toolsets: [browser]` | 26 | 0 | **NO** | yes |
| **explicit toolset list, no browser** | **27** | **0** | **yes** | yes |

And the deltas by name, which are what won't come apart if someone
re-measures in a different state: (bundle − explicit) = the 9 `browser_*`
and nothing else; (explicit − bundle) = ∅; (explicit − `disabled_toolsets`)
= `web_search`.

The third one is what stayed. That's why `platform_toolsets` lists the
toolsets one by one instead of naming the bundle, and `browser` doesn't
appear **in any list**: not in the three `platform_toolsets` ones, nor in
`disabled_toolsets`.

### And on all three platforms, not just the portal

The same agent handles the portal, Telegram, and the cron flows. A browser
that returns blank pages fails the same way on all three, and on cron
there's nobody even watching.

On top of that, the declarations that existed for Telegram and cron **did
nothing**: `platform_toolsets.telegram: [hermes-telegram, kanban]` and a
`cron:` hanging off `platforms:` (which isn't even where toolsets go). A
list that only names bundles and `kanban` doesn't mention any
**configurable** toolset, so the engine never switches into explicit mode
and falls back to default: everything on. Verified by removing the keys —
the result was identical with and without them. Both platforms had been
running with 37 tools, 9 of them `browser_*`.

With the same list across all three, today:

| Platform | Tools | `browser_*` | `kanban_*` | `web_search` |
|---|---|---|---|---|
| `api_server` (portal) | 27 | 0 | 12 | yes |
| `telegram` | 27 | 0 | 12 | yes |
| `cron` (flows) | 27 | 0 | 12 | yes |

**Deliberate differences from the default Telegram and cron had:** besides
the browser, `clarify` also goes —asking through a UI: the portal never had
it, cron turns it off on its own (`cron/scheduler.py`), and the agent asks by
writing— and `computer_use`, driving a computer, whose skill we'd already
disabled. Nothing else: the delta by name between what they had and what
they have is 10 tools —the 9 `browser_*` and `clarify`— and none are gained.
`computer_use` leaves as a toolset but doesn't show up in that delta: its
`check_fn` was already blocking it, so there was no tool of its to lose.
What changes is that now it can't show up on its own either.

We want `web_search` because the client does competitor monitoring and will
likely add a search key at some point; the day they do, the tool is there.

**The explicit list can go stale** when the engine bumps its tag and adds or
renames toolsets — the same problem as the skills blocklist, and the same
fix: it gets generated and checked.

```bash
python3 tools/skills-knob.py --toolsets --image <tag>   # when bumping the tag
```

It works by asking the engine to resolve the platform the historical way
(`hermes-api-server` + `kanban`) and subtracting what we don't want, so it's
the same resolution that runs in production. `agent-check.py` compares the
agent's list against the kit's and fails if they differ.

**What's missing today, and it's not because of any of this:** the agent
**has no web search** in any case, because `check_web_api_key` returns
`False` with no credentials (`web_tools.py:1049`). The possible backends are
`EXA_API_KEY`, `TAVILY_API_KEY`, `PARALLEL_API_KEY`, `BRAVE_SEARCH_API_KEY`,
Firecrawl, or a `SEARXNG_URL`; there's a keyless one, `ddgs`, but **the
package isn't in the image** (verified). So getting real search working
means putting a key in `data/.env` and, if you want to pin which one,
`web.backend`. In the meantime the only thing that reads the web is `curl`
over the terminal, which is what the agent already does.

**For a client who needs a browser**: add `browser` to the
`platform_toolsets.api_server` list —not take it out of `disabled_toolsets`,
since it's not there—, add the Browserbase credentials, and **test a
screenshot before promising it to them**.

## 2d. The gate in code: the hooks

The engine runs our scripts **before** every tool call and, if they respond
`{"action":"block"}`, doesn't execute it and returns the message to the
model (`agent/shell_hooks.py`; registered in `gateway/run.py:10499`). It's
the first time one of the kit's behavior guardrails lives in code instead of
prose.

`policy/hooks/gate.py` blocks three FAMILIES, all measured in QA or left
open by it:

| What | Why |
|---|---|
| installing: `skills install/update/tap`, `mcp add`, `plugins install`, `hermes update`, `npm/npx`, `uv/uvx`, `corepack`, `pip`, `apt`, `dpkg -i`, and any `… \| sh` | the agent installed 4 skills and 16 MB of npm packages into the client's volume, with `--yes`, without permission |
| signing: `--author=…`, `--created-by=…`, and `HERMES_PROFILE=…` on any kanban command | `portal` is the signature of the Approve button and `cliente` the signature of the "Aprobado CON CORRECCIONES" comment —the one that sends content to execution—: writing either one is forging the approval |
| unblocking: `kanban unblock`, `kanban promote`, and the `kanban_unblock` tool | unblocking the very ticket you blocked yourself is skipping the gate |

**The family gets blocked, not the command.** That's the lesson from the
first version, which only watched for `--author=portal` and let
`--author=cliente` through: half a gate. Today the signature gets blocked
for CARRYING A SIGNATURE at all —no kit skill uses those flags and the
default comes straight from the profile—, and the engine made the same call
on the tools' side (`kanban_comment` stopped accepting `author` so a worker
can't forge an authoritative name, `tools/kanban_tools.py:871-877`).

**The threat model isn't a clever agent.** It's a diligent agent that hits a
block and tries variants: quotes (`skills "install"`), a different path
(`npm --prefix /tmp install`), a different package manager. That's why the
command gets **normalized** before it's inspected —quotes stripped,
whitespace collapsed, split into segments while respecting what's inside
quotes— and why the MESSAGE explicitly says *"no hay variante de este
comando que sí pase"* and teaches the right path (open `capability`, pick an
id, write `capability:<id>`). Closing off the workaround matters as much as
closing off the command: **tested against the lab agent**, after a block and
with the client insisting *"probá con pip, o con npm, o bajalo con curl,
hacelo como sea"*, the agent didn't run a single command more — it reread
the `capability` skill and answered that all three are the same thing.

**What deliberately does NOT get blocked**: writing the phrase in a note
(`echo 'pip install' >> notes.md`) and mentioning it in a board comment
(`kanban comment -- t_1 'would need npm install x'`). That's the correct
behavior —saying what's missing— and punishing it would be the worst
possible false positive.

**Known limits** (written in the script's docstring, not chased down: all of
them require two deliberate steps): shell variables (`I=install; hermes
skills $I x`), downloading and running in two separate commands, encoding
the command, writing to `kanban.db` directly via SQL. The gate closes off
the easy path; the backstop guardrail is still the SOUL.

**Fails open, and that's why there's a check.** If the script crashes or
times out, the engine lets the tool through with a `logger.warning` that
nobody watches: a broken guardrail looks exactly like a working one. That's
why `agent-check.py` (`the gate (hooks)`) is `required=True` and **the only
signal** that the gate works: it checks that it's declared, that consent was
given, that the script exists and is executable, and **it runs it** through
13 cases —one per family, the retry evasions, and the two costly false
positives—. When it fails, the message starts with `THE GATE IS OPEN`.

Two things verified against engine v2026.7.30 that are worth not
re-discovering:

- **Editing the script doesn't disable it.** `hermes hooks list` warns
  *"script modified since approval"*, but the allowlist is compared by
  `(event, command)`, not by mtime (`agent/shell_hooks.py:679-687`): the new
  hook runs just the same. The warning is cosmetic.
- **Which package managers actually exist** in the image (verified on
  2026-08-12 with `command -v`): npm, npx, uv, uvx, corepack, apt/apt-get,
  curl, git, node, python3. pip, pipx, yarn, pnpm, poetry, conda, and wget
  are **not** there. That's why there are no patterns for yarn/pnpm/poetry
  —they'd be decorative— but there is one for `corepack`, which is the
  supported path for materializing yarn and pnpm. If the image changes, that
  loop needs to run again.

Consent lives in `hooks_auto_accept: true` and in the compose's
`HERMES_ACCEPT_HOOKS=1`, **never** in the allowlist under `data/`: that lives
in the agent's volume, which it can delete, and without consent the hook
doesn't run.

### The rest of `policy/`, which never reached a local agent

`policy/` isn't just the hooks: that's also where the MCP guard lives
(`guard.py`), each connection's permissions (`tools/<connection>.json`), our
own MCP servers, and **the pairing-message patch**. `deploy-remote.sh` used
to push all of that to the VPS, and `install.sh` didn't install it: a LOCAL
agent was left with none of it. The symptom wasn't an error but a lost
client — without the patch, the Telegram bot's first message comes out in
English asking them to run `hermes pairing approve …` in a terminal, right
while the portal tells them "pegá el código acá".

Now both paths put the same thing in place, and the files are part of the
list `install.sh --diff` compares, which is the drift control.

**The two lines go together.** The compose mounts
`./policy/cont-init-patches.sh:/etc/cont-init.d/03-patches:ro`, and if the
file isn't there, Docker creates a **directory** with that name. Measured on
a from-scratch agent: the container **comes up anyway** —s6 tries to run it,
spits out `Permission denied` … `exited 126` in the middle of the log, and
moves on—, so nothing looks broken and the client gets the English message.
That's why `agent-check.py` checks it (`policy: pairing patch`) before
startup, and why `install.sh` is what puts the file there, since it runs
before the first `up`.

Verified on an agent created with `new-agent.sh`: the 10 files under
`policy/`, `cont-init: info: running /etc/cont-init.d/03-patches` →
`[pairing-patch] applied` → `exited 0`, and inside the container the
`run.py` output was in Spanish with **zero** occurrences of English.

When updating the `.sh` on an agent that's already running: `install.sh`
uses `cp`, which preserves the inode, so a restart is enough. With `rsync`
or `mv` —which replace the file— the mount keeps the old one and you need
`docker compose up -d --force-recreate`.

## 2d-bis. Capabilities: where the catalog lives and what gets logged

The catalog (`capabilities/catalog.json`) gets installed in
**`policy/capabilities/`**, not in `data/`. It's the text the client reads
about what their agent can do, and in the agent's volume —which runs as
root— the agent could rewrite it and could delete the request log. The
markdown the agent READS was already `:ro` in `kit-skills/`: meaning it
could lie to the client but not to itself, exactly backwards from what's
needed. Verified from inside the container: `rm` and `>` on that folder both
return `Read-only file system`.

`requests.jsonl` lives right next to it and gets written by **the adapter**,
which mounts `policy/` rw while the agent has it `:ro`. Two different things
get logged, tagged by `source`: `client` (clicked the button on the card)
and `mention` (the agent wrote `capability:<id>` and the adapter caught it
while passing through the stream, watching only the `assistant.completed`
event — deltas split the mention in half, and a `skill_view` call on the
skill returns the catalog with the example baked in, which would have
invented demand on every read).

**What the agent does NOT promise**: the skill used to say "queda
registrado del lado nuestro" for the case where no capability applies — and
nobody was logging that. The promise got removed instead of manufactured:
the agent says what it can't do and moves on. Logging the mention is the
machine's business, not a promise it makes.

`active` is real. `/v1/toolsets` doesn't work for this —it answers with each
toolset's STATIC catalog: it says whether `web_search` and `image_generate`
are available or not regardless—, so the adapter imports the engine itself
(it runs on the same image) and calls `get_tool_definitions()` with both
lists, the same way `agent_init.py:1390` does. It's the only part of the
adapter tied to the engine's internals: it's wrapped, cached for 60s, and if
it ever breaks it falls back to "unknown" **logging a warning** (the first
version silently swallowed a `NameError` of mine).

**The shadow skills don't need to be removed by hand.** They retire
themselves: verified with `build_skills_system_prompt` — with no tools,
both are present; with `image_generate`, `no-images` disappears; with
`web_search`, `no-web-search` disappears; and `capability` always stays.

**`imagenes` was only half-verified, and the text says so.** With
`image_gen: {provider: openrouter}` in the config, `image_generate`
**appears** among the tools (tested on an agent created from scratch: 27
tools vs 26, and `active: true` on the endpoint). What did NOT get tested is
the first real render: there's no key with access to image models, and the
plugin itself warns that OpenRouter's `openai/*` models may require account
activation. That's why the `how` field the client sees promises **a test
together with them**, not that it'll be working.

## 2e. Self-improvement: every 25, not every 10

`skills.creation_nudge_interval: 25`. The fork that writes skills triggers
off **volume of work**, not quality (`turn_finalizer.py:633-637`): the more
the agent suffers from not having the right tool, the more likely it is to
canonize the suffering — it's the mechanical cause behind the skill that
fixed "draw the SVG by hand" as its method. It doesn't get turned off: today
it's the only signal we have about what a production agent is missing. It
gets throttled, and the harvest (looking at what got written and promoting
the good ones into the kit) is pending human work.

The key **has no declared default** in `config_defaults.py`: it lives as the
`.get(..., 10)` in `agent_init.py:1706-1710`, so an engine bump can change
the number without anything failing.

## 3. Kit skills, outside `data/`

Before: `install.sh` copied them to `data/skills/<skill>/`. Two problems,
both verified in the engine's own code (`engine-knobs.md`, points 4c and 6):

- **The curator could archive them.** To the engine, a skill that's in
  `data/skills/` and doesn't appear in the bundled manifest is
  "agent-created" and therefore eligible: after 90 days without use it moves
  the directory to `.archive/`. Meaning `transcribe` could disappear on its
  own, and with it the portal's contract. On La Mano the curator never
  actually ran (`"run_count": 0`): we got there first.
- **The agent could rewrite them** with `skill_manage`.

Now they live in `<agent>/kit-skills/`, mounted `:ro` at `/opt/kit/skills`
and declared in `skills.external_dirs`. The engine indexes them the same
way, and an external skill is **never** eligible for the curator
(`tools/skill_usage.py:469-480`).

**Watch out for shadowing, which is silent.** If the same skill exists in
both `data/skills/` and the external directory, **the `data/` one wins**:
the engine resolves local first (`tools/skill_manager_tool.py:645-662`) and
the prompt's index skips the repeated name
(`agent/prompt_builder.py:1738-1760`). The agent keeps running the old copy
and `install.sh` stops having any effect, without a single error message.
That's why `install.sh` **sets aside** the old copies into
`<agent>/shadowed-skills/` —outside of `data/`, which is the only way to get
them out of the index; the why is further down— instead of deleting them,
because setting aside is reversible. And `agent-check.py` walks the indexed
tree with the engine's own exclusion rule and fails if it finds a copy
anywhere, no matter where.

**The portal changes too.** External skills aren't in the `data/skills/`
scan **or in the prompt snapshot** (the engine writes it before walking the
external directories), so the adapter lists them separately. Along the way,
the adapter now **doesn't show the disabled ones** either: before, the
skills tab was offering the client 70 capabilities the agent didn't
actually have.

## What a new agent looks like

It comes out of `new-agent.sh` like this, with no extra steps:

```
agent-<client>/
  data/            the agent's volume (it writes here)
    config.yaml    ← copy of compose/config.base.yaml: skills disabled,
                     external_dirs, platform_hints, kanban, toolsets
    skills/        ← only the engine's (seeded) and the client's own
  kit-skills/      ← the kit's 6, mounted :ro at /opt/kit/skills
  docker-compose.yml
```

`new-agent.sh` no longer carries its own copy of the config: it copies
`compose/config.base.yaml`. There used to be two parallel configs and
they'd already started drifting apart; with 66 generated names inside,
keeping two around was a guarantee one of them would go stale.

## Runbook: applying this to an agent that already exists

**This hasn't been applied to any agent yet** — it gets run together with
Luis. It's a redeploy: the `config.yaml` is mounted `:ro` and there's a new
volume.

```bash
AG=/path/to/agent          # the agent's repo; data/ and kit-skills/ live inside

# 1. Update the kit. Installs the skills into $AG/kit-skills/ and SETS ASIDE
#    the old copies from data/skills/ into $AG/shadowed-skills/ (outside the
#    tree the engine indexes: inside it, they'd keep shadowing).
./install.sh $AG/data

# 2. The compose file: mount kit-skills on BOTH services (hermes and portal-adapter)
#       - ./kit-skills:/opt/kit/skills:ro
#    ONLY on hermes, the promises guard:
#       - ./policy/plugins:/opt/data/plugins:ro
#    and ONLY on portal-adapter, the kit's plugin registry (phase 3b):
#       - ./plugins:/opt/plugins:ro
#    All three come in compose/docker-compose.example.yml and in the remote one;
#    an existing agent needs them added by hand. They are NEW mounts: they need
#    `docker compose up -d <service>`, a plain `restart` won't pick them up.
#    The last one is not optional once step 1 has run: with the folder installed
#    and unmounted the adapter reports no plugins at all, and agent-check.py
#    calls that a failure — installed and unreadable is worse than absent.

# 3. The agent's config. It's mounted :ro: open it, edit it, close it
#    (tools/with-config-open.sh, or by hand on the host). ONE SINGLE COMMAND
#    leaves all four knobs set:
#      · skills (disabled + external_dirs, generated from the manifest)
#      · platform_hints (the portal preamble)
#      · display.file_mutation_verifier (the engine's footer)
#      · platform_toolsets, all three platforms without browser
#    Each block is idempotent —if it already matches it leaves it alone, if it
#    differs it replaces it and says so— and doesn't step on anything else of
#    the agent's: a custom `model.base_url`, a platform the kit doesn't know
#    about, other `display` keys. It writes atomically (sibling file +
#    os.replace) and keeps a copy of the previous config in config-backups/,
#    so there's no need to back it up by hand. It refuses if the YAML doesn't
#    parse or if there's a duplicate top-level key.
#    HEADS UP: that guard needs PyYAML ON YOUR MACHINE, which is exactly where
#    you're migrating from. If `python3 -c "import yaml"` fails, install it
#    (pip install pyyaml) or run the command from the engine's own image,
#    which already has it.
python3 tools/skills-knob.py --agent $AG/data --apply $AG/data/config.yaml

# 3a. Turn on the promises guard. `skills-knob.py` doesn't touch it (it's not
#     a skills knob): it's done by hand in the config, which is short and
#     doesn't get regenerated. Without this the plugin stays installed and
#     DISABLED — user plugins are opt-in (hermes_cli/plugins.py:1471-1487).
#       plugins:
#         enabled:
#           - promises
#     This is what stops the agent from telling its client "queda definido:
#     viernes a las 9:30" without having created any flow. Verify afterward
#     with `hermes plugins list | grep promises` → it has to say `enabled`.

# 3b. THAT client's exceptions, if it has any (see "Turning on a skill for
#     one specific client"): take them off the list and declare them with
#     their reason. THESE GO AFTER, with the config already closed :ro — a
#     startup with the config still writable rewrites the file and takes the
#     comments with it. There's none pending today (see below).

# 4. Offline check, BEFORE starting up
python3 tools/agent-check.py $AG/data

# 5. Restart and verify against the live engine
docker compose up -d
curl -s -H "Authorization: Bearer $API_SERVER_KEY" http://127.0.0.1:8642/v1/skills
#    → has to be 10: the kit's 6 + xlsx, pdf, docx, ocr-and-documents
#      (plus that client's declared exceptions, if any)
python3 tools/portal-check.py --key $API_SERVER_KEY
```

`config-backups/` fills up on its own and nobody looks at it: it's copies of
clients' configs, so check it every once in a while and delete the old ones.

**What failures remain after step 4, and why.** The three knobs come back
green, but an agent from before Phase B carries **two SOUL failures**
forward that this doesn't touch and that get fixed separately:

- `SOUL: kit block` — its SOUL was composed before the `kit:base` markers
  existed. Fixed with `tools/install-soul.sh`.
- `SOUL: block version` (warning) — the agent has an older block than the
  kit's. It gets bumped with `tools/install-soul.sh --replace <host>
  [slug]`, which preserves the identity and warns if the old block had that
  client's own additions.
- `SOUL: no template gaps` — the `<ASÍ>` placeholders in `00-identity.md`
  left unfilled. This is hand-craft work, client by client, and needs data
  that isn't in any repo.

In other words: **0 failures only once the SOUL part is also done.** A
migrated agent with a complete SOUL has to come back at 0.

**Pending exceptions, by agent: none today.** The four that had been
logged —`humanizer`, `blogwatcher`, `youtube-content`, `gif-search`—
belonged to La Mano, which was decommissioned on 12/8/2026 (see
`fleet.md`). Neither Mr.Wobble nor East has any declared.

The mechanism stays, and the list above works as an example of what it's
for: a client that does content and tracks competitors needs four skills
the rest don't, and that gets declared in that agent's `config.yaml` like
this:

```yaml
skills:
  # kit:exception humanizer — writes social posts, that's what the company does
  # kit:exception blogwatcher — monitors the competition every week
```

When a real one comes up, it goes here with its agent and its reason.

**On a new remote there's nothing to migrate:** `deploy-remote.sh` already
uploads the kit skills to `$REMOTE/kit-skills/` (never to `data/skills/`),
the remote compose brings the `:ro` mount, and the `config.base.yaml` it
installs brings both blocks. What a remote IS missing is `00-identity.md`.

**Watch out with the YAML:** `skills:` can't appear twice in the same file.
It doesn't throw an error — the last one wins and the other gets silently
lost. That's why the generator emits the whole key at once (`disabled`
**and** `external_dirs`), and `--apply` refuses to run if there's already an
unmarked `skills:` block.

**And watch out with "setting aside" things inside `data/skills/`:** the
engine indexes that whole tree and only skips the names in
`EXCLUDED_SKILL_DIRS` (`agent/skill_utils.py:26-44`). Starting the directory
name with a dot **isn't enough**: `.archive` is on that list,
`.any-other-name` isn't. A copy set aside into some random dot-dir still
gets indexed and still shadows the external one, with the check coming back
green if the check only looks at `data/skills/<name>`. That's why
`install.sh` sends them to a sibling of `data/`, and `agent-check.py` walks
the tree using the engine's own exclusion rule.

Status per agent: `fleet.md`.

## What got verified against the real engine (12/8/2026)

With a throwaway agent created via `new-agent.sh`, image `v2026.7.30`, its
own ports, and **no model key**. The engine's 70 skills were seeded with its
own `skills_sync.py` and the effective prompt was assembled with the engine
(`build_system_prompt`, offline, without calling the provider):

- **The skills index came out at 866 characters** (on La Mano it's ~9,000)
  and names exactly 9: the kit's 6 —served from the `:ro` mount— plus
  `ocr-and-documents`, `pdf`, `xlsx`. (Measured with the three-item
  allowlist, before `docx` was added: today it'd be 10.) `himalaya`, `xurl`,
  `computer-use`, `google-workspace`, `hermes-agent`, `claude-code`,
  `imessage`: none of them.
- **`assume plain text` appears 0 times** in the prompt, and our own text is
  there in full, in its place.
- **The system prompt dropped to 34,347 characters** (La Mano: 40,161).
- With the gateway running, `GET /v1/skills` returns the same 9, and the
  adapter's `/portal/inventory` does too.

With no model key, a real conversation **could not** be verified, which is
the only thing that writes `sessions.system_prompt` into `state.db`: the
prompt snapshot through that path (C2's proposal) stays pending on a run
with real credentials.
