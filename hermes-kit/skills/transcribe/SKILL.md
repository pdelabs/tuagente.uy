---
title: Transcripción de audio y video
client_summary: "Convierte una entrevista, reunión o nota de voz en texto."
name: transcribe
description: "Transcribe un audio o video (entrevista, reunion, nota de voz, mp4/mp3/wav) a un archivo de texto usando la conexion de modelos del cliente. Usala siempre que necesites el contenido hablado de un archivo, en vez de intentar procesarlo vos o pedir que te lo pasen escrito."
version: 1.0.0
license: MIT
---

# transcribe — de audio o video a texto

Cuando tengas un **audio o video** y necesites lo que se dice adentro
(una entrevista para resumir, una reunión para minutar, una nota de voz),
usá esta skill. No intentes leer el archivo vos: es binario.

## Uso

```bash
python3 /opt/kit/skills/transcribe/transcribe.py \
  --file /ruta/a/entrevista.mp4
```

Devuelve un JSON con `transcript` (la ruta del `.txt` con el texto completo),
un `preview` de los primeros caracteres, la duración y el costo. **El texto
completo está en el archivo — leelo de ahí**, el vistazo es solo para confirmar
que salió bien.

- `--language`: default `es`. Solo cambialo si el audio está en otro idioma.
- `--output`: dónde dejar el `.txt`. Sin esto, queda al lado del archivo
  original con sufijo `.transcript.txt`.

## Qué resuelve el script (no lo hagas vos)

- Elige el modelo y el proveedor — no pases otro modelo.
- Convierte videos y audios pesados con ffmpeg antes de subir.
- Fija el idioma: sin eso el proveedor a veces devuelve el texto **traducido**.

## Si falla

El JSON trae `error` en palabras claras. Los dos casos esperables:
- `falta OPENROUTER_API_KEY` → la conexión de modelos no está configurada:
  decile al cliente que pida la conexión "Modelos de IA auxiliares".
- El archivo no existe → verificá la ruta (¿estás en el directorio del ticket?
  usá rutas absolutas).
