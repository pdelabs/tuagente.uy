"use client";

// Bienvenida general del portal: la primera pantalla que ve un cliente.
// A diferencia de las otras, no explica un módulo sino la idea entera —
// qué es tener un agente trabajando y dónde se ve cada cosa.

import {
  ArrowRight, Columns3, Hand, LayoutDashboard, MessageSquare, Sparkles,
} from "lucide-react";
import { IntroPage, Eyebrow, Title, Lead, type IntroProps } from "./shell";

const PASOS = [
  {
    icon: MessageSquare,
    titulo: "Le pedís",
    texto: "Por chat, como a cualquiera del equipo.",
    tono: "bg-c-violet",
  },
  {
    icon: Columns3,
    titulo: "Trabaja",
    texto: "Cada cosa que hace queda como una tarea que podés seguir.",
    tono: "bg-c-amber",
  },
  {
    icon: Hand,
    titulo: "Te consulta",
    texto: "Antes de los pasos sensibles, frena y te pide el visto bueno.",
    tono: "bg-c-coral",
  },
  {
    icon: LayoutDashboard,
    titulo: "Te entrega",
    texto: "Informes, listas y visualizaciones que quedan guardadas acá.",
    tono: "bg-c-green",
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

      {/* El ciclo completo, que es lo que nadie entiende de entrada.
          SIN TARJETA: cuatro bloques blancos con borde en una grilla son, en
          este portal, cosas que se tocan —así se ven los ejemplos de flujos y
          las conexiones—. Una clienta de prueba le tocó las del alta, que son
          estas mismas, y anotó que "no hacen nada". Son cuatro pasos de un
          dibujo: quedan como el ícono, el título y el texto, sin caja. */}
      <div className="mt-8 grid gap-x-3 gap-y-6 sm:grid-cols-2 lg:grid-cols-4">
        {PASOS.map((p, i) => {
          const Icon = p.icon;
          return (
            <div key={p.titulo} className="relative pr-4">
              <div className={`mb-3 flex h-9 w-9 items-center justify-center rounded-lg ${p.tono}`}>
                <Icon className="h-4 w-4 text-ink" />
              </div>
              <p className="text-sm font-bold text-ink">{p.titulo}</p>
              <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">{p.texto}</p>
              {i < PASOS.length - 1 && (
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
