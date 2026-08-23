# plugins/ — the registry

One directory per plugin, `plugins/<id>/`, with a `plugin.json` manifest at its
root. A plugin is the reusable unit of custom work: whatever a client pays us
to build lands here so the second client who asks for it gets it off the shelf.

The full design, the six surfaces and the phase plan are in
[`../notes/plugin-system-plan.md`](../notes/plugin-system-plan.md). Read that
before adding a surface this registry has never shipped.

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
| `system` | `true` = the FOLDER ships to every agent, so anyone may depend on it |

`requires` sub-lists and `surfaces` entries may be left out; unknown keys are a
hard error, like everywhere else in the kit's closed catalogs. `_comment` (a
string or a list of strings) is allowed and ignored.

### `system: true` ships the folder, not the skill

The five defaults — `kanban`, `approval`, `deliverable`, `artifact`, `flow` —
are on every agent, which is what lets any client plugin depend on them without
asking whether the client bought them. That is a statement about the FOLDER.

THE FOLDER AND THE SKILL ARE TWO DIFFERENT SHIPMENTS, and the distinction runs
through everything below. The FOLDER is the registry: `plugins/<id>/` copied
whole to `<agent>/plugins/<id>/`, mounted `:ro` at `/opt/plugins`, which is what
says the plugin is installed — the adapter scans it at boot and publishes it at
`/portal/plugins`. The SKILL is the delivery: the same files flattened into
`kit-skills/<name>/` or into a role's profile, which is what the ENGINE indexes.
Both are on the agent, both are load-bearing, and `tools/agent-check.py`
compares them byte for byte — the delivered copy is the one that RUNS, so a
stale one is a skill running old code under a manifest that says otherwise.

Which plugins a given agent gets is computed by `tools/plugin_set.py`: system,
plus the plugin behind a `level: base` capability, plus what each hired role
declares. `install.sh` ships exactly that set and removes the folder of a
plugin that leaves it.

Shipping the folder says nothing about which roles see the skills inside.
Exposure is still whatever each role declares in `roles/catalog.json` and
`roles/<id>/role.json`, computed by `roles/skills_split.py`, and it is not
uniform: `artifact` is declared by marketing, sales and accounting and not by
support or assistant, so it is a role-only skill and stays one. A system plugin
whose skill was suddenly in every role's index would put the cost back where the
team pivot took it from — every skill's description is loaded on every request.

`kanban` is the extreme case: it has no skills surface at all. Its store is the
engine's and its screens are the portal's; the manifest exists so the four that
write into a ticket can say they need it.

### The tab surface has two shapes

```json
"tab": { "label": "Scrapeos" }        a page the portal does not have yet
"tab": { "builtin": "pipeline" }      a page app/app/ already has
```

Exactly one of the two, never both. `label` is client-facing copy: phase 5 draws
the generic plugin page under that word. `builtin` names an existing portal
page, which is the only honest shape for the system plugins — Pipeline,
Approvals, Files, Artifacts and Flows were written long before anybody called
them plugins, and a manifest that claimed a `label` would have the portal
inventing a second Pipeline tab next to the real one.

The check stops at the shape. It does not open `app/` to see whether the page
exists: the kit validates manifests, the portal owns its routes, and a check
that reached across that line would fail the kit's tests on a portal refactor
that has nothing to do with plugins.

## Where the files actually land

**The folder ships whole** (phase 3b). `plugins/<id>/` is copied to
`<agent>/plugins/<id>/` — manifest, skills, engine surface — and the compose
mounts that at `/opt/plugins:ro` for the adapter. `install.sh` decides WHICH
folders travel with `tools/plugin_set.py` and removes the ones that stop
belonging to the agent; `deploy-remote.sh` does the same by running the same
installer against a staging tree.

**The skills keep being delivered flattened, and that did not change.** At
dist-assembly time a plugin's skills are copied into the layout the agent has
always had, so `plugins/transcribe/skills/transcribe/` installs at
`/opt/kit/skills/transcribe/` exactly like `skills/transcribe/` used to, and
every `SKILL.md` keeps the paths it already had. The registry copy is not a
replacement for that one: the engine indexes `skills.external_dirs` and the
profiles, never `/opt/plugins`.

**The engine surface is the exception to "whole folder, one place".** It ships
to the agent TWICE: inside the registry folder like everything else, and to
`policy/plugins/<name>/`, which is what the compose mounts at
`/opt/data/plugins` — where the ENGINE looks for its own plugins. That
destination did not move when the source did (`plugins/flow/engine/promises/`,
phase 3b).

**The agent reads the registry at boot** (phase 3a). The adapter scans
`/opt/plugins` through this same validator — `install.sh` ships
`tools/plugin_registry.py` next to it in the container, because two copies of
these rules would be two answers — and publishes what it found at
`GET /portal/plugins`. On an agent installed before the flip that directory does
not exist, which is a state and not a failure: the adapter says so on stderr and
serves an empty list, and `agent-check.py` reports it as a pending warning. A
directory that IS there and does not validate stops the adapter from booting at
all.

That flattening is what `roles/build_role.py` and `install.sh` do, both through
the one resolver in `tools/plugin_registry.py`. A skill name may exist in
`skills/` **or** in one plugin's skills surface, never in two places: the
flattened layout has one slot per name and the validator says so.

**That last rule is a build-time rule, and the boot check only gets half of it
— by design, settled in phase 3b.** `_check_skill_slots` seeds the taken names
from `<root>/skills/`, which is `hermes-kit/skills/` in the repo but
`/opt/skills` on an agent, where nothing lives. So the adapter's boot scan
refuses two plugins claiming one skill name, and cannot see a plugin colliding
with a kit skill.

That gap does not get closed, and the reason is the registry/delivery split: an
agent's `/opt/kit/skills/` is FULL of delivered copies of plugin skills, put
there by the installer on purpose. A boot check that read them would find
`transcribe` in `/opt/plugins/transcribe/skills/` and in `/opt/kit/skills/` and
refuse to start — on every correctly installed agent. The kit-vs-plugin half
belongs to build time, where both homes are real and there is no delivery to
confuse it with: `check-plugins.py` and `build_role.py`, over the repo, before
any agent has the plugin at all.

## What the plugin set is NOT read from

**A profile's `role.json` is non-semantic, permanently.** Everything that
resolves plugins reads manifests and directories and nothing else: this
registry in the repo, `/opt/plugins/<id>/plugin.json` on the agent, and the
skill directories a manifest declares. Which plugins an agent has is a fact
about its filesystem, never a claim in a profile, and no phase of this plan
changes that.

What the distribution's `role.json` carries is `identity` — the name and face
the portal draws — plus a flattened `skills` list that nothing compares against
anything: the engine indexes the `skills/` DIRECTORY, and the adapter's
`_role_identity`, `agent-check.py` and `skills_split.py` read `identity` or
compare sets. That is why `tools/migrate-agent-to-english.sh` rewriting a live
agent's `role.json` id and look but NOT the skill ids inside it is harmless for
good, and not just until something starts reading them.

## Verify

```bash
python3 hermes-kit/tools/check-plugins.py
python3 -m unittest discover -s hermes-kit/tools -p "test_*.py"
# the boot half: the loader, its refusals, and /portal/plugins
python3 -m unittest discover -s hermes-kit/adapter -p "test_*.py"
```

A broken registry is not a warning. Duplicate ids, an id that is not its folder
name, a version that is not semver, a dependency on a plugin that does not
exist, a dependency cycle, a declared surface whose file is missing, a system
plugin depending on a non-system one, malformed JSON: every one of those stops
the check, the build, the install — and, once the folder ships, the adapter's
boot.
