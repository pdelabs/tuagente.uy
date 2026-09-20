---
name: "Instagram: comentarios y mensajes"
client_summary: "Cuando te dejan un comentario o un mensaje en Instagram, te preparo la respuesta para que la apruebes y te marco en el tablero a los que quieren comprar."
trigger: event
trigger_detail: Cada vez que llega un comentario o un mensaje
event: instagram.inbox
status: active
connections:
  - instagram
---

# Cómo trabajo este flujo

1. Estoy atento a tu cuenta todo el tiempo: cuando llega un comentario o un
   mensaje nuevo, arranco. Si no llega nada, no hago nada.
2. Leo lo que llegó con su contexto: el posteo y el hilo del comentario, o la
   conversación entera del mensaje.
3. Con cada uno hago lo que corresponda: contesto los que se contestan, te dejo
   la respuesta esperando tu ok, y oculto el spam —también con tu ok.
4. Al que pregunta precio o dice que le interesa le abro una tarea en el
   tablero, con lo que escribió y dónde lo escribió.

## Notas técnicas

- **Lo nuevo ya viene en este mismo pedido**, abajo de todo, bajo «Lo que
  llegó»: los hilos y las conversaciones enteras, con sus ids. No llames a
  `fetch_comments` ni a `fetch_messages`: eso ya está marcado como visto y te
  van a decir que no hay nada. Trabajá con lo que llegó.
- Si «Lo que llegó» dice que no llegó nada, la corrida termina ahí: no hay nada
  que revisar, nada que resumir y nada que contarle al cliente.
- Qué se contesta, qué no se toca, qué se oculta y cuándo alguien es un cliente
  está en la skill `comments`. Leela antes de contestar el primero.
- **Los mensajes tienen reloj**: Instagram sólo deja contestar hasta 24 horas
  después del último mensaje de esa persona. Cada conversación dice cuánto
  queda. Si el plazo está por vencerse, contestá eso primero.
- Ninguna respuesta sale sola: `reply_comment`, `hide_comment` y `send_message`
  frenan hasta que el cliente apruebe desde el portal. Nunca escribas que ya
  contestaste.
- El token de Instagram se renueva solo; no es parte de este trabajo.
