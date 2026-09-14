# The engine — plan

> Written as the plan of a proof of concept. On 2026-09-14 Luis decided
> the engine stays and Hermes goes (`docs/PENDING.md`), and the code moved
> from `poc/core/` to `engine/`. Kept as the record of the gates and the
> decisions; the rest of the wording is as it was written.

Written 2026-09-12. Decision context: `docs/COMPACT.md` "Hard lessons" and
`docs/PENDING.md` list what Hermes does wrong for us. The four that decide
the question are (1) the approval gate fails open under load, (2) the
engine persists a turn before the output transform, so corrections vanish,
(3) the version freeze with seven line-level couplings, (4) kanban's ticket
lifecycle leaking into the client's UX. The plan builds a minimal engine on
Pydantic AI 2.43 and points the EXISTING portal at it, unchanged, to see
whether those four close by construction and what the portal looks like on
top.

It lives in `engine/`, it is excluded from Vercel, and at the time nothing
in `app/` or `hermes-kit/` changed because of it. The verdict goes in
`docs/engine-verdict.md` at the end.

## What it must prove (the gates)

| # | Gate | How it is verified |
|---|---|---|
| G1 | **Fail-closed approval that survives a crash.** A sensitive tool call pauses the run; the pending request is on disk; `docker kill` the engine; restart; approve from the portal; the run resumes and the tool runs. Five rejections in a row on the same request do not kill it. | `engine/tests/test_approval_crash.sh` against the running container, plus the browser. |
| G2 | **The existing portal works with only the magic link changed.** Chat streams (new and resumed conversation), tool trail shows, the sessions list fills, Approvals shows the pending card with the agent's proposal, approve / reject / approve-with-corrections work, Files lists the workspace, Activity lists events, Usage shows the key's spend. | `portal-check.py` 0 failures against the engine (`--endpoint`/`--adapter` both at the engine), then a browser walkthrough with screenshots. |
| G3 | **Kit plugins load as toolsets, SKILL.md unchanged.** The `deliverable` plugin's skill is indexed from its frontmatter, its script runs from the mounted kit path, the deliverable lands in `workspace/entregables/` and Files shows it. | Ask for a deliverable in chat; check the file and the Files tab. |
| G4 | **Compaction.** With the threshold lowered by env, a tool-heavy session of 40 turns keeps the persisted history bounded and the agent still answers a question about turn 2. | `engine/tests/test_compaction.py` (uses the real model, cheap). |
| G5 | **The promises check rewrites the PERSISTED message.** A response claiming a scheduled flow with no flow on disk goes out with the correction appended, and `GET /api/sessions/{id}/messages` returns the corrected text. | `engine/tests/test_promises.py` (unit, no model) + one live turn. |
| G6 | **Cost per turn on the baseline model.** One conversational and one tool-heavy turn priced off the run's usage and checked against OpenRouter's `/api/v1/key` delta, compared with `hermes-kit/notes/cost-and-engine-findings.md` §3 (US$0.0036 conversational, US$0.0247 with tools, on `openai/gpt-5.6-luna`). | `engine/tests/cost.py` prints the table. |

## Decisions (made, not to be re-derived by the implementers)

