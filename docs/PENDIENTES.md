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
  **El bautizo ya está resuelto de punta a punta (7/8)** y sirve de molde para
  lo que falta: el cliente le pone nombre y pinta en el onboarding, el portal
  hace `POST /portal/identity`, el adapter (0.26) lo guarda en el volumen, lo
  reporta en el manifiesto, **lo escribe en el SOUL dentro de un bloque acotado
  entre marcadores** (sin tocar la prosa del alta) y le pega un `setMyName` al
  bot de Telegram. Ese bloque delimitado y reescribible es exactamente la forma
  que buscábamos para la pestaña de "Instrucciones": copiarla.
  Lo que sigue faltando de este tema:
  - La **foto del bot** en los canales: no hay método en la Bot API, va a mano
    por `@BotFather` (`/setuserpic`). El SVG de `lib/agentito.tsx` sirve para
    generar el PNG, pero falta el paso que lo exporta.
  - El cliente **no puede cambiar el look después** del onboarding: no hay
    dónde. Cuando exista la pestaña de personalización, va ahí.

## Técnicos, priorizados

1. ~~El gate del toolset `kanban`~~ **RESUELTO el 4/8**: hacen falta `toolsets:
   [kanban]` **y** `platform_toolsets` con kanban por plataforma. El plugin se
   borró del kit. Receta y reproducción en `hermes-kit/notas/kanban-nativo.md`.
   Queda **mandar el issue upstream** con esa reproducción (un toolset gateado
   por `check_fn` y no declarado configurable queda inalcanzable por config, sin
   ningún mensaje que lo diga).
2. ~~Migrar La Mano a la receta nueva~~ **HECHO el 5/8 (madrugada)**: sacado el
   plugin, agregado `platform_toolsets`, gateway reiniciado sin trabajo en
   vuelo. Verificado: 12 herramientas nativas en api_server/telegram/cron, y el
   agente cerró un ticket de prueba usándolas.
3. ~~Probar el alta completa con un agente descartable~~ **HECHO el 4/8**: se creó
   "Acme" desde cero, pasó `portal-check` con 11 ok / 0 fallas, y el agente creó
   y mostró un ticket con las tools nativas. Lo que salió de ahí: el chequeo
   offline `agente-check.py`, la receta de kanban y el frontmatter faltante.
4. ~~Bajar el contexto fijo~~ **HECHO en parte el 5/8**: `nuevo-agente.sh` ya
   crea los agentes con `agent.disabled_toolsets: [tts, delegation]` — los
   esquemas bajan de 67,6 a 60,0 KB. Queda evaluar `session_search` (6,3 KB) y
   `browser` (6,2 KB), que son los próximos candidatos pero sí se usan.
   **Dato que cambia la intuición:** los esquemas de herramientas pesan casi el
   doble que el system prompt entero, así que podar prosa del SOUL es el lugar
   equivocado para ahorrar.
5. **Graduar los fetchers locales del portal a `lib/agent.ts`** (pipeline,
   aprobaciones, artefactos, tareas tienen su propia copia, marcada con TODO).
6. **Vigilar** que el error de `kanban.db-shm` no vuelva (arreglado con
   `PRAGMA query_only`, pero conviene mirarlo un par de días).
7. **43 dossiers en `workspace/leads/`** cuyos tickets borró la purga del 3/8.
   Son investigación real de 43 empresas: **recomiendo conservarlos**, son la
   materia prima de la lista de prospección. Cerrar salvo que se decida otra cosa.

## Abierto tras la noche del 4→5/8

- **Crear la app OAuth de tuagente para Google.** Es el paso que destraba
  Planillas/Drive/Agenda para todos los clientes, y también la tarea de mails
  que está frenada. Runbook completo en `hermes-kit/connections/google-workspace.md`.
- **Conexiones: falta el camino de escritura.** Hoy el portal muestra el estado
  y deja *pedir* la conexión (crea un ticket); conectar lo seguimos haciendo
  nosotros a mano. Es deliberado: pedirle a un cliente no técnico que pegue
  credenciales en una pantalla es enseñarle a repartir secretos. Revisar cuando
  una conexión se haya repetido diez veces.
- **El agente sigue yendo al terminal antes que a sus herramientas.** Probó
  `sqlite3` y `bs4` por Python en tareas donde tenía la herramienta nativa a
  mano. No rompió nada (falla en centésimas y se recupera), pero cuesta turnos.
  Su memoria ya le dice que no lo haga, así que **una regla más de prompt no es
  la solución**; anotado como comportamiento a medir, no a parchear.
