// The agentito's ONE source of geometry: a pure string renderer with zero
// dependencies — no React, no DOM, no Node APIs — so the exact same drawing
// serves the portal (AgentitoAvatar wraps this), the landing, and the headless
// CLI (hermes-kit/tools/draw-agentito.mjs). Touch a trait here and it
// changes everywhere at once; there is deliberately nowhere else to draw it.
//
// Same geometry as public/agentito.riv, at /4 scale, on a 120x120 viewBox —
// transcribed 1:1 from the JSX this file replaced. If you change a coordinate,
// the golden tests in hermes-kit/tools/test_draw_agentito.py must be
// regenerated on purpose (they fail byte-by-byte otherwise, which is the point).

/** Axis sizes; each axis is a numeric input of the Rive state machine. */
export const LOOK_AXES = {
  tone: 6, antenna: 6, accessory: 4, pupil: 3, mouth: 4, skin: 2, suit: 4, brows: 3,
  hat: 4,
};

export const LOOK_DEFAULT = {
  tone: 0, antenna: 0, accessory: 0, pupil: 0, mouth: 0, skin: 0, suit: 0, brows: 0,
  hat: 0,
};

export const TONES = ["#5B4BE8", "#00A67E", "#FF7A59", "#F0B429", "#3D8BE8", "#E86BB3"];
export const INK = "#14131F";
// Where the lid that crops the smile sits, per mouth variant.
const LID_Y = [67, 64.5, 69.5, 65];

/**
 * The still agentito as an SVG string.
 *
 * opts:
 *   withShadow floor shadow under the body
 *   asleep     asleep: closed eyes, still mouth (for an agent that won't answer)
 *   alive      tags the eyes group with the CSS blink class (portal-only CSS)
 *   pad        extra viewBox units of breathing room on every side (default 0);
 *              rasterizers use this instead of compositing margins themselves
 */
