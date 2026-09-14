# What a turn costs, how to price one, and two engine findings still open

Extracted 2026-08-30 from `notes/archive/team-pivot-status.md` when the team
pivot was reverted. **The shape these were measured on is gone; the numbers,
the method and the two open findings are not** — they were measured against
the engine and the knobs this product ships, not against the roster.

**PROVENANCE, said once so nothing below has to repeat it.** Everything here
was measured on 2026-08-24 on the local agent, on the two secondary profiles
that build served (the marketing and accounting ones, "Vera" and "Tino").
Secondary profiles do not exist any more — one baptized agent per client is
the whole product — but by then they ran the AGENT's own knobs, projected key
by key, so what was priced is the configuration a solo agent runs today:

    openai/gpt-5.6-luna · reasoning_effort: max · toolsets: [kanban] plus the
    12-toolset platform_toolsets list · the three gate hooks · the promises
    plugin · the portal platform_hints preamble · curator off

`agent-check.py` was 35 ok · 0 failures going in. An earlier row — conversational
US$0.006 · with tools US$0.062 · US$0.026 blended — is **superseded**: it was
taken on profiles running `z-ai/glm-5.2` with no kanban toolset, the engine's
default preamble and no gate hooks, i.e. another model with another prompt.

Image economics are NOT here. They have a home of their own and it is measured
deeper: `notes/image-cost-anatomy.md` (US$0.357 per finished placa, 92% of it
the pixel). This note stops at the chat turn.

---

## 1. The method — and the one thing it cost an hour to learn

Turns were sent the way `chat/page.tsx` sends them — `POST /portal/chat/stream`,
full history, `stream: true` — serialized one at a time, reading the delta off
`GET https://openrouter.ai/api/v1/key` (the uncached version of what
`/portal/usage` serves) polled until it stopped moving. The per-turn deltas sum
EXACTLY to what the key moved, so nothing leaked between turns.

**`GET /api/v1/key` deltas are only attributable when nothing else is talking
to that agent.** The key is the whole agent's. During the window measured here,
another workstream was driving live image turns through the adapter at the same
minutes, and US$0.29 of its spend was very nearly read as one turn's. Price a
turn off its own `API call #N: … in=/out=/cache=` lines instead; that model
reproduces a clean metered turn to within 10% (US$0.0028 modelled vs US$0.0031
metered, the difference being cache writes).

## 2. THE ENGINE ALREADY KNOWS THE NUMBER

The useful discovery, and the reason nobody needs the harness above again.
`session_model_usage.estimated_cost_usd` (`cost_source=provider_models_api`)
matched OpenRouter to the last decimal on every session: 0.01329354 vs
0.013293 and 0.06288972 vs 0.062890; 0.00832391 vs 0.008324 and 0.03609663 vs
0.036097. On this configuration the "estimate" IS the charge, per session and
per `task`, queryable without asking the provider.

## 3. The per-turn prices

| turn | profile | tool calls | s | US$ |
|---|---|---|---|---|
| conv 1 (cold session) | marketing | 1 | 17 | 0.007002 |
| conv 2 | marketing | 1 | 15 | 0.002376 |
| conv 3 | marketing | 3 | 24 | 0.003915 |
| conv 1 (cold session) | accounting | 0 | 9 | 0.006004 |
| conv 2 | accounting | 0 | 9 | 0.000982 |
| conv 3 | accounting | 0 | 11 | 0.001338 |
| tool 1 — deliverable written | accounting | 22 | 94 | 0.023238 |
| tool 2 — deliverable written | accounting | 12 | 79 | 0.012859 |
| tool 1 — approval, refused for missing data | marketing | 42 | 156 | 0.048492 |
| tool 2 — approval, refused for missing data | marketing | 20 | 45 | 0.014397 |

