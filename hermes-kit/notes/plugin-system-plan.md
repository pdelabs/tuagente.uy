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
could be hidden by an edited skill above it in the list), and **Phase 4 DONE**
2026-08-23 — the PORTING WAVE, redefined by Luis: no new plugin and no
webscraping, port what exists (ab47fa8, c9c4199, 0ccb4c6). The registry is 13
plugins and `hermes-kit/skills/` holds only the two shadow notes. **Phase 5
(first new-surface plugins) is deferred until a client needs one.**
Plan agreed with Luis on 2026-08-23; v2 only updates paths and ids to the
translated tree — no decision changed.

**v3, 2026-08-30 — THE TEAM PIVOT IS OFF AND THIS PLAN OUTLIVED IT.** Luis's
decision: ONE baptized agent per client. The plugin framework stays exactly as
designed; what changes is the word in three places. What an agent HAS is no
longer "what its hired roles declare" but "what its client BOUGHT",
`policy/capabilities/purchased.json`. What a plugin OWNS gained a seventh
surface, `flows`, because the sixteen curated FLOW.md used to travel inside a
role. And "expose per-role" is gone: there is one index and it is the client's.
Nothing about the manifest, the registry, the boot loader or the fail-loud rules
moved. The resolutions this changed are marked below; `roles/`,
`tools/hire-role.sh` and `tools/profile_config.py` are deleted.

Language rule: everything is English — file names, plugin ids, JSON keys,
comments, commits. The only Spanish is client-facing VALUES (e.g.
`client_copy`, `tab.label`).

## Why plugins

Every client will need custom work (webscraping for one, an ERP bridge for
another). Each custom build must land as a REUSABLE unit so the second client
who asks gets it off the shelf. Today that unit is smeared across six
mechanisms; the plugin is the package that unifies them.

## What exists today → the seven surfaces of a plugin

| # | Mechanism today (translated paths) | Becomes |
|---|---|---|
| 1 | Kit skills: `skills/<name>/SKILL.md` + scripts | **skills surface** — agent-facing instructions + code |
| 2 | Hermes engine plugins: `plugins/flow/engine/promises/` (`plugin.yaml`, hooks like `transform_llm_output`; it was `policy/plugins/promises/` until 3b) | **engine surface** — the engine already HAS a plugin system; we ship one |
| 3 | MCP gateway: `mcp-guard/guard.py` (hermes → guard → real server on the internal compose net, policy `:ro`, forbidden tools not even listed) | **mcp surface** — third-party MCP servers behind the guard |
| 4 | Adapter endpoints: path-ifs in `adapter/portal_adapter.py` | **adapter surface** — routes mounted under `/plugin/<id>/…` |
| 5 | Portal tabs: pages in `app/app/*` | **tab surface** — nav + a generic plugin page |
| 6 | `capabilities/catalog.json` entries (`installs/detects/verifies` + client copy) | the plugin's **commercial face** (sales layer) |
| 7 | Curated flows: `roles/<id>/flows/<slug>/FLOW.md`, packed into a profile | **flows surface** — the flows a plugin's work makes possible, installed to `data/flows/<slug>/` (v3) |

Install pipeline: `policy/capabilities/purchased.json` → `tools/plugin_set.py` →
`install.sh` (the folder, the delivered skills, the engine surface and the
curated flows) → `tools/agent-check.py` (post-install verification). It used to
run through `roles/build_role.py` → dist → `tools/hire-role.sh`; there are no
profiles to build.

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
    "flows": [],
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
   surface files exist, system plugins depend only on system plugins) — and,
   since v3, that every capability row installs a CLOSED set: a row whose
   plugin requires a non-system plugin that same row does not install is a
   client who buys one thing and gets half of it.
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
agents update explicitly (re-run `install.sh`, which moves the folders and
removes the ones that left the set); no per-client pins until a client needs
one.

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

- **Install per-agent, expose per-agent** (v3; it read "expose per-role" until
  the pivot came off). The folder lands once per container, like `/opt/kit`,
  and everything it carries — the skills, the tabs, the adapter routes, the
  services, the curated flows — is the agent's. There is one index and it is
  the client's. The per-role half was `skills_split.py` computing which
  teammates saw which skills, and it existed because kit-skills/ is mounted for
  the whole installation, so a teammate paid prompt for the other teammates'
  craft. With one agent there is nobody to pay for.
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

