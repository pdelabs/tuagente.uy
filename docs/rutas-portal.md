# Rutas del portal — el contrato de las URLs

Qué forma tiene cada dirección del portal del cliente, para que **el agente
pueda citarlas** cuando avisa por Telegram o por correo, y para que el cliente
pueda compartirlas, volver con el botón atrás y refrescar sin perder de vista lo
que estaba mirando.

Esto **no cambia nada del kit ni del SOUL**: es el contrato, escrito. Si algún
día se le enseña al agente a mandar links, sale de acá.

## La base

El origen lo pone el magic link del cliente — normalmente
`https://app.tuagente.uy`. Los **caminos son iguales para todos los clientes**;
lo único propio de cada uno es el dominio y lo que hay adentro.

**La credencial NUNCA va en el link.** Viaja en el hash del magic link
(`/app#endpoint=…&adapter=…&key=…`), queda en el localStorage del browser y el
portal la borra de la barra de direcciones apenas la guarda. Ningún link de los
de abajo lleva hash: son todos seguros de compartir **dentro de la empresa**
(quien los abra necesita su propia sesión; si no la tiene ve la pantalla de
entrada, que le avisa que el link lleva a algo de su portal y que apenas entre
lo dejamos ahí).

## Las pestañas

| Pestaña | URL |
|---|---|
| Inicio | `/app/inicio` |
| Chat | `/app/chat` |
| Flujos | `/app/flujos` |
| Tablero | `/app/pipeline` |
| Aprobaciones | `/app/aprobaciones` |
| Entregas | `/app/artefactos` |
| Conexiones | `/app/conexiones` |
| Actividad | `/app/actividad` |
| Archivos | `/app/archivos` |
| Uso | `/app/uso` | **oculta** — redirige a `/app/inicio` |
| Habilidades | `/app/habilidades` |
| Tareas programadas | `/app/tareas` |

`/app` a secas redirige a `/app/inicio`.

**Uso está oculta desde el 16/8/2026** y no se puede citar: el total que muestra
sólo ve lo que pasa por litellm, y la generación de imágenes le pega directo al
proveedor. Medido ese día: la pantalla decía US$ 0,17 y OpenRouter había cobrado
US$ 1,52. Vuelve cuando el número salga de lo que el proveedor cobró. El
interruptor es `MODULOS_OCULTOS` en `app/app/layout.tsx`.

## El detalle

Todo lo que el cliente puede abrir tiene su propia dirección.

**QUÉ QUIERE DECIR "PROBADA" ACÁ.** La versión anterior de esta tabla decía que
cada fila estaba probada, y no era cierto: `?conexion=` inventaba un producto
con cualquier id, `/app/flujos/<slug>` inexistente contestaba "No pude hablar
con tu agente" y `?carpeta=interno` abría una carpeta con ocho archivos adentro
diciendo "Esta carpeta está vacía". El agente lee esta tabla para armar links:
una fila optimista es un link roto en la cara del cliente. Así que la columna
dice exactamente qué se miró.

- **abre** = se cargó en el navegador contra el agente del lab y mostró la cosa
  correcta.
- **id viejo** = se probó también con un id que no existe y avisa en criollo en
  vez de romperse.
- **SIN VERIFICAR** = puede andar perfecto; nadie lo miró. No lo cites en un
  aviso al cliente hasta que alguien lo pruebe y cambie esta celda.

Nadie probó todavía, para NINGUNA fila, las otras dos mitades de la promesa de
más abajo: que "atrás" cierre el detalle y que refrescar restaure la misma
vista. Están implementadas (`rutas.tsx`) y no verificadas una por una.

