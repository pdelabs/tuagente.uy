# Pivot a equipo — estado al 19/8/2026

Para retomar en una sesión nueva. Todo vive en la rama `pivot-equipo` de los DOS
repos (worktrees en `.claude/worktrees/pivot-equipo`); `main` no sabe nada del
pivot y el rollback es borrar las ramas.

## Qué es el pivot

De "un asistente" a **un equipo**: el cliente contrata roles por separado
(marketing, soporte, ventas, contabilidad, y el asistente a medida). Cada rol es un **profile de Hermes**
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
- Uso VOLVIÓ (19/8): el número lo da el proveedor. `GET /portal/uso` en el
  adapter le pregunta a `https://openrouter.ai/api/v1/key` con la clave del
  agente (server-side, la clave nunca llega al browser), cachea 5 minutos y
  sirve hoy/mes/total/tope. El manifiesto enciende `usage` sólo si hay
  `OPENROUTER_API_KEY`. `/portal/usage` y `costos.jsonl` murieron con el número
  viejo. "Consumo" sigue borrado de Inicio.
- Agente sin roster ⇒ portal idéntico al de hoy (módulo `roles` en false).

**Lab**: `scratchpad/agente-lab`, 4 roles contratados (Vera/Beto/Nina/Tino),
portal local `nohup npx next start -p 8090` (8090 es el único puerto en el CORS
del lab). Clave OpenRouter `lab-equipo-spike`, tope US$5 — **revocar al cerrar**.

**Quirk del lab (solo Mac):** el file-sharing de Docker Desktop cachea el
tamaño de los archivos bind-mounteados; tras reescribir `politica/roles/
catalogo.json` desde el host, el adapter puede leerlo TRUNCADO al tamaño
viejo (JSONDecodeError en `line <última>`). `docker restart lab-portal-adapter`
lo limpia. En un remoto Linux no pasa. Por esto mismo `deja()` en
`contratar-rol.sh` escribe con tmp+mv (afde4bf).

## Hecho el 19/8 (olas 1-4, orquestadas con subagentes + validador cada una)

- **Catálogo de capacidades v2** (b659ad2): 25 filas, niveles base/menú,
  `paquete-social` como UNA oferta. Salió de 3 investigaciones + devil's
  advocate: `notas/capacidades-50-veredicto.md` y `notas/research-capacidades/`.
- **install.sh por rol** (81ad2d6): split mecánico en `roles/skills_split.py`
  (intersección de roles ready + fallbacks + skills de capacidades base);
  retrocompat sin roster probada con diff byte a byte; curator apagado.
- **Pipeline de contratación** (181df5b + afde4bf): `POST /portal/roles/pedido`
  (ledger append-only), `GET /portal/roles` con contratado/pedido/bautizo,
  `contratar-rol.sh --del-pedido|--nombre|--pinta-file` con nombre al SOUL en
  build temporal. E2E verde contra el lab vivo.
- **Portal** (84b6c77 + 853e643): alta de equipo (elegir rol → bautizar →
  pedido → espera → onboarding recortado con negocio+canal), intro de Equipo,
  y "sumar otro rol" desde la pestaña (`?sumar=<rol>`). Un agente con equipo
  nunca ve el bautizo de agente único.

## Hecho el 19/8, segunda tanda (olas 5-6)

- **"Qué sabe hacer" en la ficha del rol**: base como incluido (sin botón),
  activas, y el menú agrupado y colapsado. La tarjeta del chat aprendió lo
  mismo: una base apagada pide "avisanos", no "pedila". QA visual contra el
  lab migrado (que ya corre install nuevo + catálogo v2: agente-check 0
  fallas, portal-check cumple).
- **Rol Asistente ("Lola")**: identity con anti-patear y el flujo de la skill
  capacidad, routing = fallback del roster que no le roba a los de oficio,
  3 flujos sobre capacidades base. El split no se movió.
