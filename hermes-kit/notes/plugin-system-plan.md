# Plugin system — the plan (v2, revalidated 2026-08-23 after the English translation)

Status: **Phase 0 DONE** (full-English translation, commits c0da1f4..f7ea931),
**Phase 1 DONE** — 925a933 (registry, manifest schema, check-plugins), 469d595
(transcribe and invoices-to-data migrated, build_role resolving plugins), plus
a32b430 and b8e73bb from an independent revalidation — and **Phase 2 DONE**
2026-08-23 (e601f78, 5e4d582, 2ac4295), and **Phase 3a DONE** 2026-08-23
(c3345f0 the adapter's loader and `/portal/plugins`, 4af1df0 the
`adapter_version` rename, plus this note), and **Phase 3b DONE** 2026-08-23
(c0ae990 the registry ships and leaves with the role, a8dba51 the promises
guard moves into `flow`, 70ed713 agent-check reads the registry, c62402d the
dead `data/scripts` window removed, bd28caf, dcb01df and d86fe86 three small
fixes found on the way — the last one is worth knowing about: `install.sh
--diff` was stopping at the first changed file, so a drifted plugin folder
could be hidden by an edited skill above it in the list). **Phase 4 is next.**
Plan agreed with Luis on 2026-08-23; v2 only updates paths and ids to the
translated tree — no decision changed.

Language rule: everything is English — file names, plugin ids, JSON keys,
comments, commits. The only Spanish is client-facing VALUES (e.g.
`client_copy`, `tab.label`).

## Why plugins

Every client will need custom work (webscraping for one, an ERP bridge for
another). Each custom build must land as a REUSABLE unit so the second client
who asks gets it off the shelf. Today that unit is smeared across six
mechanisms; the plugin is the package that unifies them.

## What exists today → the six surfaces of a plugin

| # | Mechanism today (translated paths) | Becomes |
|---|---|---|
| 1 | Kit skills: `skills/<name>/SKILL.md` + scripts | **skills surface** — agent-facing instructions + code |
| 2 | Hermes engine plugins: `plugins/flow/engine/promises/` (`plugin.yaml`, hooks like `transform_llm_output`; it was `policy/plugins/promises/` until 3b) | **engine surface** — the engine already HAS a plugin system; we ship one |
| 3 | MCP gateway: `mcp-guard/guard.py` (hermes → guard → real server on the internal compose net, policy `:ro`, forbidden tools not even listed) | **mcp surface** — third-party MCP servers behind the guard |
| 4 | Adapter endpoints: path-ifs in `adapter/portal_adapter.py` | **adapter surface** — routes mounted under `/plugin/<id>/…` |
| 5 | Portal tabs: pages in `app/app/*` | **tab surface** — nav + a generic plugin page |
| 6 | `capabilities/catalog.json` entries (`installs/detects/verifies` + client copy) | the plugin's **commercial face** (sales layer) |

Install pipeline that becomes plugin-aware: `roles/build_role.py` → dist →
`tools/hire-role.sh` (docker cp + hermes profile update) →
`tools/agent-check.py` (post-install verification).

## Plugin anatomy

One directory per plugin in the monorepo registry: `hermes-kit/plugins/<id>/`.
Installation moves the WHOLE folder into the agent container at
`/opt/plugins/<id>/`. Manifest is `plugin.json`:

```json
{
  "id": "webscraping",
  "version": "1.0.0",
  "description": "Headless browser scraping, reusable across clients",
  "client_copy": "Que entre a una página y te traiga los datos solos.",
  "requires": {
    "plugins": ["kanban", "approval"],
    "connections": [],
    "toolsets": ["code_execution"]
  },
  "surfaces": {
    "skills": ["scrape"],
    "engine": null,
    "mcp": null,
    "service": "compose.fragment.yml",
    "adapter": "endpoints.py",
    "tab": { "label": "Scrapeos" }
  },
  "system": false
}
```

Every surface optional. A migrated leaf skill is `{"skills": ["transcribe"]}`
and nothing else. `id` is English kebab-case and equals the folder name.
`version` is semver. English keys, Spanish values only where client-facing.

## Dependency rules — fail loud, twice

1. **Build time.** `tools/check-plugins.py` validates the registry (unique
   ids, id == folder name, semver, dependency closure, no cycles, declared
   surface files exist, system plugins depend only on system plugins) and
   `build_role.py` resolves each agent's plugin set: a missing dependency
   FAILS the build.
