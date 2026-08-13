---
titulo: Crear flujos
para_cliente: "Cuando le pedís un trabajo repetitivo nuevo, lo deja armado como un flujo que ves en tu pestaña Flujos."
name: flujo
description: "UNICA forma de dejar algo corriendo solo: crea un flujo del cliente (trabajo con nombre, gatillo y resultados, visible en su pestaña Flujos) y su cron bien entregado. La herramienta cronjob esta apagada y un cron a mano entrega a la nada. Usala SIEMPRE que el pedido sea repetitivo: 'todas las semanas', 'cada vez que llegue', 'avisame cuando', 'monitorea', 'seguimiento de', 'regularmente'."
version: 1.0.0
license: MIT
---

# flujo — convertir un pedido repetitivo en un trabajo con nombre

Cuando el cliente te pida algo **repetitivo** ("cada vez que llegue X…",
"todos los lunes…"), no lo resuelvas una vez ni improvises un cron suelto:
crealo como flujo. El cliente lo va a ver en su pestaña Flujos con su estado y
sus resultados — esa visibilidad es parte del producto.

**Este es el único camino para dejar algo andando solo, y no es un consejo:**
la herramienta `cronjob` está apagada en este agente. Si buscás una forma de
programar algo y no la encontrás, no es que falte: es que va por acá.

Y no lo hagas por terminal. Un `hermes cron create` a mano se salta las dos
cosas que hacen que el trabajo llegue: el flujo queda invisible para el cliente
(sin carpeta, sin FLUJO.md, sin pestaña) y el cron sale con `deliver=origin`,
que entrega a la sesión donde lo creaste — una sesión del portal NO PUEDE
recibir mensajes. Eso significa que corre bien, no falla, y no llega nada.
Nunca. Y nadie se entera. Pasó de verdad el 8/8.

## Antes de crearlo, cerrá el contrato

Un flujo **no es una tarea**: es un contrato que se ejecuta solo, todas las
semanas, para siempre. Ahí la cuenta se da vuelta. En una tarea, decidir por tu
cuenta y que te corrijan cuesta una vuelta. En un flujo, decidir mal se repite
sin que nadie mire — el cliente deja de leer a la tercera semana — y cuando se
descubre ya salió mal veinte veces.

Por eso, y **solo acá**, preguntar es barato y no preguntar es caro. Esto no
contradice "no pidas permiso para empezar": no estás pidiendo permiso, estás
cerrando qué se va a hacer.

**Preguntá antes de crear si no podés contestar solo alguna de estas tres:**

1. **Dónde termina.** ¿Lo hacés o lo dejás para que lo apruebe? Publicar,
   mandar, pagar y contactar no se asumen nunca. "Posteá en Instagram" puede
   significar *publicalo* o *dejámelo listo*, y son dos productos distintos.
2. **Con qué.** Si el trabajo necesita una conexión que no está, decilo y
   preguntá: ¿la conectamos, o arranco a medias mientras tanto? Nunca achiques
   el alcance en silencio. **Pero no esperes la respuesta para crearlo**: el
   script programa el gatillo igual y te devuelve `conexiones_faltan` para que
   se lo cuentes. Ver "Faltar una conexión no es motivo para no crearlo".
3. **Cuándo está bien hecho.** Si el resultado o la frecuencia admiten dos
   lecturas razonables, elegí con el cliente.

**Cómo preguntar:** todas juntas, en UN mensaje, cortas y con tu recomendación
puesta ("yo te lo dejaría para aprobar, ¿va?"). Nunca de a una ni en varias
vueltas. Máximo tres.

**Qué NO preguntar:** lo que podés averiguar solo (mirá el catálogo de
conexiones, el SOUL, el tablero), ni si arrancás.

**Si no te contesta:** creá el flujo con la opción más conservadora —la que no
manda nada para afuera— y dejá la pregunta escrita en el primer paso del
cuerpo, para que se vea en el portal. Enterrada en el punto 13 no la lee nadie.

## Faltar una conexión no es motivo para no crearlo

Y acá está el error que costó la confianza de una clienta el 13/8: le faltaba de
dónde leer los contratos, entonces el agente **no creó nada** y contestó "Queda
definido: viernes a las 9:30". Ella fue a Flujos, leyó "Todavía no hay nada
corriendo solo" y tuvo que preguntar "¿entonces quedó armado o no?" para
enterarse. Si no chequeaba, el viernes no le llegaba nada.

**El orden es: crear primero, contar después.** El gatillo queda programado aun
sin la conexión —a propósito: el día que se conecte arranca solo— y el script te
devuelve `conexiones_faltan` con la frase exacta para decirle a tu cliente que
quedó armado pero hoy no puede trabajar. Preguntar y crear no compiten:
preguntás **el contrato** (qué hace, dónde termina, cada cuánto), no **si lo
creás**.

Y mientras no lo hayas creado, no existe ninguna frase que lo dé por hecho:
"queda definido" incluido.

## Corré la primera vuelta enseguida

Cuando termines de crearlo, **trabajá el flujo una vez, ahí mismo**, y dejá ese
primer resultado. Alguien que pide "todos los lunes quiero X" espera ver una X
ahora, no una promesa para dentro de seis días: es la única forma que tiene de
saber que entendiste. Si el gatillo es `pedido`, no corresponde.

