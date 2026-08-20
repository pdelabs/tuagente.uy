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
  ponga en el camino del agente. Confirmado el 9/8 con `hermes mcp list`:
  *No MCP servers configured*. Hasta entonces el agente NO ve ninguna de las
  **41** herramientas curadas (12 WhatsApp + 6 Mercado Pago + 23 Instagram).
  - **Dónde vive `guardia.py` importa**: tiene que ir en `/opt/politica/`
    (montado `:ro`), no en `/opt/data/`. Si el agente puede editar la guardia,
    no hay guardia.

- **Queda un tercer camino para saltear la política, sin cerrar.** El adapter
  **ejecuta** `/opt/data/scripts/portal_adapter.py` —que está en el volumen del
  agente— y el adapter tiene `./politica` en modo escritura. Si el agente pisa
  ese archivo y el adapter reinicia, corre código del agente con permiso para
  reescribir la política.
  - En la Mac el agente lo pisa, **pero es un artefacto de Docker Desktop**: los
    bind mounts ignoran la propiedad (el archivo se creó como `hermes` dentro de
    un directorio `root` sin permiso de escritura). En Linux debería negarse.
  - **Hay que confirmarlo en la VPS, no asumirlo.** Si en Linux tampoco alcanza,
    el arreglo es montar el script desde un directorio aparte en `:ro`, igual
    que la política.

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

## Rechazar una aprobación — CERRADO el 12/8, y por qué importa el detalle

**Estado: hecho de los dos lados.** Queda anotado acá porque el camino corto
—el que parece obvio— mata pedidos, y alguien lo va a volver a proponer.

El contrato: **rechazar es UN comentario firmado `cliente` y el estado del
ticket NO se toca.** El ticket sigue `blocked`, sigue en la pestaña, y el
desbloqueo se gasta una sola vez en toda la negociación: al aprobar.

**Por qué no se desbloquea, que es lo contrario de lo que parece obvio.** Un
ticket tiene un solo `unblock` útil: `block_recurrences` sube cada vez que se
re-bloquea por la misma causa después de un desbloqueo, y a las dos
(`BLOCK_RECURRENCE_LIMIT`, hardcodeado en `kanban_db.py`) el ticket se va a
`triage`, donde Aprobar contesta 409 y ningún verbo del CLI lo trae de vuelta.
Rechazar destrabando gastaba ese único desbloqueo en el primer "no": el agente
re-proponía, volvía a bloquear, saltaba el límite y el pedido moría. Con el
auto-decomposer prendido era peor: partía el ticket usando el **cuerpo viejo** y
le dejaba a la clienta en la cola una tarea que decía "usá el pedido preparado
de 8 bisagras" cuando ella ya había corregido a 20. Está en el lab, en
`t_b1fb02ad`: `blocked → unblocked → blocked → unblocked → block_loop_detected →
decomposed`.

- **Kit** (`portal_adapter.py`, `_rechazar`): `POST /portal/approvals/{id}/reject`
  hace una sola escritura —el comentario `cliente` que arranca con "RECHAZADO
  POR TU CLIENTE"—, avisa al agente con `notify_agent_of_comment` y devuelve
  `{ok, estado, desbloqueado:false, en_aprobaciones, avisado, block_recurrences}`.
- **Portal** (`app/app/aprobaciones/page.tsx`, `doReject`): una sola llamada a
  ese endpoint y nada más. Antes eran tres, no atómicas: si la última fallaba,
  el comentario ya estaba puesto y la pantalla decía "no se pudo" —y reintentar
  comentaba dos veces—. La tarjeta **no desaparece**: se queda con el aviso "Le
  dijiste que no" adentro, y ahí mismo aparece la respuesta del agente.

Verificado en el navegador contra el agente del lab (12/8): status sigue
`blocked`, un solo comentario nuevo por rechazo, ningún evento `unblocked` ni
`decomposed`, y el agente contestó en el mismo ticket.

**Lo que NO hay que volver a hacer:** ni `setTicketStatus(ready)` ni
`hermes kanban unblock` en el camino del rechazo, ni acá ni en el kit. Y el
texto que el adapter escribe es para la máquina: el portal lo muestra filtrado
(`leerComentario` en `lib/agent.ts`) porque va firmado `cliente` y sin eso la
clienta lee "RECHAZADO POR TU CLIENTE. No hagas lo que pediste aprobar…" arriba
de un "Vos" — un prompt que nunca escribió.

## Habilidades propias que el adapter no puede editar

**Quién lo destraba:** quien toque `portal_adapter.py`.

`GET /portal/capabilities` lista como `origen: "propia"` las habilidades que
viven adentro de una carpeta de categoría (`skills/contenido/contenido-para-redes/`)
pero **no les pone `editable`**, y `GET /portal/skills/{name}` sólo resuelve las
de primer nivel: contesta 404 «esa habilidad no existe o no es editable».

El portal ya no promete de más (el botón Editar aparece sólo con
`editable === true`, y siguen agrupadas como suyas, que es lo cierto). Pero el
cliente tiene habilidades hechas para él que no puede tocar y nada le explica
por qué. El arreglo de fondo es del adapter: que `_skill_editable` también
resuelva un nivel de categoría, o que la lista mande `editable: false` explícito
para que al menos sea una decisión y no un descuido.


## Privilegio: los caminos del agente hacia algo que corre con más permiso (12/8)

Dos estaban abiertos y **los dos quedaron cerrados**; queda uno de defensa en
profundidad. Se anota entero porque el razonamiento equivocado nos duró un día:
creíamos que sacar el código del adapter de `data/` cerraba "los dos saltos", y
no: seguían siendo dos saltos con otra llave.

