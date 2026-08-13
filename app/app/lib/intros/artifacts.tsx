"use client";

// Bienvenida de Artefactos.
//
// El concepto es NUEVO para el cliente ("¿artefacto?"), así que la pantalla no
// lo cuenta: lo muestra. Arriba una maqueta de tres mini-artefactos (un
// gráfico, una tabla y unos KPIs) para que se entienda de un vistazo que acá
// viven visualizaciones; abajo un pedacito de chat que enseña las dos mitades
// que la gente no adivina sola: cómo se piden y cómo se citan.
//
// Todo es div/SVG inline: ni imágenes, ni datos reales, ni nada del dominio de
// ningún cliente. Pero "no son datos de nadie" no se ve desde afuera: 1.284 y
// +12% dibujados con la tipografía de los números de verdad se leen como los
// números de uno. Por eso los dos dibujos van adentro de `Maqueta`, que lo dice
// con todas las letras.

import type { ReactNode } from "react";
import {
  BarChart3, Download, LayoutDashboard, Search, Sparkles,
} from "lucide-react";
import { Eyebrow, IntroPage, Lead, Maqueta, Point, Title, type IntroProps } from "./shell";

// Alturas de las barras del mini-gráfico (%), con una forma que se lee como
// "esto viene creciendo" sin afirmar nada de nadie.
const BARRAS = [40, 63, 48, 82, 66, 96];

// Sparkline de la tarjeta de KPIs.
const SPARK = "3,20 13,14 23,17 33,9 44,11 55,4";

function Etiqueta({ tone, children }: {
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

/** Marco de cada mini-artefacto: hairline, sin sombra, radio contenido. */
function Mini({ titulo, etiqueta, className = "", children }: {
  titulo: string;
  etiqueta: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`rounded-2xl border border-black/[0.07] bg-white p-3 ${className}`}>
      <div className="mb-2.5 flex items-center gap-2">
        <p className="truncate text-[11px] font-bold text-ink">{titulo}</p>
        <span className="ml-auto">{etiqueta}</span>
      </div>
      {children}
    </div>
  );
}

/** Celda de la mini-tabla: una barrita gris que insinúa texto. */
function Celda({ w }: { w: string }) {
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

      {/* ── Maqueta: tres artefactos como se ven en la grilla ─────────────── */}
      <Maqueta
        className="mt-6 overflow-hidden bg-gradient-to-br from-c-violet/70 via-surface to-white"
        nota="Gráficos y números inventados, para que se vea la forma."
      >
        <div className="grid gap-3 sm:grid-cols-5">
          {/* Gráfico */}
          <Mini
            titulo="Evolución mensual"
            etiqueta={<Etiqueta tone="violet">Gráfico</Etiqueta>}
            className="flex flex-col sm:col-span-3"
          >
            {/* flex-1: el gráfico estira hasta igualar la columna de la derecha. */}
            <div className="flex min-h-[6rem] flex-1 items-end gap-1.5 border-b border-black/[0.09]">
              {BARRAS.map((h, i) => (
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
            {/* Tabla */}
            <Mini titulo="Detalle" etiqueta={<Etiqueta tone="green">Tabla</Etiqueta>}>
              <div className="space-y-2">
                <div className="grid grid-cols-[1.5fr_1fr_0.8fr] items-center gap-2 border-b border-black/[0.07] pb-2">
                  <span className="block h-1.5 rounded-pill bg-ink/30" />
                  <span className="block h-1.5 rounded-pill bg-ink/30" />
                  <span className="block h-1.5 rounded-pill bg-ink/30" />
                </div>
                <div className="grid grid-cols-[1.5fr_1fr_0.8fr] items-center gap-2">
                  <Celda w="100%" />
                  <Celda w="70%" />
                  <span className="block h-2.5 w-full rounded-md bg-c-green" />
                </div>
                <div className="grid grid-cols-[1.5fr_1fr_0.8fr] items-center gap-2">
                  <Celda w="85%" />
                  <Celda w="90%" />
                  <span className="block h-2.5 w-full rounded-md bg-c-amber" />
                </div>
                <div className="grid grid-cols-[1.5fr_1fr_0.8fr] items-center gap-2">
                  <Celda w="95%" />
                  <Celda w="55%" />
                  <span className="block h-2.5 w-full rounded-md bg-c-green" />
                </div>
              </div>
            </Mini>

            {/* KPIs */}
            <Mini titulo="Resumen" etiqueta={<Etiqueta tone="amber">Informe</Etiqueta>}>
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
      </Maqueta>

      {/* ── Cómo se piden + qué podés hacer con ellos ─────────────────────── */}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="rounded-card border border-black/[0.07] bg-white p-4">
          <p className="text-[11px] font-bold uppercase tracking-wide text-ink-soft">
            Cómo se piden
          </p>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">
            Con tus palabras, en el chat de siempre.
          </p>

          {/* El chip de la entrega va SIN la flechita de "abrir": con ella era
              el chip clickeable de verdad, y acá no lleva a ningún lado. */}
          <Maqueta className="mt-3 bg-surface" nota="Así se pide.">
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
          </Maqueta>

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