- **Conversational: US$0.0036/turn** (6 turns, range 0.00098–0.00700).
- **With tools: US$0.0247/turn** (4 turns, range 0.0129–0.0485).
- **A short classifier call to the provider: US$0.000071** (5 measured
  directly). It was the room router's price and the room is gone, but the
  pattern is not: `POST /portal/capabilities/suggest` is the same shape — one
  ~300-token call straight to the provider, no agent run — so this is what
  that question costs. It rounds away against a conversational turn.
- **Vision: NOT EXERCISED.** Zero vision calls across all 10 turns, no
  `task='vision'` row. What the log settles anyway is in section 6.

**THE CONVERSATIONAL WIN IS MOSTLY PROMPT CACHE AND SHOULD NOT BE BANKED.**
Split by position in the conversation: the FIRST turn costs US$0.0065, every
turn after it US$0.0022 — `cache_read_tokens` around 44k per call against
`input_tokens` in the single digits. US$0.0065 is essentially the old
US$0.006. A client who sends ten messages spread across a day pays close to the
old number; only a burst of consecutive turns gets the cheap ones. What
genuinely moved is the tool path: **US$0.062 → US$0.0247, 2.5x cheaper**, and
that does not depend on cache timing.

**A CONFIG BUG IS INSIDE THE TOOL-HEAVY NUMBER.** Four skills — `approval`,
`capability`, `deliverable`, `flow` — existed BOTH in a profile's own `skills/`
and in the read-only `/opt/kit/skills` mount, so the engine refused to resolve
them: *"Ambiguous skill name 'deliverable/SKILL.md': 2 skills match across your
local skills dir and external_dirs. Refusing to guess."* 13 collisions in that
day's `errors.log`. The agent then flails — 42 tool calls on the worst turn,
five of them `session_search` — and that single turn is US$0.0485, half the
tool-heavy spend of the whole session. **The tool-heavy figure is therefore an
upper bound measured on a broken skills index.** The duplication was a
consequence of shipping craft skills inside a profile and cannot recur in the
present layout — one home per skill, `kit-skills/` mounted `:ro` — which is
another way of saying the real tool-heavy number is lower than US$0.0247 and
has never been measured clean.

## 4. The mix math

Weighting two conversational turns per turn with tools (solving
`.006w + .062(1-w) = .026` gives w≈2/3, the weighting the superseded row used),
10 placas/month at the US$0.10 that was believed at the time, against ~US$25:

| | blended turn | 10 turns/day | 30 turns/day |
|---|---|---|---|
| OLD (wrong config) | US$0.0246 | US$8.4/mo — 34% of price | US$23.2/mo — **93%** |
| NEW (as measured) | US$0.0107 | US$4.2/mo — 17% of price | US$10.6/mo — 42% |
| NEW, cache-pessimistic | US$0.0126 | US$4.8/mo — 19% of price | US$12.3/mo — 49% |

("cache-pessimistic" prices every conversational turn at the cold US$0.0065,
i.e. a client who never sends two messages in a row.)

**Two corrections before anyone quotes this table.** The US$0.10 placa in it is
dead — `notes/image-cost-anatomy.md` measured US$0.357, 3.6x more, and 10
placas/month is US$3.57 rather than US$1.00, which moves every row's monthly
total by ~US$2.6. And the ~US$25 denominator was the per-role price of a
product that no longer exists; the client now buys one agent plus the
capabilities they choose, and the pricing decision is still Luis'.

What the table does settle, and it survives the reprice: the case the old row
flagged as what-breaks-it — 30 turns/day — went from eating the entire price to
leaving it standing, and the only shape that still eats it is 30 TOOL-HEAVY
turns every single day (US$23.3/month), which was US$56.8 — 227% of price — on
the old numbers.

## 5. OPEN — a tool-heavy turn can go silent and return NOTHING

Seen on the local agent 2026-08-24 while measuring the skills-collision fix,
prompt *"dejame una planilla mínima de prueba como entregable"*.

