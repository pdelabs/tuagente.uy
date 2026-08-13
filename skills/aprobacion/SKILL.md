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
- **Rechazo**: el ticket **queda bloqueado** y el comentario `portal` dice el
  motivo. No se ejecuta nada.

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
