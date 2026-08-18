# Capacidades v2 — draft para podar

18/8/2026. Propuesta de catálogo ampliado (hoy 6 entradas, todas de contenido).
Esto es el **qué**: labels, para_qué y respaldo técnico. El **cómo** de cada
entrada (`detecta`/`verifica`/`instala`, que es lo caro) se escribe recién
cuando la entrada sobrevive la poda. Marcá con ~~tachado~~ o borrá filas.

## Reglas de curación (propuestas, discutibles)

1. **Frontera con conexiones**: si necesita una cuenta del cliente (WhatsApp,
   Google, Mercado Pago, Instagram, correo, DGI), es una **conexión** y vive en
   `connections/catalogo.json`. Capacidad = habilidad del agente puertas
   adentro, sin credencial del cliente.
2. **Lo que el modelo ya hace no es capacidad**: traducir, resumir, redactar.
   No se venden filas de aire.
3. **Flujo de rol ≠ capacidad**: "calendario de contenido" es un flujo de
   marketing; "generar imágenes" es una capacidad. Las capacidades son
   herramientas transversales que cualquier rol puede pedir.
4. **Una entrada = un trabajo que el cliente entiende** (regla que ya está en
   el catálogo). Por dentro puede ser toolset + config + kit skill.

## Cambio de esquema

Cada entrada gana `nivel: "base" | "menu"`:

- **base** — viene puesta en TODOS los agentes, no se elige ni se cobra aparte.
  En la ficha del rol se muestra como "incluido" (vende, pero no es botón).
- **menu** — se elige por rol; genera pedido; la instalamos nosotros.

Y `estado` (solo durante la construcción): `existente` | `nueva-motor` (solo
perilla/config del motor) | `nueva-kit` (hay que escribir la skill) |
`en-evaluacion`.

## Nivel BASE (2)

| id | label | para_qué | respaldo |
|---|---|---|---|
| `calculo-y-planillas` | Cálculos, planillas y documentos | Procesa tus datos, arma planillas y documentos (Excel, Word, PDF) sin pedirte nada. | toolset `code_execution` + stock `xlsx`/`docx`/`pdf` (ya en la allowlist) |
| `vision` | Ver lo que le mandás | Le mandás una foto de la factura, una captura o un PDF escaneado y lo lee. | toolset `vision` + stock `ocr-and-documents` |

Notas: `calculo-y-planillas` es lo que destraba el trabajo principal de
contabilidad. `vision` destraca "mandale la foto" en todos los roles. Ambas
las nombró Luis como base fija; acá solo quedan escritas.

## Nivel MENÚ

### grupo: contenido

| id | label | para_qué | respaldo | estado |
|---|---|---|---|---|
| `imagenes` | Imágenes para publicaciones | (como está) | `image_gen` openrouter | existente |
| `formato-redes` | Medidas y formatos de redes | (como está) | kit skill | existente (skill sin escribir) |
| `brand-kit` | Kit de marca | (como está) | kit skill | existente |
| `social-content` | Contenido para Instagram | (como está) | kit skill | existente |
| `post-image` | Placas de tus posteos | (como está) | kit skill | existente |
| `contenido-linkedin` | Contenido para LinkedIn | Posteos con la estructura y los límites de LinkedIn, que no son los de Instagram: más texto, otro tono, sin hashtags de relleno. | kit skill nueva (hermana de social-content, reusa brand-kit) | nueva-kit |
| `video` | Clips cortos | Videos breves generados para historias y reels. | toolset `video_gen` | en-evaluacion — el plugin bfl pide cuenta paga de Nous; no prometer hasta probar costo y camino |

### grupo: informacion

| id | label | para_qué | respaldo | estado |
|---|---|---|---|---|
| `busqueda-web` | Buscar en internet | (como está) | toolset `web` + Tavily | existente |
| `navegar-sitios` | Entrar y usar páginas | Para lo que una búsqueda no alcanza: entrar a un sitio, apretar botones, llenar un formulario, leer lo que solo se ve navegando. | toolset `browser` (esquema ~6,2 KB — cobra su costo de contexto) | nueva-motor |
| `monitoreo-web` | Vigilar páginas | Mira una página cada tanto —precios de la competencia, licitaciones, stock de un proveedor— y te avisa cuando cambia. | kit skill nueva sobre `web` + cron nativo; necesita `busqueda-web` | nueva-kit |

