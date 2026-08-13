# Perillas del motor Hermes v2026.7.30 — qué es configurable y cómo

**Fase A del plan de custodia. Investigación, 12/8/2026. Nada se modificó.**

## De dónde sale la evidencia

Tres fuentes, en orden de fuerza:

1. **El código del motor**, extraído de la imagen local (no se levantó ningún
   contenedor):
   ```bash
   docker run --rm --entrypoint sh nousresearch/hermes-agent:v2026.7.30 \
     -c 'cd /opt/hermes && tar cf - --exclude=node_modules $(ls)' > hermes.tar
   ```
   Las citas `hermes:<archivo>:<línea>` son relativas a `/opt/hermes/` dentro de
   esa imagen.
2. **El prompt efectivo de La Mano**, que el motor guarda entero en
   `state.db` — leída **desde adentro del contenedor**, nunca con el `sqlite3`
   del host (ver el aviso de la sección 5):
   ```bash
   docker exec <cliente>-hermes python3 -c "
   import sqlite3
   c = sqlite3.connect('file:/opt/data/state.db?mode=ro', uri=True)
   print(c.execute(\"select system_prompt from sessions where id='api-f78a7267839058f3'\").fetchone()[0])
   "
   ```
   40.161 caracteres (40.792 bytes UTF-8), sesión `api_server` del 10/8/2026.
3. **El request real al modelo**: `data/sessions/request_dump_cron_*.json`
   (tiene `messages` + los 39 `tools` que el agente vio en una corrida de cron).

Cada hallazgo dice **VERIFICADO** (lo vi en el prompt real, en el config o en el
código del motor) o **INFERIDO** (solo docs / solo lectura de código sin
corrida). Al final hay una lista de lo que no se puede cerrar sin encender.

---

## 0. El mapa del prompt efectivo (base de todo lo demás)

**VERIFICADO.** El prompt se arma en tres tramos (`hermes:agent/system_prompt.py:152-546`)
y así quedó el de La Mano por la API:

| Dónde | Bloque | Tamaño | Quién lo pone |
|---|---|---|---|
| líneas 1-304 | **SOUL.md** (identidad) | 14.083 ch | nosotros |
| 305 | "You run on Hermes Agent (by Nous Research)…" | 560 | motor, **sin perilla** |
| 307 | "# Finishing the job" | 769 | motor, perilla |
| 311 | "# Parallel tool calls" | 618 | motor, perilla |
| 315 | Memoria: "You have persistent memory…" | 1.999 | motor, atado al toolset |
| 321 | Skills: "Skill Safety Rule" | 1.007 | motor, atado a `skill_manage` |
| 328-356 | **"# Kanban task execution protocol"** | ~4.600 | motor, atado al toolset |
| 357 | "## Mid-turn user steering" | 681 | motor, sin perilla |
| 364 | "# Tool-use enforcement" | 824 | motor, perilla |
| 369-417 | "# Execution discipline" + `<act_dont_ask>` … | ~2.600 | motor, misma perilla |
| 418-520 | **"## Skills (mandatory)"** + índice de 78 skills | ~9.000 | motor, filtrable |
| 522-528 | Host / toolchain / perfil activo | ~500 | motor, perilla |
| **530** | **"assume plain text. No markdown formatting"** | 712 | motor, **reemplazable** |
| 532 | MEMORY (lo que el agente aprendió solo) | 1.414 | el agente |
| 545 | Fecha / modelo / proveedor | 115 | motor |

Tres cosas que este mapa deja claras y que valen más que cualquier perilla:

- **El SOUL va PRIMERO y todo lo del motor va DESPUÉS.** El bloque de
  precedencia que propone B2 queda ~500 líneas *antes* de la instrucción que
  quiere anular. Si se escribe como "lo que sigue no manda", tiene que decirlo
  explícitamente, porque el texto que contradice viene después.
- **Los huecos de plantilla llegaron crudos al modelo.** En el prompt guardado
  se lee literal `**JAMÁS <la acción sensible: enviar un mail a un cliente / …>`
  y `<Cómo le ...>` y `<zona horaria>`. No es una hipótesis: está en la base.
- La identidad stock ("You are Hermes Agent, created by Nous Research",
  `hermes:agent/prompt_builder.py:144`) **no aparece** cuando hay SOUL.md: es
  fallback, no agregado (`system_prompt.py:193-201`). Lo que sí aparece siempre
  es "You run on Hermes Agent (by Nous Research)…" (`prompt_builder.py:154`),
  y ese no tiene interruptor.

---

## 1. ¿Se puede apagar o filtrar el catálogo de skills stock?

**SÍ, y por config. VERIFICADO.**

Hay dos claves, y una excluye por plataforma:

```yaml
skills:
  disabled: [himalaya, xurl, computer-use, google-workspace]
  platform_disabled:
    telegram: [otra-mas]
```

