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
// touch it there. Rive's runtime is NOT imported here either: it travels as
// its own chunk, asked for by `AgentitoAnimated` when the character is drawn,
// because this module ships in the common bundle and has to stay lightweight.

import { useEffect, useState, type ComponentType } from "react";
import type { AgentitoState } from "./AgentitoRive";
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

type AgentitoAnimatedProps = {
  /** Counter: each increment fires the celebration trigger. */
  celebrations: number;
  look: AgentitoLook;
  state?: AgentitoState;
  className?: string;
};

/**
 * The animated character, WEARING THE LOOK IT WAS GIVEN FROM THE FIRST FRAME.
 *
 * Rive's runtime (~330 KB plus its wasm) is its own chunk and only travels
 * when the character is actually drawn; until it lands, the still agentito
 * stands in. It used to stand in through `next/dynamic`'s `loading`, which
 * receives NONE of the props -- not the size, not the look -- so the only
 * face it could read was the agent's own, out of the browser. ON A TEAM THAT
 * FACE BELONGS TO NOBODY: the greeter introduced the teammate the client had
 * just hired, by their name, wearing the agent's default violet until the
 * runtime arrived, and a reply being written in the chat did the same.
 * Holding the props here is what lets the stand-in wear the right face.
 */
export function AgentitoAnimated(props: AgentitoAnimatedProps) {
  const [Animated, setAnimated] = useState<ComponentType<AgentitoAnimatedProps> | null>(null);
  useEffect(() => {
    let alive = true;
    import("./AgentitoRive").then((m) => { if (alive) setAnimated(() => m.default); });
    return () => { alive = false; };
  }, []);
  if (!Animated) return <AgentitoAvatar look={props.look} alive className={props.className} />;
  return <Animated {...props} />;
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
