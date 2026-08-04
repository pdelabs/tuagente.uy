"use client";

// Bienvenida de "Uso".
// Composición: un panel horizontal con los KPIs a la izquierda y el gráfico de
// barras (creciente, día por día) a la derecha; abajo, tres puntos en fila.
// Ilustración en divs, sin imágenes externas; la animación respeta
// prefers-reduced-motion.

import { BarChart3, CalendarDays, MessagesSquare, Wallet } from "lucide-react";
import { IntroPage, Eyebrow, Title, Lead, Point, type IntroProps } from "./shell";

const CSS = `
@keyframes tgu-grow { from { transform: scaleY(.04); } to { transform: scaleY(1); } }
.tgu-bar { transform-origin: bottom; animation: tgu-grow .6s cubic-bezier(.2,.7,.2,1) both; }
@media (prefers-reduced-motion: reduce) { .tgu-bar { animation: none; } }
`;

// Alturas relativas de los últimos 14 días: sube, pero con el ruido normal de
// un mes real (no una rampa perfecta).
const BARS = [24, 31, 27, 38, 34, 45, 41, 36, 54, 49, 61, 57, 70, 86];

function Kpi({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-black/[0.06] bg-surface px-3 py-2.5">
      <p className="truncate text-[10px] font-bold uppercase tracking-wide text-ink-soft">{label}</p>
      <p className="mt-1 text-[22px] font-extrabold leading-none tabular-nums text-ink">
        {value}
        {unit && <span className="ml-1 text-[12px] font-bold text-ink-soft">{unit}</span>}
      </p>
    </div>
  );
}

function Dot({ tone }: { tone: string }) {
  return <span className={`h-1.5 w-1.5 rounded-full ${tone}`} />;
}

function Panel() {
  return (
    <div className="min-w-0 rounded-card border border-black/[0.07] bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="text-[11px] font-bold uppercase tracking-wide text-ink-soft">
          Últimos 30 días
        </p>
        <p className="flex items-center gap-2.5 text-[10px] text-ink-soft">
          <span className="flex items-center gap-1">
            <Dot tone="bg-primary" />
            entrada
          </span>
          <span className="flex items-center gap-1">
            <Dot tone="bg-primary/40" />
            salida
          </span>
        </p>
      </div>

      {/* El portal ya se come 224px de sidebar: la partición recién a partir de md. */}
      <div className="grid gap-3 md:grid-cols-[8.5rem_minmax(0,1fr)]">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-1">
          <Kpi label="Sesiones" value="128" />
          <Kpi label="Tokens" value="1,24" unit="M" />
        </div>

        <div className="min-w-0">
          <div className="relative">
            {/* Dos guías finas: dan escala sin ensuciar. */}
            <div className="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-black/[0.07]" />
            <div className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-dashed border-black/[0.07]" />
            <div className="relative flex h-[104px] items-end gap-[3px] border-b border-black/[0.09] md:gap-1.5">
              {BARS.map((h, i) => (
                <div key={i} className="flex h-full min-w-0 flex-1 flex-col justify-end">
                  <div
                    style={{ height: `${h}%`, animationDelay: `${i * 45}ms` }}
                    className="tgu-bar overflow-hidden rounded-t-[3px]"
                  >
                    <div className="h-[36%] bg-primary/40" />
                    <div className="h-[64%] bg-primary" />
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="mt-1.5 flex items-center justify-between text-[10px] tabular-nums text-ink-soft">
            <span>hace 14 días</span>
            <span>hoy</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function UsageIntro({ onOk }: IntroProps) {
  return (
    <IntroPage
      onOk={onOk}
      cta="Ver el uso"
      note="Si tu agente no reporta métricas, te avisamos."
    >
      <style>{CSS}</style>
      <Eyebrow icon={BarChart3}>Uso</Eyebrow>
      <Title>Cuánto trabajó tu agente en el último mes</Title>
      <Lead>
        Sesiones atendidas y consumo, con la evolución de los últimos días. Sirve para dimensionar
        cuánto lo estás usando de verdad y para anticipar lo que va a costar.
      </Lead>

      <div className="mt-6">
        <Panel />
      </div>

      <div className="mt-6 grid gap-5 md:grid-cols-3">
        <Point icon={MessagesSquare} title="Cuánto lo usaste">
          Las sesiones que atendió en el mes, sean tuyas o de sus tareas automáticas.
        </Point>
        <Point icon={CalendarDays} title="Cómo viene">
          El consumo día por día, para ver si está subiendo, bajando o parejo.
        </Point>
        <Point icon={Wallet} title="Cuánto sale">
          El consumo en tokens es lo que se traduce en costo: mirarlo cada tanto te deja
          anticiparlo.
        </Point>
      </div>
    </IntroPage>
  );
}
