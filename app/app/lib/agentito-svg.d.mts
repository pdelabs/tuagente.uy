// Type surface of agentito-svg.mjs (the pure geometry module). TypeScript pairs
// a .mjs import with a .d.mts declaration; keep both files' exports in sync.

/** Character traits; each axis is a numeric input of the Rive state machine. */
export type AgentitoLook = {
  tone: number;      // 0-5: body color
  antenna: number;   // 0-5: classic / double / none / ears / hoop / curl
  accessory: number; // 0-3: none / glasses / cheeks / freckles
  pupil: number;     // 0-2: normal / big / small
  mouth: number;     // 0-3: smile / grin / half smile / tongue
  skin: number;      // 0-1: plain / specks
  suit: number;      // 0-3: none / bow / tie / scarf
  brows: number;     // 0-2: none / normal / determined
  hat: number;       // 0-3: none / cap / beret / top hat
};

export declare const LOOK_AXES: Record<keyof AgentitoLook, number>;
export declare const LOOK_DEFAULT: AgentitoLook;
export declare const TONES: string[];
export declare const INK: string;

export declare function renderAgentitoSVG(
  look?: AgentitoLook,
  opts?: { withShadow?: boolean; asleep?: boolean; alive?: boolean; pad?: number },
): string;
