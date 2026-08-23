# Spec F0 — Foundation (implemented by Claude, NOT subagents)

- Route /app in this repo (app/app/). Shell: sidebar with modules per
  /portal/manifest, header with the agent's name, tonal M3 look.
- app/app/lib/agent.ts: config from the magic link's hash
  (#endpoint=…&adapter=…&key=…) with defaults localhost:8642/8643, persisted
  in localStorage. Typed fetchers + chatStream(). ONLY network entry point.
- app/app/lib/ui.tsx: Card, Chip, Btn, EmptyState, Spinner — tonal M3.
- Login screen if the key is missing: paste the magic link.
- Shared deps already installed by the foundation: react-markdown.
- RULE for features: import ONLY from ../lib/*; don't touch package.json,
  layout.tsx, lib/* — if something's missing from the lib, report it, don't
  edit it.
