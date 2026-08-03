# Spec — Aprobaciones (owner: subagente D · dir: app/app/aprobaciones/)

LA pantalla del producto. Fuente: adapter (contrato abajo; el subagente A lo
implementa en paralelo — codear contra el contrato, probar live al final).

- GET {adapter}/portal/approvals → {approvals:[{id,title,summary,body,created_at}]}
  (tickets blocked con needs_input).
- POST {adapter}/portal/approvals/{id}/approve → {ok:true} (comenta+desbloquea;
  el worker del agente ejecuta).
- POST {adapter}/portal/approvals/{id}/reject body {reason} → {ok:true}.
- UI: lista de cards grandes (título limpio, resumen, cuánto hace que espera);
  detalle con el body completo (el draft del mail suele estar adentro —
  destacarlo); botones Aprobar (primary) / Rechazar con motivo (dialog).
- Optimista: al aprobar, la card pasa a "ejecutando…" y desaparece al refresh.
- Empty state lindo: "Nada esperando tu aprobación ✋".
- DoD: flujo completo contra un ticket real de La Mano (elegir uno de la lista
  sandbox us-list, aprobar y VERIFICAR que el ticket cambió de estado en el
  kanban — SIN que se envíe ningún mail: coordinar con A que el approve del
  PoC solo comente+desbloquee; el envío real lo decide el agente y sus reglas).