| Qué | URL | Ejemplo | Probado (12/8, lab) |
|---|---|---|---|
| Una conversación | `/app/chat?conversacion=<id de sesión>` | `/app/chat?conversacion=api_1786585222_d45ee238` | abre |
| Una tarea del tablero | `/app/pipeline?tarea=<id de ticket>` | `/app/pipeline?tarea=t_b1fb02ad` | abre |
| Un pedido de aprobación | `/app/aprobaciones?pedido=<id de ticket>` | `/app/aprobaciones?pedido=t_36dbdd23` | abre · id viejo |
| Una visualización | `/app/artefactos?visualizacion=<id>` | `/app/artefactos?visualizacion=art_1786584384_ventas-por-sucursal` | abre |
| Una carpeta | `/app/archivos?carpeta=<ruta>` | `/app/archivos?carpeta=interno` | abre |
| Un archivo | `/app/archivos?archivo=<ruta>` | `/app/archivos?archivo=workspace/entregables/2026-08-12-placa-instagram-bolsas-de-residuo-20-de-descuento.md` | abre (con prefijo `workspace/`) |
| Un flujo | `/app/flujos/<slug>` | `/app/flujos/revision-precios-proveedores` | abre · id viejo |
| Una conexión | `/app/conexiones?conexion=<id del catálogo>` | `/app/conexiones?conexion=telegram` | abre · id viejo |
| Una habilidad del sistema | `/app/habilidades?habilidad=<nombre>` | `/app/habilidades?habilidad=aprobacion` | abre · id viejo |
| Una tarea programada | `/app/tareas?programada=<id de cron>` | `/app/tareas?programada=bb8485784d90` | abre |

Lo que quedó **SIN VERIFICAR** dentro de filas que sí se probaron:

- `?carpeta=entregables` (se probó `interno`, que es el caso difícil, no este).
- `?archivo=` **sin** el prefijo `workspace/`.
- `?habilidad=<una propia>` abriendo el editor (sí se probó que el botón Editar
  aparece solo donde el adapter puede editar; el link directo al editor, no).
- `?p=` del chat, que no es un detalle pero cuenta como llegar con intención.

Reglas de las rutas de archivo:

- La ruta va **relativa al workspace**, sin el prefijo `workspace/` ni
  `/opt/data/workspace/`: `entregables/informe.md`, no
  `workspace/entregables/informe.md`.
- Las barras van sin escapar (se leen mejor); los espacios y las tildes sí se
  escapan (`%20`, `%C3%A9`).
- El prefijo `workspace/` (o `/opt/data/workspace/`) **se acepta igual**: es
  como el agente escribe sus rutas, y el portal lo saca solo. O sea que
  `?archivo=workspace/entregables/informe.md` y
  `?archivo=entregables/informe.md` abren lo mismo.
- `?archivo=` solo alcanza: el portal deduce la carpeta y la deja abierta atrás
  del visor. `?carpeta=` extra sirve para dejarlo parado en otro lado.
- **Un link a `interno/` (o a un script suelto) prende solo el interruptor de lo
  técnico.** Archivos esconde el andamiaje del agente por defecto; sin esto,
  `?carpeta=interno` abría la carpeta y decía "Esta carpeta está vacía" con ocho
  archivos adentro, porque el filtro se comía justo lo que el link venía a
  mostrar.

`?habilidad=` sirve para **todas** las habilidades, pero no todas hacen lo
mismo, y el aviso importa a la hora de escribir el mensaje que acompaña al link:

- Una **propia** (las que armamos para ese cliente) abre su texto, editable.
- Una **del sistema** (las del kit y las del motor) despliega el cajón "Comunes
  del sistema", la trae a la vista y la resalta con su nombre y su resumen. No
  abre un editor porque no hay qué editar: el adapter solo sirve el contenido de
  las editables. Un link a una de estas es "mirá cuál es", no "editala".
- Un nombre que no existe muestra un aviso y deja la lista completa a la vista,
  en vez de no hacer nada.

