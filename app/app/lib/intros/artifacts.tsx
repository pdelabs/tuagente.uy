"use client";

// Artifacts' welcome screen.
//
// The concept is NEW to the client ("artifact?"), so the screen doesn't
// explain it: it shows it. Up top, a mockup of three mini-artifacts (a chart,
// a table and some KPIs) so it clicks at a glance that visualizations live
// here; below, a small piece of chat that teaches the two halves people don't
// guess on their own: how you ask for one and how it gets quoted.
//
// Everything is inline div/SVG: no images, no real data, nothing from any
// client's own domain. But "this isn't anyone's data" doesn't show from the
// outside: 1,284 and +12% drawn with real numbers' own typography read as
// someone's actual numbers. That's why both drawings sit inside `Mockup`,
// which spells it out.

import type { ReactNode } from "react";
import {
  BarChart3, Download, LayoutDashboard, Search, Sparkles,
} from "lucide-react";
import { Eyebrow, IntroPage, Lead, Mockup, Point, Title, type IntroProps } from "./shell";

// Heights of the mini-chart's bars (%), shaped to read as "this has been
// growing" without asserting anything about anyone.
const BARS = [40, 63, 48, 82, 66, 96];

// Sparkline for the KPI card.
const SPARK = "3,20 13,14 23,17 33,9 44,11 55,4";