**CERRADO — el código del adapter.** Vivía en `data/scripts/`, que es del
agente, y el contenedor lo ejecutaba como root con `politica/` montada rw. Ahora
vive en `kit-adapter/`, montada `:ro`, y el adapter corre como uid 10000.

**CERRADO — `data/.env` como `env_file` de los dos servicios.** Esto no era
"puede redirigir directorios": era **ejecución de código arbitrario adentro del
adapter**. La cadena, medida con la imagen real, el adapter como uid 10000 y su
código montado `:ro`:

```
el agente es dueño de data/ (y adentro de su contenedor corre como root)
  → escribe data/.env con PYTHONPATH=/opt/data/evil
  → docker inyecta esa variable al arrancar el adapter
  → /opt/data/evil/json.py tapa un módulo del stdlib
  → "CODIGO DEL AGENTE EJECUTADO ADENTRO DEL ADAPTER"
  → ese proceso tiene politica/ en RW:
      · reescribe hooks/puerta.py            (la puerta, para que deje pasar todo)
      · reescribe cont-init-parches.sh       (que hermes monta como
        /etc/cont-init.d/03-parches y s6 corre COMO ROOT en cada arranque)
```

Cerrado sacando los secretos a `<agente>/secretos.env`, root:root 600, en la
raíz del agente, que no monta ningún contenedor. El PoC repetido después del
cambio ya no ejecuta nada. Y si alguien recrea `data/.env` a mano, el compose no
lo nombra: queda inerte (verificado con `docker compose config`).

**CERRADO — `data/config.yaml`, el segundo consumidor.** Estaba `:ro` para
hermes pero **rw para el adapter**, que lo tenía por el montaje de `./data`. El
adapter solo lo LEE (modelo por defecto, skills apagadas, preámbulo), así que
ahora lo monta `:ro` también.

**ABIERTO (defensa en profundidad) — el adapter puede reescribir los guardrails
que tiene al lado.** Escribe `politica/politica.json` y
`politica/capacidades/pedidos.jsonl`, y para reemplazar el primero de forma
atómica (tmp + rename) necesita permiso de escritura **sobre el directorio**
`politica/` — el mismo donde están `guardia.py`, `hooks/`, `tools/`, `mcp/` y
`capacidades/catalogo.json`. Quien puede escribir el directorio puede borrar
cualquier cosa adentro; probado. **El bit sticky no alcanza**: protege de borrar
archivos ajenos salvo al dueño del directorio, y el dueño es justamente él. Hoy
ya no hay camino desde el agente hasta ese proceso (su código es `:ro` y las
variables no salen de `data/`), así que es defensa en profundidad y no un agujero
abierto. Se cierra sacando los dos archivos que el adapter escribe a una carpeta
propia —`estado/`, montada rw solo para él— y dejando `politica/` `:ro` también
para el adapter. Toca: `PORTAL_POLITICA_DIR` en el adapter, la ruta que lee
`mcp-guardia/guardia.py`, los dos composes, `install.sh` y una migración.


## Aprobaciones y comentarios — lo que quedó abierto tras la tanda del 12/8

**Quién lo destraba:** el portal, salvo donde diga otra cosa.

Lo que se cerró en esa tanda está en el código y en `docs/rutas-portal.md`: el
filtro de comentarios ya mira **quién firma** antes de aplicar los formatos de
máquina (`leerComentario` en `lib/agent.ts`), un rechazo sin bloque de motivo
muestra el crudo en vez de vaciarse, el motivo ya no se corta en la primera
comilla, la casilla de **cerrar el pedido** manda `{"definitivo": true}`, y el
estado de la negociación se lee del hilo. Lo que sigue abierto:

- **El recuadro de la propuesta puede seguir siendo la versión vieja.**
  `elegirPropuesta` toma la última propuesta que trae **cuadro markdown**, y al
  agente no se le puede exigir que lo use: si contesta en prosa, arriba queda lo
  que la clienta ya rechazó. Se tapó el agujero grande —la pantalla ya **no
  afirma** que eso es lo vigente: cuando la propuesta es anterior al último "no"
  aparece "Le dijiste que no a esto"— pero elegir bien la versión nueva sigue
  sin resolverse. El arreglo de fondo es del kit: que la skill `aprobacion`
  vuelva a proponer siempre con el mismo formato, o que el adapter marque cuál
  es la propuesta vigente en vez de dejar que el portal la adivine por la forma
  del texto.
- **El "le dijiste que no" derivado sólo aparece con la tarjeta desplegada**,
  porque el detalle del ticket se trae al desplegar (una llamada por pedido).
  Alcanza para el caso que importa —los botones también están adentro— pero la
  lista plegada no distingue un pedido que está en plena negociación de uno
  virgen. Si algún día se quiere ese chip, sale de que `/portal/approvals` diga
  si el último comentario es un rechazo del cliente, no de N llamadas al detalle.
- **`separarPropuesta` se lleva el epílogo del agente al editor.** Corta después
  de la última fila de tabla, así que si el agente escribe algo después del
  texto mandable ("avisame si querés que lo mande hoy"), eso entra en "Corregir
  y aprobar" como si fuera parte del mail. Es la misma clase de acoplamiento
  que el resto: el portal parseando la forma libre del agente.
