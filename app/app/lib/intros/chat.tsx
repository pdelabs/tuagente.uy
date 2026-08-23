"use client";

// Chat module's welcome screen.
// Visual idea: a tiny conversation -- your bubble, the trail of what the
// agent is doing, and its reply quoting a ticket -- so you can see what
// talking to it is like before writing the first line.
// Text on the left, mockup on the right; stacks on narrow screens.
//
// A DRAWN COMPOSER USED TO SIT DOWN HERE, with its "Escribile a tu agente…"
// and its little violet arrow. A test client typed "hola" in there and sat
// waiting: it was a drawing. A text box invites typing -- no copy fixes that,
// so it's gone. The invitation to talk is now the button at the bottom, which
// is real and leads to the chat.

import { Hand, History, MessageSquare, Plug, Ticket } from "lucide-react";
import { IntroPage, Eyebrow, Title, Lead, Mockup, Point, type IntroProps } from "./shell";

/** An entity chip like the one the chat draws when the agent quotes a ticket. */
function EntityChipDemo({ children }: { children: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-md border border-c-violet bg-c-violet/50 px-1.5 py-0.5 align-middle font-mono text-[11px] text-primary">
      <Ticket className="h-3 w-3 shrink-0" />
      <span className="truncate">{children}</span>
    </span>
  );
}

/** A sample conversation. It isn't the client's own and isn't interactive:
 *  that's why it goes inside `Mockup`, which says so via the border and the label. */
function ConversationDemo() {
  return (
    <Mockup
      className="bg-gradient-to-b from-c-violet/45 via-white to-white"
      note="Una conversación cualquiera, no la tuya."
    >
      {/* What you write */}
      <div className="flex justify-end">
        <p className="max-w-[88%] break-words rounded-2xl rounded-br-md bg-black/[0.06] px-3 py-2 text-[12.5px] leading-snug text-ink">
          ¿Cómo venimos con lo de ayer? Si está pronto, seguí.
        </p>
      </div>

      {/* Tool trail: shows what it's doing while it answers */}
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

      {/* The agent's reply */}
      <div className="mt-2 flex gap-2">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-primary">
          <Hand className="h-3 w-3 text-white" />
        </span>
        <p className="min-w-0 text-[12.5px] leading-relaxed text-ink">
          Quedó todo menos un paso. Lo anoté en <EntityChipDemo>Pedido a proveedores</EntityChipDemo> y
          te lo paso a aprobar.
        </p>
      </div>
    </Mockup>
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
        <ConversationDemo />
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
