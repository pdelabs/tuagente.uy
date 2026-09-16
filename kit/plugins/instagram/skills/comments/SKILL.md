---
title: Comentarios de Instagram
client_summary: "Mira los comentarios de tus posteos, te deja la respuesta lista para aprobar y te marca en el tablero a los que quieren comprar."
name: comments
description: "Decide qué hacer con cada comentario nuevo de Instagram: cuál se contesta y con qué palabras, cuál no se toca, cuál se oculta, y cuál es alguien que quiere comprar y va al tablero como tarea. Usala cada vez que `fetch_comments` traiga algo, en el flujo de comentarios o cuando el cliente te pida mirarlos."
version: 1.0.0
license: MIT
---

# comments — qué hacer con cada comentario

## 1. Leé la marca antes de contestar el primero

`read_file("marca/brand.md")`: de ahí sale la voz, qué puede afirmar la empresa
y qué nunca, y —si está— la dirección de contacto, que es a donde mandás a
alguien que quiere comprar. Si el archivo no tiene dirección, invitalo a
«escribinos por mensaje» y listo: nunca te inventes un mail, un teléfono ni un
horario.

Una respuesta es pública y la lee cualquiera. Lo que escribas queda abajo del
posteo con el nombre del cliente arriba.

## 2. Separá los comentarios en cuatro montones

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

## 3. La respuesta: una o dos líneas y nada más

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

## 4. Un comentario que quiere comprar es una tarea, no sólo una respuesta

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
existe, la herramienta te devuelve la que hay y no pasa nada.

Y **contestale igual**, en el mismo movimiento: una línea que le diga que sí y
que lo invite a escribir a la dirección de la marca, donde se sigue la
conversación en serio. Instagram no nos deja leer los mensajes privados, así
que nunca le digas «te escribo por privado» ni «mandanos un DM».

## 5. Contale a tu cliente en una línea

Cuando termines la vuelta: cuántos comentarios nuevos había, cuántas respuestas
le dejaste esperando el sí, y a quién le abriste tarea. Si no había nada nuevo,
eso es todo lo que hay para decir y no hace falta ni decirlo.
