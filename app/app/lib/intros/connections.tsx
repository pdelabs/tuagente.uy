"use client";

// Connections' welcome screen.
//
// The idea to get across: your agent doesn't live isolated -- it plugs into
// the systems the company ALREADY uses, and every plug is your own decision.
//
// THERE'S NO MOCKUP HERE, ON PURPOSE. The earlier version drew a made-up
// board of plugs with green checkmarks next to Telegram, the company's email
// and the spreadsheets. A test client walked in convinced she already had all
// of that plugged in; the only thing actually connected was the model quota
// we set up for her. A green checkmark next to "Telegram" isn't an
// illustration: it's a claim about HER account.
//
// The portal knows the real state, so the real state gets shown -- the same
// `GET /portal/connections` the tab itself uses, via `lib/agent.ts`. For a
// new client the honest answer ("you don't have any connected yet") is also
// the most useful thing this screen can say: it's what sends them to connect
// them. If the call can't be made or the agent doesn't publish the catalog,
// it falls back to a drawing with NO statuses, marked as an example.
//
// What it does NOT promise: nothing gets connected here with one click, and
// no credentials get pasted in. It gets requested, and we connect it.
// Promising self-service and then asking for a call back would be worse than
// not promising it at all.

import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowRight, Check, Clock, Lock, Plug, ShieldCheck, Workflow, type LucideIcon,
} from "lucide-react";
import { getConnections, loadConfig, type Connection } from "../agent";
import {
  Eyebrow, IntroPage, Lead, Mockup, Step, Point, Title, type IntroProps,
} from "./shell";

/* ── Real status ───────────────────────────────────────────────────────────── */

/** How each status is said in plain terms. Whatever isn't in this table
 *  doesn't get named: a newer adapter might bring a status we don't know how
 *  to read yet, and guessing at it would be asserting something we can't vouch for. */
const LABEL: Record<string, string> = {
  connected: "Conectado",
  ready: "Falta que le mandes un hola",
  blocked: "La destrabamos nosotros",
  disconnected: "Sin conectar",
};

const ICON: Record<string, LucideIcon> = {
  connected: Check,
  ready: Clock,
  blocked: Lock,
};

/** First whatever's already working, then whatever the client's flow needs. */
const order = (c: Connection) =>
  c.status === "connected" ? 0 : c.required ? 1 : 2;

const PER_COLUMN = 4;

function useRealConnections() {
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [noData, setNoData] = useState(false);

  useEffect(() => {
    const cfg = loadConfig();
    if (!cfg) { setNoData(true); return; }
    let alive = true;
    getConnections(cfg)
      .then((r) => {
        if (!alive) return;
        if (!r?.available || !Array.isArray(r.connections) || r.connections.length === 0) {
          setNoData(true);
          return;
        }
        setConnections([...r.connections].sort((a, b) => order(a) - order(b)));
      })
      .catch(() => { if (alive) setNoData(true); });
    return () => { alive = false; };
  }, []);

  return { connections, noData };
}

