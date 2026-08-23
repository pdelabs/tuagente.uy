#!/usr/bin/env node
// Agentito playground: every variant of every axis, live in the browser.
//
// Uso:  node hermes-kit/tools/probar-agentito.mjs   →  http://localhost:8077
//
// Zero deps, zero build: a tiny HTTP server importing the SAME geometry
// module as the portal, the landing and the CLI — so what you see here is
// what every surface draws. Each click re-renders everything server-side:
// the big preview plus one thumbnail per variant per axis, always against
// the look you are building. The JSON under the preview pastes straight into
// roles/catalogo.json (identity.look) or the CLI's --look.

import { createServer } from "node:http";
import { LOOK_DEFAULT, LOOK_EJES, renderAgentitoSVG } from "../../app/app/lib/agentito-svg.mjs";

const PORT = Number(process.env.PORT || 8077);

function parseLook(query) {
  const look = { ...LOOK_DEFAULT };
  for (const eje of Object.keys(LOOK_EJES)) {
    const v = Number(query.get(eje));
    if (Number.isInteger(v) && v >= 0 && v < LOOK_EJES[eje]) look[eje] = v;
  }
  return look;
}

const PAGE = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Probador de agentitos</title>
<style>
  * { box-sizing: border-box; margin: 0; }
  body { font-family: system-ui, sans-serif; background: #FBFAFF; color: #14131F; padding: 24px; }
  h1 { font-size: 20px; letter-spacing: -0.02em; }
  header { display: flex; align-items: center; gap: 16px; margin-bottom: 20px; flex-wrap: wrap; }
  header label { font-size: 13px; color: #4B4A5C; display: flex; align-items: center; gap: 5px; }
  button.accion { border: 0; border-radius: 999px; background: #5B4BE8; color: #fff; font-weight: 700; padding: 8px 18px; cursor: pointer; font-size: 14px; }
  button.accion:hover { background: #3A2ED0; }
  main { display: flex; gap: 32px; align-items: flex-start; flex-wrap: wrap; }
  #grande { width: 300px; height: 300px; background: #fff; border-radius: 24px; box-shadow: 0 10px 40px -12px rgba(20,19,31,0.18); flex-shrink: 0; }
  #grande svg, .thumb svg { width: 100%; height: 100%; display: block; }
  .filas { flex: 1; min-width: 340px; display: grid; gap: 10px; }
  .fila { display: flex; align-items: center; gap: 8px; }
  .fila > span { width: 84px; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #4B4A5C; }
  .thumb { width: 56px; height: 56px; padding: 2px; border: 2px solid transparent; border-radius: 14px; background: #fff; cursor: pointer; box-shadow: 0 2px 10px -4px rgba(20,19,31,0.25); }
  .thumb.activo { border-color: #5B4BE8; }
  .codigos { margin-top: 24px; display: grid; gap: 8px; max-width: 900px; }
  .codigos code { display: block; background: #14131F; color: #E8E6F5; border-radius: 10px; padding: 10px 14px; font-size: 12.5px; overflow-x: auto; cursor: copy; white-space: nowrap; }
  .codigos code:active { background: #3A2ED0; }
  .pista { font-size: 12px; color: #4B4A5C; }
</style>
</head>
<body>
<header>
  <h1>Probador de agentitos</h1>
  <button class="accion" id="dado">Dado 🎲</button>
  <label><input type="checkbox" id="sombra"> sombra</label>
  <label><input type="checkbox" id="apagado"> apagado</label>
</header>
<main>
  <div id="grande"></div>
  <div class="filas" id="filas"></div>
</main>
<div class="codigos">
  <span class="pista">Click en un código para copiarlo:</span>
  <code id="json" title="identity.look para roles/catalogo.json"></code>
  <code id="cli" title="el mismo look por CLI"></code>
</div>
<script>
const EJES = __EJES__;
let look = __DEFAULT__;

// Static skeleton once; thumbnails get re-imaged on every paint.
const filas = document.getElementById("filas");
for (const eje in EJES) {
  const row = document.createElement("div");
  row.className = "fila";
  const tag = document.createElement("span");
  tag.textContent = eje;
  row.appendChild(tag);
  for (let i = 0; i < EJES[eje]; i++) {
    const b = document.createElement("button");
    b.className = "thumb";
    b.id = "t-" + eje + "-" + i;
    b.title = eje + ": " + i;
    b.onclick = () => { look[eje] = i; pintar(); };
    row.appendChild(b);
  }
  filas.appendChild(row);
}

async function pintar() {
  const q = new URLSearchParams(look);
  q.set("sombra", document.getElementById("sombra").checked ? "1" : "0");
  q.set("apagado", document.getElementById("apagado").checked ? "1" : "0");
  const d = await (await fetch("/render?" + q)).json();
  document.getElementById("grande").innerHTML = d.grande;
  for (const eje in d.filas) {
    d.filas[eje].forEach((svg, i) => {
      const b = document.getElementById("t-" + eje + "-" + i);
      b.innerHTML = svg;
      b.classList.toggle("activo", look[eje] === i);
    });
  }
  document.getElementById("json").textContent =
    JSON.stringify(look).replace(/,/g, ", ").replace(/:/g, ": ");
  document.getElementById("cli").textContent =
    "node hermes-kit/tools/dibujar-agentito.mjs --look '" + JSON.stringify(look) + "' --para telegram --png /tmp/agentito.png";
}

document.getElementById("dado").onclick = () => {
  for (const eje in EJES) look[eje] = Math.floor(Math.random() * EJES[eje]);
  pintar();
};
document.getElementById("sombra").onchange = pintar;
document.getElementById("apagado").onchange = pintar;
for (const id of ["json", "cli"]) {
  document.getElementById(id).onclick = (e) => navigator.clipboard.writeText(e.target.textContent);
}
pintar();
</script>
</body>
</html>`
  .replace("__EJES__", JSON.stringify(LOOK_EJES))
  .replace("__DEFAULT__", JSON.stringify(LOOK_DEFAULT));

const server = createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/render") {
    const look = parseLook(url.searchParams);
    const opts = {
      conSombra: url.searchParams.get("sombra") === "1",
      apagado: url.searchParams.get("apagado") === "1",
    };
    // Thumbnails stay awake and shadowless on purpose: with apagado on, every
    // eye and pupil variant would look identical.
    const filas = {};
    for (const eje of Object.keys(LOOK_EJES)) {
      filas[eje] = Array.from({ length: LOOK_EJES[eje] }, (_, i) =>
        renderAgentitoSVG({ ...look, [eje]: i }, { pad: 6 }),
      );
    }
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ grande: renderAgentitoSVG(look, { ...opts, pad: 8 }), filas }));
    return;
  }
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.end(PAGE);
});

server.listen(PORT, () => {
  console.log(`probador de agentitos → http://localhost:${PORT}`);
});
