# Flota

Qué agente corre dónde, con qué versión del bloque de SOUL y con qué motor.

Existe porque el kit es una dependencia, no una plantilla: una regla nueva no
llega sola a nadie. Sin esta tabla, "reinstalales el SOUL a todos" es una lista
que alguien tiene que reconstruir de memoria, y el que se olvida es siempre el
que menos se mira.

**Se actualiza a mano, en el mismo momento en que se toca un agente.** Una fila
con fecha vieja no es un problema; una fila que dice algo que ya no es cierto sí.

| Agente | Host | SOUL | Motor | Último check |
|---|---|---|---|---|
| Mr.Wobble | `tuagente` → `/opt/agentes/tuagente` | **v11** (13/8: el bloque del host tiene el mismo sha256 que `soul/versiones/v11.md`) | `v2026.7.30` (verificado con `docker ps`, no solo con el compose) | 13/8 (2ª vuelta, con el adapter partido): **24 ok · 2 avisos · 1 falla** — la falla es `SOUL: identidad`, y es real: quedó **sin identidad artesanal** (ver abajo). `portal-check --entrega`: 14 ok · 0 fallas |
| East Comunicación | `east` → `/opt/agentes/east` | TODO | TODO | TODO |

**Mr.Wobble quedó en cero y al día el 13/8/2026** — reset TOTAL por decisión de
Luis, así que se fue también el SOUL y con él el bautizo. Tiene v11, la guardia
de las promesas (probada contra el agente vivo, no solo instalada), la puerta en
código, el adapter fuera de `data/`, los secretos en `secretos.env` y el
`config.yaml` con las cuatro perillas. **Lo único que le falta para servir es la
identidad**, que es lo que `agente-check.py` reporta: el SOUL no dice quién es ni
para quién trabaja, así que hoy contesta como el asistente genérico del motor.
Se cierra de una de dos formas: que el cliente lo bautice en el portal (escribe
el bloque `portal:identidad`) o que una persona escriba `00-identidad.md`. Hasta
entonces la fila dice 1 falla a propósito: no se tapa con un texto de relleno.

**Queda atrás con v11 East** (bloque del 13/8/2026: las frases que no se pueden
escribir sin haberlo hecho — "queda definido", "queda armado", "todos los
viernes a las 9:30 te dejo X"; y desde v10, rechazo que no desbloquea y
vocabulario). De East no sabemos ni la versión, que es peor que saberla vieja:
no entiende todavía qué es un rechazo, así que **rechazar desde el portal le deja
el ticket bloqueado y el agente no sabe qué hacer con eso**. Migrarlo es una
corrida de `tools/reemplazar-bloque.py` con `soul/versiones/v11.md`, mirando
antes el diff de lo que esté escrito a mano. Sin agentes locales de cliente hoy:
cualquiera creado con `nuevo-agente.sh` nace en v11.

**Y a East le falta la guardia de las promesas** (`politica/plugins/promesas/`,
del 13/8/2026), que es lo único que impide que un agente diga "queda definido:
viernes a las 9:30" sin haber creado nada. Son tres cosas y van juntas:
`install.sh` deja el plugin, el compose lo monta
(`./politica/plugins:/opt/data/plugins:ro`) y el config lo prende
(`plugins.enabled: [promesas]`); después, `docker compose up -d hermes` —un
`restart` no alcanza, es un montaje nuevo—. `agente-check.py` falla si falta
cualquiera de las tres.

En Mr.Wobble las tres están, y la tercera **no la pone el despliegue**:
`desplegar-remoto.sh` no pisa un `config.yaml` que ya existe, así que
`plugins.enabled` —y con él `hooks`, `hooks_auto_accept` y `kanban.auto_decompose`—
hubo que escribirlos a mano en el config del agente. Es el paso que se olvida al
actualizar un cliente viejo, porque el despliegue termina sin decir nada.

**Bajas.** Un agente dado de baja sale de la tabla —la tabla dice qué corre
dónde— pero no del registro:

