# Cómo se habilitan de verdad las tools nativas de kanban

**Resuelto el 2026-08-04.** Reemplaza al plugin `kanban_tools`, que borramos.

## La receta

Las dos claves, en `data/config.yaml`. Con una sola, el agente no ve **ninguna**
tool de kanban y termina improvisando con Python sobre su propio tablero.

```yaml
toolsets:
  - kanban            # abre la compuerta (check_fn en tools/kanban_tools.py)

platform_toolsets:    # pasa el filtro por plataforma del gateway
  api_server:
    - hermes-api-server
    - kanban
  telegram:
    - hermes-telegram
    - kanban
  cron:
    - hermes-cron
    - kanban
```

El compuesto por defecto de cada plataforma (`hermes-api-server`, etc.) tiene que
ir sí o sí: si listás solo `kanban`, le sacás al agente todo el resto.

## Por qué no era adivinable

`toolsets: [kanban]` hace pasar el `check_fn` — eso se verifica a mano y da
`True`, que fue justo lo que nos hizo creer que estaba bien. Pero el gateway
arma la sesión con `_get_platform_tools(config, platform)`, y ahí `kanban`
**no es un toolset "configurable"**: no está en `CONFIGURABLE_TOOLSETS`, así que
no se puede pedir por el camino normal. Entra solo si aparece en
`platform_toolsets`, o si algún **plugin instalado** lo declara en su
`provides_tools` — que es lo que hacía nuestro plugin sin que lo supiéramos.

## La reproducción (por si se manda el issue upstream)

Un mismo agente, cambiando solo la config y reiniciando el gateway:

| Config | Tools en la sesión de `api_server` |
|---|---|
| `toolsets: [kanban]` solo | 25 — **ninguna de kanban** |
| `toolsets: [kanban]` + plugin que declara `provides_tools: [kanban]` | 40 — las 12 nativas |
| `toolsets: [kanban]` + `platform_toolsets` con kanban | 37 — las 12 nativas |
| `platform_toolsets` con kanban, **sin** `toolsets` | **ninguna de kanban** |

```python
from hermes_cli.config import load_config
from hermes_cli.tools_config import _get_platform_tools
from model_tools import get_tool_definitions
cfg = load_config()
ts = sorted(_get_platform_tools(cfg, "api_server"))
n = [d["function"]["name"] for d in get_tool_definitions(enabled_toolsets=ts, quiet_mode=True)]
print([x for x in n if "kanban" in x])
```

Lo que vale reportar no es código: es que un toolset gateado por `check_fn` y no
declarado como configurable queda inalcanzable por configuración, sin ningún
mensaje que lo diga.

## La lección que costó un plugin entero

Le creí al agente cuando dijo *"no tengo disponible `kanban_show`"* y construí un
plugin sobre esa respuesta. Dos cosas mal:

1. **El auto-reporte de un modelo no es evidencia de qué tools tiene.** El
   registro sí. Son tres líneas de Python y las tuve a mano todo el tiempo.
2. **La pregunta estaba mal formulada**: nuestro plugin exponía una sola tool
   llamada `kanban`, así que "no tengo `kanban_show`" era literalmente cierto y
   no probaba nada sobre el toolset nativo.
