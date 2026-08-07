"use client";

// El agentito fuera del canvas: tipos del look + un render SVG estático del
// mismo personaje (misma geometría que public/agentito.riv, a escala /4).
// Sirve para el logo del sidebar, el fallback mientras carga Rive, y a futuro
// para generar el avatar del bot (Telegram y compañía) como PNG.
// Acá NO se importa el runtime de Rive: este módulo entra en el bundle común
// y tiene que seguir siendo liviano.

/** Rasgos del personaje; cada eje es un input numérico del state machine. */
export type AgentitoLook = {
  tono: number;      // 0-5: color del cuerpo
  antena: number;    // 0-5: clásica / doble / sin nada / orejas / aro / rulito
  accesorio: number; // 0-3: nada / anteojos / cachetes / pecas
  pupila: number;    // 0-2: normal / grande / chica
  boca: number;      // 0-3: sonrisa / sonrisota / media sonrisa / lengüita
  piel: number;      // 0-1: lisa / motas
  traje: number;     // 0-2: nada / moño / corbata
  cejas: number;     // 0-2: sin / normales / decididas
};

export const LOOK_EJES: Record<keyof AgentitoLook, number> = {
  tono: 6, antena: 6, accesorio: 4, pupila: 3, boca: 4, piel: 2, traje: 3, cejas: 3,
};

export const LOOK_DEFAULT: AgentitoLook = {
  tono: 0, antena: 0, accesorio: 0, pupila: 0, boca: 0, piel: 0, traje: 0, cejas: 0,
};

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

const TONOS = ["#5B4BE8", "#00A67E", "#FF7A59", "#F0B429", "#3D8BE8", "#E86BB3"];
const INK = "#14131F";
// Dónde queda la tapa que recorta la sonrisa, por variante de boca.
const TAPA_Y = [67, 64.5, 69.5, 65];

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
 * El agentito quieto, en SVG puro. `vivo` le da flote + parpadeo por CSS
 * (solo para el fallback del onboarding); el logo del sidebar va estático.
 */
