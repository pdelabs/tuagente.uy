"use client";

// Los ejemplos de flujos, en un solo lugar: los usa el ONBOARDING (donde el
// agente explica que puede trabajar solo) y el vacío de la pestaña Flujos.
// Vivían duplicados y eso garantiza que se desincronicen.
//
// Cada uno dice si necesita una conexión. Prometer lo que el agente todavía no
// puede hacer es la peor manera de empezar una relación en la que te van a
// confiar el trabajo — y de paso empuja a Conexiones, que es donde queremos
// que el cliente vaya.

export type EjemploFlujo = { titulo: string; texto: string; falta?: string };

export const EJEMPLOS_FLUJOS: EjemploFlujo[] = [
  { titulo: "Vigilar a la competencia",
    texto: "Cada lunes miro qué publicaron y te dejo un resumen de lo que cambió." },
  { titulo: "Contenido para redes",
    texto: "Todas las semanas te dejo tres posts escritos con su imagen, listos para que apruebes." },
  { titulo: "Resumen de reuniones",
    texto: "Me pasás el audio y te devuelvo las decisiones y quién quedó a cargo de qué." },
  { titulo: "Reseñas de tu negocio",
    texto: "Miro las que aparecen y te aviso solo cuando hay una mala." },
  { titulo: "Precios de proveedores",
    texto: "Reviso sus listas y te aviso si alguno cambió." },
  { titulo: "El newsletter del mes",
    texto: "Junto lo que pasó y te dejo el borrador escrito." },
  { titulo: "Presupuestos",
    texto: "Me contás lo que hablaste con el cliente y lo armo con tu formato." },
  { titulo: "Leads que llegan por mail",
    texto: "Cada pedido de presupuesto queda anotado con el contacto y qué necesita.",
    falta: "tu casilla" },
  { titulo: "Los cobros del día",
    texto: "Todas las mañanas te digo qué entró ayer y qué quedó pendiente.",
    falta: "Mercado Pago" },
  { titulo: "WhatsApp sin responder",
    texto: "Reviso quién quedó esperando y te paso la lista.",
    falta: "WhatsApp" },
];

/** Carrusel horizontal: se arrastra y engancha en cada tarjeta. En el teléfono
 *  es el gesto natural, y en escritorio deja ver que hay más sin comerse la
 *  pantalla con una grilla de diez. */
export function CarruselEjemplos() {
  return (
    <div className="-mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-3 text-left [scrollbar-width:thin]">
      {EJEMPLOS_FLUJOS.map((e) => (
        <div
          key={e.titulo}
          className="w-[248px] shrink-0 snap-start rounded-card border border-black/[0.07] bg-white p-4"
        >
          <p className="text-sm font-bold leading-snug text-ink">{e.titulo}</p>
          <p className="mt-1.5 text-[13px] leading-relaxed text-ink-soft">{e.texto}</p>
          {e.falta && (
            <p className="mt-3 text-[12px] font-medium text-ink-soft">
              Necesita conectar {e.falta}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
