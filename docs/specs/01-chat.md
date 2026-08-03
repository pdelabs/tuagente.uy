# Spec — Chat (owner: subagente B · dir: app/app/chat/)

Objetivo: chat estilo ChatGPT con el agente. TODO por :8642 (sin adapter).

- Streaming vía lib chatStream() (POST /v1/chat/completions stream:true).
- Render markdown del agente con react-markdown (código, listas, links).
- Historial de conversaciones: GET /api/sessions (sidebar, título+fecha),
  abrir una → GET /api/sessions/{id}/messages y continuar con
  POST /api/sessions/{id}/chat/stream. VERIFICAR shapes reales con curl ANTES
  de codear (la key está en el .env del repo hermes).
- Nueva conversación = flujo actual del PoC (scratchpad/portal-poc/poc-portal.html
  del directorio scratchpad de la sesión tiene el parser SSE de referencia).
- Estados: enviando (disabled), error de red con retry, agente pensando (los
  turnos con tools tardan — indicador visible).
- Definition of done: conversación nueva + retomar una vieja + markdown bien
  renderizado + errores manejados. tsc --noEmit limpio. NO correr dev server.
