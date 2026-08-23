# Spec — Activity + Files + Usage (owner: subagent F · dirs: app/app/{activity,files,usage}/)

Three small screens against the adapter (contract below; A builds it in
parallel).

1. Activity: GET {adapter}/portal/activity → {events:[{ts,kind,label,status}]}
   (job runs with their result, deliveries). Simple vertical timeline,
   status chips, grouped by day.
2. Files: GET {adapter}/portal/files → {files:[{path,size,mtime}]} and
   GET {adapter}/portal/files/{path} → text/plain. List + monospace text
   viewer (the workspace's .md files: reports, dossiers). Read-only.
3. Usage: GET {adapter}/portal/usage → {sessions,input_tokens,output_tokens,
   total_tokens,period}. Large tonal tiles with tabular numbers.
   > *(Historical note, added during the English rename: this was the v1
   > shape of the Usage endpoint. It was retired for returning wrong
   > numbers and replaced by the Spanish `/portal/uso`, which reports real
   > provider spend in USD. RENAME-MAP D4 renames that live `/portal/uso`
   > to `/portal/usage` — same English name as this retired v1, different
   > shape: `{available, reason, today_usd, month_usd, total_usd,
   > limit_usd, updated_at}`. This section's shape above is retired; it
   > does not describe the current endpoint. See `docs/portal-agent-spec.md`
   > for the live one.)*
- DoD: all three screens against the real La Mano agent once A publishes;
  until then, against the contract with elegant "endpoint not available"
  states.
