---
titulo: Piezas para redes
para_cliente: "Arma las placas de tus posteos —portadas, slides, datos y citas— con tus colores y tu tipografía."
name: post-image
description: "Genera la imagen de un posteo en PNG con los colores y la tipografia de la marca: portada, slide de carrusel, placa de dato y placa de cita, en 4:5 o 9:16. Usala cuando el posteo necesite una pieza con texto encima. Necesita el kit de marca. NO usa IA de imagen para nada que lleve palabras."
version: 1.0.0
license: MIT
---

# post-image — la placa del posteo, con la marca puesta

```bash
echo '{"plantilla":"portada","titulo":"Te pidieron dos sueldos de garantía",
       "bajada":"Hay otra forma.","pie":"Deslizá"}' \
| node /opt/kit/skills/post-image/scripts/render.mjs \
    --formato feed --out /opt/data/workspace/piezas/tapa.png
```

Devuelve JSON con el archivo, las medidas, el contraste medido y los avisos.

## Texto con palabras NO se genera con IA

Los modelos de imagen escriben mal. Una placa con una falta de ortografía en 96pt
es peor que no publicar, y la clienta la ve después que sus seguidores.

- **Lleva palabras** → esta skill. Determinista, con su tipografía real.
- **Es una foto o una ilustración** → ahí sí IA de imagen (capacidad `imagenes`),
  o una foto del cliente.
- **Las dos cosas** → la foto de fondo por IA, el texto por acá encima.

## Las cuatro plantillas

| Plantilla | Para qué | Campos |
|---|---|---|
| `portada` | tapa de carrusel, placa de feed | `titulo`, `bajada`, `pie` |
| `slide` | slide interna de carrusel | `numero`, `total`, `titulo`, `bajada` |
| `dato` | un número que golpea | `numero`, `titulo` |
| `cita` | testimonio, frase de cliente | `titulo`, `bajada` (quién lo dijo) |

Formatos: `feed` y `carrusel` salen 1080×1350 (4:5, la que más pantalla ocupa);
`historia` y `reel` salen 1080×1920 con **250 px de margen seguro** arriba y
abajo, que es donde Instagram pone sus botones.

Podés forzar `fondo` y `tinta` en el spec. Si no, el fondo es el color primario
de la marca y la tinta se elige sola.

## Lo que decide el script y vos no tenés que pensar

- **La tinta** sale de medir el contraste contra el fondo: blanco o negro, el que
  se lea. La pieza puede quedar fuera de estilo; ilegible, no.
- **El acento también se valida.** Si el acento de la marca no llega a 3:1 contra
  el fondo, lo reemplaza y te lo dice en `avisos`. Un coral claro sobre blanco da
  1,25:1 y el número grande desaparece.
- **Las tipografías** salen de `brand/fonts/`, que las bajó `brand-kit`.

**Leé los `avisos`.** Salen con `ok: true` a propósito: la pieza se generó, pero
hay algo que la clienta querría saber.

## Cuidado con los glifos raros

Muchos sitios sirven la tipografía **recortada**: sólo los caracteres que esa
página usaba. Los acentos y la ñ entran; una flecha `→`, un emoji o un símbolo
raro **puede salir como un cuadradito**. Si el título los necesita, miralo antes
de entregarlo, o escribilo con palabras.

## Después de generar

La pieza va al workspace y el cliente la ve en Archivos. Mostrasela **antes** de
publicar nada — junto con el pie que escribió `social-content`, porque se aprueban
juntos: el pie y la imagen son un solo posteo.
