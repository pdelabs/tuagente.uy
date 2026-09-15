---
title: Posteos para Instagram
client_summary: "Escribe el posteo del día con tu voz, le hace el carrusel con tus colores y te lo deja listo para revisar."
name: post
description: "Escribe un posteo de Instagram con la voz de la marca y le genera el carrusel: lee marca/brand.md, arma el pie con la formula (gancho, una idea, un solo pedido, hasta 5 hashtags), genera de 3 a 6 slides con generate_image, MIRA cada una contra una lista de cinco puntos y las guarda con save_post. Usala cada vez que haya que dejar un posteo, un pie de foto o contenido para Instagram."
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
  emojis, ni signos de exclamación en el gancho. Una pregunta abre con «¿»:
  sin el de apertura no es español.
- Cuando muestres lo que el agente hace, mostrá también lo que **nunca** hace.
  Es lo que hace creíble la promesa.

De cada slide vas a escribir también su **texto alternativo**: qué se ve en
esa imagen, en una oración, para quien no la ve.

## 4. Hacé el carrusel

El posteo del día es un **carrusel de 3 a 6 slides**, y cada una dice una sola
cosa: la **1 es el gancho** —la frase más fuerte, grande, la que frena el
scroll—, **las del medio una idea cada una** —las del cuerpo del pie dichas con
otras palabras, una oración corta, nunca el pie copiado— y la **última cierra**
con el único pedido del posteo.

Se leen como un solo posteo, y como un solo feed con los de ayer, así que
**todas tienen el mismo sistema visual, que es uno solo y está escrito en
`marca/brand.md`**: el bloque que dice «The block to paste» va **palabra por
palabra al principio del brief de cada slide**, y recién después el texto de
esa slide y qué frase lleva el resaltado violeta, si alguna. Un brief que dice
«igual que la anterior» no dice nada: cada pedido empieza de cero y el modelo
no vio la slide anterior. No inventes un fondo, un color ni un personaje que
el bloque no nombre.

Y en cada brief enumerá **palabra por palabra** el único texto que puede
aparecer en esa pieza: ningún otro, ni fechas, ni dominios, ni logos ni la
marca en una esquina, ni subtítulos en inglés, ni marcas de agua, ni el número
de slide, ni códigos de color dibujados. Todo en español, con sus tildes, y con
aire arriba y abajo: Instagram recorta los bordes de una pieza vertical.

`generate_image(prompt, format="feed")`, **una slide por vez y en orden**:
`feed` es la proporción 4:5 del carrusel y todas las piezas van iguales.

## 5. Mirá cada una. Siempre

La herramienta te devuelve la imagen y la ves, apenas la generás. Recorrela
contra estos cinco puntos:

1. **Se lee**: el texto entra, no se corta y no se pisa con el fondo.
2. **Es de la marca**: fondo oscuro, tipografía blanca, líneas violetas y
   nada más, igual que las slides anteriores. Un robot, un personaje o un
   fondo de otro color es una falla aunque quede lindo.
3. **No tiene texto que no pediste.** Es la falla más común y la más fácil de
   pasar por alto, porque el texto de más suele estar bien escrito.
4. **No hay palabras rotas.** Mirá adentro de los dibujos, no sólo los
   titulares: ahí es donde el modelo escribe mal el español.
5. **Dice lo suyo**: la línea de esa slide y no la de otra.

Si una falla, generá **esa sola una vez más** con la corrección adentro del
prompt, y seguí. Si a la segunda sigue mal, dejala afuera: el carrusel sale con
las que pasaron, siempre que estén el gancho y el cierre, y decís en una línea
cuál quedó afuera y por qué. Si la que no pasa es la 1, no guardes el posteo
—no se guarda sin el gancho—: volvé con el pie escrito y con qué no pudiste
resolver, que un pie bueno sirve.

## 6. Guardalo

`save_post(slug, caption, hashtags, format="carousel", images=[…], alts=[…])`:
las imágenes en el orden en que se ven y un texto alternativo por cada una, en
ese mismo orden. La herramienta pone la carpeta, los nombres y la fecha; vos
ponés las palabras. El id es la fecha y el slug: otro tema en el mismo día es
otro slug. El brief con el que hiciste cada slide queda guardado con ella, así
que después se puede arreglar una sola sin rehacer el posteo.
