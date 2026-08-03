# Spec — Tareas programadas (owner: subagente E · dir: app/app/tareas/)

TODO por :8642 /api/jobs (verificado; sin adapter).

- Tabla/cards: nombre, schedule legible, último estado (chip verde/rojo/gris),
  próxima corrida, modelo. GET /api/jobs.
- Acciones: pausar/reanudar (POST /api/jobs/{id}/pause|resume) y "correr ahora"
  (POST /api/jobs/{id}/run) con confirmación.
- VERIFICAR shape real con curl antes de codear.
- NO exponer: crear/editar/borrar jobs (consola de operador).
- DoD: pausar y reanudar un job real de La Mano (usar nightly-backup que es
  inocuo) y verlo reflejado; tsc limpio.
