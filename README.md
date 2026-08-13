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
tools/limpiar-obsoletos.sh  saca del agente lo que el kit dejo de traer, y nada mas
tools/comparar-instaladores.sh  ¿un agente local y uno remoto reciben el mismo kit?
tools/probar-despliegue-ssh.sh  despliega contra un sshd de verdad (rsync de GNU)
tools/perilla-skills.py     genera la lista de skills del motor a apagar
tools/reemplazar-bloque.py  cambia el bloque kit:base de un SOUL sin tocar el resto
flota.md                    qué agente corre dónde, con qué SOUL y qué motor
```

Un agente instalado queda así:

```
data/           del AGENTE: ahí escribe, y todo lo que viva acá lo puede
                reescribir (adentro de su contenedor corre como root).
politica/       lo que el agente ejecuta pero NO puede editar: la puerta
                (`hooks/`), la guardia de los MCP con el permiso de cada
                conexión, el parche del pairing que s6 corre en cada arranque, y
                el catálogo de capacidades con su registro de pedidos. Lo
                protege el montaje `:ro` de su contenedor —verificado: adentro
                da "Read-only file system" hasta para root—, no el dueño.
kit-skills/     las skills del kit, `:ro` en los dos servicios, para que ni el
                agente las reescriba ni el curator del motor las archive.
kit-adapter/    el CÓDIGO del adapter, `:ro`. Vivía en `data/scripts/` y eso era
                una escalada de privilegio: el agente reescribía el archivo y el
                contenedor del adapter lo ejecutaba **como root** sobre
                `politica/`. Hoy el adapter además corre como uid 10000.
secretos.env    las claves. root:root 600 y FUERA de data/: era el `env_file`
                de los dos servicios, así que con las claves adentro de data/ el
                agente se escribía un `PYTHONPATH` y ejecutaba código suyo
                adentro del adapter (medido). No lo monta nadie.
.kit-instalado  qué archivos puso el kit y con qué sha256 (ver más abajo).
```

Todo eso lo pone `install.sh` en un agente local y `desplegar-remoto.sh` en uno
de la VPS —que le corre el mismo `install.sh` a un staging—; `install.sh --diff`
compara lo instalado contra el kit. El porqué de cada montaje está en
`notas/perillas-aplicadas.md` y en los comentarios de `compose/`.

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

## Un solo instalador

`install.sh` es el único lugar donde se decide qué instala el kit.
`desplegar-remoto.sh` **no tiene su propia lista**: arma un agente de mentira en
`/tmp`, le corre `install.sh`, y sube eso. Antes eran dos listas a mano y
divergieron cuatro veces sin que nada fallara —el catálogo de capacidades no
llegó a ningún agente remoto, el parche del pairing a ninguno local—: nada rompe,
nadie se entera, el cliente recibe una versión peor.

```bash
tools/comparar-instaladores.sh     # ¿los dos caminos ponen lo mismo? 0 = sí
tools/probar-despliegue-ssh.sh     # despliega contra un sshd de verdad (docker)
```

El primero arma los dos agentes y los compara archivo por archivo: correlo
cuando toques cualquiera de los dos scripts. **No valida el protocolo de rsync**
—usa el modo local, y el rsync de la Mac es openrsync, no el GNU de la VPS—, así
que **cualquier opción de rsync se prueba con el segundo**, que levanta un
alpine con sshd y despliega de verdad. `--no-implied-dirs` pasó el primero con
"29 archivos idénticos" y rompía el despliegue remoto al 100%.

**Lo que el kit deja de traer se saca por manifiesto, nunca espejando carpetas.**
Cada agente tiene un `.kit-instalado` (ruta + sha256 de cada archivo que pusimos
nosotros). Para que un archivo se borre tienen que darse **las tres**:

1. estar en la **lista de rutas que el kit puede poseer**
   (`PUEDE_SER_NUESTRO`, en `tools/limpiar-obsoletos.sh`) — son archivos
   exactos, salvo `politica/hooks|tools|mcp/` y `kit-skills/`, que son carpetas
   enteramente nuestras. `politica/` a secas **no** está: adentro viven
   `politica.json` y `capacidades/pedidos.jsonl`, que los escribe el cliente;
2. estar en el manifiesto anterior y ya no en el nuevo;
3. seguir teniendo el sha256 que escribimos nosotros.

Un archivo del cliente falla la 1 aunque alguien lo agregue a mano al
manifiesto — probado. Y si alguien editó un archivo nuestro que ya no traemos,
falla la 3: se avisa y se deja.

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