kanban, approval, deliverable, artifact, flow, capability (system) ·
transcribe, invoices-to-data, quotes, brand-kit, social-content, post-image,
drive-inbox (client). Adapter endpoint names (`/portal/approvals` etc.) do not
need to match plugin ids and stay as they are.

`capability` ended up SYSTEM and not "leaf/meta" as this list first had it: it
is core product machinery and client plugins must be able to depend on it
(phase 4). `drive-inbox` was not on the list at all and is here now — it was a
kit skill no role declared, and porting it did not change that.

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
       service surfaces are built on from phase 5 onward.
     * **The delivery** does not change, on purpose. `install.sh` flattens a
       plugin's skills into `kit-skills/`, and those copies — derived from the
       registry, through the one resolver — are still how the ENGINE sees a
       skill. Engine skill discovery was never the problem this phase had to
       solve: moving `/opt/kit/skills/<name>/` would have forced a `SKILL.md`
       path rewrite across the kit to buy nothing. (`build_role.py` did the same
       flattening into a profile until v3; there are no profiles.)

     So a plugin's skill is on an agent TWICE and both copies are load-bearing:
     the delivered one is what the agent RUNS, the registry one is what says the
     agent HAS it. `agent-check.py` compares them byte for byte, because the one
     that runs is the one nothing described.

     THE CONSEQUENCE, WHICH 3448728 WROTE DOWN AND THIS PHASE CONFIRMS: the boot
     slot-check covers plugin-vs-plugin only, BY DESIGN. The installed kit tree
     legitimately holds delivered copies of plugin skills, so a boot check that
     scanned `/opt/kit/skills` would refuse every correctly installed agent.
     Build time owns the kit-vs-plugin half — `check-plugins.py`, over the
     repo, where both homes are real and before there is an agent to install
     onto. Do not "fix" the boot check.

     What else the phase settled: the set is COMPUTED (`tools/plugin_set.py` —
     system plugins, the plugin behind a base capability, and — since v3 — what
     the capabilities the client BOUGHT install, read off
     `policy/capabilities/purchased.json`; it was what each HIRED role declared,
     read off `data/profiles/`); an update removes the folder of
     a plugin that left the set, through the manifest's own machinery and
     nothing else; the engine surface moved to `plugins/flow/engine/promises/`
     while its destination on the agent stayed byte for byte
     `policy/plugins/promises/`; and `agent-check.py` reports a pre-plugin agent
     as a pending WARNING, not a failure. Every agent alive today is one of
     those until somebody runs the installer and adds
     `./plugins:/opt/plugins:ro` to its compose — the folder installed without
     the mount is a red line, because installed and unreadable is worse than
     absent.
