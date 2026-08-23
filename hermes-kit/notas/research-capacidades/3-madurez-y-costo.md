# Research 3 — Madurez y costo real de las capacidades de agentes (19/8/2026)

Agente de investigación sobre benchmarks, postmortems y precios 2025-2026,
contra nuestro presupuesto de ~US$25/mes por rol.

## 1. Madurez

- **Browser/computer-use lejos del nivel humano**: WebArena ~60-62% de éxito (IBM CUGA 61,7%) vs 78% humano; OSWorld ~62% vs 72%. FUERTE.
- **Y los números estaban inflados**: WebArena Verified encontró evaluaciones mal alineadas y string-matching que inflaba resultados. FUERTE.
- **En producción: "70-95% según tipo de tarea", solo acotada y supervisada**; falla con anti-bots, 2FA, drag-drop, UIs raras. "Agentes que hacen cualquier cosa en tu browser sigue siendo demo-ware" (Zylos, Scrapfly 2026). FUERTE.
- **Causas medidas**: ads flotantes rompen 73% de lecturas; CAPTCHAs fallan 36%. MEDIA.
- **Operator (OpenAI): <50% de éxito en sitios reales; deprecado ago-2025.** FUERTE.
- **Voice agents: maduros solo en nicho acotado**; latencia real P50 1,4-1,7s (5-8x el turn-taking humano). Hamming AI sobre 4M+ llamadas. FUERTE.
- **Gap demo→prod mata ~60% de deployments de voz**: STT pierde 10-25% accuracy con ruido; hallucinations 3-5x con inputs no vistos. MEDIA.
- **OCR/extracción con LLM: lo más maduro de la lista** — Gemini 2.5 Pro 94% en facturas escaneadas, 96-98% en PDFs con texto; degrada con escaneos malos. FUERTE.
- **Planillas por código: crear planillas simples maduro (~82% SpreadsheetBench v1); tareas profesionales end-to-end <35% (v2), incluso Claude/ChatGPT for Excel.** FUERTE.
- **Documentos office (xlsx/docx/pptx) vía skills: maduro**, estilos preservados, CSV→deck en un prompt. MEDIA.
- **Imagen de marca: el render de texto se resolvió en 2025** (Nano Banana); edición de producto para e-commerce es uso corriente. FUERTE.
- **RAG/KB: la técnica maduró, el mantenimiento no** — 73% de deployments fallan el primer año por base desactualizada, no por el modelo; el fallo es silencioso (responde con confianza sobre docs viejos). MEDIA.

## 2. Costos vs US$25/mes por rol

- **Imagen: US$0,005-0,06/imagen** (GPT Image Mini $0.005, Imagen 4 Fast $0.02, Flux 2 Pro $0.055); 200 img/mes ≈ US$1-8. ENTRA. FUERTE.
- **Transcripción: US$0,0035-0,008/min**; 40 h/mes ≈ US$9-18. Entra; uso intensivo lo roza. FUERTE.
- **TTS: OpenAI US$15/M caracteres entra; ElevenLabs (US$48-180/M) ROMPE el presupuesto con uso sostenido.** FUERTE.
- **Video: US$1,50-12 por clip de 30s** (US$0,03-0,70/seg; con 3-5 retries un clip útil cuesta US$5-30); 2/semana ≈ US$40-240/mes. ROMPE SIEMPRE. FUERTE.
- **Search APIs: US$5-9/1.000 requests** (Brave $5, Exa $7, Tavily ~$8, x2 advanced). Watcher HORARIO ≈ US$36-58/mes (rompe); watcher DIARIO ≈ US$1-2 (entra). FUERTE.
- **El costo dominante son los tokens del loop agéntico, no las capacidades**: 5-50x los tokens de un chat; una tarea sin límites puede costar US$5-8 sola. Riesgo nº1 con US$25/mes: browser agent o deep research en loop de retries. Mitigación: caps, router barato, prompt caching (−50%). FUERTE.
- **Tendencia 2023→2026: input tokens −85%; imagen y STT bajaron; video sigue caro.** Favorece el modelo de US$25/rol salvo video y voz premium. MEDIA.

## 3. Combos ganadores con producto real

- **Transcripción+resumen (minutas) = EL combo probado**: Fireflies en 75% del Fortune 500; Granola SOC-2; 4-5 jugadores rentables. FUERTE.
- **OCR+conciliación (captura de gastos)**: 90-95% accuracy real (vendors claman 99); baja costo por recibo de $0,70 a $0,23; el valor = OCR + matching + flag de excepciones, con humano para lo crítico. FUERTE.
- **Scraping programado+alertas (price watch)**: mercado US$1,2B (2024)→US$2,5B (2033); vía estable = scraping estructurado/search API + LLM matching, NO browser agent libre. FUERTE.
- **Voz+agenda (recepcionista)**: ROI documentado (778 leads en 4 meses, 76% conversión) pero cifras de vendors. MEDIA.
- **Search+síntesis (deep research)**: adopción real medida (Harvard/Perplexity); 93,9% SimpleQA; reportes <3 min con ~50 fuentes. FUERTE.
- **Datos→documento (CSV→planilla→deck)**: skills de Anthropic + Agent Mode de Excel validan "el agente entrega el archivo, no un texto". MEDIA.

## 4. Qué NO prometer

- **Extracción que alucina valores plausibles en campos vacíos: 1-3% en extracciones financieras** — invisible sin validación por campo. No prometer extracción sin revisión hacia contabilidad. FUERTE.
- **Whisper inventa frases en ~1-1,4% (disparado por silencios); 38% de esas invenciones con contenido dañino.** Mitigar con VAD; no prometer literal para legal/médico. FUERTE.
- **Browser rompe en el peor momento** (checkout, login, CAPTCHA) y cada retry cuesta; sincronización entre tabs "frágil en 2026". FUERTE.
- **La web se cerró a los agentes: Cloudflare (~20% de internet) bloquea crawlers IA por defecto desde jul-2025**; desde sep-2026 bloquea "agent use" en páginas con ads. Search APIs pagas = vía estable. FUERTE.
- **Imagen: el problema es consistencia y backlash, no calidad** — 50 imágenes parecen 50 artistas sin sistema de estilo; "AI slop" palabra del año 2025; desconfianza del consumidor 20%→40% (2025→2026). Prometer "assets con guía de estilo", nunca "tu campaña completa". FUERTE.
- **Voz en ambientes abiertos falla en público**: Taco Bell frenó rollout de 500+ locales (loops + sabotaje viral). Voz sí para llamadas 1-a-1 estructuradas. FUERTE.
- **El fallo agéntico típico es silencioso y compuesto**; Gartner: >40% de iniciativas agénticas canceladas antes de 2027 — por falta de capa de resiliencia, no del modelo. MEDIA.
- **El patrón de éxito = alcance chico + dominio específico** (MIT NANDA: 95% de pilotos sin impacto en P&L; el 5% ganador es tightly scoped y con partner externo — 67% de éxito con expertise externa vs 22% interno). Nosotros somos el partner externo. MEDIA.

## Síntesis operativa

Seguras hoy: OCR/extracción con validación, transcripción+minutas, documentos
office, imagen con guía de estilo, search/deep-research acotado.
Acotar o no prometer: browser libre, voz en tiempo real, video.
Contra US$25/rol: video rompe siempre; TTS premium y monitoreo horario rompen
con uso normal; el riesgo silencioso son los loops sin tope ⇒ budget cap por
rol y por capacidad.
