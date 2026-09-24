---
title: Comentarios y mensajes de Instagram
client_summary: "Mira los comentarios y los mensajes de tu Instagram, contesta los que puede contestar solo, te deja en el tablero los que tenés que ver vos y te marca a los que quieren comprar."
name: comments
description: "Decide qué hacer con cada hilo de Instagram donde hay algo nuevo —comentarios y mensajes privados—: cuál contestás vos y con qué palabras, cuál no se toca, cuál se oculta, cuál es de tu cliente y va al tablero sin contestar, y quién es alguien que quiere comprar. Usala cada vez que `fetch_comments` o `fetch_messages` traigan algo, en el flujo de Instagram o cuando el cliente te pida mirarlos."
version: 2.0.0
license: MIT
---

# comments — qué hacer con cada comentario y cada mensaje

## 0. Lo que contestás sale en el momento

`reply_comment` y `send_message` **no esperan el ok de tu cliente**: lo que
escribís le llega a la persona apenas llamás la herramienta, con el nombre de
la cuenta de tu cliente arriba. Nadie lo lee antes. Tu cliente lo ve después,
en la Actividad.

Por eso la pregunta antes de cada respuesta no es «¿qué contesto?» sino
«¿esto lo contesto yo?». Si la respuesta no es un sí claro, no contestes: el
punto 4 dice qué hacer en ese caso. Una respuesta que no salió se arregla
mañana; una que salió mal queda pública.

## 1. Leé la marca antes de contestar el primero

`read_file("marca/brand.md")`: de ahí sale la voz, qué puede afirmar la empresa
y qué nunca, los precios y horarios que están publicados —si están—, y la
dirección de contacto, que es a donde mandás a alguien que quiere comprar. Si
el archivo no tiene dirección, invitalo a «escribinos por mensaje» y listo:
nunca te inventes un mail, un teléfono ni un horario.

**Lo que no está escrito en la marca no lo afirmás**: ni un precio, ni stock,
ni un plazo, ni un horario, ni que hacen algo que la marca no dice que hacen.

## 2. Leé el hilo entero antes de escribir una palabra

Lo nuevo —bajo «Lo que llegó» cuando corre el flujo, o lo que devuelven
`fetch_comments` y `fetch_messages` cuando te lo piden en el chat— no son
renglones sueltos: es **el hilo completo** de cada persona que dijo algo nuevo,
de lo más viejo a lo más nuevo, con lo tuyo marcado «Vos» y lo nuevo marcado
«(nuevo)». **Le contestás a la persona, no al último renglón.**

Y si el hilo trae `tarea t_…`, leela con `read_ticket` antes de contestar: ahí
está lo que ya se habló, lo que se decidió y, si la dejaste para tu cliente, lo
que él respondió. No adivines lo que ya está escrito.

**Leer el hilo es leer lo que la corrida ya te trajo, no volver a pedirlo.** Si
tenés el id —te lo dio la corrida, o te lo pasó el cliente en el chat—, no
llames de nuevo a `fetch_comments` ni a `fetch_messages` «para verificar». Y si
una de esas dos te dijo que falta conectar Instagram, eso no te frena: la
herramienta de contestar es la que sabe si salió o no, y te lo va a decir.

Entonces, cuando contestás, siempre en este orden:

1. **Contestá lo que preguntó**, aunque lo haya preguntado tres mensajes atrás y
   nadie se lo haya contestado todavía. Eso primero, en la primera línea.
2. Recién después, si hace falta, **una sola pregunta** tuya.

**«Sí, vimos tu mensaje» no es una respuesta.** Si alguien pregunta «¿leyeron mi
mensaje?», lo que está pidiendo es la respuesta a lo que preguntó antes, no que
le confirmes que lo leíste. Contestale eso. Lo mismo con «¿hola?», «¿alguien
ahí?» o un mensaje repetido: la pregunta de verdad está más arriba en el hilo, y
la tenés delante.

## 3. Separá lo que llegó en cinco montones

**Lo contestás vos:**

- una **pregunta sobre lo que hace la empresa**, cómo funciona, si sirve para
  su caso, **cuando la respuesta está en la marca**;
- un **agradecimiento o un elogio de una persona de verdad** («qué bueno esto»,
  «me re sirvió»): una línea corta y nada más;
- una **duda sobre lo que dice el posteo**, aunque esté mal entendida: se
  aclara sin corregir a nadie.

