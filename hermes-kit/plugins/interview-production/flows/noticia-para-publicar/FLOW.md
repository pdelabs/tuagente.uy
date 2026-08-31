---
name: Noticia lista para publicar
client_summary: "Me pasás un link, un archivo o el texto del artículo y te devuelvo la noticia lista: titular y copy."
trigger_type: request
trigger_detail: Cada vez que me pasás un link, un archivo o el texto de una nota
skills: news-copy,deliverable,approval
results: entregables/noticia-para-publicar
status: active
---

# Cómo trabajo este flujo

1. **Abro el ticket de esa noticia** —"Noticia <tema>"— antes de leer nada: ahí adentro va el borrador, el pedido del sí y el cierre, y ahí lo seguís en el tablero.
2. Si me pasás un link, leo el artículo desde ahí. Si me pasás un archivo o pegás el texto, trabajo con eso. Audio y video no entran por acá: eso va por entrevistas.
3. Redacto la noticia con tu formato —titular corto y copy breve, con la fuente citada— y la dejo como entregable, con las sugerencias de imágenes.
4. Te pido el sí **en ese mismo ticket** antes de que se publique o se mande a ningún lado.
5. **Cuando me decís que sí**, cierro el ticket con el titular y la referencia a la noticia, y te aviso por tu canal que quedó pronta y dónde encontrarla. Hasta ese sí el ticket queda bloqueado, esperándote.

## Notas técnicas

- **El ticket lo abre el script, no la memoria.** `open_news_ticket.py` lo crea
  con una clave calculada sobre la fuente —la URL normalizada, o el contenido si
  es un archivo o un texto pegado—, así que la misma nota dos veces es un solo
  ticket y no dos tarjetas. Si ya se está trabajando adentro de un ticket, no
  abre ninguno. Y si el tablero no lo deja abrirlo, la noticia no se escribe: se
  dice y se para, porque sin ticket no hay dónde pedir el sí ni queda rastro.
  Medido el 30/8: en una corrida sin el script el entregable salió correcto y el
  tablero no se enteró de nada.
- **El ticket queda bloqueado hasta el sí, y no se termina antes.** Un ticket
  terminado sale de la cola de Aprobaciones y el cliente se queda sin el botón:
  el pedido no se puede rescatar. Medido el 30/8, en la primera corrida que sí
  abrió el ticket: el borrador quedó bien y el pedido de aprobación se cerró
  solo, en el mismo turno que lo pidió.
- **La entrada es link, archivo o texto.** Fue una corrección del cliente, no un
  supuesto nuestro: un audio o un video no se procesan por acá, se dicen en una
  línea y se derivan.
- **Si el sitio no abre, la nota no se reconstruye de memoria.** Se dice que no
  se pudo abrir y se pide el texto. Un portal detrás de Cloudflare contesta 403
  a cualquier agente y eso no es una falla del día: es una limitación conocida.
- **Nada se publica ni se manda sin el sí.** El entregable cierra siempre
  diciendo que no se publicó ni se envió a nadie, y eso es literal.
- **Las cifras y los nombres son los del material.** Redondear "para que quede
  mejor" o agregar un cargo que la nota no dice es inventar con el nombre del
  medio atrás.
- **El aviso va por el canal que el cliente tenga emparejado.** Si no emparejó
  ninguno, el flujo no promete el aviso: lo dice y deja la noticia igual.
