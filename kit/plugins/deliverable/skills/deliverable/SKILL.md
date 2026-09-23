---
title: Entregables
client_summary: "Guarda informes, listas y análisis con nombre y fecha en tus Archivos, siempre en el mismo lugar."
name: deliverable
description: "Guarda un entregable (informe, lista, analisis, borrador largo) en el lugar correcto del workspace, con nombre, fecha y metadatos, y devuelve la referencia para citarla. Usala siempre que produzcas algo que el cliente va a querer leer, guardar o compartir, en vez de elegir vos la ruta o tirarlo al chat."
version: 1.1.0
license: MIT
---

# deliverable — guardar algo para que el cliente lo lea

Cuando produzcas algo que **el cliente va a querer leer, guardar o compartir**
(un informe, una lista, un borrador largo, un análisis), no lo tires al chat ni
elijas vos la ruta: guardalo con esta skill, desde `bash`.

## Uso

```bash
python3 /opt/kit/plugins/deliverable/skills/deliverable/deliver.py \
  --title "Prospección Uruguay — logística" \
  --kind informe \
  --tags "uruguay,logistica" <<'MD'
## Resumen

Encontré 20 empresas que encajan...
MD
```

Devuelve un JSON con **dos rutas, y no son intercambiables**:

- `client_reference` → la que le decís al cliente (ej. "lo dejé en
  `workspace/entregables/2026-08-04-prospeccion-uruguay.md`"). El portal la
  convierte en un chip clicable.
- `reopen_path` → la absoluta (`/workspace/entregables/…`), la que le pasás a
  `read_file` si después tenés que **abrir el archivo de nuevo**.

**No uses la referencia para releer**: empieza con `workspace/`, y `read_file`
ya parte del workspace, así que la buscaría en `workspace/workspace/…`.

`--kind`: `informe`, `lista`, `borrador`, `nota`, `analisis`.
`--tags`: opcional, separados por coma.
`--replace`: solo si querés pisar una versión anterior del mismo día; sin esto,
el script agrega un sufijo en vez de perder lo anterior.

## Una imagen, un video o un PDF también son el entregable

Si lo que hiciste incluye un archivo —una imagen, un video, un PDF—
**va con `--attachment`**, no se queda en `interno/`:

```bash
python3 /opt/kit/plugins/deliverable/skills/deliverable/deliver.py \
  --title "Presentación para el cliente" --kind borrador \
  --attachment /workspace/interno/presentacion.pdf <<'MD'
Qué es, para qué sirve y qué falta decidir.
MD
```

El script copia el archivo **al lado** del entregable, con el mismo nombre y
fecha, y lo cita en una sección `## Archivos`. Se puede repetir `--attachment`.

Por qué importa: `interno/` es tu andamiaje. Un archivo que quedó ahí no está
junto a la nota que lo explica, y el cliente no lo va a encontrar donde
encuentra lo demás que le entregaste.

## El script decide dónde va

Vos pasás título, tipo y contenido; el script pone la carpeta, el nombre del
archivo (con fecha), el encabezado y los metadatos. No escribas vos en
`entregables/` ni inventes rutas: si cada entregable aparece en un lugar distinto,
el cliente no encuentra nada.

El contenido va en **markdown** — el portal lo muestra formateado. Podés usar
encabezados, listas y tablas. No pongas el título como encabezado: el script ya
lo agrega.

## Qué NO es un entregable

- Scripts, pruebas, exploraciones, archivos de trabajo → `interno/`.
- Un dato suelto o una respuesta de dos líneas → contestá en el chat y listo.

## Si el trabajo es parte de un flujo

Pasá `--flow <slug>` (el slug de la carpeta en `flows/`): el entregable cae
en la carpeta de ese flujo y el cliente lo ve en la página del flujo, en
«Resultados». Todo trabajo que nace de un flujo lleva su `--flow` — sin
excepción.
