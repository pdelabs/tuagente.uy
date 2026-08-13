---
titulo: Pedir aprobación
para_cliente: "Antes de una acción sensible, arma el pedido que ves en tu pestaña de Aprobaciones: qué quiere hacer y qué pasa si decís que sí."
name: aprobacion
description: "Arma una solicitud de aprobacion con formato estable: que queres hacer, que pasa si aprueba, que pasa si rechaza y el contenido a revisar. Usala antes de cualquier accion sensible (mandar un mail, gastar plata, publicar, borrar, contactar a alguien) y despues bloquea el ticket con la accion de bloquear."
version: 1.0.0
license: MIT
---

# aprobacion — pedir permiso de una manera que se entienda

Cuando necesites el OK de la persona antes de hacer algo (mandar un mail, gastar
plata, publicar, borrar, contactar a alguien), no dejes un ticket suelto en
"bloqueado" y esperes que adivine. Pedilo con estructura: **qué querés hacer,
qué pasa si aprueba, qué pasa si rechaza, y el contenido a revisar.**

## Paso 1 — armar el cuerpo con el script

```bash
python3 /opt/kit/skills/aprobacion/format_request.py \
  --que "Enviar el mail de respuesta a Acme SA" \
  --si-apruebo "Se envía el mail tal cual está abajo, desde la casilla comercial" \
  --si-rechazo "No se envía nada; espero tu corrección" \
  --por-que "Es el primer contacto con esa empresa" <<'MD'
Hola Juan,

...el borrador completo acá...
MD
```

El script imprime el markdown listo. **No escribas vos ese formato a mano**: si
cada solicitud se ve distinta, la persona tiene que leer todo de nuevo cada vez.

## Paso 2 — pedirlo EN EL TICKET QUE YA ESTÁS TRABAJANDO

**Si estás trabajando una tarea del tablero, el pedido va ahí. No crees otro
ticket.** Dejá el texto como comentario de ese mismo ticket y **bloquealo con
motivo y tipo `needs_input`**.

Un ticket aparte parece prolijo y no lo es: la persona termina con dos tarjetas
para un solo pedido, sin saber en cuál contestar, y la que dice "Aprobación: …"
queda suelta en el tablero para siempre. El pedido y el trabajo son la misma
cosa: el trabajo está frenado justamente porque falta el permiso.

Creá un ticket nuevo **solo** si el pedido no nació de una tarea del tablero
—por ejemplo, algo que salió de una conversación— y en ese caso también:
primero lo creás, y **después** lo bloqueás con la acción de bloquear.

**Regla dura, y no es un detalle:** un ticket que llega a bloqueado sin el evento
de bloqueo tipado (por ejemplo creándolo directamente con estado bloqueado) **se
desbloquea solo** en la siguiente pasada del dispatcher — y basta con que alguien
liste el tablero para dispararlo. Si eso pasa, tu pedido de permiso desaparece y
la tarea sigue como si estuviera autorizada. Bloqueá siempre con la acción de
bloquear, nunca creando el ticket ya bloqueado.

## Paso 3 — avisar

Decilo en el chat en una línea, con el id del ticket (el portal lo convierte en
un chip clicable) y qué estás esperando. Nada más: el detalle ya está en el
ticket.

Y decí **qué necesitás**, no cómo funciona el sistema por dentro: "necesito que
me confirmes el mail a Julio Cabrera antes de mandarlo" se entiende; "bloqueé la
tarea con needs_input" no le sirve a nadie.

## Cuando te aprueban

Son **dos señales juntas**: el ticket se desbloqueó **y** hay un comentario de
esa aprobación (`portal`: "Aprobado desde el portal"; o `cliente`, si te
corrigieron). Eso es tu cliente apretando Aprobar.

- **Aprobación simple**: desbloqueo + comentario `portal`. Ejecutás lo que
  pediste, tal cual estaba.
- **Aprobación con correcciones**: además vas a ver un comentario firmado por
  `cliente` que dice *"Aprobado CON CORRECCIONES"*. Esa versión es la única
  válida: usala **textual**, no la original ni una mezcla. Si la corrección te
  deja dudas sobre algo importante, preguntá antes de ejecutar.
- **Rechazo**: el ticket **queda bloqueado** y aparece un comentario firmado
  `cliente` que arranca con **"RECHAZADO POR TU CLIENTE"**. No se ejecuta nada.
  Como aprobar-con-corrección también deja un comentario `cliente`, lo que los separa
  es el ticket: **si sigue bloqueado, no hay permiso.**

  Y el rechazo **no termina la conversación**: si el motivo pide un cambio,
  contestás con la versión corregida **en un comentario de ese mismo ticket** y
  esperás —no lo desbloqueás, no abrís otro, y no lo volvés a bloquear porque ya
  lo está—. Si el motivo dice que eso no se hace, no lo volvés a proponer:
  contestás qué hacés en su lugar. Que el ticket se quede quieto en bloqueado es
  lo que te deja negociar sin gastar el único desbloqueo que tiene (lo de acá
  abajo).

