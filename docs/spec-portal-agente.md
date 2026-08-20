# Spec — Portal tuagente + plugin `tuagente-portal`

*v1 · 2026-08-03 · escrita por Claude con las lecciones del fin de semana de La Mano*

## Objetivo

Que cada cliente de tuagente chatee con su agente y opere su pipeline desde una
interfaz web con marca tuagente — sin que pdelabs mantenga más infraestructura
que el agente del cliente.

## Principios (no negociables)

1. **El agente es la única fuente de verdad y la única infraestructura.**
   Todo el estado (tickets, sesiones, archivos, memoria) vive en la instancia
   Hermes del cliente. El portal no tiene base de datos.
2. **El portal es estático.** Next.js en Vercel (repo tuagente.uy, ya deployado).
   Un solo deploy sirve a todos los clientes.
3. **El portal es una ventana, no una jaula.** Cada agente es su mundo con su
   propósito; el portal se adapta al agente vía un manifest de capacidades y
   JAMÁS limita ni intermedia sus poderes nativos (channels, skills, crons,
   proactividad). El approval gate es un módulo que se muestra solo si el
   agente usa ese patrón — La Mano lo usa; otros agentes no tienen por qué.
4. **Nada de tocar la DB del kanban directamente.** Lección del 2026-08-03:
   sqlite con locks, claims y dispatcher + segundo escritor = corrupción.
   Toda escritura pasa por los módulos internos de Hermes (como hace el propio
   plugin del dashboard).

## Arquitectura

```
browser del cliente
  │  (bearer token en localStorage, entregado como magic link)
  ├── chat ──────────► https://<agente>.railway.app:8642/v1/chat/completions
  │                    (OpenAI-compatible, streaming, YA VERIFICADO)
  └── portal API ────► https://<agente>.railway.app:8642/portal/*
                       (plugin tuagente-portal, este spec)

portal tuagente.uy (Vercel, estático)  =  solo UI
agente del cliente (Railway, docker)   =  API + estado + reglas
```

- **CORS**: el plugin agrega los headers CORS para `*.tuagente.uy`. Si el API
  server no lo permite a nivel plugin → fallback: proxy edge en Vercel
  (serverless, sin estado, sin mantenimiento).
- **Auth v1**: el `API_SERVER_KEY` de la instancia como bearer único, sobre
  HTTPS. Suficiente porque la key solo abre ESE agente. v2: token read-only
  con scopes para poder compartir acceso de solo-lectura.

## Plugin `tuagente-portal` (corre dentro de cada agente)

Python en `data/plugins/tuagente-portal/` (punto de extensión sancionado;
sobrevive updates de imagen; versionado en el git del agente).

### Endpoints v1

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/portal/manifest` | capacidades de ESTE agente: módulos activos (kanban, approvals, files…), channels conectados. El portal se renderiza según esto |
| GET | `/portal/health` | agente vivo, modelo activo, versión |
| GET | `/portal/approvals` | tickets `blocked` con `needs_input` → `[{id, título, resumen, draft, fecha}]` |
| POST | `/portal/approvals/{id}/approve` | comenta "aprobado vía portal" + unblock → el worker ejecuta (mecanismo comment→worker VERIFICADO el 2026-08-03) |
| POST | `/portal/approvals/{id}/reject` | comenta el motivo, mantiene blocked |
| GET | `/portal/tickets?tenant=&q=` | lectura del kanban (filtros = tenant + búsqueda en título, la convención de tags existente) |
| GET | `/portal/activity` | últimas N: corridas de crons (jobs + last_status + entregas), fuente: API de jobs + log |
| GET | `/portal/files` / `/portal/files/{path}` | workspace read-only (reportes, dossiers) — solo texto, path-confinado a workspace/ |
| GET | `/portal/uso` | gasto real del proveedor en USD: hoy, mes y total (OpenRouter, no estimaciones) |

### Notas de implementación (lecciones aplicadas)

- Lecturas de kanban: sqlite `mode=ro` (como `reconcile-report.py`).
- Escrituras (comment/unblock): vía los módulos `kanban_db` internos — el mismo
  camino que usa `plugins/kanban/dashboard/plugin_api.py`, nunca SQL directo.
- Los scripts/archivos del plugin: simples y sin rutas exóticas — el escáner de
  lifecycle tiene un falso positivo conocido (repro documentado en el reporte
  de la guardia).
- `/portal/files`: siempre `text/plain` inline, nunca el mime real (lección
  anti-XSS del parche de attachments).

## Coexistencia con los channels nativos

Los channels de Hermes (Telegram, WhatsApp, etc.) siguen siendo de primera
clase: la proactividad del agente vive ahí (él te busca). El portal es una
ventana más al mismo agente — las sesiones de Hermes comparten memoria y
estado (verificado: es cómo funciona el puente de aprobaciones de La Mano),
así que lo conversado por Telegram y lo visto en el portal son el mismo mundo.

## Portal (repo tuagente.uy)

Ruta `/app` (SPA dentro del Next existente):

- **Login**: el cliente pega su magic link (`app.tuagente.uy/#endpoint=...&key=...`)
  → localStorage. Sin usuarios, sin DB, sin backend.
