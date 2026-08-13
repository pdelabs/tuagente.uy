# COMPACT — estado del proyecto (2026-08-05, madrugada)

Contexto destilado para humanos y subagentes. **Fuente de verdad de hechos
VERIFICADOS.** Lo que no diga "verificado", tratarlo como hipótesis.

## Los cuatro repos

| Repo | Qué es |
|---|---|
| `tuagente.uy` | landing pública + **portal del cliente** (`app/app/`) + `docs/` |
| `hermes-kit` | **lo que se instala en el agente de cada cliente** (producto) |
| `agente-pdelabs` | La Mano — el agente de pdelabs, **cliente 0** y fixture |
| `pdelabs-landing` | pdelabs.com, sin relación con esto |

**PRINCIPIO CERO:** el portal sirve a CUALQUIER agente Hermes de cualquier
cliente. Nada específico de un cliente entra al código ni al copy fijo.

## Arquitectura

Portal estático (Next 14) → dos servicios **del agente del cliente**:
- **`:8642`** gateway de Hermes (nativo): chat, sesiones, jobs.
- **`:8643`** `portal_adapter.py` (nuestro sidecar, vive en el kit): tickets,
  aprobaciones, artefactos, archivos, actividad, uso, capacidades, subidas, y el
  **proxy del stream de chat** (el gateway lo sirve sin CORS y el browser lo
  descarta). Hoy **v0.20.0**.

Auth: bearer con `API_SERVER_KEY` por magic link `#endpoint=&adapter=&key=`.
`app/app/lib/agent.ts` es el ÚNICO punto de red del portal.

## El portal (11 pestañas)

Inicio · Chat · Pipeline · Aprobaciones · Artefactos · Tareas · Actividad ·
Archivos · Uso · **Conexiones** · Capacidades. Cada una con su bienvenida propia
(`app/app/lib/intros/`). Kit UI sin sombras, hairline, lucide, cero emojis.

Se puede: chatear con markdown rico (código, KaTeX, mermaid, HTML sanitizado,
artefactos en iframe aislado), adjuntar archivos, referenciar tickets con `#` y
archivos con `@`, crear/comentar/cambiar estado de tickets, **corregir un
borrador y aprobarlo**, ver la consigna real de cada tarea programada con su
historial, y el costo en USD por canal y por modelo.

**Todo lo que se abre tiene URL** (12/8): pestaña y detalle —una tarea, un
entregable, una carpeta, una conversación, un pedido de aprobación—. Van por
query sobre la pestaña (`/app/pipeline?tarea=t_ab12`,
`/app/archivos?archivo=entregables/informe.md`) y NO por segmentos de path:
en el build todas las pestañas son `○ (Static)` y la única `ƒ` es
`/app/flujos/[slug]`; un segmento por detalle ataría el portal a tener
servidor. Tampoco por hash: ahí llega la credencial. El contrato completo
—lo que el agente puede citar, con **qué fila se probó y cuál no**— está en
`docs/rutas-portal.md`: ojo con darlo por verificado entero, la primera versión
de esa tabla decía "cada fila está probada" y tres filas mentían.
De paso, el magic link ya no deja la clave en la barra de direcciones: se borra
del hash apenas queda guardada.

Un comentario desde el portal **despierta al agente** (el adapter le manda la
ficha del ticket con fechas) y **su respuesta se publica como comentario en el
mismo ticket**. Todos los avisos usan una sola sesión, oculta del chat.

## El kit

`nuevo-agente.sh` (crea el repo del cliente: compose, config.yaml con la receta
de kanban y los toolsets caros apagados, SOUL borrador, skills, adapter) · `install.sh` (instala/actualiza; `--diff` contra la
deriva) · `adapter/` · `skills/` (artifact, entregable, aprobacion) ·
`connections/` (catálogo curado + runbook de Google) · `soul/` (5 bloques con
placeholders) · `onboarding/brief-empresa.md` · `tools/portal-check.py`
(**0 fallas o no se entrega**) y `tools/agente-check.py` (offline, antes de
prender: frontmatter, SOUL sin huecos, los olvidos de config).