- **"¿Qué necesitás que haga?"**: POST /portal/capacidades/sugerir (una
  llamada al proveedor, patrón router, ids validados contra el menú,
  sin_matching degrada al menú entero sin marcar); el pedido viaja con
  `capacidades` y contratar-rol.sh las imprime al contratar (no auto-instala).
  La pregunta aparece en el alta Y al sumarlo desde Equipo. 47 tests.

## Pendiente (en orden)

1. **Medir costo por rol** (bloquea publicar precio).
4. Mr.Wobble sigue pre-pivot; migrarlo cuando Luis quiera. Merge a main es
   decisión de Luis.
5. Sesiones huérfanas del motor (una por turno de sala) se acumulan en cada
   profile — decidimos dejarlas y anotar.
6. Agentes viejos (east, etc.): confirmar que no son de clientes y borrar.
7. Rol "Asistente" + ampliar catálogo de capacidades (6 hoy, ~30 posibles;
   sumar `vision` y `code_execution` primero).
8. **Medir el curator en el lab, en vez de deducirlo.** `config.base.yaml` ya
   apaga `curator.enabled`, porque en un agente con equipo la ÚNICA copia de
   una skill de oficio vive en `data/profiles/<rol>/skills/` — que es del
   agente, escribible, y que al motor le parece "agent-created", o sea
   archivable a los 90 días sin uso (`perillas-motor.md:370-388`). La perilla
   es cinturón y tiradores; falta la medición, que son dos preguntas: (a)
   ¿`is_curation_eligible` da True para una skill que puso `hermes profile
   install`?, y (b) ¿`skill_manage` puede reescribir la skill de un profile, o
   se topa con algo? Las dos se contestan en el lab, con los cuatro roles ya
   contratados.
9. **Los cuatro roles del lab arrastran un `transcribir` viejo adentro de
   soporte.** Se contrataron con el `role.json` v0.1.0, que lo declaraba; la
   distribución de hoy es v0.1.1 con cuatro skills. `hermes profile install` no
   saca lo que ya está: hay que pasarles `hermes profile update` (o reinstalar)
   y verificar que soporte quede con aprobacion/entregable/flujo/capacidad y
   nada más.
10. **`entrada-drive` no llega a ningún agente con equipo.** Es la única que
    lista `skills_split.py --orphan`: ningún rol la declara y no es nota de
    fallback. Y el ejemplo canónico de `skills/flujo/crear_flujo.py:21-24` —que
    sí viaja a todos, porque `flujo` es compartida— arma su flujo de muestra con
    `--gatillo drive` y `--skills entrada-drive,…`. O le damos dueño (¿soporte?
    ¿el "Asistente"?) o sacamos el ejemplo: hoy le estamos enseñando a cada rol
    a armar un flujo con una skill que no tiene.
11. **Un cliente que contrata SOLO soporte se queda sin `artifact`.** Es el
    único de los cuatro que no la declara, y `artifact` es lo que hay atrás de
    la pantalla de visualizaciones del portal (`entregable`→Archivos,
    `aprobacion`→Aprobaciones, `artifact`→artefactos): contrata su rol y una
    pestaña queda sin nada que la sostenga. Decidir si soporte la declara
    (y entonces v0.1.1 → v0.1.2) o si la pantalla se apaga cuando no está.
12. **`pedidos.jsonl` no cruza el rename de las capacidades.** `imagenes` y
    otras cuatro se juntaron en `paquete-social`, así que los pedidos ya
    anotados quedan con ids que el catálogo nuevo no tiene. No rompe nada —el
    archivo es append-only y el portal lee el catálogo—, pero cualquier
    análisis histórico de qué pidieron los clientes no junta el antes con el
    después. Nota de análisis, no tarea.

## Reglas de trabajo de Luis

Código Y comentarios **en inglés** (el copy al cliente en rioplatense). **Sin
protective programming** — que se rompa fuerte. Todo el pivot en el worktree
por si quiere rollback. En ping-pong de diseño: respuestas cortas.
