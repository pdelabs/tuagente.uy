# plugins/ — the registry

One directory per plugin, `plugins/<id>/`, with a `plugin.json` manifest at its
root. A plugin is the reusable unit of custom work: whatever a client pays us
to build lands here so the second client who asks for it gets it off the shelf.

The full design, the surfaces and the phase plan are in
[`../notes/plugin-system-plan.md`](../notes/plugin-system-plan.md). Read that
before adding a surface this registry has never shipped. The one the plan never
drew is `core`, and it came from the other side: `engine` is an engine of ours
and a plugin is how it gets a mechanism.

## The manifest

```json
{
  "id": "webscraping",
  "version": "1.0.0",
  "description": "Headless browser scraping, reusable across clients",
  "client_copy": "Que entre a una página y te traiga los datos solos.",
  "requires": { "plugins": ["kanban"], "connections": [], "toolsets": ["code_execution"] },
  "surfaces": {
    "skills": ["scrape"],
    "engine": "engine/",
    "core": "core/",
    "mcp": "mcp/",
    "service": "compose.fragment.yml",
    "adapter": "endpoints.py",
    "tab": { "label": "Scrapeos" }
  },
  "system": false
}
```

| key | what it is |
|---|---|
| `id` | kebab-case, English, **equals the folder name** |
| `version` | semver `MAJOR.MINOR.PATCH` |
| `description` | one line, internal, English |
| `client_copy` | one line the client reads — Spanish, rioplatense |
| `requires.plugins` | other plugin ids this one cannot work without |
| `requires.connections` | connection ids (`connections/`); a plugin never owns credentials |
| `requires.toolsets` | engine toolsets the agent needs on |
| `surfaces` | every one optional; a migrated leaf skill declares `skills` and nothing else |
| `surfaces.engine` | a directory inside the plugin holding a `plugin.yaml`: a plugin of the ENGINE's, which install.sh copies to the agent's `policy/plugins/<name>/` |
| `surfaces.core` | a directory inside the plugin holding a `plugin.py` (and optionally an `instructions.md`): a plugin of OUR engine, `engine`, which imports it and calls `register(engine)`. A Hermes agent never reads it. The verbs are `toolset`, `before_persist`, `capability`, `router`, `module`, `instructions`, `deferred` and `subagent`, plus `tools`, `identity`, `provide` and `use` for building the agent a `subagent` delegates to; `engine/README.md` has the table |
| `system` | `true` = the FOLDER ships to every agent, so anyone may depend on it |

`requires` sub-lists and `surfaces` entries may be left out; unknown keys are a
hard error, like everywhere else in the kit's closed catalogs. `_comment` (a
string or a list of strings) is allowed and ignored.

## What is in here

| plugin | system | what it is |
|---|---|---|
| `kanban` | yes | the ticket store the other defaults write into; no skills surface |
| `approval` | yes | nothing sensitive happens without the client's yes |
| `deliverable` | yes | what the client is meant to read gets saved with a name |
| `artifact` | yes | data understood by looking at it |
| `flow` | yes | the catalog of curated flows the product ships. Nothing else: since 14/9/2026 a flow is a file the ENGINE reads (`engine/core/flows.py`), so the skill, the `promises` engine surface, the `core` surface and the tab are gone |
| `capability` | yes | the only way in for what the agent does not have |
| `memory` | no | what the agent remembers about the client's business — `core` only, so it exists on `engine` and nowhere else |
| `image` | no | one `generate_image` tool on Pydantic AI's capability — `core` only, same shape as `memory` |
| `transcribe` | no | audio and video to text — the plugin behind the `transcription` base capability |
| `invoices-to-data` | no | an invoice becomes one row of data (accounting) |
| `quotes` | no | a request becomes a priced quote in the client's template (sales) |
| `social` | no | one Instagram post a day, written, drawn, checked and left in the Posts tab — `core` and a skill, so it exists on `engine` only |
| `drive-inbox` | no | Drive folders as an inbox: the agent's front door for material |
| `interview-production` | no | an interview becomes what goes on air — ten lower-thirds, or a news item |

