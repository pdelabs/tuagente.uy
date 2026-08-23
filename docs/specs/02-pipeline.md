# Spec — Pipeline/Kanban (owner: subagent C · dir: app/app/pipeline/)

Source: GET {adapter}/portal/tickets → {tickets:[{id,title,body,status,tenant,created_at}]}.

- Columns by status: blocked ("Esperando tu aprobación"), ready+running
  ("En curso"), done ("Completado"). Archived doesn't show up.
- Tenant chips (clickable filter) + text search on the title.
- Click a card → panel/modal with the full body. Titles as-is (GENERIC:
  don't parse any particular agent's conventions; tickets are free-form).
- Refresh: button + auto every 30s. Look: tonal M3 columns (violet for
  blocked, amber for in progress, green for done).
- DoD: filters+search+modal working against the local test agent; clean
  tsc.
