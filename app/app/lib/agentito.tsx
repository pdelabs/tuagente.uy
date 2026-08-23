"use client";

// The agentito outside the canvas: look types + the same character's static
// SVG render (same geometry as public/agentito.riv, at /4 scale). Used for the
// sidebar logo, the fallback while Rive loads, the team's faces across the
// portal and the landing, and the bot's avatar as a PNG.
//
// THE GEOMETRY DOESN'T LIVE HERE: it lives in ./agentito-svg.mjs, a pure
// React-free module that hermes-kit/tools/draw-agentito.mjs (the headless
// SVG/PNG generator) also consumes. This component only injects that string --
// by construction it can never diverge from the tool. If you touch a trait,
// touch it there. Rive's runtime is NOT imported here: this module ships in
// the common bundle and has to stay lightweight.

import {
  LOOK_AXES,
  LOOK_DEFAULT,
  renderAgentitoSVG,
  type AgentitoLook,
} from "./agentito-svg.mjs";

export { LOOK_AXES, LOOK_DEFAULT };

// The axes public/agentito.riv can actually DRAW today, and how many variants
// of each. The naming dice rolls from THIS table, not LOOK_AXES: an axis the
// Rive preview cannot show (hat; the scarf as suit 3) must never land on a
// client invisibly. When the .riv learns a trait, raise it here.
export const RIVE_AXES: Partial<Record<keyof AgentitoLook, number>> = {
  tone: 6, antenna: 6, accessory: 4, pupil: 3, mouth: 4, skin: 2, suit: 3, brows: 3,
};
export type { AgentitoLook };

const LOOK_KEY = "tuagente_agent_look";

/** The look the client chose for their agent (or the violet default). */
export function loadAgentLook(): AgentitoLook {
  if (typeof window === "undefined") return LOOK_DEFAULT;
  try {
    const raw = JSON.parse(localStorage.getItem(LOOK_KEY) || "null");
    if (!raw) return LOOK_DEFAULT;
    const look = { ...LOOK_DEFAULT };
    for (const axis of Object.keys(LOOK_AXES) as (keyof AgentitoLook)[]) {
      const v = Number(raw[axis]);
      if (Number.isInteger(v) && v >= 0 && v < LOOK_AXES[axis]) look[axis] = v;
    }
    return look;
  } catch {
    return LOOK_DEFAULT;
  }
}

export function saveAgentLook(look: AgentitoLook) {
  try {
    localStorage.setItem(LOOK_KEY, JSON.stringify(look));
  } catch {
    /* private mode */
  }
}

/** Does this browser already know what the agent looks like, or does it have
 *  to ask? */
export function hasSavedLook(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(LOOK_KEY) !== null;
  } catch {
    return false;
  }
}

/** The look exactly as the agent reports it in the manifest. Validated the
 *  same way as the browser's copy: the adapter checks the shape, not what
 *  each axis means. */
export function lookFromAgent(raw: unknown): AgentitoLook | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;
  const look = { ...LOOK_DEFAULT };
  let any = false;
  for (const axis of Object.keys(LOOK_AXES) as (keyof AgentitoLook)[]) {
    const v = Number(source[axis]);
    if (Number.isInteger(v) && v >= 0 && v < LOOK_AXES[axis]) {
      look[axis] = v;
      any = true;
    }
  }
  return any ? look : null;
}

/**
 * Placeholder while `next/dynamic` brings in Rive's runtime.
 *
 * HEADS UP: `next/dynamic`'s `loading` replaces the whole component, so it
 * receives NOTHING that's passed to AgentitoRive -- not the size, not the
 * look. Hence: it fills its container (the size lives in an outer div) and
 * reads the look from localStorage. Without this, a giant violet agentito
 * flashes for a moment.
 */
export function AgentitoLoading() {
  return <AgentitoAvatar look={loadAgentLook()} alive className="h-full w-full" />;
}

/**
 * The still agentito: a thin wrapper over `renderAgentitoSVG`. `alive` gives it
 * a CSS float + blink (only for onboarding's fallback); the sidebar logo goes
 * static.
 *
 * `renderAgentitoSVG`'s option keys match this component's props one-to-one:
 * that module is also imported by `hermes-kit/tools/preview-agentito.mjs`,
 * which builds the same object.
 */
export function AgentitoAvatar({ look = LOOK_DEFAULT, alive = false, withShadow = false, asleep = false, className }: {
  look?: AgentitoLook;
  alive?: boolean;
  withShadow?: boolean;
  /** Asleep: closed eyes and a still mouth. For when the agent isn't answering. */
  asleep?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`${alive ? "onb-bob " : ""}${className ?? ""}`}
      dangerouslySetInnerHTML={{
        __html: renderAgentitoSVG(look, { withShadow, asleep, alive }),
      }}
    />
  );
}