- **Pantallas** (modulares según el manifest; orden de build):
  1. **Aprobaciones**: la bandeja con Aprobar/Rechazar — home si el agente usa el patrón
  2. **Chat**: streaming + markdown (Vercel AI SDK `useChat` + react-markdown)
  3. **Pipeline**: kanban read-only con filtros por tenant/tags
  4. **Actividad**: timeline de lo que hizo el agente
  5. **Archivos**: deliverables navegables
  6. **Tareas programadas**: los crons del agente — schedule, último estado,
     pausar/reanudar ("modo vacaciones"), correr ahora. Vía `/api/jobs` que YA
     existe en :8642 con bearer (list/pause/resume/run) — cero código de datos.
     Crear/editar crons queda en la consola de operador (es config del agente).
  7. **Uso**: tokens/costo del mes
- Lo que NO tiene: gestión de modelos, skills, logs, config del agente →
  eso queda en el dashboard de Hermes (:9119), que es la consola de soporte
  de pdelabs por cliente.

## Fases

- **F1 (el demo vendible)**: plugin con health + approvals + tickets · portal
  con Aprobaciones + Chat. Un cliente puede aprobar un mail desde el celular.
- **F2**: activity + files + usage · pantalla Pipeline.
- **F3**: tokens con scopes, multi-usuario por cliente, notificaciones push.

## Decisiones ya tomadas (con evidencia)

- **Open WebUI descartado como producto** (probado 2026-08-03): excelente demo,
  pero trae features irrelevantes para el cliente, branding con cláusula de
  licencia, y un fork sería mantenimiento perpetuo de código ajeno.
- **Proxy del dashboard de Hermes descartado**: es consola de operador.
- **DB compartida descartada**: ver principio 4.

## Riesgos abiertos

1. CORS del API server ante rutas de plugin — verificar temprano en F1;
   fallback edge proxy listo.
2. El plugin registra rutas en el api_server: confirmar el mecanismo de
   registro de rutas para plugins standalone (google_meet lo hace con tools;
   acá necesitamos rutas HTTP — revisar cómo el kanban registra las suyas).
3. Semántica de "aprobado vía portal" en el SOUL de cada cliente: el texto
   debe nombrar al cliente como aprobador válido por ese canal.
4. `kanban_db` es API interna de Hermes (sin contrato): mitigar con imagen
   pinneada por cliente, adapter mínimo, y self-test del plugin post-update.
5. Desfase portal↔flota: el manifest lleva versión; el portal es defensivo
   (módulo desconocido → oculto). ANTI-PATRÓN declarado: jamás cachear/espejar
   estado del agente en el portal.

## Presupuesto del plugin (regla anti-engorde)

El plugin adapta SOLO donde la frontera de auth lo exige (:9119) o donde no
existe endpoint (manifest). Hoy: kanban + manifest, y nada más. Si un tercer
tipo de dato lo necesita → contribuir el endpoint upstream a Hermes (PR al
api server), no engordar el adapter. Dos superficies: :8642 bearer = directo
sin proxy; :9119 cookie = únicas candidatas a adapter.

## Qué NO se re-implementa (capa de datos)

Chat, sesiones+historial y crons/jobs (incl. pause/resume/run) ya tienen REST
bearer en :8642 (verificado).
El plugin solo adapta kanban/manifest/files/usage como pass-through a los
módulos internos — el mismo patrón del dashboard oficial.