## Hechos verificados sobre Hermes (MIT, Nous Research)

- **Skills:** se auto-descubren (un manifiesto mtime+tamaño dispara la
  reindexación, sin comandos ni reinicio) pero **tardan** (~20 min observado).
  Cada `SKILL.md` **necesita frontmatter con `name` y `description`**: sin eso se
  indexa con descripción vacía y el agente no la usa nunca.
- **Bloqueo pegajoso:** un ticket vuelve solo a `ready` salvo que su último
  evento sea un `blocked` **tipado**. Demostrado con control: uno creado con
  `--initial-status blocked` pasó a `ready` en ~75 s; uno bloqueado con la acción
  aguantó. **Un pedido de aprobación creado "bloqueado" se lee como aprobado.**
  Las herramientas nativas no exponen el estado inicial: por ahí no es alcanzable.
- **Toolsets:** el toolset `kanban` (12 herramientas) necesita **dos** claves en
  `config.yaml`: `toolsets: [kanban]` abre el `check_fn`, y `platform_toolsets`
  con `kanban` por plataforma pasa el filtro con el que el gateway arma la
  sesión. Con una sola, cero tools de kanban. `kanban` no está en
  `CONFIGURABLE_TOOLSETS`, así que no se puede pedir por el camino normal.
  Verificado el 4/8 con control en un agente descartable; receta y reproducción
  en `hermes-kit/notas/kanban-nativo.md`. **Nuestro plugin se borró**: lo único
  que hacía era declarar `kanban` en `provides_tools` y destrabarlo de rebote.
- **Contexto:** ver la medición de abajo. Parte del system prompt es Hermes
  hablando de sí mismo (le dice que es "Hermes Agent by Nous Research" y que dar
  soporte del runtime es parte de su trabajo); eso no lo controlamos.
- **Crons:** se crean por CLI, no por yaml. Una tarea creada desde una sesión del
  portal entrega a esa sesión, **que no puede recibir mensajes**: corre bien y no
  llega nada, sin aviso.
- **Tableros:** el default es `kanban.db`; los demás en
  `kanban/boards/<slug>/kanban.db` con un `board.json` que ya trae `project_id`.
  El adapter los lista y acepta `?board=`; las escrituras van al default.

## Conexiones (nuevo, 5/8)

El catálogo vive en el kit (`connections/catalogo.json`) y se instala en cada
agente; el adapter calcula el estado **por presencia** de credenciales, archivos
o plugins y nunca devuelve un valor. Tres estados: conectado / sin_conectar /
**bloqueado** (= falta algo NUESTRO, típicamente la app OAuth de tuagente).

Desde el portal no se conecta ni se pegan claves: se **pide**, y eso crea un
ticket. Google Workspace (Sheets, Drive, Agenda, Docs) ya lo soporta el motor;
falta crear una sola app OAuth tipo "Desktop app" nuestra y reusarla en todos
los clientes — ver `hermes-kit/connections/google-workspace.md`.

## Presupuesto de contexto, medido (5/8, agente nuevo)

```
system prompt   39,6 KB   (de eso ~11 KB son los bloques de SOUL del kit)
esquemas tools  67,6 KB   → 60,0 KB apagando tts y delegation
```

Los esquemas pesan casi el doble que el system prompt entero: **la palanca es
`agent.disabled_toolsets`, no reescribir prosa.** kanban solo son 19,8 KB.

## Endpoints verificados

**:8642** — `POST /v1/chat/completions` (stream OpenAI) · `GET/POST /api/sessions`
· `PATCH`/`DELETE /api/sessions/{id}` · `POST /api/sessions/{id}/chat/stream`
(body `{message}` singular, **SSE nativo**, incompatible con el parser OpenAI) ·
`GET /api/jobs?include_disabled=true` (¡sin eso esconde los pausados!) ·
`POST /api/jobs/{id}/pause|resume|run` · `GET /health`.

