"use client";

// Bienvenida de Equipo.
//
// DOS COSAS Y NADA MÁS. (1) Tu equipo son compañeros con nombre y cara: cada
// uno se ocupa de una cosa, la hace todos los días, y tiene escrito qué no hace
// nunca. (2) EL TRABAJO ES DE TODOS: el tablero, las entregas y los archivos
// siguen siendo uno solo — el rol es la firma de quién hizo cada cosa, no un
// cajón aparte donde hay que ir a buscarla. Sin la segunda, el cliente sale de
// acá creyendo que le acaban de dar cinco portales para revisar.
//
// LA ILUSTRACIÓN. El roster en chiquito, con las caras de verdad
// (`AgentitoAvatar`, el mismo SVG que dibuja la pestaña y los chips), y abajo
// una entrega firmada por una de esas caras. Que la misma cara aparezca en las
// dos partes del dibujo es lo que dice "firma, no compartimiento" sin tener que
// explicarlo en un párrafo.
//
// Y va adentro de `Maqueta`, con nombres inventados: el roster de cada cliente
// lo sirve su agente, y un dibujo no puede afirmar quién trabaja para él. La
// bienvenida de Conexiones ya nos enseñó eso caro — una clienta entró creyendo
// que tenía enchufado lo que el ejemplo dibujaba.

import { Ban, Layers, PenLine, UserPlus, Users } from "lucide-react";
import { AgentitoAvatar, LOOK_DEFAULT, type AgentitoLook } from "../agentito";
import { Eyebrow, IntroPage, Lead, Maqueta, Point, Title, type IntroProps } from "./shell";

type Companiero = {
  nombre: string;
  puesto: string;
  hace: string;
  nunca: string;
  look: AgentitoLook;
};

// Compañeros inventados, con puestos genéricos a propósito: el portal es el
// mismo para cualquier agente, y el catálogo de roles lo decide cada agente.
const EJEMPLO: Companiero[] = [
  {
    nombre: "Vera",
    puesto: "Atención al cliente",
    hace: "Contesta lo que entra y te pasa lo que no puede resolver sola.",
    nunca: "no promete precios ni plazos",
    look: { ...LOOK_DEFAULT, tono: 3, antena: 2, boca: 2, cejas: 1 },
  },
  {
    nombre: "Nilo",
    puesto: "Administración",
    hace: "Ordena los comprobantes del día y arma el resumen del mes.",
    nunca: "no paga nada sin tu visto bueno",
    look: { ...LOOK_DEFAULT, tono: 1, antena: 4, accesorio: 1, boca: 1, traje: 2 },
  },
];

function FilaDeCompaniero({ c }: { c: Companiero }) {
  return (
    <div className="flex gap-3">
      <AgentitoAvatar look={c.look} className="h-11 w-11 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <p className="text-[13px] font-semibold text-ink">{c.nombre}</p>
          <span className="text-[11px] text-ink-soft">{c.puesto}</span>
        </div>
        <p className="mt-0.5 text-[12px] leading-snug text-ink-soft">{c.hace}</p>
        <p className="mt-0.5 text-[11.5px] leading-snug text-ink-soft">
          <span className="font-medium text-ink">Nunca:</span> {c.nunca}
        </p>
      </div>
    </div>
  );
}

/** La misma cara, al pie de un trabajo que vive en otra pestaña. Es el chip que
 *  el portal dibuja de verdad al costado de cada entrega, cada tarjeta y cada
 *  respuesta del chat. */
function Firma({ c }: { c: Companiero }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg border border-black/[0.07] bg-white px-1.5 py-0.5 text-[11px] font-medium text-ink-soft">
      <AgentitoAvatar look={c.look} className="h-4 w-4 shrink-0" />
      {c.nombre}
    </span>
  );
}

export default function EquipoIntro({ onOk }: IntroProps) {
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

        <Maqueta
          className="bg-white"
          nota="Compañeros inventados: los tuyos son los que tenga tu agente."
        >
          <div className="flex flex-col gap-3">
            {EJEMPLO.map((c) => (
              <FilaDeCompaniero key={c.nombre} c={c} />
            ))}
          </div>

          {/* La segunda mitad del dibujo: un trabajo que NO vive acá, firmado
              por una de las mismas caras. */}
          <div className="mt-3 border-t border-black/[0.07] pt-3">
            <p className="text-[10px] font-bold uppercase tracking-wide text-ink-soft">
              En Entregas
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <p className="min-w-0 flex-1 truncate text-[12px] text-ink">
                Resumen de compras de agosto
              </p>
              <Firma c={EJEMPLO[1]} />
            </div>
          </div>
        </Maqueta>
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
