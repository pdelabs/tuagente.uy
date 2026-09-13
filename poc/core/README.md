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
| `/opt/kit/plugins` | `hermes-kit/plugins`, read-only. `CORE_PLUGINS` picks which load, and each one's `core/` surface is what it adds to this engine |

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

## Plugins

**A mechanism is a plugin of the kit, not a module of this engine.** The three
this engine runs by default — `CORE_PLUGINS=approval,deliverable,flow` — are
the kit's own plugins, and each one declares `"surfaces": {"core": "core/"}` in
its `plugin.json`: a directory holding `plugin.py` and, when the mechanism
needs words, an `instructions.md`. `core/plugins.py` imports that file and
calls `register(engine)`, in `CORE_PLUGINS` order.

```
poc/core/                          the engine, and nothing about any mechanism
  core/config.py                   env -> settings; the base MODULES
  core/plugins.py                  load the plugins, hand each one the engine
  core/agent.py                    model, instructions, toolsets, capabilities
  core/session.py                  a turn: stream, persist, events. BEFORE_PERSIST,
                                   DEFERRED_HANDLER
  core/compaction.py               summarize the history away (engine)
  core/turn_usage.py               what the turn cost (engine)
  core/tracing.py                  spans to Phoenix (engine)
  core/tools/workspace.py          bash, read_file, write_file, list_files
  core/tools/skills.py             the SKILL.md index + skill_view
  core/db.py, server/*.py          storage, the two bases, the SSE dialects

hermes-kit/plugins/approval/core/  the gate: sensitive.py (the gated toolset),
                                   store.py (the row), render.py (what she
                                   reads), routes.py (/portal/approvals*),
                                   instructions.md, and SKILLS = []
hermes-kit/plugins/deliverable/core/  nothing to register: instructions.md
hermes-kit/plugins/flow/core/      the promises guard, reading promises.py from
                                   the plugin's own engine/promises/
```

`register(engine)` gets an object with seven verbs and no more:

| verb | what it adds |
|---|---|
| `engine.toolset(ts)` | a toolset the agent gets, gate and all (`EXTRA_TOOLSETS`) |
| `engine.before_persist(fn)` | `(session_id, text) -> text`, run before the answer is persisted |
| `engine.capability(cap)` | an `AbstractCapability` for the Agent (`CAPABILITIES`) |
| `engine.router(router)` | an `APIRouter`, included after the engine's own and before the 404 catch-all |
| `engine.module(name, value)` | what the portal draws; `value` may be a callable, asked when the manifest is read |
| `engine.instructions(text)` | prose into the system prompt |
| `engine.deferred(fn)` | the ONE callable that answers a run stopped at a gated tool |

Two things are not verbs. **Skills** load from `surfaces.skills` as on any
agent, unless the plugin's module defines `SKILLS` — a list that overrides the
manifest here, and `[]` means it brings none to this engine (`approval`'s
SKILL.md is Hermes-kanban prose; `flow`'s drives a runner this engine does not
have). And **`instructions.md`** is read by the loader, not by the plugin: it
goes into the prompt before anything `register()` adds.

The instructions a run is built from, in order:

```
agent/SOUL.md  +  each enabled plugin's instructions.md  +  the skills index  +  the date line
```

**Where a rule lives is decided by what can enforce it.** In CODE if code can
check it — the gate is on the tool, so asking is not something the model can
forget. In a TOOL'S DESCRIPTION if it is about using that tool — what a request
has to explain is in `send_email`'s docstring and in `ApprovalNote`'s fields. In
the SOUL only if it is about who the agent is: its name, its client, its tone,
its scope, and the list of what THIS company does not do without permission.
Nothing about tools, folders, skills or mechanisms goes in the SOUL. Everything
else is prose about a mechanism, and prose about a mechanism ships WITH the
mechanism — so it is in the prompt only where that plugin is enabled, and when
the mechanism changes there is one file to change. `flow`'s `instructions.md`
says the agent has nothing scheduled *on this engine*; the day flows land, that
file changes and nothing else does.

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
# New conversation — OpenAI-shaped. The whole local history travels and the
# session is matched from the CLIENT's turns in it (the assistant's are the
# engine's to rewrite, so the browser's copy of one is not the one on disk).
# Ends in `data: [DONE]`.
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

