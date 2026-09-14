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
- `--timestamps`: además del texto, escribe un segundo archivo con **el minuto
  de cada tramo** (`[00:19-00:31] lo que se dijo ahí`), y te devuelve su ruta en
  `timecodes`. Usalo **siempre que lo que vas a entregar lleve marca de tiempo**
  —los zócalos, por ejemplo—. No cuesta nada aparte: se paga el audio, no el
  formato de la respuesta.

## Qué resuelve el script (no lo hagas vos)

- Elige el modelo y el proveedor — no pases otro modelo.
- Convierte videos y audios pesados con ffmpeg antes de subir.
- Fija el idioma: sin eso el proveedor a veces devuelve el texto **traducido**.
- Con `--timestamps`, pide y arma las marcas de tiempo. **No las saques de
  oído ni las estimes** contando párrafos: si necesitás minutos, pedilos acá.

## Si falla

El JSON trae `error` en palabras claras. Los dos casos esperables:

- **`no tengo la clave de modelos para transcribir`** → esto **no** es una
  conexión que le falte al cliente. Es un problema de instalación de este
  agente: decilo así, en una línea ("no puedo transcribir porque me falta una
  clave de mi instalación, lo estamos viendo"), **no le pidas la conexión de
  modelos** y no ofrezcas `capability:` ni `connection:` por esto.
- El archivo no existe → verificá la ruta (¿estás en el directorio del ticket?
  usá rutas absolutas).
- **`el proveedor no devolvio segmentos`** (solo con `--timestamps`) → el texto
  quedó guardado, pero los minutos no. No los inventes ni los estimes: decí que
  no tenés las marcas de tiempo y frená.

**En ningún caso sigas sin la transcripción.** Ni con los subtítulos
automáticos de una plataforma, ni escribiendo lo que te parece que dice. Si no
transcribiste, no hay entregable: decís qué pasó y frenás.
