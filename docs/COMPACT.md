# COMPACT — estado del proyecto (2026-08-05, madrugada)

Contexto destilado para humanos y subagentes. **Fuente de verdad de hechos
VERIFICADOS.** Lo que no diga "verificado", tratarlo como hipótesis.

## Los cuatro repos

| Repo | Qué es |
|---|---|
| `tuagente.uy` | landing pública + **portal del cliente** (`app/app/`) + `docs/` |
| `hermes-kit` | **lo que se instala en el agente de cada cliente** (producto) |
| `agente-pdelabs` | La Mano — el agente de pdelabs, **cliente 0** y fixture |
| `pdelabs-landing` | pdelabs.com, sin relación con esto |

**PRINCIPIO CERO:** el portal sirve a CUALQUIER agente Hermes de cualquier
cliente. Nada específico de un cliente entra al código ni al copy fijo.

## Arquitectura

Portal estático (Next 14) → dos servicios **del agente del cliente**:
- **`:8642`** gateway de Hermes (nativo): chat, sesiones, jobs.
- **`:8643`** `portal_adapter.py` (nuestro sidecar, vive en el kit): tickets,
  aprobaciones, artefactos, archivos, actividad, uso, capacidades, subidas, y el
  **proxy del stream de chat** (el gateway lo sirve sin CORS y el browser lo
  descarta). Hoy **v0.20.0**.

Auth: bearer con `API_SERVER_KEY` por magic link `#endpoint=&adapter=&key=`.
`app/app/lib/agent.ts` es el ÚNICO punto de red del portal.

## El portal (11 pestañas)

Inicio · Chat · Pipeline · Aprobaciones · Artefactos · Tareas · Actividad ·
Archivos · Uso · **Conexiones** · Capacidades. Cada una con su bienvenida propia
(`app/app/lib/intros/`). Kit UI sin sombras, hairline, lucide, cero emojis.

Se puede: chatear con markdown rico (código, KaTeX, mermaid, HTML sanitizado,
artefactos en iframe aislado), adjuntar archivos, referenciar tickets con `#` y
archivos con `@`, crear/comentar/cambiar estado de tickets, **corregir un
borrador y aprobarlo**, ver la consigna real de cada tarea programada con su
historial, y el costo en USD por canal y por modelo.

Un comentario desde el portal **despierta al agente** (el adapter le manda la
ficha del ticket con fechas) y **su respuesta se publica como comentario en el
mismo ticket**. Todos los avisos usan una sola sesión, oculta del chat.

## El kit

`nuevo-agente.sh` (crea el repo del cliente: compose, config.yaml con la receta
de kanban y los toolsets caros apagados, SOUL borrador, skills, adapter) · `install.sh` (instala/actualiza; `--diff` contra la
deriva) · `adapter/` · `skills/` (artifact, entregable, aprobacion) ·
`connections/` (catálogo curado + runbook de Google) · `soul/` (5 bloques con
placeholders) · `onboarding/brief-empresa.md` · `tools/portal-check.py`
(**0 fallas o no se entrega**) y `tools/agente-check.py` (offline, antes de
prender: frontmatter, SOUL sin huecos, los olvidos de config).

## Hechos verificados sobre Hermes (MIT, Nous Research)

- **Skills:** se auto-descubren (un manifiesto mtime+tamaño dispara la
  reindexación, sin comandos ni reinicio) pero **tardan** (~20 min observado).
  Cada `SKILL.md` **necesita frontmatter con `name` y `description`**: sin eso se
  indexa con descripción vacía y el agente no la usa nunca.
- **Bloqueo pegajoso:** un ticket vuelve solo a `ready` salvo que su último
  evento sea un `blocked` **tipado**. Demostrado con control: uno creado con
  `--initial-status blocked` pasó a `ready` en ~75 s; uno bloqueado con la acción
  aguantó. **Un pedido de aprobación creado "bloqueado" se lee como aprobado.**
  Las herramientas nativas no exponen el estado inicial: por ahí no es alcanzable.
- **Toolsets:** el toolset `kanban` (12 herramientas) necesita **dos** claves en
  `config.yaml`: `toolsets: [kanban]` abre el `check_fn`, y `platform_toolsets`
  con `kanban` por plataforma pasa el filtro con el que el gateway arma la
  sesión. Con una sola, cero tools de kanban. `kanban` no está en
  `CONFIGURABLE_TOOLSETS`, así que no se puede pedir por el camino normal.
  Verificado el 4/8 con control en un agente descartable; receta y reproducción
  en `hermes-kit/notas/kanban-nativo.md`. **Nuestro plugin se borró**: lo único
  que hacía era declarar `kanban` en `provides_tools` y destrabarlo de rebote.
