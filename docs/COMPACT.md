# COMPACT — Estado del proyecto portal tuagente (2026-08-03 18:20)

Contexto destilado para humanos y subagentes. Fuente de verdad de hechos VERIFICADOS.

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
- POST /v1/chat/completions (stream OK) · GET /v1/models
- GET /api/sessions · GET /api/sessions/{id}/messages · POST /api/sessions/{id}/chat[/stream]
- GET /api/jobs · POST /api/jobs/{id}/pause|resume|run · GET/PATCH/DELETE /api/jobs/{id}
- GET /health

## En :8643 (adapter PoC, a extender)
- GET /portal/manifest · GET /portal/tickets (bearer, CORS por env PORTAL_CORS_ORIGINS)

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
