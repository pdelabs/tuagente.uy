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
// Uso:
//   node dibujar-agentito.mjs --rol asistente --para telegram --png /tmp/lola.png
//   node dibujar-agentito.mjs --look '{"tono":3,"antena":0}' --svg - > cara.svg
//   node dibujar-agentito.mjs --agente ~/agentes/acme --para telegram --png /tmp/caras/
//   node dibujar-agentito.mjs --rol ventas --para og --png /tmp/og-ventas.png
//
// Entradas (una de las tres):
//   --look '{json}'    ejes sueltos; lo que falte va al default
//   --rol <id>         lo lee de roles/catalogo.json (con --agente, el bautizo pisa)
//   --agente <ruta>    politica/roles/identidades.json del agente: todos sus
//                      roles bautizados de una (el catálogo completa la pinta)
// Salidas:
//   --svg <ruta|->     el SVG tal cual (con varios roles, <ruta> es un directorio)
//   --png <ruta>       rasterizado (idem directorio con varios roles)
// Ajustes:
//   --para telegram|og|favicon   preset de tamaño/fondo/aire por destino
//   --tamaño <px>      lado del PNG (default 640); --tamano también vale
//   --fondo <color|transparente>
//
// Presets — el porqué de cada fondo está medido:
//   telegram  512px, fondo sólido #FBFAFF. Telegram NO soporta alfa en fotos de
//             perfil: lo aplasta contra NEGRO (visto el 11/8 con Washington).
//             Mismo lado y mismo fondo que la captura del portal.
//   og        1200x630, fondo #FBFAFF, cara centrada.
//   favicon   64px, transparente.

import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LOOK_DEFAULT, LOOK_EJES, renderAgentitoSVG } from "../../app/app/lib/agentito-svg.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const KIT = resolve(HERE, "..");

const PRESETS = {
  telegram: { tamano: 512, fondo: "#FBFAFF", pad: 14 },
  og: { ancho: 1200, alto: 630, fondo: "#FBFAFF", pad: 6 },
  favicon: { tamano: 64, fondo: "transparente", pad: 4 },
};

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (!flag.startsWith("--")) throw new Error(`argumento suelto: ${flag}`);
    const key = flag.slice(2).replace(/^tamano$/, "tamaño");
    args[key] = argv[i + 1];
    i++;
  }
  return args;
}

/** Clamp raw axis values the same way the portal does: bad axes fall to default. */
function lookFrom(raw) {
  const look = { ...LOOK_DEFAULT };
  for (const eje of Object.keys(LOOK_EJES)) {
    const v = Number(raw?.[eje]);
    if (Number.isInteger(v) && v >= 0 && v < LOOK_EJES[eje]) look[eje] = v;
  }
  return look;
}

function catalogLooks(catalogPath) {
  const cat = JSON.parse(readFileSync(catalogPath, "utf-8"));
  const out = {};
  for (const r of cat.roles ?? []) out[r.id] = r.identity?.look ?? {};
  return out;
}

/** Resolve [{name, look}] from --look / --rol / --agente. */
function resolveLooks(args) {
  if (args.look) {
    return [{ name: "agentito", look: lookFrom(JSON.parse(args.look)) }];
  }

  if (args.agente) {
    const base = resolve(args.agente);
    const identidades = JSON.parse(
      readFileSync(join(base, "politica", "roles", "identidades.json"), "utf-8"),
    );
    // The agent's own roster copy completes any baptism that came without pinta.
    let fallback = {};
    try {
      fallback = catalogLooks(join(base, "politica", "roles", "catalogo.json"));
    } catch {
      fallback = catalogLooks(args.catalogo ?? join(KIT, "roles", "catalogo.json"));
    }
    const entries = Object.entries(identidades)
      .filter(([rol]) => !args.rol || rol === args.rol)
      .map(([rol, bautizo]) => ({
        name: rol,
        look: lookFrom(bautizo?.pinta ?? fallback[rol]),
      }));
    if (args.rol && entries.length === 0) {
      // Hired without a portal baptism: the catalog face is the honest one.
      return [{ name: args.rol, look: lookFrom(fallback[args.rol]) }];
    }
    return entries;
  }

  if (args.rol) {
    const looks = catalogLooks(args.catalogo ?? join(KIT, "roles", "catalogo.json"));
    if (!(args.rol in looks)) {
      throw new Error(`el rol '${args.rol}' no está en el catálogo`);
    }
    return [{ name: args.rol, look: lookFrom(looks[args.rol]) }];
  }

  throw new Error("falta la entrada: --look '{json}', --rol <id> o --agente <ruta>");
}

/** Our own SVG string format: pull viewBox + inner markup to embed elsewhere. */
function innerOf(svg) {
  const m = svg.match(/^<svg [^>]*viewBox="([^"]+)"[^>]*>([\s\S]*)<\/svg>$/);
  if (!m) throw new Error("el SVG no tiene la forma que emite agentito-svg.mjs");
  return { viewBox: m[1], inner: m[2] };
}

/** The OG card: solid background, face centered, 1200x630. */
function ogSVG(faceSVG, preset, fondo) {
  const { viewBox, inner } = innerOf(faceSVG);
  const alto = preset.alto - 30; // 15px of air above and below
  const x = (preset.ancho - alto) / 2;
  const bg = fondo === "transparente" ? "" : `<rect width="${preset.ancho}" height="${preset.alto}" fill="${fondo}"/>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${preset.ancho}" height="${preset.alto}" viewBox="0 0 ${preset.ancho} ${preset.alto}">` +
    bg +
    `<svg x="${x}" y="15" width="${alto}" height="${alto}" viewBox="${viewBox}">${inner}</svg>` +
    `</svg>`
  );
}

async function toPng(svg, { width, background }) {
  const { Resvg } = await import("@resvg/resvg-js");
  const opts = { fitTo: { mode: "width", value: width } };
  if (background && background !== "transparente") opts.background = background;
  return new Resvg(svg, opts).render().asPng();
}

function outPath(base, name, ext, multiple) {
  if (!multiple) return base;
  mkdirSync(base, { recursive: true });
  return join(base, `${name}.${ext}`);
}

const args = parseArgs(process.argv.slice(2));
const preset = args.para ? PRESETS[args.para] : null;
if (args.para && !preset) throw new Error(`--para ${args.para}: los destinos son telegram, og o favicon`);

const fondo = args.fondo ?? preset?.fondo ?? "transparente";
const tamano = Number(args["tamaño"] ?? preset?.tamano ?? 640);
const pad = preset?.pad ?? 0;

const entries = resolveLooks(args);
if (entries.length === 0) throw new Error("no hay ningún rol bautizado en ese agente");
if (!args.svg && !args.png) throw new Error("falta la salida: --svg y/o --png");

for (const { name, look } of entries) {
  const face = renderAgentitoSVG(look, { pad });
  const finalSVG = args.para === "og" ? ogSVG(face, preset, fondo) : face;

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
    const width = args.para === "og" ? preset.ancho : tamano;
    // A trailing "/" or an existing directory means "one file per role" even for one role.
    const wantsDir =
      entries.length > 1 ||
      args.png.endsWith("/") ||
      (() => { try { return statSync(resolve(args.png)).isDirectory(); } catch { return false; } })();
    const dest = wantsDir ? outPath(resolve(args.png), name, "png", true) : resolve(args.png);
    writeFileSync(dest, await toPng(finalSVG, { width, background: fondo }));
    console.log(`png  ${name} (${args.para === "og" ? `${preset.ancho}x${preset.alto}` : `${width}px`}, fondo ${fondo}) -> ${dest}`);
  }
}