- **Contexto:** ~30 KB de system prompt + ~50 KB de esquemas (27-30 tools). De
  los 30 KB, ~16 son Hermes hablando de sí mismo (le dice que es "Hermes Agent by
  Nous Research" y que dar soporte del runtime es parte de su trabajo).
  `hermes tools disable <toolset>` es la palanca grande, sin usar todavía.
- **Crons:** se crean por CLI, no por yaml. Una tarea creada desde una sesión del
  portal entrega a esa sesión, **que no puede recibir mensajes**: corre bien y no
  llega nada, sin aviso.
- **Tableros:** el default es `kanban.db`; los demás en
  `kanban/boards/<slug>/kanban.db` con un `board.json` que ya trae `project_id`.
  El adapter los lista y acepta `?board=`; las escrituras van al default.

## Conexiones (nuevo, 5/8)

El catálogo vive en el kit (`connections/catalogo.json`) y se instala en cada
agente; el adapter calcula el estado **por presencia** de credenciales, archivos
o plugins y nunca devuelve un valor. Tres estados: conectado / sin_conectar /
**bloqueado** (= falta algo NUESTRO, típicamente la app OAuth de tuagente).

Desde el portal no se conecta ni se pegan claves: se **pide**, y eso crea un
ticket. Google Workspace (Sheets, Drive, Agenda, Docs) ya lo soporta el motor;
falta crear una sola app OAuth tipo "Desktop app" nuestra y reusarla en todos
los clientes — ver `hermes-kit/connections/google-workspace.md`.

## Presupuesto de contexto, medido (5/8, agente nuevo)

```
system prompt   39,6 KB   (de eso ~11 KB son los bloques de SOUL del kit)
esquemas tools  67,6 KB   → 60,0 KB apagando tts y delegation
```

Los esquemas pesan casi el doble que el system prompt entero: **la palanca es
`agent.disabled_toolsets`, no reescribir prosa.** kanban solo son 19,8 KB.

## Endpoints verificados

**:8642** — `POST /v1/chat/completions` (stream OpenAI) · `GET/POST /api/sessions`
· `PATCH`/`DELETE /api/sessions/{id}` · `POST /api/sessions/{id}/chat/stream`
(body `{message}` singular, **SSE nativo**, incompatible con el parser OpenAI) ·
`GET /api/jobs?include_disabled=true` (¡sin eso esconde los pausados!) ·
`POST /api/jobs/{id}/pause|resume|run` · `GET /health`.

**:8643** — `manifest` · `tickets` (+`/{id}`, POST crear, comentar, estado) ·
`approvals` (+approve con `{correction}` opcional, reject) · `artifacts`
(+`/{id}`, DELETE) · `activity` · `usage` · `files` (+`/{path}`, siempre
text/plain) · `crons/{id}` · `capabilities` · `boards` · `POST upload` ·
`POST sessions/{id}/chat/stream` (proxy).

## Lecciones duras (NO repetir)

0. **Verificar el camino del cliente, no la pieza recién construida.** Todos los
   huecos de hoy aparecieron cuando Luis empujó, y todos morían con un solo
   comando. Antes de decir "listo": correr el flujo entero desde el estado en que
   lo encontraría un cliente, y separar lo verificado de lo inferido.
1. **kanban.db: jamás SQL de escritura.** Y para leer, `PRAGMA query_only`, NO
   `mode=ro`: en WAL, una conexión de solo lectura crea el `-shm` sin permiso de
   escritura y **rompe a todo el que quiera escribir** (nos tumbaba el dashboard
   de Hermes al ritmo del polling).
2. **Las memorias del agente pisan las herramientas.** Se había escrito solo la
   receta del terminal y la siguió usando aun con herramientas nativas
   disponibles. Dar una herramienta nueva incluye revisar qué tiene memorizado.
3. **Telegram: jamás diagnosticar con `getUpdates` desde afuera** — hay un solo
   long-poll por bot: la sonda le corta la conexión al agente y fabrica la falla
   que quiere medir. Verificar en pasivo con `docker logs`.
4. `docker exec` con heredoc: siempre `-i`. Archivos al browser: siempre
   `text/plain`. Nunca `git add -A` con subagentes escribiendo.
5. `hermes kanban`: opciones `--flag=valor` y `--` antes de los posicionales.

## Estética
M3 expressive del `tailwind.config.ts`: primary #5B4BE8, surface #FBFAFF,
ink #14131F, tonales c-violet/c-green/c-coral/c-amber, Jakarta. Sin sombras.