`drive-inbox` was the honest odd one out until 2026-08-30 and the manifest said
so: no capability sold it, no base capability installed it, and `system` is
false, so `tools/plugin_set.py` gave its FOLDER to no agent — nothing of it
reached anybody, not the folder and not the skill. **That is what a plugin with
no row is: a plugin that does not exist.** The row (`drive-inbox`, `level:
menu`, group `information`) is what fixed it, and the general lesson is the
line below about the sales layer: writing the plugin is half the shipment.

`interview-production` is the first plugin **written as a plugin** rather than
ported from `skills/`, and its shape is the one that difference produces: two
skills, neither named after the plugin (`lower-thirds`, `news-copy`), because
the unit is the WORK and the crafts inside it have their own names. It was
commissioned by one client; the client is named in the catalog row's
`internal_note` and nowhere else, which is what PRINCIPLE ZERO means in
practice — the folder holds a TV-production shape, not a company.

`memory` is the third shape, and it is the first plugin that exists for an
engine instead of for a client. It declares `core` and nothing else: a Hermes
agent has the engine's own memory, so there is nothing here for it to install,
and the folder travels with the registry copy like every other plugin's without
anything on that agent opening it. It is also `system: false` with NO capability
row installing it, which anywhere else on this page is the drive-inbox mistake —
a plugin nobody can buy is a plugin that does not exist. Here it is the honest
state: what decides that this plugin runs is `CORE_PLUGINS` in `engine`, not
`purchased.json`, and a row would be selling a Hermes client something they
already have. **The rule is still "a plugin needs a way in"; what changed is
that `core` is a second way in, and it is not the sales layer.**

`social` is the fourth shape, and it is the one that puts the two halves
together: `core` for the mechanism — `save_post`, which owns the folder a post
lands in, and the routes the Posts tab reads — plus a `skills` surface for the
craft and a `tab` for the page. It exists for `engine` like `memory` and
`image` do, and unlike them a CLIENT BUYS IT: `social-package` installs it and
`image`, which is how that plugin finally got its row. It replaced `brand-kit`,
`social-content` and `post-image` on 14/9/2026 and did not port them — the
brand is `marca/brand.md`, a file the client's workspace carries, so there is
nothing left for a brand-kit plugin to be. The consequence is named rather than
hidden: a client still on Hermes who buys this row gets `kit-skills/post/`,
a SKILL.md that calls two tools only `engine` has. That is what Hermes dying
looks like from the kit.

### Harness skills: what `skills/` still holds, and why

Two directories stay outside this registry — `skills/no-images` and
`skills/no-web-search` — and they are not leftovers. They are FALLBACK NOTES:
the engine puts them in the index **only when the tool is missing**
(`metadata.hermes.fallback_for_tools`) and withdraws them on its own once it is
there. They cost nothing when the capability is present, and when it is absent
they are the only thing between a missing tool and an agent that fakes the
result.

That makes them harness, not product, and the distinction is the same one that
keeps `mcp-guard/` and `connections/` out: a plugin is something a client can
BUY, depend on, and lose when the capability that installed it is dropped. These
two belong to every agent unconditionally and answer to the engine's index, not
to anything anybody bought. Wrapping them in a manifest would invite a capability
to install them and `plugin_set.py` to remove them.

### `system: true` ships the folder, not the skill

The six defaults — `kanban`, `approval`, `deliverable`, `artifact`, `flow` and
`capability` — are on every agent, which is what lets any client plugin depend
on them without asking whether the client bought them. That is a statement about
the FOLDER.

THE FOLDER AND THE SKILL ARE TWO DIFFERENT SHIPMENTS, and the distinction runs
through everything below. The FOLDER is the registry: `plugins/<id>/` copied
whole to `<agent>/plugins/<id>/`, mounted `:ro` at `/opt/plugins`, which is what
says the plugin is installed — the adapter scans it at boot and publishes it at
`/portal/plugins`. The SKILL is the delivery: the same files flattened into
`kit-skills/<name>/`, which is what the ENGINE indexes. Both are on the agent,
both are load-bearing, and `tools/agent-check.py` compares them byte for byte —
the delivered copy is the one that RUNS, so a stale one is a skill running old
code under a manifest that says otherwise.

Which plugins a given agent gets is computed by `tools/plugin_set.py`: system,
plus the plugin behind a `level: base` capability, plus what the capabilities
this client bought install (`policy/capabilities/purchased.json`). `install.sh`
ships exactly that set — the folder, the engine surface and the curated flows —
and removes what leaves it.

