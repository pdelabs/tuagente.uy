# tuagente portal — features by tab

## Big topics still undefined (raised by Luis, 2026-08-04)

### 1. Discovering and installing skills
Hermes already brings the mechanism: `hermes skills browse | search | inspect |
install | check | update | audit | uninstall`, against skills.sh, ClawHub,
GitHub and "well-known" endpoints. So **the problem isn't technical, it's
product and security**:
- Installing a skill = **running third-party code inside a client's agent**,
  with its credentials within reach. That's why the SOUL already forbids the
  agent from installing anything without explicit approval.
- The stance I propose: **the client asks, we install and audit.** The portal
  shows what it knows how to do (Capabilities tab, already built) and lets the
  client *request* a new capability; pdelabs does the install with
  `skills audit`.
- Still to define: our own curated catalog (a short list of skills we've
  already audited) vs. exposing the full registries. I'd go with the catalog.
- **Trap already confirmed:** an installed skill doesn't reach the agent's
  prompt on its own (see `agents-toolkit.md`). Any install flow has to include
  the step of documenting it in the SOUL, or it stays invisible.

### 2. External connections and MCP
`hermes mcp add | remove | list | test | configure | login | reauth | catalog |
install` — includes OAuth (`login`/`reauth`) and a catalog. Today: **zero
servers configured** in the fixture.
- It's the natural path to connect the client to their own stuff (their CRM,
  their Drive, their ERP) without us writing a skill per integration.
- The hard part isn't connecting: it's **the credential lifecycle** — who
  loads them, where they live, what happens when an OAuth token expires, and
  how we notify the client without the agent going silent with no
  explanation.
- Bare minimum before selling this: the portal has to show each connection's
  status (alive / down / needs reauth), because an integration that's broken
  silently is worse than not having it.
- Still to decide: whether the client loads the credentials (needs UI and
  encryption) or we do (simpler and safer, less autonomous).


Work list to edit between the two of us: add, remove or change whatever you
want.

Feasibility marks:
- **[cli]** — Hermes already supports it via CLI/API, it just needs exposing
  through the adapter + UI.
- **[adapter]** — needs new logic built into the sidecar (doesn't exist
  upstream).
- **[ui]** — pure frontend, doesn't touch the agent.
- **[?]** — need to decide whether we want it.

---

## Cross-cutting (shell, every tab)

- [ui] Pending-items badge in the sidebar (e.g. "Aprobaciones 3").
- [adapter] Real agent status: online/offline and last heartbeat. Today the
  green "connected" dot is fixed — it lies if the agent is down.
- [cli] **Board/project selector** in the header (see the Projects section).
- [ui] Global search ⌘K (tickets, files, conversations).
- [adapter] Agent profile: what it knows how to do, what skills it has, what
  it remembers.
- [adapter] Visible configuration: name, language, hours, connected channels.
- [?] Users and permissions (today: one key = full access).
- [ui] Dark mode.
- [ui] Real mobile support (today only the chat drawer works; everything else
  is cramped).

## Chat

- [ui] Reference from the composer: `#` to pick a ticket, `@` for a file, and
  pass it as context to the agent.
- [adapter] Attach files / paste images into the message.
- [ui] Voice dictation (Web Speech API, free on Chrome).
- [adapter] 👍/👎 per response (need to decide where it's stored and what it's
  for).
- [ui] Prompt templates / commands with `/`.
- [ui] "Continue" a cut-off response.
- [ui] When regenerating, navigate versions (‹ 2/3 ›).
- [ui] Search inside the open conversation.
- [adapter] Tokens and cost per response.
- [adapter] Notice that the agent is working on something even without you
  talking to it (a cron running, a ticket in progress).
- [?] Share a conversation via link.

## Pipeline (board)

- [cli] **Create tickets from the portal.** Missing. (`hermes kanban create`)
- [cli] **Comment on a ticket.** Missing. With clear authorship: today the
  adapter signs everything as `portal`; it should say who's you and who's the
  agent.
- [cli] Change status: complete, block, unblock, archive.
- [cli] Edit title and description; priority; assign.
- [cli] **Multiple boards**: create, rename, switch. Missing. (native, see
  Projects)
- [cli] Ticket attachments (`attach`/`attachments`) — invisible in the portal
  today.
- [cli] Dependencies between tickets (`link`) — show parent/child.
- [cli] See the agent's runs on a ticket (`runs`/`log`) — "what it did".
- [ui] Drag cards between columns.
- [ui] Sort by priority/date and saved filters.
- [?] Subtasks / swarm (Hermes supports it; do we show it?).

