"use client";

// The portal's general welcome screen: the first thing a client sees.
// Unlike the others, it doesn't explain one module but the whole idea --
// what having an agent working means and where everything shows up.

import {
  ArrowRight, Columns3, Hand, LayoutDashboard, MessageSquare, Sparkles,
} from "lucide-react";
import { IntroPage, Eyebrow, Title, Lead, type IntroProps } from "./shell";

const STEPS = [
  {
    icon: MessageSquare,
    title: "Le pedís",
    description: "Por chat, como a cualquiera del equipo.",
    tone: "bg-c-violet",
  },
  {
    icon: Columns3,
    title: "Trabaja",
    description: "Cada cosa que hace queda como una tarea que podés seguir.",
    tone: "bg-c-amber",
  },
  {
    icon: Hand,
    title: "Te consulta",
    description: "Antes de los pasos sensibles, frena y te pide el visto bueno.",
    tone: "bg-c-coral",
  },
  {
    icon: LayoutDashboard,
    title: "Te entrega",
    description: "Informes, listas y visualizaciones que quedan guardadas acá.",
    tone: "bg-c-green",
  },
];

export default function HomeIntro({ onOk }: IntroProps) {
  return (
    <IntroPage onOk={onOk} cta="Entrar al portal" note="Cada sección se explica sola la primera vez que entrás.">
      <Eyebrow icon={Sparkles}>Tu agente</Eyebrow>
      <Title>Acá adentro trabaja tu agente, y vos lo dirigís.</Title>
      <Lead>
        No es un chat más: es alguien que hace cosas con tus sistemas, deja
        registro de todo lo que toca y te pregunta cuando corresponde.
      </Lead>

      {/* The whole cycle, which is what nobody gets right away.
          WITH NO CARD: four white bordered blocks in a grid are, on this
          portal, things you touch -- that's what the flow examples and the
          connections look like. A test client tapped this same set on
          onboarding and wrote that "they don't do anything". These are four
          steps drawn as an icon, a title and text, with no box. */}
      <div className="mt-8 grid gap-x-3 gap-y-6 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((p, i) => {
          const Icon = p.icon;
          return (
            <div key={p.title} className="relative pr-4">
              <div className={`mb-3 flex h-9 w-9 items-center justify-center rounded-lg ${p.tone}`}>
                <Icon className="h-4 w-4 text-ink" />
              </div>
              <p className="text-sm font-bold text-ink">{p.title}</p>
              <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">{p.description}</p>
              {i < STEPS.length - 1 && (
                <ArrowRight
                  className="absolute right-0 top-3 hidden h-4 w-4 text-ink-soft/40 lg:block"
                  aria-hidden
                />
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-6 rounded-card border border-c-violet bg-c-violet/40 p-4">
        <p className="text-sm leading-relaxed text-ink">
          <span className="font-bold">Lo importante:</span> el agente nunca hace
          por su cuenta aquello que definimos que necesita tu autorización. Todo
          lo demás lo resuelve solo, y queda registrado para que puedas revisarlo
          cuando quieras.
        </p>
      </div>
    </IntroPage>
  );
}
