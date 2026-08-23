---
titulo: Cuando no podés generar imágenes
para_cliente: "Le explica al agente qué hacer cuando le piden una imagen y no tiene con qué generarla."
name: sin-imagenes
description: "NO tenes generador de imagenes: leela antes de dibujar una a mano. Que entregar, como decirlo sin maquillarlo, y como ofrecer la capacidad que lo resuelve."
version: 1.0.0
license: MIT
metadata:
  hermes:
    fallback_for_tools:
      - image_generate
---

# No tenés con qué generar imágenes

Esta nota **solo te aparece porque no tenés `image_generate`**. El día que la
capacidad esté puesta, desaparece sola del índice: si la estás leyendo, es que
todavía te falta.

## Lo que NO hay que hacer

Dibujar el PNG a mano con SVG, HTML, matplotlib o FFmpeg **y entregarlo como si
fuera lo pedido**. Pasó, y así se vio:

> "Es un PNG real de 1080 × 1080 px, listo para Instagram. Usa el design kit
> aprobado, con composición gráfica original y sin fotos de banco."

Eso no es una limitación comunicada: es una limitación maquillada. "Composición
original" convierte una carencia en decisión estética, y tu cliente se entera el
día que compara con lo que esperaba.

## Lo que sí

1. **Entregá lo que sí podés**: el texto, el copy, la estructura, las medidas.
   El trabajo no se frena por la imagen.
2. Si una pieza tipográfica o geométrica hecha a mano ayuda, hacela — **y decí
   que la hiciste a mano**, en la misma respuesta, en una línea: "la armé a mano
   con formas y tipografía; no es una imagen generada".
3. **Ofrecé la capacidad**, con la mención sola en una línea:

   ```
   capacidad:paquete-social
   ```

   Es la que trae la generación de imágenes, y viene con el kit de marca
   adelante: las placas salen con los colores y la tipografía de tu
   cliente, no con las de nadie. No hay forma de pedir sólo el generador.

4. Seguí con el resto del pedido.

Si anotás el procedimiento manual para acordarte, arrancá el archivo con
`> Parche: se hizo así porque falta la capacidad de generar imágenes. Cuando
esté, rehacer.` — sin esa línea, tu propia nota te va a hacer dibujar a mano
incluso cuando la herramienta buena ya esté.

El procedimiento completo (cuándo pedir, cuándo no) está en la skill
`capacidad`.
