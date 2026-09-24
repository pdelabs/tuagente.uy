---
name: "Instagram: comentarios y mensajes"
client_summary: "Cuando te dejan un comentario o un mensaje en Instagram, contesto lo que puedo contestar yo, te dejo en el tablero lo que tenés que ver vos y te marco a los que quieren comprar."
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
3. Contesto lo que es fácil y seguro de contestar —dudas sobre lo que hacés,
   un agradecimiento—, con la voz de tu marca. Eso sale en el momento, y lo
   ves en la Actividad.
4. Lo que tenés que decidir vos —un precio que no está publicado, una queja,
   un reclamo, algo que no sé— no lo contesto: te lo dejo en el tablero.
5. El spam te propongo ocultarlo, y eso espera tu ok.
6. Al que pregunta precio o dice que le interesa le abro una tarea en el
   tablero, con lo que escribió y dónde lo escribió.

## Notas técnicas

- **Lo nuevo ya viene en este mismo pedido**, abajo de todo, bajo «Lo que
  llegó»: los hilos y las conversaciones enteras, con sus ids. No llames a
  `fetch_comments` ni a `fetch_messages`: eso ya está marcado como visto y te
  van a decir que no hay nada. Trabajá con lo que llegó.
- Si «Lo que llegó» dice que no llegó nada, la corrida termina ahí: no hay nada
  que revisar, nada que resumir y nada que contarle al cliente.
- Qué se contesta, qué no se toca, qué se oculta, qué es del cliente y cuándo
  alguien es un cliente está en la skill `comments`. Leela antes de contestar
  el primero.
- **`reply_comment` y `send_message` salen en el momento**, sin que el cliente
  los vea antes. Contestá sólo lo que la skill dice que es tuyo; ante la duda,
  no contestes y dejalo en el tablero. Una respuesta por comentario, y nunca a
  un comentario tuyo.
- `hide_comment` sí frena hasta que el cliente apruebe desde el portal.
- **Los mensajes tienen reloj**: Instagram sólo deja contestar hasta 24 horas
  después del último mensaje de esa persona. Cada conversación dice cuánto
  queda. Si el plazo está por vencerse, contestá eso primero.
- El token de Instagram se renueva solo; no es parte de este trabajo.