- **Language and runtime**: Python 3.12 in Docker (`python:3.12-slim`), `pydantic-ai-slim[openrouter]==2.43.0`, FastAPI + uvicorn, stdlib `sqlite3` in WAL mode. No ORM, no Redis, no queue.
- **Model**: `openrouter:openai/gpt-5.6-luna` by default (`CORE_MODEL` env), the same model the cost baseline was measured on. Key from `OPENROUTER_API_KEY`. The same model does compaction summaries.
- **One process, one app, two host ports.** The portal has two bases: `endpoint` (gateway, `/api/*`) and `adapter` (`/portal/*`). The engine serves both from one FastAPI app; the compose publishes the container port on `127.0.0.1:8642` AND `127.0.0.1:8643`. The magic link points both at it.
- **Auth**: `Authorization: Bearer <API_SERVER_KEY>` on everything; 401 otherwise. CORS reflects the origin if it is in `CORE_CORS_ORIGINS` (default `http://localhost:8090,http://127.0.0.1:8090`), on responses AND preflight, `Access-Control-Allow-Headers: Authorization, Content-Type`, methods `GET, POST, PATCH, DELETE, OPTIONS`.
- **Sandbox**: the container runs as uid 10000. Tools operate under `/workspace` (a bind mount). `bash` runs `subprocess` with `cwd=/workspace`, 60 s timeout, output capped at 20 KB. File tools resolve paths with `resolve()` + `relative_to(WORKSPACE)` and refuse anything outside (raise, do not sanitize).
- **State**: `/state/core.db` (SQLite). Tables: `sessions`, `messages` (what the portal displays), `history` (one row per session: the Pydantic AI message list as JSON via `ModelMessagesTypeAdapter`), `approvals`, `approval_comments`, `events`. `events` is append-only and every state change writes one; Activity is a projection of it.
- **Approvals are tool-level, not a separate "ask" tool.** Sensitive tools are marked and wrapped with `toolset.approval_required(...)`. Each sensitive tool takes a required `note: ApprovalNote` argument (`what`, `if_approved`, `if_rejected`, `why`) so the model supplies the words and the code supplies the format: the request body shown in the portal is rendered by code from the tool name, its args and the note, in the same shape `plugins/approval/skills/approval/format_request.py` produces. The gate cannot be forgotten because it is on the tool, not on the model remembering to ask.
- **Approval lifecycle (what the portal expects, made simple)**: an approval row is a negotiation thread with a stable id. Pause → row `pending` with the serialized `DeferredToolRequests` and the session id. Approve (optional `correction`) → resume with `ToolApproved` (the correction travels as `override_args` merging a `client_correction` field the tool accepts) → the resumed run's final text is persisted as an assistant message on the session AND appended as an agent comment on the row; row → `approved`. Reject (`reason`, optional `final`) → resume with `ToolDenied(reason)` (with `final`, the denial text also says not to propose it again); if the resumed run requests approval again, the SAME row is updated (new body, new tool call id, proposal appended as a comment) and stays `pending`; otherwise the row → `rejected`. Reject response: `{ok, status, unblocked: false, closed: <final>, in_approvals: <still pending>, notified: true}`. There is no unblock budget and no triage. That is the point.
- **What the client sees in chat when a run pauses**: the stream ends with a code-written assistant message in Spanish ("Te dejé un pedido en Aprobaciones: <title>") persisted like any other. The resumed run has no stream attached; its answer lands in the session and the client sees it on the next load. Acceptable for the engine; the real thing would push it over SSE.
- **Sessions from the OpenAI-shaped endpoint.** `POST /portal/chat/stream` carries the whole local history. Match a session whose display messages equal the history minus the last user message; if none, create one. Then run the last user message on it. This is what keeps a new conversation from spawning one session per message.
- **Skills index**: for each enabled plugin (`CORE_PLUGINS`, default `deliverable`), read every `skills/*/SKILL.md` frontmatter and list `name` + `description` in the instructions, with a `skill_view(name)` tool that returns the body. Progressive disclosure, same as Hermes, 30 lines. The kit is mounted at `/opt/kit/plugins:ro`, and the deliverable script's hardcoded path is satisfied by a second mount at `/opt/kit/skills/deliverable:ro`. `DELIVERABLES_DIR=/workspace/entregables` so the script writes under the workspace.
- **The approval plugin's SKILL.md does not load.** Its prose is about blocking kanban tickets; the engine replaces that mechanism with tool gating. Said here so nobody reports it as a gap.
- **SOUL**: `engine/agent/SOUL.md` = the client section of the local demo agent's SOUL (its first ~66 lines, "Sos Agente Local…" through "Horarios y contexto local"), followed by a short `core:base` block written for this engine (Spanish, rioplatense): sensitive actions go through the tool and the client's yes, deliverables go through the skill, never claim a flow exists. Identity from a copy of the demo agent's `portal_identity.json` (name Tuca, company Ferretería Demo).
- **Compaction**: a `ProcessHistory` capability. When `ctx.context_window_used` exceeds `CORE_COMPACT_AT` (default 0.6; the test sets 0.05) or, if the provider reports no window, when the estimated token count exceeds `CORE_COMPACT_AT_TOKENS`, summarize everything except the last two user turns with one model call into a single user-prompt part ("Resumen de la conversación hasta acá: …") and keep the tail. The PERSISTED history must be the compacted one; the implementer verifies this in the test (message count bounded across 40 turns). Add `ReinjectSystemPrompt()`.
- **Promises**: copy `hermes-kit/plugins/flow/engine/promises/promises.py` into `engine/core/promises.py` unchanged (it imports nothing from the engine) and run its check on the final text before persisting, with the flows dir at `/workspace/flows` and the cron file at `/state/cron/jobs.json`. The correction is appended to the text that is persisted, streamed in `assistant.completed`, and logged as a `correction` event.
- **Usage**: `GET /portal/usage` asks OpenRouter `/api/v1/key` with the agent's key, no cache. Same shape as the adapter: `{available, today_usd, month_usd, total_usd, limit_usd, updated_at}`.
- **Streaming**: use whichever of `agent.run_stream_events()` / `agent.iter()` in 2.43 yields text deltas and tool-call events with the least code. Map to the portal's two dialects exactly (contract below).
- **No protective programming.** Bad input is a 400 with a message; anything else raises and shows in the log.

