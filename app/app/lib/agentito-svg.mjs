// The agentito's ONE source of geometry: a pure string renderer with zero
// dependencies — no React, no DOM, no Node APIs — so the exact same drawing
// serves the portal (AgentitoAvatar wraps this), the landing, and the headless
// CLI (hermes-kit/tools/dibujar-agentito.mjs). Touch a trait here and it
// changes everywhere at once; there is deliberately nowhere else to draw it.
//
// Same geometry as public/agentito.riv, at /4 scale, on a 120x120 viewBox —
// transcribed 1:1 from the JSX this file replaced. If you change a coordinate,
// the golden tests in hermes-kit/tools/test_dibujar_agentito.py must be
// regenerated on purpose (they fail byte-by-byte otherwise, which is the point).

/** Axis sizes; each axis is a numeric input of the Rive state machine. */
export const LOOK_EJES = {
  tono: 6, antena: 6, accesorio: 4, pupila: 3, boca: 4, piel: 2, traje: 3, cejas: 3,
};

export const LOOK_DEFAULT = {
  tono: 0, antena: 0, accesorio: 0, pupila: 0, boca: 0, piel: 0, traje: 0, cejas: 0,
};

export const TONOS = ["#5B4BE8", "#00A67E", "#FF7A59", "#F0B429", "#3D8BE8", "#E86BB3"];
export const INK = "#14131F";
// Where the lid that crops the smile sits, per mouth variant.
const TAPA_Y = [67, 64.5, 69.5, 65];

/**
 * The still agentito as an SVG string.
 *
 * opts:
 *   conSombra  floor shadow under the body
 *   apagado    asleep: closed eyes, still mouth (for an agent that won't answer)
 *   vivo       tags the eyes group with the CSS blink class (portal-only CSS)
 *   pad        extra viewBox units of breathing room on every side (default 0);
 *              rasterizers use this instead of compositing margins themselves
 */
