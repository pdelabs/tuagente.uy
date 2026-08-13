---
titulo: Entregables
para_cliente: "Guarda informes, listas y análisis con nombre y fecha en tus Archivos, siempre en el mismo lugar."
name: entregable
description: "Guarda un entregable (informe, lista, analisis, borrador largo) en el lugar correcto del workspace, con nombre, fecha y metadatos, y devuelve la referencia para citarla. Usala siempre que produzcas algo que el cliente va a querer leer, guardar o compartir, en vez de elegir vos la ruta o tirarlo al chat."
version: 1.0.0
license: MIT
---

# entregable — guardar algo para que el cliente lo lea

Cuando produzcas algo que **el cliente va a querer leer, guardar o compartir**
(un informe, una lista, un borrador largo, un análisis), no lo tires al chat ni
elijas vos la ruta: guardalo con esta skill.

## Uso

```bash
python3 /opt/kit/skills/entregable/deliver.py \
  --title "Prospección Uruguay — logística" \
  --kind informe \
  --tags "uruguay,logistica" <<'MD'
## Resumen

Encontré 20 empresas que encajan...
MD
```

Devuelve un JSON con **dos rutas, y no son intercambiables**:

- `referencia_para_citar` → la que le decís al cliente (ej. "lo dejé en
  `workspace/entregables/2026-08-04-prospeccion-uruguay.md`"). El portal la
  convierte en un chip clicable.
- `ruta_para_releer` → la absoluta, la que usás vos si después tenés que **abrir
  el archivo de nuevo**.

**No uses la referencia para releer.** Si estás trabajando una tarea del tablero,
tu directorio de trabajo es el de esa tarea, no el workspace: una ruta relativa
te va a dar "File not found" aunque el archivo exista.

`--kind`: `informe`, `lista`, `borrador`, `nota`, `analisis`.
`--tags`: opcional, separados por coma.
`--replace`: solo si querés pisar una versión anterior del mismo día; sin esto,
el script agrega un sufijo en vez de perder lo anterior.

## Una imagen, un video o un PDF también son el entregable

Si lo que hiciste incluye un archivo —la imagen de un post, un video, un PDF—
**va con `--adjunto`**, no a `workspace/interno/`:

```bash
python3 /opt/kit/skills/entregable/deliver.py \
  --title "Post 1 — Instagram" --kind borrador \
  --adjunto /opt/data/workspace/interno/post-1.png <<'MD'
Texto del post, hashtags y la fecha sugerida.
MD
```

El script copia el archivo **al lado** del entregable, con el mismo nombre y
fecha, y lo cita en una sección `## Archivos`. Se puede repetir `--adjunto`.

Por qué importa: `interno/` es tu andamiaje y **el cliente no lo ve en su
portal**. Un post cuya imagen quedó en `interno/` es un post que el cliente no
puede aprobar. Si el archivo pesa más de 5 MB el script te frena: el portal no
lo puede servir, así que anunciarlo sería prometerle algo que no va a poder
abrir.

## El script decide dónde va

Vos pasás título, tipo y contenido; el script pone la carpeta, el nombre del
archivo (con fecha), el encabezado y los metadatos. No escribas vos en
`entregables/` ni inventes rutas: si cada entregable aparece en un lugar distinto,
el cliente no encuentra nada.

El contenido va en **markdown** — el portal lo muestra formateado. Podés usar
encabezados, listas y tablas. No pongas el título como encabezado: el script ya
lo agrega.

## Qué NO es un entregable

- Scripts, pruebas, exploraciones, archivos de trabajo → `/opt/data/workspace/interno/`.
- Un dato suelto o una respuesta de dos líneas → contestá en el chat y listo.
- Algo que se entiende mejor **mirándolo** (comparaciones, evolución, KPIs) →
  usá la skill `artifact`, que hace una visualización.

## Si el trabajo es parte de un flujo

Pasá `--flujo <slug>` (el slug de la carpeta en `flujos/`): el entregable cae
en la carpeta de ese flujo y el cliente lo ve dentro del flujo en su portal.
Todo trabajo que nace de un flujo lleva su `--flujo` — sin excepción.
