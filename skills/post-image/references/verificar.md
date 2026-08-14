# Cómo se mira una pieza antes de entregarla

Esto no es control de calidad estético. Es el único paso que separa un posteo de
un error publicado, porque el texto ahora lo escribe el modelo y **el modelo se
equivoca poco, pero se equivoca sin avisar**.

Todos los ejemplos de abajo salieron de verdad, el 14/8/2026, generando piezas
para tuagente.uy.

## Los seis chequeos, en orden

**1. Cada texto, letra por letra.** Compará contra `textos_exactos`. No "dice más
o menos eso": dice eso. Un precio con un dígito cambiado es peor que no publicar.

**2. Texto que nadie pidió.** Es la falla más común y la más fácil de pasar por
alto, porque el texto de más suele estar bien escrito y parecer intencional.
Visto: `AUGUST 14, 2026` en una pieza sin fecha, `BOOK A DEMO AT` en una pieza en
español, un logo de una marca que no existe.

**3. Palabras rotas.** El modelo bueno escribe bien el texto que le pediste, pero
si además dibuja una interfaz o un cartel adentro de la escena, ese texto
secundario sale roto. Mirá **adentro** de los dibujos, no solo los titulares.
Visto: `"Autormate station for the autonmozer AI Agent"`, `"Instag:raam Storyy
Steri>e"`, `"Short'nftoro Anoev~"`.

**4. Datos inventados.** Dominios, teléfonos, precios, direcciones. Visto:
`WWW.REALLYGREATSITE.COM` — el dominio de relleno de una herramienta — donde
tenía que ir el del cliente. Si un dato no estaba en el brief, no puede estar en
la imagen.

**5. Códigos de color dibujados.** Suena absurdo hasta que pasa: una pieza salió
con `#5B4BE8 + Coral: + #FFDFD6` impreso adentro del arte, porque los hex estaban
en el brief. Si ves un `#` seguido de letras y números, regenerá.

**6. La zona segura de las historias.** Instagram dibuja encima: arriba el nombre
de la cuenta y la barra de progreso, abajo la caja de respuesta. Si el CTA o el
dominio caen ahí, el cliente los ve tapados en su propio teléfono. Regla: nada
importante en el 13% de arriba ni en el 13% de abajo.

## Qué hacer cuando algo falla

**Regenerá, hasta dos veces.** Cambiá lo mínimo: si el problema fue texto de más,
repetí la regla de "ningún otro texto"; si fue un dato inventado, nombrá el dato
correcto otra vez.

**A la tercera, parás.** Mostrale al cliente lo que tenés y decile qué no
lograste. Tres intentos fallidos suelen querer decir que el pedido es confuso, no
que el modelo esté fallando.

**Nunca entregues una pieza que no miraste**, aunque el generador haya dicho que
salió bien. El generador no sabe leer lo que dibujó.

## Lo que NO chequeás acá

Si está linda. Eso es criterio y es tuyo. Esta lista es para lo que es verificable
y para lo que, si se escapa, lo paga la clienta delante de sus seguidores.
