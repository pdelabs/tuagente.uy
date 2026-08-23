"use client";

// Activity's welcome screen.
//
// Here the illustration IS the product: a vertical log with its thread, the
// time on the left and a colored dot per event. Two days are shown so the
// grouping makes sense, and the second one fades out: the line keeps going down.
//
// The color code isn't explained in a paragraph: it's seen in the mockup and
// confirmed in the reference row below.
//
// And the drawn log sits inside `Mockup`: it used to be the real screen, with
// today's time and a "Chequeo de novedades — falló" at 11:15. A made-up piece
// of bad news on the tab that exists specifically to deliver the news is one
// of the worst things a drawing can claim.

import type { ReactNode } from "react";
import { Activity, CalendarDays, Eye, Layers } from "lucide-react";
import { Eyebrow, IntroPage, Lead, Mockup, Point, Title, type IntroProps } from "./shell";

type Tone = "green" | "amber" | "coral";

type Event = {
  time: string;
  tone: Tone;
  text: string;
  kind: "Tarea programada" | "Ticket";
  status: string;
  inProgress?: boolean;
};

// Newest on top, like on the real screen.
const TODAY: Event[] = [
  { time: "14:20", tone: "green", text: "Tarjeta cerrada", kind: "Ticket", status: "listo" },
  { time: "12:05", tone: "amber", text: "Tarjeta movida a En curso", kind: "Ticket", status: "en curso", inProgress: true },
  { time: "11:15", tone: "coral", text: "Chequeo de novedades", kind: "Tarea programada", status: "falló" },
  { time: "08:00", tone: "green", text: "Resumen de la mañana", kind: "Tarea programada", status: "ok" },
];

const YESTERDAY: Event[] = [
  { time: "19:30", tone: "green", text: "Reporte semanal", kind: "Tarea programada", status: "ok" },
];

// The dots are "donut"-style: light tonal fill + a border in that same tone's
// ink color. A 10px disc painted only with the ink (#0B3B2C, #4A3608,
// #4A1405) reads as black; this way green is told apart from coral at a
// glance, which is the whole point of this screen.
const DOT: Record<Tone, string> = {
  green: "border-c-green-ink bg-c-green",
  amber: "border-c-amber-ink bg-c-amber",
  coral: "border-c-coral-ink bg-c-coral",
};

const PULSE: Record<Tone, string> = {
  green: "bg-c-green-ink",
  amber: "bg-c-amber-ink",
  coral: "bg-c-coral-ink",
};

function Row({ event }: { event: Event }) {
  return (
    <li className="flex items-center gap-3 py-2">
      <span className="w-11 shrink-0 text-[12px] tabular-nums text-ink-soft">{event.time}</span>
      {/* The white ring cuts the thread behind the dot. */}
      <span className="relative z-10 flex h-3 w-3 shrink-0 items-center justify-center rounded-full ring-4 ring-white">
        {event.inProgress && (
          <span className={`tga-act-pulse absolute -inset-1 rounded-full ${PULSE[event.tone]}`} />
        )}
        <span className={`h-3 w-3 rounded-full border-2 ${DOT[event.tone]}`} />
      </span>
      <p className="min-w-0 flex-1 truncate text-[13px] text-ink">{event.text}</p>
      <span className="hidden shrink-0 rounded-md bg-black/[0.05] px-1.5 py-0.5 text-[10px] font-semibold text-ink-soft sm:inline">
        {event.kind}
      </span>
      <span className="w-14 shrink-0 text-right text-[11px] text-ink-soft">{event.status}</span>
    </li>
  );
}

function Group({ title, events, className = "" }: {
  title: string;
  events: Event[];
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-ink-soft">{title}</p>
      <ul className="relative">
        {/* Log's thread: passes through the dots' center (44px for the time +
            12px gap + 6px radius). */}
        <span className="absolute bottom-3 left-[62px] top-3 w-px bg-black/[0.13]" />
        {events.map((event) => (
          <Row key={`${title}-${event.time}`} event={event} />
        ))}
      </ul>
    </div>
  );
}

/** Color reference. No pill or background: it's a legend, not a filter --
 *  pill-shaped it read as the chips that DO filter on other screens. */
function Ref({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-ink-soft">
      <span className={`h-3 w-3 rounded-full border-2 ${DOT[tone]}`} />
      {children}
    </span>
  );
}

export default function ActivityIntro({ onOk }: IntroProps) {
  return (
    <IntroPage
      onOk={onOk}
      cta="Ver la bitácora"
      note="Se actualiza sola mientras la mirás."
    >
      <style>{`
        @keyframes tga-act-pulse { 0% { transform: scale(.6); opacity: .35; } 70%,100% { transform: scale(1.25); opacity: 0; } }
        .tga-act-pulse { animation: tga-act-pulse 2.4s ease-out infinite; }
        @media (prefers-reduced-motion: reduce) { .tga-act-pulse { animation: none; opacity: .2; } }
      `}</style>

      <Eyebrow icon={Activity}>Actividad</Eyebrow>
      <Title>Qué estuvo haciendo tu agente, sin preguntarle</Title>
      <Lead>
        La bitácora de tu agente en orden cronológico: sus tareas programadas y los movimientos de
        cada tarjeta del tablero, mezclados en una sola línea. Del movimiento más nuevo para atrás.
      </Lead>

      {/* ── The log ───────────────────────────────────────────────────────── */}
      <Mockup
        className="relative mt-6 overflow-hidden bg-white"
        note="Movimientos inventados: no son los de tu agente."
      >
        <div className="relative">
          <Group title="Hoy" events={TODAY} />
          <Group title="Ayer" events={YESTERDAY} className="mt-4 opacity-55" />
          {/* The line doesn't end: it fades going down. */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-white via-white/80 to-transparent" />
        </div>
      </Mockup>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="text-[12px] font-semibold text-ink-soft">El color dice cómo salió:</span>
        <Ref tone="green">salió bien</Ref>
        <Ref tone="amber">en curso</Ref>
        <Ref tone="coral">algo falló</Ref>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        <Point icon={Layers} title="Dos fuentes, una línea">
          Lo que corre solo y lo que pasa en el tablero, ordenado por hora.
        </Point>
        <Point icon={CalendarDays} title="Agrupado por día">
          Hoy, ayer y así para atrás, con la hora exacta de cada movimiento.
        </Point>
        <Point icon={Eye} title="Para mirar, no para tocar">
          Es el registro de lo que pasó: acá no se cambia nada.
        </Point>
      </div>
    </IntroPage>
  );
}