**:8643** — `manifest` · `tickets` (+`/{id}`, POST crear, comentar, estado) ·
`approvals` (+approve con `{correction}` opcional; reject con `{reason}` y
`{definitivo}` opcional, que además CIERRA el ticket) · `artifacts`
(+`/{id}`, DELETE) · `activity` · `usage` · `files` (+`/{path}`, siempre
text/plain) · `crons/{id}` · `capabilities` · `boards` · `POST upload` ·
`POST sessions/{id}/chat/stream` (proxy).

## Lecciones duras (NO repetir)

0. **Verificar el camino del cliente, no la pieza recién construida.** Todos los
   huecos de hoy aparecieron cuando Luis empujó, y todos morían con un solo
   comando. Antes de decir "listo": correr el flujo entero desde el estado en que
   lo encontraría un cliente, y separar lo verificado de lo inferido.
1. **kanban.db: jamás SQL de escritura.** Y para leer, `PRAGMA query_only`, NO
   `mode=ro`: en WAL, una conexión de solo lectura crea el `-shm` sin permiso de
   escritura y **rompe a todo el que quiera escribir** (nos tumbaba el dashboard
   de Hermes al ritmo del polling).
2. **Las memorias del agente pisan las herramientas.** Se había escrito solo la
   receta del terminal y la siguió usando aun con herramientas nativas
   disponibles. Dar una herramienta nueva incluye revisar qué tiene memorizado.
3. **Telegram: jamás diagnosticar con `getUpdates` desde afuera** — hay un solo
   long-poll por bot: la sonda le corta la conexión al agente y fabrica la falla
   que quiere medir. Verificar en pasivo con `docker logs`.
4. `docker exec` con heredoc: siempre `-i`. Archivos al browser: siempre
   `text/plain`. Nunca `git add -A` con subagentes escribiendo.
5. `hermes kanban`: opciones `--flag=valor` y `--` antes de los posicionales.
6. **Un ticket tiene UN desbloqueo, y no es del portal gastarlo.** A las dos
   re-bloqueadas por la misma causa el motor lo manda a `triage` —donde Aprobar
   contesta 409— o lo parte con el auto-decomposer usando el **cuerpo viejo**.
   Por eso rechazar es sólo un comentario firmado `cliente` y no toca el estado:
   el `unblock` se gasta una vez, al aprobar. Ver `docs/PENDIENTES.md`.
7. **Lo que firma `cliente` no siempre lo escribió el cliente.** Rechazar y
   aprobar-con-corrección dejan en el ticket un prompt para la máquina firmado
   como suyo ("RECHAZADO POR TU CLIENTE. No hagas lo que pediste aprobar…"), y
   el portal lo mostraba tal cual arriba de un "Vos". Todo comentario pasa por
   `leerComentario` (`lib/agent.ts`) antes de llegar a la pantalla.
7b. **Y ese filtro se aplica MIRANDO QUIÉN FIRMA, no el prefijo.** Reconocerlo
   sólo por el texto convertía el prefijo en un interruptor de luz: un
   comentario del AGENTE que arrancaba con "RECHAZADO POR TU CLIENTE." salía
   como «Tu agente · Lo rechazaste» y **sin una palabra de texto** — porque de
   un rechazo se muestra el bloque del motivo, que un comentario suyo no tiene.
   O sea, un canal por el cual el modelo esconde de la pantalla cualquier cosa
   que escriba. Regla: los formatos de máquina se aplican sólo a lo que firma
   el cliente; lo demás se muestra crudo. Y **ningún camino puede devolver
   vacío**: si el formato no matchea entero (un rechazo sin bloque de motivo),
   se muestra el crudo. Medido contra el agente del lab con comentarios
   sembrados por CLI, 12/8.
8. **El interruptor de "pasos internos" es para el ruido, no para las malas
   noticias.** `block_loop_detected` y `decomposed` suenan a maquinaria y son
   las dos únicas señales de que el pedido del cliente se rompió: van siempre a
   la vista. Detrás del interruptor sólo lo que no cambia ninguna decisión
   (latidos, arranques, esperas, asignaciones).