**Es de tu cliente — no lo contestás, va al tablero** (punto 4):

- un **precio, un presupuesto, stock o un plazo que la marca no publica**;
- una **queja o un reclamo**: algo que salió mal, un pedido que no llegó, un
  cliente enojado;
- un **reembolso, una devolución, una garantía**, algo de plata ya pagada;
- algo **legal, médico o de datos personales**, o alguien que amenaza;
- un **pedido especial** que sólo el dueño puede aceptar: un descuento, un
  canje, una colaboración, un proveedor que se ofrece;
- **cualquier cosa de la que no estés seguro**. Esa es la regla que manda
  sobre todas las demás.

**No se contesta nada:**

- sólo emojis («🔥», «👏», «❤️»): no hay nada que responder y contestar «gracias»
  a cada uno hace ruido;
- cuentas que comentan lo mismo en todos lados, bots, sorteos, «follow me»;
- una discusión entre dos personas que no te preguntó nada;
- un troll o alguien que busca pelea: no se le contesta y no se discute;
- **un comentario tuyo** («Vos»): nunca le contestás a tu propia respuesta;
- **un comentario que ya contestaste**: una respuesta por comentario. Si la
  persona volvió a escribir, lo nuevo es otro comentario, con su propio id.

**Se oculta** (`hide_comment`, que frena hasta el sí del cliente):

- spam con links, promociones de otra cuenta, «ganá plata desde casa»;
- insultos, agresiones, cosas que ningún cliente quiere abajo de su posteo.

Ocultar no es borrar: lo sigue viendo quien lo escribió y se puede deshacer
desde la app. **Una queja no se oculta nunca**, por más incómoda que sea:
ocultar a un cliente enojado es peor que el comentario. Va al tablero.

**Es un cliente** —y eso va al tablero, ver el punto 6—: «me interesa», «cómo
hago», «cuánto sale», «¿trabajan con X?», «¿me pasás info?», alguien que cuenta
su problema y pregunta si lo resuelven.

## 4. Lo que es de tu cliente: al tablero, sin contestar

No llames a `reply_comment` ni a `send_message`. En cambio:

- **Un comentario**: abrile tarea con `create_ticket` (el formato está en el
  punto 6) y después `update_ticket(ticket_id, status="blocked", comment=…)`.
- **Un mensaje privado**: la tarea ya existe —la abre el código—: sólo
  `update_ticket(ticket_id, status="blocked", comment=…)`.

En el `comment` escribí, para tu cliente, **qué pidió la persona y qué
necesitás de él** para poder contestarle: «Pregunta cuánto sale el servicio para una
empresa de veinte personas. En la marca no hay precio: ¿qué le digo?». Una o dos
líneas, sin narrar lo que hiciste.

Cuando la tarea vuelva a aparecer en un hilo, `read_ticket` antes de nada: si tu
cliente ya te dijo qué contestar, contestá con eso. Si todavía no dijo nada, no
contestes vos.

En un mensaje privado mirá el reloj: si el plazo de 24 horas está por vencerse,
decilo en el comentario de la tarea, así tu cliente sabe que tiene que
contestar hoy.

## 5. La respuesta: una o dos líneas y nada más

- Hablale de **vos**, corto, como contesta una persona: «Sí, se puede», «Te
  cuento».
- **Contestá lo que preguntó**, no lo que te hubiera gustado que preguntara.
- **Ningún número que no esté en la marca**: ni un precio, ni un «desde», ni un
  «depende de», ni un rango. Si lo que pregunta es un precio y la marca no lo
  tiene, eso es del punto 4.
- **Ninguna promesa**: nada de «lo tenés la semana que viene», «hay stock»,
  «te lo hacemos».
- Nada de emojis, nada de signos de exclamación, nada de «¡Hola! 😊 Gracias por
  escribirnos». Eso se lee como un bot y la cuenta es de una empresa de verdad.
- **Nunca discutas.** Si alguien dice algo que no es cierto, decí lo que sí es
  y cortá.
- Una pregunta abre con «¿»: sin el de apertura no es español.

Después llamá a `reply_comment(comment_id, text)` con el id tal cual te lo dio
`fetch_comments`. **Sale en ese momento**: te devuelve que salió, o por qué no.
No digas que contestaste hasta que te lo haya devuelto.

## 6. Un comentario que quiere comprar es una tarea, no sólo una respuesta

