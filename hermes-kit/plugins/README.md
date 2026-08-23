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
| `system` | `true` = installed on every agent, so anyone may depend on it |

`requires` sub-lists and `surfaces` entries may be left out; unknown keys are a
hard error, like everywhere else in the kit's closed catalogs. `_comment` (a
string or a list of strings) is allowed and ignored.

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

**Phase 1 — today — the plugin folder is repo-side packaging only.** Nothing
changed inside the container: at dist-assembly time a plugin's skills are
flattened back into the layout the agent has always had, so
`plugins/transcribe/skills/transcribe/` installs at `/opt/kit/skills/transcribe/`
exactly like `skills/transcribe/` used to, and every `SKILL.md` keeps the paths
it already had. `/opt/plugins/<id>/` arrives in phase 3.

That flattening is what `roles/build_role.py` and `install.sh` do, both through
the one resolver in `tools/plugin_registry.py`. A skill name may exist in
`skills/` **or** in one plugin's skills surface, never in two places: the
flattened layout has one slot per name and the validator says so.

## Verify

```bash
python3 hermes-kit/tools/check-plugins.py
python3 -m unittest discover -s hermes-kit/tools -p "test_*.py"
```

A broken registry is not a warning. Duplicate ids, an id that is not its folder
name, a version that is not semver, a dependency on a plugin that does not
exist, a dependency cycle, a declared surface whose file is missing, a system
plugin depending on a non-system one, malformed JSON: every one of those stops
the check, the build and the install.
