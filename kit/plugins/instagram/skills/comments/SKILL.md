---
title: Comentarios y mensajes de Instagram
client_summary: "Mira los comentarios y los mensajes de tu Instagram, te deja la respuesta lista para aprobar y te marca en el tablero a los que quieren comprar."
name: comments
description: "Decide qué hacer con cada hilo de Instagram donde hay algo nuevo —comentarios y mensajes privados—: cuál se contesta y con qué palabras, cuál no se toca, cuál se oculta, y quién es alguien que quiere comprar y va al tablero como tarea. Usala cada vez que `fetch_comments` o `fetch_messages` traigan algo, en el flujo de Instagram o cuando el cliente te pida mirarlos."
version: 1.3.0
license: MIT
---

# comments — qué hacer con cada comentario y cada mensaje

## 1. Leé la marca antes de contestar el primero

`read_file("marca/brand.md")`: de ahí sale la voz, qué puede afirmar la empresa
y qué nunca, y —si está— la dirección de contacto, que es a donde mandás a
alguien que quiere comprar. Si el archivo no tiene dirección, invitalo a
«escribinos por mensaje» y listo: nunca te inventes un mail, un teléfono ni un
horario.

Una respuesta es pública y la lee cualquiera. Lo que escribas queda abajo del
posteo con el nombre del cliente arriba.

## 2. Leé el hilo entero antes de escribir una palabra

Lo nuevo —bajo «Lo que llegó» cuando corre el flujo, o lo que devuelven
`fetch_comments` y `fetch_messages` cuando te lo piden en el chat— no son
renglones sueltos: es **el
hilo completo** de cada persona que dijo algo nuevo, de lo más viejo a lo más
nuevo, con lo tuyo marcado «Vos» y lo nuevo marcado «(nuevo)». **Le contestás a
la persona, no al último renglón.**

Y si el hilo trae `tarea t_…`, leela con `read_ticket` antes de contestar: ahí
está lo que ya se habló y lo que se decidió. No adivines lo que ya está escrito.

**Leer el hilo es leer lo que la corrida ya te trajo, no volver a pedirlo.** Si
tenés el id —te lo dio la corrida, o te lo pasó el cliente en el chat—,
contestá: no llames de nuevo a `fetch_comments` ni a `fetch_messages` «para
verificar». Y si una de esas dos te dijo que falta conectar Instagram, eso no te
frena para dejar la respuesta: la herramienta de contestar es la que sabe si
salió o no, y es la que te lo va a decir.

Entonces, siempre, en este orden:

1. **Contestá lo que preguntó**, aunque lo haya preguntado tres mensajes atrás y
   nadie se lo haya contestado todavía. Eso primero, en la primera línea.
2. Recién después, si hace falta, **una sola pregunta** tuya.

**«Sí, vimos tu mensaje» no es una respuesta.** Si alguien pregunta «¿leyeron mi
mensaje?», lo que está pidiendo es la respuesta a lo que preguntó antes, no que
le confirmes que lo leíste. Contestale eso. Lo mismo con «¿hola?», «¿alguien
ahí?» o un mensaje repetido: la pregunta de verdad está más arriba en el hilo, y
la tenés delante.

## 3. Separá los comentarios en cuatro montones

**Se contesta:**

- una **pregunta** sobre lo que hace la empresa, cómo funciona, cuánto sale,
  si sirve para su caso;
- un **agradecimiento o un elogio de una persona de verdad** («qué bueno esto»,
  «me re sirvió»): una línea corta y nada más;
- una **duda sobre lo que dice el posteo**, aunque esté mal entendida: se
  aclara sin corregir a nadie.

**No se contesta nada:**

- sólo emojis («🔥», «👏», «❤️»): no hay nada que responder y contestar «gracias»
  a cada uno hace ruido;
- cuentas que comentan lo mismo en todos lados, bots, sorteos, «follow me»;
- una discusión entre dos personas que no te preguntó nada;
- un insulto. No se le contesta y no se discute: se oculta si es agresivo, y si
  es una queja de un cliente real **eso sí se contesta**, ver abajo.

**Se oculta** (`hide_comment`, y también frena hasta el sí del cliente):

- spam con links, promociones de otra cuenta, «ganá plata desde casa»;
- insultos, agresiones, cosas que ningún cliente quiere abajo de su posteo.

Ocultar no es borrar: lo sigue viendo quien lo escribió y se puede deshacer
desde la app. **Una queja no se oculta nunca**, por más incómoda que sea:
ocultar a un cliente enojado es peor que el comentario.

**Es un cliente** —y eso va al tablero, ver el punto 4—: «me interesa», «cómo
hago», «cuánto sale», «¿trabajan con X?», «¿me pasás info?», alguien que cuenta
su problema y pregunta si lo resuelven.

## 4. La respuesta: una o dos líneas y nada más

- Hablale de **vos**, corto, como contesta una persona: «Sí, se puede», «Te
  cuento».
- **Contestá lo que preguntó**, no lo que te hubiera gustado que preguntara.
- **De precio, sólo el del diagnóstico** si la marca lo dice. Ningún otro número:
  ni «desde», ni «depende de», ni un rango inventado.
