"use client";

// Bienvenida de Conexiones.
//
// La idea a transmitir: tu agente no vive aislado — se enchufa a los sistemas
// que la empresa YA usa, y cada enchufe es una decisión tuya.
//
// ACÁ NO HAY MAQUETA, Y ESO ES A PROPÓSITO. La versión anterior dibujaba un
// tablero de enchufes inventado con tildes verdes al lado de Telegram, del
// correo de la empresa y de las planillas. Una clienta de prueba entró
// convencida de que ya tenía todo eso enchufado; lo único conectado que tenía
// era la cuota de modelos que le ponemos nosotros. Un tilde verde al lado de
// "Telegram" no es una ilustración: es una afirmación sobre SU cuenta.
//
// El estado real lo sabe el portal, así que se muestra el estado real —el mismo
// `GET /portal/connections` que usa la pestaña, por `lib/agent.ts`—. Para un
// cliente nuevo la respuesta honesta ("todavía no tenés ninguna conectada") es
// además la más útil que puede dar esta pantalla: es lo que lo manda a
// conectarlas. Si la llamada no se puede hacer o el agente no publica el
// catálogo, se cae a un dibujo SIN estados, marcado como ejemplo.
//
// Lo que NO promete: acá no se conecta nada con un clic ni se pegan claves.
// Se pide, y lo conectamos nosotros. Prometer autoservicio y después pedir una
// llamada sería peor que no prometerlo.

import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowRight, Check, Clock, Lock, Plug, ShieldCheck, Workflow, type LucideIcon,
} from "lucide-react";
import { getConnections, loadConfig, type Connection } from "../agent";
import {
  Eyebrow, IntroPage, Lead, Maqueta, Paso, Point, Title, type IntroProps,
} from "./shell";

/* ── Estado real ─────────────────────────────────────────────────────────── */

/** Cómo se dice cada estado en criollo. Lo que no está en esta tabla no se
 *  nombra: un adapter más nuevo puede traer un estado que todavía no sabemos
 *  leer, y adivinarlo sería volver a afirmar algo que no nos consta. */
const ROTULO: Record<string, string> = {
  conectado: "Conectado",
  lista: "Falta que le mandes un hola",
  bloqueado: "La destrabamos nosotros",
  sin_conectar: "Sin conectar",
};

const ICONO: Record<string, LucideIcon> = {
  conectado: Check,
  lista: Clock,
  bloqueado: Lock,
};

/** Primero lo que ya anda, después lo que el flujo del cliente necesita. */
const orden = (c: Connection) =>
  c.estado === "conectado" ? 0 : c.requerida ? 1 : 2;

const POR_COLUMNA = 4;

function useConexionesReales() {
  const [conexiones, setConexiones] = useState<Connection[] | null>(null);
  const [sinDatos, setSinDatos] = useState(false);

  useEffect(() => {
    const cfg = loadConfig();
    if (!cfg) { setSinDatos(true); return; }
    let vivo = true;
    getConnections(cfg)
      .then((r) => {
        if (!vivo) return;
        if (!r?.disponible || !Array.isArray(r.conexiones) || r.conexiones.length === 0) {
          setSinDatos(true);
          return;
        }
        setConexiones([...r.conexiones].sort((a, b) => orden(a) - orden(b)));
      })
      .catch(() => { if (vivo) setSinDatos(true); });
    return () => { vivo = false; };
  }, []);

  return { conexiones, sinDatos };
}

