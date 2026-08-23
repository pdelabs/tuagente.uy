"use client";

// Approvals module's welcome screen.
// Visual idea: a tiny request card and, below it, the two possible outcomes
// in tonal green and coral. Composition mirrored from the chat one: mockup on
// the left, text on the right.
// The amber notice is the honest part: approving unblocks, it doesn't send.
//
// THE DRAWN CARD NO LONGER CARRIES "Rechazar" and "Aprobar". They were exact
// copies of the portal's most expensive buttons -- one of them unblocks a
// ticket and the unblock only gets spent once -- sitting on a made-up request
// that on top of it said "espera 2 h". Nobody should have to tap to discover
// that request wasn't theirs. Both outcomes are explained the same way, in
// the two blocks below, which are text and not buttons.

import { Check, Clock, Hand, Info, Settings2, X } from "lucide-react";
import { IntroPage, Eyebrow, Title, Lead, Mockup, Point, type IntroProps } from "./shell";

/** The drawn request and its two outcomes. Declared as an example, no controls. */
function ApprovalDemo() {
  return (
    <Mockup
      className="bg-gradient-to-b from-white to-c-violet/30"
      note="Un pedido de ejemplo: no es uno tuyo."
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

        {/* What it left ready, right there to read */}
        <div className="mt-2.5 flex flex-col gap-1.5 rounded-lg bg-black/[0.03] p-2">
          <span className="h-1.5 w-full rounded-full bg-black/[0.07]" />
          <span className="h-1.5 w-4/5 rounded-full bg-black/[0.07]" />
          <span className="h-1.5 w-2/3 rounded-full bg-black/[0.07]" />
        </div>
      </div>

      {/* "Si aprobás" and not "Aprobar": the first is a consequence, the
          second is a button's label. */}
      <div className="mt-2.5 grid gap-1.5 sm:grid-cols-2">
        <div className="min-w-0 rounded-lg border border-c-green bg-c-green/50 p-2">
          <p className="flex items-center gap-1 text-[11px] font-semibold text-c-green-ink">
            <Check className="h-3 w-3 shrink-0" />
            Si aprobás
          </p>
          <p className="mt-0.5 break-words text-[10.5px] leading-snug text-c-green-ink/80">
            La tarea sigue adelante.
          </p>
        </div>
        <div className="min-w-0 rounded-lg border border-c-coral bg-c-coral/50 p-2">
          <p className="flex items-center gap-1 text-[11px] font-semibold text-c-coral-ink">
            <X className="h-3 w-3 shrink-0" />
            Si rechazás
          </p>
          <p className="mt-0.5 break-words text-[10.5px] leading-snug text-c-coral-ink/80">
            Queda asentado tu motivo.
          </p>
        </div>
      </div>
    </Mockup>
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
          <ApprovalDemo />
        </div>
      </div>

      <div className="mt-6 flex gap-3 rounded-2xl border border-c-amber bg-c-amber/40 px-4 py-3">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-c-amber-ink" />
        <p className="min-w-0 text-[13px] leading-relaxed text-c-amber-ink">
          {/* The earlier version ("approving doesn't mean it gets sent right
              away… its own rules decide") was written to avoid over-promising
              and did the opposite: a test client read it as "give it the ok
              and after that we don't know what happens". Same honesty, said
              the right way around: before deciding you'll read exactly what
              it's going to do. */}
          <span className="font-semibold">Antes de decidir, leelo.</span>{" "}
          Abriendo el pedido ves el texto completo de lo que tu agente quiere hacer y qué
          pasa con cada respuesta. Si aprobás, hace eso; si algo no te cierra, lo corregís
          o lo rechazás.
        </p>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <Point icon={Settings2} title="Qué se te consulta">
          Los pasos que necesitan tu ok los dejamos definidos al armar tu agente. Si querés
          que te pregunte por algo más — o por algo menos — pedínoslo y lo cambiamos.
        </Point>
        <Point icon={Clock} title="Mientras espera, no avanza">
          En el tablero esa tarea te queda visible como «Esperando aprobación».
        </Point>
      </div>
    </IntroPage>
  );
}
