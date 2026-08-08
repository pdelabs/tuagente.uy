# Alta de un cliente nuevo — paso a paso

Sacado de haberlo hecho una vez (La Mano). Lo marcado "verificado" ya lo probamos.

---

## Fase 0 — Lo que hay que juntar antes de tocar nada

**Del cliente:**
- El **proceso** concreto que quiere resolver, con su gente y sus pasos.
- **Qué jamás puede pasar sin su OK.** Esta respuesta define el SOUL entero.
- Acceso a los sistemas que el agente va a usar (casilla, planilla, CRM).
- Quién es el humano responsable: el que aprueba y al que se le avisa.

**Nuestro:**
- `API_SERVER_KEY` (`openssl rand -hex 32`) — única por cliente, nunca reusada.
- Clave del proveedor de modelos (OpenRouter en nuestro caso).
- Servidor: Railway si necesita WhatsApp o que el portal se vea desde afuera.

**Costo real de operación** (medido en un mes de La Mano): **USD 2 de cómputo**.
Lo que se cobra es la operación, no los tokens.

---

## Fase 1 — Elegir el canal (la decisión con más consecuencias)

### Telegram — 5 minutos, gratis, funciona hoy
1. `@BotFather` → `/newbot` → nombre y usuario → devuelve el **token**.
   **Username SIEMPRE `tuagente_<slug>_bot`** (ej. `tuagente_east_bot`): son
   nuestra marca en el teléfono del cliente y así se reconocen entre sí.
   OJO: BotFather no deja cambiar el username después — elegirlo bien a la
   primera (el de East quedó `east_eco_bot`, anterior a esta regla).
2. El cliente NO necesita pasar su user id: le manda un hola al bot, recibe
   el código de pairing y lo pega en el portal (pestaña Conexiones, estado
   "Lista para vos") — la activación corre sola por el adapter. El
   `TELEGRAM_ALLOWED_USERS` inicial lleva solo nuestro id de soporte.
3. `TELEGRAM_BOT_TOKEN` y `TELEGRAM_ALLOWED_USERS` en el `.env`, y el home
   channel para los avisos proactivos.
4. **La foto del bot**: cuando el cliente bautiza a su agente, el portal
   captura el agentito elegido y lo deja en `data/bot_avatar.png`. Se sube con
   `hermes-kit/tools/avatar-bot.py` (Telethon vía MTProto — la Bot API no deja
   que un bot cambie su propia foto). Requiere una vez: api_id/api_hash de
   my.telegram.org en `.secrets/telegram_api.json`, y
   `python3 -m venv ~/.tuagente-tools && ~/.tuagente-tools/bin/pip install telethon`.
   Fallback manual: `@BotFather` → `/setuserpic`.
   El **nombre** sí: cuando el cliente bautiza a su agente en el portal, el
   adapter le pega un `setMyName` al bot (adapter 0.26+). O sea que después del
   bautizo el bot ya se llama como el agente; solo falta subirle la carita.

Es el canal para arrancar, para pilotos y para el equipo interno. Verificado.

### WhatsApp — dos caminos, y uno es una trampa
- **`hermes whatsapp` (puente por QR, Baileys/whatsmeow):** se aparea escaneando
  un QR con un WhatsApp normal. Rápido y gratis, pero **es un cliente no oficial:
  Meta puede banear el número**. Jamás en la línea comercial de un cliente. Como
  mucho, en un número descartable para una prueba interna.
- **`hermes whatsapp-cloud` (API oficial de Meta):** lo que se usa en producción.
  Requiere:
  - Cuenta de **WhatsApp Business** y Business Manager verificado.
  - Un **número que NO esté activo en WhatsApp común** (si lo está, hay que
    migrarlo y pierde el uso normal).
  - Una **URL pública de webhook** → obliga a hosting real (Railway), no sirve
    una máquina en la oficina.
  - **Plantillas aprobadas por Meta** para iniciar conversación fuera de la
    ventana de 24 h. Sin esto el agente solo puede responder, no avisar.
  - Aprobación de Meta: son días, no minutos. **Empezar por acá el proyecto.**

### Otros
- **Email:** casilla propia del cliente + app password (o SMTP). Verificado.
- **Formulario web:** un POST al API server, como hace la landing de pdelabs.