## Approvals

- [adapter] Who approved and when, visible and auditable (today it signs
  `portal`).
- [adapter] History of past approvals (today only pending ones show).
- [adapter] **Edit before approving** — fix the mail draft and only then
  approve. It's the one a real client asks for the most.
- [adapter] Approval types with their own view (mail, expense, publication).
- [adapter] Notice when something is left waiting (push/mail), and a reminder
  if it's been unanswered for a while.
- [ui] Approve with a comment.

## Tasks (crons)

- [cli] Create, edit and delete scheduled tasks. Today it's console-only.
- [adapter] See the definition/prompt of each task (exactly what we asked it
  to do).
- [adapter] Run history per task with its result and its log.
- [ui] Pause until a date.
- [adapter] Notify if a task fails N times in a row.

## Activity

- [ui] Filters by type and status, and date range.
- [ui] Click an event → opens the ticket or the run.
- [adapter] Pagination / "load more" (today it cuts off at 80 events).
- [ui] Search.
- [?] Export.

## Files

- [ui] Download the file.
- [ui] Search by name; [adapter] search by content.
- [ui] View images and PDFs (today only text).
- [adapter] Upload files to the agent.
- [adapter] **Deliverables vs. internal files**: today `workspace/` mixes
  client-facing reports with debug scripts. See the shared toolkit.
- [?] Delete/rename (read-only is safer).

## Team

- **Team onboarding: done.** An agent with a roster
  (`policy/roles/catalog.json`) no longer shows a single agent's naming step:
  the client picks their first role, names it, the request gets logged and
  the screen waits until it shows up hired in the roster. After that come the
  business and the notification channel, with no naming step. See
  `docs/client-onboarding.md`, Phase 3b.
- [adapter] Add the **second** role from inside the portal (today onboarding
  only covers the first; the rest is requested through Support from the Team
  tab).
- [ui] Have the waiting screen say **since when** it's been requested (the
  `requested_at` field already comes through).
- [?] **Price per role** — undefined, and no number gets published until the
  real cost is measured (marketing generates images).
- [adapter] Let go of a hired role.

## Usage

- [done 8/19] **The number is now real**: `GET /portal/usage` asks
  OpenRouter what was actually charged (today / month / total). The old path
  (`estimated_cost_usd` from `state.db`, litellm) was off by 9x and got
  deleted entirely.
- [adapter] Breakdown by role: OpenRouter charges per key and today there's
  one key per agent; splitting by role needs either one key per role or our
  own attribution.
- [adapter] Monthly budget with an alert (the `limit_usd` field already comes
  through).

---

## Projects: what we found

Hermes **already has both concepts**, nothing to invent:

- **Boards** (`hermes kanban boards`): "separate unrelated streams of work
  (projects, repos, domains) into isolated queues. Each board has its own DB,
  its own workspace directory and its own dispatcher." Today only one exists
  (`default`). They're created, renamed and archived via CLI.
- **Projects** (`hermes project`): human-scale workspaces that span several
  folders or repos, and can be tied to a board (`bind-board`). Built for work
  on code (they anchor worktrees and branches).

**Recommendation:** use **boards** as the portal's "project" axis — they give
real isolation and are native — and leave Hermes Projects for agents that
work on repos. `tenant` stays as a secondary label inside a board. The visible
name of the axis ("Project", "Client", "Area") should come from the manifest,
since it changes per client.

**Where each board lives** (confirmed by creating and deleting a test one,
2026-08-04): the `default` board is `/opt/data/kanban.db`; the rest live at
`/opt/data/kanban/boards/<slug>/kanban.db`, each with a `board.json`
(`slug`, `name`, `description`, `icon`, `color`, `default_workdir`,
**`project_id`**, `created_at`, `archived`). So the board↔Project link is
already built into Hermes's own format.

**Status:** the adapter (v0.10.0) already exposes `GET /portal/boards` and
accepts `?board=<slug>` on board reads (tickets, detail, approvals), with
slug validation and a 404 if it doesn't exist. Without the param it behaves
exactly as before, so nothing breaks.

**What's still needed to actually use it:**
1. Writes (create, comment, change status) still go to the default board:
   the CLI needs `--board=<slug>` passed through.
2. The portal needs a selector in the header and has to carry the chosen
   board in the URL, so sharing a link takes you to the same place.
3. Decide the visible label for the axis ("Project" / "Client" / "Area") from
   the manifest, since it changes per client.
