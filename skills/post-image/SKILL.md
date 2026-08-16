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

## 2. Generá con `image_generate`

```
image_generate(
  prompt               = el `prompt` que devolvió build_prompt.py, tal cual
  aspect_ratio         = el `aspect_ratio` que devolvió build_prompt.py
  reference_image_urls = las `referencias`, si hay
)
```

**El `aspect_ratio` va con el nombre que devuelve el script (`portrait`), no
como "9:16".** La tool toma nombres semánticos —`square`, `landscape`,
`portrait`— y con el ratio crudo **no falla**: cae al default y devuelve una
imagen **horizontal**, que en una historia es inservible. Medido: `"9:16"` dio
1280×720; `"portrait"` dio 720×1280.

Es el único camino. Hay un `scripts/generate.py` en esta carpeta que usa la
Images API —más barato y con más control— pero **necesita la clave del proveedor
en el entorno y tu terminal no la tiene**: falla con "falta OPENROUTER_API_KEY" y
no hay forma de arreglarlo desde tu lado. No lo uses; está ahí para que lo
corramos nosotros.

Las referencias son lo que más mueve el resultado: el estilo se muestra, no se
describe.

## 3. Sacala del caché o no existe

`image_generate` devuelve una **ruta adentro del caché del motor**
(`/opt/data/cache/images/...`). Ese lugar **no lo ve nadie**: no es Archivos, no
es un entregable, y se limpia solo. Una pieza que se queda ahí es una pieza que
tu cliente nunca va a ver, por linda que haya salido.

Copiala al workspace con un nombre que se entienda —`instagram/stories/<fecha>-<tema>/story-01.png`—
y adjuntala al entregable del flujo. Recién ahí existe.

**Y entregá lo que está bien, aunque falte una pieza.** Si de tres salieron dos,
esas dos se entregan y se explica qué pasó con la tercera. Guardarte las buenas
porque una falló deja a tu cliente con nada, que es peor que con dos.

## 4. MIRÁ lo que salió. Siempre.

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

## Por qué el paso de mirar existe

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
