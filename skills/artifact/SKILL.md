---
name: artifact
description: "Crea una visualizacion HTML autocontenida (grafico, tabla rica, informe, panel) que el cliente ve renderizada en el portal y se puede citar en el chat. Usala cuando los datos se entienden mucho mejor mirandolos que leyendolos: comparaciones, evolucion en el tiempo, KPIs o un informe para compartir."
version: 1.0.0
license: MIT
---

# artifact — visualizar datos en el portal

Cuando una respuesta se entiende mucho mejor **mirándola** que leyéndola, creá un
artefacto: una página HTML autocontenida que el cliente ve renderizada en el
portal (pestaña Artefactos) y que podés citar en el chat.

## Cuándo usarla

Usala cuando tengas datos y la tabla en markdown se queda corta:
- comparar cosas (empresas, precios, períodos) → tabla rica o barras
- evolución en el tiempo → gráfico de líneas o barras
- un resumen con números grandes → tarjetas de KPI
- un informe que el cliente va a querer compartir o guardar

**No** la uses para respuestas cortas, para texto que ya se lee bien en markdown,
ni para un solo número. Un artefacto de más molesta.

## Uso

```bash
python3 /opt/data/skills/artifact/create_artifact.py \
  --title "Leads por mes" \
  --kind chart \
  --summary "Enero a junio, por origen" <<'HTML'
<div class="card">
  <div class="grid">
    <div><div class="kpi-label">Total</div><div class="kpi">128</div></div>
    <div><div class="kpi-label">Este mes</div><div class="kpi">31</div></div>
  </div>
</div>
HTML
```

Devuelve un JSON con el `id`. **Decile al cliente el id en tu respuesta**
(por ejemplo: "lo dejé en el artefacto `art_1785800000_leads-por-mes`"), porque el
portal lo convierte en un chip clicable.

`--kind`: `chart`, `table`, `report`, `dashboard`, `diagram`, `other`.
Para reemplazar uno existente en vez de crear otro, pasá `--id <el mismo id>`.

## El script es dueño del formato — vos ponés solo el contenido

Pasale únicamente lo que iría dentro del `<body>`. El script agrega el shell, el
`<title>`, el encabezado con el título y el resumen, el pie y **el CSS de marca**.
No escribas `<html>`, `<head>`, `<style>` ni tu propia tipografía: si lo hacés,
tu artefacto va a verse distinto a todos los demás.

Clases ya disponibles (usalas, no inventes CSS salvo que necesites algo puntual):

| Clase | Para qué |
|---|---|
| `.card` | tarjeta blanca con borde |
| `.grid` | grilla que se acomoda sola |
| `.kpi` / `.kpi-label` | número grande y su rótulo |
| `.chip-v` `.chip-g` `.chip-c` `.chip-a` | etiquetas violeta / verde / coral / ámbar |
| `.num` | celda numérica alineada a la derecha |
| `.bar` | barra de gráfico (color de marca) |

Las tablas (`<table>`) ya vienen estiladas: escribilas sin clases.

## Regla dura: autocontenido

El portal dibuja el artefacto **aislado y sin garantía de internet**. Nada de
CDNs, ni Google Fonts, ni librerías de gráficos, ni imágenes remotas: no cargan y
el cliente ve un cuadro vacío. Los gráficos se hacen con **SVG o divs con CSS**,
y los datos van embebidos en el HTML. El script te avisa si detecta un recurso
externo — si ves ese warning, rehacelo sin él.

Ejemplo de barras sin librerías:

```html
<div style="display:flex;align-items:end;gap:8px;height:140px">
  <div class="bar" style="width:28px;height:60%"></div>
  <div class="bar" style="width:28px;height:100%"></div>
</div>
```

## Dónde queda

En `/opt/data/workspace/artifacts/<id>/` (`index.html` + `meta.json`). No escribas
ahí a mano ni muevas esos archivos: el portal los lee de ese lugar.