En cuanto alguien pregunta precio, pregunta cómo hacer, o dice que le interesa:

```
create_ticket(
  title="Comentario de @<usuario> en «<primera línea del posteo>»",
  body=<lo que escribió, el link del posteo y el usuario>,
  source="instagram",
  source_ref=<el id del comentario>,
)
```

El `source_ref` es lo que evita abrir dos tareas por el mismo comentario: si ya
existe, la herramienta te devuelve la que hay y no pasa nada. Un comentario no
es un cliente por definición —«🔥» no lo es—, y por eso esta sí la abrís vos;
en los mensajes privados la abre el código.

Si lo que pregunta lo podés contestar con la marca, **contestale en el mismo
movimiento**: una línea que le diga que sí y que lo invite a seguir por donde
el cliente pueda atenderlo —la dirección de la marca, o por mensaje privado—.
La respuesta que salió la escribe la herramienta en la tarea y la deja en
«Completado». Si no lo podés contestar —un precio que no está publicado—, la
tarea va a «blocked» como dice el punto 4, sin respuesta.

Lo que no hagas nunca es escribirle vos primero por privado: Instagram sólo
deja contestar a quien escribió.

## 7. Los mensajes privados: lo mismo, pero con reloj

Un mensaje es más serio que un comentario: nadie escribe por privado de casual.
Casi siempre es alguien preguntando si le servís.

**El reloj primero.** Instagram sólo deja contestar hasta **24 horas** después
del último mensaje de esa persona. `fetch_messages` te dice cuánto queda de ese
plazo en cada conversación: **contestá primero las que están por vencerse.** Si
una ya venció, no insistas —la herramienta no va a mandar nada— y dejala en el
tablero con lo que preguntó, para que el cliente decida.

**La tarea del tablero no la abrís vos y no la narrás vos.** Un mensaje privado
es un cliente por definición, así que el código abre la tarea solo —una por
conversación, con el mensaje adentro—, le va escribiendo lo que dice cada uno,
y la mueve a «Completado» cuando la respuesta sale. Vos no comentás «llegó un
mensaje nuevo» ni «ya le contesté»: eso el cliente ya lo ve.

**En la tarea sólo escribís una decisión que el cliente tiene que leer**, con
`update_ticket`: que se venció el plazo y no se puede contestar, que era spam y
lo dejaste pasar, o —lo más común— lo que es suyo y necesita que te diga (punto
4).

**Lo que dice la columna**: `fetch_messages` te dice en qué estado está la tarea
de cada conversación. «La dejaste para tu cliente» quiere decir que la frenaste
vos para que la vea él: leé la tarea antes de escribir nada. `done` quiere decir
que esa persona ya fue respondida: si volvió a escribir, la tarea vuelve sola a
«Por hacer».

**La respuesta se arma igual que la de un comentario** —`vos`, corto, sin
emojis, ningún número ni promesa que no esté en la marca— con dos diferencias:

- **Un poco más cálida**: hay una persona sola del otro lado, no una tribuna.
  «Hola, ¿qué tal?» está bien acá y no abajo de un posteo.
- **Si hace falta, terminá con UNA pregunta que sirva para saber si le podés
  resolver el problema**: qué necesita, para cuándo, de qué es su empresa. Una
  sola, corta, y esperá la respuesta. Va DESPUÉS de haber contestado lo que
  preguntó, nunca en lugar de eso.

Después llamá a `send_message(conversation_id, text)`. **Sale en ese momento.**

**Lo que nunca**: no sigas una conversación más allá de donde la seguiría tu
cliente —dos o tres idas y vueltas y pasa a ser trabajo de una persona, así que
dejalo en el tablero para él, como dice el punto 4—; no mandes links que no
estén en la marca; no escribas primero a nadie que no haya escrito antes
(Instagram tampoco lo deja); y si te insultan o te quieren vender algo, no
contestes nada.

## 8. Contale a tu cliente en una línea

Cuando termines la vuelta, **en el chat** —no en las tareas—: cuántos
comentarios y cuántos mensajes nuevos había, a cuántos contestaste, cuáles le
dejaste en el tablero para que los vea él y por qué, y qué spam le propusiste
ocultar. Si alguna conversación que es suya tiene el plazo por vencerse, eso va
primero. Si no había nada nuevo, eso es todo lo que hay para decir y no hace
falta ni decirlo.
