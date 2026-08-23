# Spec — Chat (owner: subagent B · dir: app/app/chat/)

Goal: a ChatGPT-style chat with the agent. Everything via :8642 (no adapter).

- Streaming via the chatStream() lib (POST /v1/chat/completions stream:true).
- Render the agent's markdown with react-markdown (code, lists, links).
- Conversation history: GET /api/sessions (sidebar, title+date), open one →
  GET /api/sessions/{id}/messages and continue with
  POST /api/sessions/{id}/chat/stream. VERIFY the real shapes with curl
  BEFORE coding (the key is in the hermes repo's .env).
- New conversation = today's PoC flow (scratchpad/portal-poc/poc-portal.html
  in the session's scratchpad directory has the reference SSE parser).
- States: sending (disabled), network error with retry, agent thinking
  (turns with tool calls take a while — needs a visible indicator).
- Definition of done: new conversation + resuming an old one + markdown
  rendering correctly + errors handled. Clean tsc --noEmit. Do NOT run the
  dev server.
