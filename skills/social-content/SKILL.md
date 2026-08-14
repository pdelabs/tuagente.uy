---
titulo: Contenido para redes
para_cliente: "Escribe tus posteos de Instagram con tu voz y con las medidas de hoy: feed, carrusel, reel o historia."
name: social-content
description: "Escribe posteos de Instagram con la voz de la marca. Elegis formato (feed, carrusel, reel, historia) y tipo de posteo, el esqueleto sale con los limites de hoy y el borrador se valida antes de mostrarlo. Usala cuando el cliente pida un posteo, un carrusel, un reel, una historia, un pie de foto o contenido para redes. Necesita el kit de marca: si no esta, ofrecele armarlo."
version: 1.0.0
license: MIT
---

# social-content — posteos que suenan a la clienta

## Sin kit de marca no se escribe

Lo primero, siempre:

```bash
python3 /opt/kit/skills/social-content/scripts/new_post.py --formato feed --tipo oferta
```

Si no hay `brand/brand.json`, corta con `falta_kit` y te da la pregunta ya
escrita. **Hacésela y esperá.** Un posteo sin la voz de la clienta suena igual al
de cualquier otra empresa, que es exactamente lo que ella no quiere pagar.

Si dice que no, escribí igual — pero avisale en una línea que va a sonar
genérico. Es su decisión, no tuya.

## Formato y tipo se eligen ANTES de escribir

Son dos cosas distintas y las dos importan:

- **Formato** = el envase: `feed`, `carrusel`, `reel`, `historia`. Decide
  cuántos caracteres, cuántas slides y **dónde se corta**.
- **Tipo** = el argumento: `educativo`, `prueba`, `oferta`, `detras`, `opinion`,
  `anuncio`, `faq`. Decide en qué orden van las ideas.

Cómo se elige cada uno, y qué tipo entra en qué formato, está en
`references/tipos.md`. Los números de cada formato, en `references/formatos.md`.

El script devuelve el esqueleto: los golpes en orden, los límites y las reglas
duras. **Seguilo.** No inventes la cantidad de slides ni "redondeés" un límite.

## Escribí, y después validá

```bash
echo "$PIE" | python3 /opt/kit/skills/social-content/scripts/check_post.py --formato carrusel
```

Chequea lo que se puede chequear: largo, dónde corta la primera línea, hashtags,
dos pedidos peleándose, y las palabras que la marca dijo que no usa. **Si sale
con problemas, arreglalos antes de mostrarle nada al cliente.** Sale con código 1
justamente para que no siga de largo.

El gusto no lo chequea nada. Eso sigue siendo tuyo.

## Tres cosas que se equivocan siempre

1. **Cinco hashtags, no treinta.** Instagram bajó el límite en diciembre de 2025.
   Treinta hashtags hoy se ve viejo y no llega más lejos.
2. **El corte del reel es la mitad que el del feed** (58 contra 125). El mismo
   pie que se lee entero en el feed queda cortado en Reels.
3. **Un solo pedido.** Guardá *y* comentá *y* escribinos es no pedir nada.

## Publicar no es tu decisión

Mostrá **el texto exacto** que va a salir, no un resumen, y esperá el sí. Si la
clienta no tiene la conexión de Instagram puesta, decilo — no falles en silencio.
