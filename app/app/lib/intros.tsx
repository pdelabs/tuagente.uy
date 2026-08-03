"use client";

// Pantalla de bienvenida por módulo: se muestra la primera vez que el cliente
// entra a cada sección y se cierra con "Ok, entendí" (queda recordado).
// Textos genéricos: sirven para CUALQUIER agente, no describen un caso puntual.

import { useEffect, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { Btn } from "./ui";

const KEY = "tuagente_intro_v1";

export type Intro = { title: string; lead: string; bullets: string[] };

export const INTROS: Record<string, Intro> = {
  chat: {
    title: "Chat",
    lead: "Hablá con tu agente como le hablarías a alguien de tu equipo.",
    bullets: [
      "Pedile información o encargale tareas; trabaja con los sistemas que le conectaste.",
      "Cada conversación queda guardada: podés retomarla cuando quieras.",
      "Si algo necesita tu visto bueno, te lo va a pedir antes de hacerlo.",
    ],
  },
  kanban: {
    title: "Pipeline",
    lead: "Todo lo que tu agente tiene entre manos, en un tablero.",
    bullets: [
      "Cada tarjeta es una tarea: esperando aprobación, en curso o completada.",
      "Abrí una tarjeta para ver el detalle, los comentarios del agente y su historial.",
      "El tablero se actualiza solo mientras tu agente trabaja.",
    ],
  },
  approvals: {
    title: "Aprobaciones",
    lead: "Tu agente frena y te consulta antes de los pasos sensibles.",
    bullets: [
      "Aprobar desbloquea la tarea; el próximo paso lo deciden las reglas de tu agente.",
      "Rechazar deja tu motivo asentado para que el agente lo tenga en cuenta.",
      "Qué requiere aprobación se define al configurarlo, y se puede cambiar.",
    ],
  },
  crons: {
    title: "Tareas",
    lead: "Lo que tu agente hace solo, sin que se lo pidas.",
    bullets: [
      "Mirá con qué frecuencia corre cada una y cómo salió la última vez.",
      "Podés pausarlas, reanudarlas o correrlas ahora mismo.",
      "Es una consola de control: crear o cambiar tareas se hace con nosotros.",
    ],
  },
  activity: {
    title: "Actividad",
    lead: "La bitácora de tu agente, en orden cronológico.",
    bullets: [
      "Verás sus tareas programadas y los movimientos de cada tarjeta del pipeline.",
      "El color dice cómo salió: verde bien, coral con error, ámbar en curso.",
    ],
  },
  files: {
    title: "Archivos",
    lead: "Lo que tu agente fue escribiendo mientras trabaja.",
    bullets: [
      "Reportes, listados y borradores que genera por su cuenta.",
      "Podés abrirlos y leerlos acá; es solo lectura, nada se modifica.",
    ],
  },
  usage: {
    title: "Uso",
    lead: "Cuánto trabajó tu agente en el último mes.",
    bullets: [
      "Sesiones atendidas y consumo, con la evolución de los últimos días.",
      "Sirve para dimensionar cuánto lo estás usando de verdad.",
    ],
  },
};

export function useIntroGate() {
  const [seen, setSeen] = useState<Record<string, boolean> | null>(null);

  useEffect(() => {
    try {
      setSeen(JSON.parse(localStorage.getItem(KEY) || "{}"));
    } catch {
      setSeen({});
    }
  }, []);

  const dismiss = (key: string) => {
    setSeen((prev) => {
      const next = { ...(prev ?? {}), [key]: true };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* modo privado: al menos vale para esta sesión */
      }
      return next;
    });
  };

  return { seen, dismiss };
}

export function ModuleIntro({ intro, icon: Icon, onOk }: {
  intro: Intro;
  icon: LucideIcon;
  onOk: () => void;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center px-6 py-10">
      <div className="w-full max-w-lg rounded-xl border border-black/[0.07] bg-white p-8">
        <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-c-violet">
          <Icon className="h-5 w-5 text-primary" />
        </div>
        <h1 className="text-xl font-bold tracking-tight text-ink">{intro.title}</h1>
        <p className="mt-1 text-sm text-ink-soft">{intro.lead}</p>
        <ul className="mt-5 flex flex-col gap-2.5">
          {intro.bullets.map((b) => (
            <li key={b} className="flex gap-2.5 text-sm leading-relaxed text-ink">
              <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
              {b}
            </li>
          ))}
        </ul>
        <div className="mt-7">
          <Btn onClick={onOk}>Ok, entendí</Btn>
        </div>
      </div>
    </div>
  );
}
