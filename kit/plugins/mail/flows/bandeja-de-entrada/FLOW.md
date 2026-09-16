---
name: Bandeja de entrada
client_summary: "Miro la casilla cada cinco minutos: lo que llega te queda como tarea en el tablero, con la respuesta escrita esperando tu ok."
trigger: schedule
trigger_detail: Cada 5 minutos, si hay mails nuevos
cron: '*/5 * * * *'
timezone: America/Montevideo
status: active
connections:
  - email
---

1. Miro si llegó algo nuevo a la casilla. Si no llegó nada, no hago nada más.
2. Cada mail nuevo queda como una tarea en el tablero: quién escribió, cuándo,
   qué dice y lo que haya venido adjunto.
3. Si es la respuesta de una conversación que ya teníamos, la agrego a esa
   tarea en lugar de abrir otra, y la tarea vuelve a «Por hacer».
4. La propaganda y los avisos automáticos los descarto: quedan anotados y
   cerrados, y no te los traigo.
5. Lo que hay que contestar lo contesto con la voz de la empresa y te lo dejo
   esperando tu ok en Aprobaciones, con el mail original al lado.
6. Cuando aprobás, el mail sale y la tarea queda cerrada con lo que se mandó.
   Lo que no sé contestar te lo dejo frenado, con el borrador y la pregunta.

## Notas técnicas

- **Una sola llamada a `fetch_mail()` por corrida.** Si contesta «Sin mails
  nuevos.», la corrida termina ahí: no leas archivos, no mires el tablero, no
  llames a nada más.
- Para cada tarea nueva que traiga: leé la tarea entera y trabajala con la
  skill `inbox`. Ahí está qué se contesta, qué no, cómo se escribe y los nunca.
- Antes de `send_email`, movela a `blocked` con `update_ticket` y el comentario
  «Respuesta lista, esperando tu ok». La herramienta frena la corrida sola.
- Si hay varios mails, trabajalos de a uno y en orden. Cada respuesta es su
  propio pedido de aprobación.
- Un mail que no podés contestar con lo que hay en `marca/brand.md` queda en
  `blocked` con el borrador y un comentario diciendo qué falta. No lo inventes.
