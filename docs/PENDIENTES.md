# Pendientes (2026-08-04)

Lo que quedó abierto, con quién lo destraba. Cerrar acá cuando se resuelva.

## Esperan a Luis (nadie más puede)

- **Credenciales de Google** para la tarea de mails CFEHYL. Hace falta bajar
  `google_credentials.json` de Google Cloud Console y correr una vez el
  `scripts/setup.py` de la skill `google-workspace` (abre OAuth en el navegador).
  La tarea está **pausada** hasta entonces; sin esto corre y falla cada 10 min.
- **Recordatorio "revisar leads e informe Uruguay"**: pausado. Si lo querés,
  hay que reactivarlo **cambiando la entrega a `telegram`** — con `origin`
  apunta a una sesión del portal, que no puede recibir mensajes.
- **Variables en Vercel** de pdelabs-landing: `EMAIL_USER` / `EMAIL_APP_PASSWORD`
  (el formulario de contacto quedó arreglado en código desde el 3/8).
- **Veredicto Luna vs Sonnet.** Evidencia hasta hoy: Luna completa todo, ~1
  bloqueo de guard por tanda y algunos tics; cero fallas de seguridad u
  honestidad.

## Decisiones de producto abiertas

- **Precio y estructura de la oferta**: la propuesta sobre la mesa es diagnóstico
  pago chico (USD 200-250) que se descuenta del setup, en vez de USD 1000 de
  entrada.
- **Catálogo de skills e integraciones MCP**: postura propuesta — el cliente
  pide, nosotros instalamos y auditamos; catálogo curado en vez de registries
  abiertos. Sin decidir.
- **Multi-tablero en el portal** (el eje "proyecto"): el adapter ya lee cualquier
  tablero; falta el selector y que las escrituras respeten el elegido.
- **El cliente no tiene cómo personalizar su agente desde el portal.** Hoy toda
  personalización (reglas de negocio, tono, qué requiere aprobación) se hace
  editando el `SOUL.md` a mano en el repo del agente — o sea, la hacemos
  nosotros. Regla de Luis (4/8): lo específico de un cliente se pide **como
  cliente, por el portal**; si el portal no alcanza, eso es hueco de producto.
  Falta decidir la forma: probablemente una pestaña de "Instrucciones" que
  escriba un bloque acotado del SOUL, versionado y reversible, sin dejar que el
  cliente pise las reglas duras (la puerta de aprobación no es negociable).

## Técnicos, priorizados

1. ~~El gate del toolset `kanban`~~ **RESUELTO el 4/8**: hacen falta `toolsets:
   [kanban]` **y** `platform_toolsets` con kanban por plataforma. El plugin se
   borró del kit. Receta y reproducción en `hermes-kit/notas/kanban-nativo.md`.
   Queda **mandar el issue upstream** con esa reproducción (un toolset gateado
   por `check_fn` y no declarado configurable queda inalcanzable por config, sin
   ningún mensaje que lo diga).
2. **Migrar La Mano a la receta nueva.** Hoy sigue con el plugin `kanban_tools`,
   que funciona pero ya no existe en el kit. El cambio es en `data/config.yaml`:
   sacar `plugins.enabled: [kanban_tools]`, agregar el bloque
   `platform_toolsets` (dejar `toolsets: [kanban]`, que sigue haciendo falta) y
   reiniciar el gateway **sin trabajo en vuelo**. Verificar después con
   `hermes-kit/tools/agente-check.py`.
3. ~~Probar el alta completa con un agente descartable~~ **HECHO el 4/8**: se creó
   "Acme" desde cero, pasó `portal-check` con 11 ok / 0 fallas, y el agente creó
   y mostró un ticket con las tools nativas. Lo que salió de ahí: el chequeo
   offline `agente-check.py`, la receta de kanban y el frontmatter faltante.
4. **Bajar el contexto fijo**: `hermes tools disable` sobre toolsets que un
   agente de cliente no usa (tts, vision, delegation, browser…), midiendo con
   `hermes prompt-size` antes y después. También sacar del SOUL las muletas que
   ya no hacen falta.
5. **Graduar los fetchers locales del portal a `lib/agent.ts`** (pipeline,
   aprobaciones, artefactos, tareas tienen su propia copia, marcada con TODO).
6. **Vigilar** que el error de `kanban.db-shm` no vuelva (arreglado con
   `PRAGMA query_only`, pero conviene mirarlo un par de días).
7. **43 dossiers en `workspace/leads/`** cuyos tickets borró la purga del 3/8.
   Son investigación real de 43 empresas: **recomiendo conservarlos**, son la
   materia prima de la lista de prospección. Cerrar salvo que se decida otra cosa.

## Fuera de alcance por decisión

- **Railway / sacar el agente de la Mac**: pospuesto a propósito hasta terminar
  de iterar la interfaz.
- **Orquestación de workers** (asignar, reclamar, despachar, swarm): las tools
  nativas de Hermes no la exponen fuera de un worker del dispatcher, y no la
  necesitamos.
