# Spec — Adapter backend (owner: subagente A · repo ~/Desktop/Luis/Projects/hermes)

Extender data/scripts/portal_adapter.py (stdlib only, mismo estilo) con los
contratos que consumen D y F (ver 03 y 05). Reglas:

- Escrituras de kanban (approve/reject): subprocess al CLI
  `hermes kanban comment|unblock` — DESDE el sidecar el guard NO aplica
  (patrón verificado). JAMÁS SQL de escritura. Approve en el PoC = comentar
  "Aprobado vía portal" + unblock. NADA de enviar mails desde el adapter.
- Lecturas: sqlite mode=ro (tickets/approvals), filesystem (files, confinado
  a /opt/data/workspace con resolve+relative_to, SIEMPRE text/plain),
  activity vía `hermes cron list --json` + runs si existe (explorar CLI),
  usage vía lo que exponga `hermes insights` o state.db ro (explorar; si es
  frágil, devolver lo que haya y documentar).
- manifest v2: declarar módulos según detección real (kanban si existe db,
  approvals si hay blocked, files/usage/activity true) + version.
- Restart para probar: `docker compose restart portal-adapter` (repo hermes).
- DoD: cada endpoint probado con curl (con y sin auth, con Origin) y los
  resultados pegados en el reporte final. Commit en el repo hermes.
