"use client";

// Bienvenida de "Uso".
// Composición: el costo del período arriba, las dos minis a la izquierda y el
// gráfico de barras (día por día) a la derecha; abajo, tres puntos en fila.
// Ilustración en divs, sin imágenes externas; la animación respeta
// prefers-reduced-motion.
//
// ACÁ NO SE HABLA DE TOKENS. Esta bienvenida mostraba "TOKENS 1,24 M" al lado
// de las sesiones, y el gráfico partido en entrada y salida. La clienta de
// prueba lo citó textual: "no sé qué es un token y no me importa; US$ 0,10 es
// lo único que quiero saber". La pestaña ya dejó de hablar de tokens por
// completo —se fue el titular, las minis de entrada/salida y el globito del
// gráfico; todo pasó a plata, y cuando el motor no informa costo no se muestra
// nada—, así que la bienvenida quedó siendo el ÚNICO lugar del portal que le
// hablaba en una unidad que no entiende: justo la pantalla que existe para
// explicarle qué se mide. Que los números sean inventados no lo salva, porque
// la unidad era de verdad.
//
// EL PANEL ES UN DIBUJO, y acá importa más que en ningún lado: "US$ 7,80"
// abajo de un título que dice cuánto te sale es la plata de alguien. Va adentro
// de `Maqueta`. No se muestran los números reales porque un agente recién
// instalado tiene el panel casi en cero y esta pantalla existe para explicar
// qué se mide, no para medirlo: eso es la pestaña, que está a un botón de
// distancia.

import { BarChart3, CalendarDays, MessagesSquare, Wallet } from "lucide-react";
import { IntroPage, Eyebrow, Title, Lead, Maqueta, Point, type IntroProps } from "./shell";

const CSS = `
@keyframes tgu-grow { from { transform: scaleY(.04); } to { transform: scaleY(1); } }
.tgu-bar { transform-origin: bottom; animation: tgu-grow .6s cubic-bezier(.2,.7,.2,1) both; }
@media (prefers-reduced-motion: reduce) { .tgu-bar { animation: none; } }
`;

// Alturas relativas del gasto de los últimos 14 días: sube, pero con el ruido
// normal de un mes real (no una rampa perfecta). La barra más alta es el
// "máximo" que se rotula al costado.
const BARS = [24, 31, 27, 38, 34, 45, 41, 36, 54, 49, 61, 57, 70, 86];

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-black/[0.06] bg-surface px-3 py-2.5">
      <p className="truncate text-[10px] font-bold uppercase tracking-wide text-ink-soft">{label}</p>
      <p className="mt-1 text-[18px] font-extrabold leading-none tabular-nums text-ink">{value}</p>
    </div>
  );
}

function Panel() {
  return (
    <Maqueta className="min-w-0 bg-white" nota="Números inventados: no es tu consumo.">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-[11px] font-bold uppercase tracking-wide text-ink-soft">
          Costo del período · últimos 30 días
        </p>
        <p className="text-[10px] text-ink-soft">estimado por el motor</p>
      </div>
      <p className="mt-1.5 text-[30px] font-extrabold leading-none tabular-nums text-ink">
        US$ 7,80
      </p>

      {/* El portal ya se come 224px de sidebar: la partición recién a partir de md. */}
      <div className="mt-3.5 grid gap-3 md:grid-cols-[10.5rem_minmax(0,1fr)]">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-1">
          <Kpi label="Sesiones" value="128" />
          <Kpi label="Promedio por sesión" value="US$ 0,06" />
        </div>

        <div className="min-w-0">
          <div className="mb-1.5 flex items-baseline justify-between gap-2 text-[10px] text-ink-soft">
            <span className="font-bold uppercase tracking-wide">Costo por día</span>
            <span className="tabular-nums">máximo US$ 0,62</span>
          </div>
          <div className="relative">
            {/* Dos guías finas: dan escala sin ensuciar. */}
            <div className="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-black/[0.07]" />
            <div className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-dashed border-black/[0.07]" />
            <div className="relative flex h-[104px] items-end gap-[3px] border-b border-black/[0.09] md:gap-1.5">
              {BARS.map((h, i) => (
                <div key={i} className="flex h-full min-w-0 flex-1 flex-col justify-end">
                  <div
                    style={{ height: `${h}%`, animationDelay: `${i * 45}ms` }}
                    className="tgu-bar rounded-t-[3px] bg-primary"
                  />
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
    </Maqueta>
  );
}

export default function UsageIntro({ onOk }: IntroProps) {
  return (
    <IntroPage
      onOk={onOk}
      cta="Ver el uso"
      note="Si tu agente todavía no informa cuánto te sale, ahí te lo decimos."
    >
      <style>{CSS}</style>
      <Eyebrow icon={BarChart3}>Uso</Eyebrow>
      <Title>Cuánto te sale tu agente</Title>
      <Lead>
        Lo que costó su trabajo, en dólares: el total del período, cuánto salió cada día y por
        dónde se usó. No incluye tu abono mensual y no es un cobro — está para que veas cuánto se
        está usando y no te agarre de sorpresa.
      </Lead>

      <div className="mt-6">
        <Panel />
      </div>

      <div className="mt-6 grid gap-5 md:grid-cols-3">
        <Point icon={Wallet} title="El total del período">
          Lo que costó el trabajo de tu agente, estimado por el motor: es el número grande, arriba
          de todo.
        </Point>
        <Point icon={CalendarDays} title="Cómo viene">
          Lo que salió cada uno de los últimos días, para ver si está subiendo, bajando o parejo.
        </Point>
        <Point icon={MessagesSquare} title="Por dónde se usó">
          Cuántas sesiones atendió y cuánto costó cada vía por la que trabajó. Lo que tu agente no
          informa, no se dibuja.
        </Point>
      </div>
    </IntroPage>
  );
}
