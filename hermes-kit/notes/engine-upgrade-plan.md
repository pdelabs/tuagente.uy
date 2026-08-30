# Engine upgrade to Hermes v2026.8.19 — TO DO, NOT YET (parked 2026-08-25)

Luis's call on 2026-08-25: document it, do not run it. The kit is pinned to
`nousresearch/hermes-agent:v2026.7.30` (= v0.19.1). Three releases and
~1,600 PRs have shipped since (v0.20.0 "Herald" 8/3, 0.20.3 8/16, 0.20.5
8/19). This note is the plan for when we decide to move.

## Bot Mode (0.20.3+): what it is, and why we do NOT adopt it

A Hermes Desktop UI over the same primitive we build on — profiles. Each
"Bot" is a profile with its own SOUL, pinned model, memory, skills and
avatar; bots message each other via a `message_agent` tool / `hermes -p
<bot> chat -c "Agent Inbox"` handoffs triggered by `@mention`; group rooms
of 2–6 bots run up to 3 serial rounds where each bot replies or passes;
"routines" are cron jobs namespaced `[bot:<name>]`. Headless parity is
`hermes -p <bot> chat` + `api_server`. Sources: the Bot Mode docs and the
8/17 coverage (marktechpost, opensourceforu); links at the bottom.

Verdict: **nothing to adopt, and the reason got simpler.** It was written as
"convergent design built a month after our pivot, but their bot-to-bot
delegation over an open roster is exactly the model we rejected"; since 30/8
we do not sell a team at all — one baptized agent per client
(`docs/team-pivot-removal.md`) — so the whole feature is off-product, not
merely different. Our portal is the UX; Desktop is not a surface a client
sees. What DOES matter in the same releases is in the table below, and none
of it is Bot Mode.

## What the upgrade WOULD give us (the reasons to do it)

| Feature (version) | Value for us |
|---|---|
| Outbound webhooks with signed lifecycle events (0.20.0) | The adapter polls today; push events make the portal and Telegram notifications real-time. Notify-only, off the hot path, `delivery_id` + timestamp for replay protection. |
| Smart approvals + `approvals.deny` glob rules (default since 0.19) | Overlaps our `pre_tool_call` gate hook. Must decide replace-vs-coexist — two approval systems is a hazard, not a feature. |
| Keyless web search tier, 5-vendor rotation (0.20.5) | The web-search skill that "always gave us trouble" may work with no key (`check_web_api_key` is False on every agent today). |
| Per-profile model pinning surfaced as a first-class feature | Was a lever for pricing one role against another; with one agent per client it is only useful if we ever want a cheap model for a cheap plan. Low priority now — noted so nobody re-derives it as a reason to upgrade. |
| Cron jobs with persistent memory + per-job reasoning effort (0.20.5) | Direct cost lever for flows. |
| MCP 2.x SDK, stateless protocol (0.20.3) | `mcp-guard` must be re-validated against it. |
| Telegram DM topics, persisted model routes, prompt caching on LiteLLM/OpenAI wire (0.20.2) | Cache is most of our conversational-cost win; worth re-measuring after. |

## Why it is not a `docker pull` — the couplings

The kit depends on engine internals at line level, all cited in the notes
and checks. Each is a thing that may have moved:

- ~~Secondary-profile port-binding pin (`gateway/config.py:2131-2155`)~~ —
  GONE with the profiles (30/8). Nothing binds a second port any more.
- Plugin discovery singleton + `_discovered` latch (`plugins.py`) and the
  per-call home resolution in promises (95528ba). The per-profile `plugins/`
  symlink half is gone; the per-call resolution is not, and it is the rule
  (`notes/cost-and-engine-findings.md` §8).
- Secret scoping (`agent/secret_scope.py`) — why `OPENROUTER_BASE_URL` lives
  in the home's `.env` and not in the container's environment (e4edeb1).
- Skills ambiguity refusal (`tools/skills_tool.py`) — the one-skill-one-home
  delivery rule (9751826).
- `distribution_owned` rmtree semantics (`profile_distribution.py`) — the
  deliberately empty `skills/` dirs.
- `transform_llm_output` hook contract — promises.
- Kanban store layout (`/opt/data/kanban/boards/<slug>/kanban.db`).
- `agent.bot_mode_protocol: true` is default-on: it injects the teammate
  protocol into "canonical Bot Chat" sessions only — verify it never touches
  `api_server` sessions or the agent's SOUL. There is no teammate to talk to,
  so anything it injects is pure cost.
- Every `agent-check.py` rule that reads engine files by path.

## The wave, when we run it

1. Bump the image tag on the LOCAL demo agent only (`tuagente-local-agent`);
   `install.sh` + restart; read the engine's own changelog for each coupling
   above and re-cite lines.
2. Gate: `agent-check` 0 failures, `portal-check` 0 failures,
   `/portal/plugins` unchanged, promises fires on a real turn, one
   conversational and one tool-heavy turn priced from their own token lines
   and compared against `notes/cost-and-engine-findings.md` §3.
3. Diff behavior vs the notes; fix the kit where a coupling moved; one
   commit per coupling; validator wave as usual.
4. Only then the VPS agent (`tuagente`) via `deploy-remote.sh`, then East
   (client — needs the English migration first, see fleet.md).
5. Decide the approvals question (smart approvals vs our gate) BEFORE the
   VPS step, not after.

## Sources

- https://hermes-agent.nousresearch.com/docs/user-guide/bot-mode
- https://hermes-agent.nousresearch.com/docs/user-guide/profiles
- https://hermes-agent.nousresearch.com/docs/user-guide/messaging/webhooks
- https://hermes-agent.nousresearch.com/docs/user-guide/security
- https://github.com/NousResearch/hermes-agent/releases
- https://github.com/NousResearch/hermes-agent/releases/tag/v2026.8.19
- https://www.marktechpost.com/2026/08/17/nous-research-hermes-bot-mode/
- https://www.opensourceforu.com/2026/08/nous-research-bot-mode-hermes-agent/
