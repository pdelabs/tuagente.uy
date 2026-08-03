# Spec — Pipeline/Kanban (owner: subagente C · dir: app/app/pipeline/)

Fuente: GET {adapter}/portal/tickets → {tickets:[{id,title,body,status,tenant,created_at}]}.

- Columnas por status: blocked ("Esperando tu aprobación"), ready+running
  ("En curso"), done ("Completado"). Archived no llega.
- Chips de tenant (filtro clickeable) + búsqueda por texto en título.
- Click en card → panel/modal con el body completo. Títulos tal cual vienen
  (GENÉRICO: nada de parsear convenciones de un agente particular; los tickets
  son de dominio libre).
- Refresh: botón + auto cada 30s. Estética: columnas tonales M3 (violet para
  blocked, amber para en curso, green para done).
- DoD: filtros+búsqueda+modal funcionando contra el agente de prueba local; tsc limpio.