function FilaReal({ c }: { c: Connection }) {
  const conectado = c.estado === "conectado";
  const Icon = ICONO[c.estado] ?? Plug;
  return (
    <div className="flex items-center gap-3 py-2">
      <span
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border ${
          conectado
            ? "border-c-green bg-c-green text-c-green-ink"
            : "border-black/[0.09] bg-black/[0.03] text-ink-soft"
        }`}
      >
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold text-ink">{c.label}</span>
        <span className={`block truncate text-[11px] ${conectado ? "text-c-green-ink" : "text-ink-soft"}`}>
          {ROTULO[c.estado] ?? ""}
        </span>
      </span>
      {/* El cable: entero cuando está conectado, punteado cuando falta. */}
      <span
        aria-hidden
        className={`hidden h-px w-10 shrink-0 sm:block ${
          conectado
            ? "bg-primary/45"
            : "bg-[repeating-linear-gradient(to_right,rgba(0,0,0,.18)_0_4px,transparent_4px_8px)]"
        }`}
      />
    </div>
  );
}

function ColumnaReal({ titulo, items }: { titulo: string; items: Connection[] }) {
  const visibles = items.slice(0, POR_COLUMNA);
  const resto = items.length - visibles.length;
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-bold uppercase tracking-wide text-ink-soft">{titulo}</p>
      <div className="mt-1 divide-y divide-black/[0.06]">
        {visibles.map((c) => <FilaReal key={c.id} c={c} />)}
      </div>
      {resto > 0 && (
        <p className="mt-1.5 text-[11px] text-ink-soft">
          y {resto} más adentro
        </p>
      )}
      {visibles.length === 0 && (
        <p className="mt-1.5 text-[12px] text-ink-soft">Nada de esto todavía.</p>
      )}
    </div>
  );
}

/** Mientras se pregunta. No dice nada de nadie: son barras. */
function ColumnaCargando({ titulo }: { titulo: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-bold uppercase tracking-wide text-ink-soft">{titulo}</p>
      <div className="mt-1 divide-y divide-black/[0.06]">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-3 py-2.5">
            <span className="h-7 w-7 shrink-0 rounded-lg bg-black/[0.05]" />
            <span className="min-w-0 flex-1 space-y-1.5">
              <span className="block h-2 w-1/2 rounded-pill bg-black/[0.07]" />
              <span className="block h-1.5 w-1/3 rounded-pill bg-black/[0.05]" />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── El dibujo de reserva ────────────────────────────────────────────────── */

// Sin catálogo del agente no se puede decir NADA del estado de nadie: el
// respaldo muestra de qué tipo de cosas hablamos, sin un solo tilde.
const EJEMPLO_CANALES = ["Telegram", "Correo de la empresa", "WhatsApp"];
const EJEMPLO_SISTEMAS = ["Planillas y Drive", "Agenda"];

function ColumnaEjemplo({ titulo, items }: { titulo: string; items: string[] }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-bold uppercase tracking-wide text-ink-soft">{titulo}</p>
      <div className="mt-1 divide-y divide-black/[0.06]">
        {items.map((n) => (
          <div key={n} className="flex items-center gap-3 py-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-black/[0.09] bg-black/[0.03] text-ink-soft">
              <Plug className="h-3.5 w-3.5" />
            </span>
            <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">{n}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── La pantalla ─────────────────────────────────────────────────────────── */

function Panel({ children }: { children: ReactNode }) {
  return (
    <div className="mt-6 rounded-card border border-black/[0.07] bg-gradient-to-br from-c-violet/60 via-surface to-white p-4 sm:p-5">
      {children}
    </div>
  );
}

export default function ConnectionsIntro({ onOk }: IntroProps) {
  const { conexiones, sinDatos } = useConexionesReales();

  const canales = (conexiones ?? []).filter((c) => c.grupo === "canal");
  const sistemas = (conexiones ?? []).filter((c) => c.grupo !== "canal");
  const conectadas = (conexiones ?? []).filter((c) => c.estado === "conectado").length;
  const total = conexiones?.length ?? 0;

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

      {sinDatos ? (
        // Sin catálogo no se afirma nada: pasa a ser un dibujo, y se dice.
        <Maqueta
          className="mt-6 bg-gradient-to-br from-c-violet/60 via-surface to-white"
          nota="No pude leer las tuyas desde acá. Entrá y ahí están, con su estado."
        >
          <div className="grid gap-5 sm:grid-cols-2">
            <ColumnaEjemplo titulo="Por dónde te habla" items={EJEMPLO_CANALES} />
            <ColumnaEjemplo titulo="Dónde trabaja" items={EJEMPLO_SISTEMAS} />
          </div>
        </Maqueta>
      ) : conexiones === null ? (
        <Panel>
          <p className="mb-2 text-[12px] text-ink-soft">Mirando a qué está enchufado…</p>
          <div className="grid gap-5 sm:grid-cols-2">
            <ColumnaCargando titulo="Por dónde te habla" />
            <ColumnaCargando titulo="Dónde trabaja" />
          </div>
        </Panel>
      ) : (
        <Panel>
          {/* La cuenta entera, arriba de todo: es la frase que evita que alguien
              lea tres renglones y se vaya creyendo que tiene todo andando. */}
          <p className="mb-2 flex flex-wrap items-baseline gap-x-2">
            <span className="text-[11px] font-bold uppercase tracking-wide text-ink-soft">Hoy</span>
            <span className="text-[12px] font-semibold text-ink">
              {conectadas === 0
                ? "Todavía no tenés ninguna conectada."
                : `${conectadas === 1 ? "1 conectada" : `${conectadas} conectadas`} de ${total}.`}
            </span>
          </p>
          <div className="grid gap-5 sm:grid-cols-2">
            <ColumnaReal titulo="Por dónde te habla" items={canales} />
            <ColumnaReal titulo="Dónde trabaja" items={sistemas} />
          </div>
        </Panel>
      )}

      {/* Tres pasos, no tres botones: «Pedís la conexión» es el nombre de algo
          que se hace en la pestaña, y dibujarlo como pastilla lo hacía pasar
          por un control que acá no existe. */}
      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-card border border-black/[0.07] bg-white px-4 py-3">
        <p className="text-[12px] font-semibold text-ink-soft">Cómo funciona:</p>
        <Paso icon={Plug}>Pedís la conexión</Paso>
        <ArrowRight className="h-3 w-3 shrink-0 text-ink-soft/50" aria-hidden />
        <Paso icon={ShieldCheck}>La revisamos</Paso>
        <ArrowRight className="h-3 w-3 shrink-0 text-ink-soft/50" aria-hidden />
        <Paso icon={Check}>Queda andando</Paso>
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
