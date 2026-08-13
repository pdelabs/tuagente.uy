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
| Mr.Wobble | `tuagente` → `/opt/agentes/tuagente` | **v4** (verificado byte a byte contra `soul/versiones/v4.md` el 12/8; el kit ya va por **v10**) | `v2026.7.30` (por el compose remoto) | TODO — nunca se corrió |
| East Comunicación | `east` → `/opt/agentes/east` | TODO | TODO | TODO |

**Quedan atrás con v10** (bloque del 12/8/2026: rechazo que no desbloquea,
qué hacer con un desbloqueo sin aprobación, y vocabulario). Los dos de la
tabla: Mr.Wobble está en v4 —seis versiones atrás— y de East no sabemos ni la
versión, que es peor. Ninguno de los dos entiende todavía qué es un rechazo,
así que en los dos **rechazar desde el portal deja el ticket bloqueado y el
agente no sabe qué hacer con eso**: va a leer el comentario y contestar, pero
sin la regla puede volver a proponer lo mismo o intentar desbloquearse.
Migrarlos es una corrida de `tools/reemplazar-bloque.py` con
`soul/versiones/v10.md` por agente, mirando antes el diff de lo que esté
escrito a mano. El lab (`agente-lab`) ya está en v10. Sin agentes locales de
cliente hoy: cualquiera creado con `nuevo-agente.sh` nace en v10.

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

## Estado al 2026-08-12

**Mr.Wobble** — desplegado y en uso. Leyendo su SOUL real el 12/8: tiene el
bloque **v2** (15.648 bytes) y el `portal:identidad` del bautizo, con el nombre
que le puso su cliente. Le falta subir a **v3** —el bloque nuevo trae la línea
que evita el `kanban_show` sin id que hoy se come el primer turno de cada
conversación— con `tools/instalar-soul.sh --reemplazar tuagente`, y le falta la
identidad artesanal (`00-identidad.md`), que necesita datos del cliente.

De su despliegue salieron además tres arreglos que ya están en el kit: el
verificador de mutaciones apagado, el browser apagado, y el `chown` de `data/`
en `desplegar-remoto.sh` — sin ese último el agente arrancó **sin una sola
skill** (140 "Permission denied" al sembrar, índice vacío, ningún error visible).

**East Comunicación** — primera alta con `desplegar-remoto.sh` (ver
`notas/modelos-auxiliares.md`). Del repo no se puede deducir en qué quedó: si se
desplegó antes del 11/8, salió sin SOUL, porque el despliegue remoto no lo
instalaba.

## Perillas del motor: nadie las tiene aplicadas todavía

La tanda C1 dejó en el kit las skills del motor apagadas, el preámbulo del
portal reemplazado y las skills del kit montadas `:ro`. **Eso viaja solo a los
agentes nuevos**: los dos de la tabla son anteriores y siguen con las 70 skills
del motor prendidas. `agente-check.py` lo reporta como falla en cada uno hasta
que se aplique. El runbook (es un redeploy, y el `config.yaml` está `:ro`) está
en `notas/perillas-aplicadas.md`.

## Antes de actualizarle el bloque a alguien

Las acciones sensibles propias de cada empresa viven **adentro** del bloque, en
la sección de aprobaciones. Reemplazar el bloque por una versión nueva se las
lleva puestas, y el agente queda con la regla dura genérica y nada de lo suyo:
ese es el peor final posible, porque parece que está todo bien.

Así que el orden es: sacar del SOUL viejo lo agregado por cliente, instalar el
bloque nuevo, volver a ponerlo, y recién ahí `agente-check.py`. No hay nada que
lo chequee todavía — es a mano y hay que acordarse.

## Lo que falta confirmar (necesita ssh, no sale del repo)

- Si Mr.Wobble y East siguen levantados, y en qué tag de motor están de verdad
  (la tabla dice lo que fija el compose del kit, no lo que corre el docker de
  cada VPS).
- Si East llegó a tener SOUL, y con qué marcador.
- Si hay algún agente más que no dejó rastro en este repo.
