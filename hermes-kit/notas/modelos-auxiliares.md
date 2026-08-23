# Modelos auxiliares por cliente (OpenRouter + keys dedicadas)

Decisión de Luis (2026-08-06): **cada cliente tiene su propia API key de
OpenRouter**, y el agente sabe que esa capacidad existe — puede usar otros
modelos además del suyo para tareas puntuales: transcribir un audio, generar o
describir una imagen, un razonamiento pesado aislado.

## El modelo real (refinado 6/8/2026, primer alta: East)

**Organización "tuagente" en OpenRouter** (dentro del login de Luis) + **una
key por cliente** creada vía Management API, con límite de gasto propio:

- El cliente NUNCA toca OpenRouter (mismo principio que Google: cero consolas).
  Paga tuagente todo incluido; el pozo de créditos es de la org.
- La key de cada cliente tiene nombre, límite en USD y gráfico de gasto propio
  en Activity → auditoría por cliente gratis, y una key filtrada compromete a
  UN cliente y se rota con un `PATCH`.
- Alta automatizable: `POST https://openrouter.ai/api/v1/keys` con
  `{"name": "<cliente>", "limit": N}` y auth de la management key
  (`tuagente.uy/.secrets/openrouter_provisioning.key`). La management key es
  solo administrativa: no sirve para llamar modelos.

## Reparto de responsabilidades (el principio de siempre)

**La skill decide el proveedor y el modelo; el agente solo dice qué necesita.**
Si el agente eligiera modelo por su cuenta, cada corrida usaría uno distinto y
el costo sería impredecible. Cada capacidad es una skill del kit con el
proveedor fijado en código:

| Capacidad | Proveedor v1 | Env | Nota |
|---|---|---|---|
| LLM del agente | OpenRouter (Luna) | `OPENROUTER_API_KEY` | ya existe |
| Transcripción (STT) | **OpenRouter — VERIFICADO 6/8/2026** | `OPENROUTER_API_KEY` | ver abajo |
| Generación de imágenes | OpenRouter (modelos de imagen) | `OPENROUTER_API_KEY` | verificar modelos disponibles al construir la skill |
| Análisis de imagen/video | modelo con visión vía OpenRouter | `OPENROUTER_API_KEY` | |

No prometer una capacidad en el SOUL de un cliente hasta que su skill exista y
esté probada con material real de ese cliente.

## Transcripción por OpenRouter (verificado en vivo, 6/8/2026)

Luis tenía razón: OpenRouter agregó `transcription` como modalidad de salida
(14 modelos: `openai/whisper-large-v3`, `deepgram/nova-3`, Voxtral, Qwen ASR…).
Endpoint OpenAI-compatible, multipart:

```bash
curl -X POST https://openrouter.ai/api/v1/audio/transcriptions \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -F "file=@audio.wav" -F "model=openai/whisper-large-v3" -F "language=es"
```

- Devuelve `{"text": ..., "usage": {"seconds", "cost"}}`.
- Costo medido con large-v3: USD 0.000115 por 4,6 s (~USD 0.09/hora). El default
  de la skill es **`openai/whisper-large-v3-turbo`: USD 0.04 por HORA** (12% WER
  vs 10.3% del grande — irrelevante para punteos), acepta mp3/mp4/wav/webm/
  flac/ogg. `whisper-1` limita archivos a 25 MB; para entrevistas largas la
  skill extrae y comprime el audio con ffmpeg antes de subir.
- **`language=es` es OBLIGATORIO**: sin él, Whisper nos devolvió el audio en
  español TRADUCIDO al inglés (reproducido en el primer intento). La skill lo
  fija en código, nunca lo decide el agente.
- La doc pública de OpenRouter todavía no documenta este endpoint (las páginas
  de audio solo mencionan `input_audio` por chat-completions) — el filtro
  `?output_modalities=transcription` de la API de modelos sí lo lista.
- Nota: estos 14 modelos NO aparecen en `/api/v1/models` sin el filtro; hay que
  pedirlo explícito.

Conclusión: **una sola key por cliente cubre LLM + STT + imágenes.** No hacen
falta keys dedicadas (Groq/OpenAI) salvo que un caso concreto lo pida.

## Detección

Entrada `modelos-auxiliares` en `connections/catalogo.json`: presencia de
`OPENROUTER_API_KEY`. Las keys dedicadas (Groq/OpenAI) se detectan cuando la
skill que las usa esté en el kit.

## Primer caso real

Piloto East Comunicación (transcripción de entrevistas + punteos + propuesta
de imágenes). El diseño del flujo vive en `tuagente.uy/docs/piloto-east.md`;
lo que resulte genérico (skill `transcribir`, skill de imágenes) vuelve acá.