| Agente | Baja | Qué queda |
|---|---|---|
| La Mano (pdelabs, cliente 0) | 2026-08-12, decisión de Luis | respaldo en `~/Desktop/Luis/Projects/_respaldo-lamano/lamano-final-20260812.tgz`; contenedores eliminados y repo borrado |

La Mano fue el cliente 0 y el fixture de pruebas de todo el kit: casi toda la
evidencia de `notas/perillas-motor.md` y de `notas/perillas-aplicadas.md` está
medida sobre ella, y esas notas se quedan como están —son el registro de lo que
se midió, no el estado de la flota—. Lo que ya no hay es un agente local contra
el cual correr `agente-check.py`: el fixture ahora sale de desempaquetar ese
respaldo, o de un agente nuevo hecho con `nuevo-agente.sh`.

## Qué quiere decir cada columna

- **Host** — el alias ssh. Por costumbre se llama igual que el agente, y las
  herramientas asumen eso: el directorio en la VPS es `/opt/agentes/<slug>` y
  los contenedores son `<slug>-hermes`. Cuando no coinciden —entrar por
  `usuario@ip`, por ejemplo— el slug va como argumento aparte:
  `tools/<script>.sh <host> <slug>` (en `observabilidad.sh`, que ya usa el
  segundo para la acción, va tercero).
- **SOUL** — la versión del bloque genérico, la que estampa el marcador
  `<!-- kit:base vN -->`. `v1` es el marcador pelado, de antes del versionado;
  "sin marcador" es un SOUL pegado a mano o anterior a los marcadores. La
  versión que instala este repo está en `soul/VERSION`.
- **Motor** — el tag de `nousresearch/hermes-agent` que fija el compose de ese
  agente. Nunca `latest`: ver la nota en `CLAUDE.md`.
- **Último check** — cuándo corrió `tools/agente-check.py` contra su `data/` y
  con qué resultado.

Para llenar una fila:

```bash
grep -o '<!-- kit:base[^>]*-->' <ruta>/data/SOUL.md    # o por ssh
grep image: <ruta>/docker-compose.yml
python3 tools/agente-check.py <ruta>/data
```

## Estado al 2026-08-13

**Mr.Wobble** — reseteado a cero y actualizado al kit del día. Lo que se hizo,
en orden, y todo con herramientas del kit: `tools/resetear-agente.sh` en modo
COMPLETO (se va la huella del cliente **y** el SOUL), `desplegar-remoto.sh`
—que sube el kit, cambia el compose, mueve las claves a `secretos.env` e
instala el SOUL—, las cuatro perillas que faltaban a mano en el `config.yaml`,
y `docker compose up -d hermes portal-adapter`, que es lo que toma el montaje
nuevo de `politica/plugins`. Sale con 0 fallas de `portal-check.py`, en cero
verificado con `--entrega`, y 1 falla de `agente-check.py`: la identidad.

**Segunda vuelta el mismo día, ya con el adapter partido.** Mismo procedimiento
(reset COMPLETO → `desplegar-remoto.sh` → reponer `MODELO_DEL_AGENTE` →
`up -d` → `restart`), y salió `portal-check` 13 ok · 0 fallas y `--entrega`
14 ok · 0 fallas. Tres cosas que aparecieron y valen para el próximo:

- **`install.sh` subía el adapter como UN archivo.** El split lo dejó
  importando `flows`/`kanban`/`workspace` y la lista del instalador seguía
  teniendo una sola línea: el despliegue habría dejado un adapter que no
  arranca, con el kit diciendo "instalado". Arreglado — la lista se arma desde
  el directorio, como los hooks. Es el mismo modo de falla que el README ya
  describe, y van cinco.
- **`docker compose up -d` NO recarga el adapter.** Los archivos de
  `kit-adapter/` cambian adentro de un bind mount, así que el compose no ve
  nada que recrear y deja el proceso viejo corriendo con el código viejo en
  memoria. Dice `Running` y parece que actualizó. Hace falta un `restart`
  explícito del `portal-adapter` después de subir el kit.