export function renderAgentitoSVG(look = LOOK_DEFAULT, opts = {}) {
  const { withShadow = false, asleep = false, alive = false, pad = 0 } = opts;
  const tone = TONES[look.tone] ?? TONES[0];
  const pupilRadius = 4.75 * [1, 1.35, 0.75][look.pupil];
  const lidY = LID_Y[look.mouth] ?? LID_Y[0];

  const p = [];

  if (withShadow) {
    p.push(`<ellipse cx="60" cy="114" rx="26" ry="3.2" fill="${INK}" opacity="0.12"/>`);
  }

  // Antenna (behind the body). Variant 2 is "nothing" on purpose. A hat
  // owns the roof: the top-mounted variants (0, 1, 4, 5) hide under it, the
  // side ears (3) do not.
  const hasHat = look.hat > 0;
  if (look.antenna === 0 && !hasHat) {
    p.push(
      `<g fill="${tone}">` +
        `<rect x="57.75" y="12.5" width="4.5" height="12" rx="2"/>` +
        `<circle cx="60" cy="11" r="5.25"/>` +
      `</g>`,
    );
  }
  if (look.antenna === 1 && !hasHat) {
    p.push(
      `<g fill="${tone}">` +
        `<rect x="50.9" y="13.5" width="3.25" height="11" rx="1.5" transform="rotate(-18 52.5 19)"/>` +
        `<rect x="65.9" y="13.5" width="3.25" height="11" rx="1.5" transform="rotate(18 67.5 19)"/>` +
        `<circle cx="50.5" cy="12.5" r="3.5"/>` +
        `<circle cx="69.5" cy="12.5" r="3.5"/>` +
      `</g>`,
    );
  }
  if (look.antenna === 3) {
    p.push(
      `<g fill="${tone}">` +
        `<ellipse cx="13.5" cy="62" rx="5" ry="7"/>` +
        `<ellipse cx="106.5" cy="62" rx="5" ry="7"/>` +
      `</g>`,
    );
  }
  if (look.antenna === 4 && !hasHat) {
    p.push(
      `<g>` +
        `<rect x="57.75" y="12.5" width="4.5" height="12" rx="2" fill="${tone}"/>` +
        `<circle cx="60" cy="12" r="4.5" fill="none" stroke="${tone}" stroke-width="2.25"/>` +
      `</g>`,
    );
  }
  if (look.antenna === 5 && !hasHat) {
    p.push(
      `<path d="M61 18a1 1 0 1 0-2 0a2 2 0 1 0 4 0a3.2 3.2 0 1 0-6.4 0a4.5 4.5 0 1 0 9 0" ` +
        `fill="none" stroke="${tone}" stroke-width="2.25" stroke-linecap="round"/>`,
    );
  }

  // Body
  p.push(`<ellipse cx="60" cy="68" rx="46" ry="44" fill="${tone}"/>`);

  // Skin: specks
  if (look.skin === 1) {
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
  if (asleep) {
    p.push(`<path d="M53 76 h14" stroke="#fff" stroke-width="3.5" stroke-linecap="round" opacity="0.85"/>`);
  } else {
    p.push(`<ellipse cx="60" cy="73.5" rx="13" ry="9.5" fill="#fff"/>`);
    p.push(`<ellipse cx="60" cy="${lidY}" rx="15.5" ry="9.75" fill="${tone}"/>`);
    if (look.mouth === 3) {
      p.push(`<ellipse cx="60" cy="81.5" rx="3.75" ry="2.5" fill="#FF8FA3"/>`);
    }
  }

  // Accessories on the body
  if (look.accessory === 2) {
    p.push(
      `<g fill="#FF9EB5" opacity="0.7">` +
        `<ellipse cx="33" cy="69" rx="4.5" ry="2.75"/>` +
        `<ellipse cx="87" cy="69" rx="4.5" ry="2.75"/>` +
      `</g>`,
    );
  }
  if (look.accessory === 3) {
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
  if (look.suit === 1) {
    p.push(
      `<g fill="${INK}">` +
        `<polygon points="45,95.5 45,108.5 56.5,102"/>` +
        `<polygon points="75,95.5 75,108.5 63.5,102"/>` +
        `<rect x="56.5" y="98.5" width="7" height="7" rx="2"/>` +
      `</g>`,
    );
  }
  if (look.suit === 2) {
    p.push(
      `<g fill="${INK}">` +
        `<polygon points="54.5,96.5 65.5,96.5 62.5,102.5 57.5,102.5"/>` +
        `<polygon points="57.5,102.5 62.5,102.5 64.5,110 60,114.5 55.5,110"/>` +
      `</g>`,
    );
  }
  if (look.suit === 3) {
    p.push(
      `<g fill="${INK}">` +
        `<rect x="19" y="92.5" width="82" height="10" rx="5"/>` +
        `<rect x="42" y="100" width="11" height="14" rx="3.5"/>` +
        `<rect x="43" y="112" width="2.5" height="6" rx="1.25"/>` +
        `<rect x="46.5" y="112" width="2.5" height="7.5" rx="1.25"/>` +
        `<rect x="50" y="112" width="2.5" height="6" rx="1.25"/>` +
      `</g>`,
    );
  }

  // Eyes
  if (asleep) {
    p.push(
      `<g stroke="#fff" stroke-width="3.5" stroke-linecap="round" fill="none" opacity="0.85">` +
        `<path d="M38.5 58 q8 7 16 0"/>` +
        `<path d="M65.5 58 q8 7 16 0"/>` +
      `</g>`,
    );
  } else {
    p.push(
      `<g${alive ? ' class="onb-eyes"' : ""}>` +
        `<ellipse cx="46.5" cy="59" rx="10.25" ry="11" fill="#fff"/>` +
        `<ellipse cx="73.5" cy="59" rx="10.25" ry="11" fill="#fff"/>` +
        `<circle cx="46.5" cy="59.5" r="${pupilRadius}" fill="${INK}"/>` +
        `<circle cx="73.5" cy="59.5" r="${pupilRadius}" fill="${INK}"/>` +
        `<circle cx="48.25" cy="57.75" r="1.5" fill="#fff" opacity="0.9"/>` +
        `<circle cx="75.25" cy="57.75" r="1.5" fill="#fff" opacity="0.9"/>` +
      `</g>`,
    );
  }

  // Glasses and eyebrows, above the eyes
  if (look.accessory === 1 && !asleep) {
    p.push(
      `<g fill="none" stroke="${INK}" stroke-width="1.75">` +
        `<circle cx="46.5" cy="59" r="12.4"/>` +
        `<circle cx="73.5" cy="59" r="12.4"/>` +
        `<rect x="57.75" y="56" width="4.5" height="2" rx="1" fill="${INK}" stroke="none"/>` +
      `</g>`,
    );
  }
  if (look.brows > 0 && !asleep) {
    const rot1 = look.brows === 2 ? ' transform="rotate(13.75 46.5 43.5)"' : "";
    const rot2 = look.brows === 2 ? ' transform="rotate(-13.75 73.5 43.5)"' : "";
    p.push(
      `<g fill="${INK}">` +
        `<rect x="41" y="42.25" width="11" height="2.5" rx="1.25"${rot1}/>` +
        `<rect x="68" y="42.25" width="11" height="2.5" rx="1.25"${rot2}/>` +
      `</g>`,
    );
  }

  // Hats, above everything: cap (with a body-colored button), beret, top hat
  // (with a body-colored band).
  if (look.hat === 1) {
    p.push(
      `<g>` +
        `<path d="M32.5 33a30 22 0 0 1 55 0z" fill="${INK}"/>` +
        `<rect x="80" y="27.5" width="24" height="6" rx="3" fill="${INK}"/>` +
        `<circle cx="60" cy="19.5" r="2.75" fill="${tone}"/>` +
      `</g>`,
    );
  }
  if (look.hat === 2) {
    p.push(
      `<g fill="${INK}">` +
        `<ellipse cx="57" cy="21.5" rx="24" ry="9.5" transform="rotate(-7 57 21.5)"/>` +
        `<circle cx="54.5" cy="9.5" r="3"/>` +
      `</g>`,
    );
  }
  if (look.hat === 3) {
    p.push(
      `<g fill="${INK}">` +
        `<rect x="34" y="26" width="52" height="6" rx="3"/>` +
        `<rect x="44" y="4" width="32" height="24" rx="3"/>` +
      `</g>` +
      `<rect x="44" y="20" width="32" height="5" fill="${tone}"/>`,
    );
  }

  const vb = pad ? `${-pad} ${-pad} ${120 + 2 * pad} ${120 + 2 * pad}` : "0 0 120 120";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" class="h-full w-full" aria-hidden="true">` +
    p.join("") +
    `</svg>`
  );
}