## The portal contract the engine serves

Read from `app/app/lib/agent.ts`, `app/app/chat/page.tsx`, `app/app/chat/Sessions.tsx`, `app/app/approvals/page.tsx` and `hermes-kit/tools/portal-check.py` on 2026-09-12.

### Gateway-shaped (`endpoint` base)

| Method and path | Returns |
|---|---|
| `GET /api/sessions` | `{data: [{id, source: "api_server", title, preview, message_count, started_at, last_active}]}` epochs in seconds |
| `GET /api/sessions/{id}/messages` | `{data: [{id, role, content}]}` |
| `DELETE /api/sessions/{id}` | 200 `{ok: true}` |
| `PATCH /api/sessions/{id}` `{title}` | 200 `{ok: true}` |
| `GET /api/jobs?include_disabled=true` | `{jobs: []}` (CORS must reflect the origin; portal-check hits it) |

### Adapter-shaped (`adapter` base)

| Method and path | Returns |
|---|---|
| `GET /portal/manifest` | `{agent, adapter_version: "core-0.1.0", modules, named, look, company, notify_channel, telegram_bot: null, timezone: "America/Montevideo"}`; modules: `chat, approvals, files, activity, usage` true; `kanban, artifacts, crons, flows, connections, capabilities` false |
| `POST /portal/chat/stream` `{messages, stream}` | SSE, OpenAI dialect: `data: {"choices":[{"delta":{"content":"…"}}]}` per delta; `event: hermes.tool.progress` + `data: {"tool": name, "status": "started"}` when a tool starts; `data: [DONE]` at the end |
| `POST /portal/sessions/{id}/chat/stream` `{message}` | SSE, session dialect: `event: run.started`, `event: message.started`, `event: assistant.delta` `{delta}`, `event: tool.started` `{tool_name}`, `event: assistant.completed` `{content}`, `event: run.completed` `{messages: [{role, content}]}`, `event: done` `{}`. Every event is `event: x\ndata: {...}\n\n`. Unknown session → 400 `{error: {message}}`. |
| `GET /portal/approvals` | `{approvals: [{id, title, summary, body, created_at, status}]}` pending only |
| `GET /portal/tickets/{id}` | `{ticket: {id, title, body, status: "blocked", tenant: null, assignee: null, created_at}, outcome: null, comments: [{author, body, created_at}], events: []}`; `author` is `agente` for the agent, `cliente` for the client |
| `POST /portal/approvals/{id}/approve` `{correction?}` | `{ok: true}` |
| `POST /portal/approvals/{id}/reject` `{reason, final?}` | the Rejection shape above |
| `GET /portal/tickets` | `{tickets: []}` |
| `GET /portal/activity` | `{events: [{ts (ISO with offset), kind, label, status}]}` newest first, 200 max |
| `GET /portal/files` | `{files: [{path, size, modified}]}` relative to the workspace |
| `GET /portal/files/{path}` | the bytes as `text/plain; charset=utf-8` |
| `POST /portal/upload` `{name, content_b64}` | `{ok, path, bytes}` into `entrada/` |
| `GET /portal/usage` | see Decisions |
| `GET /portal/inventory` | `{skills: [{name, description, source: "kit"}], plugins: [...], mcp: []}` (Skills tab; a 404 is tolerated by the portal, so it ships last) |
| `POST /portal/identity` | `{ok: true}` after writing identity.json |
| anything else under `/portal/` | 404 JSON — the portal treats 404 as "module absent" |

