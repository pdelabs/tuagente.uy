# Agentito headless tooling — status

*2026-08-22.*

## What's done

**A single source of geometry.** The drawing lives in
`app/app/lib/agentito-svg.mjs` (pure ESM, zero deps, no React or DOM):
`renderAgentitoSVG(look) → string`. `AgentitoAvatar` (the portal component) is
a thin wrapper that injects that string — it can't diverge by construction.
Types in `agentito-svg.d.mts`; `tsc --noEmit` passes with every consumer.

**The CLI.** `hermes-kit/tools/draw-agentito.mjs` (Node; it stayed in JS-land
because that's where the geometry lives). Inputs: `--look '{json}'`, `--role
<id>` (catalog), `--agent <path>` (the agent's identities.json, all roles at
once). Outputs: `--svg`, `--png` + `--size`, `--background`. Presets `--for
telegram|og|favicon` — telegram comes out 512px on `#FBFAFF` because Telegram
flattens alpha against BLACK (measured lesson). Rasterizes with
`@resvg/resvg-js` (only dep: embedded Rust, prebuilt binaries, zero system
libs, deterministic bytes). Setup: `cd hermes-kit/tools && npm install`.

**Tests.** `python3 -m unittest discover -s hermes-kit/tools -p "test_*.py"`
→ 5 tests: byte-for-byte goldens of the catalog's 5 roles + the default
(`golden-agentitos/`), invalid axes fall back to the default, the telegram PNG
is a real 512×512 PNG, and a structural guard that yells if anyone re-inlines
geometry into `agentito.tsx`. If a face changes on purpose, the goldens get
regenerated and the diff in the review IS the feature.

**Wired-up consumers.**
- `avatar-bot.py`: `--png` is now optional; with `--role`/`--agent` it draws
  it itself (telegram preset) and uploads it. It no longer needs the portal's
  PNG.
- `hire-role.sh`: if the agent has `TELEGRAM_BOT_TOKEN`, at the end of the
  rollout it PRINTS the suggested photo command (never automatic: talking to
  Telegram as the client's bot is a step the operator triggers on purpose).

**Eyeballed and verified (2026-08-22).** The 5 roles rendered by the CLI
against the portal served on :8090 (Vera during rollout, all 5 on the
landing): identical one by one — tone, antenna, accessory, pupils, mouth,
skin, suit and brows.

## What's left / open decisions

- **OG image per role**: `--for og` already composes 1200×630 and works
  (tested), but the landing doesn't consume it yet — turning it on means
  generating the PNGs and adding `<meta og:image>` wherever it belongs.
- **Favicon preset**: exists (64px transparent) but nobody uses it yet.
- **`next build` wasn't run in this pass** (another agent was building the
  blog against the same `.next`); `tsc --noEmit` passes and the component
  change is purely internal. Run a build before the next deploy.
- **Naming photo over ssh**: `hire-role.sh` in remote mode only suggests
  `--role`; for the named look you need to fetch the agent's
  `policy/roles/identities.json` (scp) and pass `--agent`. If this becomes
  routine, it's worth automating that fetch in avatar-bot.py.
- The render uses the look with the floor shadow and the blinking-eyes tag
  turned off (the photo is just the face on its own); if the shadow floor is
  ever wanted in the PNG, that option already exists in `renderAgentitoSVG`.
