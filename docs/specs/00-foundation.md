# Spec F0 — Fundación (la implementa Claude, NO subagentes)

- Ruta /app en este repo (app/app/). Shell: sidebar con módulos según
  /portal/manifest, header con nombre del agente, look M3 tonal.
- app/app/lib/agent.ts: config desde hash del magic link
  (#endpoint=…&adapter=…&key=…) con defaults localhost:8642/8643, persistida
  en localStorage. Fetchers tipados + chatStream(). ÚNICO punto de red.
- app/app/lib/ui.tsx: Card, Chip, Btn, EmptyState, Spinner — tonales M3.
- Pantalla de login si falta key: pegar magic link.
- Deps compartidas ya instaladas por la fundación: react-markdown.
- REGLA para features: importar SOLO de ../lib/*; no tocar package.json,
  layout.tsx, lib/* — si falta algo en la lib, reportarlo, no editarla.