Two things both dialects do at the end of a turn. **What was persisted is what
the bubble ends in**: the session dialect has `assistant.completed`, which the
portal treats as the authoritative content, and the OpenAI one — which only
accumulates deltas — reconciles what it streamed against what was persisted and
sends the difference as one last delta. The promises correction and the pause
message both arrive that way. **A turn that breaks says so**: one assistant
line, `No pude responder: <reason>`, persisted, written to Activity as an
`error` event and streamed in both dialects; then the exception goes on to the
log with its stack.

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

Approvals are a PLUGIN of this engine, not part of it: everything below is in
`hermes-kit/plugins/approval/core/`, loaded because `approval` is in
`CORE_PLUGINS`. Take it out of that list and the engine has no gate, no
Approvals tab and not a word about permission in its prompt.

The gate is on the TOOL, not on the model remembering to ask: the toolset in
`sensitive.py` is registered wrapped in `approval_required()`, so the run stops
before the tool body runs. What happens then, in order:

1. The run ends with `DeferredToolRequests` as its output instead of text, and
   `core/session.py` hands it to the plugin's `paused()` through
   `DEFERRED_HANDLER` — the engine knows a run can stop and nothing else.
2. The plugin's `store.py` writes A NEW ROW, one per request: the body rendered
   by its `render.py` from the tool's arguments and its `ApprovalNote`, the
   serialized requests, and THE RUN'S MESSAGES. That last one is what survives
   a `docker kill`. A row is reused ONLY by the resumed run of that same row,
   which names it — a second gated turn on the same conversation opens its own
   row instead of overwriting the card the client is about to approve.
3. The chat gets the pause message, written by the code and persisted like any
   other. The session's own history does NOT advance: a history that ends in an
   unanswered tool call is not replayable by the next turn.
4. Approve and reject both CLAIM the row before resuming: unknown id → 404,
   anything but `pending` → 409, and the row moves to `resolving` with the
   decision on it BEFORE the run starts. Two clicks on the same card used to
   run the tool twice, and a crash between the tool and the row's update left
   the row pending with the mail already sent. A row left in `resolving` by a
   crash stays there: the retry reads the 409, not a second side effect.
5. Reject → the reason is stored as a `cliente` comment and reaches the model as
   `ToolDenied`; the resumed run proposes again on THE SAME ROW, which goes
   back to `pending` with the new tool call ids (the previous ones are gone
   from the row and can never be resumed). A "no" never takes the request out
   of the queue — only `final` closes it.
6. Approve → `ToolApproved`, and a correction rides as `override_args` with
   `client_correction` merged into the call the model made.
7. When the resumed run answers in text, the answer is persisted on the session
   AND appended as an `agente` comment, and the row closes as `approved` or
   `rejected`.

**The resumed branch is appended, never written over the session.** An approval
can sit in the queue for a day while the client keeps talking to the agent, and
the branch the row carries was forked when the run paused. What goes onto the
session's CURRENT history is the branch from the pause point on — the
`ModelResponse` with the tool call, the `ModelRequest` with its result, and
whatever the run said after. The provider reads that as a call answered
immediately, which is what it is. The paused user request itself is not in the
engine's history until the approval resolves; the client sees it in the chat
from the moment she sends it, because the displayed messages and the engine's
history are two different stores.

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

Three parts: the kit's own case through the BEFORE_PERSIST chain with no model
(the 8/13 phrase gets the correction, a loose deliverable does not), the
natural ask (the agent is told to claim a schedule — the SOUL holds and it
refuses, which is printed), and the seam itself (the agent is made to emit
the claim verbatim, and `GET /api/sessions/{id}/messages` returns the
corrected text). The last one is the gate: what the portal reads back is what
the hook returned, not what the model said.

