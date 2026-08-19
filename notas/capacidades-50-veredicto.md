# Capacidades: 50 candidatas, evidencia y veredicto

19/8/2026. Tres investigaciones independientes (pymes uruguayas con ANDE/INE/
UTDT-Fundar; señal de demanda global/LATAM con pricing pages y datos de churn;
madurez y costo técnico de cada capacidad) cruzadas contra 50 candidatas, con
pasada de devil's advocate. Supersede la lista del `capacidades-v2-draft.md`.
Los tres reportes completos, con todos los links, están en
`notas/research-capacidades/`.

## Lo que la evidencia gritó (leer antes que la lista)

1. **Nuestro catálogo estaba invertido.** Las 6 entradas actuales son de
   marketing/contenido, pero cuando una pyme uruguaya PAGA ayuda, es para
   administración/contabilidad/finanzas (65% de la consultoría contratada,
   ANDE/INE 2024). Lo que se compra con retención: atender el canal, agendar,
   **cotizar rápido, cobrar, conciliar, transcribir** — y recién después el
   post con su imagen.
2. **La capacidad "de un solo verbo" se churnea.** Jasper −87%, Midjourney
   −46%, Grammarly −29% en 90 días: las absorbe el asistente general. La
   retención está en el ROL que termina el trabajo; la capacidad es un
   habilitador, no el producto. El copy de la ficha vende el trabajo terminado,
   nunca "generación de imágenes".
3. **El mercado uruguayo es más chico y más precario de lo que asumimos**:
   93,3% de las empresas tiene 1-9 empleados, dos tercios de las micro son
   autoempleo, solo la mitad registra ingresos/egresos. El headroom está en el
   back-office básico, no en sofisticación.
