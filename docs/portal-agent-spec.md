# Spec — tuagente portal + `tuagente-portal` plugin

*v1 · 2026-08-03 · written by Claude with the lessons from La Mano's weekend*

## Goal

Every tuagente client chats with their agent and runs their pipeline from a
tuagente-branded web interface — without pdelabs maintaining any
infrastructure beyond the client's own agent.

## Principles (non-negotiable)

1. **The agent is the only source of truth and the only infrastructure.**
   All state (tickets, sessions, files, memory) lives in the client's Hermes
   instance. The portal has no database.
2. **The portal is static.** Next.js on Vercel (tuagente.uy repo, already
   deployed). One single deploy serves every client.
3. **The portal is a window, not a cage.** Each agent is its own world with
   its own purpose; the portal adapts to the agent via a capabilities
   manifest and NEVER limits or sits in the middle of its native powers
   (channels, skills, crons, proactivity). The approval gate is a module
   that only shows up if the agent uses that pattern — La Mano uses it;
   other agents don't have to.
4. **Never touch the kanban DB directly.** Lesson from 2026-08-03: sqlite
   with locks, claims and a dispatcher + a second writer = corruption.
   Every write goes through Hermes's internal modules (the same way the
   dashboard plugin itself does).

## Architecture

```
client's browser
  │  (bearer token in localStorage, delivered as a magic link)
  ├── chat ──────────► https://<agent>.railway.app:8642/v1/chat/completions
  │                    (OpenAI-compatible, streaming, ALREADY VERIFIED)
  └── portal API ────► https://<agent>.railway.app:8642/portal/*
                       (tuagente-portal plugin, this spec)

tuagente.uy portal (Vercel, static)  =  UI only
client's agent (Railway, docker)     =  API + state + rules
```

- **CORS**: the plugin adds the CORS headers for `*.tuagente.uy`. If the API
  server doesn't allow it at the plugin level → fallback: an edge proxy on
  Vercel (serverless, stateless, zero maintenance).
- **Auth v1**: the instance's `API_SERVER_KEY` as the single bearer token,
  over HTTPS. Good enough because the key only opens THAT agent. v2: a
  read-only token with scopes, to be able to share read-only access.

## `tuagente-portal` plugin (runs inside each agent)