9. **Un id de la URL nunca se humaniza para hacerlo pasar por un nombre.**
   `?conexion=noexiste-xyz` terminaba anunciando "Venís a conectar noexiste
   xyz": el portal inventándole un producto al cliente. Chequeo de existencia
   primero, y si no está, `AvisoLinkViejo` + la lista.

## Estética
M3 expressive del `tailwind.config.ts`: primary #5B4BE8, surface #FBFAFF,
ink #14131F, tonales c-violet/c-green/c-coral/c-amber, Jakarta. Sin sombras.

## El agentito (7-8/8)
Personaje Rive en `public/agentito.riv` (21 KB), autorado 100% por MCP
(`rivemcp`). El state machine "Agentito" expone 13 inputs: `miradaX`/`miradaY`
(pupilas), `gesto` (qué objeto saca), los triggers `festejar` y `matear`, y 8
ejes de rasgos —tono, antena, accesorio, pupila, boca, piel, traje, cejas— que
dan 31 mil combinaciones. El cliente lo bautiza y le sortea la pinta en el
onboarding.

**Los gestos de trabajo son pose + mirada** (`gesto` 1-5): pensar es ladear la
cabeza y arquear UNA ceja (dibujada aparte, `cejaArco`: tapa las cejas del look,
así aparece también en los agentitos que no tienen); leer saca un libro y pasa
la página; escribir, libreta y lápiz que garabatea; buscar, una lupa que barre
la cara; hacer, una llave inglesa que gira un tornillo (la boca en C es un
`boolean_shapes` de verdad, con agujero, así se ve la tuerca por adentro). Son
animaciones en loop del `.riv`, en su propio layer (el 14), cada una apagando
los objetos de los otros por opacidad; el state machine cruza suave en 220 ms.
La mirada la sigue manejando el código y apunta a donde está la acción. Antes
eran solo pupilas y a 28px eso no se leía — el usuario los vio y no distinguía
ninguno. Solo "pensando" toca las cejas; en el resto la expresión la da el
objeto. Descartado por feo: el globo con tres puntos (parecía el "está
escribiendo…" de un chat), los engranajes, y **la mano** — se probaron tres
versiones (nudillos, puño de barras, manopla) y ninguna cerró: el agentito no
tiene brazos, así que cualquier mano queda flotando y a 28px es una manchita.

**El bautizo vive en el agente, no en el browser** (`POST /portal/identity`,
adapter 0.26). El adapter lo guarda en `/opt/data/portal_identidad.json`, lo
reporta en el manifiesto (`agent`, `look`, `bautizado`), escribe el nombre en un
bloque acotado del `SOUL.md` —entre marcadores `<!-- portal:identidad -->`, sin
tocar la prosa del alta— para que el agente SE PRESENTE así, y le pega un
`setMyName` al bot de Telegram. Todo lo de afuera es best-effort: si Telegram
limita o falta el SOUL, el bautizo igual quedó. localStorage queda como caché:
desde otra máquina el portal aprende del agente y no vuelve a pedir el nombre.
La **foto** del bot no se puede por API — `@BotFather` `/setuserpic`, a mano.

**Dónde aparece, y en ningún lado más**: onboarding (grande, animado), logo del
sidebar (chico, SVG), login (SVG), Inicio (chico, animado: se ceba mates si no
hay pendientes, festeja cuando aparece un entregable, mira al badge si algo
espera tu ok) y la pantalla de sin conexión (SVG dormido). NO va flotando, ni
en cada empty state, ni en las intros de módulo.

`lib/agentito.tsx` es la casa del look: tipos, ejes, localStorage y
`AgentitoAvatar`, el mismo dibujo en SVG estático sin runtime. El runtime Rive
(`@rive-app/react-canvas-lite`, wasm ~330 KB servido desde `/public`) entra solo
con `next/dynamic` en el onboarding y en Inicio.

### La escalera del ocio (12/8)
Dos animaciones nuevas, las dos sobre el ABURRIMIENTO DEL USUARIO, no sobre el
estado del agente — por eso el reloj vive dentro de `AgentitoRive` y no en el
prop `estado`: el portal sabe si hay pendientes, no si te fuiste a hacer otra
cosa. Solo corre con `estado === "tranquilo"`. Mates (~20 s, ya estaba) →
**bostezo** (trigger `bostezar`, 1½ min, se repite) → **el celu** (`gesto = 10`,
4 min): saca el teléfono DADO VUELTA —la cámara le ve la espalda—, la pantalla
le baña la cara con un haz de cuatro elipses de gradiente radial, y los ojos
leen siguiendo los tirones del scroll.

**El clic es el remate.** Mover el mouse NO le guarda el celu (solo reprograma
el reloj): si el mousemove cortara el gesto, la guardada no se vería nunca,
porque siempre movés el mouse ANTES de hacer clic. Lo despiertan solo las
acciones deliberadas —clic, tecla, scroll, toque— y ahí el `.riv` dispara
`guardarCelu` solo, por la condición `gesto != 10`. Si llega laburo mientras
está distraído, el gesto pedido gana: guarda y va a lo suyo.

Sale en Inicio (64-72 px) y en la bienvenida del chat (144 px). En el avatar de
28 px del chat no puede salir: ahí el estado siempre es un gesto de trabajo.

Las otras ocho que se probaron y NO entraron están en
`scratchpad/agentito/drafts/` de la sesión del 12/8 (desperezarse, cabecear,
disimular, entregar, apagado, preocupado, escuchando, hablando), cada una con
su `.riv` propio y su gif.

### Trampas verificadas
1. **Z-order al revés**: los hijos de un grupo se listan de ADELANTE hacia
   atrás. Un `add_*` con `group=` entra al FONDO (detrás de la panza,
   invisible). Hay que sacarlo a la raíz y volver a meterlo con `place:"front"`.
   Dentro del grupo, en cambio, el orden es el de creación: lo que se agrega
   PRIMERO queda adelante. Al dibujar un objeto, agregar de adelante hacia
   atrás (los renglones antes que las hojas del libro).
2. **El linter miente con los blend states**: `validate_riv_structural` marca
   "transition-target-range" en los dos layers de mirada desde el día uno. Es
   falso positivo: en el runtime real la mirada anda. Confiar en `export_riv
   --dryRun` + el navegador, no en el linter.
3. **No calcular posiciones a ojo**: para calibrar la bombilla en la boca se
   midió leyendo píxeles del canvas (`scratchpad/rive-test/probe.js`). Reveló
   que la matemática estaba bien y el problema era el z-order.
4. **Nunca escribir en un input de Rive desde el cleanup de un efecto.**
   `useRive` se declara ANTES que tus efectos, así que al desmontar su cleanup
   corre primero y destruye la instancia: escribir después tira "Cannot set
   properties of null" y se lleva puesta la pantalla entera (pantalla blanca de
   Next). Pasó con los gestos del chat, al terminar cada respuesta. El cleanup
   solo corta el rAF; las escrituras por frame van con try/catch.
