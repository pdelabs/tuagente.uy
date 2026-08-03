# COMPACT — Estado del proyecto portal tuagente (2026-08-03 18:20)

Contexto destilado para humanos y subagentes. Fuente de verdad de hechos VERIFICADOS.

## PRINCIPIO CERO — Producto genérico
El portal sirve a CUALQUIER agente Hermes de cualquier cliente. Nada específico
de La Mano/pdelabs/leads en el código: ni nombres, ni parseo de títulos, ni
supuestos de dominio. La Mano es SOLO el entorno de prueba local (fixture).
Lo que el portal sabe del agente lo sabe por el manifest y por datos genéricos
de Hermes (tickets, jobs, sesiones, archivos).

## Qué es
Portal web client-facing para agentes Hermes (producto tuagente, by pdelabs).
Spec madre: docs/spec-portal-agente.md (v1.4). Principios: agente = única infra
y fuente de verdad · portal estático (Next 14 en Vercel, este repo) · ventana
no jaula (manifest de capacidades) · adapter solo donde la auth lo exige.

## Infraestructura local (demo con La Mano)
- Agente Hermes "La Mano": docker, repo ~/Desktop/Luis/Projects/hermes
- API server (gateway): http://localhost:8642 — bearer = API_SERVER_KEY
  (en ~/Desktop/Luis/Projects/hermes/data/.env; los subagentes la leen de ahí)
- Adapter sidecar PoC: http://localhost:8643 (data/scripts/portal_adapter.py,
  servicio portal-adapter en el docker-compose del repo hermes)
- CORS: resuelto vía env API_SERVER_CORS_ORIGINS (ya incluye localhost:8090 y
  app.tuagente.uy; para dev Next agregar http://localhost:3000 si hace falta)

## Endpoints VERIFICADOS en :8642 (bearer, sin adapter)
- POST /v1/chat/completions (stream OK, formato OpenAI) · GET /v1/models
- GET /api/sessions (epoch en SEGUNDOS; `?limit=`) · GET /api/sessions/{id}/messages
- POST /api/sessions (crea; devuelve {object, session:{id,…}})
- PATCH /api/sessions/{id} {title} → 200 renombra · DELETE /api/sessions/{id} → 200
  (PUT da 405; no existe /rename)
- POST /api/sessions/{id}/chat/stream — body {"message": "..."} SINGULAR y SSE
  NATIVO de Hermes (run.started / message.started / assistant.delta {delta} /
  tool.progress {tool_name, "_thinking"} / assistant.completed / run.completed /
  done). NO es compatible con el parser OpenAI: mandar {messages} da 400.
- GET /api/jobs — ¡EXCLUYE los pausados! usar ?include_disabled=true
- POST /api/jobs/{id}/pause|resume|run · GET/PATCH/DELETE /api/jobs/{id}
- GET /health

## En :8643 (adapter propio, portal_adapter.py — v0.3.0)
Todos bearer + CORS por env PORTAL_CORS_ORIGINS; nombre del agente por env AGENT_NAME.
- GET /portal/manifest (módulos por detección real) · GET /portal/tickets
- GET /portal/tickets/{id} → {ticket, comments[], events[]}
- GET /portal/approvals · POST /portal/approvals/{id}/approve|reject {reason}
- GET /portal/activity (job_run + eventos del kanban) · GET /portal/usage (+daily 14d)
- GET /portal/files · GET /portal/files/{path} (siempre text/plain)

## Lecciones duras (NO repetir)
1. kanban.db: JAMÁS escribir SQL directo (locks/claims/dispatcher → corrupción).
   Escrituras vía CLI `hermes kanban ...` por subprocess DESDE EL SIDECAR
   (fuera del gateway el guard no aplica — patrón verificado) o módulos internos.
2. docker exec con heredoc: SIEMPRE -i.
3. Archivos servidos al browser: siempre text/plain (anti-XSS).
4. El binario hermes desde el terminal DEL AGENTE está vetado por el guard —
   pero desde el sidecar/host funciona.
5. A los agentes LLM: exigir resultado + verificar con script; no prescribir método.

## Estética (de tailwind.config.ts de ESTE repo — usarla, no inventar)
M3 expressive: primary #5B4BE8, surface #FBFAFF, ink #14131F, cards tonales
c-violet/c-green/c-coral/c-amber (+ sus *-ink), radius card 2rem / pill,
shadow-soft, font Plus Jakarta (var --font-jakarta). Simplista: pocas cosas,
grandes, redondeadas, tonales. Sin dark mode en v1 (la landing no lo tiene).
