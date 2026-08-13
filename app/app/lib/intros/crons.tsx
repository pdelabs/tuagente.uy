"use client";

// Bienvenida de Tareas.
//
// La idea a transmitir es "tu agente también trabaja cuando vos no estás
// mirando". Por eso la ilustración es un DÍA: una franja de 24 horas con tres
// tareas y sus corridas marcadas — las que ya pasaron llenas, las que faltan
// huecas, y la marca de "ahora" cruzando las tres pistas. De un vistazo se ve
// la cadencia, lo que ya corrió y lo que viene.
//
// Abajo, la lista de lo que se puede hacer sobre cada tarea (correr ahora,
// pausar, reanudar), sin prometer lo que el portal no hace (crear o editar).
//
// El día dibujado va adentro de `Maqueta`: tres tareas con nombre, una
// "Pausada" y una que "falló" hace 24 minutos son tres afirmaciones sobre el
// agente del cliente. Y los tres controles de abajo dejaron de tener forma de
// pastilla: son los nombres de los botones de verdad de esa pestaña, y
// dibujados como botones invitaban a apretarlos acá.
//
// (Hoy esta bienvenida no se llega a ver: "Tareas" salió del nav cuando Flujos
// la reemplazó, así que ningún módulo de `MODULES` la reclama. Se arregla igual
// — la ruta sigue viva y el registro sigue apuntando acá.)

import type { ReactNode } from "react";
import {
  CheckCircle2, Clock, Pause, Play, SlidersHorizontal, Zap,
} from "lucide-react";
import { Eyebrow, IntroPage, Lead, Maqueta, Paso, Point, Title, type IntroProps } from "./shell";

// Hora del día (0–24) en la que está parada la maqueta.
const AHORA = 15.4;

// Las marcas se mapean al 3%–97% de la pista para que ni la de las 00:00 ni la
// de las 23:00 queden cortadas contra el borde.
const pos = (h: number) => `${3 + (h / 24) * 94}%`;

type Tarea = {
  nombre: string;
  cadencia: string;
  estado: "activa" | "pausada";
  ultima: string;
  fallo?: boolean;
  horas: number[];
};

const TAREAS: Tarea[] = [
  {
    nombre: "Resumen de la mañana",
    cadencia: "Todos los días a las 08:00",
    estado: "activa",
    ultima: "hoy 08:00",
    horas: [8],
  },
  {
    nombre: "Chequeo de novedades",
    cadencia: "Cada 3 horas",
    estado: "activa",
    ultima: "hace 24 min",
    fallo: true,
    horas: [0, 3, 6, 9, 12, 15, 18, 21],
  },
  {
    nombre: "Reporte semanal",
    cadencia: "Los lunes a las 09:00",
    estado: "pausada",
    ultima: "el lunes",
    horas: [9],
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

/** Una pista de 24 h con las corridas de una tarea. */
function Pista({ horas, pausada }: { horas: number[]; pausada: boolean }) {
  return (
    <div className="relative mt-2 h-5">
      {/* riel completo del día */}
      <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-black/[0.09]" />
      {/* tramo ya transcurrido */}
      {!pausada && (
        <div
          className="absolute left-0 top-1/2 h-px -translate-y-1/2 bg-primary/30"
          style={{ width: pos(AHORA) }}
        />
      )}
      {/* marca de "ahora", cruzando la pista */}
      <div
        className="tga-cron-now absolute top-0 h-full w-px bg-primary/45"
        style={{ left: pos(AHORA) }}
      />
      {horas.map((h) => {
        const corrida = h <= AHORA;
        const cls = pausada
          ? "border-black/[0.12] bg-black/[0.05]"
          : corrida
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

      {/* ── Un día cualquiera ─────────────────────────────────────────────── */}
      <Maqueta
        className="mt-6 overflow-hidden bg-gradient-to-br from-c-violet/60 via-surface to-white"
        nota="Tareas inventadas: no son las de tu agente."
      >
        <p className="text-[11px] font-bold uppercase tracking-wide text-ink-soft">
          Un día cualquiera
        </p>
        {/* La marca de "ahora" vive a lo ancho de la tarjeta, alineada con las pistas. */}
        <div className="relative mt-1 h-4">
          <span
            className="tga-cron-now absolute -translate-x-1/2 text-[10px] font-bold text-primary"
            style={{ left: pos(AHORA) }}
          >
            ahora
          </span>
        </div>

        <div className="divide-y divide-black/[0.06]">
          {TAREAS.map((t) => (
            <div key={t.nombre} className="py-3 first:pt-2 last:pb-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <p className="text-[13px] font-semibold text-ink">{t.nombre}</p>
                {t.estado === "activa" ? (
                  <Chip tone="green">Activa</Chip>
                ) : (
                  <Chip tone="amber">Pausada</Chip>
                )}
                <span className="ml-auto flex items-center gap-1.5 text-[11px] text-ink-soft">
                  <span>Última: {t.ultima}{t.fallo ? "" : " · ok"}</span>
                  {t.fallo && <Chip tone="coral">falló</Chip>}
                </span>
              </div>
              <p className="mt-0.5 text-[12px] text-ink-soft">{t.cadencia}</p>
              <Pista horas={t.horas} pausada={t.estado === "pausada"} />
            </div>
          ))}
        </div>

        {/* Eje del día, alineado con las pistas */}
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
      </Maqueta>

      {/* ── Lo que se puede hacer sobre cada tarea, ADENTRO ────────────────── */}
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-card border border-black/[0.07] bg-white px-4 py-3">
        <p className="text-[12px] font-semibold text-ink-soft">Sobre cada tarea podés:</p>
        <Paso icon={Zap}>Correr ahora</Paso>
        <Paso icon={Pause}>Pausar</Paso>
        <Paso icon={Play}>Reanudar</Paso>
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