2. **Boot time (phase 3a, DONE).** `adapter/plugins.py` scans
   `/opt/plugins/*/plugin.json` at startup and REFUSES TO BOOT on a broken
   closure. No degraded half-boot — house rule: break hard. It IMPORTS
   `tools/plugin_registry.py` rather than restating its rules, and
   `install.sh` ships that file next to the adapter in the container: one
   validator, so the build and the boot can never disagree about a manifest.
   Three states, one of them an error: no `/opt/plugins` is an empty set and
   a log line (every agent alive today), a valid registry loads into memory,
   anything broken exits nonzero naming the manifest and the rule.

Constraints start minimal: a bare id means "any version present"; add
`id>=N` only when a real incompatibility exists. Registry version is truth:
agents update explicitly (today `--update` on hire-role); no per-client pins
until a client needs one.

## System plugins (the defaults)

`"system": true` = installed on every agent unconditionally, so client
plugins may depend on them freely. Ids match the translated skill dirs
(singular). The graph is real today — the approval skill instructs "request
it IN THE TICKET you are working":

```
kanban           (root: Hermes ticket store /opt/data/kanban/… +
                  /portal/boards,tickets + pipeline/tasks tabs + dispatcher)
├── approval     (skill + /portal/approvals + tab + the gate hook)
├── deliverable  (deliver script + /portal/files + tab)
├── artifact     (skill + /portal/artifacts + tab)
└── flow         (flow creation + /portal/flows + tab;
                  engine surface = plugins/flow/engine/promises,
                  installed to the agent's policy/plugins/promises)
```

## Placement decisions (agreed)

- **Install per-agent, expose per-role.** The folder lands once per
  container (like `/opt/kit`). Each role manifest lists which plugins' SKILLS
  it sees — what `skills_split.py` already computes. Tabs, adapter routes and
  services are inherently per-agent.
- **Harness, not plugins:** `mcp-guard` and `connections/`. Plugins declare
  `requires.connections`; they never own credentials or policy.
- **Sales layer survives:** `capabilities/catalog.json` remains what the
  client buys; `installs` gains a `plugins` list next to `toolsets` /
  `engine_skills` / `kit_skills`. Plugin = engineering unit, capability =
  commercial unit.
- **Portal:** nav from a future `/portal/plugins` endpoint; system plugins
  keep bespoke pages via `tab.builtin`; new plugins get one generic page
  (`app/app/plugin/[id]`) talking to `/plugin/<id>/…`.

## Plugin ids (final — they match the translated skill dirs)

kanban, approval, deliverable, artifact, flow (system) · transcribe,
invoices-to-data, quotes, brand-kit, social-content, post-image, capability
(leaf/meta). Adapter endpoint names (`/portal/approvals` etc.) do not need to
match plugin ids and stay as they are.

## Phases

0. ~~English translation of the codebase~~ **DONE 2026-08-23**
   (c0da1f4..f7ea931, including `tools/migrate-agent-to-english.sh` + SOUL
   v13 for live agents).
1. ~~Spec + resolver~~ **DONE 2026-08-23** (925a933, 469d595, a32b430,
   b8e73bb): `plugins/` dir, `plugin.json` schema, `tools/check-plugins.py` +
   unit tests, `transcribe` and `invoices-to-data` migrated as pilots.
   `build_role.py` reads both the roles' `skills:` list and a new `plugins:`
   list during the transition. Revalidated independently: the five roles'
   dists and the file list install.sh writes on a team and on a solo agent are
   byte for byte what they were before the move, and a pre-pivot agent still
   reads as ours to `agent-check.py`.
2. ~~Carve out the system plugins~~ **DONE 2026-08-23** (e601f78, 5e4d582,
   2ac4295): `kanban`, `approval`, `deliverable`, `artifact` and `flow` are
   manifests over the code that was already there, the graph above is enforced
   by `check-plugins.py` and by the build, and the four skill directories moved
   into their plugins with `git mv`. `surfaces.tab` gained a second shape,
   `{"builtin": "<page>"}`, because those five pages exist already. The install
   layout did not change: 99 dist files with the same names and bytes as
   ad3fb87 except the `skills` array in the five role.json files (same set,
   now sorted — see Resolved), and install.sh writes the identical file list on
   a solo and on a team agent.
