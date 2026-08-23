# Spec — Approvals (owner: subagent D · dir: app/app/approvals/)

THE product screen. Source: the adapter (contract below; subagent A builds
it in parallel — code against the contract, test live at the end).

- GET {adapter}/portal/approvals → {approvals:[{id,title,summary,body,created_at}]}
  (blocked tickets with needs_input).
- POST {adapter}/portal/approvals/{id}/approve → {ok:true} (comments+unblocks;
  the agent's worker executes).
- POST {adapter}/portal/approvals/{id}/reject body {reason} → {ok:true}.
- UI: list of large cards (title, summary, how long it's been waiting);
  detail with the full body as-is (free-form — could be a mail, a payment,
  a post: the portal makes no assumptions). Approve (primary) / Reject with
  a reason (dialog).
- Optimistic: on approve, the card switches to "running…" and disappears on
  refresh.
- Nice empty state: "Nada esperando tu aprobación ✋".
- DoD: full flow against a real ticket on the test agent (sandbox),
  verifying the status change in the kanban. The adapter's approve ONLY
  comments+unblocks — what happens after that is up to the agent's own rules
  (in the fixture: nothing gets sent, the agent's gate keeps enforcing).
