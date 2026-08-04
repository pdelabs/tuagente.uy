# Toolkit común para los agentes de clientes

Qué construimos una vez y reusamos en cada agente que desplegamos.

## Principio: no reconstruir lo que Hermes ya trae

Verificado en la instalación real (`hermes skills list`, `hermes plugins list`):
ya vienen de fábrica **xlsx, docx, powerpoint, pdf, nano-pdf, ocr-and-documents,
google-workspace, notion, himalaya (email), computer-use** y plugins de browser
(browser-use, browserbase). Escribir nuestra versión de eso es tirar plata.

Nuestro valor está en dos capas que Hermes no puede tener:

1. **Las skills del contrato con el panel** — hacen que cualquier agente se vea
   bien en tuagente sin depender de que el modelo recuerde convenciones.
2. **Las integraciones de la realidad LATAM** — lo que un cliente uruguayo pide
   y ningún runtime trae.

---

## Capa 1 — Skills del contrato (genéricas, van en todos los agentes)

### `artifact` ✅ hecha
Crea una visualización HTML autocontenida que el portal muestra en la pestaña
Artefactos y que se puede citar en el chat. El script es dueño del formato (shell,
CSS de marca, id, ruta, metadatos); el agente pone solo el contenido. Regla dura:
autocontenido, sin CDNs, gráficos con SVG/CSS.

### `entregable` ✅ hecha
El agente pasa título, tipo y contenido; el script pone ruta, nombre con fecha,
front-matter y devuelve la referencia para citar. Lo interno va a
`workspace/interno/` y el portal lo esconde detrás de un toggle, así Archivos
muestra solo lo que le sirve al cliente.

### `aprobacion` ✅ hecha
Formatea la solicitud siempre igual (qué quiero hacer / si aprobás / si rechazás
/ contenido a revisar) y documenta la regla del **bloqueo pegajoso**: hay que
bloquear con la acción de bloquear, nunca crear el ticket ya bloqueado, porque
si no el pedido de permiso se auto-desbloquea y la tarea sigue como si estuviera
autorizada. El portal cierra el círculo: se puede aprobar con correcciones, y
esa versión queda asentada como comentario del cliente antes de desbloquear.

### `estado` — a evaluar
Que el agente reporte avance de una tarea larga (0-100% + una línea), para que el
portal muestre progreso en vez de silencio.

---

## Capa 2 — Integraciones (se activan según el cliente)

- **WhatsApp Cloud API** — Hermes lo trae nativo (`hermes whatsapp-cloud`). Es el
  canal que más nos van a pedir acá. Falta el procedimiento de alta (número,
  verificación de Meta), no el código.
- **Google Workspace / Sheets** — builtin. Muchas PyMEs viven en una planilla:
  leerla y escribirla suele ser el 80% del valor.
- **Calendly / agenda** — webhook para que el agente sepa cuándo se agendó una
  reunión y arme el contexto previo.
- **Facturación y cobros** — según cliente. Acá sí hay que escribir código.
- **ERPs y sistemas locales** — caso por caso; el patrón reusable es "skill que
  envuelve una API con credenciales en `.env` y un script dueño del formato".

---

## Cómo se distribuye

Un repo `hermes-kit` con las skills de la capa 1 + el `portal_adapter.py`, y un
script de alta que lo copia al `data/` del agente nuevo.

El **chequeo de conformidad ya existe**: `tools/portal-check.py`. Le pega a un
agente desplegado y verifica manifiesto, auth, CORS (del adapter y del gateway),
que cada módulo declarado responda de verdad, que los archivos se sirvan como
`text/plain`, que el proxy de chat esté, y las convenciones del workspace. No
escribe nada. Contra el agente fixture: 13 ok, 0 fallas.

```bash
python3 tools/portal-check.py --key <API_SERVER_KEY>
```

## Instalar una skill: cómo funciona de verdad

**Corrección de una conclusión previa equivocada.** Habíamos anotado que las
skills locales "no se auto-descubren". Es falso: Hermes las descubre solo.

El mecanismo (verificado el 2026-08-04): `data/.skills_prompt_snapshot.json`
guarda, además del índice que se le inyecta al prompt, un `manifest` con
`{ruta de cada SKILL.md: [mtime_ns, tamaño]}`. Es un **detector de cambios**:
cuando un archivo no coincide, Hermes reconstruye el índice **por su cuenta**
—sin comandos ni reinicios—. Nuestras tres skills entraron solas ~20 minutos
después de crearlas. La prueba que dio "esa skill no existe" cayó dentro de esa
ventana, y de ahí salió la conclusión errónea.

**El error real era otro y sí era nuestro: `SKILL.md` sin frontmatter.** Sin él,
la skill se indexa con `description: ""` — el agente ve el nombre y nada que le
diga qué hace ni cuándo usarla. Toda skill nuestra tiene que arrancar así:

```yaml
---
name: <slug>
description: "Qué hace + CUÁNDO usarla. Es lo único que el agente lee para
              decidir si la abre."
version: 1.0.0
---
```

**Qué queda en el SOUL entonces:** no el catálogo de skills (de eso se encarga el
índice), sino las **reglas de negocio** — qué requiere aprobación, dónde va cada
cosa, cuándo conviene un artefacto. Documentar el comando exacto en el SOUL sigue
sirviendo como refuerzo para las skills críticas, pero no es el mecanismo.

## Lección que atraviesa todo

El modelo pone las palabras; el código pone el formato. Cada vez que dependimos de
una convención escrita en prosa en el SOUL (dónde guardar, cómo titular, qué
significa bloqueado), se rompió. Cada vez que la metimos en un script, aguantó.
