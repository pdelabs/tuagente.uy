---
name: "Instagram: comentarios y mensajes"
client_summary: "Miro lo que te dejan en Instagram —comentarios y mensajes—, te dejo las respuestas para que las apruebes y te marco en el tablero a los que quieren comprar."
trigger: schedule
trigger_detail: Cada 15 minutos, si hay algo nuevo
cron: '*/15 * * * *'
status: active
connections:
  - instagram
---

# Cómo trabajo este flujo

1. Reviso si el token de Instagram está por vencer y lo renuevo si hace falta.
2. Miro los comentarios nuevos de tus últimos posteos.
3. Miro los mensajes privados nuevos. Si no hay ni comentarios ni mensajes, acá
   termina.
4. Con cada uno hago lo que corresponda: contesto los que se contestan, te dejo
   la respuesta esperando tu ok, y oculto el spam —también con tu ok.
5. Al que pregunta precio o dice que le interesa le abro una tarea en el
   tablero, con lo que escribió y dónde lo escribió.

## Notas técnicas

- El orden es `refresh_if_due()`, `fetch_comments()` y `fetch_messages()`. Si
  las dos últimas dicen que no hay nada nuevo, la corrida termina ahí: no hay
  nada que revisar, nada que resumir y nada que contarle al cliente.
- Qué se contesta, qué no se toca, qué se oculta y cuándo alguien es un cliente
  está en la skill `comments`. Leela antes de contestar el primero.
- **Los mensajes tienen reloj**: Instagram sólo deja contestar hasta 24 horas
  después del último mensaje de esa persona. `fetch_messages` te dice cuánto
  queda. Si el plazo está por vencerse, contestá eso primero.
- Ninguna respuesta sale sola: `reply_comment`, `hide_comment` y `send_message`
  frenan hasta que el cliente apruebe desde el portal. Nunca escribas que ya
  contestaste.
- Si falta la conexión, la herramienta te lo dice en una línea. Eso es todo: no
  lo intentes por otro lado.
