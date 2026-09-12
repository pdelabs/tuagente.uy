# core — the POC engine

The portal of `app/app/`, unchanged, pointed at an engine built on Pydantic AI
2.43 instead of Hermes. The plan, the decisions and the gates are in
`docs/poc-core-plan.md`; this file is how to run it.

One FastAPI app serves both of the portal's bases — the gateway (`/api/*`) and
the adapter (`/portal/*`) — and the compose publishes it on `127.0.0.1:8642`
and `127.0.0.1:8643` so the magic link can point both at the same container.

## Run it

```bash
cd poc/core
cp secrets.env.example secrets.env    # OPENROUTER_API_KEY + API_SERVER_KEY
docker compose up --build -d
docker compose logs -f
```

The container runs as uid 10000 (`docker exec tuagente-core id`), and `state/`
and `workspace/` are bind mounts it has to write. They were made writable with
`chmod 777 state workspace` on the host — enough on Docker Desktop, where the
bind mount does not carry the host's ownership; on a Linux host use
`sudo chown -R 10000:10000 state workspace` instead.

What lives where:

| Path | What |
|---|---|
| `state/core.db` | SQLite (WAL): sessions, messages, history, approvals, events |
| `state/identity.json` | what the client changed from the portal; wins over the seed |
| `workspace/` | the agent's only writable ground: `entrada/` in, `entregables/` out |
| `agent/SOUL.md` | the client section + the `core:base` block, mounted read-only |
| `/opt/kit/plugins` | `hermes-kit/plugins`, read-only. `CORE_PLUGINS` picks which load |

## The magic link

```
http://localhost:8090/app#endpoint=http://127.0.0.1:8642&adapter=http://127.0.0.1:8643&key=<API_SERVER_KEY>
```

`npx next start -p 8090` from the repo root serves the portal. The key is in
`secrets.env`; the link is the only place it travels.

The seeded identity has `contact.channel: "none"`, which the portal reads as
"offer the notification step again". If the walkthrough should skip it, set
`"contact": {"channel": "email", "value": "…"}` in `agent/identity.json` (or
`state/identity.json`, which wins) before opening the link.

## Check it

```bash
KEY=$(grep '^API_SERVER_KEY=' poc/core/secrets.env | cut -d= -f2-)
python3 hermes-kit/tools/portal-check.py --key "$KEY" \
    --endpoint http://127.0.0.1:8642 --adapter http://127.0.0.1:8643 \
    --origin http://localhost:8090
```

Last run: **11 ok · 5 warnings · 0 failures**. The five warnings are modules
the manifest does not declare — `kanban` and `artifacts` and `crons` never
will (out of scope, `docs/poc-core-plan.md`), `approvals` is Wave 2's to flip
and `usage` is Wave 3's, both in `core/config.py`'s `MODULES`.

Both chat dialects by hand:

```bash
# New conversation — OpenAI-shaped. The whole local history travels; the
# session is matched from it. Ends in `data: [DONE]`.
curl -sN -X POST http://127.0.0.1:8643/portal/chat/stream \
  -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d '{"stream":true,"messages":[{"role":"user","content":"Hola, ¿qué podés hacer por la ferretería?"}]}'

# The session it opened
curl -s -H "Authorization: Bearer $KEY" http://127.0.0.1:8642/api/sessions

# Resumed conversation — session-shaped, named events. A message that makes it
# use a tool shows the whole trail.
curl -sN -X POST http://127.0.0.1:8643/portal/sessions/<id>/chat/stream \
  -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d '{"message":"Listá los archivos del workspace y decime cuántos hay."}'
```

The second one answers, in this order: `run.started`, `tool.started`
(`{"tool_name": "list_files"}`), `message.started`, `assistant.delta` …,
`assistant.completed`, `run.completed`, `done`.

## Gates

From `docs/poc-core-plan.md`. Wave 1 owns none of them outright; what it had to
leave standing is here.

| # | Gate | State |
|---|---|---|
| G1 | Fail-closed approval that survives a crash | **not yet** — Wave 2 |
| G2 | The existing portal works with only the magic link changed | **portal-check 0 failures**; the browser walkthrough is Wave 5's |
| G3 | Kit plugins load as toolsets, SKILL.md unchanged | **works already**: asked in chat for an informe, the agent read the skill with `skill_view`, ran `/opt/kit/skills/deliverable/deliver.py` and the file landed in `workspace/entregables/`. Wave 2 owns the gate |
| G4 | Compaction | **not yet** — Wave 3 |
| G5 | The promises check rewrites the PERSISTED message | **not yet** — Wave 3; the seam is `core/session.py`'s `BEFORE_PERSIST` |
| G6 | Cost per turn on the baseline model | **not yet** — Wave 3 |

## Where the next waves plug in

| Seam | Where |
|---|---|
| Extra toolsets (sensitive tools, anything gated) | `EXTRA_TOOLSETS` in `core/agent.py`, appended at import time; read on the first turn |
| Agent capabilities (compaction, `ReinjectSystemPrompt`) | `CAPABILITIES` in `core/agent.py` |
| Text transform before the message is persisted | `BEFORE_PERSIST` in `core/session.py` — a list of `(session_id, text) -> text`, run in order, and what they return is what gets persisted AND what `assistant.completed` carries |
| The event log | `db.append_event(kind, label, status, session_id, payload)` (the plan calls it `events.append`) |
| New tabs | a route in `server/portal.py` plus its flag in `core/config.py`'s `MODULES` |

## What Pydantic AI 2.43 actually does

- `pydantic-ai-slim[openrouter]==2.43.0` — the `openrouter` extra exists under
  that exact name, and `openrouter:openai/gpt-5.6-luna` infers an
  `OpenRouterModel` with no provider wiring of our own.
- Streaming is `async with agent.run_stream_events(...) as events:` — an async
  context manager over an `AgentRunEvents` iterator, not a plain async
  generator. Text arrives as `PartStartEvent(part=TextPart)` +
  `PartDeltaEvent(delta=TextPartDelta)`, a tool starting as
  `FunctionToolCallEvent(part.tool_name)`, and the run closes with a trailing
  `AgentRunResultEvent` whose `.result.all_messages()` is what gets persisted.
- Toolsets are `pydantic_ai.toolsets.FunctionToolset`, registered with
  `@toolset.tool` and passed to `Agent(toolsets=[...])`. Wave 2's gate has
  `FunctionToolset.approval_required(...)` waiting for it.

## Two things that are not optional, and why

- **`--http h11` in the Dockerfile.** uvicorn's default httptools writer
  lowercases every response header name on its way out.
- **The `CanonicalHeaders` middleware in `server/app.py`.** Starlette spells
  every header it writes in lowercase, and `portal-check.py` reads them out of
  `dict(res.headers)` — the case that came off the wire. Lowercase cost four
  CORS failures and one `Content-Type` failure that were pure artifact. The
  kit's own adapter capitalizes them; so does this now.
