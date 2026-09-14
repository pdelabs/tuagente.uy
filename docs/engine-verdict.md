# The engine — verdict

> Written on 2026-09-12 as the verdict of a proof of concept. On 2026-09-14
> Luis decided the engine stays and Hermes goes (`docs/PENDING.md`); the
> code moved from `poc/core/` to `engine/`. The numbers and findings are
> as measured that day.

Built and measured on 2026-09-12 against the plan in `docs/engine-plan.md`.
Code in `engine/` (about 1,800 lines of engine and server, 900 of tests,
plus the kit's `promises.py` copied verbatim). Three implementation waves on
Opus, one independent validation pass with a fresh context, and a browser
walkthrough of the unchanged portal. Total spend on the key for the whole
day, tests included: US$0.07.

## The six gates

| # | Gate | Result |
|---|---|---|
| G1 | Fail-closed approval that survives a crash | **Pass.** One gated turn, `docker kill`, restart, five rejections in a row on the same request, approve with a correction. 32 checks, 0 failures. The corrected email landed in the outbox with the correction applied. |
| G2 | The existing portal works with only the magic link changed | **Pass.** `portal-check.py`: 13 ok, 0 failures (3 warnings are modules the plan leaves out). In the browser: Home, Chat (new and resumed conversation, tool trail, file chips), Approvals (card, body, reject with reason, re-proposal on the same card, "Lo que hablaron", approve), Activity, Files, Usage, Skills. Not one line of `app/` changed. |
| G3 | Kit plugins load as toolsets, SKILL.md unchanged | **Pass.** The `deliverable` plugin's skill is indexed from its frontmatter, the agent reads it with `skill_view`, runs the kit's own `deliver.py` through bash, and the file appears under `entregables/` in Files. |
| G4 | Compaction | **Pass.** 41 turns on one session, 39 compactions, persisted history 7 messages against 82 displayed, the fact planted at turn 2 still answered at turn 41. US$0.02. |
| G5 | The promises check rewrites the persisted message | **Pass.** The kit's own 8/13 phrase comes back with the correction, and `GET /api/sessions/{id}/messages` returns the corrected text. On Hermes this is the open bug that "closes upstream". |
| G6 | Cost per turn on the baseline model | **Measured, indicative.** The order of magnitude holds; the per-turn harness does not (see validation). |

### Cost, same model as the baseline (`openai/gpt-5.6-luna`)

| Turn | Tool calls | Seconds | Metered US$ | Engine's own estimate | Hermes baseline US$ |
|---|---|---|---|---|---|
| Conversational | 0 | 2 | 0.000564 | 0.000564 | 0.0036 |
| With tools | 4 | 8 | 0.000859 | 0.000859 | 0.0247 |

First run, by the implementer. The validator's reruns put the conversational
turn between US$0.0000 and US$0.0018 and the tool turn about US$0.001,
because the harness attributes late-landing spend to whichever row is open.
The tool row is not like for like either: the baseline turns made 12 to 42
tool calls and wrote deliverables. What can be said: the engine's own
estimate and the provider's meter agree in aggregate, prompt cache moves the
number by 5x, and the conversational turn is several times cheaper than on
Hermes, where the prompt carries a 9 KB skills index, a 4.6 KB kanban
protocol and a memory lecture on every request. This engine ships the SOUL
and one line per skill.

## The four reasons to leave Hermes, checked against the engine

1. **The gate fails open under load.** Closed by construction. The gate is on
   the tool (`approval_required`), the run ENDS in a `DeferredToolRequests`
   and cannot continue without a `DeferredToolResults` built by the approve
   endpoint. There is no timeout path: nothing is waiting, the run is over.
2. **Corrections vanish because the engine persists before it transforms.**
   Closed. `BEFORE_PERSIST` hooks run before the display message is written
   and before the `assistant.completed` event goes out. G5 proves it through
   the portal's own read path.
3. **The version freeze.** Different in kind. The engine pins Pydantic AI 2.43
   but every coupling is through public API: `run_stream_events`,
   `FunctionToolset.approval_required`, `DeferredToolRequests` and
   `DeferredToolResults`, `ProcessHistory`, `ReinjectSystemPrompt`,
   `ModelMessagesTypeAdapter`, `AbstractCapability.after_run`. One behavior
   is relied on that the docs do not promise in so many words: the processed
   history is what `all_messages()` returns at the end of the run. The
   compaction test exists to catch a change there.
4. **Kanban's ticket lifecycle leaking into the UX.** Gone. An approval is a
   negotiation thread with a stable id: reject keeps it, the agent's next
   proposal updates it, approve or `final` closes it. No unblock budget, no
   triage, no decomposer, no machine comment signed as the client.

## What the portal looked like

The same product. The client would not know the engine changed. One cosmetic
thing surfaced, in the engine's data and not in the portal: **Activity chips
show the event kinds in English** (`approval_requested`, `turn_usage`,
`compaction`), because the Activity page renders unknown kinds raw. One
rename in the engine.

One product gap that is the engine's, not the portal's: the resumed run after
an approval has no stream attached, so its answer appears in the chat on the
next load and on the approval card right away. A real engine pushes it.

## What was learned that the plan did not know

- **`ToolApproved.override_args` replaces the arguments, it does not merge.**
  The approve path builds the merged dict itself. Passing only the correction
  would have sent an email with no recipient.
- **A paused run's history cannot live on the session.** It ends in an
  unanswered tool call, which the next turn cannot replay. The history moved
  onto the approval row and the session advances when the thread resolves.
- **The context-window fraction is a dead knob on a 1M-token model.** What
  bounds the history is the token estimate. Both triggers are OR'd.
- **Summarizing the summary loses facts.** The first G4 run replaced the
  planted fact with a list of files after 39 rounds. The fix carries the
  previous summary forward verbatim and only summarizes unseen turns.
- **`portal-check.py` reads headers case-sensitively** and uvicorn lowercases
  them. The engine serves canonical-case headers through h11 to pass; the right
  fix is in the check script, which should be case-insensitive. Filed here,
  not fixed.
- **The one-line "Queda definido: viernes a las 9:30" does not trip the
  promises check** on its own: the module wants a closing claim AND a
  recurrence hint. The kit's real case carries the hint in its second line.

## Independent validation

A separate agent with a fresh context reran every gate from the README alone,
then probed three things the scripts do not cover: a client who keeps
typing while an approval is pending, every path by which a sensitive tool
could run without a "yes", and the persist-after-transform order.

**Reproduced:** G1, G3, G4 (39 compactions, 7 persisted against 82
displayed, same fact answered), G5, and G2 at the contract level.

**Not reproduced as written:** G6. The cost harness mis-attributes spend
across its two rows when the provider's meter lands late, and cannot tell
"not landed yet" from zero; across three runs the conversational turn read
between US$0.0000 and US$0.0018 and the tool turn about US$0.001. What
holds is the order of magnitude against the Hermes baseline and the
aggregate: metered and engine totals agree, per-turn rows do not always.
The engine's own figure also moves with prompt cache, from US$0.0001 with
2,006 cached tokens to US$0.0006 with none, the same lesson as on Hermes.

**Found by the probes, all verified live, all fixed the same evening in
eight commits (`0b2c048` through `914e0f6`), after which the crash test
passed again with 32 checks and portal-check stayed at 0 failures:**

1. A new conversation forked into a second session whenever the persisted
   text differed from what was streamed (the OpenAI dialect never sent the
   corrected or pause text, and session matching compared assistant text).
2. Approving the same request twice ran the tool twice, and a crash after
   the tool ran left the row pending, so a retry would re-fire the side
   effect. Status was written only after the resumed run.
3. Pending rows were keyed per session: a later unrelated proposal silently
   replaced the one the client was reading, under the same card.
4. Resuming an approval overwrote the session history, dropping any turn
   the client took while it sat pending.
5. A failed turn was silent: user message persisted, no answer, stream ends.
6. Several 500s where the contract says 404 or 400.

**Confirmed fail-closed:** no path was found by which a sensitive tool body
runs without an approve call. The gate is structural: the run ends in a
deferred request and resumes only from the approve endpoint. Reject and
`final` never execute. An id from another session resumes only that row's
own session. The transform-then-persist order was confirmed by reading the
lines: hooks run before the display write, the history write, and the
`assistant.completed` event.

**Left as known limits:** the compaction summarizer's tokens are not in the
turn's usage event; display and history are two commits; a bash timeout
escapes into the error path; session matching walks every session. And an
operational one: near the end of the day OpenRouter started answering 402
"can only afford 65,470 tokens" because the engine set no `max_tokens` and
the provider prices a request against the full 65,536 it could produce. The
follow-up caps it at 8,192 and requests go through again. The key itself has
US$7.50 of its limit left, but the affordable-token figure implies the
ACCOUNT balance behind it is around US$0.08 at this model's output price:
worth topping up before anyone runs the compaction test again.

## What a real migration would cost

What the engine does not have, grouped by whether it is engine work or kit work
that moves over.

| Area | State | Estimate |
|---|---|---|
| Telegram channel (the client's notify path and a chat surface) | Not built. One library, the pairing flow, message formatting. | 2 days |
| Cron and flows (`FLOW.md`, `create_flow.py`, the Flows tab, `/api/jobs`) | Not built. A scheduler over the same session runner, the flows tab's contract, the promises check already reads the dir. | 3 days |
| Memory | Not built. A memory file the agent edits plus a post-turn extraction with a cheap model. Hermes has no extraction either. | 1 day |
| Streaming the resumed run's answer, abort mid-run persistence, concurrent sessions | Rough edges named in the README. The engine is one process and approve is synchronous. | 2 days |
| Capability catalog, connections catalog, artifacts, upload/inbox conventions | Adapter code that moves over mostly as is; it reads catalogs and folders, not the engine. | 3 days |
| The kanban board tab | Decide first whether the product keeps a board at all. The engine suggests approvals plus activity cover what clients used it for. | 0 to 4 days |
| Plugin surfaces beyond skills: `engine/`, `mcp/`, `service`, `adapter`, `tab` | One of them exists now: `core/` is a surface of the kit's manifest — `plugin.py`, `register(engine)`, optional `instructions.md` — and `approval`, `deliverable` and `flow` carry it, which is where this engine's gate, folders prose and promises guard live. The rest still need a loader each; `mcp-guard` re-validated against the MCP client Pydantic AI ships. | 2 days |
| Image generation, vision, OCR and document skills, web search | Image gen is one API call; the four document skills are Python libraries; web search is a tool. | 2 days |
| `new-agent.sh`, `install.sh`, `deploy-remote.sh`, `agent-check.py`, `fleet.md` | Rewrite against a much smaller surface: one container, one env file, no `config.yaml` to guard. | 3 days |
| Onboarding through the portal (naming, look, business, channel) | `/portal/identity` exists; the brief and the avatar upload do not. | 1 day |

Roughly four working weeks to parity on what the fleet actually uses, done
the way the engine was done. Against that: the parked Hermes upgrade wave was
already estimated at a week of reconciling seven couplings, with the gate
and the persist bug still open at the end of it.

## Recommendation

Go, staged. The engine closed the four problems that made the question worth
asking, with 1,800 lines and one afternoon, and the portal did not notice.
The risk moved from "the engine fights us" to "we own the loop's edge
cases". The validation pass is the honest picture of that: the first cut of
the approvals layer had four real bugs (double approve, row clobbering,
history overwrite, session forking), all found in an hour by reading and
probing, all fixed the same evening with the tests to keep them fixed. On
Hermes the equivalent bugs sat in `docs/PENDING.md` for a month with "closes
upstream" next to them. Owning the edge cases is the better kind of risk.

Stage it: the next client goes on the new engine behind the same portal;
the local demo and the VPS agent stay on Hermes until Telegram and flows
land; `kit/` keeps its plugins, SOUL templates and catalogs, which
are the product, and loses the adapter, the hooks, the config knobs and the
engine notes, which were the tax.