function RealRow({ c }: { c: Connection }) {
  const connected = c.status === "connected";
  const Icon = ICON[c.status] ?? Plug;
  return (
    <div className="flex items-center gap-3 py-2">
      <span
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border ${
          connected
            ? "border-c-green bg-c-green text-c-green-ink"
            : "border-black/[0.09] bg-black/[0.03] text-ink-soft"
        }`}
      >
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold text-ink">{c.label}</span>
        <span className={`block truncate text-[11px] ${connected ? "text-c-green-ink" : "text-ink-soft"}`}>
          {LABEL[c.status] ?? ""}
        </span>
      </span>
      {/* The cable: solid when connected, dashed when missing. */}
      <span
        aria-hidden
        className={`hidden h-px w-10 shrink-0 sm:block ${
          connected
            ? "bg-primary/45"
            : "bg-[repeating-linear-gradient(to_right,rgba(0,0,0,.18)_0_4px,transparent_4px_8px)]"
        }`}
      />
    </div>
  );
}

function RealColumn({ title, items }: { title: string; items: Connection[] }) {
  const visible = items.slice(0, PER_COLUMN);
  const remaining = items.length - visible.length;
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-bold uppercase tracking-wide text-ink-soft">{title}</p>
      <div className="mt-1 divide-y divide-black/[0.06]">
        {visible.map((c) => <RealRow key={c.id} c={c} />)}
      </div>
      {remaining > 0 && (
        <p className="mt-1.5 text-[11px] text-ink-soft">
          y {remaining} más adentro
        </p>
      )}
      {visible.length === 0 && (
        <p className="mt-1.5 text-[12px] text-ink-soft">Nada de esto todavía.</p>
      )}
    </div>
  );
}

/** While it's being asked. Says nothing about anyone: they're just bars. */
function LoadingColumn({ title }: { title: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-bold uppercase tracking-wide text-ink-soft">{title}</p>
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

/* ── The fallback drawing ──────────────────────────────────────────────────── */

// With no catalog from the agent, NOTHING about anyone's status can be said:
// the fallback shows what kind of things we're talking about, with not a
// single checkmark.
const EXAMPLE_CHANNELS = ["Telegram", "Correo de la empresa", "WhatsApp"];
const EXAMPLE_SYSTEMS = ["Planillas y Drive", "Agenda"];

function ExampleColumn({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-bold uppercase tracking-wide text-ink-soft">{title}</p>
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

/* ── The screen ────────────────────────────────────────────────────────────── */

function Panel({ children }: { children: ReactNode }) {
  return (
    <div className="mt-6 rounded-card border border-black/[0.07] bg-gradient-to-br from-c-violet/60 via-surface to-white p-4 sm:p-5">
      {children}
    </div>
  );
}

export default function ConnectionsIntro({ onOk }: IntroProps) {
  const { connections, noData } = useRealConnections();

  const channels = (connections ?? []).filter((c) => c.group === "channel");
  const systems = (connections ?? []).filter((c) => c.group !== "channel");
  const connectedCount = (connections ?? []).filter((c) => c.status === "connected").length;
  const total = connections?.length ?? 0;

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

      {noData ? (
        // With no catalog nothing gets asserted: it becomes a drawing, and it says so.
        <Mockup
          className="mt-6 bg-gradient-to-br from-c-violet/60 via-surface to-white"
          note="No pude leer las tuyas desde acá. Entrá y ahí están, con su estado."
        >
          <div className="grid gap-5 sm:grid-cols-2">
            <ExampleColumn title="Por dónde te habla" items={EXAMPLE_CHANNELS} />
            <ExampleColumn title="Dónde trabaja" items={EXAMPLE_SYSTEMS} />
          </div>
        </Mockup>
      ) : connections === null ? (
        <Panel>
          <p className="mb-2 text-[12px] text-ink-soft">Mirando a qué está enchufado…</p>
          <div className="grid gap-5 sm:grid-cols-2">
            <LoadingColumn title="Por dónde te habla" />
            <LoadingColumn title="Dónde trabaja" />
          </div>
        </Panel>
      ) : (
        <Panel>
          {/* The whole count, right at the top: it's the line that keeps
              someone from reading three rows and walking away thinking
              everything's already running. */}
          <p className="mb-2 flex flex-wrap items-baseline gap-x-2">
            <span className="text-[11px] font-bold uppercase tracking-wide text-ink-soft">Hoy</span>
            <span className="text-[12px] font-semibold text-ink">
              {connectedCount === 0
                ? "Todavía no tenés ninguna conectada."
                : `${connectedCount === 1 ? "1 conectada" : `${connectedCount} conectadas`} de ${total}.`}
            </span>
          </p>
          <div className="grid gap-5 sm:grid-cols-2">
            <RealColumn title="Por dónde te habla" items={channels} />
            <RealColumn title="Dónde trabaja" items={systems} />
          </div>
        </Panel>
      )}

      {/* Three steps, not three buttons: "Pedís la conexión" is the name of
          something you do on the tab, and drawing it as a pill made it pass
          for a control that doesn't exist here. */}
      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-card border border-black/[0.07] bg-white px-4 py-3">
        <p className="text-[12px] font-semibold text-ink-soft">Cómo funciona:</p>
        <Step icon={Plug}>Pedís la conexión</Step>
        <ArrowRight className="h-3 w-3 shrink-0 text-ink-soft/50" aria-hidden />
        <Step icon={ShieldCheck}>La revisamos</Step>
        <ArrowRight className="h-3 w-3 shrink-0 text-ink-soft/50" aria-hidden />
        <Step icon={Check}>Queda andando</Step>
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