- **`agente-check.py` sobre un `data/` rsyncado miente**, y feo: mira
  `politica/`, `kit-skills/` y `secretos.env`, que viven al lado de `data/` y
  no adentro. Sincronizando solo `data/` —que es lo que dice el paso 3 del
  despliegue— reporta 8 fallas inventadas (la puerta abierta, sin guardia, sin
  credenciales). Corrélo en el host, o sincronizá el árbol entero. Y necesita
  `tools/capacidad-catalogo.py` al lado o inventa una novena.

Dos cosas de este agente que valen para cualquier otro que corra en un host
compartido con más servicios nuestros:

- **`desplegar-remoto.sh` reescribe el `.env` del compose entero**, con las
  cinco variables que él conoce. Mr.Wobble tenía una sexta, `MODELO_DEL_AGENTE`,
  que lee el colector de `docker-compose.observabilidad.yml`: se perdió en las
  dos corridas y hubo que reponerla. Es silencioso —el colector cae a
  `desconocido` y las trazas salen igual, sin modelo—, así que **antes de
  desplegar hay que mirar qué más tiene ese `.env`**.
- **`migrar-secretos.sh` mueve `data/.env` a `secretos.env`, y el compose de
  observabilidad todavía nombraba el viejo.** Los servicios de al lado siguen
  andando porque nadie los recreó, pero el próximo `up -d` con los dos `-f`
  fallaba con "env file not found". Se arregla subiendo también
  `compose/docker-compose.observabilidad.yml`, que en el kit ya dice
  `./secretos.env`. Las dos cosas van juntas o el stack de al lado queda con una
  bomba de tiempo.

**East Comunicación** — primera alta con `desplegar-remoto.sh` (ver
`notas/modelos-auxiliares.md`). Del repo no se puede deducir en qué quedó: si se
desplegó antes del 11/8, salió sin SOUL, porque el despliegue remoto no lo
instalaba.

## Perillas del motor: Mr.Wobble sí, East no

La tanda C1 dejó en el kit las skills del motor apagadas, el preámbulo del
portal reemplazado y las skills del kit montadas `:ro`. **Eso viaja solo a los
agentes nuevos.** Mr.Wobble las tiene desde el 13/8 (las de skills ya venían del
12/8; el 13 se le sumaron la puerta, la guardia de las promesas y
`kanban.auto_decompose`, que el despliegue no pone porque no pisa un
`config.yaml` que ya existe). East es anterior y sigue con las 70 skills del
motor prendidas; `agente-check.py` lo reporta como falla hasta que se aplique.
El runbook (es un redeploy, y el `config.yaml` está `:ro`) está en
`notas/perillas-aplicadas.md`.

## Antes de actualizarle el bloque a alguien

Las acciones sensibles propias de cada empresa viven **adentro** del bloque, en
la sección de aprobaciones. Reemplazar el bloque por una versión nueva se las
lleva puestas, y el agente queda con la regla dura genérica y nada de lo suyo:
ese es el peor final posible, porque parece que está todo bien.

Así que el orden es: sacar del SOUL viejo lo agregado por cliente, instalar el
bloque nuevo, volver a ponerlo, y recién ahí `agente-check.py`. No hay nada que
lo chequee todavía — es a mano y hay que acordarse.

## Lo que falta confirmar (necesita ssh, no sale del repo)

- **Mr.Wobble: contestado el 13/8.** Está levantado y corre `v2026.7.30` de
  verdad, leído del `docker ps` del host y no del compose.
- Si East sigue levantado, y en qué tag de motor está de verdad (su fila dice lo
  que fija el compose del kit, no lo que corre el docker de esa VPS).
- Si East llegó a tener SOUL, y con qué marcador.
- Si hay algún agente más que no dejó rastro en este repo.
