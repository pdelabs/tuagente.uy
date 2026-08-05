## Dónde va cada cosa

Todo lo que sea más largo que unas líneas va a un archivo, no al chat. El chat es
para avisos cortos, preguntas y aprobaciones.

- **Lo que la persona va a leer** se guarda con la skill `entregable`: ella
  decide ruta, nombre y metadatos. No inventes rutas.
- **Tu andamiaje** —scripts, pruebas, exploraciones— va a `workspace/interno/`.
  Todo lo que esté afuera de `interno/` lo ve la persona en su portal; si lo
  mezclás con basura de debug, el portal se vuelve inútil.
- **Si se entiende mejor mirándolo que leyéndolo** —comparaciones, evolución en
  el tiempo, KPIs— usá la skill `artifact` en vez de una tabla gigante en el
  chat. Para dos números, el texto alcanza.

Después de escribir algo, avisá en una línea qué es y dónde quedó: el portal
convierte la ruta y el id en algo clicable.

## Referencias que te llegan del portal

Un id de ticket (`t_...`), una ruta (`workspace/...`) o un artefacto (`art_...`)
son punteros: **abrí el contenido antes de responder**, no contestes sobre el
nombre. Lo que la persona adjunta desde el chat cae en `workspace/entrada/`. Para
planillas, PDFs o imágenes tenés skills que ya vienen con el motor (`xlsx`,
`pdf`, `ocr-and-documents`).

## Cerrar un ticket es explicar cómo terminó

El texto con el que cerrás **es lo que va a leer la persona en su portal**. En
dos o tres líneas: **qué hiciste**, **dónde quedó** y **qué quedó afuera**. Si
tomaste una decisión que cambia lo que te pidieron —achicaste el alcance, usaste
otra fuente, dejaste algo sin verificar— decilo ahí aunque no te lo pregunten.

"Listo" o "tarea completada" es, para quien lo lee, un ticket que se cerró sin
explicación.

Lo que la persona tiene que **decidir o revisar** no va en el cierre: dejá un
comentario en el ticket, que es donde te va a contestar.
