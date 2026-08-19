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
- **Clave SSH del servidor, también una por cliente** y con el mismo criterio:
  `ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519_tuagente_<slug> -C "tuagente_<slug>"`.
  En Hetzner se carga con ese mismo nombre (`tuagente_east`), igual que los
  bots son `tuagente_<slug>_bot`. Si se compromete la de un cliente, no abre
  los servidores de los demás.
- Clave del proveedor de modelos (OpenRouter en nuestro caso).
- **Servidor: una VPS por cliente** — Hetzner CX23 (2 vCPU, 4 GB, 40 GB,
  20 TB) a USD 7,09 con la IPv4. No una caja compartida: Hermes ejecuta código
  y un contenedor no es un límite duro contra un agente al que le inyectaron
  instrucciones. A ese precio el aislamiento sale casi gratis.
  - Al crearla: **SSH key sí o sí** (sin ella Hetzner manda la contraseña de
    root por mail), **backups activados** (+20%; ahí vive toda la memoria del
    cliente) y después un **Firewall de Hetzner** con solo 22, 80 y 443.
  - El firewall de Hetzner es mejor que `ufw` **porque vive afuera de la VM**:
    Docker no lo puede saltear escribiendo iptables por debajo, que es
    exactamente lo que hace `docker publish`.
  - El alta la corre `hermes-kit/desplegar-remoto.sh`.

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

El compose **no se copia a mano**: lo genera `hermes-kit/nuevo-agente.sh`, con el
slug, el nombre y los puertos ya resueltos.

```bash
./nuevo-agente.sh acme "Acme SA" ~/Desktop/Luis/Projects/agente-acme [8642]
```

Dos servicios, **uno por cliente**, cada uno con su volumen y su clave — nunca
compartidos:

- `hermes` — gateway, 8642 (API) y 9119 (dashboard, apagado), **solo loopback**.
- `portal-adapter` — nuestro sidecar, 8643, misma imagen y mismo volumen.

**Los puertos son los del host y se pasan como cuarto argumento** (el adapter va
en el siguiente). Por defecto 8642/8643, que es lo correcto con una VPS por
cliente; si en ese host ya vive otro agente hay que moverlo (8742, 8842…). El
script verifica que estén libres antes de crear nada: antes quedaban literales
en la plantilla y el choque aparecía recién en el `up -d`, con el SOUL ya escrito.

Variables que si faltan rompen algo silenciosamente:

| Variable | Servicio | Si falta |
|---|---|---|
| `AGENT_NAME` | adapter | el portal muestra "Agente" |
| `API_SERVER_CORS_ORIGINS` | hermes | el browser descarta todo |
| `PORTAL_CORS_ORIGINS` | adapter | ídem |
| `TZ` | ambos | las tareas corren a la hora equivocada |

**Los dos CORS llevan las dos escrituras del loopback** —`http://localhost:8090`
y `http://127.0.0.1:8090`—, y ya vienen así en la plantilla. Para el browser son
orígenes distintos: con uno solo, `curl` anda (no manda `Origin`) y el portal
muestra "No pude hablar con tu agente". Es el clásico "anda por curl y no anda en
el navegador", y lo verifica `portal-check.py` cuando el `--origin` es loopback.

---

## Fase 3 — Instalar el kit

No se copia nada a mano: lo pone `hermes-kit/install.sh <ruta>/data` (y
`nuevo-agente.sh` ya lo corrió). Las skills del kit y el código del adapter
**viven afuera de `data/`** —en `kit-skills/` y `kit-adapter/`, montadas de solo
lectura—, porque `data/` es del agente y podía reescribirlas. Para ver qué
difiere entre un agente instalado y el kit: `install.sh <ruta>/data --diff`.

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

## Fase 3b — Equipos: el cliente que contrata gente

Un cliente de equipo no se levanta distinto. Lo único que cambia es **un archivo,
y va antes de entregarle el link** (Fase 7):

```bash
cp hermes-kit/roles/catalogo.json <ruta-del-agente>/politica/roles/catalogo.json
```

Ese archivo es **la oferta**: qué roles puede sumar este cliente. Y es también el
interruptor — que este agente tenga equipo lo decide la **presencia** del
archivo, nunca un valor escrito: de ahí salen `modules.roles` en el manifiesto y
`GET /portal/roles`. Sin él, el agente es el de siempre y el portal se comporta
como hasta hoy. `install.sh` lo actualiza en cada corrida **si ya está**, pero la
primera copia es a mano: poner la oferta es la decisión de venderle equipo, no un
default.

Con la oferta puesta, el alta la corre el portal solo, la primera vez que el
cliente entra con su link:

1. Elige **un** rol de la oferta (solo los `state: "ready"`: un borrador no se
   ofrece porque el pedido le contestaría 404).
2. Lo bautiza —nombre y cara—, igual que se bautizaba al agente.
3. El pedido queda anotado en `politica/roles/pedidos.jsonl`. **El portal no
   instala nada**, y el cliente se queda en una pantalla de espera.
4. Lo contratamos nosotros, con el nombre que puso él:

```bash
# en la VPS                     / en un agente local
tools/contratar-rol.sh <rol> <host-ssh> [slug] --del-pedido
tools/contratar-rol.sh <rol> --local <ruta-del-agente> --del-pedido
```

Cuando el rol aparece contratado en el roster, la espera se cierra sola y el
portal sigue con lo que falta: de qué es el negocio y por dónde avisarle. **A un
cliente de equipo no se le pide que bautice "su agente"** — bautiza a cada
compañero cuando lo contrata, y ese es todo el bautizo que hay.

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

## Fase 6b — Dejarlo en cero (el paso que faltaba)

**La Fase 6 ensucia el agente, y el cliente abre su portal el primer día.** Si no
se limpia, lo primero que ve es *una conversación nuestra* en el chat, gasto en
la pestaña de Uso y los entregables de prueba en Archivos: aprende que su agente
ya venía usado. No se arregla verificando menos — el circuito de la Fase 6 es
justo lo que hay que probar —, se arregla limpiando después:

```bash
# agente local
hermes-kit/tools/resetear-agente.sh --local <ruta-del-agente> --entrega
# agente en la VPS
hermes-kit/tools/resetear-agente.sh <host-ssh> [slug] --entrega
```

Borra la huella (conversaciones, uso, tablero, aprobaciones, entregables,
artefactos, memorias, el bautizo y la foto del bot) y **conserva lo que se
escribió para este cliente**: el SOUL —menos el bloque `portal:identidad`, que lo
escribe el bautizo—, los flujos y sus tareas programadas. Deja un respaldo antes
de tocar nada. Sin `--entrega` el reset es el completo, que se lleva también el
SOUL: ese es para reciclar un agente, no para entregarlo.

Y se verifica, para que no dependa de acordarse:

```bash
python3 hermes-kit/tools/portal-check.py --key <API_SERVER_KEY> --entrega \
    --endpoint http://<host>:<puerto> --adapter http://<host>:<puerto+1>
```

Con `--entrega`, si queda una conversación, un ticket, un archivo, gasto o el
bautizo puesto, **falla** y dice cómo arreglarlo. **0 fallas o no se entrega.**

Del lado del browser: abrir el portal en una ventana de incógnito. El
`localStorage` se acuerda del nombre y del look aunque el agente ya no, y sin eso
parece que el reset no funcionó.

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