## Uso

```bash
python3 /opt/kit/skills/flujo/crear_flujo.py \
  --slug resumen-semanal --nombre "Resumen semanal de ventas" \
  --para-cliente "Todos los lunes a las 8 te espera el resumen de la semana." \
  --gatillo horario --detalle "Todos los lunes a las 8:00" \
  --cron "0 8 * * 1" \
  --conexiones google-workspace \
  --skills entregable <<'MD'
# Cómo trabajo este flujo
1. ...pasos concretos...
2. Entrego con `entregable --flujo resumen-semanal`.
3. Cierro avisando al cliente en dos líneas.
MD
```

- `--gatillo`: `horario` (un cron), `drive` (mirar carpetas, lleva
  `--carpetas`), `pedido` (sin automatización: arranca cuando el cliente lo
  pide; sin `--cron`).
- `--para-cliente` y `--detalle` los lee EL CLIENTE: sin jerga, sin "cron",
  sin ids.
- `--conexiones` es OBLIGATORIO. Si el trabajo no toca ninguna, poné
  `--conexiones ninguna`. Si toca una que no está conectada, declarala igual:
  así el portal la muestra en ámbar con el botón para conectarla, en vez de
  fingir que el flujo está completo.
  **El script chequea cuáles de esas conexiones están puestas de verdad** y, si
  falta alguna, te devuelve `conexiones_faltan` y un `decile_al_cliente`. Eso no
  es decorativo: contale al cliente, en la misma respuesta en que le decís que
  creaste el flujo, que hoy no puede trabajar y qué se pierde hasta que se
  conecte. "Todos los lunes a las 9 te llega el resumen" a secas, con la casilla
  sin conectar, es una promesa falsa.
- El cuerpo (stdin) son TUS instrucciones para cuando trabajes el flujo:
  pasos, con qué skills, cuándo crear tickets, qué avisar. Sé concreto — tu yo
  de mañana lo va a seguir al pie de la letra. **Máximo 7 pasos y 320
  caracteres cada uno**: el script rechaza lo que pase de ahí. No es capricho:
  ese texto lo lee el cliente en el portal. Todo el detalle fino va a
  `## Notas técnicas`, que el portal recorta y no tiene tope.

## Reglas que el script hace cumplir

- Frecuencia mínima: cada 5 minutos. No pidas más.
- El cron avisa a la nada (`--deliver local`) a propósito: el que le habla al
  cliente sos VOS, siguiendo el cuerpo del flujo.
- Un flujo existente no se recrea: editá su FLUJO.md directamente (podés — es
  tuyo), anotando al final qué cambiaste y cuándo.

## Cuando trabajás un flujo

Abrí su FLUJO.md y seguilo tal cual. Cada unidad de trabajo real (una
entrevista, un resumen) = **un ticket** en el tablero, y sus entregables van
con `entregable --flujo <slug>` para que caigan en la carpeta del flujo.

**Una corrida que no pudo hacer su trabajo SIEMPRE deja rastro visible.** El
silencio está reservado para "lo trabajé y no había nada nuevo". Si no pudiste
—falta una conexión, venció una credencial, no tenés una herramienta— dejá un
**ticket en el tablero** diciendo qué falta y qué se pierde mientras tanto, y
pedí lo que falte con la skill `capacidad`. Nunca te quedes callado: el cliente
lee el silencio de un flujo como "no hubo novedades", y con eso toma decisiones.
Un flujo semanal de precios que corre sin la casilla conectada y se calla le
hace creer que los proveedores no cambiaron nada.

(Esto vale para CUALQUIER flujo, incluso los creados antes de esta regla: los
gatillos viejos traen un prompt que solo hablaba del silencio. Para ponerle el
texto nuevo a uno viejo: `hermes cron edit <job> --prompt="…"`.)

## Preferencias globales del cliente

Si existe `flujos/PREFERENCIAS.md`, leelo antes de trabajar CUALQUIER flujo:
son reglas del cliente que aplican a todos ("sin emojis", "frases cortas").
Cuando el cliente pida un cambio que aplique a todos sus flujos, la regla va
ahí (crealo si no existe), con fecha. Manda sobre lo que diga cada FLUJO.md.

## El cuerpo lo lee el cliente

El portal muestra el cuerpo del FLUJO.md en la página del flujo ("Cómo lo
trabaja tu agente"). Escribilo para los dos públicos a la vez: instrucciones
concretas para vos, en el idioma del cliente. **Jamás palabras de máquina**:
gatillo, cron, webhook, frontmatter, script, dispatcher. "Cuando me toca
revisar las carpetas" en vez de "cuando el gatillo dispara". Las skills entre
backticks están bien — son tus herramientas y al cliente le dan contexto.

## Las "Notas técnicas" son tuyas

Cerrá cada FLUJO.md con una sección `## Notas técnicas`: ahí van las skills
exactas, los flags (`entregable --flujo <slug>`) y cualquier precisión de
máquina. El portal recorta esa sección (y los comentarios `<!-- -->`) antes de
mostrarle el cuerpo al cliente: los pasos visibles quedan en su idioma, y vos
no perdés exactitud. Las herramientas se nombran AHÍ, no en los pasos.
