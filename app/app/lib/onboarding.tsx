"use client";

// Onboarding del portal: se ve UNA sola vez, antes que cualquier módulo.
// Paso 1: el cliente bautiza a su agente — ponerle nombre es la primera
// decisión que toma sobre él. Paso 2: el agente, ya con nombre, cuenta en
// tres líneas qué va a pasar acá adentro.
//
// El nombre queda en localStorage y el portal lo muestra en lugar del nombre
// técnico del manifest. Escribirlo en el agente (SOUL) sigue siendo el
// pendiente de personalización: desde acá no hay cómo, todavía.

import { useEffect, useRef, useState } from "react";
import { ArrowRight, Columns3, Hand, MessageSquare } from "lucide-react";
import { Btn } from "./ui";
import type { Manifest } from "./agent";

const NAME_KEY = "tuagente_agent_name";

/** Nombre que el cliente le puso a su agente, o null si nunca lo bautizó. */
export function loadAgentName(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(NAME_KEY);
  } catch {
    return null;
  }
}

/** Cómo llamamos al agente en el portal: el nombre del cliente, o el del manifest. */
export function agentDisplayName(manifest: Manifest | null): string {
  return loadAgentName() || manifest?.agent || "tu agente";
}

/** La cara del agentito, grande. Los ojos siguen el cursor (solo pointer fino). */
function Agentito() {
  const svgRef = useRef<SVGSVGElement>(null);
  const pupilsRef = useRef<SVGGElement>(null);

  useEffect(() => {
    if (window.matchMedia("(pointer: coarse)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const onMove = (e: MouseEvent) => {
      const svg = svgRef.current, pupils = pupilsRef.current;
      if (!svg || !pupils) return;
      const r = svg.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      const d = Math.hypot(dx, dy) || 1;
      pupils.setAttribute("transform", `translate(${(dx / d) * 3.4} ${(dy / d) * 3.4})`);
    };
    window.addEventListener("mousemove", onMove, { passive: true });
    return () => window.removeEventListener("mousemove", onMove);
  }, []);

  return (
    <svg ref={svgRef} viewBox="0 0 120 120" className="h-full w-full" aria-hidden>
      <line x1="60" y1="22" x2="60" y2="11" stroke="#5B4BE8" strokeWidth="4" strokeLinecap="round" />
      <circle cx="60" cy="9" r="4.5" fill="#5B4BE8" />
      <ellipse cx="60" cy="68" rx="46" ry="44" fill="#5B4BE8" />
      <g className="onb-eyes">
        <circle cx="46" cy="58" r="10.5" fill="#fff" />
        <circle cx="74" cy="58" r="10.5" fill="#fff" />
        <g ref={pupilsRef}>
          <circle cx="46" cy="58" r="4.6" fill="#14131F" />
          <circle cx="74" cy="58" r="4.6" fill="#14131F" />
        </g>
      </g>
      <path d="M48 80 Q60 89 72 80" stroke="#fff" strokeWidth="4.5" strokeLinecap="round" fill="none" />
    </svg>
  );
}

// Qué contamos en el paso 2: solo lo que el manifest habilita.
const PUNTOS = [
  {
    key: "chat",
    icon: MessageSquare,
    tono: "bg-c-violet",
    titulo: "Chat",
    texto: "Hablame como a cualquiera del equipo: me pedís las cosas en tus palabras.",
  },
  {
    key: "kanban",
    icon: Columns3,
    tono: "bg-c-amber",
    titulo: "Tickets",
    texto: "Cada pedido queda como un ticket que seguís de punta a punta.",
  },
  {
    key: "approvals",
    icon: Hand,
    tono: "bg-c-coral",
    titulo: "Aprobaciones",
    texto: "Antes de un paso sensible freno y espero tu visto bueno.",
  },
];

export default function Onboarding({ manifest, onDone }: {
  manifest: Manifest;
  onDone: (name: string) => void;
}) {
  const [nombre, setNombre] = useState(() => loadAgentName() ?? "");
  const [paso, setPaso] = useState<"bautismo" | "presentacion">("bautismo");
  const listo = nombre.trim().length > 0;

  const bautizar = () => {
    if (!listo) return;
    const n = nombre.trim();
    try {
      localStorage.setItem(NAME_KEY, n);
    } catch {
      /* modo privado: al menos vale para esta sesión */
    }
    setNombre(n);
    setPaso("presentacion");
  };

  const puntos = PUNTOS.filter((p) => manifest.modules[p.key]);

  return (
    <main className="app-shell flex min-h-screen items-center justify-center bg-surface px-6 py-12">
      <div className="flex w-full max-w-2xl flex-col items-center text-center">
        <div className={`onb-bob transition-all duration-500 ${paso === "bautismo" ? "h-36 w-36" : "h-24 w-24"}`}>
          <Agentito />
        </div>

        <h1 className="mt-6 text-[32px] font-extrabold leading-tight tracking-tight text-ink sm:text-[38px]">
          ¡Hola! Soy{" "}
          {paso === "bautismo" ? (
            <input
              autoFocus
              value={nombre}
              maxLength={24}
              onChange={(e) => setNombre(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && bautizar()}
              placeholder="…"
              aria-label="Nombre para tu agente"
              className="inline-block w-[6.5em] max-w-[70vw] border-b-[3px] border-black/15 bg-transparent text-center text-[32px] font-extrabold tracking-tight text-primary outline-none transition placeholder:text-ink-soft/30 focus:border-primary sm:text-[38px]"
            />
          ) : (
            <span className="text-primary">{nombre}</span>
          )}
        </h1>

        {paso === "bautismo" ? (
          <>
            <p className="mt-4 max-w-md text-[15px] leading-relaxed text-ink-soft">
              Todavía no tengo nombre. Elegilo vos: así me vas a ver en todo el portal.
            </p>
            <div className="mt-8">
              <Btn disabled={!listo} onClick={bautizar}>
                Continuar <ArrowRight className="h-4 w-4" />
              </Btn>
            </div>
          </>
        ) : (
          <div className="animate-fadeup">
            <p className="mx-auto mt-4 max-w-lg text-[15px] leading-relaxed text-ink-soft">
              Encantado. Trabajo para tu empresa: me pedís cosas, las resuelvo
              con tus sistemas y todo lo que hago queda a la vista acá.
            </p>

            {puntos.length > 0 && (
              <div className="mt-8 grid gap-3 text-left sm:grid-cols-3">
                {puntos.map((p) => {
                  const Icon = p.icon;
                  return (
                    <div key={p.key} className="rounded-card border border-black/[0.07] bg-white p-4">
                      <div className={`mb-3 flex h-9 w-9 items-center justify-center rounded-lg ${p.tono}`}>
                        <Icon className="h-4 w-4 text-ink" />
                      </div>
                      <p className="text-sm font-bold text-ink">{p.titulo}</p>
                      <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">{p.texto}</p>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="mt-8 flex flex-col items-center gap-2">
              <Btn onClick={() => onDone(nombre.trim())}>Entrar al portal</Btn>
              <span className="text-[12px] text-ink-soft">
                Cada sección se explica sola la primera vez que entrás.
              </span>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
