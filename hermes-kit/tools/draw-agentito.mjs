#!/usr/bin/env node
// Draw an agentito to disk — look config in, SVG/PNG out, no browser.
//
// The geometry is NOT here: it lives in app/app/lib/agentito-svg.mjs (the same
// pure module the portal's AgentitoAvatar injects), so this tool, the portal
// and the landing cannot diverge. This file only rasterizes.
//
// Rasterizer: @resvg/resvg-js. Chosen over sharp (SVG fidelity depends on the
// host's libvips/librsvg build) and over cairosvg (would force a second,
// Python-side copy of the geometry): resvg bundles its own Rust renderer as a
// prebuilt binary, needs zero system libraries, and renders the same bytes on
// every machine. No Puppeteer on purpose — the whole point is no browser.
//
// Prep (once): cd hermes-kit/tools && npm install
//
// Usage:
//   node draw-agentito.mjs --look '{"tone":3,"antenna":0}' --svg - > face.svg
//   node draw-agentito.mjs --look "$(jq -c .look data/portal_identity.json)" \
//        --for telegram --png /tmp/face.png
//   node draw-agentito.mjs --look '{}' --for og --png /tmp/og.png
//
// Input:
//   --look '{json}'    loose axes; whatever is missing falls to the default.
//                      IT USED TO ALSO TAKE --role and --agent, which read the
//                      roster catalog and policy/roles/identities.json: neither
//                      file exists. A client's one agent has ONE face and the
//                      client picks it in the portal, so whoever calls this
//                      reads `data/portal_identity.json`.`look` and passes it
//                      -- this tool does not go looking on an agent's disk.
// Outputs:
//   --svg <path|->     the SVG as-is
//   --png <path>       rasterized
// Adjustments:
//   --for telegram|og|favicon   size/background/padding preset by target
//   --size <px>        PNG side (default 640)
//   --background <color|transparent>
//
// Presets — the reason behind each background is measured:
//   telegram  512px, solid background #FBFAFF. Telegram does NOT support alpha
//             in profile photos: it flattens it against BLACK (seen 11/8 with
//             Washington). Same side and same background as the portal's capture.
//   og        1200x630, background #FBFAFF, face centered.
//   favicon   64px, transparent.

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { LOOK_DEFAULT, LOOK_AXES, renderAgentitoSVG } from "../../app/app/lib/agentito-svg.mjs";

const PRESETS = {
  telegram: { size: 512, background: "#FBFAFF", pad: 14 },
  og: { width: 1200, height: 630, background: "#FBFAFF", pad: 6 },
  favicon: { size: 64, background: "transparent", pad: 4 },
};

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (!flag.startsWith("--")) throw new Error(`unexpected argument: ${flag}`);
    const key = flag.slice(2);
    args[key] = argv[i + 1];
    i++;
  }
  return args;
}

/** Clamp raw axis values the same way the portal does: bad axes fall to default. */
function lookFrom(raw) {
  const look = { ...LOOK_DEFAULT };
  for (const axis of Object.keys(LOOK_AXES)) {
    const v = Number(raw?.[axis]);
    if (Number.isInteger(v) && v >= 0 && v < LOOK_AXES[axis]) look[axis] = v;
  }
  return look;
}

/** Our own SVG string format: pull viewBox + inner markup to embed elsewhere. */
function innerOf(svg) {
  const m = svg.match(/^<svg [^>]*viewBox="([^"]+)"[^>]*>([\s\S]*)<\/svg>$/);
  if (!m) throw new Error("the SVG doesn't have the shape agentito-svg.mjs emits");
  return { viewBox: m[1], inner: m[2] };
}

/** The OG card: solid background, face centered, 1200x630. */
function ogSVG(faceSVG, preset, background) {
  const { viewBox, inner } = innerOf(faceSVG);
  const height = preset.height - 30; // 15px of air above and below
  const x = (preset.width - height) / 2;
  const bg = background === "transparent" ? "" : `<rect width="${preset.width}" height="${preset.height}" fill="${background}"/>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${preset.width}" height="${preset.height}" viewBox="0 0 ${preset.width} ${preset.height}">` +
    bg +
    `<svg x="${x}" y="15" width="${height}" height="${height}" viewBox="${viewBox}">${inner}</svg>` +
    `</svg>`
  );
}

async function toPng(svg, { width, background }) {
  const { Resvg } = await import("@resvg/resvg-js");
  const opts = { fitTo: { mode: "width", value: width } };
  if (background && background !== "transparent") opts.background = background;
  return new Resvg(svg, opts).render().asPng();
}

const args = parseArgs(process.argv.slice(2));
const preset = args.for ? PRESETS[args.for] : null;
if (args.for && !preset) throw new Error(`--for ${args.for}: the targets are telegram, og or favicon`);

const background = args.background ?? preset?.background ?? "transparent";
const size = Number(args.size ?? preset?.size ?? 640);
const pad = preset?.pad ?? 0;

if (!args.look) throw new Error("missing input: --look '{json}'");
if (!args.svg && !args.png) throw new Error("missing output: --svg and/or --png");

const look = lookFrom(JSON.parse(args.look));
const face = renderAgentitoSVG(look, { pad });
const finalSVG = args.for === "og" ? ogSVG(face, preset, background) : face;

if (args.svg) {
  if (args.svg === "-") {
    process.stdout.write(finalSVG + "\n");
  } else {
    const dest = resolve(args.svg);
    writeFileSync(dest, finalSVG + "\n");
    console.log(`svg  -> ${dest}`);
  }
}
if (args.png) {
  const width = args.for === "og" ? preset.width : size;
  const dest = resolve(args.png);
  writeFileSync(dest, await toPng(finalSVG, { width, background }));
  const shape = args.for === "og" ? `${preset.width}x${preset.height}` : `${width}px`;
  console.log(`png  (${shape}, background ${background}) -> ${dest}`);
}
