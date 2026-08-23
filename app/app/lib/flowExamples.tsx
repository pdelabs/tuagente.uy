"use client";

// Flow examples, in one single place: used by ONBOARDING (the last screen,
// where the agent offers to take something on) and by the empty state of the
// Flows tab. They used to be duplicated, which guarantees they drift apart.

// EACH CARD IS A BUTTON, and that's the point: showing them with nothing to
// touch leaves the client looking at a shop window. Tapping one opens the
// chat with that request already written, and the agent starts by asking
// whatever it needs to build it.
//
// The `prompt` is in the CLIENT's first person because it's what they'd say
// to the agent: what gets sent is their message, not an instruction of ours.
//
// Each one says whether it needs a connection. Promising something the agent
// can't do yet is the worst way to start a relationship where they're about
// to trust you with the work -- and it nudges them toward Connections, which
// is where we want the client to go anyway.

import Link from "next/link";

export type FlowExample = {
  title: string;
  description: string;
  prompt: string;
  missing?: string;
};

export const FLOW_EXAMPLES: FlowExample[] = [
  {
    title: "Vigilar a la competencia",
    description: "Cada lunes miro qué publicaron y te dejo un resumen de lo que cambió.",
    prompt: "Quiero que todas las semanas mires qué están haciendo mis competidores y me dejes un resumen de lo que cambió. Preguntame lo que te falte para armarlo.",
  },
  {
    title: "Contenido para redes",
    description: "Todas las semanas te dejo tres posts escritos con su imagen, listos para que apruebes.",
    prompt: "Quiero que todas las semanas me dejes listos unos posts para redes, con el texto y la imagen, para que yo los apruebe. Preguntame lo que te falte para armarlo.",
  },
  {
    title: "Resumen de reuniones",
    description: "Me pasás el audio y te devuelvo las decisiones y quién quedó a cargo de qué.",
    prompt: "Quiero pasarte el audio de una reunión y que me devuelvas las decisiones y quién quedó a cargo de cada cosa. Preguntame lo que te falte para armarlo.",
  },
  {
    title: "Reseñas de tu negocio",
    description: "Miro las que aparecen y te aviso solo cuando hay una mala.",
    prompt: "Quiero que mires las reseñas nuevas de mi negocio y me avises solo cuando haya una mala. Preguntame lo que te falte para armarlo.",
  },
  {
    title: "Precios de proveedores",
    description: "Reviso sus listas y te aviso si alguno cambió.",
    prompt: "Quiero que revises los precios de mis proveedores cada tanto y me avises si alguno cambió. Preguntame lo que te falte para armarlo.",
  },
  {
    title: "El newsletter del mes",
    description: "Junto lo que pasó y te dejo el borrador escrito.",
    prompt: "Quiero que cada mes juntes lo que pasó en la empresa y me dejes el borrador del newsletter escrito. Preguntame lo que te falte para armarlo.",
  },
  {
    title: "Presupuestos",
    description: "Me contás lo que hablaste con el cliente y lo armo con tu formato.",
    prompt: "Quiero contarte lo que hablé con un cliente y que me armes el presupuesto con mi formato. Preguntame lo que te falte para armarlo, incluido cómo son mis presupuestos.",
  },
  {
    title: "Leads que llegan por mail",
    description: "Cada pedido de presupuesto queda anotado con el contacto y qué necesita.",
    prompt: "Quiero que cada mail que pide presupuesto quede anotado como tarea, con el contacto y qué necesita. Preguntame lo que te falte para armarlo.",
    missing: "tu casilla",
  },
  {
    title: "Los cobros del día",
    description: "Todas las mañanas te digo qué entró ayer y qué quedó pendiente.",
    prompt: "Quiero que todas las mañanas me digas cuánto se cobró ayer y qué quedó pendiente. Preguntame lo que te falte para armarlo.",
    missing: "Mercado Pago",
  },
  {
    title: "WhatsApp sin responder",
    description: "Reviso quién quedó esperando y te paso la lista.",
    prompt: "Quiero que revises los WhatsApp que quedaron sin responder y me pases la lista de quién está esperando. Preguntame lo que te falte para armarlo.",
    missing: "WhatsApp",
  },
];

/** The chat with the request already written. Sends it on its own once opened. */
export const buildChatLink = (prompt: string) =>
  `/app/chat?p=${encodeURIComponent(prompt)}`;

/** Horizontal carousel: drags and snaps to each card.
 *
 *  The edges fade out with `mask-image` instead of cutting off sharply: a
 *  hard cutoff reads as a layout bug, the fade reads as "there's more, keep
 *  going". And it's a mask rather than a div with a gradient on top because
 *  the portal's background changes between screens -- a painted gradient
 *  would have to know what color the background is, and the mask doesn't. */
export function ExampleCarousel({ onPick }: { onPick?: (prompt: string) => void } = {}) {
  // INSIDE ONBOARDING you can't navigate with <Link>: onboarding's gate stays
  // mounted and swallows any route, so the click does NOTHING visible. That's
  // what `onPick` is for: it closes onboarding first and sends the message
  // after. Outside onboarding (the Flows tab) a plain link is enough and it
  // keeps middle-click and "open in new tab" working.
  return (
    <div
      className="-mx-7 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-p-7 px-7 pb-3 text-left [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
      style={{
        maskImage:
          "linear-gradient(to right, transparent 0, black 28px, black calc(100% - 28px), transparent 100%)",
        WebkitMaskImage:
          "linear-gradient(to right, transparent 0, black 28px, black calc(100% - 28px), transparent 100%)",
      }}
    >
      {FLOW_EXAMPLES.map((example) => {
        const className = "group w-[300px] shrink-0 snap-start rounded-card border border-black/[0.07] bg-white p-4 text-left transition hover:border-primary/40 hover:bg-primary/[0.02]";
        const content = (
          <>
            <p className="text-sm font-bold leading-snug text-ink transition group-hover:text-primary">
              {example.title}
            </p>
            <p className="mt-1.5 text-[13px] leading-relaxed text-ink-soft">{example.description}</p>
            {example.missing && (
              <p className="mt-3 text-[12px] font-medium text-ink-soft">
                Necesita conectar {example.missing}
              </p>
            )}
          </>
        );
        return onPick ? (
          <button key={example.title} className={className} onClick={() => onPick(example.prompt)}>
            {content}
          </button>
        ) : (
          <Link key={example.title} href={buildChatLink(example.prompt)} className={className}>
            {content}
          </Link>
        );
      })}
    </div>
  );
}