export function renderAgentitoSVG(look = LOOK_DEFAULT, opts = {}) {
  const { conSombra = false, apagado = false, vivo = false, pad = 0 } = opts;
  const tono = TONOS[look.tono] ?? TONOS[0];
  const pupilaR = 4.75 * [1, 1.35, 0.75][look.pupila];
  const tapaY = TAPA_Y[look.boca] ?? TAPA_Y[0];

  const p = [];

  if (conSombra) {
    p.push(`<ellipse cx="60" cy="114" rx="26" ry="3.2" fill="${INK}" opacity="0.12"/>`);
  }

  // Antenna (behind the body). Variant 2 is "nothing" on purpose.
  if (look.antena === 0) {
    p.push(
      `<g fill="${tono}">` +
        `<rect x="57.75" y="12.5" width="4.5" height="12" rx="2"/>` +
        `<circle cx="60" cy="11" r="5.25"/>` +
      `</g>`,
    );
  }
  if (look.antena === 1) {
    p.push(
      `<g fill="${tono}">` +
        `<rect x="50.9" y="13.5" width="3.25" height="11" rx="1.5" transform="rotate(-18 52.5 19)"/>` +
        `<rect x="65.9" y="13.5" width="3.25" height="11" rx="1.5" transform="rotate(18 67.5 19)"/>` +
        `<circle cx="50.5" cy="12.5" r="3.5"/>` +
        `<circle cx="69.5" cy="12.5" r="3.5"/>` +
      `</g>`,
    );
  }
  if (look.antena === 3) {
    p.push(
      `<g fill="${tono}">` +
        `<ellipse cx="13.5" cy="62" rx="5" ry="7"/>` +
        `<ellipse cx="106.5" cy="62" rx="5" ry="7"/>` +
      `</g>`,
    );
  }
  if (look.antena === 4) {
    p.push(
      `<g>` +
        `<rect x="57.75" y="12.5" width="4.5" height="12" rx="2" fill="${tono}"/>` +
        `<circle cx="60" cy="12" r="4.5" fill="none" stroke="${tono}" stroke-width="2.25"/>` +
      `</g>`,
    );
  }
  if (look.antena === 5) {
    p.push(
      `<path d="M61 18a1 1 0 1 0-2 0a2 2 0 1 0 4 0a3.2 3.2 0 1 0-6.4 0a4.5 4.5 0 1 0 9 0" ` +
        `fill="none" stroke="${tono}" stroke-width="2.25" stroke-linecap="round"/>`,
    );
  }

  // Body
  p.push(`<ellipse cx="60" cy="68" rx="46" ry="44" fill="${tono}"/>`);

  // Skin: specks
  if (look.piel === 1) {
    p.push(
      `<g fill="#FFFFFF" opacity="0.15">` +
        `<circle cx="28" cy="81" r="2"/>` +
        `<circle cx="36" cy="97.5" r="1.5"/>` +
        `<circle cx="64.5" cy="101.5" r="1.75"/>` +
        `<circle cx="86" cy="90" r="1.4"/>` +
        `<circle cx="92" cy="74.5" r="1.25"/>` +
      `</g>`,
    );
  }

  // Mouth: white smile + body-colored lid (+ tongue)
  if (apagado) {
    p.push(`<path d="M53 76 h14" stroke="#fff" stroke-width="3.5" stroke-linecap="round" opacity="0.85"/>`);
  } else {
    p.push(`<ellipse cx="60" cy="73.5" rx="13" ry="9.5" fill="#fff"/>`);
    p.push(`<ellipse cx="60" cy="${tapaY}" rx="15.5" ry="9.75" fill="${tono}"/>`);
    if (look.boca === 3) {
      p.push(`<ellipse cx="60" cy="81.5" rx="3.75" ry="2.5" fill="#FF8FA3"/>`);
    }
  }

  // Accessories on the body
  if (look.accesorio === 2) {
    p.push(
      `<g fill="#FF9EB5" opacity="0.7">` +
        `<ellipse cx="33" cy="69" rx="4.5" ry="2.75"/>` +
        `<ellipse cx="87" cy="69" rx="4.5" ry="2.75"/>` +
      `</g>`,
    );
  }
  if (look.accesorio === 3) {
    p.push(
      `<g fill="${INK}" opacity="0.16">` +
        `<circle cx="42.5" cy="71" r="1.1"/>` +
        `<circle cx="46.5" cy="72.75" r="1"/>` +
        `<circle cx="50.5" cy="71" r="1.1"/>` +
        `<circle cx="69.5" cy="71" r="1.1"/>` +
        `<circle cx="73.5" cy="72.75" r="1"/>` +
        `<circle cx="77.5" cy="71" r="1.1"/>` +
      `</g>`,
    );
  }

  // Suit
  if (look.traje === 1) {
    p.push(
      `<g fill="${INK}">` +
        `<polygon points="51.5,106.2 51.5,112.8 58,109.5"/>` +
        `<polygon points="68.5,106.2 68.5,112.8 62,109.5"/>` +
        `<rect x="58" y="107.5" width="4" height="4" rx="1.25"/>` +
      `</g>`,
    );
  }
  if (look.traje === 2) {
    p.push(
      `<g fill="${INK}">` +
        `<rect x="56" y="100.25" width="8" height="4.5" rx="1"/>` +
        `<rect x="56.5" y="105" width="7" height="12" rx="1.75"/>` +
        `<polygon points="56.5,116.5 63.5,116.5 60,121"/>` +
      `</g>`,
    );
  }

  // Eyes
  if (apagado) {
    p.push(
      `<g stroke="#fff" stroke-width="3.5" stroke-linecap="round" fill="none" opacity="0.85">` +
        `<path d="M38.5 58 q8 7 16 0"/>` +
        `<path d="M65.5 58 q8 7 16 0"/>` +
      `</g>`,
    );
  } else {
    p.push(
      `<g${vivo ? ' class="onb-eyes"' : ""}>` +
        `<ellipse cx="46.5" cy="59" rx="10.25" ry="11" fill="#fff"/>` +
        `<ellipse cx="73.5" cy="59" rx="10.25" ry="11" fill="#fff"/>` +
        `<circle cx="46.5" cy="59.5" r="${pupilaR}" fill="${INK}"/>` +
        `<circle cx="73.5" cy="59.5" r="${pupilaR}" fill="${INK}"/>` +
        `<circle cx="48.25" cy="57.75" r="1.5" fill="#fff" opacity="0.9"/>` +
        `<circle cx="75.25" cy="57.75" r="1.5" fill="#fff" opacity="0.9"/>` +
      `</g>`,
    );
  }

  // Glasses and eyebrows, above the eyes
  if (look.accesorio === 1 && !apagado) {
    p.push(
      `<g fill="none" stroke="${INK}" stroke-width="1.75">` +
        `<circle cx="46.5" cy="59" r="12.4"/>` +
        `<circle cx="73.5" cy="59" r="12.4"/>` +
        `<rect x="57.75" y="56" width="4.5" height="2" rx="1" fill="${INK}" stroke="none"/>` +
      `</g>`,
    );
  }
  if (look.cejas > 0 && !apagado) {
    const rot1 = look.cejas === 2 ? ' transform="rotate(13.75 46.5 43.5)"' : "";
    const rot2 = look.cejas === 2 ? ' transform="rotate(-13.75 73.5 43.5)"' : "";
    p.push(
      `<g fill="${INK}">` +
        `<rect x="41" y="42.25" width="11" height="2.5" rx="1.25"${rot1}/>` +
        `<rect x="68" y="42.25" width="11" height="2.5" rx="1.25"${rot2}/>` +
      `</g>`,
    );
  }

  const vb = pad ? `${-pad} ${-pad} ${120 + 2 * pad} ${120 + 2 * pad}` : "0 0 120 120";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" class="h-full w-full" aria-hidden="true">` +
    p.join("") +
    `</svg>`
  );
}
