"use client";

// Flows' welcome screen.
//
// The idea to get across: this tab is the answer to "what does my agent do
// for me?". A flow is a named job -- something that happens on its own,
// produces results that stay here, and gets requested with words, not by
// configuring anything. The illustration is a sample flow in three steps:
// something arrives -> the agent works -> the result waits for you. The three
// steps go with no white box: on this tab, white bordered cards are flows you
// can open, and these don't open -- they're a drawing. The arrow between one
// and the next is enough to read it.

import { ArrowDown, FolderOpen, MessageSquare, Sparkles, Workflow } from "lucide-react";
import { Eyebrow, IntroPage, Lead, Point, Title, type IntroProps } from "./shell";

const STEPS = [
  { icon: FolderOpen, text: "Llega algo — un archivo a tu Drive, un lunes a las 8, o vos pidiéndolo" },
  { icon: Sparkles, text: "Tu agente hace su parte: los pasos que definimos juntos, siempre iguales" },
  { icon: Workflow, text: "El resultado queda acá, con fecha, listo para usar" },
];

export default function FlowsIntro({ onOk }: IntroProps) {
  return (
    <IntroPage onOk={onOk} cta="Ver mis flujos">
      <Eyebrow icon={Workflow}>Flujos</Eyebrow>
      <Title>Los trabajos que tu agente hace por vos</Title>
      <Lead>
        Un flujo es un trabajo con nombre: pasa solo, siempre de la misma
        manera, y sus resultados quedan juntos acá. Sin configurar nada.
      </Lead>

      {/* Left-aligned with the title: with no white box, centering the block
          left it floating in the middle of the page. */}
      <div className="my-6 flex max-w-xl flex-col gap-1">
        {STEPS.map((p, i) => {
          const Icon = p.icon;
          return (
            <div key={i} className="flex w-full flex-col gap-1">
              {/* The arrow falls in the icons' column, not in the middle. */}
              {i > 0 && <ArrowDown className="ml-2 h-4 w-4 text-ink-soft/50" />}
              <div className="flex w-full items-center gap-3 py-1">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-c-violet/60">
                  <Icon className="h-4 w-4 text-c-violet-ink" />
                </span>
                <p className="text-left text-[13px] leading-snug text-ink">{p.text}</p>
              </div>
            </div>
          );
        })}
      </div>

      <Point icon={MessageSquare} title="Los nuevos se piden hablando">
        ¿Hay otra tarea que te come horas todas las semanas? Contásela a tu
        agente por el chat: la arma como un flujo nuevo y aparece acá.
      </Point>
    </IntroPage>
  );
}
