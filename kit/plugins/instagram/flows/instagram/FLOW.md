---
name: Comentarios de Instagram
client_summary: "Miro los comentarios de tus posteos, te dejo las respuestas para que las apruebes y te marco en el tablero a los que quieren comprar."
trigger: schedule
trigger_detail: Cada 15 minutos, si hay comentarios nuevos
cron: '*/15 * * * *'
status: active
connections:
  - instagram
---

# Cómo trabajo este flujo

1. Reviso si el token de Instagram está por vencer y lo renuevo si hace falta.
2. Miro los comentarios nuevos de tus últimos posteos. Si no hay ninguno, acá
   termina.
3. Con cada uno hago lo que corresponda: contesto los que se contestan, te dejo
   la respuesta esperando tu ok, y oculto el spam —también con tu ok.
4. Al que pregunta precio o dice que le interesa le abro una tarea en el
   tablero, con lo que escribió y el link al posteo.

## Notas técnicas

- El primer paso es `refresh_if_due()` y el segundo `fetch_comments()`. Si
  `fetch_comments` dice «Sin comentarios nuevos», la corrida termina ahí: no
  hay nada que revisar, nada que resumir y nada que contarle al cliente.
- Qué se contesta, qué no se toca, qué se oculta y cuándo un comentario es un
  cliente está en la skill `comments`. Leela antes de contestar el primero.
- Ninguna respuesta sale sola: `reply_comment` y `hide_comment` frenan hasta que
  el cliente apruebe desde el portal. Nunca escribas que ya contestaste.
- Si falta la conexión, la herramienta te lo dice en una línea. Eso es todo:
  no lo intentes por otro lado.
