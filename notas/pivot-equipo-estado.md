# Pivot a equipo — estado al 18/8/2026

Para retomar en una sesión nueva. Todo vive en la rama `pivot-equipo` de los DOS
repos (worktrees en `.claude/worktrees/pivot-equipo`); `main` no sabe nada del
pivot y el rollback es borrar las ramas.

## Qué es el pivot

De "un asistente" a **un equipo**: el cliente contrata roles por separado
(marketing, soporte, ventas, contabilidad). Cada rol es un **profile de Hermes**
en el mismo contenedor — su SOUL, sus skills, su memoria, su nombre y su cara.
Precio de referencia ~1000 UYU/rol, **sin publicar hasta medir el costo real**
(un día de imágenes en Mr.Wobble costó US$1,51: se come el precio).

## Decisiones tomadas (no reabrir sin motivo)

- **Sin recepcionista con cara.** El ruteo es la app, no un sexto personaje.
  Con un solo rol no hay ruteo. Alta: elegís rol → bautizás (opción A).
- **El trabajo queda global; el rol es un atributo** (chip/firma). La ÚNICA
  vista por rol es la pestaña Equipo (`/app/equipo`, `?rol=<id>` la ficha).
- **Chat = una sala.** `@` dirige el turno a alguien (no inserta texto), `/`
  archivos, `#` tickets. Sin `@`, un router en el adapter decide (prompt corto
  directo al proveedor, ~300 tokens, no corre el agente entero). Respuestas
  firmadas; el turno de un compañero viaja como `[X dijo] …`, nunca como
  `assistant` — si no, el siguiente lo lee como propio (medido).
- **La sala la guarda el adapter** (`politica/salas/*.jsonl`, append-only): el
  motor IGNORA el session_id del cliente y acuña uno por turno, así que las
  sesiones del motor no pueden sostener una conversación multi-rol.
- **Contabilidad es SOLO LECTURA** (DGI/factura electrónica). No se negocia.
- **Regla anti-patear** en cada identity.md: nunca derivar lo que sí puede hacer.
- **Catálogo de roles cerrado** en `politica/roles/catalogo.json` (el agente no
  puede reescribir lo que su cliente paga). `routing` es campo comercial: flojo
  = rol pago sin trabajo. No se muestra al cliente.
- **Capacidades**: el cliente elige de un menú curado; NADA de auto-instalarse
  skills (ver memoria `rol-multitasker-y-capacidades`). Falta el rol
  generalista "Asistente" (caso East).
- Honcho (memoria SaaS de terceros): **descartado** — datos del cliente fuera
  del contenedor.

## Qué está construido y probado

**hermes-kit** (`github.com/luisgurmendez/hermes-kit`, PRIVADO, cuenta personal
de Luis — la de orbit NO):
- `roles/`: catalogo.json (identidades con cara por rol), `build_role.py`
  (compone SOUL = kit:base + identity.md, FALLA si un identity redefine reglas
  base), 4 roles con identity.md y **12 flujos curados** (3 por rol).
- Adapter: `GET /portal/roles`, `assignee` en tickets, `POST /portal/chat/stream`
  (role + sala + router), `rooms.py` + `GET /portal/salas[/id]`, evento SSE
  `portal.role` antes del primer token. 20 tests OK.
- `tools/contratar-rol.sh <rol> <agente>`: build + install + **clave propia**
  (el motor falla cerrado: clave del portal → 401 en `/p/<rol>/`) + **reinicio
  del gateway** (`profiles_to_serve` corre solo al arranque) + **symlink del
  workspace del rol al compartido** (si no, el entregable cae donde ninguna
  pantalla lo muestra — probado end-to-end con un ticket real).

**Portal** (tuagente.uy, rama `worktree-pivot-equipo`):
- `lib/roles.tsx` (useRoles/RoleChip/RoleSignature), pestaña Equipo + ficha,
  chip en Tablero, chat-sala completo con salas persistentes.
- Uso está oculto (`MODULOS_OCULTOS`) y "Consumo" borrado de Inicio: el número
  mentía 9x para abajo (litellm no ve image_gen). El camino bueno ya probado:
  `GET https://openrouter.ai/api/v1/key` → usage_daily real por cliente.
- Agente sin roster ⇒ portal idéntico al de hoy (módulo `roles` en false).

**Lab**: `scratchpad/agente-lab`, 4 roles contratados (Vera/Beto/Nina/Tino),
portal local `nohup npx next start -p 8090` (8090 es el único puerto en el CORS
del lab). Clave OpenRouter `lab-equipo-spike`, tope US$5 — **revocar al cerrar**.

## Pendiente (en orden)

1. `install.sh` sigue mandando las 12 skills a todos los agentes.
2. Alta del portal para equipos (elegir rol → bautizar) + intro de Equipo en
   `lib/intros/`.
3. **Medir costo por rol** (bloquea publicar precio).
4. Mr.Wobble sigue pre-pivot; migrarlo cuando Luis quiera. Merge a main es
   decisión de Luis.
5. Sesiones huérfanas del motor (una por turno de sala) se acumulan en cada
   profile — decidimos dejarlas y anotar.
6. Agentes viejos (east, etc.): confirmar que no son de clientes y borrar.
7. Rol "Asistente" + ampliar catálogo de capacidades (6 hoy, ~30 posibles;
   sumar `vision` y `code_execution` primero).

## Reglas de trabajo de Luis

Código Y comentarios **en inglés** (el copy al cliente en rioplatense). **Sin
protective programming** — que se rompa fuerte. Todo el pivot en el worktree
por si quiere rollback. En ping-pong de diseño: respuestas cortas.