4. **WhatsApp/IG/MELI son el local; la web propia no existe** (54,6% "no la
   necesito"; mensajería = canal de venta online nº1 con 39-43%).
5. **Precio**: el chatbot WhatsApp con IA se vende a US$45-199/mes en LATAM.
   Nuestros ~US$25/rol quedan DEBAJO del ancla — hay margen, no regalar.
6. **El costo que rompe los US$25/rol no son las capacidades** (imagen
   US$0,005-0,06; transcripción US$0,006/min) **sino los loops agénticos sin
   tope** (5-50x los tokens de un chat) — y video (US$1,5-12/clip), TTS
   premium y monitoreo horario (US$36-58/mes; el diario cuesta US$1-2).

## NIVEL BASE (4) — en todos los agentes

| id | label | por qué base |
|---|---|---|
| `calculo-y-planillas` | Cálculos, planillas y documentos | Skills office maduras; el back-office precario es EL dolor; destraba contabilidad. |
| `vision` | Ver lo que le mandás | OCR 94-98% en docs limpios; "mandale la foto" es la interacción LATAM (Pix por foto lo validó). GUARDA: alucina montos plausibles en 1-3% — lo que va a contabilidad pasa por aprobación. |
| `busqueda-web` | Buscar en internet | Uso nº1 declarado de IA en el trabajo en Uruguay (UTDT 2025). Con tope de uso: Tavily ~US$8/1k. |
| `transcripcion` | Audios a texto | **PROMOVIDA de menú a base.** Uso nº1 de Zapia (1M usuarios LATAM); Meta la hizo nativa en WhatsApp (jun 2026) ⇒ es gancho, no producto: cobrarla aparte es vender lo que ya regalan. Cuesta centavos. |

## MENÚ NÚCLEO (10) — evidencia fuerte, se venden

| id | label | evidencia | DA / guarda |
|---|---|---|---|
| `presupuestos` | Presupuestos y cotizaciones al toque | La más fuerte del research: cotizar a mano toma 2-4h, el cliente espera <24h, la velocidad cierra ventas; productos standalone a US$30-40/mes; ROMA AI (UY) lo automatiza para 24 pymes. Combo con `vision`: presupuesto desde la foto. | Plantilla del cliente primero, números del cliente siempre. |
| `facturas-a-datos` | Cargar facturas | Data entry = 43% de lo que se automatiza en contabilidad (Intuit); e-factura obligatoria en UY desde 1/1/2026 empuja a las chicas a digitalizar. OCR maduro. | Humano en el loop SIEMPRE (alucinación de montos). Solo lectura DGI intocable. |
| `seguimiento-de-cobranzas` | Cobranzas al día | AP/AR = 46% de lo automatizado (Intuit); ROMA lo lista; en UY domina la transferencia (72-84%) ⇒ conciliar contra extracto importa. | La capacidad rastrea y redacta; el ENVÍO va por canales/aprobación. |
| `paquete-social` | Tus redes con tu identidad | Marketing = adopción nº1 (Verizon 28%); Canva con 45M pymes. PERO imagen suelta se churnea y el "AI slop" quema marcas. | Se vende EL PAQUETE (brand-kit + social-content + post-image + imagenes + formato-redes como internas), nunca "imágenes" suelta. brand-kit es el moat anti-slop. |
| `resumen-de-reuniones` | Minutas de reuniones | EL combo probado del período (Fireflies/Fathom/Otter, mercado maduro). Con transcripción en base, esto es el upsell natural. | Whisper inventa frases en ~1% (silencios): no prometer literal para lo legal. |
| `base-de-conocimiento` | Respuestas de tu negocio | FAQs = caso de uso nº1 de agentes (Salesforce); es lo que hace vendible a soporte. | Un bot que contesta mal sube el churn del cliente final 67%: gate de calidad y "no sé" honesto. El fallo típico es la base desactualizada — mantenerla es parte de la capacidad. |
| `monitoreo-web` | Vigilar páginas | Price-watch es mercado real (US$1.2B); plantillas n8n populares. | Cadencia DIARIA fija (horaria = US$36-58/mes). Vía search API, no browser: Cloudflare bloquea agentes desde 2025. |
| `licitaciones-uy` | Licitaciones y compras estatales | 4 herramientas locales existen SOLO para esto (Tenderis, Gubly, ialicitaciones, ProveedorUY) = dolor validado; ventanas de 8 días hábiles exigen vigilancia. | Competencia local existe; para nosotros es capacidad del rol, no producto suelto. Datos abiertos de ARCE como vía estable. |
| `catalogo-de-productos` | Tu catálogo en tus canales | REPOSICIONADA: no PDF ni web propia — catálogo PARA WhatsApp/IG/MELI, que es donde venden (mensajería nº1; MELI referente para el 72%). Caso Gorillaz: pedidos validados contra inventario. | Publicar en el canal pide conexión; la capacidad arma y mantiene, el alta de canal va por conexiones. |
| `memoria-de-clientes` | Ficha de cada cliente | El chatbot LATAM se vende CON CRM básico (US$59-199/mes); "recomendaciones personalizadas" en el top de Salesforce. | CRM-lite en workspace, no un CRM: no prometer pipeline. |

## MENÚ AMPLIADO (12) — evidencia media, entran podables

| id | label | nota corta |
|---|---|---|
| `analisis-de-datos` | Qué dicen tus números | "Análisis de datos" = uso top declarado en UY; solo la mitad de las micro registra ingresos ⇒ el que registra, quiere leer. Planillas simples maduras; auditar planillas ajenas <35% éxito — no prometer eso. |
| `control-de-stock` | Stock con alertas | Gorillaz valida pedidos contra inventario; retail de cercanía. En planilla, alerta de mínimos. |
| `documentos-desde-modelos` | Documentos desde tus modelos | Office maduro; contratos/remitos/notas. Demanda media. |
| `reportes-con-marca` | Informes con tu identidad | Barato, diferencial visual; necesita brand-kit. |
| `edicion-de-imagenes` | Fotos de producto listas | REENFOCADA a producto (fondo, luz, medida): es lo que Tiendanube/MELI validan con sus propias IA. En evaluación: librerías en la imagen del motor. |
| `investigacion-de-empresas` | Dossier de una empresa | Deep research maduro (93,9% SimpleQA); nuestros 43 dossiers lo prueban internamente. Para B2B/servicios profesionales. |
| `contenido-linkedin` | Contenido para LinkedIn | Nicho: el autoempleo profesional (2/3 de las micro) vive ahí. Reusa brand-kit. |
| `conciliacion-bancaria` | Extracto vs planilla | Demanda real (bookkeeping US$69-199/mes); matching estructurado, humano confirma. En evaluación. |
| `calculos-laborales-uy` | Aguinaldo, licencia, BPS | Recurrencia probada (la prensa lo re-explica cada semestre; caso Clean-In: liquidaciones 15→1). GUARDA LEGAL: calculadora con fuente oficial citada, "tu contador confirma" — nunca asesoramiento. Revisar antes de vender. |
| `presentaciones` | Presentaciones | pptx maduro técnicamente; demanda floja en pymes 1-9. En evaluación (librería). |
| `turnos-y-agenda` | Agenda de turnos | Demanda FUERTE (agendar = top-3 de compra) pero la versión honesta necesita la conexión de calendario/canal. ESPERA a la conexión google-workspace; no vender la versión coja. |
| `respuestas-de-resenas`* | (evaluar como flujo de soporte, no capacidad) | Redactar es nativo del modelo; publicar es conexión. Si entra, entra como flujo. |

## INTERNAS — existen pero no se venden como fila

- `navegar-sitios` (browser): **DEGRADADA de "candidata a base" a interna.**
  La evidencia fue brutal: ~60% de éxito vs 78% humano, CAPTCHAs fallan 36%,
  Cloudflare bloquea agentes por defecto, Operator deprecado. Queda como
  habilitador detrás de monitoreo/licitaciones donde el flujo es acotado y
  probado. No prometerle a un cliente "entra y hace el trámite".
- `diagramas` (mermaid): garnish de los entregables, no fila vendible.
- `pdf-utiles`, `indicadores-uy`, `precios-y-margenes`, `informes-periodicos`:
  se disuelven en base + cron; no son filas.

## AFUERA (con el porqué, para no reabrir sin dato nuevo)

| candidata | veredicto |
|---|---|
| `video` (video_gen) | US$1,5-12 por clip de 30s con retries ⇒ 2/semana = US$40-240/mes. Rompe el precio SIEMPRE. Revisar cuando baje 10x. |
| `voz` (tts) | Gap demo→prod mata 60% de deployments; TTS premium rompe presupuesto; a16z: sin disposición a pagar en pymes fuera de "llamada perdida" — y telefonía no es nuestra infra hoy. Anotar como oportunidad futura (recepcionista = categoría de US$49-299/mes que SÍ paga). |
| `subtitulos`, `videos-con-plantilla` | Colgadas de video; sin señal propia. |
| `paginas-simples` | **La mató Uruguay**: 54,6% "no necesito web"; el local es WhatsApp/IG/MELI. Los artefactos HTML siguen como FORMA de entregar, no como capacidad vendida. |
| `qr-y-etiquetas` | Sin señal de demanda; si un cliente lo pide, sale de base por code_execution. |
| `traduccion`, `redaccion-de-mails` | Nativas del modelo — filas de aire (patrón Jasper/Grammarly). |
| `encuestas-a-clientes` | Las respuestas piden un backend que no existe. |
| `analisis-de-competencia`, `monitoreo-mercadolibre` | Se disuelven en monitoreo-web + investigacion-de-empresas. |
| `seguimiento-de-envios` | Depende de navegar en sitios de correos hostiles al scraping. |
| `ocr-masivo` | Trabajo puntual de alta, no suscripción: se hace con base cuando toca. |
| `calendario-de-contenido`, `seguimiento-de-leads` | Flujos de rol (ya estaba decidido). |

## Consecuencias fuera del catálogo (anotar, decidir aparte)

1. **El rol de contabilidad/administración es el más vendible según la
   evidencia**, no marketing: cotizar+cobrar+facturas+conciliar es el cluster
   con plata. El orden de construcción de capacidades debería seguirlo.
2. **Tope de tokens por rol/capacidad** no es optimización, es supervivencia
   del precio: el riesgo nº1 de los US$25 es un loop sin tope, no una imagen.
3. **Vouchers ANDE "Modo Digital"** (hasta $U 800.000, 60% no reembolsable,
   US$7M en 2025-26): canal de venta subsidiado — mirar si tuagente puede
   entrar como proveedor.
4. Barrera nº1 de adopción en UY = "falta de conocimiento" (49%), no costo:
   valida el modelo "nosotros instalamos y auditamos" y el copy debe decirlo.
5. La brecha es peor en el interior (menos capacidad digital, más venta por
   mensajería): el producto remoto-por-WhatsApp encaja ahí.

## Orden de construcción propuesto (si la poda aprueba)

1. Base 4: `calculo-y-planillas`, `vision`, `busqueda-web` (perillas) +
   `transcripcion` (empaquetar skill existente).
2. `presupuestos` y `facturas-a-datos` — el cluster que paga, y ambos son
   kit-skill sobre base.
3. `resumen-de-reuniones` (colgada de transcripción) y `base-de-conocimiento`.
4. `seguimiento-de-cobranzas`, `monitoreo-web` (diario), `licitaciones-uy`.
5. Paquete social: ya existe el 80% (brand-kit, social-content, post-image);
   falta solo el reposicionamiento del copy y `formato-redes`.
6. El menú ampliado, por demanda real de clientes.