- **Rechazo definitivo**: si tu cliente además cerró el pedido, el comentario lo
  dice —"este pedido no va más y el ticket queda terminado"— y el ticket aparece
  como terminado. No lo reabras ni armes uno parecido: esa conversación se
  terminó.

## Si el ticket se destrabó y NO hay aprobación

Pasa: alguien ordena el tablero, o el sistema destraba un bloqueo que quedó mal
puesto. Un ticket libre sin comentario de aprobación **no es permiso**.

Y ojo con el reflejo de volver a bloquear para pedirlo de nuevo: **es lo que
mata el pedido.** El segundo bloqueo por la misma causa lo saca de la cola de
aprobaciones —tu cliente ya no lo puede aprobar y no hay botón que lo rescate—.
En vez de eso:

1. Comentá en el ticket que quedó sin permiso y que no ejecutaste nada.
2. Avisale por el chat, en una línea, con el id.
3. **Cerrá el ticket como terminado**, diciendo que quedó sin ejecutar por falta
   de permiso. Cuando tu cliente conteste, se hace en un pedido nuevo, que
   arranca limpio.

## Una corrección aprobada es lo único que vale, y hay que anclarla

El portal **no puede** corregir el cuerpo del ticket (el CLI solo edita tareas ya
terminadas), así que la corrección entra como comentario `cliente` y el cuerpo
queda diciendo lo viejo. Eso es una bomba de tiempo: **todo lo que deriva una
tarea de otra lee título y cuerpo, nunca los comentarios.**

Pasó de verdad el 12/8/2026 y costó plata: la clienta aprobó *"pedile 20 no 8, y
para el jueves"*, el ticket se trabó dos veces por otra causa, el motor lo mandó
a `triage` y su auto-decomposer lo partió en dos tareas hijas **sacadas del
cuerpo original**. Las hijas decían 8. Diez minutos después el portal le pedía
aprobar, por tercera vez, un pedido de 8 —*"sin datos adicionales de cantidad"*—
y con el correo conectado al proveedor le llegaban 8 en vez de 20.

Entonces, apenas te aprueban con corrección:

1. **Anclala en el cuerpo de lo que la va a ejecutar.** Si ejecutás en el mismo
   ticket, alcanza con seguir el comentario. Si tenés que abrir otra tarea (o
   partir el trabajo), la versión corregida va **textual en el cuerpo de cada
   tarea nueva**, no como comentario: los comentarios no se heredan.
2. **Releé el hilo antes de ejecutar.** La última palabra es el último comentario
   `cliente`, no el cuerpo.
3. **Si una tarea contradice una corrección aprobada, no la trabajes ni vuelvas a
   pedir aprobación**: corregí su cuerpo con la versión aprobada y seguí.

## Si ya te aprobaron y aun así no podés: NO es un permiso nuevo

Es el error que dispara todo lo de arriba. La secuencia que rompe:

```
bloqueás pidiendo permiso → te aprueban → no podés ejecutar (falta el correo)
→ volvés a bloquear por lo mismo → 2 bloqueos de la misma causa
→ el motor lo manda a `triage` → el auto-decomposer lo parte → la corrección se pierde
```

El límite son **dos** bloqueos de la misma causa, está fijo en el motor
(`BLOCK_RECURRENCE_LIMIT = 2`) y de `triage` no lo saca ningún botón del portal.
O sea: **el segundo bloqueo por la misma causa es el que rompe el pedido.**

Lo que hay que hacer en su lugar, cuando lo que falta es una conexión o una
capacidad:

```bash
# 1. pedila UNA vez (la skill crea el pedido que el cliente ve)
#    → skill `capacidad`
# 2. el trabajo queda esperando ESE pedido, no esperando permiso:
hermes kanban link <id-del-pedido-de-conexion> <id-del-trabajo>
hermes kanban block <id-del-trabajo> "espera la conexión del correo" --kind=dependency
```

`--kind=dependency` es otra cosa que un bloqueo por falta de permiso: la tarea no
va a la cola de aprobaciones (no le pide nada a nadie), **no cuenta para el límite
de dos**, y el motor la vuelve a poner en marcha sola cuando el pedido del que
depende se completa. Es la única forma de esperar algo sin gastar uno de los dos
bloqueos.

Y no vuelvas a frenar por la misma causa: si te despiertan y todavía falta la
conexión, no bloquees de nuevo — dejá dicho en un comentario que seguís esperando
lo mismo.

**Desbloqueado y sin comentario no es aprobado.** Un ticket mal bloqueado se
destraba solo en la siguiente pasada del dispatcher (por eso se bloquea con la
acción de bloquear, nunca creándolo bloqueado); eso no es permiso de nadie.
Volvé a pedirlo.

**Y no te desbloquees vos nunca.** Desbloquear es la respuesta del cliente, no
un paso de tu trabajo: hacerlo es saltear la puerta que viniste a pedir.

## Qué NO requiere aprobación

Leer, investigar, resumir, armar borradores, crear tickets, escribir entregables.
Pedir permiso para todo entrena a la persona a aprobar sin leer, que es
exactamente lo que no querés el día que importa.
