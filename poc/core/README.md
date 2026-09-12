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
| `state/cron/jobs.json` | what runs on its own. Always `{"jobs": []}` here: the POC has no cron, and the promises check reads it to say so |
| `state/promises/` | the `data/` dir the kit's promises module expects — two symlinks, `flows` → `workspace/flows` and `cron` → `state/cron` |
| `workspace/` | the agent's only writable ground: `entrada/` in, `entregables/` out, `outbox/` what a sensitive tool did |
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

Last run: **13 ok · 3 warnings · 0 failures**. The three warnings are the
modules the manifest does not declare — `kanban`, `artifacts` and `crons`,
out of scope in `docs/poc-core-plan.md` and never coming. `approvals` and
`usage` are declared and answer.

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
| G1 | Fail-closed approval that survives a crash | **passes**: `./tests/test_approval_crash.sh` against the running container — one gated turn, `docker kill`, five rejections, approve with a correction. 32 checks, 0 failures |
| G2 | The existing portal works with only the magic link changed | **portal-check 0 failures**; the browser walkthrough is Wave 5's |
| G3 | Kit plugins load as toolsets, SKILL.md unchanged | **works already**: asked in chat for an informe, the agent read the skill with `skill_view`, ran `/opt/kit/skills/deliverable/deliver.py` and the file landed in `workspace/entregables/`. Nothing in Wave 2 changed that: the plugin's skill still loads from its own frontmatter, unmodified |
| G4 | Compaction | **passes**: `python3 tests/test_compaction.py` — 41 turns on one session, 39 compactions, the persisted history ends at **7 messages** against 82 displayed, and the fact planted at turn 2 is still answered. 249 s, US$0.0198 |
| G5 | The promises check rewrites the PERSISTED message | **passes**: `python3 tests/test_promises.py` — the kit's own 8/13 phrase comes back corrected, the deliverable counter-case comes back untouched, and `GET /api/sessions/{id}/messages` returns the corrected text |
| G6 | Cost per turn on the baseline model | **measured**: `python3 tests/cost.py` — **US$0.000564** conversational and **US$0.000859** with four tool calls, against a baseline of US$0.0036 and US$0.0247. The engine's own estimate matched the provider's meter to the last decimal on both |

## Approvals

The gate is on the TOOL, not on the model remembering to ask: the toolset in
`core/tools/sensitive.py` is exported wrapped in `approval_required()`, so the
run stops before the tool body runs. What happens then, in order:

1. The run ends with `DeferredToolRequests` as its output instead of text.
2. `core/approvals.py` writes the row: the body rendered by `core/render.py`
   from the tool's arguments and its `ApprovalNote`, the serialized requests,
   and THE RUN'S MESSAGES. That last one is what survives a `docker kill`.
3. The chat gets the pause message, written by the code and persisted like any
   other. The session's own history does NOT advance: a history that ends in an
   unanswered tool call is not replayable by the next turn.
4. Reject → the reason is stored as a `cliente` comment and reaches the model as
   `ToolDenied`; the resumed run proposes again and THE SAME ROW is updated. A
   "no" never takes the request out of the queue — only `final` closes it.
5. Approve → `ToolApproved`, and a correction rides as `override_args` with
   `client_correction` merged into the call the model made.
6. When the resumed run answers in text, the answer is persisted on the session
   AND appended as an `agente` comment, and the row closes.

Approve and reject answer only after the resumed run finished (3–20 s), so the
portal's refresh reads the outcome and not the row as it was a second ago. The
resumed run has no stream attached: its answer shows up in the chat on the next
load, which the plan takes as acceptable for the POC.

**The outbox.** `send_email` and `publish_post` are fake, and deliberately so:
their whole side effect is one markdown file in `workspace/outbox/`
(`email-<stamp>-<to>.md`, `post-<stamp>-<channel>.md`) with the client's
correction on a line of its own. It is the only evidence that the tool ran, and
the Files tab shows it.

## Compaction, promises and what a turn costs (G4, G5, G6)

Three scripts, all run from the repo root against the container that is
already up. None of them needs anything installed on the host.

### G4 — compaction

```bash
python3 poc/core/tests/test_compaction.py     # ~4 min, ~US$0.02
```

