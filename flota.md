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
| pdelabs (cliente 0, fixture) | local — `~/Desktop/Luis/Projects/agente-pdelabs` | sin marcador (pre-v1) | `v2026.7.30` | 2026-08-12 — 5 fallas |
| Mr.Wobble | `tuagente` → `/opt/agentes/tuagente` | v1 (marcador sin versión, 11/8/2026) | `v2026.7.30` (por el compose remoto) | TODO — nunca se corrió |
| East Comunicación | `east` → `/opt/agentes/east` | TODO | TODO | TODO |

## Qué quiere decir cada columna

- **Host** — el alias ssh, que es también el nombre del directorio en la VPS
  (`/opt/agentes/<alias>`). `instalar-soul.sh` y `observabilidad.sh` usan el
  mismo nombre para las dos cosas.
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

**pdelabs** — el fixture local. Cinco fallas, todas conocidas: dos del SOUL (lo
compuso `nuevo-agente.sh` antes de que existieran los marcadores, y arrastra los
huecos `<ASÍ>` de `00-identidad.md` — entre ellos el de la REGLA DURA, que quedó
literalmente como "JAMÁS `<la acción sensible: …>`") y tres de las perillas de
C1, que ningún agente tiene aplicadas todavía. Sirve igual como fixture; para
producción no saldría.

**Mr.Wobble** — se le instaló el bloque base el 11/8/2026 (commit `4fd95ef`),
cuando el marcador todavía no llevaba versión: cuenta como v1 y le falta el
bloque de precedencia y la regla dura ya genérica. **Le falta la identidad**
(`00-identidad.md`), que es la parte artesanal y necesita datos del cliente. Está
en la lista de Luis, y requiere ssh.

**East Comunicación** — primera alta con `desplegar-remoto.sh` (ver
`notas/modelos-auxiliares.md`). Del repo no se puede deducir en qué quedó: si se
desplegó antes del 11/8, salió sin SOUL, porque el despliegue remoto no lo
instalaba.

## Perillas del motor: nadie las tiene aplicadas todavía

La tanda C1 dejó en el kit las skills del motor apagadas, el preámbulo del
portal reemplazado y las skills del kit montadas `:ro`. **Eso viaja solo a los
agentes nuevos**: los tres de la tabla son anteriores y siguen con las 70 skills
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
