# Plugin system — the plan (landed 2026-08-23, phase 1 NOT started)

Status: **agreed with Luis, blocked on Phase 0** (the full-English translation
of the codebase, done in a separate session). Do not start Phase 1 before
Phase 0 lands — this plan builds on the English names.

Language rule, restated because this plan was born from violating it: from now
on EVERYTHING is English — file names, plugin ids, function names, comments,
commit messages. The only Spanish in the repo is client-facing copy
(rioplatense), which in a plugin manifest is exactly one field: `for_client`.

## Why plugins

Every client will need custom work (webscraping for one, an ERP bridge for
another). Each custom build must land as a REUSABLE unit so the second client
who asks for it gets it off the shelf. Today that unit is smeared across six
mechanisms with six names; the plugin is the package that unifies them.

## What exists today → the six surfaces of a plugin

| # | Mechanism today (real paths) | Becomes |
|---|---|---|
| 1 | Kit skills: `skills/<name>/SKILL.md` + scripts, versioned frontmatter | **skills surface** — agent-facing instructions + code |
| 2 | Hermes engine plugins: `policy/plugins/promises/` (`plugin.yaml`, hooks like `transform_llm_output`) | **engine surface** — the engine already HAS a plugin system; we ship one today |
| 3 | MCP gateway: `mcp-guard/guard.py` (hermes → gateway → real server on the internal compose net, policy mounted `:ro`, forbidden tools not even listed) | **mcp surface** — third-party MCP servers as compose services behind the gateway |
| 4 | Adapter endpoints: hand-written path-ifs in `adapter/portal_adapter.py` (~3.4k lines) | **adapter surface** — routes mounted under `/plugin/<id>/…` |
| 5 | Portal tabs: hardcoded Next pages in `app/app/*` | **tab surface** — nav + a generic plugin page |
| 6 | `capabilities/catalog.json` entries (`installs/detects/verifies` + client copy) | the plugin's **commercial face** (see "sales layer" below) |

Install pipeline that becomes plugin-aware: `roles/build_role.py` → dist →
`tools/hire-role.sh` (docker cp + hermes profile update) →
`tools/agent-check.py` (post-install verification).

## Plugin anatomy

One directory per plugin in the monorepo registry: `hermes-kit/plugins/<id>/`.
Installation moves the WHOLE folder into the agent container at
`/opt/plugins/<id>/`. Manifest is `plugin.json` (kit tooling is stdlib-json;
the engine's inner `plugin.yaml` stays as the engine surface's own file).

```json
{
  "id": "webscraping",
  "version": "1.0.0",
  "description": "Headless browser scraping, reusable across clients",
  "for_client": "Que entre a una página y te traiga los datos solos.",
  "requires": {
    "plugins": ["kanban", "approvals"],
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

Every surface is optional. A migrated leaf skill (e.g. transcription) is just
`{"skills": ["transcribe"]}` and nothing else. `id` is English, kebab-case,
and doubles as the folder name. `version` is semver. `tab.label` is
client-facing → Spanish.

## Dependency rules — fail loud, twice

1. **Build time.** `check_plugins.py` validates the registry (unique ids,
   semver, dependency closure, no cycles, declared surface files exist), and
   `build_role.py` resolves each agent's plugin set: a missing dependency
   FAILS the build. Nothing half-resolved ever ships.
2. **Boot time.** The adapter scans `/opt/plugins/*/plugin.json` at startup
   and REFUSES TO BOOT on a broken closure. An agent with `approvals` but no
   `kanban` doesn't come up degraded; it doesn't come up. (House rule: no
   protective programming — break hard.)

Constraint syntax starts minimal: bare id means "any version present". Add
`id>=N` only when a real incompatibility exists. Registry version is truth:
agents update explicitly via the update path (today `--update`); no
per-client pins until a client actually needs one.

## System plugins (the defaults)

`"system": true` = installed on every agent unconditionally, so client
plugins may depend on them freely. The dependency graph is real today — the
approvals skill literally instructs "request it IN THE TICKET you are
working" — so it becomes explicit:

```
kanban            (root: Hermes ticket store /opt/data/kanban/… +
                   /portal/boards,tickets + pipeline/tasks tabs + dispatcher)
├── approvals     (skill + /portal/approvals + tab + the gate hook)
├── deliverables  (deliver script + /portal/files + tab)
├── artifacts     (skill + /portal/artifacts + tab)
└── flows         (flow creation + /portal/flows + tab;
                   engine surface = the "promises" output-rewriter plugin)
```

## Placement decisions (agreed)

- **Install per-agent, expose per-role.** The folder lands once per container
  (like `/opt/kit` today). Each role manifest lists which plugins' SKILLS it
  sees — exactly what the skills-split logic already computes. Tabs, adapter
  routes and services are inherently per-agent.
- **Harness, not plugins:** the MCP gateway and the connections system.
  Plugins declare `requires.connections`; they never own credentials or
  policy. Policy files stay under the read-only policy mount.
- **Sales layer survives:** `capabilities/catalog.json` remains what the
  client sees and buys; an entry points at 1..n plugin ids. Plugin =
  engineering unit, capability = commercial unit.
- **Portal:** nav is built from a new `/portal/plugins` endpoint (the adapter
  serves the manifests it loaded). System plugins keep their bespoke pages
  forever via `tab.builtin`; new plugins get one generic page
  (`app/app/plugin/[id]`) that talks to `/plugin/<id>/…` routes, in the
  spirit of the artifacts viewer.

## Naming map (proposed English ids; final renames belong to Phase 0)

| Today | Plugin id |
|---|---|
| kanban / pipeline / tasks | `kanban` |
| approval | `approvals` |
| deliverable | `deliverables` |
| artifact / artifacts | `artifacts` |
| flow / flows (+ policy/plugins/promises) | `flows` |
| transcribe | `transcribe` |
| invoices-to-data | `invoice-extraction` |
| quotes | `quotes` |
| brand-kit, social-content, post-image | keep as-is (already English) |
| capability (meta-skill: request a new capability) | `capability-requests` |

## Phases (each shippable; nothing is a big bang)

0. **English translation of the existing codebase** — separate session, owns
   every rename of existing files/dirs/scripts. HARD PREREQUISITE.
1. **Spec + resolver:** `plugins/` dir, `plugin.json` schema,
   `check_plugins.py` (closure/cycles/semver/surface files). Migrate 2–3 leaf
   skills (transcribe, invoice-extraction) as pilots. `build_role.py` reads
   both the old `skills:` list and the new `plugins:` list during transition.
2. **Carve out the system plugins** as manifests OVER existing code (no code
   moves): the dependency graph becomes explicit and build-enforced.
3. **Agent-side loader:** adapter boot-scan of `/opt/plugins`,
   `/portal/plugins` endpoint, fail-loud boot check; hire/update/check
   tooling becomes plugin-aware.
4. **First new-surface plugins:** `webscraping` (service + skill) and one
   third-party MCP behind the gateway — proves the two surfaces that don't
   exist today.
5. **Dynamic portal tab:** generic plugin page + manifest-driven nav.
   Riskiest, last.

## Open questions (park until their phase)

- Service-surface resource limits (a scraping browser can eat a container) —
  decide when the first service plugin lands (phase 4).
- Generic-tab security model: what a plugin page may call beyond its own
  `/plugin/<id>/…` namespace — decide in phase 5.
- Whether `skills_split.py` sharing rules need a per-plugin override
  (`"share": "always"`) — decide with real cases in phase 2.
