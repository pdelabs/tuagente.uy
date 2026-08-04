"use client";

// Bienvenida del módulo Aprobaciones.
// Idea visual: la tarjeta de aprobación en miniatura con sus dos botones y,
// abajo, las dos salidas posibles en tonal verde y coral. Composición espejada
// respecto del chat: maqueta a la izquierda, texto a la derecha.
// El aviso ámbar es la parte honesta: aprobar habilita, no envía.

import { Check, Clock, Hand, Info, Settings2, X } from "lucide-react";
import { IntroPage, Eyebrow, Title, Lead, Point, type IntroProps } from "./shell";

/** Maqueta decorativa de un pedido de aprobación y sus dos desenlaces. */
function AprobacionDemo() {
  return (
    <div
      aria-hidden
      className="rounded-card border border-black/[0.07] bg-gradient-to-b from-white to-c-violet/30 p-3 sm:p-4"
    >
      <div className="rounded-xl border border-black/[0.07] bg-white p-3">
        <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
          <div className="min-w-0 flex-1">
            <p className="break-words text-[12.5px] font-semibold leading-snug text-ink">
              Enviar lo que preparó
            </p>
            <p className="mt-0.5 line-clamp-2 break-words text-[11.5px] leading-snug text-ink-soft">
              Está pronto. Freno acá para que lo mires antes.
            </p>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1 pt-0.5 text-[10px] text-ink-soft">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-c-amber-ink motion-reduce:animate-none" />
            espera 2 h
          </span>
        </div>

        {/* Lo que dejó listo, ahí mismo para leerlo */}
        <div className="mt-2.5 flex flex-col gap-1.5 rounded-lg bg-black/[0.03] p-2">
          <span className="h-1.5 w-full rounded-full bg-black/[0.07]" />
          <span className="h-1.5 w-4/5 rounded-full bg-black/[0.07]" />
          <span className="h-1.5 w-2/3 rounded-full bg-black/[0.07]" />
        </div>

        <div className="mt-3 flex flex-wrap justify-end gap-1.5">
          <span className="rounded-lg border border-c-coral bg-white px-2 py-1 text-[11px] font-semibold text-c-coral-ink">
            Rechazar
          </span>
          <span className="rounded-lg bg-primary px-2 py-1 text-[11px] font-semibold text-white">
            Aprobar
          </span>
        </div>
      </div>

      <div className="mt-2.5 grid gap-1.5 sm:grid-cols-2">
        <div className="min-w-0 rounded-lg border border-c-green bg-c-green/50 p-2">
          <p className="flex items-center gap-1 text-[11px] font-semibold text-c-green-ink">
            <Check className="h-3 w-3 shrink-0" />
            Aprobás
          </p>
          <p className="mt-0.5 break-words text-[10.5px] leading-snug text-c-green-ink/80">
            La tarea se destraba y sigue.
          </p>
        </div>
        <div className="min-w-0 rounded-lg border border-c-coral bg-c-coral/50 p-2">
          <p className="flex items-center gap-1 text-[11px] font-semibold text-c-coral-ink">
            <X className="h-3 w-3 shrink-0" />
            Rechazás
          </p>
          <p className="mt-0.5 break-words text-[10.5px] leading-snug text-c-coral-ink/80">
            Queda asentado tu motivo.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function ApprovalsIntro({ onOk }: IntroProps) {
  return (
    <IntroPage onOk={onOk} cta="Ver pendientes">
      <div className="grid items-center gap-6 lg:grid-cols-2 lg:gap-8">
        <div className="min-w-0 lg:order-2">
          <Eyebrow icon={Hand}>Aprobaciones</Eyebrow>
          <Title>Antes de un paso sensible, te pregunta</Title>
          <Lead>
            Tu agente frena y te pide el visto bueno en vez de decidir solo. Todo lo que
            está esperando una respuesta tuya se junta acá.
          </Lead>
        </div>
        <div className="min-w-0 lg:order-1">
          <AprobacionDemo />
        </div>
      </div>

      <div className="mt-6 flex gap-3 rounded-2xl border border-c-amber bg-c-amber/40 px-4 py-3">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-c-amber-ink" />
        <p className="min-w-0 text-[13px] leading-relaxed text-c-amber-ink">
          <span className="font-semibold">Aprobar no quiere decir «se envía ya».</span>{" "}
          Quiere decir que tu agente queda habilitado a seguir: qué hace después lo deciden
          sus reglas.
        </p>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <Point icon={Settings2} title="Vos elegís qué se te consulta">
          Qué pasos necesitan tu aprobación se define cuando se configura tu agente.
        </Point>
        <Point icon={Clock} title="Mientras espera, no avanza">
          En el tablero esa tarea te queda visible como «Esperando aprobación».
        </Point>
      </div>
    </IntroPage>
  );
}
