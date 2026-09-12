#!/usr/bin/env node
// Render an Instagram post folder to PNGs with headless Chrome.
//
//   node social/render.mjs social/posts/<dir> [--only 2]
//
// Reads <dir>/post.json:
//   {
//     "format": "feed" | "square" | "story",        // default feed (1080x1350)
//     "theme": "violet" | "ink" | "light" | "tonal-violet" | "tonal-green" |
//              "tonal-coral" | "tonal-amber",         // default per slide too
//     "look": { agentito axes },                    // default: brand look
//     "slides": [ { "template": "statement" | "job" | "chat" | "list" | "stat",
//                   "alt": "...", ...fields } ]
//   }
// Every other field of a slide is substituted raw into the template's
// `{{field}}` placeholders; `messages` (chat) and `bullets` (list) are arrays
// rendered into `{{chat}}` / `{{items}}`. Unresolved placeholders render empty
// and the CSS hides empty elements. The filled HTML stays in <dir>/.build/ so
// a slide can be opened in a browser and tuned by eye.
//
// The agentito is drawn by the same module the landing and the portal use, so
// the mascot on Instagram can never diverge from the product.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname, join, basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { renderAgentitoSVG } from "../app/app/lib/agentito-svg.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CHROME =
  process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SIZES = { feed: [1080, 1350], square: [1080, 1080], story: [1080, 1920] };
const BRAND_LOOK = { tone: 0, antenna: 5, accessory: 0, pupil: 1, mouth: 1, skin: 1, suit: 0, brows: 1, hat: 0 };
const MARK = readFileSync(resolve(HERE, "../public/tuagente-mark.svg"), "utf8");
const TICK =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';

const [dirArg, ...rest] = process.argv.slice(2);
if (!dirArg) throw new Error("usage: node social/render.mjs <post dir> [--only N]");
const only = rest.includes("--only") ? Number(rest[rest.indexOf("--only") + 1]) : null;

const dir = resolve(dirArg);
const post = JSON.parse(readFileSync(join(dir, "post.json"), "utf8"));
const format = post.format || "feed";
const [w, h] = SIZES[format];
const css = readFileSync(join(HERE, "templates/base.css"), "utf8").replaceAll(
  "__BASE__",
  pathToFileURL(HERE).href,
);
const head = readFileSync(join(HERE, "templates/_head.html"), "utf8");
const foot = readFileSync(join(HERE, "templates/_foot.html"), "utf8");
const build = join(dir, ".build");
mkdirSync(build, { recursive: true });

function fill(tpl, vars) {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] == null ? "" : String(vars[k])));
}

const n = post.slides.length;
const out = [];
post.slides.forEach((slide, i) => {
  const idx = i + 1;
  if (only && only !== idx) return;
  const tplPath = join(HERE, "templates", `${slide.template}.html`);
  if (!existsSync(tplPath)) throw new Error(`no template ${slide.template}`);
  const vars = {
    theme: post.theme || "violet",
    format,
    counter: n > 1 && slide.counter !== false ? `${idx}/${n}` : "",
    agentitoSize: "",
    titleSize: "",
    valueSize: "",
    ...slide,
    css,
    mark: MARK,
    agentito: renderAgentitoSVG({ ...BRAND_LOOK, ...(post.look || {}), ...(slide.look || {}) }),
  };
  if (vars.agentitoSize === "none") vars.agentito = "";
  if (slide.messages)
    vars.chat = slide.messages
      .map((m) => `<div class="msg ${m.from}">${m.text}</div>`)
      .join("");
  if (slide.bullets)
    vars.items = slide.bullets
      .map((b) => `<div class="item"><span class="tick">${TICK}</span><span>${b}</span></div>`)
      .join("");
  // head/foot are filled twice: once here for their own placeholders.
  vars.head = fill(head, vars);
  vars.foot = foot;
  const html = fill(fill(readFileSync(tplPath, "utf8"), vars), vars);
  const name = String(idx).padStart(2, "0");
  const htmlPath = join(build, `${name}.html`);
  const pngPath = join(dir, `${name}.png`);
  writeFileSync(htmlPath, html);
  execFileSync(
    CHROME,
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--virtual-time-budget=3000",
      `--window-size=${w},${h}`,
      `--screenshot=${pngPath}`,
      pathToFileURL(htmlPath).href,
    ],
    { stdio: "ignore" },
  );
  out.push(pngPath);
});
console.log(out.join("\n"));
