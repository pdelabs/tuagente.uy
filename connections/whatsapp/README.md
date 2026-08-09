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

---

## Lo que costó ponerlo a andar (9/8/2026)

El repo **no funciona como viene**. Queda anotado porque es el costo real de
esta vía, y se va a repetir cada vez que Meta mueva algo.

1. **`Client outdated (405)`** — el repo pinnea whatsmeow de marzo 2025 y
   WhatsApp ya no lo acepta. Hubo que subirlo a la versión de agosto 2026.
2. **Cinco cambios de API** en whatsmeow al actualizar: `Download`,
   `sqlstore.New`, `GetFirstDevice`, `GetGroupInfo` y `Contacts.GetContact`
   ahora piden `context.Context`. Y Go 1.25 como mínimo.
3. **El pareo arrancaba solo** al levantar el contenedor: pedía un QR que
   nadie miraba, se vencía a los 3 minutos, reiniciaba y volvía a pedir otro
   — quemando sesiones para siempre. Ahora es a demanda.

Los parches están en `bridge/main.go.patch`. Al actualizar el upstream hay que
reaplicarlos.

## Nuestros parches al bridge

- **Pareo a demanda**: `POST /pair/start`, `GET /pair/status`,
  `GET /pair/qr.png`. El REST arranca siempre, con o sin sesión.
- **QR como PNG** además del de terminal, para que el portal lo muestre.

El adapter los proxea con auth (`/portal/connections/whatsapp/pair/*`) y el
portal tiene su propio diálogo, `DialogoWhatsApp.tsx`. El QR se trae por fetch
con bearer y se dibuja como blob: un `<img src>` no manda el header, y un
código de pareo no puede quedar abierto.
