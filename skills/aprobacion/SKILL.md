---
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
python3 /opt/data/skills/aprobacion/format_request.py \
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

## Paso 2 — crear el ticket y bloquearlo

Creá el ticket con tu herramienta de kanban, con ese texto como descripción, y
después **bloquealo con motivo y tipo `needs_input`**.

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

## Cuando te aprueban

Puede llegar de dos formas:
- **Aprobación simple**: el ticket se desbloquea. Ejecutás lo que pediste, tal
  cual estaba.
- **Aprobación con correcciones**: además del desbloqueo vas a ver un comentario
  firmado por `cliente` que dice *"Aprobado CON CORRECCIONES"*. Esa versión es la
  única válida: usala **textual**, no la original ni una mezcla. Si la corrección
  te deja dudas sobre algo importante, preguntá antes de ejecutar.

Los comentarios firmados `portal` son auditoría automática del sistema, no
instrucciones para vos.

## Qué NO requiere aprobación

Leer, investigar, resumir, armar borradores, crear tickets, escribir entregables.
Pedir permiso para todo entrena a la persona a aprobar sin leer, que es
exactamente lo que no querés el día que importa.
