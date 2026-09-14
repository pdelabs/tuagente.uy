---
title: Posteos para Instagram
client_summary: "Escribe el posteo del día con tu voz, le hace la imagen con tus colores y te lo deja listo para revisar."
name: post
description: "Escribe un posteo de Instagram con la voz de la marca y le genera la imagen: lee marca/brand.md, arma el pie con la formula (gancho, una idea, un solo pedido, hasta 5 hashtags), genera la pieza con generate_image, la MIRA contra una lista de cinco puntos y la guarda con save_post. Usala cada vez que haya que dejar un posteo, un pie de foto o contenido para Instagram."
version: 1.0.0
license: MIT
---

# post — el posteo del día

## 1. Leé la marca antes de escribir nada

`read_file("marca/brand.md")`. Ahí está de quién es la voz, qué colores y qué
tipografía usa, qué puede afirmar y qué nunca. Un posteo escrito sin eso suena
igual al de cualquier otra empresa, que es exactamente lo que el cliente no
quiere pagar.

Si el archivo no está, escribí igual y avisale en una línea que va a sonar
genérico y que con dos o tres datos de su marca deja de sonar así.

## 2. Elegí una idea que no repita la de ayer

`list_files("posteos")` te muestra lo que ya salió. Mirá los últimos cinco y
elegí otra cosa: otro trabajo, otra punta del mismo tema, otro pilar de los que
liste la marca. Dos posteos parecidos seguidos se leen como un agente que no
tiene nada nuevo para decir.

## 3. Escribí el pie

La fórmula, en este orden:

- **Gancho**: una línea, la frase más fuerte del posteo. Es lo único que se ve
  antes del «más», así que no la gastes saludando ni describiendo la imagen.
- **Dos a cuatro líneas cortas** que agreguen lo que la imagen no dice.
  Concretas, una idea por línea.
- **Cierre con un solo pedido.** Guardá *y* comentá *y* escribinos es no pedir
  nada.
- **Hasta 5 hashtags**, que van aparte y no adentro del pie.

Y cómo suena:

- Hablale de `vos`, con frases cortas y registro hablado.
- Nombrá el trabajo, no la tecnología: «los turnos que perdés de noche», no el
  nombre de una integración.
- **Sólo afirmaciones verificables.** Si un dato, un precio o una tendencia no
  está en la marca, no entra. Nada de números inventados, clientes inventados
  ni urgencia inventada.
- Nada de palabras infladas (revolucionario, potenciá, el futuro es hoy), ni
  emojis, ni signos de exclamación en el gancho.
- Cuando muestres lo que el agente hace, mostrá también lo que **nunca** hace.
  Es lo que hace creíble la promesa.

Escribí también el **texto alternativo**: qué se ve en la imagen, en una
oración, para quien no la ve.

## 4. Hacé la imagen

Armá el brief con los colores de la marca y la idea del posteo, y enumerá
**palabra por palabra** el único texto que puede aparecer en la pieza. Pedile
que no agregue ningún otro: ni fechas, ni dominios, ni logos ni la marca en una
esquina, ni subtítulos en inglés, ni marcas de agua, ni códigos de color
dibujados. Todo en español, con sus tildes,
y con aire arriba y abajo: Instagram recorta los bordes de una pieza vertical.

`generate_image(prompt, format)` con el mismo formato que va a llevar el
posteo: `feed` para el vertical de siempre, `story` para una historia.

## 5. Mirala. Siempre

La herramienta te devuelve la imagen y la ves. Recorrela contra estos cinco
puntos:

1. **Se lee**: el texto entra, no se corta y no se pisa con el fondo.
2. **Es de la marca**: los colores y el aire son los de `brand.md`.
3. **No tiene texto que no pediste.** Es la falla más común y la más fácil de
   pasar por alto, porque el texto de más suele estar bien escrito.
4. **No hay palabras rotas.** Mirá adentro de los dibujos, no sólo los
   titulares: ahí es donde el modelo escribe mal el español.
5. **El formato es el que pediste.**

Si falla algo, generá **una vez más** con la corrección adentro del prompt.
Si a la segunda sigue mal, dejale el pie en el chat sin guardar el posteo —no
se guarda sin imagen— y decí en una línea qué no pudiste resolver: un pie bueno
sirve, y guardarte lo que está bien porque una parte falló deja al cliente con
nada.

## 6. Guardalo

`save_post(slug, caption, alt, hashtags, format, images)`. La herramienta pone
la carpeta, los nombres y la fecha; vos ponés las palabras. Es uno por día.
