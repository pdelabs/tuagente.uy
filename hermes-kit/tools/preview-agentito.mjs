#!/usr/bin/env node
// Agentito playground: every variant of every axis, live in the browser.
//
// Usage:  node hermes-kit/tools/preview-agentito.mjs   →  http://localhost:8077
//
// Zero deps, zero build: a tiny HTTP server importing the SAME geometry
// module as the portal, the landing and the CLI — so what you see here is
// what every surface draws. Each click re-renders everything server-side:
// the big preview plus one thumbnail per variant per axis, always against
// the look you are building. The JSON under the preview pastes straight into
// roles/catalog.json (identity.look) or the CLI's --look.

import { createServer } from "node:http";
import { LOOK_DEFAULT, LOOK_AXES, renderAgentitoSVG } from "../../app/app/lib/agentito-svg.mjs";

const PORT = Number(process.env.PORT || 8077);

function parseLook(query) {
  const look = { ...LOOK_DEFAULT };
  for (const axis of Object.keys(LOOK_AXES)) {
    const v = Number(query.get(axis));
    if (Number.isInteger(v) && v >= 0 && v < LOOK_AXES[axis]) look[axis] = v;
  }
  return look;
}

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Agentito previewer</title>
<style>
  * { box-sizing: border-box; margin: 0; }
  body { font-family: system-ui, sans-serif; background: #FBFAFF; color: #14131F; padding: 24px; }
  h1 { font-size: 20px; letter-spacing: -0.02em; }
  header { display: flex; align-items: center; gap: 16px; margin-bottom: 20px; flex-wrap: wrap; }
  header label { font-size: 13px; color: #4B4A5C; display: flex; align-items: center; gap: 5px; }
  button.action { border: 0; border-radius: 999px; background: #5B4BE8; color: #fff; font-weight: 700; padding: 8px 18px; cursor: pointer; font-size: 14px; }
  button.action:hover { background: #3A2ED0; }
  main { display: flex; gap: 32px; align-items: flex-start; flex-wrap: wrap; }
  #big { width: 300px; height: 300px; background: #fff; border-radius: 24px; box-shadow: 0 10px 40px -12px rgba(20,19,31,0.18); flex-shrink: 0; }
  #big svg, .thumb svg { width: 100%; height: 100%; display: block; }
  .rows { flex: 1; min-width: 340px; display: grid; gap: 10px; }
  .row { display: flex; align-items: center; gap: 8px; }
  .row > span { width: 84px; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #4B4A5C; }
  .thumb { width: 56px; height: 56px; padding: 2px; border: 2px solid transparent; border-radius: 14px; background: #fff; cursor: pointer; box-shadow: 0 2px 10px -4px rgba(20,19,31,0.25); }
  .thumb.active { border-color: #5B4BE8; }
  .snippets { margin-top: 24px; display: grid; gap: 8px; max-width: 900px; }
  .snippets code { display: block; background: #14131F; color: #E8E6F5; border-radius: 10px; padding: 10px 14px; font-size: 12.5px; overflow-x: auto; cursor: copy; white-space: nowrap; }
  .snippets code:active { background: #3A2ED0; }
  .hint { font-size: 12px; color: #4B4A5C; }
</style>
</head>
<body>
<header>
  <h1>Agentito previewer</h1>
  <button class="action" id="dice">Dice 🎲</button>
  <label><input type="checkbox" id="shadow"> shadow</label>
  <label><input type="checkbox" id="asleep"> asleep</label>
</header>
<main>
  <div id="big"></div>
  <div class="rows" id="rows"></div>
</main>
<div class="snippets">
  <span class="hint">Click a snippet to copy it:</span>
  <code id="json" title="identity.look for roles/catalog.json"></code>
  <code id="cli" title="the same look via CLI"></code>
</div>
<script>
const AXES = __AXES__;
let look = __DEFAULT__;

// Static skeleton once; thumbnails get re-imaged on every paint.
const rows = document.getElementById("rows");
for (const axis in AXES) {
  const row = document.createElement("div");
  row.className = "row";
  const tag = document.createElement("span");
  tag.textContent = axis;
  row.appendChild(tag);
  for (let i = 0; i < AXES[axis]; i++) {
    const b = document.createElement("button");
    b.className = "thumb";
    b.id = "t-" + axis + "-" + i;
    b.title = axis + ": " + i;
    b.onclick = () => { look[axis] = i; paint(); };
    row.appendChild(b);
  }
  rows.appendChild(row);
}

async function paint() {
  const q = new URLSearchParams(look);
  q.set("shadow", document.getElementById("shadow").checked ? "1" : "0");
  q.set("asleep", document.getElementById("asleep").checked ? "1" : "0");
  const d = await (await fetch("/render?" + q)).json();
  document.getElementById("big").innerHTML = d.big;
  for (const axis in d.rows) {
    d.rows[axis].forEach((svg, i) => {
      const b = document.getElementById("t-" + axis + "-" + i);
      b.innerHTML = svg;
      b.classList.toggle("active", look[axis] === i);
    });
  }
  document.getElementById("json").textContent =
    JSON.stringify(look).replace(/,/g, ", ").replace(/:/g, ": ");
  document.getElementById("cli").textContent =
    "node hermes-kit/tools/draw-agentito.mjs --look '" + JSON.stringify(look) + "' --for telegram --png /tmp/agentito.png";
}

document.getElementById("dice").onclick = () => {
  for (const axis in AXES) look[axis] = Math.floor(Math.random() * AXES[axis]);
  paint();
};
document.getElementById("shadow").onchange = paint;
document.getElementById("asleep").onchange = paint;
for (const id of ["json", "cli"]) {
  document.getElementById(id).onclick = (e) => navigator.clipboard.writeText(e.target.textContent);
}
paint();
</script>
</body>
</html>`
  .replace("__AXES__", JSON.stringify(LOOK_AXES))
  .replace("__DEFAULT__", JSON.stringify(LOOK_DEFAULT));

const server = createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/render") {
    const look = parseLook(url.searchParams);
    const opts = {
      withShadow: url.searchParams.get("shadow") === "1",
      asleep: url.searchParams.get("asleep") === "1",
    };
    // Thumbnails stay awake and shadowless on purpose: with asleep on, every
    // eye and pupil variant would look identical.
    const rows = {};
    for (const axis of Object.keys(LOOK_AXES)) {
      rows[axis] = Array.from({ length: LOOK_AXES[axis] }, (_, i) =>
        renderAgentitoSVG({ ...look, [axis]: i }, { pad: 6 }),
      );
    }
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ big: renderAgentitoSVG(look, { ...opts, pad: 8 }), rows }));
    return;
  }
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.end(PAGE);
});

server.listen(PORT, () => {
  console.log(`agentito previewer → http://localhost:${PORT}`);
});