- Contrato documentado en el propio módulo: `hermes:hermes_cli/skills_config.py:1-13`
  y `44-61`; el lector que usa el armador de prompt es
  `hermes:agent/skill_utils.py:419-453`.
- El índice del prompt las saltea (`hermes:agent/prompt_builder.py:1616-1620`
  y `1650-1660`), **y además `skill_view` se niega a cargarlas**
  (`hermes:tools/skills_tool.py:1278-1285`). O sea: no es cosmética, la skill
  deja de existir para el agente.
- La lista global se une a la de la plataforma; una skill apagada global queda
  apagada en todas.
- Se puede tocar a mano en `config.yaml` o con `hermes skills` (menú
  interactivo, `skills_config.py`), pero **el config.yaml de los clientes está
  montado `:ro`**, así que en nuestra flota es edición de archivo + redeploy.

**Hoy hay 78 skills en el índice de La Mano: 70 del motor, 6 nuestras y 2 que
escribió el agente.** (Corregido el 12/8: antes esta nota decía "72 son stock".
Las del motor son exactamente las 70 del `.bundled_manifest`, que es la lista
que el propio motor escribe al sembrarlas, y coinciden una a una con las de la
imagen. Las dos restantes —`competitive-intelligence-monitoring` y
`social-content-operations`— tienen `created_by: agent` en `.usage.json`: son
del cliente, no del motor, aunque vivan bajo una categoría del motor. La
diferencia no es cosmética: un generador de blocklist que liste el directorio
en vez del manifiesto le apaga al cliente lo que su agente escribió.)

Las nuestras son `aprobacion, artifact, entrada-drive, entregable, flujo,
transcribir`. Las del motor son categorías enteras que no tienen nada que hacer
en un agente de empresa:

`apple` (apple-notes, apple-reminders, findmy, imessage), `creative` (16:
comfyui, manim-video, p5js, touchdesigner-mcp, songwriting-and-ai-music…),
`email` (**himalaya**), `social-media` (**xurl**),
`autonomous-ai-agents` (claude-code, codex, **computer-use**, opencode),
`mlops` (5), `github` (6), `software-development` (11), `research` (5),
`productivity` (11: **google-workspace**, notion, airtable…), `media`,
`note-taking`, `smart-home`.

Ojo con dos de ellas antes de apagar en bloque: `hermes-agent` es la que el
motor le manda cargar al agente cuando le preguntan por sí mismo (está citada a
mano dentro del preámbulo de skills y en `HERMES_AGENT_HELP_GUIDANCE`), y
`artifact/entregable/aprobacion/flujo` son nuestras.

**Dos mecanismos más, por si se quiere ir más lejos** (VERIFICADO en código):

- Borrar el directorio de la skill es **permanente**: `skills_sync.py` corre en
  cada arranque del contenedor (`hermes:docker/stage2-hook.sh:523-533`) pero
  respeta lo borrado — "DELETED by user (in manifest, absent from user dir):
  respected, not re-added" (`hermes:tools/skills_sync.py:8-23`).
- Un archivo vacío `.no-bundled-skills` en `HERMES_HOME` convierte el sync en
  un no-op para siempre (`hermes:tools/skills_sync.py:58-67`). No borra lo ya
  sembrado; sirve para un agente nuevo.

**Lo que NO se puede apagar:** el preámbulo "## Skills (mandatory) — Before
replying, scan the skills below… you MUST load it" es texto fijo
(`prompt_builder.py:1836-1862`). Solo desaparece si el agente se queda sin
ninguna tool de skills, y eso también nos deja sin `skill_view`, o sea sin las
skills del kit. No es opción.

**Qué habilita:** C1 se puede hacer con una lista en `config.yaml`, sin tocar
la imagen ni el volumen. Con 72 skills afuera se recuperan ~7-8 KB de prompt
por sesión y desaparece la superficie saliente (himalaya = mandar mails, xurl =
postear en X) que hoy está fuera de la guardia.

**Cómo verificarlo después de aplicarlo:** `GET /v1/skills` con la
`API_SERVER_KEY` devuelve exactamente las skills visibles (excluye las
deshabilitadas — `hermes:gateway/platforms/api_server.py:2919-2948`). Es un
chequeo determinístico para `portal-check.py`/`agente-check.py`, sin preguntarle
al modelo.

---

## 2. ¿Se puede suprimir la sección kanban, el preámbulo del api_server y los bloques de memoria?

Tres respuestas distintas.

### 2a. El preámbulo del api_server ("assume plain text") — SÍ, del todo. VERIFICADO.

Existe una clave **de primer nivel** `platform_hints`, no documentada en la
página de configuración del sitio pero presente en los defaults:

