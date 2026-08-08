"use client";

// Bienvenida de Flujos.
//
// La idea a transmitir: esta pestaña es la respuesta a "¿qué hace mi agente
// por mí?". Un flujo es un trabajo con nombre — algo que pasa solo, produce
// resultados que quedan acá, y se pide con palabras, no configurando nada.
// La ilustración es un flujo de ejemplo en tres pasos: llega algo → el agente
// trabaja → el resultado te espera.

import { ArrowDown, FolderOpen, MessageSquare, Sparkles, Workflow } from "lucide-react";
import { Eyebrow, IntroPage, Lead, Point, Title, type IntroProps } from "./shell";

const PASOS = [
  { icon: FolderOpen, texto: "Llega algo — un archivo a tu Drive, un lunes a las 8, o vos pidiéndolo" },
  { icon: Sparkles, texto: "Tu agente hace su parte: los pasos que definimos juntos, siempre iguales" },
  { icon: Workflow, texto: "El resultado queda acá, con fecha, listo para usar" },
];

export default function FlujosIntro({ onOk }: IntroProps) {
  return (
    <IntroPage onOk={onOk} cta="Ver mis flujos">
      <Eyebrow icon={Workflow}>Flujos</Eyebrow>
      <Title>Los trabajos que tu agente hace por vos</Title>
      <Lead>
        Un flujo es un trabajo con nombre: pasa solo, siempre de la misma
        manera, y sus resultados quedan juntos acá. Sin configurar nada.
      </Lead>

      <div className="my-6 flex flex-col items-center gap-1">
        {PASOS.map((p, i) => {
          const Icon = p.icon;
          return (
            <div key={i} className="flex w-full max-w-md flex-col items-center gap-1">
              {i > 0 && <ArrowDown className="h-4 w-4 text-ink-soft/50" />}
              <div className="flex w-full items-center gap-3 rounded-xl border border-black/[0.07] bg-white px-4 py-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-c-violet/60">
                  <Icon className="h-4 w-4 text-c-violet-ink" />
                </span>
                <p className="text-left text-[13px] leading-snug text-ink">{p.texto}</p>
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
