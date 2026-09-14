---
name: Contenido diario para Instagram
client_summary: "Todos los días a las 9:00 te dejo listo un post de feed y dos stories para aprobar."
trigger_type: schedule
trigger_detail: Todos los días a las 9:00, hora de Uruguay
trigger_cron: "0 9 * * *"
skills: social-content,post-image,deliverable
results: entregables/contenido-instagram-diario
status: active
---

# Cómo trabajo este flujo

1. Reviso las entregas anteriores y elijo una idea distinta y útil para dueños de negocios.
2. Escribo un post para el feed y dos stories complementarias, con la voz de la marca y sin tecnicismos.
3. Uso solo afirmaciones verificables. Si una tendencia no se puede verificar, no la presento como tendencia.
4. Creo una imagen para el feed y una pieza vertical para cada story, con los colores y la tipografía del kit.
5. Reviso cada texto y cada imagen: ortografía, datos, legibilidad, márgenes de stories y que no aparezca nada inventado.
6. Dejo el post y las dos stories juntos, con el texto exacto y sus imágenes, para que los revises y apruebes. No publico nada por mi cuenta.
7. Anoto los temas usados para no repetir ideas en días seguidos.

## Notas técnicas

- Formatos: **feed 1:1** y las dos stories 9:16. El feed **no puede ser 4:5**:
  `image_generate` solo entiende `square`, `landscape` y `portrait`, así que
  pedir 4:5 devuelve una pieza 9:16 que después hay que descartar. Ya pasó.
- La imagen que devuelve la herramienta queda en el **caché del motor** y de ahí
  no la ve nadie. Copiala al workspace con un nombre que se entienda y adjuntala
  al entregable: recién ahí existe para el cliente.
- **Entregá lo que está bien aunque falte una pieza.** Si de tres salieron dos,
  esas dos se entregan y se explica qué pasó con la tercera. Guardarse las
  buenas porque una falló deja al cliente con nada.
- Sin `brand/referencias/`, pedile al cliente dos o tres posteos que le gusten
  antes de generar. El estilo se muestra, no se describe.
- Armá el paquete diario con `entregable --flujo contenido-instagram-diario`.
- Hasta 5 hashtags. Instagram bajó el tope de 30 a 5 en diciembre de 2025.
- Sin conexión de Instagram: el resultado queda para aprobación y no se publica solo.