| 19:32:55 | turn starts, request id `api-20fc43aef3526b58` |
| 19:33:02-19:33:11 | three `Ambiguous skill name` refusals on `deliverable` (that half is fixed) |
| 19:34:20 | API call #18, out=198 |
| 19:34:21 | `tool terminal completed (0.77s)` — **the last line this request ever writes** |
| ~19:37:41 | the client gives up: "Remote end closed connection without response", 319s in |
| 19:38:13 | SIGTERM (unrelated); the drain reports `0 active agent(s) … and 1 api_server run(s)` |

There is no `Turn ended` line for that request id. The agent stopped between
one tool result and the next API call, three minutes before the client hung up,
and the gateway did not consider it an active agent while still holding an
api_server run open. Whatever happened there, **the client's experience is a
five-minute wait and an empty response** — and it is billed: priced off its 18
logged calls at gpt-5.6-luna's rates (US$0.2/M prompt, US$1.2/M completion,
US$0.02/M cache read) it is **US$0.025**, 506k prompt tokens and 7.3k
completion. The healthy turn that replaced it after the fix cost US$0.0031.

Not diagnosed. Nothing on either side reports it, which is the part that makes
it product and not tuning.

## 6. OPEN — vision resolves to the MAIN chat model, on the main key

The engine logs, on every turn:

    agent.auxiliary_client: Vision auto-detect: using main provider
    openrouter (openai/gpt-5.6-luna)

So a workflow's mandatory LOOK pass at an image is billed as a chat turn at the
agent's own model and `reasoning_effort` — and reasoning dominates output on
this config (18,315 of 21,247 output tokens on the tool session measured here).
A task-scoped pass does get its own costed row (the `approval` task showed up
as one: 5 calls, US$0.00066), so the LOOK pass IS separately attributable.
`notes/image-cost-anatomy.md` picks this up and prices it.

## 7. Orphaned engine sessions pile up

The engine IGNORES a client-supplied `session_id` and mints one per turn, so a
conversation held over `POST /portal/chat/stream` leaves one engine session per
turn behind. **Decided: leave them and note it.** They are cheap, they are
visible in `/api/sessions`, and nothing reads them expecting a conversation.
Recorded because a "sessions" count is not a "conversations" count and the
first screen that treats it as one will be wrong.

## 8. Decisions that outlived the pivot

- **The curator stays off** (`curator.enabled: false` in
  `compose/config.base.yaml`). It runs on its own every 7 days and archives
  what it judges agent-created and unused for 90 days. The kit's skills are
  safe by construction — they live outside `data/` in `kit-skills/`, mounted
  `:ro`, and are declared in `skills.external_dirs` — so the knob is belt and
  suspenders. **The measurement was never taken and it is still worth taking**:
  (a) does `is_curation_eligible` return True for a skill installed rather than
  written by the agent, and (b) can `skill_manage` overwrite one? What we lose
  by keeping it off is housekeeping over the skills the agent writes for
  itself, which is worth strictly less than the skills the client is paying for.
- **The promises guard resolves its folder AT CALL TIME**, through
  `get_hermes_home()` and never from the process environment read at import.
  This was learned the expensive way: the engine's `PluginManager` is a process
  singleton whose `_discovered` latch makes the scan happen once, so on a
  multi-home gateway the first turn after a boot decided the plugin set for
  everybody and a guard could end up judging one speaker against another's
  disk. One home per agent removes the race, not the rule — a plugin that reads
  its environment once at import is wrong in any process that outlives a turn,
  and `agent-check.py` calls the hook twice under two different homes precisely
  so that "the file is there" cannot pass for "it works".
- **Every knob is written as how this PRODUCT behaves, not how one profile
  behaves.** That is why `compose/config.base.yaml` is the whole story and why
  the four knobs that could not travel were named individually, with reasons,
  rather than the other way round. The projection machinery is gone with the
  profiles; the denylist-not-allowlist instinct is what to keep.
