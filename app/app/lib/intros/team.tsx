"use client";

// Team's welcome screen.
//
// TWO THINGS AND NOTHING MORE. (1) Your team is teammates with a name and a
// face: each one handles one thing, does it every day, and has written down
// what it never does. (2) THE WORK BELONGS TO EVERYONE: the board, the
// deliverables and the files stay a single one -- the role is the signature
// of who did each thing, not a separate drawer you have to go dig through.
// Without the second point, the client walks away thinking they were just
// handed five portals to check.
//
// THE ILLUSTRATION. The roster in miniature, with real faces
// (`AgentitoAvatar`, the same SVG the tab and the chips draw), and below it a
// deliverable signed by one of those same faces. The same face showing up in
// both halves of the drawing is what says "signature, not compartment"
// without having to spell it out in a paragraph.
//
// And it sits inside `Mockup`, with made-up names: each client's own roster is
// served by their own agent, and a drawing can't assert who works for them.
// Connections' welcome screen already taught us that lesson the hard way -- a
// client walked in believing she had plugged in what the example was drawing.

import { Ban, Layers, PenLine, UserPlus, Users } from "lucide-react";
import { AgentitoAvatar, LOOK_DEFAULT, type AgentitoLook } from "../agentito";
import { Eyebrow, IntroPage, Lead, Mockup, Point, Title, type IntroProps } from "./shell";

type Teammate = {
  name: string;
  role: string;
  does: string;
  never: string;
  look: AgentitoLook;
};

// Made-up teammates, with generic roles on purpose: the portal is the same
// for any agent, and each agent's own agent decides the role catalog.
const EXAMPLE: Teammate[] = [
  {
    name: "Vera",
    role: "Atención al cliente",
    does: "Contesta lo que entra y te pasa lo que no puede resolver sola.",
    never: "no promete precios ni plazos",
    look: { ...LOOK_DEFAULT, tone: 3, antenna: 2, mouth: 2, brows: 1 },
  },
  {
    name: "Nilo",
    role: "Administración",
    does: "Ordena los comprobantes del día y arma el resumen del mes.",
    never: "no paga nada sin tu visto bueno",
    look: { ...LOOK_DEFAULT, tone: 1, antenna: 4, accessory: 1, mouth: 1, suit: 2 },
  },
];

function TeammateRow({ c }: { c: Teammate }) {
  return (
    <div className="flex gap-3">
      <AgentitoAvatar look={c.look} className="h-11 w-11 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <p className="text-[13px] font-semibold text-ink">{c.name}</p>
          <span className="text-[11px] text-ink-soft">{c.role}</span>
        </div>
        <p className="mt-0.5 text-[12px] leading-snug text-ink-soft">{c.does}</p>
        <p className="mt-0.5 text-[11.5px] leading-snug text-ink-soft">
          <span className="font-medium text-ink">Nunca:</span> {c.never}
        </p>
      </div>
    </div>
  );
}

/** The same face, at the foot of a job that lives on another tab. It's the
 *  chip the portal really draws next to every deliverable, every card and
 *  every chat reply. */
function Signature({ c }: { c: Teammate }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg border border-black/[0.07] bg-white px-1.5 py-0.5 text-[11px] font-medium text-ink-soft">
      <AgentitoAvatar look={c.look} className="h-4 w-4 shrink-0" />
      {c.name}
    </span>
  );
}

export default function TeamIntro({ onOk }: IntroProps) {
  return (
    <IntroPage onOk={onOk} cta="Ver mi equipo">
      <div className="grid items-center gap-6 lg:grid-cols-2 lg:gap-8">
        <div className="min-w-0">
          <Eyebrow icon={Users}>Equipo</Eyebrow>
          <Title>Quiénes trabajan para vos</Title>
          <Lead>
            Cada uno se ocupa de una sola cosa y la hace todos los días. Acá está
            la lista: qué hace cada uno, qué no hace nunca, y adentro de su ficha
            lo que corre solo y en qué anduvo.
          </Lead>
        </div>

        <Mockup
          className="bg-white"
          note="Compañeros inventados: los tuyos son los que tenga tu agente."
        >
          <div className="flex flex-col gap-3">
            {EXAMPLE.map((c) => (
              <TeammateRow key={c.name} c={c} />
            ))}
          </div>

          {/* The drawing's second half: a job that does NOT live here, signed
              by one of the same faces. */}
          <div className="mt-3 border-t border-black/[0.07] pt-3">
            <p className="text-[10px] font-bold uppercase tracking-wide text-ink-soft">
              En Entregas
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <p className="min-w-0 flex-1 truncate text-[12px] text-ink">
                Resumen de compras de agosto
              </p>
              <Signature c={EXAMPLE[1]} />
            </div>
          </div>
        </Mockup>
      </div>

      <div className="mt-7 grid gap-4 md:grid-cols-2">
        <Point icon={Layers} title="El trabajo es de todos">
          No hay un tablero por persona ni una carpeta por persona: todo sigue
          junto, donde ya estaba. El rol es la firma de quién hizo cada cosa, no
          un compartimiento aparte.
        </Point>
        <Point icon={PenLine} title="Cada uno con su nombre y su cara">
          Vos los bautizás. Así los ves al lado de cada entrega, de cada tarjeta
          y de cada respuesta en el chat.
        </Point>
        <Point icon={Ban} title="Lo que nunca hace">
          Cada uno tiene su límite escrito. Es la misma frase que obedece
          adentro, así que lo que promete esta pantalla y lo que hace tu agente
          no se pueden despegar.
        </Point>
        <Point icon={UserPlus} title="Sumás cuando te falta alguien">
          Elegís el rol, le ponés nombre y queda pedido. Prepararlo lo hacemos
          nosotros a mano: no es automático, y acá vas viendo que está en camino.
        </Point>
      </div>
    </IntroPage>
  );
}
