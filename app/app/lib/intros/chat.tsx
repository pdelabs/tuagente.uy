"use client";

// Bienvenida del módulo Chat.
// Idea visual: una conversación en miniatura —tu burbuja, el rastro de lo que
// el agente está haciendo y su respuesta citando un ticket— para que se vea
// cómo es hablarle antes de escribir la primera línea.
// Texto a la izquierda, maqueta a la derecha; en angosto se apila.
//
// ACÁ ABAJO HABÍA UN COMPOSITOR DIBUJADO, con su "Escribile a tu agente…" y su
// flechita violeta. Una clienta de prueba escribió "hola" ahí y se quedó
// esperando: era un dibujo. Una caja de texto invita a escribir — no hay copy
// que arregle eso, así que se fue. La invitación a hablar la hace el botón del
// pie, que es de verdad y lleva al chat.

import { Hand, History, MessageSquare, Plug, Ticket } from "lucide-react";
import { IntroPage, Eyebrow, Title, Lead, Maqueta, Point, type IntroProps } from "./shell";

/** Chip de entidad como el que dibuja el chat cuando el agente cita un ticket. */
function EntityChipDemo({ children }: { children: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-md border border-c-violet bg-c-violet/50 px-1.5 py-0.5 align-middle font-mono text-[11px] text-primary">
      <Ticket className="h-3 w-3 shrink-0" />
      <span className="truncate">{children}</span>
    </span>
  );
}

/** Una conversación de ejemplo. No es la del cliente y no es interactiva: por
 *  eso va adentro de `Maqueta`, que lo dice con el borde y con el rótulo. */
function ConversacionDemo() {
  return (
    <Maqueta
      className="bg-gradient-to-b from-c-violet/45 via-white to-white"
      nota="Una conversación cualquiera, no la tuya."
    >
      {/* Lo que le escribís */}
      <div className="flex justify-end">
        <p className="max-w-[88%] break-words rounded-2xl rounded-br-md bg-black/[0.06] px-3 py-2 text-[12.5px] leading-snug text-ink">
          ¿Cómo venimos con lo de ayer? Si está pronto, seguí.
        </p>
      </div>

      {/* Rastro de herramientas: se ve qué está haciendo mientras contesta */}
      <div className="mt-3 flex items-center gap-1.5 text-[11px] text-ink-soft">
        <span className="flex items-center gap-[3px]">
          {[0, 160, 320].map((d) => (
            <span
              key={d}
              style={{ animationDelay: `${d}ms` }}
              className="h-1 w-1 animate-pulse rounded-full bg-primary motion-reduce:animate-none"
            />
          ))}
        </span>
        <span className="truncate">Revisando tus sistemas</span>
      </div>

      {/* La respuesta del agente */}
      <div className="mt-2 flex gap-2">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-primary">
          <Hand className="h-3 w-3 text-white" />
        </span>
        <p className="min-w-0 text-[12.5px] leading-relaxed text-ink">
          Quedó todo menos un paso. Lo anoté en <EntityChipDemo>Pedido a proveedores</EntityChipDemo> y
          te lo paso a aprobar.
        </p>
      </div>
    </Maqueta>
  );
}

export default function ChatIntro({ onOk }: IntroProps) {
  return (
    <IntroPage onOk={onOk} cta="Empezar a hablar" note="Escribile en tus palabras.">
      <div className="grid items-center gap-6 lg:grid-cols-2 lg:gap-8">
        <div className="min-w-0">
          <Eyebrow icon={MessageSquare}>Chat</Eyebrow>
          <Title>Hablale como a cualquiera del equipo</Title>
          <Lead>
            Pedile lo que necesites saber o encargale una tarea, escrito como te salga.
            Si le falta algo para hacerlo — un archivo, un dato — te lo pide.
          </Lead>
        </div>
        <ConversacionDemo />
      </div>

      <div className="mt-7 grid gap-4 md:grid-cols-2">
        <Point icon={Plug} title="Usa lo que le conectaste">
          Mira tus sistemas conectados mientras te responde, y vas viendo qué está
          haciendo. Los conectás en Conexiones.
        </Point>
        <Point icon={History} title="Las conversaciones quedan">
          Se guardan y las retomás cuando quieras: están listadas al costado.
        </Point>
        <Point icon={Hand} title="Frena si necesita tu ok">
          Cuando un paso pide tu visto bueno te consulta antes, en vez de seguir de largo.
        </Point>
        <Point icon={Ticket} title="Cita tareas y archivos">
          Cuando menciona una tarea o un archivo, lo abrís ahí mismo, sin salir de la
          conversación.
        </Point>
      </div>
    </IntroPage>
  );
}
