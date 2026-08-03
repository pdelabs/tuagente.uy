# Spec — Aprobaciones (owner: subagente D · dir: app/app/aprobaciones/)

LA pantalla del producto. Fuente: adapter (contrato abajo; el subagente A lo
implementa en paralelo — codear contra el contrato, probar live al final).

- GET {adapter}/portal/approvals → {approvals:[{id,title,summary,body,created_at}]}
  (tickets blocked con needs_input).
- POST {adapter}/portal/approvals/{id}/approve → {ok:true} (comenta+desbloquea;
  el worker del agente ejecuta).
- POST {adapter}/portal/approvals/{id}/reject body {reason} → {ok:true}.
- UI: lista de cards grandes (título, resumen, cuánto hace que espera);
  detalle con el body completo tal cual (dominio libre — puede ser un mail,
  un pago, un post: el portal no asume). Aprobar (primary) / Rechazar con
  motivo (dialog).
- Optimista: al aprobar, la card pasa a "ejecutando…" y desaparece al refresh.
- Empty state lindo: "Nada esperando tu aprobación ✋".
- DoD: flujo completo contra un ticket real del agente de prueba (sandbox),
  verificando el cambio de estado en el kanban. El approve del adapter SOLO
  comenta+desbloquea — lo que pase después lo deciden las reglas del agente
  (en el fixture: nada se envía, el gate del agente sigue mandando).
