---
name: Entrevistas → zócalos
client_summary: "Cada entrevista termina en transcripción completa y 10 zócalos listos para la edición."
trigger_type: request
trigger_detail: Cada vez que me pasás una entrevista, o me pedís que revise si llegó material nuevo
skills: lower-thirds,transcribe,deliverable,approval
results: entregables/entrevistas-tv
status: active
---

# Cómo trabajo este flujo

1. Arranco con la entrevista que me pasaste —un link o un archivo—. Si tenés carpetas conectadas como bandeja, miro si llegó algo nuevo; si no hay nada, termino en silencio.
2. **Por cada entrevista abro su ticket** "Entrevista <lo que sea> → zócalos": así el trabajo de cada una se ve en el tablero.
3. Saco el audio y lo **transcribo completo con el modelo**, nunca con los subtítulos automáticos de la plataforma.
4. Elijo los **diez zócalos**: en mayúsculas, con el minuto de cada uno, textuales. Lo que no se entiende va marcado para verificar contra el video, no completado.
5. Dejo **dos entregables**: la transcripción completa y la lista de zócalos, con sugerencias de imágenes.
6. Te pido el sí sobre la lista antes de que vaya a la edición.
7. Cierro el ticket contando qué entregué y dónde, y te aviso por tu canal con el titular — dos líneas, sin tecnicismos.

## Notas técnicas

- **Los subtítulos automáticos no son una transcripción.** Cambian nombres
  propios y cifras, y esto es texto que sale al aire. `fetch_video.py` no los
  baja a propósito, y la transcripción la hace `transcribe.py` sobre la conexión
  de modelos del cliente. Si esa conexión falta, lo dice el script: no se decide
  por impresión y no se entrega una versión degradada sin avisar.
- **El ticket lo abre el script, no la memoria.** `fetch_video.py` lo crea con
  una clave por video, así que reprocesar la misma entrevista no abre un segundo
  ticket. Si ya estás trabajando adentro de uno, no abre ninguno.
- **Diez es diez, salvo que el audio no dé.** Si hay tramos que no se entienden,
  se entregan los que sí y se dice cuántos son y por qué. Rellenar hasta diez con
  frases armadas es exactamente lo que no se puede hacer.
- **Las imágenes se sugieren, nunca se bajan**: derechos ajenos, y la elección
  final es del cliente.
- **La bandeja por Drive es un paso aparte del alta.** Este flujo se arma con
  gatillo `request`, que funciona desde el día uno. Para que además mire solas
  las carpetas hacen falta tres cosas, en este orden: la capacidad
  `drive-inbox` comprada, la conexión de Google conectada por el cliente
  (`google_token.json` en el agente), y los ids de carpeta anotados en el alta.
  Con eso se rearma el gatillo:
  `create_flow.py --slug entrevistas-tv --rearm --trigger drive --folders <ids> --cron "*/15 * * * *"`.
  Un gatillo `drive` sin carpetas es un flujo que el portal muestra activo y no
  puede dispararse nunca — pasó, y por eso el script ahora lo rechaza.
- **Una corrida que no pudo trabajar deja rastro.** Si falta la conexión o una
  credencial venció, va un ticket que diga qué falta y qué se pierde mientras
  tanto. El silencio lo lee el cliente como "no hubo novedades".
