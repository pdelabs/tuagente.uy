# Tooling headless del agentito — estado

*2026-08-22.*

## Qué quedó

**Una sola fuente de geometría.** El dibujo vive en
`app/app/lib/agentito-svg.mjs` (ESM puro, cero deps, sin React ni DOM):
`renderAgentitoSVG(look) → string`. `AgentitoAvatar` (el componente del
portal) es un wrapper finito que inyecta ese string — no puede divergir por
construcción. Tipos en `agentito-svg.d.mts`; `tsc --noEmit` pasa con todos
los consumidores.

**El CLI.** `hermes-kit/tools/dibujar-agentito.mjs` (Node; quedó en JS-land
porque ahí quedó la geometría). Entradas: `--look '{json}'`, `--rol <id>`
(catálogo), `--agente <ruta>` (identidades.json del agente, todos los roles
de una). Salidas: `--svg`, `--png` + `--tamano`, `--fondo`. Presets
`--para telegram|og|favicon` — telegram sale 512px sobre `#FBFAFF` porque
Telegram aplasta el alfa contra NEGRO (lección medida). Rasteriza con
`@resvg/resvg-js` (única dep: Rust embebido, binarios precompilados, cero
libs del sistema, bytes deterministas). Preparación: `cd hermes-kit/tools &&
npm install`.

**Tests.** `python3 -m unittest discover -s hermes-kit/tools -p "test_*.py"`
→ 5 tests: goldens byte a byte de los 5 roles del catálogo + el default
(`golden-agentitos/`), ejes inválidos caen al default, el PNG telegram es un
PNG real de 512×512, y un guard estructural que grita si alguien re-inlinea
geometría en `agentito.tsx`. Si una cara cambia a propósito, se regeneran
los goldens y el diff en el review ES el feature.

**Consumidores cableados.**
- `avatar-bot.py`: `--png` ahora es opcional; con `--rol`/`--agente` se
  dibuja solo (preset telegram) y sube. Ya no necesita el PNG del portal.
- `contratar-rol.sh`: si el agente tiene `TELEGRAM_BOT_TOKEN`, al final del
  alta IMPRIME la sugerencia del comando de la foto (nunca automático:
  hablar con Telegram como el bot del cliente es un paso que el operador
  dispara a propósito).

**Verificado a ojo (2026-08-22).** Los 5 roles renderizados por el CLI
contra el portal servido en :8090 (Vera en el alta, los 5 en la landing):
idénticos uno por uno — tono, antena, accesorio, pupilas, boca, piel, traje
y cejas.

## Qué falta / decisiones abiertas

- **OG por rol**: `--para og` ya compone 1200×630 y anda (probado), pero la
  landing NO lo consume todavía — activarlo es generar los PNGs y ponerles
  `<meta og:image>` donde corresponda.
- **Preset favicon**: existe (64px transparente) pero nadie lo usa aún.
- **`next build` no se corrió en esta pasada** (había otro agente
  buildeando el blog contra el mismo `.next`); `tsc --noEmit` pasa y el
  cambio del componente es solo interno. Correr un build antes del próximo
  deploy.
- **Cara del bautizo por ssh**: `contratar-rol.sh` en modo remoto sugiere
  `--rol` solo; para el look bautizado hace falta traer el
  `politica/roles/identidades.json` del agente (scp) y pasar `--agente`.
  Si se vuelve rutina, vale automatizar ese fetch en avatar-bot.py.
- El renderizado usa el look con `conSombra`/`vivo` apagados (la foto es la
  cara sola); si algún día se quiere el piso de sombra en el PNG, la opción
  ya existe en `renderAgentitoSVG`.