THE SKILL INDEX FOLLOWS THE SAME SET, and that is what makes the folder and the
index one answer. `install.sh` delivers the HARNESS — everything under `skills/`,
which belongs to every agent unconditionally — plus the skills of the plugins in
THIS agent's set, and `tools/agent-check.py` verifies against the same function
(`tools/skill_sources.py`).

It was the whole kit on a solo agent until 2026-08-30, and that was wrong in
both directions: `quotes` in the index of an agent that never bought it is
prompt paid on EVERY request for a SKILL.md whose folder — its tab, its routes,
its flows — was never installed. During the team pivot the split was per ROLE
(kit-skills/ is mounted for the whole installation, so a teammate paid for the
other teammates' craft, and `roles/skills_split.py` computed who saw what); it
is per AGENT now, off the purchase.

`kanban` is the extreme case: it has no skills surface at all. Its store is the
engine's and its screens are the portal's; the manifest exists so the four that
write into a ticket can say they need it.

`capability` is the other end of the same idea: it is system because it is the
PRODUCT'S OWN MACHINERY, not because it happens to be on every agent today.
`capabilities/catalog.json` is the closed list the client buys from, the adapter
draws the card, and the gate hook in `policy/hooks/` redirects every blocked
install to this skill by name. A client plugin that has to say "this needs
something you do not have" depends on it being there. It requires nothing and
declares no tab: the ask is a `capability:<id>` mention inside the answer the
agent is already giving, so nothing is blocked, approved or delivered, and there
is no page to name.

### The flows surface: what a plugin's work makes possible

```json
"flows": ["flows/presupuesto-nuevo", "flows/seguimiento-de-presupuestos"]
```

Directories inside the plugin, each holding a `FLOW.md`. `install.sh` delivers
the ones belonging to THIS agent's plugin set to `data/flows/<slug>/` — where
the agent writes the flows it creates, where the adapter's FlowStore reads, and
where the client can edit one exactly like a flow the agent wrote for them. So a
flow about quotes never lands on an agent that cannot write a quote.

THEY USED TO TRAVEL INSIDE A ROLE (`roles/<id>/flows/`, packed into the profile
distribution), and ownership is now about the WORK, not the frontmatter.
`seguimiento-de-presupuestos` names only `approval` and `deliverable` under
`skills:` and belongs to `quotes`, because the quotes it chases only exist if
the quote writer made them. The seven that no plugin owns — they exercise system
skills or a base capability only — are the system `flow` plugin's catalog, under
`plugins/flow/curated/`, and they stay there until somebody writes a plugin that
earns them: a manifest invented to hold a FLOW.md is a plugin with nothing
behind it.

The slug has ONE source, like a skill name. Two plugins claiming
`presupuesto-nuevo` install into one directory and one of them silently wins, so
the validator refuses it.

### The tab surface has two shapes

```json
"tab": { "label": "Scrapeos" }        a page the portal does not have yet
"tab": { "builtin": "pipeline" }      a page app/app/ already has
```

Exactly one of the two, never both. `label` is client-facing copy: phase 6 draws
the generic plugin page under that word. `builtin` names an existing portal
page, which is the only honest shape for the system plugins — Pipeline,
Approvals, Files, Artifacts and Flows were written long before anybody called
them plugins, and a manifest that claimed a `label` would have the portal
inventing a second Pipeline tab next to the real one.

The check stops at the shape. It does not open `app/` to see whether the page
exists: the kit validates manifests, the portal owns its routes, and a check
that reached across that line would fail the kit's tests on a portal refactor
that has nothing to do with plugins.

## The sales layer names the plugin

`capabilities/catalog.json` is what the client BUYS, and its `installs` says
what we do when they say yes. A capability that installs something we wrote
names the PLUGIN id when the source lives here, and a bare `kit_skills` name
only while it still lives in `skills/`:

```json
"installs": { "plugins": ["transcribe"] }
"installs": { "plugins": ["social", "image"], "kit_skills": ["social-formats"] }
```

`tools/check-plugins.py` refuses a `kit_skills` entry that names a plugin-owned
skill and a `plugins` entry that names a plugin nobody wrote, and
`tools/plugin_set.py` runs the same check on every install. It is not
bookkeeping: `plugin_set.py` reads `installs.plugins` off the `level: base` rows
to decide what ships on EVERY agent, and off the rows in `purchased.json` to
decide what ships on THIS one, so a row pointing at the wrong home is a plugin
the catalog promises and the installer never copies.

A ROW HAS TO BE CLOSED ON ITS OWN, because a row is what a client buys on its
own. `check-plugins.py` refuses a row whose plugin requires a plugin that same
row does not install — `social-package` selling `social` without `image` is a
skill that tells the agent to call a tool the agent does not have. Another row installing the
dependency is another purchase, not this one.

**Two kinds of dependency need no declaring, and they are the two that are on
every agent already**: a `system` plugin, and one a `level: base` row installs
(today `transcribe`, via `transcription`). `tools/plugin_set.py` adds both
unconditionally, so a menu row leaning on one is not selling a client something
with nothing behind it. The base half arrived with `interview-production`, which
runs `transcribe.py` by path: the rule read `system` alone and refused it,
advising a "fix" that would have written a purchase for a plugin nobody buys.

A ROW IS ALSO HOW A BESPOKE PLUGIN GETS SOLD, and there is no second mechanism
for that. Custom work commissioned by one client is an ordinary `level: menu`
row with honest `cost` and `effort`; being commissioned is a fact about its
history and lives in `internal_note`. No third `level`: `level` is read by code
in three places, and a row that hid behind a special one would be a plugin
nobody else could ever buy — the opposite of why this registry exists.

`verifies` did NOT move, on purpose. It describes the agent's DELIVERED layout —
a plugin's skill is flattened into `kit-skills/` exactly as it always was — so
`social-package` installs the plugin `social` and verifies the skill `post`,
and both are the truth about a running agent. `installs` says where the source is; `verifies` says what to find on disk.

## Where the files actually land

**The folder ships whole** (phase 3b). `plugins/<id>/` is copied to
`<agent>/plugins/<id>/` — manifest, skills, engine surface, curated flows — and
the compose mounts that at `/opt/plugins:ro` for the adapter. `install.sh`
decides WHICH folders travel with `tools/plugin_set.py` and removes the ones
that stop belonging to the agent; `deploy-remote.sh` does the same by running
the same installer against a staging tree, after pulling that agent's
`purchased.json` so it computes the same answer there as here.

**The skills keep being delivered flattened, and that did not change.** A
plugin's skills are copied into the layout the agent has always had, so
`plugins/transcribe/skills/transcribe/` installs at
`/opt/kit/skills/transcribe/` exactly like `skills/transcribe/` used to, and
every `SKILL.md` keeps the paths it already had. The registry copy is not a
replacement for that one: the engine indexes `skills.external_dirs`, never
`/opt/plugins`.

**The curated flows land in `data/flows/<slug>/`**, which is the only place a
flow exists on an agent: what the agent writes, what the adapter lists and what
the portal draws. They are on the agent twice — inside the registry folder and
at their working destination — and the working copy is the one that counts. It is in `data/`, which belongs to the
agent, on purpose: a client edits a curated flow the same way they edit one the
agent wrote, and `install.sh --diff` is what says so before an update overwrites
the edit.

**The engine surface is the exception to "whole folder, one place".** It ships
to the agent TWICE: inside the registry folder like everything else, and to
`policy/plugins/<name>/`, which is what the compose mounts at
`/opt/data/plugins` — where the ENGINE looks for its own plugins. NO PLUGIN
DECLARES ONE ANY MORE: the only one was `flow`'s promises guard, and it moved
into our engine (`engine/core/promises.py`) with the flows it checks. The rule
stays written down because the surface still exists; a Hermes agent installed
from this kit today simply gets no engine plugin.

**The core surface travels and nothing on a Hermes agent opens it.** `core/`
is a plugin of `engine/`, our engine, and that engine mounts
this whole directory read-only at `/opt/kit/plugins` and imports
`<id>/core/plugin.py` for each id in its `CORE_PLUGINS`. `install.sh` copies it
into `<agent>/plugins/<id>/core/` because the folder ships whole; no Hermes
agent imports a `.py` from there, the same way it never imports the `engine/`
copy inside the registry folder. It is the mechanism's prose too: a plugin's
`core/instructions.md` is in the model's prompt only where that plugin is
enabled, which is why nothing about approvals, deliverables or flows is left in
a SOUL.

**A `core` surface may also bring a SUB-AGENT.** `engine.subagent(delegate,
label=…)` registers an agent the client's one agent can hand work to, and
`engine.tools`, `engine.identity`, `engine.provide` and `engine.use` are what a
plugin builds it out of — the same tool definitions the face has, the same
SOUL, and capabilities another plugin offered by name. It is how the `social`
plugin's creator gets `save_post` and the `image` plugin's capability while the
face has neither: `docs/subagents-plan.md` and `engine/README.md`,
**Sub-agents**.

**The agent reads the registry at boot** (phase 3a). The adapter scans
`/opt/plugins` through this same validator — `install.sh` ships
`tools/plugin_registry.py` next to it in the container, because two copies of
these rules would be two answers — and publishes what it found at
`GET /portal/plugins`. On an agent installed before the flip that directory does
not exist, which is a state and not a failure: the adapter says so on stderr and
serves an empty list, and `agent-check.py` reports it as a pending warning. A
directory that IS there and does not validate stops the adapter from booting at
all.

That flattening is what `install.sh` does, through the one resolver in
`tools/plugin_registry.py` (via `tools/skill_sources.py`). A skill name may exist in
`skills/` **or** in one plugin's skills surface, never in two places: the
flattened layout has one slot per name and the validator says so.

**That last rule is a build-time rule, and the boot check only gets half of it
— by design, settled in phase 3b.** `_check_skill_slots` seeds the taken names
from `<root>/skills/`, which is `kit/skills/` in the repo but
`/opt/skills` on an agent, where nothing lives. So the adapter's boot scan
refuses two plugins claiming one skill name, and cannot see a plugin colliding
with a kit skill.

That gap does not get closed, and the reason is the registry/delivery split: an
agent's `/opt/kit/skills/` is FULL of delivered copies of plugin skills, put
there by the installer on purpose. A boot check that read them would find
`transcribe` in `/opt/plugins/transcribe/skills/` and in `/opt/kit/skills/` and
refuse to start — on every correctly installed agent. The kit-vs-plugin half
belongs to build time, where both homes are real and there is no delivery to
confuse it with: `check-plugins.py`, over the repo, before any agent has the
plugin at all.

## What the plugin set IS read from, and what it is not

**`policy/capabilities/purchased.json`, and nothing else about the client.** It
is a list of capability ids from `capabilities/catalog.json` — the same ids the
adapter draws the card from and `requests.jsonl` records the ask in:

```json
{ "capabilities": ["quotes", "invoices-to-data"] }
```

No file is a fresh client and installs: the six defaults plus the plugin behind
`transcription`, seven in all, and `install.sh` says so in one line. A file that
IS there and is malformed, names a capability the catalog does not have, or
names a `level: base` row — already on every agent, not sold — stops the install
by name. It lives in `policy/` and not in `data/` for the same reason the
capabilities catalog does: what the client bought decides what code reaches the
agent, and `data/` belongs to the agent.

IT USED TO BE THE ROSTER. Until 2026-08-30 the third source was what each HIRED
role declared, read off `data/profiles/<id>/`, because the product sold a team
and a role was the unit a client bought. The question did not change — which of
the things we sell did this client say yes to — only the vocabulary, into the
one the client already reads.

**A profile, a role.json, or anything else on the agent's disk is not a source.**
Everything that resolves plugins reads manifests and directories and nothing
else: this registry in the repo, `/opt/plugins/<id>/plugin.json` on the agent,
and the skill and flow directories a manifest declares. Which plugins an agent
has is a fact about its filesystem plus one purchase record, never a claim
inside a distribution.

## Verify

```bash
python3 kit/tools/check-plugins.py
python3 -m unittest discover -s kit/tools -p "test_*.py"
# the boot half: the loader, its refusals, and /portal/plugins
python3 -m unittest discover -s kit/adapter -p "test_*.py"
```

A broken registry is not a warning. Duplicate ids, an id that is not its folder
name, a version that is not semver, a dependency on a plugin that does not
exist, a dependency cycle, a declared surface whose file is missing, a system
plugin depending on a non-system one, malformed JSON: every one of those stops
the check, the build, the install — and, once the folder ships, the adapter's
boot.
