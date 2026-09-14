# How the native kanban tools actually get enabled

**Resolved on 2026-08-04.** Replaces the `kanban_tools` plugin, which we deleted.

## The recipe

Two keys, both in `data/config.yaml`. With only one, the agent sees **none**
of the kanban tools and ends up improvising with Python over its own board.

```yaml
toolsets:
  - kanban            # opens the gate (check_fn in tools/kanban_tools.py)

platform_toolsets:    # passes the gateway's per-platform filter
  api_server:
    - hermes-api-server
    - kanban
  telegram:
    - hermes-telegram
    - kanban
  cron:
    - hermes-cron
    - kanban
```

Each platform's default composite (`hermes-api-server`, etc.) has to be there
too: if you list only `kanban`, you strip the agent of everything else.

## Why it wasn't guessable

`toolsets: [kanban]` does make the `check_fn` pass — you can verify that by
hand and it comes back `True`, which is exactly what made us believe it was
enough. But the gateway assembles the session with
`_get_platform_tools(config, platform)`, and there `kanban` **is not a
"configurable" toolset**: it's not in `CONFIGURABLE_TOOLSETS`, so it can't be
requested the normal way. It only comes in if it shows up in
`platform_toolsets`, or if some **installed plugin** declares it in its
`provides_tools` — which is what our plugin was doing without us knowing it.

## The reproduction (in case this gets reported upstream)

Same agent, changing only the config and restarting the gateway:

| Config | Tools in the `api_server` session |
|---|---|
| `toolsets: [kanban]` alone | 25 — **none from kanban** |
| `toolsets: [kanban]` + a plugin declaring `provides_tools: [kanban]` | 40 — the 12 native ones |
| `toolsets: [kanban]` + `platform_toolsets` with kanban | 37 — the 12 native ones |
| `platform_toolsets` with kanban, **without** `toolsets` | **none from kanban** |

```python
from hermes_cli.config import load_config
from hermes_cli.tools_config import _get_platform_tools
from model_tools import get_tool_definitions
cfg = load_config()
ts = sorted(_get_platform_tools(cfg, "api_server"))
n = [d["function"]["name"] for d in get_tool_definitions(enabled_toolsets=ts, quiet_mode=True)]
print([x for x in n if "kanban" in x])
```

What's worth reporting isn't code: it's that a toolset gated by `check_fn`
and not declared as configurable becomes unreachable through configuration,
with no message anywhere saying so.

## The lesson that cost an entire plugin

I believed the agent when it said *"no tengo disponible `kanban_show`"* and
built a plugin on top of that answer. Two things were wrong:

1. **A model's self-report is not evidence of what tools it has.** The
   registry is. It's three lines of Python and I had them at hand the whole
   time.
2. **The question itself was malformed**: our plugin exposed a single tool
   called `kanban`, so "I don't have `kanban_show`" was literally true and
   proved nothing about the native toolset.
