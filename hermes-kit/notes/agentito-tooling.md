# Agentito headless tooling — status

*2026-08-22. Trimmed 2026-08-30: the `--role`/`--agent` inputs and the five
role goldens went with the roster (`docs/team-pivot-removal.md`). Everything
else in this note is unchanged and still true.*

## What's done

**A single source of geometry.** The drawing lives in
`app/app/lib/agentito-svg.mjs` (pure ESM, zero deps, no React or DOM):
`renderAgentitoSVG(look) → string`. `AgentitoAvatar` (the portal component) is
a thin wrapper that injects that string — it can't diverge by construction.
Types in `agentito-svg.d.mts`; `tsc --noEmit` passes with every consumer.

**The CLI.** `hermes-kit/tools/draw-agentito.mjs` (Node; it stayed in JS-land
because that's where the geometry lives). Input: `--look '{json}'`, and only
that — it used to also take `--role` and `--agent`, which read the roster
catalog and `policy/roles/identities.json`, and neither file exists. A client's
one agent has ONE face, whoever holds the look passes it in, and the tool does
not go looking on an agent's disk. Outputs: `--svg`, `--png` + `--size`,
`--background`. Presets `--for telegram|og|favicon` — telegram comes out
512px on `#FBFAFF` because Telegram
flattens alpha against BLACK (measured lesson). Rasterizes with
`@resvg/resvg-js` (only dep: embedded Rust, prebuilt binaries, zero system
libs, deterministic bytes). Setup: `cd hermes-kit/tools && npm install`.

**Tests.** `python3 -m unittest discover -s hermes-kit/tools -p
"test_draw_agentito.py"`: the byte-for-byte golden of the default look
(`golden-agentitos/default.svg` — the roster's five went with the roster),
invalid axes falling back to the default, the telegram PNG being a real
512×512 PNG, and a structural guard that yells if anyone re-inlines geometry
into `agentito.tsx`. If a face changes on purpose, the golden gets regenerated
and the diff in the review IS the feature.

**Wired-up consumers.**
- `avatar-bot.py`: `--png` is optional; given a `look` it draws it itself
  (telegram preset) and uploads it. It no longer needs the portal's PNG.
- `tools/bot-photo.sh`, which `deploy-remote.sh` PRINTS as a suggestion when
  the agent has a `TELEGRAM_BOT_TOKEN` (never automatic: talking to Telegram
  as the client's bot is a step the operator triggers on purpose).

**Eyeballed and verified (2026-08-22).** Five looks rendered by the CLI against
the portal served on :8090: identical one by one — tone, antenna, accessory,
pupils, mouth, skin, suit and brows. The looks were the roster's, which is why
the goldens are gone; the comparison they proved is the one the default golden
keeps making.

## What's left / open decisions

- **OG image**: `--for og` already composes 1200×630 and works (tested), but
  the landing doesn't consume it yet — turning it on means generating the PNG
  and adding `<meta og:image>` wherever it belongs.
- **Favicon preset**: exists (64px transparent) but nobody uses it yet.
- **`next build` wasn't run in this pass** (another agent was building the
  blog against the same `.next`); `tsc --noEmit` passes and the component
  change is purely internal. Run a build before the next deploy.
- **Naming photo over ssh**: the look the client chose lives on their agent,
  in `portal_identity.json`, and nothing fetches it for you — `bot-photo.sh`
  is the path, and whoever draws the face by hand has to pass the look. Worth
  automating the read if it becomes routine.
- The render uses the look with the floor shadow and the blinking-eyes tag
  turned off (the photo is just the face on its own); if the shadow floor is
  ever wanted in the PNG, that option already exists in `renderAgentitoSVG`.
