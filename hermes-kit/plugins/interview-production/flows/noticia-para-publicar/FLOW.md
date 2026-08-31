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

1. Abro un ticket "Noticia <tema>" para que el trabajo se vea en el tablero.
2. Si me pasás un link, leo el artículo desde ahí. Si me pasás un archivo o pegás el texto, trabajo con eso. Audio y video no entran por acá: eso va por entrevistas.
3. Redacto la noticia con tu formato —titular corto y copy breve, con la fuente citada— y la dejo como entregable, con las sugerencias de imágenes.
4. Te pido el sí antes de que se publique o se mande a ningún lado.
5. Cierro el ticket con el titular y la referencia a la noticia, y te aviso por tu canal que quedó pronta y dónde encontrarla.

## Notas técnicas

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