### grupo: audio-y-voz

| id | label | para_qué | respaldo | estado |
|---|---|---|---|---|
| `transcripcion` | Audios a texto | Le mandás un audio o la grabación de una reunión y te la devuelve escrita. | kit skill `transcribir` (ya existe en el kit, hoy no se instala por defecto) | nueva-kit (empaquetar) |
| `resumen-de-reuniones` | Minutas de reuniones | De la grabación a la minuta: qué se acordó, qué quedó pendiente y de quién. | kit skill nueva; necesita `transcripcion` | nueva-kit |
| `voz` | Que te conteste con audio | Respuestas habladas por los canales que lo soportan. | toolset `tts` (hoy lo apagamos en todos para ahorrar contexto; esta capacidad lo re-prende) | nueva-motor |
| `subtitulos` | Subtítulos para tus videos | Subtitula los videos que le mandás, listos para publicar. | kit skill nueva; necesita `transcripcion` | nueva-kit — dudosa, ¿la pide alguien? |

### grupo: documentos-y-datos

| id | label | para_qué | respaldo | estado |
|---|---|---|---|---|
| `facturas-a-datos` | Cargar facturas | De la foto o el PDF de la factura a la fila de la planilla, sin tipear. | kit skill nueva sobre base (`vision` + `calculo-y-planillas`) | nueva-kit — contabilidad la trae puesta |
| `reportes-con-marca` | Informes con tu identidad | Los informes salen en PDF con tus colores, tu logo y tu tipografía. | kit skill nueva; necesita `brand-kit` | nueva-kit |
| `presupuestos` | Presupuestos y cotizaciones | Arma presupuestos con tu formato y tus condiciones, listos para mandar. | kit skill nueva sobre base | nueva-kit — ventas lo trae puesto |

## Fuera del menú (decidido antes, queda escrito)

`computer_use`, `terminal` (para el cliente; el agente lo usa igual),
`delegation`, `homeassistant`, `spotify`, `discord_admin`.

## Cortadas en este draft (para resucitar si querés)

- `calendario-de-contenido`, `seguimiento-de-leads` — flujos de rol, no
  capacidades (regla 3).
- `traduccion`, `resumenes` — el modelo ya lo hace (regla 2).
- `factura-electronica-dgi`, `leer-correo`, `agenda` — conexiones (regla 1).
- `recordatorios` — cron nativo, ya lo tienen todos (es la pestaña Tareas).
- `qr-y-etiquetas`, `mapas` — sin respaldo real en el motor ni caso de cliente.

## Qué trae cada rol de fábrica (propuesta)

| rol | capacidades de menú incluidas |
|---|---|
| marketing | brand-kit, social-content, post-image, imagenes, formato-redes |
| soporte | transcripcion |
| ventas | presupuestos, busqueda-web |
| contabilidad | facturas-a-datos |
| **asistente** (a crear) | ninguna fija: base + lo que el cliente elija del menú — ese es el punto del rol |

## Orden de construcción propuesto (post-poda)

1. Las dos base (`calculo-y-planillas`, `vision`) — perillas del motor, sin
   skill nueva, y destrancan contabilidad.
2. `transcripcion` (la skill ya existe, es empaquetar).
3. `navegar-sitios` (perilla).
4. Las kit-skills nuevas, por demanda real: `facturas-a-datos` y `presupuestos`
   primero (las piden roles vendidos), después las de contenido.
5. `voz`, `video`, `subtitulos` al final o nunca.

Recordatorio de costo: cada capacidad instalada entra al system prompt de CADA
request del rol (esquemas de tools pesan ~2x el SOUL). El menú por rol no es
solo comercial: es control de contexto.
