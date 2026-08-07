# Piloto East Comunicación (Cata) — primer cliente real

Decidido 2026-08-06. Primer cliente real de tuagente, bajo la estructura nueva:
**instalación gratis + mes 1 de piloto gratis**. Cata es comunicadora freelance
con varios clientes finales; su entrevista tipo termina al aire en TV.

## El flujo de hoy (manual, por entrevista)

1. Le suben la entrevista (mp4) a Google Drive.
2. Descarga el video y lo corre con Whisper → transcripción.
3. Pasa la transcripción por ChatGPT **con su prompt** → punteos más
   importantes.
4. Busca imágenes de la coyuntura real (Google, Instagram, prensa) — en TV
   ponen esas imágenes y los punteos van abajo como headlines/zócalos.

## El flujo con agente — v1 (línea honesta de lo que se automatiza)

| Paso | Quién | Cómo |
|---|---|---|
| Detectar mp4 nuevo en Drive | agente (cron) | cuenta de servicio de Google con la carpeta compartida — sin OAuth, sin expiración de tokens |
| Bajar video, extraer audio | agente | ffmpeg en el contenedor (verificar que la imagen lo trae) |
| Transcribir | agente | skill `transcribir` del kit (Groq Whisper u OpenAI — decidir al construir) |
| **Zócalos para TV (flujo del piloto)** | agente | skill `frases-zocalo`: 10 frases/quotes/titulares EN MAYÚSCULAS para la edición del programa — prompt de Cata verbatim (recibido 6/8). Su encargo real vive en una conversación larga de su herramienta anterior; los ajustes acumulados se recuperan con sus ejemplos y con feedback |
| Noticia para redes (2.º flujo: Radio Viva) | agente | skill `redactar-noticia` (titular + copy, prompt de Cata verbatim). Ya redactada; se activa cuando el material es de ese flujo |
| Imágenes de coyuntura | **mixto** | v1: el agente propone búsquedas y links concretos por punteo; Cata elige. Scrapear Instagram/Google Imágenes es frágil y con problemas de derechos — no prometerlo |
| Entrega | agente | entregable en el portal (transcripción + punteos + headlines + links) + aviso por Telegram |

**Multi-cliente de Cata:** una carpeta de Drive por cliente final; el
entregable sale etiquetado con ese cliente. El SOUL lista sus clientes y el
tono de cada uno.

**Regla del piloto:** todo lo genérico que este flujo necesite (skill
transcribir, skill imágenes, detección de Drive) entra al KIT, no al agente de
Cata. En su agente solo viven su SOUL, su prompt y sus carpetas.

## Decisiones técnicas ya tomadas

- **Drive por cuenta de servicio, no OAuth** (v1): Cata comparte la carpeta con
  el mail de la cuenta de servicio y listo. Evita la app OAuth publicada, la
  expiración de 7 días y todo el trámite (ver
  `hermes-kit/connections/google-workspace.md` — sigue válido para cuando un
  cliente necesite *escribir* en sus planillas con su identidad).
- **OpenRouter por cliente** como capacidad global del kit — documentado en
  `hermes-kit/notas/modelos-auxiliares.md`. STT probablemente necesite key
  dedicada (Groq/OpenAI); la skill decide, no el agente.
- **Hosting: Railway desde el día 1 del uso real.** La mañana del 6/8 la Mac
  tuvo dos cortes de red y un apagón de Docker. Se construye y prueba local; se
  despliega a Railway antes de que Cata dependa de esto (~USD 7/mes).

## Qué necesitamos de Cata / Luis (manual)

1. **El prompt de los punteos** (el que usa en ChatGPT), tal cual.
2. **Una entrevista real de ejemplo** (mp4) **y el resultado final emitido**
   (cómo quedaron headlines e imágenes al aire) — calibra el entregable.
3. Carpeta(s) de Drive compartidas con la cuenta de servicio (creamos nosotros
   el proyecto GCP y le pasamos el mail a compartir).
4. Key de OpenRouter a su nombre + key de STT (creamos nosotros, gasto a su
   cuenta).
5. Lista de sus clientes finales y dónde quiere los avisos (Telegram).

## Criterio de éxito del piloto (pactar con ella antes de empezar)

De mp4 subido a entregable listo sin tocar nada, en menos de X minutos, con
punteos que use sin reescribir. Si en 30 días no le ahorró horas reales, se
apaga y no pagó nada.
