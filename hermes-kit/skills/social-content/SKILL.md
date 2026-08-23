---
title: Contenido para redes
client_summary: "Escribe tus posteos de Instagram con tu voz y con las medidas de hoy: feed, carrusel, reel o historia."
name: social-content
description: "Escribe posteos de Instagram con la voz de la marca. Elegis formato (feed, carrusel, reel, historia) y tipo de posteo, el esqueleto sale con los limites de hoy y el borrador se valida antes de mostrarlo. Usala cuando el cliente pida un posteo, un carrusel, un reel, una historia, un pie de foto o contenido para redes. Necesita el kit de marca: si no esta, ofrecele armarlo."
version: 1.0.0
license: MIT
---

# social-content — posteos que suenan a la clienta

## Sin kit de marca no se escribe

Lo primero, siempre:

```bash
python3 /opt/kit/skills/social-content/scripts/new_post.py --format feed --type offer
```

Si no hay `brand/brand.json`, corta con `missing_kit` y te da la pregunta ya
escrita. **Hacésela y esperá.** Un posteo sin la voz de la clienta suena igual al
de cualquier otra empresa, que es exactamente lo que ella no quiere pagar.

Si dice que no, escribí igual — pero avisale en una línea que va a sonar
genérico. Es su decisión, no tuya.

## Formato y tipo se eligen ANTES de escribir

Son dos cosas distintas y las dos importan:

- **Formato** = el envase: `feed`, `carousel`, `reel`, `story`. Decide
  cuántos caracteres, cuántas slides y **dónde se corta**.
- **Tipo** = el argumento: `educational`, `social-proof`, `offer`,
  `behind-the-scenes`, `opinion`, `announcement`, `faq`. Decide en qué orden
  van las ideas.

Cómo se elige cada uno, y qué tipo entra en qué formato, está en
`references/types.md`. Los números de cada formato, en `references/formats.md`.

El script devuelve el esqueleto: los golpes en orden, los límites y las reglas
duras. **Seguilo.** No inventes la cantidad de slides ni "redondeés" un límite.

## Escribí, y después validá

```bash
echo "$PIE" | python3 /opt/kit/skills/social-content/scripts/check_post.py --format carousel
```

Devuelve dos listas distintas y no hay que confundirlas:

- **`problems`** — medible y objetivo: largo, dónde corta, hashtags, una oración
  de 40 palabras, dos pedidos, palabras vetadas. **Se arreglan antes de mostrar
  nada.** Sale con código 1 para que no sigas de largo.
- **`review`** — heurístico: no encuentro gancho, no encuentro beneficio, no hay
  razón para actuar hoy. **No son errores**, son preguntas. Contestalas leyendo,
  y si el posteo está bien así, seguí.

## Que el posteo valga la pena, no sólo que entre

Que entre en los límites no lo hace bueno. Las diez cosas que sí, en
`references/craft.md`. Las tres que más se olvidan:

**Beneficio, no característica.** "Ahorrá 20 minutos cada mañana" le gana a
"llegó nuestra app de productividad". La prueba: después de cada frase,
preguntate *"¿y eso a mí qué me da?"*. Si la frase no lo contesta, todavía es una
característica.

**Que se sienta algo.** Un posteo correcto y tibio no lo comparte nadie. La
emoción no se agrega al final: sale de contar algo que pasó de verdad.

**Una razón para guardarlo o mandárselo a alguien.** Algo útil, sorprendente, tan
reconocible que se lo mandan a quien le pasa igual, o una postura que quieran
respaldar. Si no tiene ninguna de las cuatro, es un posteo que se ve y se olvida.

**No inventes urgencia.** "Últimos lugares" cuando hay treinta se nota, y se paga
con lo único que esta clienta no puede reponer.

## La imagen no es un adorno

La imagen frena el scroll; el pie convence. Si la imagen no frena, el mejor pie
del mundo no se lee. Las placas y portadas las hace `post-image`, con los colores
y la tipografía de `brand.json`.

En carrusel: **la slide 1 es la portada** —es lo único que se ve en el feed— y la
slide 2 decide si deslizan hasta el final.

## Tres cosas que se equivocan siempre

1. **Cinco hashtags, no treinta.** Instagram bajó el límite en diciembre de 2025.
   Treinta hashtags hoy se ve viejo y no llega más lejos.
2. **El corte del reel es la mitad que el del feed** (58 contra 125). El mismo
   pie que se lee entero en el feed queda cortado en Reels.
3. **Un solo pedido.** Guardá *y* comentá *y* escribinos es no pedir nada.

## Publicar no es tu decisión

Mostrá **el texto exacto** que va a salir, no un resumen, y esperá el sí. Si la
clienta no tiene la conexión de Instagram puesta, decilo — no falles en silencio.