3. **Agent-side loader**, split in two because only the second half changes
   what is inside a container:
   - **3a — the loader itself.** ~~Adapter boot-scan, `/portal/plugins`,
     fail-loud boot check.~~ **DONE 2026-08-23** (c3345f0, 4af1df0): the
     adapter boot-scans `/opt/plugins` through the one validator, serves
     `GET /portal/plugins` (id, version, description, system, requires, which
     surfaces are present and the tab object verbatim, sorted by id), and exits
     nonzero on a broken set. `install.sh` gained exactly two entries, both
     shipping `tools/plugin_registry.py` to where the adapter runs
     (`kit-adapter/`, and `data/scripts/` while an agent's compose still starts
     from there — that second one turned out to sit inside a branch that had
     been dead since the adapter split, and 3b removed both, c62402d). Nothing
     else moved: the five roles' dists are byte for byte
     what they were at 1b1129b, and the file list install.sh writes on a solo
     and on a team agent is identical but for those two files plus
     `adapter/plugins.py`, which travels with the rest of the adapter because
     that list is built from the directory.
   - **3b — `/opt/plugins` becomes the installed source of truth.** ~~Ship the
     plugin FOLDERS; bring the engine surface home; make the installer and the
     check plugin-aware.~~ **DONE 2026-08-23.**

     REGISTRY AND DELIVERY ARE TWO SHIPMENTS, AND ONLY THE FIRST IS NEW. This is
     the decision the phase rests on, and it is not the "layout flip" the
     earlier draft of this bullet described:

     * **The registry** is `/opt/plugins/<id>/` — the whole folder, manifest and
       skills and engine surface, mounted `:ro` from `<agent>/plugins/`. It is
       what says the plugin is INSTALLED: what the 3a loader scans, what
       `/portal/plugins` publishes, and what the dependency, tab, adapter and
       service surfaces are built on from phase 4 onward.
     * **The delivery** does not change, on purpose. `build_role.py` still
       flattens a plugin's skills into the distribution, `install.sh` still
       writes the shared ones into `kit-skills/`, and those copies — derived
       from the registry, through the one resolver — are still how the ENGINE
       sees a skill. Engine skill discovery was never the problem this phase had
       to solve: moving `/opt/kit/skills/<name>/` would have forced a `SKILL.md`
       path rewrite across the kit to buy nothing.

     So a plugin's skill is on an agent TWICE and both copies are load-bearing:
     the delivered one is what the agent RUNS, the registry one is what says the
     agent HAS it. `agent-check.py` compares them byte for byte, because the one
     that runs is the one nothing described.

     THE CONSEQUENCE, WHICH 3448728 WROTE DOWN AND THIS PHASE CONFIRMS: the boot
     slot-check covers plugin-vs-plugin only, BY DESIGN. The installed kit tree
     legitimately holds delivered copies of plugin skills, so a boot check that
     scanned `/opt/kit/skills` would refuse every correctly installed agent.
     Build time owns the kit-vs-plugin half — `check-plugins.py` and
     `build_role.py`, over the repo, where both homes are real and before there
     is an agent to install onto. Do not "fix" the boot check.

     What else the phase settled: the set is COMPUTED (`tools/plugin_set.py` —
     system plugins, the plugin behind a base capability, and what each HIRED
     role declares, read off `data/profiles/`); an update removes the folder of
     a plugin that left the set, through the manifest's own machinery and
     nothing else; the engine surface moved to `plugins/flow/engine/promises/`
     while its destination on the agent stayed byte for byte
     `policy/plugins/promises/`; and `agent-check.py` reports a pre-plugin agent
     as a pending WARNING, not a failure. Every agent alive today is one of
     those until somebody runs the installer and adds
     `./plugins:/opt/plugins:ro` to its compose — the folder installed without
     the mount is a red line, because installed and unreadable is worse than
     absent.
4. **First new-surface plugins:** `webscraping` (service + skill) and one
   third-party MCP behind the guard.
5. **Dynamic portal tab:** generic plugin page + manifest-driven nav.
   Riskiest, last.

## Open questions (park until their phase)

- Service-surface resource limits — decide with the first service plugin
  (phase 4).
- Generic-tab security model (what a plugin page may call beyond its own
  namespace) — phase 5.

## Resolved

- **Which plugins an agent gets is COMPUTED, and a solo agent is not the whole
  registry.** `tools/plugin_set.py` is the one answer, asked by `install.sh`
  when it ships and by `agent-check.py` when it verifies: the system plugins
  (unconditional, which is what lets anything depend on them), the plugin
  behind a `level: base` capability (the catalog promises those as already
  installed — `transcribe`, which no role declares), and what each HIRED role
  declares in the kit's `role.json`, hired meaning `data/profiles/<id>/` exists
  (the adapter's own test). A solo agent therefore comes out with SIX and not
  with all seven, even though `install.sh` delivers every skill in the kit to
  it. That is deliberate: a no-roster agent gets the whole skills catalog
  because that is the pre-team product, not because it bought
  `invoices-to-data`. The registry describes what the agent HAS; kit-skills/ on
  a solo agent describes what the old installer always copied. If a client
  plugin ever grows a tab or an adapter surface, the solo agent that carries
  its skill will not draw it — and that is the honest answer, because nobody
  sold it.

- **A role's declaration is read from the KIT, never from the installed
  profile.** The distribution's `role.json` is flattened (plugins folded into
  `skills`, no `plugins` key) and non-semantic by decision. The agent's disk
  says WHICH roles are hired; the kit says what a role is MADE OF. That split
  is what lets a role change composition in a kit update and have the next
  install move the plugin folders with it.