**"La trae a la vista" recién es cierto desde el 12/8 (segunda pasada).** Antes
la promesa de esta tabla era falsa justo para el caso más común: con
`?habilidad=aprobacion` la fila resaltada quedaba a 823 px, la ventana medía
813, y `scrollY` se quedaba en **0** — el cliente aterrizaba arriba de todo y no
veía nada resaltado. Tres causas, las tres arregladas en `traerALaVista()`
(`lib/rutas.tsx`), que ahora usan también Conexiones y Aprobaciones:

- **el scroll suave no llegaba nunca** (con `behavior: "instant"` el mismo
  `scrollIntoView` mueve la página a 442): el portal trae
  `html { scroll-behavior: smooth }` global en `app/globals.css`, así que
  cualquier `scrollIntoView` sin `behavior: "instant"` es asincrónico; y encima
  la animación se traga cuando arriba hay un contenedor con `overflow-hidden`
  —la tarjeta que agrupa las habilidades del sistema— y la página todavía se
  está acomodando;
- **el `setTimeout` de 150 ms era una apuesta**: el elemento aparece cuando
  contesta el adapter, y contra el agente de un cliente por internet eso tarda
  más que contra el lab. Ahora se espera hasta que esté, con tope;
- **y esa espera va con `setTimeout`, NO con `requestAnimationFrame`.** Este
  párrafo decía lo contrario y era una invitación a romperlo: en una pestaña de
  fondo el navegador no dibuja cuadros, así que un poll con rAF no corre ni una
  sola vez — medido, `document.hidden` en true y `scrollY` en 0 para siempre. Un
  link que el cliente abre en una pestaña nueva es el caso normal, no el raro.
  Los timers ahí van a ~1 por segundo, que para esto alcanza. El porqué está
  también en el comentario de `traerALaVista()`: si alguien lo "arregla" de
  vuelta a rAF, rompe justo el caso común.

`?conexion=` dice **tres cosas distintas** según lo que encuentre, y ninguna
afirma de más. Antes decía siempre la misma —"Venís a conectar X. Es la que te
falta para uno de tus flujos"— y con eso inventaba dos cosas: el producto (con
`?conexion=noexiste-xyz` anunciaba "Venís a conectar noexiste xyz") y la
necesidad (con cualquier id real, aunque la que faltara fuera otra).

- **Existe y está sin conectar** → "Venís a conectar X", y sólo si el catálogo
  la marca `requerida` agrega que le falta a uno de tus trabajos.
- **Existe y ya está conectada** → lo dice, en verde, y la marca abajo.
- **No está en el catálogo** → aviso de link viejo con el id entre comillas y la
  lista completa abajo. El id crudo NUNCA se humaniza para hacerlo pasar por un
  nombre de producto.

`/app/flujos/<slug>` que no existe hace lo mismo: aviso en criollo y la lista de
los flujos que el agente sí tiene. Antes contestaba "No pude hablar con tu
agente", que además de feo era mentira.

`?pedido=` **también trae la tarjeta a la vista** (mismo helper), desde el 12/8
de tarde. Antes no: medido en el lab, `scrollY` en 0 con la tarjeta arrancando a
1055 px y una ventana de 862 — la clienta abría el link del pedido que espera su
ok y aterrizaba mirando el pedido de otro, con su par Aprobar/Rechazar delante.
Los demás detalles no lo necesitan porque abren en un modal (`?tarea=`,
`?programada=`, `?visualizacion=`, `?archivo=`), que aparece centrado y con el
fondo trabado.

## `?pedido=` no se pone viejo por rechazarlo

Vale la pena decirlo acá porque cambia qué significa el link: **rechazar un
pedido no lo saca de Aprobaciones.** El ticket sigue bloqueado, la tarjeta se
queda con el "Le dijiste que no" adentro y ahí mismo aparece la respuesta del
agente. Recién al aprobar desaparece de la pestaña. O sea que un link a un
pedido que se está negociando **sigue sirviendo**, y el aviso de link viejo sólo
sale cuando de verdad se resolvió o el agente lo retiró. El porqué (el ticket
tiene un solo desbloqueo antes de morir en `triage`) está en `docs/PENDIENTES.md`.