export function AgentitoAvatar({ look = LOOK_DEFAULT, vivo = false, conSombra = false, apagado = false, className }: {
  look?: AgentitoLook;
  vivo?: boolean;
  conSombra?: boolean;
  /** Dormido: ojos cerrados y boca quieta. Para cuando el agente no responde. */
  apagado?: boolean;
  className?: string;
}) {
  const tono = TONOS[look.tono] ?? TONOS[0];
  const pupilaR = 4.75 * [1, 1.35, 0.75][look.pupila];
  const tapaY = TAPA_Y[look.boca] ?? TAPA_Y[0];

  return (
    <div className={`${vivo ? "onb-bob " : ""}${className ?? ""}`}>
      <svg viewBox="0 0 120 120" className="h-full w-full" aria-hidden>
        {conSombra && <ellipse cx="60" cy="114" rx="26" ry="3.2" fill={INK} opacity="0.12" />}

        {/* Antena (atrás del cuerpo) */}
        {look.antena === 0 && (
          <g fill={tono}>
            <rect x="57.75" y="12.5" width="4.5" height="12" rx="2" />
            <circle cx="60" cy="11" r="5.25" />
          </g>
        )}
        {look.antena === 1 && (
          <g fill={tono}>
            <rect x="50.9" y="13.5" width="3.25" height="11" rx="1.5" transform="rotate(-18 52.5 19)" />
            <rect x="65.9" y="13.5" width="3.25" height="11" rx="1.5" transform="rotate(18 67.5 19)" />
            <circle cx="50.5" cy="12.5" r="3.5" />
            <circle cx="69.5" cy="12.5" r="3.5" />
          </g>
        )}
        {look.antena === 3 && (
          <g fill={tono}>
            <ellipse cx="13.5" cy="62" rx="5" ry="7" />
            <ellipse cx="106.5" cy="62" rx="5" ry="7" />
          </g>
        )}
        {look.antena === 4 && (
          <g>
            <rect x="57.75" y="12.5" width="4.5" height="12" rx="2" fill={tono} />
            <circle cx="60" cy="12" r="4.5" fill="none" stroke={tono} strokeWidth="2.25" />
          </g>
        )}
        {look.antena === 5 && (
          <path
            d="M61 18a1 1 0 1 0-2 0a2 2 0 1 0 4 0a3.2 3.2 0 1 0-6.4 0a4.5 4.5 0 1 0 9 0"
            fill="none" stroke={tono} strokeWidth="2.25" strokeLinecap="round"
          />
        )}

        {/* Cuerpo */}
        <ellipse cx="60" cy="68" rx="46" ry="44" fill={tono} />

        {/* Piel: motas */}
        {look.piel === 1 && (
          <g fill="#FFFFFF" opacity="0.15">
            <circle cx="28" cy="81" r="2" />
            <circle cx="36" cy="97.5" r="1.5" />
            <circle cx="64.5" cy="101.5" r="1.75" />
            <circle cx="86" cy="90" r="1.4" />
            <circle cx="92" cy="74.5" r="1.25" />
          </g>
        )}

        {/* Boca: sonrisa blanca + tapa color cuerpo (+ lengüita) */}
        {apagado ? (
          <path d="M53 76 h14" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" opacity="0.85" />
        ) : (
          <>
            <ellipse cx="60" cy="73.5" rx="13" ry="9.5" fill="#fff" />
            <ellipse cx="60" cy={tapaY} rx="15.5" ry="9.75" fill={tono} />
            {look.boca === 3 && <ellipse cx="60" cy="81.5" rx="3.75" ry="2.5" fill="#FF8FA3" />}
          </>
        )}

        {/* Accesorios sobre el cuerpo */}
        {look.accesorio === 2 && (
          <g fill="#FF9EB5" opacity="0.7">
            <ellipse cx="33" cy="69" rx="4.5" ry="2.75" />
            <ellipse cx="87" cy="69" rx="4.5" ry="2.75" />
          </g>
        )}
        {look.accesorio === 3 && (
          <g fill={INK} opacity="0.16">
            <circle cx="42.5" cy="71" r="1.1" />
            <circle cx="46.5" cy="72.75" r="1" />
            <circle cx="50.5" cy="71" r="1.1" />
            <circle cx="69.5" cy="71" r="1.1" />
            <circle cx="73.5" cy="72.75" r="1" />
            <circle cx="77.5" cy="71" r="1.1" />
          </g>
        )}

        {/* Traje */}
        {look.traje === 1 && (
          <g fill={INK}>
            <polygon points="51.5,106.2 51.5,112.8 58,109.5" />
            <polygon points="68.5,106.2 68.5,112.8 62,109.5" />
            <rect x="58" y="107.5" width="4" height="4" rx="1.25" />
          </g>
        )}
        {look.traje === 2 && (
          <g fill={INK}>
            <rect x="56" y="100.25" width="8" height="4.5" rx="1" />
            <rect x="56.5" y="105" width="7" height="12" rx="1.75" />
            <polygon points="56.5,116.5 63.5,116.5 60,121" />
          </g>
        )}

        {/* Ojos */}
        {apagado ? (
          <g stroke="#fff" strokeWidth="3.5" strokeLinecap="round" fill="none" opacity="0.85">
            <path d="M38.5 58 q8 7 16 0" />
            <path d="M65.5 58 q8 7 16 0" />
          </g>
        ) : (
          <g className={vivo ? "onb-eyes" : undefined}>
            <ellipse cx="46.5" cy="59" rx="10.25" ry="11" fill="#fff" />
            <ellipse cx="73.5" cy="59" rx="10.25" ry="11" fill="#fff" />
            <circle cx="46.5" cy="59.5" r={pupilaR} fill={INK} />
            <circle cx="73.5" cy="59.5" r={pupilaR} fill={INK} />
            <circle cx="48.25" cy="57.75" r="1.5" fill="#fff" opacity="0.9" />
            <circle cx="75.25" cy="57.75" r="1.5" fill="#fff" opacity="0.9" />
          </g>
        )}

        {/* Anteojos y cejas, por encima de los ojos */}
        {look.accesorio === 1 && !apagado && (
          <g fill="none" stroke={INK} strokeWidth="1.75">
            <circle cx="46.5" cy="59" r="12.4" />
            <circle cx="73.5" cy="59" r="12.4" />
            <rect x="57.75" y="56" width="4.5" height="2" rx="1" fill={INK} stroke="none" />
          </g>
        )}
        {look.cejas > 0 && !apagado && (
          <g fill={INK}>
            <rect
              x="41" y="42.25" width="11" height="2.5" rx="1.25"
              transform={look.cejas === 2 ? "rotate(13.75 46.5 43.5)" : undefined}
            />
            <rect
              x="68" y="42.25" width="11" height="2.5" rx="1.25"
              transform={look.cejas === 2 ? "rotate(-13.75 73.5 43.5)" : undefined}
            />
          </g>
        )}
      </svg>
    </div>
  );
}