- **The `data/scripts` migration window was dead code, and it aborted every
  install it fired on** (c62402d). It kept writing the adapter into the agent's
  own `data/scripts/` while a compose still started it from there, and it was
  written when the adapter was one file: since the split, its destinations are
  outside `ALLOWED_PREFIXES`, so `install.sh` exited with "Installed nothing"
  before copying a byte. The remote twin uploaded the big file without the five
  modules it imports, i.e. an adapter that raises ImportError instead of one
  that is missing. Both gone; the old path is obsolete now, so the cleaner
  removes it with its sha check and the script prints the compose change to
  make in the same visit. The `ALLOWED_PREFIXES` line stays — it is what makes
  that removal possible.

- **`portal_plugin` is `adapter_version` (adapter 0.41.0, 4af1df0), and that
  was the THIRD meaning of the word.** The manifest field never held a
  plugin of any kind: it dates from when this sidecar was going to ship as a
  Hermes plugin, and its value has always been `adapter-<semver>`. With the
  engine's plugins renamed in phase 2 and `/portal/plugins` now serving the
  kit's registry, this was the last thing making one word mean three, so it
  is named after what it holds. Every consumer moved with it
  (`app/app/lib/agent.ts`, `tools/portal-check.py` in three places). NOTE
  FOR THE FLEET: the field is in portal-check's required-keys list, so
  running it against an agent still on 0.40.0 or older FAILS on the manifest
  check. That is intended — accepting both spellings would be a guard
  against our own rename — and it means the adapter gets updated before the
  check gets run.

- **A profile's `role.json` is permanently non-semantic, and the loader is
  what makes it permanent.** `adapter/plugins.py` reads MANIFESTS and
  DIRECTORIES: `/opt/plugins/<id>/plugin.json`, and the skill directories a
  plugin declares. It never opens a `role.json`, and nothing in phases 3b–5
  gives it a reason to — the plugin set installed on an agent is a fact about
  the filesystem, not a claim in a profile. What the distribution's
  `role.json` carries is `identity` (the name and face the portal draws) and
  a flattened `skills` list nobody compares against anything: the engine
  indexes the `skills/` DIRECTORY, and the adapter's `_role_identity`,
  `agent-check.py` and `skills_split.py` read `identity` or compare sets.
  THE CONSEQUENCE WORTH WRITING DOWN: the skill-id gap in
  `tools/migrate-agent-to-english.sh` — it renames directories on a live
  agent without rewriting the ids inside a `role.json` — is permanently
  harmless, not harmless-for-now. Nothing reads those ids, and after this
  phase nothing is going to start.

- **`/portal/plugins` belongs to the kit.** The adapter's `/portal/inventory`
  used to return a field called `plugins` meaning the ENGINE's plugins
  (`hermes plugins list`). As of phase 2 that field is `engine_plugins`
  (adapter 0.40.0, e601f78), renamed through `app/app/lib/agent.ts` and every
  consumer. The bare word now means a kit plugin everywhere on the portal API,
  and `/portal/plugins` was free for the registry endpoint, which phase 3a
  went on to add (c3345f0). The ENGINE's own JSON key stays `plugins` — that
  one is theirs.

- **`skills_split.py` needs no per-plugin override** (the phase-2 open
  question). `system: true` ships the plugin FOLDER to every agent so anything
  may depend on it; which roles SEE a plugin's skills is still whatever the
  role declares. `artifact` is the case that proves it is not uniform —
  marketing, sales and accounting declare it, support and assistant do not —
  and it stays a role-only skill. `--shared`, `--role-only` and `--orphan`
  print exactly what they printed before the carve-out.

- **The distribution's `skills` list is sorted** (build_role.py). Its order
  used to be wherever each name happened to be written, so no two roles agreed
  and any skill moving into a plugin re-ordered it. Nothing reads the order:
  the engine indexes the `skills/` DIRECTORY, and every consumer of role.json
  — the adapter's `_role_identity`, `agent-check.py`, `skills_split.py`,
  `migrate-agent-to-english.sh` — reads `identity` or compares sets.
