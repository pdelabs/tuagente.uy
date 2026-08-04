"use client";

// Bienvenida de Actividad.
//
// Acá la ilustración ES el producto: una bitácora vertical con su hilo, la hora
// a la izquierda y un puntito de color por evento. Se muestran dos días para
// que se entienda el agrupado, y el segundo se va desvaneciendo: la línea
// sigue hacia abajo.
//
// El código de colores no se explica en un párrafo: se ve en la maqueta y se
// confirma en la fila de referencias de abajo.

import type { ReactNode } from "react";
import { Activity, CalendarDays, Eye, Layers } from "lucide-react";
import { Eyebrow, IntroPage, Lead, Point, Title, type IntroProps } from "./shell";

type Tono = "green" | "amber" | "coral";

type Evento = {
  hora: string;
  tono: Tono;
  texto: string;
  tipo: "Tarea programada" | "Ticket";
  estado: string;
  enCurso?: boolean;
};

// Más nuevo arriba, como en la pantalla real.
const HOY: Evento[] = [
  { hora: "14:20", tono: "green", texto: "Tarjeta cerrada", tipo: "Ticket", estado: "listo" },
  { hora: "12:05", tono: "amber", texto: "Tarjeta movida a En curso", tipo: "Ticket", estado: "en curso", enCurso: true },
  { hora: "11:15", tono: "coral", texto: "Chequeo de novedades", tipo: "Tarea programada", estado: "falló" },
  { hora: "08:00", tono: "green", texto: "Resumen de la mañana", tipo: "Tarea programada", estado: "ok" },
];

const AYER: Evento[] = [
  { hora: "19:30", tono: "green", texto: "Reporte semanal", tipo: "Tarea programada", estado: "ok" },
];

// Los puntos son "dona": relleno tonal claro + borde en el ink del mismo tono.
// Un disco de 10px pintado solo con el ink (#0B3B2C, #4A3608, #4A1405) se lee
// negro; así se distingue el verde del coral de un vistazo, que es todo el
// punto de esta pantalla.
const DOT: Record<Tono, string> = {
  green: "border-c-green-ink bg-c-green",
  amber: "border-c-amber-ink bg-c-amber",
  coral: "border-c-coral-ink bg-c-coral",
};

const PULSO: Record<Tono, string> = {
  green: "bg-c-green-ink",
  amber: "bg-c-amber-ink",
  coral: "bg-c-coral-ink",
};

function Fila({ ev }: { ev: Evento }) {
  return (
    <li className="flex items-center gap-3 py-2">
      <span className="w-11 shrink-0 text-[12px] tabular-nums text-ink-soft">{ev.hora}</span>
      {/* El anillo blanco corta el hilo detrás del punto. */}
      <span className="relative z-10 flex h-3 w-3 shrink-0 items-center justify-center rounded-full ring-4 ring-white">
        {ev.enCurso && (
          <span className={`tga-act-pulse absolute -inset-1 rounded-full ${PULSO[ev.tono]}`} />
        )}
        <span className={`h-3 w-3 rounded-full border-2 ${DOT[ev.tono]}`} />
      </span>
      <p className="min-w-0 flex-1 truncate text-[13px] text-ink">{ev.texto}</p>
      <span className="hidden shrink-0 rounded-md bg-black/[0.05] px-1.5 py-0.5 text-[10px] font-semibold text-ink-soft sm:inline">
        {ev.tipo}
      </span>
      <span className="w-14 shrink-0 text-right text-[11px] text-ink-soft">{ev.estado}</span>
    </li>
  );
}

function Grupo({ titulo, eventos, className = "" }: {
  titulo: string;
  eventos: Evento[];
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-ink-soft">{titulo}</p>
      <ul className="relative">
        {/* Hilo de la bitácora: pasa por el centro de los puntos (44px de hora
            + 12px de gap + 6px de radio). */}
        <span className="absolute bottom-3 left-[62px] top-3 w-px bg-black/[0.13]" />
        {eventos.map((ev) => (
          <Fila key={`${titulo}-${ev.hora}`} ev={ev} />
        ))}
      </ul>
    </div>
  );
}

function Ref({ tono, children }: { tono: Tono; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-pill border border-black/[0.07] bg-white px-2.5 py-1 text-[12px] text-ink-soft">
      <span className={`h-3 w-3 rounded-full border-2 ${DOT[tono]}`} />
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

      {/* ── La bitácora ───────────────────────────────────────────────────── */}
      <div className="relative mt-6 overflow-hidden rounded-card border border-black/[0.07] bg-white p-4 sm:p-5">
        <Grupo titulo="Hoy" eventos={HOY} />
        <Grupo titulo="Ayer" eventos={AYER} className="mt-4 opacity-55" />
        {/* La línea no termina: se va hacia abajo. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-white via-white/80 to-transparent" />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-[12px] font-semibold text-ink-soft">El color dice cómo salió:</span>
        <Ref tono="green">salió bien</Ref>
        <Ref tono="amber">en curso</Ref>
        <Ref tono="coral">algo falló</Ref>
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