## Layout

**Superseded on 2026-09-13.** The approval, deliverable and flow mechanisms
moved out of the engine into the kit's plugins through a `core` surface
(`hermes-kit/plugins/<id>/core/plugin.py` + `instructions.md`), and the SOUL
lost every line about mechanisms. `engine/README.md` "Plugins" is current;
the block below is what Wave 1 built and is kept for the record.


```
engine/
  pyproject.toml
  Dockerfile                 python:3.12-slim, uid 10000, uvicorn
  docker-compose.yml         ports 127.0.0.1:8642 and :8643 -> 8643; mounts
  secrets.env.example        OPENROUTER_API_KEY, API_SERVER_KEY
  agent/SOUL.md              see Decisions
  agent/identity.json        copied from the demo agent
  core/config.py             env -> settings (paths, model, cors, thresholds)
  core/db.py                 sqlite schema + tiny helpers; events.append()
  core/agent.py              build the Agent: model, instructions, toolsets, capabilities
  core/tools/workspace.py    bash, read_file, write_file, list_files
  core/tools/sensitive.py    send_email, publish_post (fake side effects into /workspace/outbox)
  core/tools/skills.py       SKILL.md index + skill_view
  core/plugins.py            plugin.json -> which skills load
  core/approvals.py          pause -> row; approve/reject -> resume
  core/session.py            run a turn: stream, persist, events, promises hook
  core/compaction.py         ProcessHistory summarizer
  core/promises.py           copied from the kit, unchanged
  core/render.py             approval body in Spanish; pause message
  server/app.py              FastAPI, auth, CORS
  server/gateway.py          /api/*
  server/portal.py           /portal/*
  server/sse.py              the two SSE dialects
  tests/                     the gate scripts named above
  README.md                  how to run, the magic link, what the gates are
```

## Waves

Sequential where they share files; the file ownership above is the contract.

1. **Wave 1 — the loop and the portal's chat (Opus).** Everything except approvals, compaction, promises, inventory. Done when: container up as uid 10000, `curl` on both SSE endpoints streams text and tool events, `GET /api/sessions` lists the session, `portal-check.py` passes every check except the modules not declared, and the portal's Chat tab works in the browser (new conversation, resumed conversation, tool trail).
2. **Wave 2 — approvals + plugins + SOUL (Opus).** Done when: G1 script passes including the kill, the Approvals tab shows the card with the rendered body, approve / reject / correction round-trip in the browser, G3 deliverable lands.
3. **Wave 3 — compaction + promises + usage + cost (Opus).** Done when: G4, G5, G6 scripts pass and print their numbers.
4. **Validation (a separate agent, fresh context).** Reruns every gate from the README alone, no help from the implementers. Reports what it could not reproduce.
5. **Browser walkthrough and verdict (me).** Screenshots of each tab; `docs/engine-verdict.md` with the six gates, the numbers, what the portal looked like, and what a real migration would cost.

Each wave ends in one commit. A fix found in validation is its own commit.

## Out of scope, on purpose

Telegram, cron and flows, the capability catalog, connections, artifacts, the kanban board, deploy scripts, the onboarding flow (the identity is pre-baked), pushing the resumed run's answer over SSE. None of these are what is in doubt.

## Risks named up front

- **The portal's Home tab calls eleven endpoints.** It tolerates 404 as "module absent" but a 500 shows as an outage. Unknown `/portal/*` paths must be a clean 404.
- **Onboarding re-prompt.** The demo identity has `contact.channel: "none"`, which the portal treats as "offer it again". If the walkthrough opens on the notify step, that is expected; set the channel to `email` in `identity.json` to skip it.
- **Persisted vs sent history under a processor.** If Pydantic AI keeps the original messages in `all_messages()` after a `ProcessHistory` capability runs, the engine must persist the processed list itself. The compaction test exists to catch exactly this.
- **OpenRouter's `context_window_used` may be None** for this model. The token-count fallback is there for that.