4. ~~**Porting wave:** everything that already existed becomes a plugin.~~
   **DONE 2026-08-23** (ab47fa8 `quotes`, `brand-kit`, `social-content`,
   `post-image` and `drive-inbox`; c9c4199 `capability` as the SIXTH system
   plugin; 0ccb4c6 the capabilities catalog's `installs.plugins` and the check
   that validates it). PHASE 4 WAS REDEFINED HERE, and by Luis: no new plugin
   and no webscraping until a client needs one — PORT WHAT EXISTS and finish the
   migration. The registry is 13 plugins and `hermes-kit/skills/` is down to the
   two shadow notes.

   What the wave settled:

   * **`requires` is a claim about a SKILL.md, and it is now populated.** Each
     dependency is a sentence in the text: quotes runs `deliver.py` by path and
     names the `approval` skill for sending; brand-kit pipes into
     `create_artifact.py` and sends a colour change through approval;
     social-content and post-image both stop dead without `brand/brand.json`
     (`new_post.py` even names brand-kit in its `next_steps`); post-image is the
     one that needs engine toolsets, `image_gen` to generate and `vision` for
     the step that LOOKS at what came out; drive-inbox needs the
     `google-workspace` connection and no plugin at all.
     `tools/test_check_plugins.py` asserts the WHOLE client graph, so a
     dependency cannot be added without a reason.
   * **`capability` is system, and not because five roles declare it.** It is
     the product's own machinery — the closed catalog, the card, the gate hook
     that redirects every blocked install to it by name — so a client plugin has
     to be able to depend on it. Its `requires` is empty and it declares no tab:
     the ask is a mention inside the answer, not a ticket and not a page.
   * **`drive-inbox` is packaged and ships nowhere.** No capability sells it,
     no base capability installs it, `system` is false. Its description says so
     in as many words. (Until v3 the sentence was "no role declares it", and
     `skills_split.py --orphan` printed its name on every team install. There is
     no `--orphan` any more: on a solo agent every skill in the kit is
     delivered, so what `drive-inbox` does not get is its PLUGIN FOLDER.)
   * **The sales layer is linked.** `capabilities/catalog.json` gained
     `installs.plugins`; `plugin_set.py` reads it directly off the `level: base`
     rows instead of inferring the plugin from a skill name that happened to
     match, and the `--why` line now names the CAPABILITY (`base capability
     (transcription)`). `plugin_registry.check_capability_installs()` refuses a
     `kit_skills` entry naming a plugin-owned skill and a `plugins` entry naming
     an unknown plugin, from `check-plugins.py` at build time and from
     `plugin_set.py` at install time. Not at boot: an agent has no
     `capabilities/catalog.json` next to its `plugins/`.
   * **NOTHING MOVED ON AN AGENT except `/opt/plugins`.** The five dists are byte
     for byte effca09's, the solo agent's install list is identical and the team
     agent's grows only by plugin FOLDERS. Measured on a transition fixture
     installed at effca09 and updated with this HEAD: `plugins/` gained the five
     new set members and exactly three files changed content — the shipped
     `plugin_registry.py`, `policy/capabilities/catalog.json` and
     `policy/roles/catalog.json`, all three ours. `agent-check` green with the
     mount, removal still names the plugin that left ("plugin 'brand-kit' is no
     longer in this agent's set"), and the installed adapter booted against a
     fresh fixture serves all 12.

   TWO ESCALATIONS FROM THE PORTING VALIDATOR, CLOSED 2026-08-24 (3f32d88,
   8487017), both of them a rule that existed and had no reader:

   * **`requires.connections` and `requires.toolsets` were shape-checked and
     never crossed.** They name ids that live outside `plugins/` --
     `connections/catalog.json` and the `platform_toolsets` block of
     `compose/config.base.yaml` -- and `plugin_registry` cannot open either,
     because it also runs at BOOT over `/opt`. The cross went into
     `check-plugins.py`, the half that knows it stands in the repo: a misspelt
     id is exit 1 naming the manifest and the id, every bad one printed.
     `agent.disabled_toolsets` is deliberately not a source -- a plugin
     requiring `tts` is requiring something this product switches off.
   * **A `level: base` capability could promise a kit skill nobody wrote, on a
     SOLO agent.** The rule lived in `roles/skills_split`, which only a team
     agent reaches. Measured: promote a menu row to base and the solo install
     exits 0 in silence while the team one exits 1. It is
     `plugin_registry.check_capability_installs` now, which `install.sh` reaches
     on EVERY agent through `plugin_set.py`. Scoped to `base` on purpose: 20 of
     the 25 menu rows name a skill still to be built, because the menu is what
     we sell and the work starts when a client buys one. (v3: there is only the
     one path now, and this rule is what it runs.)

5. **First new-surface plugins:** `webscraping` (service + skill) and one
   third-party MCP behind the guard. **DEFERRED UNTIL A CLIENT NEEDS ONE** —
   this is the phase that invents surfaces the registry has never shipped, and
   inventing them before somebody has paid for one is how a service surface gets
   designed against an imaginary client.
6. **Dynamic portal tab:** generic plugin page + manifest-driven nav.
   Riskiest, last, and it rides with the first tab-bearing plugin: every plugin
   in the registry today declares either a `builtin` page or no tab at all, so
   there is nothing for a generic page to draw yet.

## Open questions (park until their phase)

- Service-surface resource limits — decide with the first service plugin
  (phase 5 now).
- Generic-tab security model (what a plugin page may call beyond its own
  namespace) — phase 6.

## Resolved

- **Which plugins an agent gets is COMPUTED, and an agent is not the whole
  registry.** `tools/plugin_set.py` is the one answer, asked by `install.sh`
  when it ships and by `agent-check.py` when it verifies: the system plugins
  (unconditional, which is what lets anything depend on them), the plugin
  behind a `level: base` capability (the catalog promises those as already
  installed — `transcribe`, which nobody buys), and — v3 — what the
  capabilities the client BOUGHT install, read off
  `policy/capabilities/purchased.json`. A fresh client's agent therefore comes
  out with SEVEN and not with all thirteen: six system plugins plus
  `transcribe`.

  AND THE SKILL INDEX FOLLOWS IT, which closed the last place the two could
  disagree. `install.sh` delivers the HARNESS (everything under `skills/` — the
  fallback notes, which belong to every agent unconditionally) plus the skills
  of the plugins in that set, and `agent-check.py`'s `expected_skills` is the
  same function. Until 2026-08-30 a solo agent got the kit's whole catalog,
  because before there was a menu there was nothing else it could mean, and it
  was wrong in both directions: `quotes` in the index of an agent that never
  bought it is prompt paid on EVERY request for a SKILL.md whose folder — tab,
  routes, flows — was never installed, and `agent-check` demanded that SKILL.md
  forever, an eternal red line whose "run install.sh" changed nothing.

  THE THIRD SOURCE USED TO BE THE ROSTER: what each HIRED role declared in the
  kit's `role.json`, hired meaning `data/profiles/<id>/` exists. The question it
  answered — which of the things we sell did this client say yes to — did not
  change; its vocabulary did, to the ids of `capabilities/catalog.json`, which
  is what the client already reads on the card and what
  `policy/capabilities/requests.jsonl` records the ask in. No file is a fresh
  client and installs; a malformed one, one naming a capability the catalog does
  not have, or one naming a `level: base` row — already on every agent, not sold
  — stops by name. It lives in `policy/` and not in `data/` for the same reason
  the capabilities catalog does: what the client bought decides what code
  reaches the agent, and `data/` is the agent's own.

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

- **`/portal/plugins` belongs to the kit.** The adapter's `/portal/inventory`
  used to return a field called `plugins` meaning the ENGINE's plugins
  (`hermes plugins list`). As of phase 2 that field is `engine_plugins`
  (adapter 0.40.0, e601f78), renamed through `app/app/lib/agent.ts` and every
  consumer. The bare word now means a kit plugin everywhere on the portal API,
  and `/portal/plugins` was free for the registry endpoint, which phase 3a
  went on to add (c3345f0). The ENGINE's own JSON key stays `plugins` — that
  one is theirs.

- **A curated flow belongs to a PLUGIN, and that is the seventh surface**
  (v3). The sixteen `FLOW.md` lived under `roles/<id>/flows/` and travelled
  inside the profile distribution, so a flow reached a client because they
  hired the role that claimed it. They now live in the plugin whose work the
  flow is — `surfaces.flows`, a list of directories inside the plugin, each with
  a `FLOW.md` — and `install.sh` delivers the ones in THIS agent's plugin set to
  `data/flows/<slug>/`, which is where `create_flow.py` writes, where the
  adapter's FlowStore reads, and where the client can edit one exactly like a
  flow the agent wrote for them.

  OWNERSHIP IS ABOUT THE WORK, NOT THE FRONTMATTER. `seguimiento-de-presupuestos`
  names only `approval` and `deliverable` in its `skills:` and belongs to
  `quotes`, because the quotes it chases only exist if the quote writer made
  them; `conciliar-cobros` and `facturas-vencidas` belong to `invoices-to-data`
  because they read the ROWS it produces. The seven that no plugin owns — they
  exercise system skills or a base capability only — are the system `flow`
  plugin's catalog, under `plugins/flow/curated/`, which is where they stay
  until somebody writes a plugin that earns them. A manifest invented to hold a
  FLOW.md would be a plugin with nothing behind it.

  The slug has ONE source, like a skill name: `_check_flow_slots` refuses two
  plugins claiming `presupuesto-nuevo`, because they install into one directory
  and one of them would silently win.

- **A capability row has to be CLOSED on its own** (v3). `role_skills` used to
  enforce "a role that declares a plugin declares its non-system dependencies
  too", and `check_kit_skills` "a role's `skills:` may only name skills that
  live in `skills/`". Both read a `role.json`. The rules moved to the only
  declaration left: `check_capability_installs` refuses a row whose plugin
  requires a non-system plugin that same row does not install — another row
  installing it is another purchase, not this one — and the `kit_skills` half
  was already there. Caught at build time and not only at install, because
  `plugin_set.py` refuses an open set on the CLIENT'S agent, naming a catalog
  the operator standing there cannot fix.