- **`loadAgentName()` vacío = dos nombres en la misma pantalla.** El sidebar
  dice "Tero" (sale del manifiesto) y las frases nuevas dicen "Tu agente" (sale
  del localStorage, que está vacío si el cliente no bautizó desde ESTE browser).
  Mientras siga así conviene escribir las frases nuevas sin interpolar el nombre
  —la casilla de cerrar el pedido quedó así a propósito— porque interpolado
  aparece con mayúscula en medio de una oración ("y Tu agente no lo vuelve a
  traer"). El arreglo real es que el nombre salga del manifiesto en todos lados.
- **`block_loop_detected` no dice qué hacer.** `palabras.ts` lo traduce, pero a
  diferencia de `triage` no trae la línea de "y ahora qué": es justo el evento
  que aparece cuando el pedido se murió, y ahí el cliente necesita saber que
  tiene que pedirlo de nuevo.

### G-4 (el cartel de "no existe" en Conexiones) — NO SE REPRODUCE, medido

Quedaba anotado que `?conexion=<algo>` mostraba "No tengo ninguna conexión que
se llame «correo»" en el primer frame contra un agente lento. **No pasa.**
Medido en el navegador el 12/8 retrasando a mano la respuesta de
`/portal/connections` 5 segundos: al segundo y medio la pantalla muestra el
spinner, el cartel no aparece, y cuando llega la respuesta sale el aviso
correcto ("Venís a conectar…"). La guarda existe y es el `return` temprano
`if (conexiones === null) return <Spinner/>`, que hace lo mismo que el
`X !== null` explícito de Archivos, Tareas y Entregas. No hay nada que arreglar;
queda escrito para que nadie lo vuelva a cazar.

## Instaladores del kit — dos huecos que la auditoría dejó abiertos (12/8)

(Esta sección ya se había escrito una vez y se perdió en una escritura
concurrente del archivo; va de nuevo.)

Contexto: `desplegar-remoto.sh` dejó de tener su propia lista de archivos y le
corre `install.sh` a un staging, con un manifiesto (`.kit-instalado`, ruta +
sha256) que es lo único que habilita a borrar algo. Dos cosas quedaron abiertas
a propósito:

- **El aviso de "lo dejo" es de una sola vez.** Cuando el kit deja de traer un
  archivo y el cliente lo tenía editado, no se borra y se avisa — bien. Pero el
  manifiesto nuevo ya no lo nombra, así que desde la corrida siguiente ese
  huérfano no vuelve a aparecer nunca: ni en `install.sh`, ni en `--diff`, ni en
  el despliegue. Una skill que sacamos del kit y el cliente había tocado puede
  quedar indexada para siempre sin rastro (y una skill en `data/skills/` tapa a
  la de `kit-skills/`, que es un bug que ya nos costó una tanda). Falta llevar
  los huérfanos a una lista aparte —`.kit-huerfanos`, o que los mire
  `agente-check.py`— para que el aviso se repita hasta que alguien decida.

- **Los dos composes no los compara nadie.**
  `tools/comparar-instaladores.sh` prueba que un agente local y uno remoto
  reciben los mismos archivos, pero `docker-compose.example.yml` y
  `docker-compose.remoto.yml` siguen siendo dos plantillas a mano. La auditoría
  le borró `HERMES_DASHBOARD=0` al remoto —el bug del crash-loop 27×/min— y el
  chequeo quedó verde. Falta comparar las claves que tienen que ser iguales en
  los dos (`HERMES_DASHBOARD`, `HERMES_ACCEPT_HOOKS`, el `user:` del adapter,
  los montajes de `politica/`, `kit-skills/`, `kit-adapter/` y el `env_file`, el
  tag del motor) y listar las que difieren a propósito.

Detalle de la misma familia: los chequeos recorren el árbol con `find -type f`,
que **no ve los symlinks**, así que un symlink que el agente deje en una ruta del
kit no aparece en ninguna comparación.

## Auditoría del 12/8 — tres cosas que encontró y quedaron arregladas, y una que falta

Se anotan porque ninguna estaba escrita y las tres son de la misma familia: un
dato que escribe el agente termina consumido por algo que corre con más permiso.

- **P1 — inyección de comandos como root en la VPS (CERRADO).**
  `tools/observabilidad.sh` leía el `default:` de `data/config.yaml` —que escribe
  el agente— y lo interpolaba **sin comillas** en la cadena que va a `ssh`. Con
  un `default: modelo'; touch /tmp/RAIZ-EN-LA-VPS; echo 'x` el comando inyectado
  se ejecutó. Cadena: el agente escribe su config → el operador corre una
  herramienta documentada del kit → comando arbitrario en el shell root del
  servidor. **Es el primer camino que salió del contenedor y llegó al host.**
  Cerrado con validación de forma (`^[A-Za-z0-9][A-Za-z0-9._:/-]{0,80}$`) más
  paso del valor por `printf %q` a un script que entra por stdin, sin `sed`.
  Barrido hecho: es la única interpolación de ese tipo en el kit (lo demás que
  se lee de un agente se usa en `echo` local).

- **P2 — el desplegador reabría `data/config.yaml` en cada corrida (CERRADO).**
  Un `sed` comentaba las dos líneas `:ro` "para el primer arranque", así que el
  agente podía escribir su propio config hasta que alguien corriera
  `cerrar-config.sh` a mano. El compose dice qué habilita eso ("podía devolverse
  cronjob y registrar un MCP salteando la guardia; solo tenía que esperar un
  reinicio") y además era lo que le daba de comer a P1. La precaución era de un
  motor viejo: con v2026.7.30 arranca bien con el archivo `:ro` desde el primer
  arranque, verificado. `cerrar-config.sh` queda solo para agentes viejos.

- **P3 — la migración de secretos destruía configuración del cliente (CERRADO).**
  La primera versión movía solo las variables de una lista blanca y borraba
  `data/.env`: descartaba `TELEGRAM_ALLOWED_USERS` —que crea el propio kit y es
  la lista blanca del bot— y el valor no quedaba en ningún lado. Sin esa
  variable el bot no le contesta a nadie o le contesta a cualquiera. Ahora es
  lista **negra** (solo se quedan afuera `PYTHONPATH`, `LD_PRELOAD` y familia),
  el archivo se mueve **entero y sin reescribir** cuando no hay nada peligroso
  —así no se parte un valor multilínea, como una clave PEM— y si hay que filtrar,
  el original queda en `data/.env.sin-migrar` en vez de borrarse.

- **FALTA — el guard remoto de la migración del adapter falla ABIERTO.** En
  `desplegar-remoto.sh`, para no borrar `data/scripts/portal_adapter.py` mientras
  el contenedor todavía lo ejecuta, se pregunta por ssh
  `docker inspect … | grep /opt/data/scripts`. Cualquier error —docker que no
  responde, contenedor con otro nombre, ssh que se corta— se lee como "ya está
  migrado" y la ruta vieja se saca igual: un `docker restart` posterior deja el
  portal en crash-loop. Y no lo ejercita nadie: el comparador no habla ssh y el
  juez (`tools/probar-despliegue-ssh.sh`) tiene un `docker` de mentira que hace
  `exit 0`. Falta distinguir "el contenedor no usa la ruta vieja" de "no pude
  averiguarlo" —ante la duda, conservar— y cubrirlo en el juez con un `docker`
  falso que devuelva el entrypoint viejo.

## El patrón detrás de las últimas tres vueltas, y qué construir (12/8)

Siete bugs de tres vueltas seguidas son **el mismo bug**: *un archivo que el
agente puede escribir termina siendo interpretado por algo que corre con más
permiso que él* — el código del adapter, `data/.env`, `data/config.yaml`, el
`cont-init` que corre s6, el manifiesto del limpiador, el `default:` que
`observabilidad.sh` metía en un `ssh` root.

La propuesta era un **inventario de consumidores**: una tabla *quién lee X · con
qué privilegio · quién puede escribir X*, y un chequeo que falle cuando el
escritor tiene menos privilegio que el lector. Sigue en pie, con tres
correcciones que salieron de la auditoría y que son el verdadero aprendizaje:

1. **Le falta una cuarta columna: CON QUÉ GRAMÁTICA LO LEE.** Es literalmente el
   bug de hoy. `data/.env` ya estaba en la tabla, ya sabíamos quién lo lee y con
   qué privilegio, y el guardrail falló igual: el kit lo parseaba con un regex de
   bash (`^NOMBRE=`) y el consumidor con godotenv, que acepta `export` y recorta
   espacios. `export PYTHONPATH=/opt/data/evil` era invisible para el nuestro y
   perfectamente visible para el suyo. **Un chequeo de tres columnas habría dado
   VERDE sobre el archivo envenenado.**

2. **Validar con el parser del consumidor, no con el nuestro.** Para
   `secretos.env` ya está implementado y es barato: después de migrar,
   `migrar-secretos.sh` corre `docker compose config` y verifica que ninguna
   variable peligrosa llegue al entorno de los servicios; si llega, deshace la
   mudanza. La regla general: cuando un chequeo nuestro afirma algo sobre un
   archivo que lee otro programa, la afirmación vale lo que valga nuestro parser
   — así que hay que preguntarle al que lo lee.

3. **El inventario tiene que incluir los consumidores que NO están en el
   servidor.** `observabilidad.sh` corre en la Mac del operador y fue el primer
   camino a root en la VPS; `foto-bot.sh` y `avatar-bot.py` también leen datos
   del agente fuera del contenedor. Una tabla armada desde los montajes del
   compose no los ve.

Y una advertencia que tiene que salir **impresa por el chequeo**, no vivir sólo
acá: *el chequeo puede afirmar que la tabla está completa respecto de los
montajes declarados, pero NO que enumere todos los consumidores — eso sigue
siendo trabajo humano.* Que nadie lea "0 fallas" como "no hay más caminos".

## Menor: el config del kit nace viejo para el motor

`compose/config.base.yaml` no declara `_config_version`, y el motor loguea en
cada arranque que el config "predates version 12 (~2 years old)" y que ya no lo
puede auto-migrar. No rompe el arranque —cae a defaults compatibles y las
perillas se aplican, verificado— pero es el tipo de cosa que en un bump del motor
deja de ser benigna en silencio y en todos los clientes a la vez. Falta decidir
el número, ponerlo, y que `agente-check.py` lo exija.

## Los últimos cinco de la tanda del 12/8 — cerrados, y lo que dejaron abierto

**Quién lo destraba:** el portal.

Cerrados y medidos contra el agente del lab (Tero), no de memoria:

- **"Corregir y aprobar" apagaba el aviso y precargaba el texto rechazado.** El
  aviso tenía `!correcting` en la condición, así que desaparecía justo al tocar
  el botón contra el que advertía; y el borrador salía de `mandable`, que sale
  del recuadro viejo. Aprobar con corrección manda ese texto como "usá
  exactamente esta versión", o sea que era peor que Aprobar a secas. Ahora el
  aviso sigue puesto mientras corrige (con otro texto), la caja **arranca
  vacía** cuando lo único que hay para copiar es lo que ella rechazó, y "Lo que
  hablaron" —donde vive la re-propuesta en prosa— **queda a la vista mientras
  edita**, que antes se escondía.
- **El rótulo de autor mentía en la pantalla donde se aprueba.** Aprobaciones
  tenía un ternario binario (`esDelCliente ? "Vos" : "Tu agente"`) y el
  comentario del fundador se leía «Tu agente». `rotuloAutor()` subió a
  `lib/agent.ts` y lo usan las **tres** pantallas (Aprobaciones, Tablero y el
  visor de entidades, que era una tercera copia y la más desviada: mostraba
  `portal` como "Portal").
- **Había tres definiciones de "el cliente".** Quedó una:
  `esElCliente = /^(cliente|portal)$/i` en `lib/agent.ts`. `user`/`usuario`
  salieron del conjunto **confiable** —el que decide qué contenido se esconde—
  y entraron en el de **rótulos** (`FIRMAS_DEL_AGENTE`), porque `user` es el
  default de `hermes kanban comment` y mostrar esa palabra en pantalla es un
  identificador de máquina en la cara del cliente. Medido: un comentario firmado
  `user` con "RECHAZADO POR TU CLIENTE…" ya no sale como «user · Lo rechazaste»
  con el cuerpo escondido, sino como un comentario del agente **con su texto
  entero a la vista**.
- **`?pedido=` no traía la tarjeta a la vista.** Una llamada a `traerALaVista()`.
  De paso el helper aprendió algo que le faltaba a todos sus usuarios: **lo que
  no entra en la ventana no se centra, se alinea arriba.** La tarjeta del pedido
  mide 1208 px con una ventana de 806, y `block: "center"` la dejaba arrancando
  en −201 — con el título y el "Le dijiste que no" arriba del borde.
- **`docs/rutas-portal.md` decía lo contrario del código** (rAF donde el código
  usa `setTimeout` a propósito, y "dos causas" donde hay tres). Corregido, con
  el porqué escrito para que nadie lo "arregle" de vuelta.

Lo que **sigue abierto** después de esta tanda:

- **`contesto` no distingue al agente de un tercero.** En Aprobaciones,
  `estadoDeLaNegociacion` da por contestado el "no" en cuanto comenta cualquiera
  que no sea el cliente, así que un comentario del fundador hace que la pantalla
  diga "Tu agente ya te contestó" cuando el agente no dijo nada. Ahora que el
  rótulo distingue terceros, esta es la última pieza que no. No se arregla con
  una lista de nombres: hace falta que el adapter diga qué comentario es del
  agente. Lo mismo vale para `elegirPropuesta`, que podría elegir como propuesta
  vigente el comentario de un tercero si trae una tabla.
- **El motivo con una comilla sin cerrar sale con la de apertura pegada.**
  `motivoDelRechazo` corta hasta la ÚLTIMA comilla de cierre; si el cliente
  escribe una sola comilla de apertura, esa comilla queda adentro de la cita.
  Cosmético, pero es texto suyo entre comillas.
- **Cerrar un pedido no pide confirmación.** La casilla "esto no va más" +
  Enter en el input alcanzan para cerrarlo, y cerrar es la única acción de esa
  pantalla que no se puede deshacer desde ahí (hay que volver a pedirlo por el
  chat). Debería confirmar, como Archivar en el Tablero.
- **`BLOCKED:` se filtra en Aprobaciones y se muestra en el Tablero**, donde
  además repite lo que ya dice el cartel "POR QUÉ SE FRENÓ" tres renglones más
  arriba. `esMarcador()` vive en `aprobaciones/page.tsx`: tiene que subir a la
  lib y usarse también en el Tablero.
- **En Tareas el mismo renglón muestra dos horas distintas** ("Los lunes a las
  09:00" y "Próxima lun 17 ago a las 06:00"): el cron viene en la zona horaria
  del agente y la hora se formatea con la del browser. Mientras las dos no salgan
  de la misma zona, el renglón se contradice solo.

## Flujos que dicen la verdad — cerrado el 13/8, y lo que le queda al kit

El QA a ciegas del 12/8 dejó el peor hallazgo del portal: **la pantalla mentía
en verde**. La veterinaria tenía dos flujos con el cartel "Activo"; los dos ya
habían corrido y **fallado**. Lo descubrió en Actividad —escondida en "Más"— y
cuando se lo preguntó al agente él le dijo la verdad: *"todavía no te podés
olvidar del tema: la última revisión automática falló"*. Su veredicto: *"lo
pagaría, pero mientras la pantalla mienta en verde sigo con la misma carga
mental"*.

**Cerrado en el portal (13/8), sin tocar el agente:** Flujos cruza
`/portal/flujos` con `/api/jobs` y cada tarjeta dice si corrió, cuándo, cómo
salió, cuándo es la próxima, y —si falló— por qué en criollo con el error crudo
plegado. Pausar, reanudar y "probarlo ahora" son botones de verdad. Actividad
sale de "Más" y suma las fuentes que le faltaban.

Lo que **necesita el kit** (nada de esto se puede hacer desde el portal):

1. **PATCH en el CORS del gateway — es lo que bloquea "cambiar el día y la
   hora".** Las dos clientas lo pidieron por separado y es la única de las
   cuatro acciones que no se pudo implementar. El verbo existe y funciona
   (`PATCH /api/jobs/{id}` con `{"schedule": {...}}`), pero el preflight
   contesta `Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS` — sin
   PATCH — así que el browser lo corta antes de salir. Verificado el 13/8 contra
   el laboratorio:

   ```
   curl -i -X OPTIONS http://127.0.0.1:8942/api/jobs/<id> \
     -H "Origin: http://localhost:8090" \
     -H "Access-Control-Request-Method: PATCH"
   → Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS
   ```

   Agregar `PATCH` a esa lista alcanza para que el portal deje de mandar al
   cliente al chat a pedir un cambio de horario. **Mientras tanto**, el botón
   "Cambiar día u hora" lleva al chat con el pedido ya escrito: no miente, pero
   son cinco minutos de espera para mover una hora.

2. **`gatillo_job` en `/portal/flujos`.** El adapter YA lo lee del frontmatter
   (lo usa para calcular `ultima_corrida`) pero no lo publica. Sin él, el portal
   ata cada flujo a su tarea **por el nombre `flujo-<slug>`**, que es el que le
   pone el kit al crear el cron. Anda, y con duplicados elige la viva y más
   reciente — pero es una convención de nombre haciendo de clave foránea: el día
   que alguien renombre un cron a mano, ese flujo se queda sin próxima corrida,
   sin motivo de falla y sin botones, en silencio. Publicar el id lo cierra.

3. **Borrar un flujo.** La veterinaria también pidió poder sacarlo. `DELETE
   /api/jobs/{id}` sí pasa CORS, pero borrar el cron deja el `FLUJO.md` huérfano
   y el flujo sigue apareciendo en el portal sin tarea: media baja es peor que
   ninguna. Hace falta que el adapter exponga una baja que se lleve las dos
   mitades (y que sea reversible, o que al menos avise que no lo es).

4. **El huso horario del agente, declarado.** El portal ya no formatea con el
   reloj del browser: usa el offset que traen las fechas del motor
   (`2026-08-17T08:30:00-03:00`). Pero los `mtime` de `/portal/files` y los
   `started_at` de `/api/sessions` son epoch pelado, sin huso, así que Actividad
   les presta el offset que encontró en otra fecha de la misma tanda. Funciona,
   y se rompe justo en el caso que más importa: **un agente sin ninguna tarea
   programada todavía** no tiene de dónde sacarlo y cae al reloj de quien mira.
   Un `timezone` (o el offset) en `/portal/manifest` lo resuelve de una y sirve
   para todo el portal.

5. **`/portal/activity` no ve casi nada de lo que hace el agente.** La contadora
   leyó *"Todavía no hay actividad"* justo después de armar tres flujos y de que
   el agente le escribiera tres documentos, y su conclusión fue peor que el bug:
   *"si la bitácora me miente cuando estoy mirando, no la voy a creer cuando no
   estoy"*. La causa: el endpoint tiene **dos fuentes y solo dos** —
   `executions` (corridas de crons) y `task_events` (tablero)—. Ella no tenía
   ninguna: sus crons todavía no habían corrido y su tablero estaba vacío. Todo
   lo que su agente hizo lo hizo conversando, y **escribir archivos o dejar
   flujos armados no deja fila en ninguna de esas dos tablas**. Medido el 13/8
   contra el lab: `/portal/activity` devolvía **1** evento mientras
   `/portal/files` tenía **4** archivos y la sesión **128** mensajes.
   El portal lo tapó desde afuera mezclando `/portal/files` y `/api/sessions` en
   la misma línea de tiempo, pero **son tres llamadas para armar una bitácora
   que el adapter podría entregar hecha** — y ahí adentro sabe cosas que el
   portal no (qué archivo escribió una corrida y cuál subió el cliente, sin
   adivinar por la carpeta). Si `/portal/activity` sumara los archivos del
   workspace y las sesiones humanas, el portal borra ese pegote.

6. **Ninguna corrida que falla avisa por fuera del portal.** El prompt del cron
   ya le pide al agente que si no pudo trabajar deje un ticket visible —bien—
   pero las dos corridas de la veterinaria fallaron **antes de que el agente
   arrancara** (`RuntimeError: No LLM provider configured`), así que no hubo
   quién dejara el rastro: la única huella quedó en `executions`, donde nadie
   mira. Un flujo que falla dos lunes seguidos tiene que salir a buscar al
   cliente por su canal, no esperar a que entre. Eso es del kit.

---

## Segunda vuelta del 13/8 — lo que cerró la auditoría y lo que dejó abierto

Los arreglos del 13/8 (flujos, reloj, alta) pasaron por **tres auditorías
independientes**: una del alta, una de flujos y actividad, y una del portal
entero contra el build servido. Las tres midieron en pantalla y contra los
agentes del lab, no leyendo código. Los 15 puntos declarados dieron **cumple**.

Lo que encontraron ADEMÁS, y ya está cerrado (commits `b5fe118`, `3cf0e4a`):

- **La mentira sobrevivía en el resumen de Flujos**, que es la primera línea
  que se lee: juntaba "falló", "no arrancó" y "ya no está programado" en un
  solo *"N no pudieron terminar la última vez"*, contradiciendo a las tarjetas
  de abajo. Ahora los nombra por separado y **la suma cierra con las tarjetas**
  — hay un chequeo que lo cruza mecánicamente, para que la mentira no vuelva.
- **"Trabajando ahora" mostraba la hora de arranque de la corrida anterior.**
- **El Chat contaba los días con el reloj del browser**: una conversación de
  las 02:40 caía bajo "AYER" mientras Actividad la ponía bajo "HOY".
- **El huso era un dato aprendido que sólo aprendían 3 de las 11 pantallas.**
  El arreglo salió de las pantallas y entró en el único punto de red: `get()`
  aprende de cualquier fecha con offset, y el arranque lo va a buscar. Se
  aprende **sólo de claves conocidas**: barrer el JSON entero dejaría que el
  reloj lo fijara el markdown de un ticket.
- **El alta se repetía sobre un agente ya bautizado** al cambiar de agente, y
  contestar le escribía. Ahora le gana el manifiesto a lo que se acuerda el
  browser.

### Lo que quedó abierto

1. **`atrasado` tapa una falla anterior.** En `corridas.ts` el estado
   "no arrancó cuando le tocaba" se evalúa **antes** que "la última vez falló",
   así que un flujo que falló *y* además quedó atrasado sólo muestra el atraso.
   Arreglarlo desalinea el resumen respecto de las tarjetas si se hace a medias:
   es una tanda propia.
2. **El modal de un pedido del cliente sigue ofreciendo "Aprobar".** Es la misma
   mentira que se sacó del rótulo (esos tickets no esperan nada del cliente),
   pero sacarle la acción los deja sin forma de destrabarse desde el portal
   salvo Archivar. Decisión de producto pendiente.
3. **La columna "Completados" quedó en singular** ("Completado"): es el precio
   de adoptar la palabra compartida de `palabras.ts`. Si se quiere el plural,
   hay que volver a tener un rótulo propio.
4. **Tres tickets de Tero llegan con `status: "todo"`**, que ni `columnOf` ni
   `estadoDeTarea` conocen; los dos lo mandan a "En curso". Anda por accidente.

### Lo que le queda al kit (además de los seis del bloque anterior)

7. **El pedido de conexión necesita nacer bloqueado en UN viaje.**
   `adapter/portal_adapter.py:1723` (`create_ticket`) crea el ticket `ready` y
   asignado, así que el worker lo levanta a los segundos. El portal hoy hace
   dos viajes (crear + bloquear) y queda una ventana de ~2 s contra los ~6-22 s
   del dispatcher. Un `{"esperando": true}` lo cierra.
8. **Un bloqueo de dependencia sobre un ticket SIN PADRES es un re-promote
   instantáneo** (`hermes_cli/kanban_db.py:5530` + `recompute_ready` en
   `:3988`). Es la fábrica del loop que gastó US$0,09 en 13 minutos, y le pasa
   a **cualquier** ticket, no sólo a los nuestros. Es del motor: candidato a
   reportar upstream a Nous.
9. **`connections/catalogo.json:31`** — el `como` de Telegram afirma *"El bot ya
   está creado"*, que es falso cuando falta `TELEGRAM_BOT_TOKEN`, y el portal lo
   muestra tal cual arriba de "Pedir que la conecten".
10. **`aviso` en el manifiesto es lo que el cliente CONTESTÓ, no lo que
    FUNCIONA** (`adapter/portal_adapter.py:342`). Si le conectamos el canal
    desde nuestro lado, nadie actualiza `contacto` y la franja sigue apareciendo.
    Lo correcto es derivarlo del estado real de los canales.
11. **`CANALES_AVISO` no acepta `whatsapp`** (`adapter/portal_adapter.py:165`):
    mientras tanto vive como pedido y nunca como canal.

### Una trampa de la API del motor, para el que escriba el próximo cliente

`GET /api/jobs` **esconde los pausados**: hay que pedir `?include_disabled=true`
(`gateway/platforms/api_server.py:5262`). El portal ya lo hace desde su primer
commit, pero quien pruebe con curl a secas va a leer "no existe" donde el motor
quiere decir "en pausa". Verificado el 13/8 pausando un cron de Pulga: el job
desaparece entero de la lista.

### Lo que se verificó en vivo y conviene no volver a discutir

Contra Pulga, el 13/8, con POST de verdad:

- `POST /api/jobs/{id}/run` sobre un flujo pausado **lo despausa**
  (`enabled:true`, `paused_at:null`): el motor implementa "correr ahora" como
  "adelantá el próximo disparo".
- **Pausar con la corrida en vuelo NO la mata**: pause 12:39:49, la corrida
  terminó 12:40:56 con `ok`, y el job quedó en pausa. Por eso el guardián del
  portal re-pausa *después* de que el motor tomó la corrida y no antes.
- La corrida disparada aparece como `latest_execution.status: "claimed"` a los
  ~36 s. Es la única fuente de "está corriendo": el motor **nunca** escribe
  `state: "running"`.

---

## Cierre del 13/8 — la prueba a ciegas de la inmobiliaria

Un cuarto agente de laboratorio (rubro nuevo, sin estrenar) entregado a alguien
sin acceso al repo, a los docs ni idea de qué es el producto. Encontró el peor
bug del día y la mitad de la lista de arriba.

**Su número:** US$150–250 por mes por lo que vio, US$300 "sin discutir" con
impagos y carpetas de garantía. Hoy, **cero**, y la razón es una frase que ya
dijeron las otras dos clientas: *"no puede leer mis contratos ni avisarme por
WhatsApp, que son las dos cosas para las que lo quiero"*.

### Lo que quedó cerrado en el portal

`53ef4b9` el link al entregable no se podía tocar (más tokens, inglés, subida
de archivos) · `a4ae59b` "Aprobar" sobre un freno quemaba el ticket (más el
vocabulario unificado, Inicio vs Flujos, la última actividad y el saludo) ·
`3e34d78` las bienvenidas dibujaban una interfaz de mentira.

### Lo que quedó cerrado en el kit

`3e67a0c` el agente afirmaba trabajo que no hizo · `cdb9948` cada charla
arrancaba de cero · `5541488` "el chat no me contestó nunca".

### ABIERTO Y GRAVE — la puerta falla abierto bajo carga

Medido el 13/8: `shell hook timed out after 25.54s` con la máquina cargada. La
puerta está declarada con `timeout: 10` y **un hook que vence deja pasar la
tool** (`agent/shell_hooks.py:509-515`), con un `logger.warning` que nadie mira.
Es decir: **bajo carga, la barrera de aprobación deja de ser una barrera**, y el
único rastro queda en un log. No se cierra desde el config. Detalle en
`hermes-kit/notas/perillas-motor.md` §8.

Es el agujero más serio que queda abierto hoy, porque anula desde afuera el
trabajo del día sobre la puerta.

### Otros abiertos de esta vuelta

- **La corrección del plugin de promesas no queda en el historial.** El motor
  persiste el turno (`turn_finalizer.py:352`) antes de transformarlo (`:485`),
  así que `state.db` guarda el texto original: el cliente ve la corrección
  cuando llega y desaparece si refresca. Se cierra upstream.
- **Una llamada al proveedor de 422 s sin nada en pantalla.** El SSE sólo manda
  `: keepalive` cada 30 s y el `delivery_ledger` no cubre ese camino, así que el
  chat se ve colgado. No es del motor: **es de producto, en el portal** — la
  clienta esperó 15 minutos mirando un cartelito que no decía cuánto faltaba.
- **El plugin no está en los agentes remotos.** `desplegar-remoto.sh` sube el
  compose nuevo pero **no pisa un `config.yaml` existente**: a Mr.Wobble y East
  hay que agregarles `plugins.enabled` a mano. Tero, Faro y Pulga siguen en
  SOUL v10 y sin guardia.
- **`flujos/page.tsx` sigue mostrando la cadencia declarada** (`f.gatillo`): si
  el FLUJO.md queda viejo, Flujos se contradice consigo mismo. Inicio ya se
  arregló; Flujos no.
- **La escritura de la memoria depende de que el modelo llame a la tool**: no
  hay perilla de extracción automática (`config_defaults.py:1531-1554`). Se
  arregló el lado de la lectura, que era hueco nuestro.

## Uso escondido, y la plata que no vemos (16/8) — RESUELTO el 19/8

**Ya está hecho:** el adapter 0.39 expone `GET /portal/uso`, que le pregunta a
OpenRouter por la clave del agente y sirve hoy / este mes / desde siempre; la
pestaña volvió (`MODULOS_OCULTOS` quedó vacío) y `/portal/usage` se borró con
el número que mentía. Queda abierto sólo el punto 1 de abajo: **cómo le
cobramos al cliente** — la pantalla ahora dice la verdad, pero sigue sin ser
una factura. Lo de abajo queda como registro de por qué.

**La pestaña Uso y el bloque "Consumo" de Inicio están fuera del portal.** El
bloque de Inicio se borró; la pestaña está detrás de un interruptor
(`MODULOS_OCULTOS` en `app/app/layout.tsx`), que además redirige `/app/uso` a
`/app/inicio` — sacarla del nav no alcanzaba, la ruta vivía en favoritos y en
`rutas-portal.md`.

Dos motivos, y el primero es el que manda:

**1. Todavía no está decidido cómo le cobramos al cliente.** Mostrarle un gasto
en dólares antes de eso le contesta una pregunta que nadie le hizo, y peor:
sugiere que le vamos a cobrar el consumo, que es justo lo que no está resuelto.

**2. El número estaba mal, y mal para abajo.** Medido el 16/8 sobre Mr.Wobble:

| | |
|---|---|
| litellm registró (141 llamadas) | US$ 0,1675 |
| OpenRouter cobró ese día | US$ 1,5152 |
| **sin registrar** | **US$ 1,3477 — 9x** |

La diferencia es **entera de generación de imágenes**. La causa es estructural,
no un bug de la pantalla:

- `image_generate` es un plugin del motor (`/opt/hermes/plugins/image_gen/openrouter/`)
  que le pega **directo** a OpenRouter. No pasa por litellm, que es de donde
  sale todo lo que registramos en `costos.jsonl`.
- Y el plugin **descarta el `usage` que OpenRouter le devuelve**: no lo loguea
  ni lo incluye en el resultado de la tool (verificado, no hay una sola
  mención a `usage` ni a `cost` en su código). Desde adentro del agente esa
  plata es invisible.

**El camino que sirve, ya probado:** `GET https://openrouter.ai/api/v1/key`
devuelve `usage_daily`, `usage_weekly` y `usage_monthly` de la key. Es lo que el
proveedor **cobró**, no una estimación nuestra, y como cada agente tiene su
propia key el número ya viene aislado por cliente. Probado desde el contenedor
el 16/8: anda.

Quedaría un cron corto que lo lee y lo guarda, con el total real de titular y el
desglose por modelo de litellm abajo (que el endpoint de la key no da).

**El que NO hay que tomar sin probar en un agente descartable:** apuntarle el
`base_url` del plugin de imágenes a litellm. El resolver de providers ya rompió
un agente en vivo esta semana, y `resolve_runtime_provider` resuelve por nombre
de provider, no por lo que diga la config de `image_gen`.

Nada de esto se destraba solo: mientras Uso esté escondida no molesta a nadie,
pero **el día que se decida el modelo de cobro, esto es lo primero que hay que
arreglar** — y si se prende la pantalla sin arreglarlo, el cliente planifica con
un número 9 veces más chico que su factura.

## El proxy se plantaba en el medio, y el deploy no lo alcanza (16/8)

Reseteando Mr.Wobble, el primer mensaje despues del alta volvio asi:

```
HTTP 400: litellm.UnsupportedParamsError: openrouter does not support
parameters: ['reasoning_effort'], for model=hermes-agent
```

Hermes manda `reasoning_effort` en cada request y litellm, en vez de sacar el
parametro que el proveedor no entiende, devuelve 400. **Arreglado** con
`drop_params: true` en `compose/litellm.yaml` (kit). Es la misma regla que ya
estaba escrita ahi para los callbacks: la observabilidad se metio en el camino
de la inferencia, asi que nunca puede ser ella la que corta.

**Lo que queda abierto: ese arreglo no viaja con un despliegue normal.**
`desplegar-remoto.sh` no toca `litellm.yaml` — el proxy lo instala y lo levanta
`tools/observabilidad.sh`, con su propio compose. Consecuencias:

- El compose del agente **no conoce el servicio**: `docker compose up -d
  --force-recreate litellm` en `/opt/agentes/<slug>` responde `no such service`
  y **no falla ruidosamente si uno silencia stderr** — parece que reinicio y no
  reinicio nada. Se reinicia con `docker restart <slug>-litellm` o por
  `observabilidad.sh`.
- **Los otros agentes con observabilidad prendida siguen con el 400.** Hay que
  pasarles `observabilidad.sh` o copiar el yaml y reiniciar el proxy. Mr.Wobble
  ya esta.

Vale la pena que `desplegar-remoto.sh` sincronice `litellm.yaml` cuando el
agente tiene el proxy levantado: hoy un arreglo del proxy depende de que alguien
se acuerde de correr otro script.
