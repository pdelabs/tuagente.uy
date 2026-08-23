# Spec — Adapter backend (owner: subagent A · repo ~/Desktop/Luis/Projects/agente-pdelabs)

Extend data/scripts/portal_adapter.py (stdlib only, same style) with the
contracts D and F consume (see 03 and 05). Rules:

- Kanban writes (approve/reject): subprocess to the CLI
  `hermes kanban comment|unblock` — the guard does NOT apply FROM the
  sidecar (verified pattern). NEVER write SQL. Approve in the PoC = comment
  "Aprobado vía portal" + unblock. NO sending mail from the adapter.
- Reads: sqlite mode=ro (tickets/approvals), filesystem (files, confined to
  /opt/data/workspace via resolve+relative_to, ALWAYS text/plain), activity
  via `hermes cron list --json` + runs if it exists (explore the CLI),
  usage via whatever `hermes insights` exposes or state.db ro (explore; if
  it's fragile, return whatever's there and document it).
- manifest v2: GENERIC — agent name from env AGENT_NAME (fallback: read the
  agent's own config branding, never hardcode), modules by real detection
  (kanban if a db exists, approvals if there's anything blocked,
  files/usage/activity per availability) + adapter version.
- Restart to test: `docker compose restart portal-adapter` (hermes repo).
- DoD: every endpoint tested with curl (with and without auth, with
  Origin) and the results pasted into the final report. Commit to the
  hermes repo.