- **Del relevamiento uruguayo** (`docs/conexiones-uruguay.md`), lo que hay que
  averiguar antes de prometer: si Uruware da API a un integrador, qué ambiente
  de prueba tiene Plexo, si Tiendanube exige publicar app, y cuánto tarda de
  verdad la verificación de WhatsApp en Uruguay.

## Fuera de alcance por decisión

- **Railway / sacar el agente de la Mac**: pospuesto a propósito hasta terminar
  de iterar la interfaz.
- **Orquestación de workers** (asignar, reclamar, despachar, swarm): las tools
  nativas de Hermes no la exponen fuera de un worker del dispatcher, y no la
  necesitamos.

## Fusión Artefactos → "Entregas" (decidido 7/8, pendiente)

Una sola pestaña principal con TODO lo que el agente produce — entregables
(md/xlsx/archivos) + artefactos (HTML) — agrupado por flujo. Hoy Artefactos
(solo HTML) quedó promovida a principal como interim; la skill `artifact`
tiene que ganar `--flujo` como ya lo tiene `entregable`. Al fusionar, Archivos
queda en "Más" como vista cruda del workspace.

## Conexiones — abierto tras el 9/8

- **Mercado Pago: escrito y auditado, SIN PROBAR contra una cuenta real.**
  Ningún endpoint tocó Mercado Pago todavía. Hay que correrlo con credenciales
  de **sandbox** (no producción) y verificar de punta a punta: los cuatro de
  lectura, el link de cobro, la devolución (con su idempotencia y su chequeo
  previo) y un webhook **firmado de verdad**. Hasta que eso pase, no se le
  promete a ningún cliente. El código está en
  `hermes-kit/connections/mercadopago/`, con tres bugs ya corregidos que
  salieron de leer la integración de demoda — los dos MCP no oficiales más
  populares todavía los tienen.

- **La guardia no está registrada en Hermes.** Está construida y probada (con
  un MCP falso y con Mercado Pago), pero falta el `hermes mcp add` que la
  ponga en el camino del agente. Hasta entonces el agente NO ve ninguna de las
  herramientas nuevas: ni las 12 de WhatsApp ni las 6 de Mercado Pago.

- **WhatsApp: pareado pendiente.** El puente corre y el QR sale por el portal,
  pero nadie lo escaneó. Cuando se haga, tiene que ser con un **número
  descartable**: la vía por QR usa whatsmeow y Meta puede bloquear el número.

- **El correo sigue sin conectar**, y es la única conexión que un flujo pide
  hoy (prospección está en ámbar esperándola).

- **Instagram: curado, SIN CONECTAR y SIN AUDITAR EL CÓDIGO.** 23 herramientas
  del MCP oficial (`mcpware/instagram-mcp`, Graph API) clasificadas 15 leen /
  8 actúan.
  - **La clasificación salió de leer el README del repo, no el código.** Con
    Mercado Pago aprendimos que eso no alcanza: los tres bugs (el
    `X-Idempotency-Key` faltante entre ellos) aparecieron recién al leer la
    implementación. **Falta bajar mcpware y hacerle el mismo pase**: verificar
    que cada función haga lo que dice el nombre y que la clase lee/actúa
    coincida con lo que realmente toca.
  - Falta conectar una cuenta real y correr las de lectura de punta a punta.
  - Pasos previos del lado del cliente: cuenta **profesional Business** y
    **pública**, y una **página de Facebook** vinculada (el MCP elegido usa
    Facebook Login; el camino liviano *Instagram API with Instagram Login* no
    pide página pero deja afuera los DM).
  - **Leer es el motivo de la conexión**, no publicar: sin `get_media_posts` el
    flujo semanal escribe a ciegas, repite temas y se pisa con lo que ya salió.
  - **Para la cuenta propia NO hay app review** — Standard Access está
    auto-aprobado y cubre leer *y* publicar. (Una nota anterior decía 2-4
    semanas; estaba mal.) Las 2-4 semanas son Advanced Access, para operar
    cuentas **ajenas**: eso es el día que se venda como producto, y ahí conviene
    arrancar el trámite temprano porque es espera y no trabajo.
  - **Los DM no van a andar**: `instagram_manage_messages` pide Advanced Access
    aun en cuenta propia. Las 3 tools están declaradas pero muertas.
  - **El token dura 60 días y se cae en silencio.** Falta refrescarlo antes de
    que venza; sin eso la conexión se muere sola cada dos meses.
  - Se descartaron los MCP basados en `instagrapi`: detección en horas y
    escalada a **baja permanente**. Con WhatsApp el riesgo se acepta porque el
    número es descartable; una cuenta de marca no lo es.

  El razonamiento largo está en `hermes-kit/connections/instagram/README.md`.