It restarts the container with `CORE_COMPACT_AT_TOKENS=6000` through the
compose passthrough, opens one session, plants a fact at turn 2 ("mi
proveedor de bisagras se llama Ferretería Ríos y entrega los jueves"), drives
38 more turns that each write or read a file, asks about the fact at turn 41,
and puts the default threshold back on the way out.

Last run: **39 compactions, persisted history 7 messages against 82
displayed, 249 s, US$0.0198, the fact still answered.**

Three things it settled, none of them guessable from the docs:

- **The processed list IS what gets persisted.** `ProcessHistory` assigns it
  back to the run state (`_agent_graph.py`: `ctx.state.message_history[:] =
  messages`), so `result.all_messages()` at the end of the run is the
  compacted history and `core/session.py` stores it unchanged. Nothing in
  session.py had to move, and the risk `docs/poc-core-plan.md` names —
  "persisted vs sent history under a processor" — does not exist here.
- **The context-window fraction is a dead knob on this model.** `CORE_COMPACT_AT`
  is a fraction of the model's window and `openai/gpt-5.6-luna`'s window is
  1_050_000 tokens, so the default 0.6 means 630_000 tokens. What bounds the
  history is `CORE_COMPACT_AT_TOKENS` (4 characters per token over the
  serialized messages). Either one trips compaction; on a small-window model
  the fraction would trip first.
- **Re-summarizing a summary loses the fact.** The first run of this test
  summarized the summary on every turn — 39 games of telephone — and by turn
  41 "Ferretería Ríos" had been replaced by a list of the files written
  since. The fix is in `core/compaction.py` and it is the house rule: the
  code carries the previous summary forward WORD FOR WORD and the model only
  summarizes the turns it has not seen. The running summary is folded back
  through the model only when it passes `SUMMARY_CAP` (4 KB), which happened
  once in 39 compactions and the fact survived it.

### G5 — the promises check rewrites the persisted message

```bash
python3 poc/core/tests/test_promises.py       # ~30 s, ~US$0.002
```

Three parts: the kit's own case through `core/promises_hook.py` with no model
(the 8/13 phrase gets the correction, a loose deliverable does not), the
natural ask (the agent is told to claim a schedule — the SOUL holds and it
refuses, which is printed), and the seam itself (the agent is made to emit
the claim verbatim, and `GET /api/sessions/{id}/messages` returns the
corrected text). The last one is the gate: what the portal reads back is what
the hook returned, not what the model said.

The one-line version of the phrase — "Queda definido: viernes a las 9:30 te
mando el control de contratos" — does **not** fire, and that is the module
working: `review()` wants a closing claim AND a recurrence hint, and there is
no recurrence word in that line. The kit's own case carries it in the second
line ("para dejarlo andando").

### G6 — what a turn costs

```bash
python3 poc/core/tests/cost.py                # ~2 min, ~US$0.002
```

Priced the way `hermes-kit/notes/cost-and-engine-findings.md` §1 prices one:
the turn goes through `POST /portal/chat/stream` with the whole history, and
`GET /api/v1/key` is polled until the delta stops moving for 20 s. **Nothing
else can be talking to this agent while it runs** — the first attempt read
US$0.001858 for a conversational turn because the compaction gate's spend was
still landing.

| turn | tools | s | metered US$ | engine US$ | baseline US$ |
|---|---|---|---|---|---|
| conversational | 0 | 2 | 0.000564 | 0.000564 | 0.0036 |
| with tools | 4 | 8 | 0.000859 | 0.000859 | 0.0247 |

The engine's own number is `usage.cost` (genai-prices), written per turn as a
`turn_usage` event by `core/turn_usage.py`. It matched the provider's meter to
the last decimal on both rows, which is §2's finding reproduced on another
engine: the estimate IS the charge, and the polling harness is not needed
again.

**The two money columns are not the same comparison.** The prompt is: 2028
input tokens conversational here against a Hermes turn carrying the platform
preamble and twelve toolsets. But the tool row is also doing less work — four
tool calls against the baseline's 12 to 42, and no deliverable written — so
read US$0.000859 as "a light tool turn on a small prompt", not as "the same
turn for 29× less".

## Where the next waves plug in

| Seam | Where |
|---|---|
| Extra toolsets (sensitive tools, anything gated) | `EXTRA_TOOLSETS` in `core/agent.py`, appended at import time; read on the first turn |
| Agent capabilities (compaction, `ReinjectSystemPrompt`) | `CAPABILITIES` in `core/agent.py` |
| Text transform before the message is persisted | `BEFORE_PERSIST` in `core/session.py` — a list of `(session_id, text) -> text`, run in order, and what they return is what gets persisted AND what `assistant.completed` carries |
| The event log | `db.append_event(kind, label, status, session_id, payload)` (the plan calls it `events.append`) |
| New tabs | a route in `server/portal.py` (or a router of its own, like `server/extra.py`) plus its flag in `core/config.py`'s `MODULES` |
| Anything that wants the run's result — usage, cost, what it answered | an `AbstractCapability` with `after_run`, like `core/turn_usage.py`. It is where the result exists, and it needs nothing from `core/session.py` |

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
- `ProcessHistory(processor)` in `capabilities=` runs the processor before
  every model request of the run — including each round trip of a tool loop,
  which is why `core/compaction.py` keys a guard on `ctx.run_id` — and the
  list it returns REPLACES the run's state, so `all_messages()` is the
  processed one. `ReinjectSystemPrompt()` is a no-op on an agent that uses
  `instructions=` rather than `system_prompt=`: there is no system prompt in
  the history for a summary to drop.
- `result.usage` is a property, not a call, and it carries `cost` — a
  `Decimal | None` from genai-prices. `ctx.context_window_used` is the last
  response's `total_tokens` over `model.context_window`, and `None` until the
  first response of the session.
- Toolsets are `pydantic_ai.toolsets.FunctionToolset`, registered with
  `@toolset.tool` and passed to `Agent(toolsets=[...])`.
- The gate is `toolset.approval_required()`, and it only stops a run if the
  run can END in the request: `output_type=[str, DeferredToolRequests]` is
  passed per run in `core/session.py`. Without it the call raises instead of
  returning the pending calls. Resuming is `agent.run(message_history=…,
  deferred_tool_results=DeferredToolResults(approvals={tool_call_id: …}))`
  with no user prompt. `ToolApproved.override_args` REPLACES the model's
  arguments — merging the correction into them is ours to do.

## Two things that are not optional, and why

- **`--http h11` in the Dockerfile.** uvicorn's default httptools writer
  lowercases every response header name on its way out.
- **The `CanonicalHeaders` middleware in `server/app.py`.** Starlette spells
  every header it writes in lowercase, and `portal-check.py` reads them out of
  `dict(res.headers)` — the case that came off the wire. Lowercase cost four
  CORS failures and one `Content-Type` failure that were pure artifact. The
  kit's own adapter capitalizes them; so does this now.