---

## Fase 2 — Levantar el agente

Copiar el `docker-compose.yml` del fixture. Dos servicios, **uno por cliente**,
cada uno con su volumen y su clave — nunca compartidos:

- `hermes` — gateway, puertos 8642 (API) y 9119 (dashboard), **solo loopback**.
- `portal-adapter` — nuestro sidecar, 8643, misma imagen y mismo volumen.

Variables que si faltan rompen algo silenciosamente:

| Variable | Servicio | Si falta |
|---|---|---|
| `AGENT_NAME` | adapter | el portal muestra "Agente" |
| `API_SERVER_CORS_ORIGINS` | hermes | el browser descarta todo |
| `PORTAL_CORS_ORIGINS` | adapter | ídem |
| `TZ` | ambos | las tareas corren a la hora equivocada |

---

## Fase 3 — Instalar el kit

Copiar a `data/skills/`: `artifact`, `entregable`, `aprobacion`.
Copiar `data/scripts/portal_adapter.py`.

**Cada `SKILL.md` tiene que tener frontmatter con `name` y `description`.** Es lo
único que el agente lee para decidir si abre la skill; sin frontmatter se indexa
con la descripción vacía y queda como un nombre suelto que no usa nunca. La
descripción dice **qué hace y cuándo usarla**.

Hermes se encarga del resto: detecta los archivos nuevos por fecha y tamaño y
reconstruye su índice solo, sin comandos ni reinicios — pero **no es
instantáneo** (en nuestra prueba tardó ~20 minutos). Si acabás de copiar el kit y
el agente dice que no conoce una skill, esperá y volvé a probar antes de
diagnosticar nada.

---

## Fase 4 — Escribir el SOUL

Lo único verdaderamente artesanal, y donde está el valor. Mínimo:
- Quién es el agente y para quién trabaja.
- **La regla dura de aprobación** (lo que sacamos en la Fase 0).
- Dónde va cada cosa: entregables por skill, andamiaje a `workspace/interno/`.
- Cuándo conviene un artefacto en vez de texto.
- Qué hacer con las referencias del portal y con los archivos de `entrada/`.

Regla de oro: si una convención importa, que la ejecute un script. El SOUL
decide *cuándo*; el código define *cómo*.

---

## Fase 5 — Tareas programadas

Se crean **por CLI** (`hermes cron create`), no con un yaml — eso ya lo
intentamos y no funciona.

**Trampa encontrada el 2026-08-04:** una tarea creada desde una sesión del portal
queda entregando a esa sesión, que es HTTP pregunta-respuesta y **no puede recibir
mensajes**. Corre bien y no llega nada, sin aviso. Siempre fijar un canal que
pueda recibir (Telegram/WhatsApp) al crear la tarea.

---

## Fase 6 — Verificar antes de entregar

```bash
python3 tools/portal-check.py --key <API_SERVER_KEY> \
    --adapter http://<host>:8643 --endpoint http://<host>:8642 \
    --origin https://app.tuagente.uy
```

**0 fallas** o no se entrega. Después, a mano, el circuito que vende el producto:

1. Pedirle algo por chat → responde.
2. Pedirle una visualización → crea el artefacto y lo cita.
3. Pedirle algo que requiera permiso → aparece en Aprobaciones con su tabla.
4. Corregir y aprobar → se destraba con tu versión asentada.
5. Crear una tarea desde el tablero y comentarla → el agente la ve.
6. Programar un recordatorio → **llega al canal** (ver Fase 5).

---

## Fase 7 — Entregar el acceso

`https://app.tuagente.uy/app#endpoint=<api>&adapter=<adapter>&key=<clave>`

**El link es la credencial**: quien lo tiene, tiene el agente. Por canal privado,
y una clave distinta por cliente.

---

## Cuánto lleva hoy

Telegram + un proceso simple: **1 a 2 días** de trabajo real, la mayoría en la
Fase 0 y la Fase 4. Con WhatsApp oficial: **sumar la espera de Meta**, que no
depende de nosotros — por eso se arranca por ahí.

## Lo que falta para que sea de un día

- Un repo `hermes-kit` con las skills + el adapter + un script de alta.
- Plantillas de SOUL por tipo de negocio.
- Terraform/Railway template en vez de copiar el compose a mano.
