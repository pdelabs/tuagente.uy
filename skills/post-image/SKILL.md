---
titulo: Piezas para redes
para_cliente: "Genera las imágenes de tus posteos con tu identidad y con el estilo de las referencias que le pasaste."
name: post-image
description: "Genera la imagen de un posteo de Instagram con IA, usando el kit de marca y las referencias de estilo del cliente. Arma el brief con build_prompt.py, genera con image_gen y VERIFICA la imagen mirandola antes de mostrarla. Usala cuando el posteo necesite una pieza visual: feed, carrusel, historia o portada de reel."
version: 2.0.0
license: MIT
---

# post-image — la pieza del posteo

Tres pasos y ninguno es opcional. El tercero es el que evita publicar un error.

## 1. Armá el brief

```bash
python3 /opt/kit/skills/post-image/scripts/build_prompt.py \
  --formato historia \
  --titulo "Tu agente contesta a las 23:40" \
  --bajada "Con tus precios, no con inventos." \
  --cta "Agendá una demo" \
  --idea "corte diagonal: arriba de día, abajo de noche con alguien durmiendo"
```

Devuelve el `prompt` con los colores y la tipografía **exactos** del kit, la
lista de `referencias` de estilo, y la lista de `verificar`.

El brief lo arma el script y no vos, por una razón: si escribís los hex de
memoria, cada tanto se te escapa uno y el feed deja de parecer de una sola
marca. **Usá el prompt tal como sale.**

Sin `brand.json` corta y te da la pregunta para ofrecerle armar el kit.

## 2. Generá

Con `image_gen`, pasando el `prompt` y **adjuntando las `referencias`** como
imágenes de entrada. Las referencias son lo que más mueve el resultado: el
estilo se muestra, no se describe.

Si `sin_referencias` viene en `true`, pedíselas al cliente antes o después —
dos o tres posteos que le gusten— y guardalas en `brand/referencias/`. A partir
de ahí todas las piezas se parecen entre sí, que es lo que hace que un feed se
lea como un sistema y no como diez posteos sueltos.

## 3. MIRÁ lo que salió. Siempre.

**No muestres una imagen que no miraste.** Abrila y recorré la lista de
`verificar` que devolvió el script:

- ¿Cada texto está **completo y sin una letra cambiada**?
- ¿Hay algún texto **de más**? Fechas, dominios inventados, subtítulos en inglés,
  marcas de agua.
- ¿Alguna palabra con letras rotas?
- ¿Los colores se parecen a la marca?
- Si es historia: ¿queda algo importante debajo de los botones de Instagram?

Si algo falla, **regenerá**. Hasta dos veces. Si a la tercera sigue mal, mostrale
al cliente lo que tenés y decile qué no pudiste resolver — no lo entregues como
si estuviera bien.

El detalle de qué mirar está en `references/verificar.md`.

## Por qué este paso existe

El modelo escribe bien **casi siempre**, y "casi" no alcanza cuando la pieza sale
al Instagram de la clienta con un precio adentro. Un error acá lo ve ella después
que sus seguidores.

Ya vimos salir: `"Autormate station for the autonmozer AI Agent"`,
`"WWW.REALLYGREATSITE.COM"` en lugar del dominio real, y los códigos hex del
propio brief pintados adentro del dibujo. Todo eso pasa la mirada distraída y no
pasa la lista.

## Publicar no es tu decisión

Mostrá la pieza **y** el pie exacto que la acompaña, juntos: son un solo posteo y
se aprueban juntos. Esperá el sí.
