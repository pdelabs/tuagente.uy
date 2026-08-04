# Portal tuagente — features por pestaña

Lista de trabajo para editar entre los dos: agregá, sacá o cambiá lo que quieras.

Marcas de viabilidad:
- **[cli]** — Hermes ya lo soporta por CLI/API, solo falta exponerlo en el adapter + UI.
- **[adapter]** — hay que construir lógica nueva en el sidecar (no existe upstream).
- **[ui]** — puro frontend, no toca el agente.
- **[?]** — hay que decidir si lo queremos.

---

## Transversal (shell, todas las pestañas)

- [ui] Badge de pendientes en el sidebar (ej. "Aprobaciones 3").
- [adapter] Estado real del agente: online/offline y último latido. Hoy el punto
  verde "conectado" es fijo — miente si el agente está caído.
- [cli] **Selector de board/proyecto** en el header (ver sección Proyectos).
- [ui] Búsqueda global ⌘K (tickets, archivos, conversaciones).
- [adapter] Perfil del agente: qué sabe hacer, qué skills tiene, qué recuerda.
- [adapter] Configuración visible: nombre, idioma, horarios, canales conectados.
- [?] Usuarios y permisos (hoy: una clave = acceso total).
- [ui] Modo oscuro.
- [ui] Mobile de verdad (hoy el drawer del chat; el resto está apretado).

## Chat

- [ui] Referenciar desde el compositor: `#` para elegir un ticket, `@` para un
  archivo, y pasárselo como contexto al agente.
- [adapter] Adjuntar archivos / pegar imágenes en el mensaje.
- [ui] Dictado por voz (Web Speech API, gratis en Chrome).
- [adapter] 👍/👎 por respuesta (hay que decidir dónde se guarda y para qué sirve).
- [ui] Plantillas de prompt / comandos con `/`.
- [ui] "Continuar" una respuesta cortada.
- [ui] Al regenerar, navegar versiones (‹ 2/3 ›).
- [ui] Buscar dentro de la conversación abierta.
- [adapter] Tokens y costo por respuesta.
- [adapter] Aviso de que el agente está trabajando en algo aunque no le hables
  (un cron corriendo, un ticket en curso).
- [?] Compartir una conversación por link.

## Pipeline (tablero)

- [cli] **Crear tickets desde el portal.** Falta. (`hermes kanban create`)
- [cli] **Comentar en un ticket.** Falta. Con autoría clara: hoy el adapter firma
  todo como `portal`; debería decir quién es vos y quién el agente.
- [cli] Cambiar de estado: completar, bloquear, desbloquear, archivar.
- [cli] Editar título y descripción; prioridad; asignar.
- [cli] **Varios boards**: crear, renombrar, cambiar. Falta. (nativo, ver Proyectos)
- [cli] Adjuntos del ticket (`attach`/`attachments`) — hoy invisibles en el portal.
- [cli] Dependencias entre tickets (`link`) — mostrar padre/hijo.
- [cli] Ver las corridas del agente sobre un ticket (`runs`/`log`) — "qué hizo".
- [ui] Arrastrar tarjetas entre columnas.
- [ui] Orden por prioridad/fecha y filtros guardados.
- [?] Subtareas / swarm (Hermes lo soporta; ¿lo mostramos?).

## Aprobaciones

- [adapter] Quién aprobó y cuándo, visible y auditable (hoy firma `portal`).
- [adapter] Historial de aprobaciones pasadas (hoy solo se ven las pendientes).
- [adapter] **Editar antes de aprobar** — corregir el borrador del mail y recién
  ahí aprobar. Es la que más pide un cliente real.
- [adapter] Tipos de aprobación con vista propia (mail, gasto, publicación).
- [adapter] Aviso cuando algo queda esperando (push/mail), y recordatorio si
  lleva mucho tiempo sin respuesta.
- [ui] Aprobar con comentario.

## Tareas (crons)

- [cli] Crear, editar y borrar tareas programadas. Hoy es solo consola.
- [adapter] Ver la definición/prompt de cada tarea (qué le pedimos exactamente).
- [adapter] Historial de corridas por tarea con su resultado y su log.
- [ui] Pausar hasta una fecha.
- [adapter] Avisar si una tarea falla N veces seguidas.

## Actividad

- [ui] Filtros por tipo y estado, y rango de fechas.
- [ui] Click en un evento → abre el ticket o la corrida.
- [adapter] Paginado / "cargar más" (hoy corta en 80 eventos).
- [ui] Buscar.
- [?] Exportar.

## Archivos

- [ui] Descargar el archivo.
- [ui] Buscar por nombre; [adapter] buscar por contenido.
- [ui] Ver imágenes y PDFs (hoy solo texto).
- [adapter] Subir archivos al agente.
- [adapter] **Entregables vs internos**: hoy `workspace/` mezcla reportes para el
  cliente con scripts de debug. Ver el toolkit común.
- [?] Borrar/renombrar (read-only es más seguro).

## Uso

- [adapter] **Costo en USD** — `state.db` ya guarda `estimated_cost_usd`, no lo
  estamos mostrando.
- [adapter] Desglose por canal (Telegram, portal, crons) y por modelo.
- [ui] Rango configurable (7 / 30 / 90 días) y comparación con el período anterior.
- [adapter] Presupuesto mensual con alerta.

---

## Proyectos: qué encontramos

Hermes **ya tiene los dos conceptos**, no hay que inventar nada:

- **Boards** (`hermes kanban boards`): "separan streams de trabajo no
  relacionados (proyectos, repos, dominios) en colas aisladas. Cada board tiene
  su propia DB, su directorio de workspaces y su dispatcher." Hoy existe uno solo
  (`default`). Se crean, renombran y archivan por CLI.
- **Projects** (`hermes project`): workspaces humanos que abarcan varias carpetas
  o repos, y se pueden atar a un board (`bind-board`). Están pensados para
  trabajo sobre código (anclan worktrees y ramas).

**Recomendación:** usar **boards** como el eje de "proyecto" del portal — dan
aislamiento real y son nativos — y dejar los Projects de Hermes para agentes que
trabajen sobre repos. `tenant` queda como etiqueta secundaria dentro de un board.
El nombre visible del eje ("Proyecto", "Cliente", "Área") debería salir del
manifiesto, porque cambia según el cliente.

**Costo de tenerlo:** el adapter hoy lee `/opt/data/kanban.db` fijo; con varios
boards hay una DB por board, así que hay que resolver la ruta por board y agregar
el board como parámetro en los endpoints del tablero.