**Con una excepción, y la elige el cliente**: al rechazar hay una casilla
—"Cerrar el pedido: esto no va más, no me lo vuelvas a proponer"— que manda
`{"definitivo": true}` y cierra el ticket (`done`) en la misma escritura que el
comentario. Ese sí saca el pedido de la pestaña, y a partir de ahí el link
muestra el aviso de link viejo, que es lo correcto. Volver a abrirlo es un
pedido nuevo, por el chat.

## Lo que el cliente ve

Los ids nunca se muestran: la pantalla siempre pone el **nombre humano** (el
título del ticket, el título de la visualización, el `titulo` del front-matter
del entregable, el nombre de la conversación). Un id en la URL es el precio de
poder linkear; no tiene por qué llegar a los ojos del cliente.

En cada detalle hay un botón discreto de **copiar el link** (un ícono de
cadenita, al lado de cerrar). Copia la dirección de la cosa, sin el hash.

## Cuándo conviene un link y cuándo no

- **En el chat del portal no hace falta.** El markdown del agente ya convierte
  `t_80ff7609`, `art_…` y las rutas de archivo en chips que abren la cosa ahí
  mismo. Un link crudo ahí es peor.
- **Afuera del portal sí** — Telegram, correo, un comentario que se lee desde el
  celular: ahí el link es la única forma de que "te dejé el informe" sea algo
  que se pueda abrir de un toque.
- **Un solo link por aviso**, el de la cosa concreta. Mandar la pestaña
  (`/app/artefactos`) en vez del entregable es hacerle buscar.

## Por qué query y no segmentos de path

El portal es estático: en el build, todas las pestañas salen como
`○ (Static)` y la única `ƒ (Dynamic, server-rendered on demand)` es
`/app/flujos/[slug]`. Un segmento de path por cada detalle multiplicaría esa
excepción y ataría el portal a tener un servidor Node. Con parámetros de
búsqueda, el detalle vive en una página que ya está prerenderizada: el mismo
HTML sirve `/app/pipeline` y `/app/pipeline?tarea=t_ab12`, y un link compartido
funciona igual servido por Vercel que por un directorio de archivos.

Tampoco se usa hash-routing (`/app#/tablero/t_ab12`) por una razón sola y
suficiente: **el hash es donde llega la credencial**. Pelear ese espacio con el
magic link era buscarse el problema.

La mecánica vive en `app/app/lib/rutas.tsx`: `history.pushState` /
`replaceState` nativos (Next 14.2 los parchea y mantiene su router al día) y un
`useSyncExternalStore` que escucha `popstate`. Cada pantalla **lee** de la URL —
no hay copia local del "qué está abierto"—, y eso es lo que hace que refrescar
restaure exactamente la misma vista.

## Un link viejo nunca cae en el vacío

Los links se ponen viejos solos: una aprobación se aprueba, una tarea se
archiva, un archivo se renombra. Cuando el id de la URL ya no existe, **todas**
las pantallas hacen lo mismo: un aviso en criollo arriba y la lista completa
abajo, que es donde el cliente puede seguir. Nunca un spinner eterno, nunca un
número de error, nunca una pantalla que no dice nada.

## Detalles de comportamiento

- Abrir algo **empuja** una entrada en el historial: "atrás" lo cierra,
  "adelante" lo vuelve a abrir.
- Cerrar con la X deshace esa entrada. Si el cliente **aterrizó** en el link
  compartido (no hay nada que deshacer), la X reescribe la URL a la pestaña en
  vez de sacarlo del portal.
- Tocar en el menú la pestaña en la que ya estás cierra el detalle abierto.
- Un link a algo concreto **saltea la bienvenida** de esa pestaña: quien llega
  por un link viene a ver una cosa, no a que le presenten el módulo.