Python at `data/plugins/tuagente-portal/` (a sanctioned extension point;
survives image updates; versioned in the agent's git).

### Endpoints v1

| Method | Route | What it does |
|---|---|---|
| GET | `/portal/manifest` | THIS agent's capabilities: active modules (kanban, approvals, files…), connected channels. The portal renders based on this |
| GET | `/portal/health` | agent alive, active model, version |
| GET | `/portal/approvals` | `blocked` tickets with `needs_input` → `[{id, title, summary, draft, date}]` |
| POST | `/portal/approvals/{id}/approve` | comments "approved via portal" + unblock → the agent's worker executes (comment→worker mechanism VERIFIED on 2026-08-03) |
| POST | `/portal/approvals/{id}/reject` | comments the reason, keeps it blocked |
| GET | `/portal/tickets?tenant=&q=` | kanban read (filters = tenant + title search, the existing tag convention) |
| GET | `/portal/activity` | last N: cron runs (jobs + last_status + deliveries), source: jobs API + log |
| GET | `/portal/files` / `/portal/files/{path}` | read-only workspace (reports, dossiers) — text only, path confined to workspace/ |
| GET | `/portal/usage` | real provider spend in USD: today, month and total (OpenRouter, no estimates) |

> *(Rename note: this is the LIVE endpoint — RENAME-MAP D4 renames the
> Spanish `/portal/uso` to `/portal/usage`, keeping the real-spend semantics
> described above. It is a different shape from the retired v1
> `/portal/usage` described in `docs/specs/05-activity-files-usage.md`
> (`{sessions, input_tokens, output_tokens, total_tokens, period}`), which
> was retired for returning wrong numbers before this one replaced it. Don't
> read the two as the same endpoint coming back.)*

### Implementation notes (lessons applied)

- Kanban reads: sqlite `mode=ro` (like `reconcile-report.py`).
- Writes (comment/unblock): via the internal `kanban_db` modules — the same
  path `plugins/kanban/dashboard/plugin_api.py` uses, never direct SQL.
- The plugin's scripts/files: simple, no exotic paths — the lifecycle
  scanner has a known false positive (repro documented in the guard's
  report).
- `/portal/files`: always `text/plain` inline, never the real mime type
  (anti-XSS lesson from the attachments patch).

## Coexistence with native channels

Hermes's channels (Telegram, WhatsApp, etc.) stay first-class: the agent's
proactivity lives there (it reaches out to you). The portal is one more
window into the same agent — Hermes sessions share memory and state
(verified: that's how La Mano's approval bridge works), so what's discussed
on Telegram and what's seen on the portal are the same world.

## Portal (tuagente.uy repo)

Route `/app` (an SPA inside the existing Next app):

- **Login**: the client pastes their magic link
  (`app.tuagente.uy/#endpoint=...&key=...`) → localStorage. No users, no DB,
  no backend.
- **Screens** (modular per the manifest; build order):
  1. **Approvals**: the inbox with Approve/Reject — home if the agent uses
     the pattern
  2. **Chat**: streaming + markdown (Vercel AI SDK `useChat` + react-markdown)
  3. **Pipeline**: read-only kanban with tenant/tag filters
  4. **Activity**: a timeline of what the agent did
  5. **Files**: browsable deliverables
  6. **Scheduled tasks**: the agent's crons — schedule, last status,
     pause/resume ("vacation mode"), run now. Via `/api/jobs`, which ALREADY
     exists on :8642 with bearer auth (list/pause/resume/run) — zero
     data-layer code. Creating/editing crons stays in the operator console
     (it's agent config).
  7. **Usage**: tokens/cost for the month
- What it does NOT have: model management, skills, logs, agent config →
  that stays in the Hermes dashboard (:9119), which is pdelabs's per-client
  support console.

## Phases

- **F1 (the sellable demo)**: plugin with health + approvals + tickets ·
  portal with Approvals + Chat. A client can approve a mail from their
  phone.
- **F2**: activity + files + usage · Pipeline screen.
- **F3**: scoped tokens, multi-user per client, push notifications.

## Decisions already made (with evidence)

- **Open WebUI ruled out as a product** (tested 2026-08-03): a great demo,
  but it brings features irrelevant to the client, branding under a license
  clause, and a fork would mean perpetual maintenance of someone else's
  code.
- **Proxying the Hermes dashboard ruled out**: it's an operator console.
- **Shared DB ruled out**: see principle 4.

## Open risks

1. API server CORS for plugin routes — verify early in F1; edge-proxy
   fallback ready.
2. The plugin registers routes on the api_server: confirm the
   route-registration mechanism for standalone plugins (google_meet does it
   with tools; here we need HTTP routes — check how kanban registers its
   own).
3. Semantics of "approved via portal" in each client's SOUL: the text must
   name the client as a valid approver through that channel.
4. `kanban_db` is an internal Hermes API (no contract): mitigate with a
   pinned image per client, a minimal adapter, and a plugin self-test after
   every update.
5. Portal↔fleet drift: the manifest carries a version; the portal is
   defensive (unknown module → hidden). Declared ANTI-PATTERN: never
   cache/mirror agent state in the portal.

## Plugin budget (anti-bloat rule)

The plugin only adapts where the auth boundary forces it (:9119) or where no
endpoint exists (manifest). Today: kanban + manifest, and nothing else. If a
third data type needs it → contribute the endpoint upstream to Hermes (a PR
to the api server), don't bloat the adapter. Two surfaces: :8642 bearer =
direct, no proxy; :9119 cookie = the only candidates for the adapter.

## What does NOT get reimplemented (data layer)

Chat, sessions+history and crons/jobs (incl. pause/resume/run) already have
bearer REST on :8642 (verified).
The plugin only adapts kanban/manifest/files/usage as a pass-through to the
internal modules — the same pattern the official dashboard uses.