- **Ninguna promesa de plazo.** Nada de «lo tenés la semana que viene».
- Nada de emojis, nada de signos de exclamación, nada de «¡Hola! 😊 Gracias por
  escribirnos». Eso se lee como un bot y la cuenta es de una empresa de verdad.
- **Nunca discutas.** Si alguien dice algo que no es cierto, decí lo que sí es
  y cortá. Si el comentario es una queja, reconocé el problema y llevalo a
  privado: «Perdón, esto lo vemos. Escribinos y lo resolvemos».
- Una pregunta abre con «¿»: sin el de apertura no es español.

Después llamá a `reply_comment(comment_id, text, note)` con el id tal cual te
lo dio `fetch_comments`. **La respuesta no sale ahí**: queda esperando el sí de
tu cliente, y él la puede editar antes de aprobarla. En la nota decí quién
comentó, qué preguntó y qué le vas a contestar.

## 5. Un comentario que quiere comprar es una tarea, no sólo una respuesta

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

Después no le comentes nada más: cuando contestes, la respuesta que salió la
escribe la herramienta en la tarea y la deja en «Completado».

Y **contestale igual**, en el mismo movimiento: una línea que le diga que sí y
que lo invite a seguir por donde el cliente pueda atenderlo —la dirección de la
marca, o por mensaje privado, que ahora sí podés leer y contestar—. Lo que no
hagas nunca es escribirle vos primero por privado: Instagram sólo deja
contestar a quien escribió.

## 6. Los mensajes privados: lo mismo, pero con reloj

Un mensaje es más serio que un comentario: nadie escribe por privado de casual.
Casi siempre es alguien preguntando si le servís.

**El reloj primero.** Instagram sólo deja contestar hasta **24 horas** después
del último mensaje de esa persona. `fetch_messages` te dice cuánto queda de ese
plazo en cada conversación: **contestá primero las que están por vencerse.** Si
una ya venció, no insistas —la herramienta no va a mandar nada— y dejala en el
tablero con lo que preguntó, para que el cliente decida.

**La tarea del tablero no la abrís vos y no la escribís vos.** Un mensaje
privado es un cliente por definición, así que el código abre la tarea solo
—una por conversación, con el mensaje adentro—, le va escribiendo lo que dice
cada uno, y la mueve a «Completado» cuando la respuesta sale. Vos no comentás
«llegó un mensaje nuevo» ni «la respuesta está lista»: eso el cliente ya lo ve.

**En la tarea sólo escribís una decisión que el cliente tiene que leer**, con
`update_ticket`: que se venció el plazo y no se puede contestar, que era spam y
lo dejaste pasar, o una pregunta que no podés contestar y necesita que la vea
él.

**Lo que dice la columna, y lo que significa**: `fetch_messages` te dice en qué
estado está la tarea de cada conversación. **`blocked` con un pedido tuyo
pendiente = esperá, no prepares otra respuesta. `blocked` sin ningún pedido
pendiente —te lo dice la misma línea— = quedó frenada de antes: seguí y
contestá.** Y `done` quiere decir que esa persona ya fue respondida: si volvió
a escribir, la tarea vuelve sola a «Por hacer».

**Antes de escribir, leé el hilo entero y la tarea.** `fetch_messages` te da la
conversación completa y, si ya tiene tarea, su id: `read_ticket` te dice qué se
habló. Si quedó una pregunta sin contestar más arriba, **esa es la respuesta que
va primero**, aunque el último mensaje sea otra cosa.

**La respuesta se arma igual que la de un comentario** —`vos`, corto, sin
emojis, sin precio que no sea el del diagnóstico, sin fechas— con dos
diferencias:

- **Un poco más cálida**: hay una persona sola del otro lado, no una tribuna.
  «Hola, ¿qué tal?» está bien acá y no abajo de un posteo.
- **Terminá con UNA pregunta que sirva para saber si le podés resolver el
  problema**: de qué es la empresa, qué es lo que hoy le come el día, cuánta
  gente atiende. Una sola, corta, y esperá la respuesta. Va DESPUÉS de haber
  contestado lo que preguntó, nunca en lugar de eso.

Después llamá a `send_message(conversation_id, text, note)`. Tampoco sale sola:
queda esperando el sí del cliente, que la puede editar antes de aprobarla.

**Lo que nunca**: no sigas una conversación más allá de donde la seguiría tu
cliente —dos o tres idas y vueltas y pasa a ser trabajo de una persona, así que
dejalo en el tablero y decilo—; no mandes links que no estén en la marca; no
escribas primero a nadie que no haya escrito antes (Instagram tampoco lo deja);
y si te insultan o te quieren vender algo, no contestes nada.

## 7. Contale a tu cliente en una línea

Cuando termines la vuelta, **en el chat** —no en las tareas—: cuántos
comentarios y cuántos mensajes nuevos había, cuántas respuestas le dejaste
esperando el sí, y a quién le abriste tarea. Si alguna conversación tiene el
plazo por vencerse, eso va primero. Si no había nada nuevo, eso es todo lo que
hay para decir y no hace falta ni decirlo.
