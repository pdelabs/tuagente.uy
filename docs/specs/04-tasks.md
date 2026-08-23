# Spec — Scheduled tasks (owner: subagent E · dir: app/app/tasks/)

Everything via :8642 /api/jobs (verified; no adapter).

- Table/cards: name, readable schedule, last status (green/red/gray chip),
  next run, model. GET /api/jobs.
- Actions: pause/resume (POST /api/jobs/{id}/pause|resume) and "run now"
  (POST /api/jobs/{id}/run) with confirmation.
- VERIFY the real shape with curl before coding.
- Do NOT expose: creating/editing/deleting jobs (operator console).
- DoD: pause and resume a real La Mano job (use nightly-backup, which is
  harmless) and see it reflected; clean tsc.
