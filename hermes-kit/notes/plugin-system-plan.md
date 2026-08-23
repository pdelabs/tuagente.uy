# Plugin system — the plan (v2, revalidated 2026-08-23 after the English translation)

Status: **Phase 0 DONE** (full-English translation, commits c0da1f4..f7ea931)
and **Phase 1 DONE** — 925a933 (registry, manifest schema, check-plugins),
469d595 (transcribe and invoices-to-data migrated, build_role resolving
plugins), plus a32b430 and b8e73bb from an independent revalidation. **Phase 2
is next.** Plan agreed with Luis on 2026-08-23; v2 only updates paths and ids
to the translated tree — no decision changed.

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
| 2 | Hermes engine plugins: `policy/plugins/promises/` (`plugin.yaml`, hooks like `transform_llm_output`) | **engine surface** — the engine already HAS a plugin system; we ship one |
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
2. **Boot time (phase 3).** The adapter scans `/opt/plugins/*/plugin.json`
   at startup and REFUSES TO BOOT on a broken closure. No degraded half-boot
   — house rule: break hard.

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
                  engine surface = policy/plugins/promises)
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
2. **Carve out the system plugins** ← current: as manifests OVER existing
   code (no code moves): the dependency graph becomes explicit and
   build-enforced.
3. **Agent-side loader:** adapter boot-scan of `/opt/plugins`,
   `/portal/plugins` endpoint, fail-loud boot check; hire/update/check
   tooling plugin-aware.
4. **First new-surface plugins:** `webscraping` (service + skill) and one
   third-party MCP behind the guard.
5. **Dynamic portal tab:** generic plugin page + manifest-driven nav.
   Riskiest, last.

## Open questions (park until their phase)

- Service-surface resource limits — decide with the first service plugin
  (phase 4).
- Generic-tab security model (what a plugin page may call beyond its own
  namespace) — phase 5.
- Whether `skills_split.py` sharing rules need a per-plugin override — decide
  with real cases in phase 2.
