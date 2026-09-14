---
title: Kit de marca
client_summary: "Arma el kit de marca de tu empresa —colores, tipografías y logo— leyéndolo de tu propia web."
name: brand-kit
description: "Arma el kit de marca de una empresa a partir de su sitio web: colores con su rol, tipografias, logo, y el contraste medido. Deja todo en brand/brand.json y lo publica como artefacto. Usala cuando haga falta saber como se ve la marca —antes de escribir un posteo, armar una pieza o mandar algo a diseno— o cuando el cliente pida su kit, sus colores o sus tipografias."
version: 1.0.0
license: MIT
---

# brand-kit — de qué color es esta empresa

El kit vive en **`brand/brand.json`** del workspace y es la fuente de verdad. Lo
consumen las otras skills que escriben o diseñan: si no existe, cada pieza sale
con un criterio distinto.

## Antes de nada: fijate si ya está

```bash
cat /opt/data/workspace/brand/brand.json
```

Si existe y el sitio no cambió, **no vuelvas a escanear**: leelo y contestá. Un
escaneo de más pisa el trabajo de completar los huecos.

## 1. Escanear

```bash
python3 /opt/kit/skills/brand-kit/scripts/scan_site.py --url https://elsitio.com.uy
```

Escribe `brand/brand.json` y baja los archivos a `brand/logos/` y `brand/fonts/`.
Devuelve un JSON con los roles que encontró, los fallos de contraste y los
huecos.

**Lo que el script afirma, lo observó.** No agregues colores ni tipografías que
no estén en el archivo, ni "mejores" los hex. Si el sitio no se pudo leer, decilo
y ofrecé armarlo a mano con lo que te pase el cliente — no inventes una paleta.

## 2. Mostrarlo ANTES de preguntar

```bash
python3 /opt/kit/skills/brand-kit/scripts/render_kit.py \
  | python3 /opt/kit/skills/artifact/create_artifact.py \
      --title "Kit de marca — <empresa>" --kind report \
      --summary "Colores, tipografías, contraste y qué falta decidir"
```

Nombrá el `id` que devuelve **en tu respuesta**: el chat dibuja la visualización
ahí mismo, abajo del mensaje. El cliente ve sus colores y su tipografía sin irse
a ninguna pestaña, y recién ahí las preguntas son sobre algo concreto.

## 3. Preguntar en el chat, todo junto

Dos cosas en el mismo mensaje, después de mostrarlo:

**a) ¿Está bien?** Es lo primero. Un kit que nadie miró no es una fuente de
verdad, es una suposición prolija.

**b) Los huecos.** `gaps` trae lo que un sitio no puede contestar porque son
decisiones, no datos: cuál es el logo oficial, qué no se hace nunca con la marca,
el estilo de imagen y **la voz**. El detalle está en `references/anatomy.md`.

**c) Las referencias de estilo**, que es el pedido que más rinde de los tres:

> "Pasame dos o tres posteos que te gusten —de quien sea, no tienen que ser de tu
> rubro— y de ahí saco el estilo."

Guardalas en `brand/referencias/`. `post-image` las manda como imágenes de
entrada en cada generación, y son lo que hace que las piezas se parezcan entre
sí. Describir un estilo con palabras no funciona; mostrarlo sí.

Preguntá **en una sola tanda**, en lenguaje de la clienta, y con una opción por
defecto cuando puedas ("¿te sirve que el logo principal sea el del header?"). De
a uno, abandona en la tercera.

## 4. Anotar lo que contestó

```bash
python3 /opt/kit/skills/brand-kit/scripts/fill_kit.py \
  --set "voz.tono=de vos, directo y sin marketinés" \
  --set "logo.principal=logos/icon.svg" \
  --approve --by "Cata"
```

`--approve` o `--reject --note "..."` guarda la firma; cada `--set` llena su
campo y **saca ese hueco de `gaps`**, así "qué falta" sigue siendo cierto sin que
nadie se acuerde de actualizarlo.

No edites `brand.json` a mano. Y **un hueco sin respuesta se queda como hueco**:
un kit que afirma algo que nadie decidió es peor que uno incompleto, porque
después alguien lo usa creyendo que está acordado.

## El contraste no es un detalle estético

Si un par no llega a **4,5:1**, es texto que un cliente de tu clienta no va a
poder leer. Decilo con el número medido y proponé el arreglo concreto (casi
siempre: blanco en vez de negro sobre el color de marca, o al revés).

**No cambies `brand.json` por tu cuenta para arreglarlo.** Cambiar un color de
marca es una decisión de la clienta: va como pedido de aprobación.

## Cuándo NO usarla

Para una pregunta de diseño suelta ("¿qué queda bien con azul?") no hay nada que
escanear ni que guardar. Contestá y listo.