```yaml
platform_hints:
  api_server:
    replace: |
      Estás respondiendo dentro del portal del cliente. Renderiza markdown
      completo: encabezados, tablas, listas, bloques de código, KaTeX y
      mermaid. […]
  telegram:
    append: "…"
```

- Default y contrato: `hermes:hermes_cli/config_defaults.py:1993-2001`
  (`{"append": …}`, `{"replace": …}`, o un string suelto = append; `replace`
  gana sobre `append`).
- Lectura: `hermes:agent/agent_init.py:1755-1770` — sale de `_agent_cfg`, que es
  el config completo, **no** de la sección `agent:`.
- Resolución: `hermes:agent/system_prompt.py:73-119`, aplicada en `433-467`.
- Texto que hoy se reemplazaría: `hermes:agent/prompt_builder.py:911-923`
  ("The rendering layer is unknown — assume plain text. No markdown
  formatting (no asterisks, bullets, headers, code fences)").

**Qué habilita:** matar de raíz la contradicción "el motor prohíbe markdown / el
portal lo renderiza con `Markdown.tsx`", en una clave de config, sin depender de
que el SOUL le gane a un texto que viene 200 líneas después. Y el hint queda
**casi último** en el tramo estable: es la mejor posición que da el config.

### 2b. La sección kanban — NO por perilla propia. VERIFICADO.

El bloque de ~4.600 caracteres se inyecta **si y solo si** `kanban_show` está
entre las tools de la sesión (`hermes:agent/agent_init.py:1411-1420` y
`agent/system_prompt.py:238-243`). No hay clave que lo saque dejando las tools.

Las salidas posibles, en orden de costo:

1. **Sacar el toolset `kanban`** (de `platform_toolsets` o con
   `agent.disabled_toolsets`, que se aplica último y pisa todo —
   `hermes:hermes_cli/tools_config.py:2456-2465`). Se va el bloque **y las 12
   tools**: el agente pierde tickets, bloqueos y comentarios. Inviable: la
   puerta de aprobación del kit vive ahí.
2. **Un plugin con middleware `llm_request`** que reescriba el payload antes de
   salir. `apply_llm_request_middleware` permite devolver `{"request": {...}}` y
   *reemplaza los kwargs efectivos del proveedor*, incluido `messages[0]`
   (el system) — `hermes:hermes_cli/middleware.py:76-90`, invocado en
   `hermes:agent/conversation_loop.py:2094-2113`. Los plugins de usuario se
   descubren en `HERMES_HOME/plugins` (`hermes:hermes_cli/plugins.py:1369`), o
   sea `data/plugins/`, que ya existe y está vacío. Es el bisturí: permite
   borrar exactamente ese bloque y dejar el resto igual.
   **Ojo:** el hook `pre_llm_call` NO sirve para esto — su contexto se inyecta
   siempre en el mensaje del usuario, nunca en el system, y está escrito así a
   propósito para no romper el cache (`hermes:hermes_cli/plugins.py:1916-1930`).
3. **Convivir y ganarle por precedencia**, que es lo que hace B2.

**Un desprolijo del motor que conviene dejar anotado (para cuando se negocie o
se reporte upstream).** El comentario del propio código afirma lo contrario de
lo que pasa: *"only present when the dispatcher spawned this process
(kanban_show check_fn gates on HERMES_KANBAN_TASK env var). **Normal chat
sessions never see this block**"* (`hermes:agent/system_prompt.py:234-237`), y
el registro del toolset repite la idea: *"only active when the agent is spawned
by the kanban dispatcher"* (`hermes:toolsets.py:287-292`). **Empíricamente es
falso**: el bloque entero está en el prompt de una sesión `api_server` normal
(`prompt-api-pdelabs-2026-08-12.txt:325-356`). El código real lo explica —`_check_kanban_mode`
devuelve `True` por dos vías, `HERMES_KANBAN_TASK` **o** el perfil con el
toolset `kanban` declarado (`hermes:tools/kanban_tools.py:92-108`)—, pero
ningún comentario de los que uno lee primero lo dice. Es la misma clase de
trampa que ya nos costó un plugin entero en `kanban-nativo.md`: el toolset
`kanban` no se comporta como su documentación interna. Quien lea el motor va a
concluir que el bloque no está, y está.

Vale decir qué dice ese bloque, porque es la mitad del problema del plan: manda
`kanban_block(reason=...)` en vez de preguntar, prohíbe `clarify` ("You are
running headless — there is no live user"), y usa `blocked`/`ready`/`assignee`
como vocabulario normal. Contradice al `04-lenguaje.md` del kit y a la idea de
que del otro lado hay una persona mirando el portal.

### 2c. Los bloques de memoria — SÍ, y con dos perillas distintas. VERIFICADO.

```yaml
memory:
  memory_enabled: true       # el bloque MEMORY del prompt
  user_profile_enabled: true # el bloque USER.md
  memory_char_limit: 2200
  user_char_limit: 1375
  nudge_interval: 10         # 0 = el fork de auto-mejora no se dispara
  write_approval: false
```

- Defaults en `hermes:hermes_cli/config_defaults.py:1531-1554`.
- El bloque volátil sale de `memory_enabled`/`user_profile_enabled`
  (`agent/system_prompt.py:503-512`); el *instructivo* de 2.000 caracteres
  ("You have persistent memory…") sale de tener la tool `memory` en la sesión
  (`system_prompt.py:228-229`), o sea del toolset. Son dos apagadores: se puede
  dejar la memoria y sacar el sermón, o al revés.
- En La Mano hoy hay 1.265 de 2.200 caracteres usados (57%) con cinco memorias
  que el agente escribió solo, todas sobre preferencias de Luis. Ninguna es
  falsa, pero ninguna pasó por revisión humana.

---

## 3. ¿Hay override/append del system prompt además de SOUL.md?

**Sí: cinco, y una es la más fuerte de todas. VERIFICADO en código.**

Ordenados por dónde caen (más abajo = más cerca del final = más peso):

| Mecanismo | Dónde cae | Cómo se prende |
|---|---|---|
| `SOUL.md` | slot 1, primero | ya lo usamos |
| `agent.environment_hint` | con los hints de entorno (~línea 522) | clave de config o `HERMES_ENVIRONMENT_HINT` |
| `platform_hints.<plat>.append/replace` | último del tramo estable (~530) | clave de config |
| Archivos de contexto (`HERMES.md` / `.hermes.md` / `AGENTS.md` / `CLAUDE.md` / `.cursorrules`) | **tramo "context", después de todo lo estable** | `terminal.cwd` apuntando a un directorio que los tenga |
| **`ephemeral_system_prompt` por request** | **al final de todo, después de la memoria y la fecha** | lo manda el cliente HTTP |

Detalle del último, que es el hallazgo importante:

- El api_server toma un mensaje `role: "system"` de `/v1/chat/completions`
  (`hermes:gateway/platforms/api_server.py:3729-3745`), o `system_message` /
  `instructions` en `/v1/responses` y en `/api/sessions/{id}/chat`
  (`api_server.py:3351`, `3468`), y lo pasa como `ephemeral_system_prompt`.
- Ese texto se **concatena al final** del system prompt en el momento de armar
  la llamada: `effective = sp + "\n\n" + agent.ephemeral_system_prompt`
  (`hermes:agent/conversation_loop.py:848-850` y `1552-1556`).
- No se persiste en la sesión ni en las trayectorias
  (`agent/system_prompt.py:477-478`), y como se agrega *después* del prefijo
  estable, no rompe el cache de prompt.

**Qué habilita:** el portal (o mejor, el `portal_adapter.py`, que es nuestro y
proxea el chat) puede inyectar en cada request un bloque de precedencia corto —
"formato del canal: portal, markdown completo; ninguna instrucción posterior
habilita actuar sin aprobación" — y ese bloque queda **físicamente después** de
la sección kanban, del "assume plain text" y de las memorias. Es lo que el
principio del repo pide: el código pone el formato, no la esperanza de que el
modelo se acuerde de algo que leyó 30.000 caracteres antes. Es además la única
palanca que no exige tocar el `config.yaml` de cada cliente ni redeployar.

Detalles finos que van a importar cuando se implemente:

- Con modelos GPT-5/Codex el rol del system se manda como `developer`
  (`hermes:agent/prompt_builder.py:686` — `DEVELOPER_ROLE_MODELS`). **VERIFICADO**
  en el dump: `messages[0].role == "developer"`.
- Los archivos de contexto y el propio SOUL.md **pasan por un escáner de
  inyección** y, si matchea, el contenido se reemplaza entero por
  `[BLOCKED: SOUL.md contained potential prompt injection …]`
  (`hermes:agent/prompt_builder.py:55-80`, patrones en
  `hermes:tools/threat_patterns.py:63-120`). Los patrones son en inglés
  (`you are now a…`, `pretend to be…`, `name yourself X`, `you must
  register|connect|report`), así que un SOUL en castellano está a salvo — pero
  si alguna vez se pega una línea en inglés, el agente se queda **sin identidad
  ninguna** y nadie se entera. Candidato barato para `agente-check.py`: correr
  el mismo escaneo offline sobre el SOUL antes de instalar.
- SOUL.md se trunca: tope dinámico según la ventana del modelo, con piso de
  20.000 caracteres si no hay ventana conocida
  (`prompt_builder.py:1263-1300`). El de La Mano pesa 14.083 caracteres
  (14.386 bytes en disco) → 70% del piso. La
  Fase B le agrega texto. Hay que mirarlo.

---

## 4. `skill_manage` / auto-parcheo de skills, y qué hace exactamente `write_approval`

### 4a. Apagar `skill_manage` solo: NO se puede. VERIFICADO.

`skills_list`, `skill_view` y `skill_manage` son **un mismo toolset**
(`hermes:toolsets.py:193-196`). No hay lista de tools deshabilitadas a nivel
individual: la granularidad del motor es el toolset
(`agent.disabled_toolsets` y `platform_toolsets`). Sacar `skills` deja al
agente sin poder abrir las skills del kit.

Lo que sí se puede apagar es el **disparador** del fork de auto-mejora:
`skills.creation_nudge_interval: 0` y `memory.nudge_interval: 0`
(`hermes:agent/agent_init.py:1706-1710` y `1606-1621`; el gate es `> 0` en
`hermes:agent/turn_finalizer.py:635-655` y `agent/turn_context.py:584-588`).
Con eso el agente sigue pudiendo escribir una skill si se lo piden, pero deja
de haber un proceso de fondo que decide solo qué guardar.

### 4b. `write_approval`: qué hace y —lo importante— dónde aparece el pedido.

`hermes:tools/write_approval.py:19-41` (el docstring es el contrato) y
`hermes:hermes_cli/config_defaults.py:1534-1546` y `1712-1721`.

```yaml
memory: { write_approval: true }
skills: { write_approval: true }
```

- Con `true`, la escritura **no se compromete**: se guarda un pendiente en
  `HERMES_HOME/pending/{memory,skills}/<id>.json` y se revisa fuera de banda.
- Asimetría deliberada: una memoria son ~200 caracteres y se puede aprobar
  inline; una SKILL.md son 10-100 KB y **siempre** se stagea.
- **El punto que decide la Fase C7:** *"Staging is mandatory for
  background-origin writes … and for gateway sessions (no inline prompt
  channel — review happens via `/memory pending`)"*. Nuestro portal es una
  sesión de gateway. **Con `write_approval: true` hoy, el pedido de aprobación
  no aparece en ningún lado que el cliente pueda ver**: queda un JSON en el
  volumen esperando un `hermes memory approve <id>` por CLI.
  Prenderlo sin construir antes la superficie (adapter que liste
  `pending/` + pestaña en el portal) es peor que no prenderlo: el agente deja
  de aprender y nadie sabe por qué.
- Aparte, `skills.guard_agent_created` (default `false`) corre un escáner de
  seguridad sobre lo que el agente escribe con `skill_manage`; los propios
  comentarios del motor dicen que agrega fricción sin seguridad real porque el
  agente puede hacer lo mismo por `terminal()`.

### 4c. El curator: un riesgo que nadie está mirando. VERIFICADO.

`hermes:hermes_cli/config_defaults.py:1725-1770`. Corre solo, cada 7 días, tras
2 horas de inactividad. Marca `stale` a los 30 días sin uso y **archiva a los
90** (mueve el directorio a `skills/.archive/`).

Las skills del kit se copian a `data/skills/` y **no** están en el manifiesto de
bundled ni en el del hub → para el motor son "agent-created" → **siempre
elegibles para archivar** (`hermes:tools/skill_usage.py:427-480`). O sea:
`transcribir` sin usarse 90 días desaparece del índice, y con ella se rompe el
contrato del portal, en silencio.

En La Mano todavía no pasó: `data/skills/.curator_state` dice
`"run_count": 0, "deferred first run"` (VERIFICADO). Está armado, no disparado.

Tres formas de cerrarlo, de menor a mayor cirugía: `curator.enabled: false`;
`hermes curator pin <skill>` para cada skill del kit (hay un flag `pinned` por
skill en `.usage.json`); o montarlas como `external_dirs`, que las vuelve
**nunca elegibles** (ver punto 6). La buena es la tercera.

---

## 5. Cómo capturar el prompt efectivo de forma reproducible

**Hay tres caminos, y el mejor no requiere ni flags ni provocar un error.**

### El bueno: `state.db`. VERIFICADO — es lo que usé para este documento.

El motor guarda el prompt completo de cada sesión en la columna
`sessions.system_prompt` (`hermes:hermes_state.py:2625-2705`, `3736-3741`).

⚠️ **Se lee DESDE ADENTRO DEL CONTENEDOR.** Abrir `state.db` con el `sqlite3`
del host sobre el bind mount **mata al gateway**: los locks de SQLite no cruzan
la frontera host↔VM, el proceso de afuera toca el `-shm` que el motor tiene
mapeado en memoria y el motor se cae con `Fatal Python error: Bus error`
(reproducido el 12/8/2026: 57 de 60 pedidos a `/api/sessions` sin respuesta —
ver "Mirar las bases de un agente" en el README del kit). Y `immutable=1`, que
es lo que decía acá, **no es la salida**: le dice a SQLite que el archivo no
cambia, así que ignora el `-wal` y te devuelve datos rancios. Para capturar
*el prompt efectivo* eso es su propia trampa — la sesión que acabás de abrir
todavía vive en el WAL y no la ves.

```bash
docker exec <cliente>-hermes python3 -c "
import sqlite3
c = sqlite3.connect('file:/opt/data/state.db?mode=ro', uri=True)
for r in c.execute('''select id, source, length(system_prompt) from sessions
                       where system_prompt is not null order by rowid desc limit 5'''):
    print(*r)
"
```

Da una fila por sesión y por plataforma. Hoy en La Mano: `api_server` 40.160 ch,
`cron` 39.800, `cli` 40.420. Se nulea a propósito cuando la sesión se resetea o
se bifurca (`hermes_state.py:3751-3861`), así que siempre refleja lo vigente.

**Propuesta concreta para C2:**

```
snapshot:  tomar la última sesión de source='api_server' y de source='cron',
           normalizar (borrar la línea "Conversation started:" y el bloque
           MEMORY, que son volátiles por diseño), guardar en el repo del
           agente como prompt-efectivo.api_server.txt / .cron.txt
diff:      agente-check.py rehace el snapshot y compara contra el guardado;
           si difiere sin que haya cambiado el SOUL ni el config, es que el
           motor cambió → falla el chequeo al subir de tag
```
Es offline, no toca el agente, y corre con el volumen apagado. Encaja exacto
con el chequeo que ya existe.

### El otro: `HERMES_DUMP_REQUESTS=1`. VERIFICADO en código.

Con esa variable de entorno el motor escribe un `request_dump_<sesión>_<ts>.json`
**antes de cada llamada** al proveedor, con el body entero: system prompt,
mensajes y las definiciones de todas las tools
(`hermes:agent/conversation_loop.py:2176-2177` →
`hermes:agent/agent_runtime_helpers.py:1741-1830`). Los secretos se redactan
antes de escribir. `HERMES_DUMP_REQUEST_STDOUT=1` lo manda a stdout.

Sin la variable, el dump igual se escribe pero **solo cuando la llamada falla**
sin reintento posible — que es exactamente el origen de los dos dumps que hay
en `data/sessions/` (`"reason": "max_retries_exhausted"`).

Es la única fuente que además muestra **la lista de tools**: en el dump de cron
son 39, y ahí se ve funcionando `agent.disabled_toolsets` (no hay `cronjob`, ni
`text_to_speech`, ni `delegate_task`) y funcionando el kanban por
`platform_toolsets` (las 12 `kanban_*` presentes). Costo: un JSON de 124 KB por
llamada. Para diagnóstico puntual, no para dejar prendido.

### El tercero: los endpoints de introspección. VERIFICADO en código.

El api_server ya expone, con la `API_SERVER_KEY`
(`hermes:gateway/platforms/api_server.py:1803-1850`):

- `GET /v1/skills` — las skills visibles, sin las deshabilitadas.
- `GET /v1/toolsets` — cada toolset con `enabled`, `configured` y las tools a
  las que expande, resuelto para la plataforma `api_server`.
- `GET /v1/capabilities`, `GET /v1/models`.

No devuelven el prompt, pero cubren las dos entradas que lo determinan (skills y
tools) y son perfectas para `portal-check.py`.

---

## 6. Montar `data/skills/<skill>` como bind `:ro`: ¿rompe algo?

**Analizado, no aplicado. El reindexado NO se rompe. Pero hay una opción mejor
y soportada.**

Lo que averigüé del mecanismo (VERIFICADO en código):

- El índice se cachea en `data/.skills_prompt_snapshot.json`, validado por un
  manifiesto de `(mtime_ns, size)` de cada `SKILL.md`, recorrido con
  `followlinks=True` (`hermes:agent/prompt_builder.py:1369-1428`). Un bind
  preserva mtime y tamaño → el snapshot sigue válido; si el archivo del host
  cambia, cambia el mtime y se reindexa solo. **No rompe nada.**
- Lo que el motor escribe vive en el **directorio padre**, no adentro de cada
  skill: `.usage.json`, `.usage.json.lock`, `.bundled_manifest`, `.curator_state`
  (`hermes:tools/skill_usage.py:81-86`). `data/skills/` sigue escribible → la
  telemetría sigue andando.
- `skills_sync.py` en el arranque solo toca skills del manifiesto bundled; las
  nuestras no están ahí, así que no las pisa
  (`hermes:tools/skills_sync.py:8-23`).
- Lo que **sí** falla contra un `:ro`: `skill_manage(action='patch'|'edit')`
  sobre esa skill (EROFS, sale como error de tool al agente — que es lo que
  queremos) y el archivado del curator, que es un *move* del directorio: mover
  un punto de montaje falla con EBUSY/EXDEV y el curator lo va a loguear como
  error recurrente cada 7 días.

**La opción mejor: `skills.external_dirs`.** Está en los defaults
(`hermes:hermes_cli/config_defaults.py:1682-1684`) y **sí está documentada**
(https://hermes-agent.nousresearch.com/docs/user-guide/features/skills).

```yaml
skills:
  external_dirs: ["/opt/kit/skills"]
```
con `- ./kit-skills:/opt/kit/skills:ro` en el compose. Propiedades, todas
verificadas en código:

- Se escanean junto con las locales y **entran al índice del prompt igual**
  (`prompt_builder.py:1737-1775`).
- Son **read-only por diseño**: toda creación va al directorio local.
- **El curator nunca las toca**: `is_curation_eligible` devuelve `False` para
  cualquier ruta externa (`hermes:tools/skill_usage.py:469-480`). Se cae solo el
  riesgo del punto 4c.
- `skills_sync` no las shadowea: indexa los nombres externos antes de sembrar
  (`hermes:tools/skills_sync.py:84-137`).
- Las locales ganan si hay choque de nombres — o sea, un cliente puede
  sobrescribir una skill del kit poniendo una propia con el mismo nombre, que
  es exactamente la semántica que queremos.

Costo: los directorios externos **no** entran en el snapshot en disco, se
reescanean en cada armado de prompt frío. Con 6 skills es ruido.

**Recomendación para C3:** montar el kit como `external_dirs`, no como bind de
`data/skills/<skill>`. Sigue siendo redeploy de todos los agentes (mismo costo
de arquitectura), pero además de hacer las skills inmutables las saca del
alcance del curator, y es un camino soportado y documentado en vez de un truco
de montaje.

---

## 7. Granularidad del cron nativo y de los toolsets

### 7a. Toolsets: la lista completa. VERIFICADO.

Configurables uno por uno (`hermes:hermes_cli/tools_config.py:95-123`), 27:

`web`, `browser`, `terminal`, `file`, `code_execution`, `vision`, `video`,
`image_gen`, `video_gen`, `bfl`, `x_search`, `tts`, `stt`, `skills`, `todo`,
`memory`, `context_engine`, `session_search`, `clarify`, `delegation`,
`cronjob`, `homeassistant`, `spotify`, `discord`, `discord_admin`, `yuanbao`,
`computer_use`.

No configurables pero sí declarables a mano en `platform_toolsets` (pasan por
el "explicit passthrough", `tools_config.py:2425-2433`) — ahí es donde entra
`kanban`, que es lo que la nota `kanban-nativo.md` descubrió a los golpes.
La lista completa de no-configurables es: `kanban`, `project`, `search`,
`feishu_doc`, `feishu_drive`, y los de escenario `debugging`, `safe`, `coding`.

Compuestos: `hermes-cli`, `hermes-api-server`, `hermes-telegram`,
`hermes-discord`, `hermes-whatsapp`, `hermes-slack`, `hermes-signal`,
`hermes-cron`, `hermes-acp`, más `debugging`, `safe` y `coding`
(`hermes:toolsets.py:406-609`).

Reglas de composición que conviene tener escritas (`_get_platform_tools`,
`tools_config.py:2195-2480`):

- Si la lista de una plataforma menciona **algún** toolset configurable, el
  motor cambia de modo y toma la lista como declaración explícita.
- `agent.disabled_toolsets` **se aplica al final y pisa todo**, incluido lo que
  pusiste explícito en `platform_toolsets` (`2456-2465`). Es el interruptor
  maestro.
- El centinela `no_mcp` en la lista de una plataforma le saca **todos** los
  servidores MCP a esa plataforma (`2435-2452`). Perilla útil que no usamos:
  hoy el MCP de mercadopago está disponible en todas.
- `hermes-api-server` incluye `cronjob` y las tools de Home Assistant. Lo
  primero ya lo apagamos con `disabled_toolsets`.

**Granularidad que NO existe:** por tool individual. Si un toolset trae una
tool que no queremos (el caso `skill_manage`), la única salida por config es
sacar el toolset entero.

### 7b. Cron: tiene bastante más granularidad de la que usamos. VERIFICADO.

Del `data/cron/jobs.json` de La Mano (4 flujos, todos con los mismos campos en
default) y de `hermes:cron/jobs.py:1260-1430`, cada job acepta:

| Campo | Hoy en La Mano | Para qué sirve |
|---|---|---|
| `enabled_toolsets` | `null` | **allowlist de toolsets solo para ese job** |
| `skills` | `[]` | precargar skills concretas en la corrida |
| `model` / `provider` | `null` | modelo distinto por flujo (uno barato para el que solo mira si hay novedad) |
| `deliver` | `"local"` | a dónde va la respuesta (plataforma + chat) |
| `workdir` | `null` | directorio de trabajo del job |
| `context_from` | `null` | heredar contexto de otra sesión |
| `no_agent` / `script` | `false` / `null` | correr un script sin loop de agente |
| `repeat.times` | `null` | tope de ejecuciones |
| `origin` | `api_server` + chat | de dónde vino |

Y la resolución (`hermes:cron/scheduler.py:160-250`):

- El cron **siempre** apaga `cronjob`, `messaging` y `clarify`, pase lo que pase.
- `agent.disabled_toolsets` se superpone al `enabled_toolsets` del job, así que
  un job no puede ensancharse más allá de la política global (arreglaron
  justamente eso: "LLM-supplied enabled_toolsets was widening past config.yaml's
  denylist").
- Si el job no trae lista propia, cae en `platform_toolsets.cron`, que nosotros
  sí configuramos.

**Qué habilita:** un flujo puede correr con `enabled_toolsets: [web, file,
kanban]` — sin `terminal`, sin `browser`, sin `skill_manage`, sin `memory`. Es
la forma barata de que "lo programado" tenga menos poder que "lo que pide una
persona", sin escribirlo en el SOUL y esperar que se cumpla. Vale la pena
mirarlo cuando se toque `flujo`/`FLUJO.md`.

Un detalle relevante para la Fase B: los jobs se crean por CLI (la memoria del
proyecto ya lo dice) y el `prompt` de cada flujo de La Mano apunta a
`/opt/data/flujos/<nombre>/FLUJO.md`. El vocabulario "flujo" ya está en los
nombres de los jobs. Bien.

---

## Lo que no se puede cerrar sin encender el motor

Todo lo de arriba sale de código, config o del prompt ya guardado. Estas cinco
cosas necesitan una corrida y quedan para cuando Luis decida aplicar:

1. **Que `skills.disabled` efectivamente achique el índice**: apagar 5 skills,
   reiniciar, y comparar `GET /v1/skills` y el `length(system_prompt)` de la
   sesión siguiente contra los 40.160 de hoy.
2. **Que `platform_hints.api_server.replace` reemplace el texto**: reiniciar y
   `grep "assume plain text"` sobre el nuevo `system_prompt` en `state.db`.
   Debería dar cero.
3. **Que el `ephemeral_system_prompt` llegue de verdad por el proxy del chat**:
   mandar un `role: "system"` por `/v1/chat/completions` con
   `HERMES_DUMP_REQUESTS=1` y verificar que aparece **al final** del
   `messages[0]` del dump. Es el único de los cinco que se prueba en un minuto y
   el que más cambia el plan.
4. **Que `external_dirs` no rompa el arranque** con el volumen ya poblado
   (colisión de nombres entre `data/skills/entregable` y el externo: local gana,
   pero hay que ver el mensaje).
5. **Qué hace `write_approval: true` en una sesión de portal**: confirmar que
   escribe en `data/pending/memory/` y que el agente sigue respondiendo normal
   (el código dice que sí; verlo antes de prometerle una pestaña "Memoria" al
   cliente).

---

## Resumen para el plan

| Fase | Qué se puede hacer con lo encontrado |
|---|---|
| C1 | `skills.disabled` (72 skills stock afuera) + `platform_hints.api_server.replace` (adiós "assume plain text"): dos claves de `config.yaml`. La sección kanban **no** tiene perilla: o se va con las tools, o se le gana por precedencia, o se borra con un plugin de middleware `llm_request`. |
| C2 | El snapshot del prompt sale de `sessions.system_prompt` en `state.db`, offline y sin flags. Diff en `agente-check.py` al subir de tag. |
| C3 | Usar `skills.external_dirs` en vez de bind `:ro` de `data/skills/<skill>`: inmutable **y** fuera del alcance del curator, que hoy puede archivar nuestras skills a los 90 días sin uso. |
| C4 | El `ephemeral_system_prompt` por request (lo inyecta el adapter) cae **después de todo** el prompt del motor. Es el lugar donde el contrato de canal/remitente y la precedencia se imponen por código, no por confianza. |
| C7 | `memory.write_approval: true` en una sesión de gateway **no muestra el pedido en ningún lado**: stagea a `pending/memory/*.json` y espera un comando de CLI. Sin pestaña de Memoria en el portal, prenderlo es apagar el aprendizaje sin avisarle a nadie. |
| B (ojo) | El SOUL va **primero** y todo lo del motor **después**; el bloque de precedencia tiene que decirlo explícitamente. Y SOUL.md pasa por un escáner de inyección que, si matchea, lo reemplaza entero por `[BLOCKED: …]` y deja al agente sin identidad. Vale un check offline en `agente-check.py`. |