5. **rivemcp tiene cupo de exports** (3, parece que se renuevan por día).
   Iterar sobre `save_session` —que escribe un .riv que anda— y gastar el
   export solo para el archivo que se commitea. Si el cupo se agotó, el
   checkpoint de `save_session` sirve igual: el `.riv` de los gestos se
   verificó en el navegador y se copió a `public/` desde ahí.
6. **Lo que un gesto mueve, alguien lo tiene que devolver.** Rive no resetea:
   una propiedad que solo escribe tu animación queda clavada en el último valor
   cuando el gesto termina. Pasó con la inclinación del cuerpo al pensar: el
   agentito quedaba torcido para siempre. Lo que escribe un layer más abajo se
   arregla solo (la opacidad de las cejas la pone el layer del look cada frame);
   lo demás hay que devolverlo a mano. `cuerpo.rotation` se resetea en
   `sinMate`, no en `sinGesto`: el layer del mate corre ANTES, así que desde
   `sinGesto` le pisábamos la inclinación de la cebada. Lo prueba
   `scratchpad/drive-reset.js`, que prende y apaga cada gesto y mide la punta
   de la antena.
7. **El trim path se rompe si tocás la geometría después.** Para la ceja curva
   se probó elipse + stroke + `set_trim_path`: el primer arco sale bien, pero
   cambiar `width`/`height`/`rotation` lo parte en pedacitos y volver a aplicar
   el trim no lo arregla. Terminó siendo tres barras redondeadas que arman el
   arco — feo de escribir, pero se ve igual y no se rompe.
