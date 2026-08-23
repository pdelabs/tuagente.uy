// Type surface of agentito-svg.mjs (the pure geometry module). TypeScript pairs
// a .mjs import with a .d.mts declaration; keep both files' exports in sync.

/** Character traits; each axis is a numeric input of the Rive state machine. */
export type AgentitoLook = {
  tono: number;      // 0-5: body color
  antena: number;    // 0-5: classic / double / none / ears / hoop / curl
  accesorio: number; // 0-3: none / glasses / cheeks / freckles
  pupila: number;    // 0-2: normal / big / small
  boca: number;      // 0-3: smile / grin / half smile / tongue
  piel: number;      // 0-1: plain / specks
  traje: number;     // 0-3: none / bow / tie / scarf
  cejas: number;     // 0-2: none / normal / determined
  sombrero: number;  // 0-3: none / cap / beret / top hat
};

export declare const LOOK_EJES: Record<keyof AgentitoLook, number>;
export declare const LOOK_DEFAULT: AgentitoLook;
export declare const TONOS: string[];
export declare const INK: string;

export declare function renderAgentitoSVG(
  look?: AgentitoLook,
  opts?: { conSombra?: boolean; apagado?: boolean; vivo?: boolean; pad?: number },
): string;