function Tag({ tone, children }: {
  tone: "violet" | "green" | "amber";
  children: ReactNode;
}) {
  const tones = {
    violet: "bg-c-violet text-c-violet-ink",
    green: "bg-c-green text-c-green-ink",
    amber: "bg-c-amber text-c-amber-ink",
  };
  return (
    <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold ${tones[tone]}`}>
      {children}
    </span>
  );
}

/** Frame for each mini-artifact: hairline, no shadow, contained radius. */
function Mini({ title, label, className = "", children }: {
  title: string;
  label: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`rounded-2xl border border-black/[0.07] bg-white p-3 ${className}`}>
      <div className="mb-2.5 flex items-center gap-2">
        <p className="truncate text-[11px] font-bold text-ink">{title}</p>
        <span className="ml-auto">{label}</span>
      </div>
      {children}
    </div>
  );
}

/** Mini-table cell: a gray bar hinting at text. */
function Cell({ w }: { w: string }) {
  return <span className="block h-1.5 rounded-pill bg-black/[0.09]" style={{ width: w }} />;
}

export default function ArtifactsIntro({ onOk }: IntroProps) {
  return (
    <IntroPage
      onOk={onOk}
      cta="Ver mis entregas"
      note="Si tu agente recién arranca, puede estar vacío."
    >
      <style>{`
        @keyframes tga-art-bar { from { transform: scaleY(.05); } to { transform: scaleY(1); } }
        .tga-art-bar { transform-origin: bottom; animation: tga-art-bar 700ms cubic-bezier(.2,.75,.25,1) both; }
        @media (prefers-reduced-motion: reduce) { .tga-art-bar { animation: none; } }
      `}</style>

      <Eyebrow icon={LayoutDashboard}>Entregas</Eyebrow>
      <Title>Cuando conviene mirar los datos, tu agente los dibuja</Title>
      <Lead>
        Hay respuestas que se entienden mejor mirándolas que leyéndolas. En esos casos tu agente
        arma una visualización —un gráfico, una tabla grande, un informe— y la deja guardada acá.
        A eso le decimos una visualización.
      </Lead>

      {/* ── Mockup: three artifacts as they look in the grid ──────────────── */}
      <Mockup
        className="mt-6 overflow-hidden bg-gradient-to-br from-c-violet/70 via-surface to-white"
        note="Gráficos y números inventados, para que se vea la forma."
      >
        <div className="grid gap-3 sm:grid-cols-5">
          {/* Chart */}
          <Mini
            title="Evolución mensual"
            label={<Tag tone="violet">Gráfico</Tag>}
            className="flex flex-col sm:col-span-3"
          >
            {/* flex-1: the chart stretches to match the right column's height. */}
            <div className="flex min-h-[6rem] flex-1 items-end gap-1.5 border-b border-black/[0.09]">
              {BARS.map((h, i) => (
                <div
                  key={i}
                  className="tga-art-bar flex-1 rounded-t-[3px] bg-primary"
                  style={{ height: `${h}%`, opacity: 0.4 + i * 0.12, animationDelay: `${i * 70}ms` }}
                />
              ))}
            </div>
            <div className="mt-1.5 flex justify-between text-[9px] font-semibold uppercase tracking-wide text-ink-soft">
              <span>ene</span>
              <span>jun</span>
            </div>
          </Mini>

          <div className="grid gap-3 sm:col-span-2">
            {/* Table */}
            <Mini title="Detalle" label={<Tag tone="green">Tabla</Tag>}>
              <div className="space-y-2">
                <div className="grid grid-cols-[1.5fr_1fr_0.8fr] items-center gap-2 border-b border-black/[0.07] pb-2">
                  <span className="block h-1.5 rounded-pill bg-ink/30" />
                  <span className="block h-1.5 rounded-pill bg-ink/30" />
                  <span className="block h-1.5 rounded-pill bg-ink/30" />
                </div>
                <div className="grid grid-cols-[1.5fr_1fr_0.8fr] items-center gap-2">
                  <Cell w="100%" />
                  <Cell w="70%" />
                  <span className="block h-2.5 w-full rounded-md bg-c-green" />
                </div>
                <div className="grid grid-cols-[1.5fr_1fr_0.8fr] items-center gap-2">
                  <Cell w="85%" />
                  <Cell w="90%" />
                  <span className="block h-2.5 w-full rounded-md bg-c-amber" />
                </div>
                <div className="grid grid-cols-[1.5fr_1fr_0.8fr] items-center gap-2">
                  <Cell w="95%" />
                  <Cell w="55%" />
                  <span className="block h-2.5 w-full rounded-md bg-c-green" />
                </div>
              </div>
            </Mini>

            {/* KPIs */}
            <Mini title="Resumen" label={<Tag tone="amber">Informe</Tag>}>
              <div className="flex items-end gap-4">
                <div className="min-w-0">
                  <p className="text-[17px] font-extrabold leading-none tracking-tight text-ink">
                    1.284
                  </p>
                  <p className="mt-1 text-[9px] font-semibold uppercase tracking-wide text-ink-soft">
                    Total
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="text-[17px] font-extrabold leading-none tracking-tight text-c-green-ink">
                    +12%
                  </p>
                  <p className="mt-1 text-[9px] font-semibold uppercase tracking-wide text-ink-soft">
                    Variación
                  </p>
                </div>
                <svg viewBox="0 0 59 24" className="ml-auto h-7 w-16 shrink-0 text-primary" aria-hidden>
                  <polyline
                    points={SPARK}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <circle cx="55" cy="4" r="3" fill="currentColor" />
                </svg>
              </div>
            </Mini>
          </div>
        </div>
      </Mockup>

      {/* ── How they're requested + what you can do with them ─────────────── */}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="rounded-card border border-black/[0.07] bg-white p-4">
          <p className="text-[11px] font-bold uppercase tracking-wide text-ink-soft">
            Cómo se piden
          </p>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">
            Con tus palabras, en el chat de siempre.
          </p>

          {/* The deliverable's chip goes WITHOUT the "open" arrow: with it, it
              looked like the real clickable chip, and here it leads nowhere. */}
          <Mockup className="mt-3 bg-surface" note="Así se pide.">
            <div className="flex flex-col gap-2">
              <p className="max-w-[92%] self-end rounded-2xl rounded-br-md bg-c-violet px-3 py-2 text-[13px] leading-snug text-c-violet-ink">
                Mostrame cómo viene evolucionando esto mes a mes
              </p>
              <div className="max-w-[95%] rounded-2xl rounded-bl-md border border-black/[0.07] bg-white px-3 py-2">
                <p className="text-[13px] leading-snug text-ink">Te armé un gráfico:</p>
                <span className="mt-2 inline-flex w-fit items-center gap-1.5 rounded-pill border border-primary/25 bg-c-violet/60 px-2.5 py-1 text-[12px] font-semibold text-primary">
                  <BarChart3 className="h-3 w-3" />
                  Evolución mensual
                </span>
              </div>
            </div>
          </Mockup>

          <p className="mt-3 border-t border-black/[0.07] pt-3 text-[12px] leading-relaxed text-ink-soft">
            Cuando tu agente cita una entrega en una respuesta, se abre de un click.
          </p>
        </div>

        <div className="flex flex-col justify-center gap-4">
          <Point icon={Search} title="Buscá entre todos">
            Se filtran por tipo y se buscan por nombre. Ninguno se pierde en el chat.
          </Point>
          <Point icon={Download} title="Abrí, descargá, compartí">
            En grande ocupan toda la pantalla, y te los llevás en un archivo.
          </Point>
          <Point icon={Sparkles} title="Solo cuando aporta">
            Tu agente no dibuja todo: si la respuesta son dos números, te los dice y listo.
          </Point>
        </div>
      </div>
    </IntroPage>
  );
}