8. **`move_object` conserva la APARIENCIA, y eso incluye la opacidad.** Sacar
   un hijo de un grupo invisible a la raíz le escribe opacidad 0 encima para
   que siga sin verse; al devolverlo al grupo, esa opacidad 0 QUEDA y el objeto
   nunca más aparece. Pasó con el lápiz: se movió mientras `libreta` estaba en
   0 y desapareció, aunque el orden de dibujo estuviera bien. Después de mover
   algo dentro de un grupo apagado, revisar su opacidad con `get_object_info`.
9. **La opacidad ESTÁTICA de un objeto es lo que se ve en el primer frame, y
   `sinGesto` no siempre llega a tiempo.** `herramienta` estaba en 1 estático
   desde el día uno y no se notaba porque `sinGesto` lo apaga al entrar; al
   sumar el layer del celu esa aplicación inicial dejó de darse y la llave
   inglesa apareció flotando en reposo, en Inicio y en el chat. El arreglo no
   es tocar el state machine: es que **el reposo del archivo sea el reposo de
   verdad**, o sea opacidad estática 0 en todo lo que `sinGesto` apaga
   (`libro`, `libreta`, `lupa`, `herramienta`, `cejaArco`, `celu`, `luzCelu`).
   Cada gesto prende el suyo explícitamente en el frame 0, así que poner los
   estáticos en 0 no rompe nada. Se caza mirando el primer frame en el
   navegador, no en el editor ni en el gif.
10. **`preview_riv_gif` con `stateMachine` MIENTE en el reposo.** Muestra la
   llave inglesa que el runtime real no muestra. Verificado: el checkpoint de
   `save_session` es byte-idéntico al `.riv` de producción y aun así rendea
   distinto. Para el estado inicial, el navegador es la única fuente.
11. **`describe_scene` devuelve TODO** —cada keyframe con frame, valor,
   interpolación y los cuatro puntos de control cúbicos, más el grafo completo
   del state machine con condiciones y flags—. Es lo que convierte "fusionar
   dos animaciones" en un trasplante exacto en vez de un redibujo a ojo. Con
   `includeKeyframes:false` sale la vista estructural, que es la que conviene
   para comparar cableados.
12. **`set_gradient_fill` AGREGA un fill, no lo reemplaza.** Tres llamadas
   seguidas dejan tres gradientes apilados; el síntoma fue una luz que lavaba
   las pupilas a gris. Para retocar un gradiente hay que borrar la forma y
   rehacerla. Y **`set_feather` se aplica pero el render lo ignora**: los
   bordes suaves salen del gradiente, no del feather.
13. **Un gradiente lineal deja filo en los costados.** Una luz con caída solo
   longitudinal muestra dos rectas donde termina la forma. Lo que no deja
   ningún borde visible es un gradiente RADIAL que llega a alpha 0 justo en el
   borde de la geometría —si la forma termina donde el alpha ya es 0, no puede
   delatarse— y darle dirección escalando el círculo a elipse.

### Trabajar en paralelo con rivemcp
La sesión del MCP es UNA sola y en memoria: dos agentes editando a la vez se
pisan el archivo. Para las diez animaciones del 12/8 se usó
`scratchpad/agentito/rive-driver.mjs`, que le levanta a cada agente su propio
servidor `rivemcp` por socket Unix (`start` / `call <tool> '<json>'` / `stop`).
Dos detalles que costaron: el socket tiene que vivir en `tmpdir` con nombre
corto (los unix sockets de macOS aguantan ~104 caracteres y el scratchpad se
pasa), y **`call` trunca stdout si lo pipeás** —hace `process.exit` justo
después del `console.log`—, así que hay que redirigir a archivo.