The guard itself is `hermes-kit/plugins/flow/core/plugin.py`, which loads the
kit's `promises.py` from the plugin's own `engine/promises/` by path: one copy
of the module, two engines reading it.

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

## Known limits

Measured or read in the code, left standing on purpose. None of them is a gate.

- **The compaction summarizer's tokens are not in the turn's usage.**
  `core/turn_usage.py` writes `usage` off the main run's result, and the
  summary is a separate `Agent.run()` inside the `ProcessHistory` capability.
  Its tokens are on the `compaction` event instead, so a turn that compacted
  cost more than its `turn_usage` row says. The provider's own meter, which is
  what `GET /portal/usage` shows, has both.
- **`tests/cost.py`'s per-turn numbers are indicative; the aggregate is what
  holds.** It polls OpenRouter's `/api/v1/key` for a delta, and spend lands
  there late and in its own time: the script cannot tell "nothing yet" from
  "zero", and a turn's spend can land while it is reading the next one's, which
  moves money from one row of the table to another. Nothing else may be talking
  to the agent while it runs, and even then read the total, not a cell.
- **Displaying a message and persisting the history are two commits.** SQLite
  writes them one after the other (`db.add_message` then `db.save_history`), so
  a crash in between leaves the client reading an answer the engine will not
  replay. One transaction would fix it; the POC does not need it to answer the
  question it exists to answer.
- **A bash timeout kills the turn instead of the tool.** `subprocess.run(...,
  timeout=60)` raises, nothing catches it, and 60 s of a command now reach the
  client as "No pude responder: Command ... timed out". A tool error the model
  can read and work around would be better, and it is one `except` in
  `core/tools/workspace.py`.
- **Session matching is O(sessions × messages).** `match_session` reads every
  session's messages out of SQLite to compare user turns on every new
  conversation. At the POC's scale it is microseconds; at a client's it wants
  a hash of the client's turns on the session row.

## Where the next waves plug in

| Seam | Where |
|---|---|
| Anything a PLUGIN brings | its `core/plugin.py` and the seven verbs of `register(engine)` — see **Plugins** above. Everything below is what those verbs write into |
| Extra toolsets (sensitive tools, anything gated) | `EXTRA_TOOLSETS` in `core/agent.py`, appended before the first turn; read when the agent is built |
| Agent capabilities (compaction, `ReinjectSystemPrompt`) | `CAPABILITIES` in `core/agent.py` |
| Text transform before the message is persisted | `BEFORE_PERSIST` in `core/session.py` — a list of `(session_id, text) -> text`, run in order, and what they return is what gets persisted AND what `assistant.completed` carries |
| A run that stopped at a gated tool | `DEFERRED_HANDLER` in `core/session.py` — ONE callable, `(session_id, requests, history) -> text` |
| The event log | `db.append_event(kind, label, status, session_id, payload)` (the plan calls it `events.append`) |
| New tabs | a route in `server/portal.py` (or a router of its own, like `server/extra.py`, or a plugin's) plus its flag in `core/config.py`'s `MODULES` or `engine.module(...)` |
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

## Traces (Phoenix, self-hosted)

Every run is a span tree: `invoke_agent` → one `chat <model>` per model
request (messages in and out, tokens, cost) → one `execute_tool <name>` per
tool call (arguments, return). Pydantic AI emits them as OpenTelemetry;
`core/tracing.py` adds the OpenInference processor Phoenix reads and posts
them straight to Phoenix's OTLP endpoint. No Logfire, no collector, no
account.

- Viewer: http://127.0.0.1:6006 (the `phoenix` service in the compose,
  loopback only, data under `state/phoenix/`).
- `CORE_OTEL_ENDPOINT` empty = off. The lab compose points it at the
  service; a client's compose leaves it empty or sets
  `CORE_OTEL_INCLUDE_CONTENT=0` so the spans carry timings and names but no
  prompts, completions or tool arguments.
- REST for scripts: `GET /v1/projects/default/spans?limit=50`.
