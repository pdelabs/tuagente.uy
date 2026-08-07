"use client";

// Onboarding del portal: se ve UNA sola vez, antes que cualquier módulo.
// Paso 1: el cliente bautiza a su agente — ponerle nombre es la primera
// decisión que toma sobre él. Paso 2: el agente, ya con nombre, cuenta en
// tres líneas qué va a pasar acá adentro.
//
// El nombre queda en localStorage y el portal lo muestra en lugar del nombre
// técnico del manifest. Escribirlo en el agente (SOUL) sigue siendo el
// pendiente de personalización: desde acá no hay cómo, todavía.

import { useState } from "react";
import dynamic from "next/dynamic";
import { ArrowRight, Columns3, Dices, Hand, MessageSquare } from "lucide-react";
import { Btn } from "./ui";
import type { Manifest } from "./agent";
import {
  AgentitoAvatar, LOOK_DEFAULT, LOOK_EJES, loadAgentLook, saveAgentLook,
  type AgentitoLook,
} from "./agentito";

// El runtime de Rive (~330 KB gz) se trae solo cuando el onboarding se muestra;
// el resto del portal no lo paga. Mientras tanto, la cara estática.
const AgentitoRive = dynamic(() => import("./AgentitoRive"), {
  ssr: false,
  loading: () => <AgentitoAvatar vivo className="h-full w-full" />,
});

const NAME_KEY = "tuagente_agent_name";

/** Un look al azar, garantizado distinto del actual. */
function sortearLook(actual: AgentitoLook): AgentitoLook {
  for (;;) {
    const look = { ...actual };
    for (const eje of Object.keys(LOOK_EJES) as (keyof AgentitoLook)[]) {
      look[eje] = Math.floor(Math.random() * LOOK_EJES[eje]);
    }
    if (Object.keys(LOOK_EJES).some((e) => look[e as keyof AgentitoLook] !== actual[e as keyof AgentitoLook])) {
      return look;
    }
  }
}

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
  // Contador de festejos: cada bautismo dispara el trigger del personaje.
  const [festejos, setFestejos] = useState(0);
  const [look, setLook] = useState<AgentitoLook>(() => loadAgentLook());
  const listo = nombre.trim().length > 0;

  const otroLook = () => {
    const nuevo = sortearLook(look);
    saveAgentLook(nuevo);
    setLook(nuevo);
  };

  const bautizar = () => {
    if (!listo) return;
    const n = nombre.trim();
    try {
      localStorage.setItem(NAME_KEY, n);
    } catch {
      /* modo privado: al menos vale para esta sesión */
    }
    setNombre(n);
    setFestejos((f) => f + 1);
    setPaso("presentacion");
  };

  const puntos = PUNTOS.filter((p) => manifest.modules[p.key]);

  return (
    <main className="app-shell flex min-h-screen items-center justify-center bg-surface px-6 py-12">
      <div className="flex w-full max-w-2xl flex-col items-center text-center">
        <div className={`transition-all duration-500 ${paso === "bautismo" ? "h-40 w-40" : "h-28 w-28"}`}>
          <AgentitoRive festejos={festejos} look={look} className="h-full w-full" />
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
            <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
              <Btn disabled={!listo} onClick={bautizar}>
                Continuar <ArrowRight className="h-4 w-4" />
              </Btn>
              <Btn kind="secondary" onClick={otroLook}>
                <Dices className="h-4 w-4" /> Otro look
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
