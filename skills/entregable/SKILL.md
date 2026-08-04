---
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
python3 /opt/data/skills/entregable/deliver.py \
  --title "Prospección Uruguay — logística" \
  --kind informe \
  --tags "uruguay,logistica" <<'MD'
## Resumen

Encontré 20 empresas que encajan...
MD
```

Devuelve un JSON con `referencia`. **Decile esa referencia al cliente en tu
respuesta** (ej. "lo dejé en `workspace/entregables/2026-08-04-prospeccion-uruguay.md`"):
el portal la convierte en un chip clicable que abre el archivo.

`--kind`: `informe`, `lista`, `borrador`, `nota`, `analisis`.
`--tags`: opcional, separados por coma.
`--replace`: solo si querés pisar una versión anterior del mismo día; sin esto,
el script agrega un sufijo en vez de perder lo anterior.

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
