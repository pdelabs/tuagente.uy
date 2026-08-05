"use client";

// Bienvenida de Conexiones.
//
// La idea a transmitir: tu agente no vive aislado — se enchufa a los sistemas
// que la empresa YA usa, y cada enchufe es una decisión tuya. Por eso la
// ilustración es un tablero de enchufes: dos columnas (por dónde te habla /
// dónde trabaja), con el estado real de cada uno y un cable que se completa
// solo en los conectados.
//
// Lo que NO promete: acá no se conecta nada con un clic ni se pegan claves.
// Se pide, y lo conectamos nosotros. Prometer autoservicio y después pedir una
// llamada sería peor que no prometerlo.

import type { ReactNode } from "react";
import {
  Check, Lock, Plug, ShieldCheck, Workflow, type LucideIcon,
} from "lucide-react";
import { Eyebrow, IntroPage, Lead, Point, Title, type IntroProps } from "./shell";

type Enchufe = { nombre: string; detalle: string; conectado: boolean };

const CANALES: Enchufe[] = [
  { nombre: "Telegram", detalle: "Le escribís desde el celular", conectado: true },
  { nombre: "Correo de la empresa", detalle: "Recibe y contesta mails", conectado: true },
  { nombre: "WhatsApp", detalle: "Tus clientes le escriben", conectado: false },
];

const SISTEMAS: Enchufe[] = [
  { nombre: "Planillas y Drive", detalle: "Lee y actualiza tus planillas", conectado: true },
  { nombre: "Agenda", detalle: "Mira los compromisos del equipo", conectado: false },
];

function Fila({ e }: { e: Enchufe }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <span
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border ${
          e.conectado
            ? "border-c-green bg-c-green text-c-green-ink"
            : "border-black/[0.09] bg-black/[0.03] text-ink-soft"
        }`}
      >
        {e.conectado ? <Check className="h-3.5 w-3.5" /> : <Plug className="h-3.5 w-3.5" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold text-ink">{e.nombre}</span>
        <span className="block truncate text-[11px] text-ink-soft">{e.detalle}</span>
      </span>
      {/* El cable: entero cuando está conectado, punteado cuando falta. */}
      <span
        aria-hidden
        className={`h-px w-10 shrink-0 ${
          e.conectado
            ? "bg-primary/45"
            : "bg-[repeating-linear-gradient(to_right,rgba(0,0,0,.18)_0_4px,transparent_4px_8px)]"
        }`}
      />
    </div>
  );
}

function Columna({ titulo, items }: { titulo: string; items: Enchufe[] }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-bold uppercase tracking-wide text-ink-soft">{titulo}</p>
      <div className="mt-1 divide-y divide-black/[0.06]">
        {items.map((e) => (
          <Fila key={e.nombre} e={e} />
        ))}
      </div>
    </div>
  );
}

function Nota({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-pill border border-black/[0.07] bg-white px-2.5 py-1 text-[12px] font-semibold text-ink">
      <Icon className="h-3.5 w-3.5 text-ink-soft" />
      {children}
    </span>
  );
}

export default function ConnectionsIntro({ onOk }: IntroProps) {
  return (
    <IntroPage
      onOk={onOk}
      cta="Ver mis conexiones"
      note="Conectar un sistema nuevo lo hacemos nosotros, con vos."
    >
      <Eyebrow icon={Plug}>Conexiones</Eyebrow>
      <Title>Tu agente trabaja con los sistemas que ya usás</Title>
      <Lead>
        No sirve de mucho un asistente que vive aparte de todo. Acá ves a qué está enchufado hoy:
        por dónde te habla y en qué sistemas de la empresa puede leer y escribir. Lo que todavía no
        está conectado también aparece, con lo que implica conectarlo.
      </Lead>

      <div className="mt-6 rounded-card border border-black/[0.07] bg-gradient-to-br from-c-violet/60 via-surface to-white p-4 sm:p-5">
        <div className="grid gap-5 sm:grid-cols-2">
          <Columna titulo="Por dónde te habla" items={CANALES} />
          <Columna titulo="Dónde trabaja" items={SISTEMAS} />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 rounded-card border border-black/[0.07] bg-white px-4 py-3">
        <p className="text-[12px] font-semibold text-ink-soft">Cómo funciona:</p>
        <Nota icon={Plug}>Pedís la conexión</Nota>
        <Nota icon={ShieldCheck}>La revisamos</Nota>
        <Nota icon={Check}>Queda andando</Nota>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <Point icon={Workflow} title="Cada cosa a su tiempo">
          Algunas se conectan en minutos; otras, como WhatsApp, dependen de trámites que llevan
          días. Está dicho antes, no después.
        </Point>
        <Point icon={Lock} title="Tus claves no pasan por acá">
          En esta pantalla no se pega ninguna contraseña. Las credenciales quedan en tu agente y
          nunca se comparten con otro cliente.
        </Point>
        <Point icon={ShieldCheck} title="Nada se instala solo">
          Cada integración la revisamos antes de enchufarla. Tu agente no baja cosas de internet
          por su cuenta.
        </Point>
      </div>
    </IntroPage>
  );
}
