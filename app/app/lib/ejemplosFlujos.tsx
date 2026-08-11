"use client";

// Los ejemplos de flujos, en un solo lugar: los usa el ONBOARDING (última
// pantalla, donde el agente ofrece encargarse de algo) y el vacío de la
// pestaña Flujos. Vivían duplicados y eso garantiza que se desincronicen.
//
// CADA TARJETA ES UN BOTÓN, y es el punto: mostrarlas sin poder tocarlas deja
// al cliente mirando una vidriera. Al tocar una, se abre el chat con ese pedido
// ya escrito y el agente arranca preguntando lo que le falta para armarlo.
//
// El `prompt` está en primera persona del CLIENTE porque es lo que él le diría
// al agente: lo que se manda es su mensaje, no una instrucción nuestra.
//
// Cada uno dice si necesita una conexión. Prometer lo que el agente todavía no
// puede hacer es la peor manera de empezar una relación en la que te van a
// confiar el trabajo — y de paso empuja a Conexiones, que es donde queremos
// que el cliente vaya.

import Link from "next/link";

export type EjemploFlujo = {
  titulo: string;
  texto: string;
  prompt: string;
  falta?: string;
};

export const EJEMPLOS_FLUJOS: EjemploFlujo[] = [
  {
    titulo: "Vigilar a la competencia",
    texto: "Cada lunes miro qué publicaron y te dejo un resumen de lo que cambió.",
    prompt: "Quiero que todas las semanas mires qué están haciendo mis competidores y me dejes un resumen de lo que cambió. Preguntame lo que te falte para armarlo.",
  },
  {
    titulo: "Contenido para redes",
    texto: "Todas las semanas te dejo tres posts escritos con su imagen, listos para que apruebes.",
    prompt: "Quiero que todas las semanas me dejes listos unos posts para redes, con el texto y la imagen, para que yo los apruebe. Preguntame lo que te falte para armarlo.",
  },
  {
    titulo: "Resumen de reuniones",
    texto: "Me pasás el audio y te devuelvo las decisiones y quién quedó a cargo de qué.",
    prompt: "Quiero pasarte el audio de una reunión y que me devuelvas las decisiones y quién quedó a cargo de cada cosa. Preguntame lo que te falte para armarlo.",
  },
  {
    titulo: "Reseñas de tu negocio",
    texto: "Miro las que aparecen y te aviso solo cuando hay una mala.",
    prompt: "Quiero que mires las reseñas nuevas de mi negocio y me avises solo cuando haya una mala. Preguntame lo que te falte para armarlo.",
  },
  {
    titulo: "Precios de proveedores",
    texto: "Reviso sus listas y te aviso si alguno cambió.",
    prompt: "Quiero que revises los precios de mis proveedores cada tanto y me avises si alguno cambió. Preguntame lo que te falte para armarlo.",
  },
  {
    titulo: "El newsletter del mes",
    texto: "Junto lo que pasó y te dejo el borrador escrito.",
    prompt: "Quiero que cada mes juntes lo que pasó en la empresa y me dejes el borrador del newsletter escrito. Preguntame lo que te falte para armarlo.",
  },
  {
    titulo: "Presupuestos",
    texto: "Me contás lo que hablaste con el cliente y lo armo con tu formato.",
    prompt: "Quiero contarte lo que hablé con un cliente y que me armes el presupuesto con mi formato. Preguntame lo que te falte para armarlo, incluido cómo son mis presupuestos.",
  },
  {
    titulo: "Leads que llegan por mail",
    texto: "Cada pedido de presupuesto queda anotado con el contacto y qué necesita.",
    prompt: "Quiero que cada mail que pide presupuesto quede anotado como tarea, con el contacto y qué necesita. Preguntame lo que te falte para armarlo.",
    falta: "tu casilla",
  },
  {
    titulo: "Los cobros del día",
    texto: "Todas las mañanas te digo qué entró ayer y qué quedó pendiente.",
    prompt: "Quiero que todas las mañanas me digas cuánto se cobró ayer y qué quedó pendiente. Preguntame lo que te falte para armarlo.",
    falta: "Mercado Pago",
  },
  {
    titulo: "WhatsApp sin responder",
    texto: "Reviso quién quedó esperando y te paso la lista.",
    prompt: "Quiero que revises los WhatsApp que quedaron sin responder y me pases la lista de quién está esperando. Preguntame lo que te falte para armarlo.",
    falta: "WhatsApp",
  },
];

/** El chat con el pedido ya escrito. Lo manda solo al abrirse. */
export const linkArmar = (prompt: string) =>
  `/app/chat?p=${encodeURIComponent(prompt)}`;

/** Carrusel horizontal: se arrastra y engancha en cada tarjeta.
 *
 *  Los bordes se desvanecen con `mask-image` en vez de cortarse en seco: el
 *  corte duro se lee como un error de maquetación, el degradado se lee como
 *  "hay más, seguí". Y es máscara y no un div con gradiente encima porque el
 *  fondo del portal cambia entre pantallas — un gradiente pintado tendría que
 *  saber de qué color es el fondo, y la máscara no. */
export function CarruselEjemplos({ onElegir }: { onElegir?: (prompt: string) => void } = {}) {
  // DENTRO DEL ONBOARDING no se puede navegar con <Link>: la puerta del
  // onboarding sigue montada y atrapa cualquier ruta, asi que el clic no hace
  // NADA visible. Ahi va `onElegir`, que primero cierra el onboarding y
  // despues manda. Fuera del onboarding (pestaña Flujos) el link comun alcanza
  // y conserva el clic del medio y "abrir en pestaña nueva".
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
      {EJEMPLOS_FLUJOS.map((e) => {
        const clase = "group w-[300px] shrink-0 snap-start rounded-card border border-black/[0.07] bg-white p-4 text-left transition hover:border-primary/40 hover:bg-primary/[0.02]";
        const contenido = (
          <>
            <p className="text-sm font-bold leading-snug text-ink transition group-hover:text-primary">
              {e.titulo}
            </p>
            <p className="mt-1.5 text-[13px] leading-relaxed text-ink-soft">{e.texto}</p>
            {e.falta && (
              <p className="mt-3 text-[12px] font-medium text-ink-soft">
                Necesita conectar {e.falta}
              </p>
            )}
          </>
        );
        return onElegir ? (
          <button key={e.titulo} className={clase} onClick={() => onElegir(e.prompt)}>
            {contenido}
          </button>
        ) : (
          <Link key={e.titulo} href={linkArmar(e.prompt)} className={clase}>
            {contenido}
          </Link>
        );
      })}
    </div>
  );
}
