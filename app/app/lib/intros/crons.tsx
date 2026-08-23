"use client";

// Tasks' welcome screen.
//
// The idea to get across is "your agent also works when you're not watching".
// That's why the illustration is a DAY: a 24-hour strip with three tasks and
// their runs marked -- the ones that already happened filled in, the ones
// still to come hollow, and a "now" marker crossing all three lanes. At a
// glance you see the cadence, what already ran and what's coming.
//
// Below, the list of what you can do to a task (run it now, pause, resume),
// without promising what the portal doesn't do (create or edit).
//
// The drawn day sits inside `Mockup`: three named tasks, one "Pausada" and one
// that "failed" 24 minutes ago are three claims about the client's own agent.
// And the three controls below stopped being pill-shaped: they're the names
// of that tab's real buttons, and drawn as buttons they invited a tap right here.
//
// (Today this welcome screen never actually gets seen: "Tareas" left the nav
// when Flujos replaced it, so no module in `MODULES` claims it. Fixed anyway
// -- the route is still alive and the registry still points here.)

import type { ReactNode } from "react";
import {
  CheckCircle2, Clock, Pause, Play, SlidersHorizontal, Zap,
} from "lucide-react";
import { Eyebrow, IntroPage, Lead, Mockup, Step, Point, Title, type IntroProps } from "./shell";

// Hour of the day (0-24) the mockup is frozen at.
const NOW = 15.4;

// Marks are mapped to 3%-97% of the lane so neither 00:00's nor 23:00's ends
// up cut off against the edge.
const pos = (h: number) => `${3 + (h / 24) * 94}%`;

type Task = {
  name: string;
  cadence: string;
  status: "active" | "paused";
  last: string;
  failed?: boolean;
  hours: number[];
};

const TASKS: Task[] = [
  {
    name: "Resumen de la mañana",
    cadence: "Todos los días a las 08:00",
    status: "active",
    last: "hoy 08:00",
    hours: [8],
  },
  {
    name: "Chequeo de novedades",
    cadence: "Cada 3 horas",
    status: "active",
    last: "hace 24 min",
    failed: true,
    hours: [0, 3, 6, 9, 12, 15, 18, 21],
  },
  {
    name: "Reporte semanal",
    cadence: "Los lunes a las 09:00",
    status: "paused",
    last: "el lunes",
    hours: [9],
  },
];

function Chip({ tone, children }: {
  tone: "green" | "amber" | "coral";
  children: ReactNode;
}) {
  const tones = {
    green: "bg-c-green text-c-green-ink",
    amber: "bg-c-amber text-c-amber-ink",
    coral: "bg-c-coral text-c-coral-ink",
  };
  return (
    <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold ${tones[tone]}`}>
      {children}
    </span>
  );
}

/** A 24h lane with a task's runs. */
function Track({ hours, paused }: { hours: number[]; paused: boolean }) {
  return (
    <div className="relative mt-2 h-5">
      {/* the day's full rail */}
      <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-black/[0.09]" />
      {/* the stretch already elapsed */}
      {!paused && (
        <div
          className="absolute left-0 top-1/2 h-px -translate-y-1/2 bg-primary/30"
          style={{ width: pos(NOW) }}
        />
      )}
      {/* "now" marker, crossing the lane */}
      <div
        className="tga-cron-now absolute top-0 h-full w-px bg-primary/45"
        style={{ left: pos(NOW) }}
      />
      {hours.map((h) => {
        const ran = h <= NOW;
        const cls = paused
          ? "border-black/[0.12] bg-black/[0.05]"
          : ran
            ? "border-primary bg-primary"
            : "border-primary/35 bg-white";
        return (
          <span
            key={h}
            className={`absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border ${cls}`}
            style={{ left: pos(h) }}
          />
        );
      })}
    </div>
  );
}

export default function CronsIntro({ onOk }: IntroProps) {
  return (
    <IntroPage
      onOk={onOk}
      cta="Ver mis tareas"
      note="Crear o cambiar tareas se coordina con nosotros."
    >
      <style>{`
        @keyframes tga-cron-now { 0%,100% { opacity: 1; } 50% { opacity: .35; } }
        .tga-cron-now { animation: tga-cron-now 3.2s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) { .tga-cron-now { animation: none; } }
      `}</style>

      <Eyebrow icon={Clock}>Tareas</Eyebrow>
      <Title>Lo que tu agente hace solo, sin que se lo pidas</Title>
      <Lead>
        Además de contestarte, tu agente tiene tareas programadas que corren por su cuenta. Acá
        está cada una con su frecuencia: cuándo le toca la próxima, cómo salió la última vez y qué
        podés hacer si querés intervenir.
      </Lead>

      {/* ── Just another day ────────────────────────────────────────────── */}
      <Mockup
        className="mt-6 overflow-hidden bg-gradient-to-br from-c-violet/60 via-surface to-white"
        note="Tareas inventadas: no son las de tu agente."
      >
        <p className="text-[11px] font-bold uppercase tracking-wide text-ink-soft">
          Un día cualquiera
        </p>
        {/* The "now" marker spans the card's width, aligned with the lanes. */}
        <div className="relative mt-1 h-4">
          <span
            className="tga-cron-now absolute -translate-x-1/2 text-[10px] font-bold text-primary"
            style={{ left: pos(NOW) }}
          >
            ahora
          </span>
        </div>

        <div className="divide-y divide-black/[0.06]">
          {TASKS.map((t) => (
            <div key={t.name} className="py-3 first:pt-2 last:pb-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <p className="text-[13px] font-semibold text-ink">{t.name}</p>
                {t.status === "active" ? (
                  <Chip tone="green">Activa</Chip>
                ) : (
                  <Chip tone="amber">Pausada</Chip>
                )}
                <span className="ml-auto flex items-center gap-1.5 text-[11px] text-ink-soft">
                  <span>Última: {t.last}{t.failed ? "" : " · ok"}</span>
                  {t.failed && <Chip tone="coral">falló</Chip>}
                </span>
              </div>
              <p className="mt-0.5 text-[12px] text-ink-soft">{t.cadence}</p>
              <Track hours={t.hours} paused={t.status === "paused"} />
            </div>
          ))}
        </div>

        {/* Day axis, aligned with the lanes */}
        <div className="relative mt-1 h-4">
          {[0, 6, 12, 18].map((h) => (
            <span
              key={h}
              className="absolute -translate-x-1/2 text-[10px] font-semibold text-ink-soft"
              style={{ left: pos(h) }}
            >
              {String(h).padStart(2, "0")}
            </span>
          ))}
        </div>
      </Mockup>

      {/* ── What you can do to each task, INSIDE ───────────────────────── */}
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-card border border-black/[0.07] bg-white px-4 py-3">
        <p className="text-[12px] font-semibold text-ink-soft">Sobre cada tarea podés:</p>
        <Step icon={Zap}>Correr ahora</Step>
        <Step icon={Pause}>Pausar</Step>
        <Step icon={Play}>Reanudar</Step>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <Point icon={Clock} title="Cuándo le toca">
          La cadencia escrita en criollo y la próxima corrida, sin leer un cron.
        </Point>
        <Point icon={CheckCircle2} title="Cómo salió">
          Si la última corrida terminó bien o falló, y hace cuánto fue.
        </Point>
        <Point icon={SlidersHorizontal} title="Vos tenés el freno">
          Pausás una tarea cuando molesta y la reanudás cuando querés.
        </Point>
      </div>
    </IntroPage>
  );
}
