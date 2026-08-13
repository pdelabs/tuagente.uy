# hermes-kit

Lo que tuagente.uy instala en el agente de cada cliente. Antes vivía adentro del
agente de pdelabs, así que dar de alta a alguien nuevo era copiar archivos desde
el agente de otro cliente. Esto lo convierte en un procedimiento.

```
nuevo-agente.sh             crea el repo de un cliente nuevo y le instala el kit
install.sh                  instala o compara el kit contra un agente existente
adapter/portal_adapter.py   el sidecar que el portal consume (:8643)
skills/                     artifact · entregable · aprobacion · capacidad · las sombra
capacidades/catalogo.json   que capacidades se pueden pedir, y como se instalan
politica/hooks/             la puerta: lo que el agente NO puede hacer, en codigo
soul/                       los bloques del system prompt, con placeholders
soul/versiones/vN.md        cada version del bloque tal cual salio, congelada
onboarding/                 la primera tarea del agente (brief de la empresa)
compose/                    plantilla de docker-compose
tools/agente-check.py       revisa el data/ de un agente sin prenderlo (offline)
tools/portal-check.py       verifica que un agente cumpla el contrato del portal
tools/instalar-soul.sh      pone el bloque de SOUL en un agente que no lo tiene
tools/perilla-skills.py     genera la lista de skills del motor a apagar
tools/reemplazar-bloque.py  cambia el bloque kit:base de un SOUL sin tocar el resto
flota.md                    qué agente corre dónde, con qué SOUL y qué motor
```

Un agente instalado queda así: `data/` es del agente (ahí escribe),
`kit-skills/` son las skills del kit, montadas de **solo lectura** para que ni
el agente ni el curator del motor las toquen, y `politica/` es lo que el agente
puede ejecutar pero no editar — la puerta (`hooks/`), la guardia de los MCP con
el permiso de cada conexión, el parche del mensaje de pairing que s6 corre en
cada arranque, y el catálogo de capacidades con su registro de pedidos
(`capacidades/`), que es texto que el cliente lee y el agente no puede
reescribir. Todo eso lo pone `install.sh` en un agente local y
`desplegar-remoto.sh` en uno de la VPS; `install.sh --diff` compara las dos
carpetas contra el kit. El porqué está en `notas/perillas-aplicadas.md`.

## Alta de un cliente nuevo

```bash
./nuevo-agente.sh acme "Acme SA" ~/Desktop/Luis/Projects/agente-acme
```

Crea el repo del agente —compose con el nombre ya puesto, `data/` con su
estructura, `.env.example`, `.gitignore`, un borrador de SOUL armado con los
bloques— le instala el kit y hace el primer commit. Después, a mano:

1. **Componer el SOUL** con los bloques de `soul/` — ver `soul/README.md`.
   Es el único trabajo verdaderamente artesanal y donde está el valor.
2. Completar el compose (`AGENT_NAME`, `TZ`, los dos CORS) y el `.env`.
3. `python3 tools/agente-check.py <ruta>/data` → **0 fallas antes de prender.**
4. `docker compose up -d`
5. `python3 tools/portal-check.py --key <API_SERVER_KEY>` → **0 fallas o no se
   entrega.**

El runbook completo, con los canales (Telegram, WhatsApp oficial vs puente QR) y
los tiempos reales, está en `tuagente.uy/docs/alta-cliente.md`.

## Mantenerlo sincronizado

```bash
./install.sh /ruta/al/agente/data --diff
```

Dice qué archivos difieren entre el kit y un agente ya instalado. **El kit es la
fuente de la verdad**: si arreglaste algo dentro de un agente, copialo al kit
antes de reinstalar o lo vas a pisar. Correlo antes de cada actualización.

## Mirar las bases de un agente

`state.db` y `kanban.db` se abren **solo desde adentro del contenedor**:

```bash
docker exec <cliente>-hermes sqlite3 'file:/opt/data/state.db?mode=ro' '...'
```

Nunca con el `sqlite3` del host sobre el bind mount, **ni de solo lectura**. Los
locks de SQLite no cruzan la frontera host↔VM: el proceso de afuera se cree el
único que tiene la base abierta y toca el índice WAL (`-shm`) que el motor tiene
mapeado en memoria. El motor entonces se muere con `Fatal Python error: Bus
error` en `hermes_state.py … list_sessions_rich`, y s6 lo levanta de nuevo.
Reproducido el 12/8/2026 en un agente local: leyendo `state.db` desde el host
con carga en paralelo, **57 de 60 pedidos a `/api/sessions` se quedaron sin
respuesta**. La variante suave del mismo choque es el `sqlite3.OperationalError:
disk I/O error` intermitente, que en el portal se ve como *"No pude hablar con
tu agente"* y manda a buscar el bug al portal, que no tiene nada que ver.

Y las escrituras al kanban van **siempre** por el CLI
(`docker exec <cliente>-hermes hermes kanban ...`), nunca por SQL.

## Por qué el adapter existe

El gateway de Hermes expone chat, sesiones y jobs, pero no el tablero, los
archivos, las aprobaciones ni los artefactos. Y sirve el stream de chat de
sesiones **sin cabeceras CORS**, así que el browser lo descarta: el adapter lo
proxea. Todo lo que escribe al kanban va por el CLI de Hermes, nunca por SQL.

Contrato y endpoints verificados: `tuagente.uy/docs/COMPACT.md`.

## El kit es una dependencia, no una plantilla

`agente-<cliente>` no *sale* del kit: el kit se **instala adentro** y queda
vinculado. Por eso una mejora del adapter llega a todos los agentes con un
`install.sh`. Si fuera una plantilla que se clona, cada cliente quedaría
congelado en la versión del día que lo diste de alta.
