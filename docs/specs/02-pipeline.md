# Spec — Pipeline/Kanban (owner: subagente C · dir: app/app/pipeline/)

Fuente: GET {adapter}/portal/tickets → {tickets:[{id,title,body,status,tenant,created_at}]}.

- Columnas por status: blocked ("Esperando tu aprobación"), ready+running
  ("En curso"), done ("Completado"). Archived no llega.
- Chips de tenant (filtro clickeable) + búsqueda por texto en título.
- Click en card → panel/modal con el body completo (los títulos llevan
  prefijos [en]/[es] y "Lead — Empresa (Contacto)" — parsearlos para mostrar
  limpio: idioma como chip, empresa como título).
- Refresh: botón + auto cada 30s. Estética: columnas tonales M3 (violet para
  blocked, amber para en curso, green para done).
- DoD: filtros+búsqueda+modal funcionando contra La Mano real; tsc limpio.
