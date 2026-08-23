#!/usr/bin/env node
// Draw an agentito to disk — look config in, SVG/PNG out, no browser.
//
// The geometry is NOT here: it lives in app/app/lib/agentito-svg.mjs (the same
// pure module the portal's AgentitoAvatar injects), so this tool, the portal
// and the landing cannot diverge. This file only resolves WHOSE look to draw
// and rasterizes.
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
//   node draw-agentito.mjs --role assistant --for telegram --png /tmp/lola.png
//   node draw-agentito.mjs --look '{"tone":3,"antenna":0}' --svg - > face.svg
//   node draw-agentito.mjs --agent ~/agentes/acme --for telegram --png /tmp/faces/
//   node draw-agentito.mjs --role sales --for og --png /tmp/og-sales.png
//
// Inputs (one of three):
//   --look '{json}'    loose axes; whatever is missing falls to the default
//   --role <id>        reads it from roles/catalog.json (with --agent, the naming wins)
//   --agent <path>     the agent's policy/roles/identities.json: all of its
//                      named roles at once (the catalog fills in the rest of the look)
// Outputs:
//   --svg <path|->     the SVG as-is (with several roles, <path> is a directory)
//   --png <path>       rasterized (same directory rule with several roles)
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

import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LOOK_DEFAULT, LOOK_AXES, renderAgentitoSVG } from "../../app/app/lib/agentito-svg.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const KIT = resolve(HERE, "..");

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

function catalogLooks(catalogPath) {
  const cat = JSON.parse(readFileSync(catalogPath, "utf-8"));
  const out = {};
  for (const r of cat.roles ?? []) out[r.id] = r.identity?.look ?? {};
  return out;
}

/** Resolve [{name, look}] from --look / --role / --agent. */
function resolveLooks(args) {
  if (args.look) {
    return [{ name: "agentito", look: lookFrom(JSON.parse(args.look)) }];
  }

  if (args.agent) {
    const base = resolve(args.agent);
    const identities = JSON.parse(
      readFileSync(join(base, "policy", "roles", "identities.json"), "utf-8"),
    );
    // The agent's own roster copy completes any naming that came without a look.
    let fallback = {};
    try {
      fallback = catalogLooks(join(base, "policy", "roles", "catalog.json"));
    } catch {
      fallback = catalogLooks(args.catalog ?? join(KIT, "roles", "catalog.json"));
    }
    const entries = Object.entries(identities)
      .filter(([role]) => !args.role || role === args.role)
      .map(([role, naming]) => ({
        name: role,
        look: lookFrom(naming?.look ?? fallback[role]),
      }));
    if (args.role && entries.length === 0) {
      // Hired without a portal naming: the catalog face is the honest one.
      return [{ name: args.role, look: lookFrom(fallback[args.role]) }];
    }
    return entries;
  }

  if (args.role) {
    const looks = catalogLooks(args.catalog ?? join(KIT, "roles", "catalog.json"));
    if (!(args.role in looks)) {
      throw new Error(`role '${args.role}' is not in the catalog`);
    }
    return [{ name: args.role, look: lookFrom(looks[args.role]) }];
  }

  throw new Error("missing input: --look '{json}', --role <id> or --agent <path>");
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

function outPath(base, name, ext, multiple) {
  if (!multiple) return base;
  mkdirSync(base, { recursive: true });
  return join(base, `${name}.${ext}`);
}

const args = parseArgs(process.argv.slice(2));
const preset = args.for ? PRESETS[args.for] : null;
if (args.for && !preset) throw new Error(`--for ${args.for}: the targets are telegram, og or favicon`);

const background = args.background ?? preset?.background ?? "transparent";
const size = Number(args.size ?? preset?.size ?? 640);
const pad = preset?.pad ?? 0;

const entries = resolveLooks(args);
if (entries.length === 0) throw new Error("no role has been named on that agent");
if (!args.svg && !args.png) throw new Error("missing output: --svg and/or --png");

for (const { name, look } of entries) {
  const face = renderAgentitoSVG(look, { pad });
  const finalSVG = args.for === "og" ? ogSVG(face, preset, background) : face;

  if (args.svg) {
    if (args.svg === "-") {
      process.stdout.write(finalSVG + "\n");
    } else {
      const dest = outPath(resolve(args.svg), name, "svg", entries.length > 1);
      writeFileSync(dest, finalSVG + "\n");
      console.log(`svg  ${name} -> ${dest}`);
    }
  }
  if (args.png) {
    const width = args.for === "og" ? preset.width : size;
    // A trailing "/" or an existing directory means "one file per role" even for one role.
    const wantsDir =
      entries.length > 1 ||
      args.png.endsWith("/") ||
      (() => { try { return statSync(resolve(args.png)).isDirectory(); } catch { return false; } })();
    const dest = wantsDir ? outPath(resolve(args.png), name, "png", true) : resolve(args.png);
    writeFileSync(dest, await toPng(finalSVG, { width, background }));
    console.log(`png  ${name} (${args.for === "og" ? `${preset.width}x${preset.height}` : `${width}px`}, background ${background}) -> ${dest}`);
  }
}
