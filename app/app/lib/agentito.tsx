"use client";

// El agentito fuera del canvas: tipos del look + el render SVG estático del
// mismo personaje (misma geometría que public/agentito.riv, a escala /4).
// Sirve para el logo del sidebar, el fallback mientras carga Rive, las caras
// del equipo en el portal y la landing, y el avatar del bot como PNG.
//
// LA GEOMETRÍA NO VIVE ACÁ: vive en ./agentito-svg.mjs, un módulo puro sin
// React que también consume hermes-kit/tools/dibujar-agentito.mjs (el
// generador headless de SVG/PNG). Este componente solo inyecta ese string —
// por construcción no puede divergir del tool. Si tocás un rasgo, tocalo allá.
// Acá NO se importa el runtime de Rive: este módulo entra en el bundle común
// y tiene que seguir siendo liviano.

import {
  LOOK_EJES,
  LOOK_DEFAULT,
  renderAgentitoSVG,
  type AgentitoLook,
} from "./agentito-svg.mjs";

export { LOOK_EJES, LOOK_DEFAULT };

// The axes public/agentito.riv can actually DRAW today, and how many variants
// of each. The baptism dice rolls from THIS table, not LOOK_EJES: an axis the
// Rive preview cannot show (sombrero; the scarf as traje 3) must never land
// on a client invisibly. When the .riv learns a trait, raise it here.
export const EJES_RIVE: Partial<Record<keyof AgentitoLook, number>> = {
  tono: 6, antena: 6, accesorio: 4, pupila: 3, boca: 4, piel: 2, traje: 3, cejas: 3,
};
export type { AgentitoLook };

const LOOK_KEY = "tuagente_agent_look";

/** El look que el cliente le eligió a su agente (o el default violeta). */
export function loadAgentLook(): AgentitoLook {
  if (typeof window === "undefined") return LOOK_DEFAULT;
  try {
    const raw = JSON.parse(localStorage.getItem(LOOK_KEY) || "null");
    if (!raw) return LOOK_DEFAULT;
    const look = { ...LOOK_DEFAULT };
    for (const eje of Object.keys(LOOK_EJES) as (keyof AgentitoLook)[]) {
      const v = Number(raw[eje]);
      if (Number.isInteger(v) && v >= 0 && v < LOOK_EJES[eje]) look[eje] = v;
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
    /* modo privado */
  }
}

/** ¿Este browser ya sabe qué pinta tiene el agente, o lo tiene que preguntar? */
export function hayLookGuardado(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(LOOK_KEY) !== null;
  } catch {
    return false;
  }
}

/** El look tal como lo reporta el agente en el manifiesto. Se valida igual que
 *  el del browser: el adapter chequea la forma, no qué significa cada eje. */
export function lookDesdeAgente(raw: unknown): AgentitoLook | null {
  if (!raw || typeof raw !== "object") return null;
  const crudo = raw as Record<string, unknown>;
  const look = { ...LOOK_DEFAULT };
  let alguno = false;
  for (const eje of Object.keys(LOOK_EJES) as (keyof AgentitoLook)[]) {
    const v = Number(crudo[eje]);
    if (Number.isInteger(v) && v >= 0 && v < LOOK_EJES[eje]) {
      look[eje] = v;
      alguno = true;
    }
  }
  return alguno ? look : null;
}

/**
 * Placeholder mientras `next/dynamic` trae el runtime de Rive.
 *
 * OJO: el `loading` de next/dynamic reemplaza al componente entero, así que no
 * recibe NADA de lo que le pasan a AgentitoRive — ni el tamaño ni el look. Por
 * eso: se llena a su contenedor (el tamaño va en un div de afuera) y lee el
 * look del localStorage. Sin esto parpadea un agentito violeta gigante.
 */
export function AgentitoCargando() {
  return <AgentitoAvatar look={loadAgentLook()} vivo className="h-full w-full" />;
}

/**
 * El agentito quieto: un wrapper fino sobre `renderAgentitoSVG`. `vivo` le da
 * flote + parpadeo por CSS (solo para el fallback del onboarding); el logo del
 * sidebar va estático.
 */
export function AgentitoAvatar({ look = LOOK_DEFAULT, vivo = false, conSombra = false, apagado = false, className }: {
  look?: AgentitoLook;
  vivo?: boolean;
  conSombra?: boolean;
  /** Dormido: ojos cerrados y boca quieta. Para cuando el agente no responde. */
  apagado?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`${vivo ? "onb-bob " : ""}${className ?? ""}`}
      dangerouslySetInnerHTML={{ __html: renderAgentitoSVG(look, { conSombra, apagado, vivo }) }}
    />
  );
}
