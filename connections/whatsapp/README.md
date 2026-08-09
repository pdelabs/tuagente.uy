# WhatsApp

Dos caminos, y la diferencia importa más que cualquier detalle técnico.

## Cloud API (oficial)

La única vía compatible para un número comercial. Pide cuenta de WhatsApp
Business, Business Manager **verificado ante Meta** y un número que no esté
activo en WhatsApp común.

**Cuánto lleva:** días, por la verificación. Después no se toca nunca más.

**Ojo con el diagnóstico:** la app de WhatsApp Business (la gratuita) NO pide
verificación — es otra cosa. Un cliente que ya hace catálogo o pauta en Meta
probablemente ya tenga el Business Manager verificado y para él son horas. Uno
que solo usa la app, arranca de cero. Preguntar antes de prometer un plazo.

## Puente por QR (whatsapp-mcp)

Se aparea escaneando un QR con un WhatsApp normal. Cinco minutos y gratis.

**El riesgo, dicho como es:** usa `whatsmeow`, una librería de ingeniería
inversa del protocolo de WhatsApp Web. Viola los términos de Meta, que desde
2025 viene detectando y bloqueando automatización de forma agresiva. **Le
pueden bloquear el número.**

**Regla:** nunca en la línea comercial de un cliente. Solo en un número
descartable, para una prueba, y con el riesgo dicho por escrito antes.

## Qué se instala

Un servicio más en el compose (ver `compose.yml`), con su bridge de Go y su
SQLite. Ese SQLite guarda el historial de mensajes del dueño: vive dentro de su
volumen y no sale de ahí.

El agente **no habla con este servicio**. Habla con el decorator, que es el
único que puede alcanzarlo y el que aplica la política de `tools.json`.

## Política por defecto

Ocho herramientas leen y cuatro actúan (ver `tools.json`). Arranca con **leer
sí, actuar no** — mandar mensajes se habilita después, a mano, desde el portal.

`download_media` quedó del lado de "actúa" aunque el nombre diga lo contrario:
escribe en disco y baja lo que le manden.

## Lo que falta construir

La pantalla del QR en el portal. El bridge lo expone; el portal todavía no lo
muestra. Sin eso, aparear es una tarea nuestra por consola.
