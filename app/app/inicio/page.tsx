"use client";

// Inicio: lo primero que ve el cliente cada día. Responde "¿qué pasó y qué
// necesita mi atención?" sin obligarlo a recorrer las ocho pestañas.
//
// PRINCIPIO CERO: sirve a cualquier agente Hermes de cualquier cliente. Nada de
// casos puntuales: se habla de "tu agente", "tareas", "archivos".
//
// Honestidad, que es la regla que manda acá:
//   · Cada bloque depende de su módulo en el manifest. Módulo apagado o
//     endpoint en 404 → el bloque no existe. Nunca un cero inventado.
//   · Las seis fuentes se piden en paralelo (Promise.allSettled) y cada una
//     pinta apenas llega: una caída saca su bloque, no la pantalla.
//   · Refresh silencioso cada 60 s. Si el refresh falla y ya teníamos datos,
//     los dejamos (viejos pero ciertos) y lo decimos al pie.

import {
  useCallback, useEffect, useMemo, useRef, useState,
  type Dispatch, type ReactNode, type SetStateAction,
} from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  Activity, ArrowRight, BarChart3, CheckCircle2, ChevronRight, Columns3,
  FolderOpen, Hand, LayoutDashboard, MessageSquare, Plug, Plus, RefreshCw, Workflow,
  type LucideIcon,
} from "lucide-react";
import {
  getActivity, getApprovals, getArtifacts, getConnections, getFiles, getFlujos, getManifest,
  getTickets, getUsage, loadConfig,
  type ArtifactMeta, type Connection, type Flujo, type HttpError, type Manifest,
  type PortalConfig, type Ticket,
} from "../lib/agent";
import { Card, Chip, EmptyState, ErrorState, IconBtn, PageHeader, Spinner } from "../lib/ui";
import { agentDisplayName } from "../lib/onboarding";
import { AgentitoCargando, loadAgentLook } from "../lib/agentito";
import type { EstadoAgentito } from "../lib/AgentitoRive";

// El personaje animado se trae solo acá y en el onboarding; el resto del portal
// no paga el runtime. Mientras carga se ve la misma cara, quieta.
const AgentitoRive = dynamic(() => import("../lib/AgentitoRive"), {
  ssr: false,
  loading: () => <AgentitoCargando />,
});

const WRAP = "mx-auto max-w-5xl px-6 py-6 md:px-8";
const REFRESH_MS = 60_000;
const ENTREGABLES = "entregables/"; // lo que el agente produce PARA el cliente

type Approval = { id: string; title: string; summary?: string; created_at: string | number };
type Evento = { ts: string; kind: string; label: string; status: string };
type Archivo = { path: string; size?: number; mtime?: string | number };
type Uso = { available?: boolean; sessions?: number; cost_usd?: number; period?: string };

/** Estado de una fuente: apagada en el manifest / 404 son lo mismo para el cliente. */
type Slot<T> =
  | { t: "cargando" }
  | { t: "off" }
  | { t: "falla" }
  | { t: "listo"; data: T };

type Setter<T> = Dispatch<SetStateAction<Slot<T>>>;

// ── formato ───────────────────────────────────────────────────────────────

const nf = new Intl.NumberFormat("es-UY");
const cf = new Intl.NumberFormat("es-UY", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Un consumo real que redondea a cero se marca; "US$ 0,00" sería mentira. */
const usd = (v: number): string => (v > 0 && v < 0.005 ? `< ${cf.format(0.01)}` : cf.format(v));

const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

const es404 = (e: unknown): boolean => {
  const err = e as HttpError | undefined;
  return err?.status === 404 || /^404\b/.test(String(err?.message ?? ""));
};

/** Tolerante: epoch en segundos (número o string), epoch en ms, o ISO. */
function toMs(v: string | number | undefined): number {
  if (v === undefined || v === null) return 0;
  if (typeof v === "number") return v < 1e12 ? v * 1000 : v;
  if (/^\d+(\.\d+)?$/.test(v)) {
    const n = Number(v);
    return n < 1e12 ? n * 1000 : n;
  }
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/** Duración pelada ("12 min", "3 días") para armar frases sin repetir "hace". */
function duracion(v: string | number | undefined): string | null {
  const t = toMs(v);
  if (!t) return null;
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return "un momento";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return h === 1 ? "1 hora" : `${h} horas`;
  const d = Math.floor(h / 24);
  return d === 1 ? "1 día" : `${d} días`;
}

const hace = (v: string | number | undefined): string | null => {
  const d = duracion(v);
  return d ? `hace ${d}` : null;
};

const saludo = (): string => {
  const h = new Date().getHours();
  if (h < 6) return "Buenas noches";
  if (h < 13) return "Buen día";
  if (h < 20) return "Buenas tardes";
  return "Buenas noches";
};

const hora = (d: Date) => d.toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit", hour12: false });

/** Momento de un evento: hoy sólo la hora; antes, con el día adelante. */
function cuando(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  const dia = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dias = Math.round((dia(new Date()) - dia(d)) / 86_400_000);
  if (dias === 0) return hora(d);
  if (dias === 1) return `ayer ${hora(d)}`;
  return `${d.getDate()}/${d.getMonth() + 1} ${hora(d)}`;
}

/** "30d" → "últimos 30 días"; cualquier otro formato se muestra crudo. */
function periodo(p?: string): string | null {
  if (!p || typeof p !== "string") return null;
  const m = /^(\d+)\s*d$/i.exec(p.trim());
  return m ? `últimos ${m[1]} días` : p;
}

const sesiones = (n: number) => `${nf.format(n)} ${n === 1 ? "sesión" : "sesiones"}`;

/** ["el tablero", "el consumo"] → "el tablero y el consumo" */
function enumerar(xs: string[]): string {
  if (xs.length <= 1) return xs[0] ?? "";
  return `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`;
}

// Kind de artefacto → rótulo del cliente. Uno desconocido se muestra crudo:
// mejor eso que esconderlo o inventarle un nombre.
const KINDS: Record<string, { label: string; tone: "violet" | "green" | "coral" | "amber" }> = {
  chart: { label: "Gráfico", tone: "violet" },
  table: { label: "Tabla", tone: "green" },
  report: { label: "Informe", tone: "amber" },
  dashboard: { label: "Panel", tone: "coral" },
  diagram: { label: "Diagrama", tone: "violet" },
};
const kindLabel = (k: string) => KINDS[k]?.label ?? k;
const kindTone = (k: string) => KINDS[k]?.tone ?? "neutral";

/** Nombre de entregable sin la carpeta ni la fecha con la que suele venir. */
function nombreEntregable(path: string): string {
  const base = (path || "").split("/").pop() || path;
  return base.replace(/^\d{4}-\d{2}-\d{2}[-_ ]/, "") || base;
}

// Mismo criterio que Actividad: los status crudos son muchos, el puntito son
// tres. Lo que no encaja queda neutro en vez de mentir un color.
function dotCls(kind: string, status: string): string {
  const s = (status || "").toLowerCase();
  if (/(^ok$|complet|success|done|deliver|sent|unblock|resolv|entregad|listo)/.test(s)) return "bg-c-green-ink";
  if (/(fail|error|timeout|cancel|reject|rechaz)/.test(s)) return "bg-c-coral-ink";
  if (/(run|progress|pend|claim|start|queue|block|curso|proceso)/.test(s)) return "bg-c-amber-ink";
  return kind === "ticket" ? "bg-c-violet-ink" : "bg-ink-soft/50";
}

// blocked y done son propios; ready, running y cualquier estado nuevo caen en
// "en curso" (no escondemos tareas por un estado que todavía no conocemos).
function columna(status: string): "porHacer" | "curso" | "esperando" | "hechas" {
  const s = (status || "").toLowerCase();
  // Las mismas cuatro columnas que el Tablero, en el mismo orden. Antes acá
  // eran tres y "ready" caía dentro de "En curso": el cliente veía "0 en
  // curso" en el Tablero y otro número en Inicio para las mismas tareas.
  if (s === "ready") return "porHacer";
  if (s === "blocked") return "esperando";
  if (s === "done") return "hechas";
  return "curso";
}

// ── piezas ────────────────────────────────────────────────────────────────

// Btn del kit es un <button> y acá todo navega: mismo lenguaje visual, <a>.
function LinkBtn({ href, kind = "primary", size = "md", children }: {
  href: string;
  kind?: "primary" | "secondary";
  size?: "sm" | "md";
  children: ReactNode;
}) {
  const kinds = {
    primary: "bg-primary text-white hover:bg-primary-dark",
    secondary: "border border-black/10 bg-white text-ink hover:bg-black/[0.03]",
  };
  const sizes = { sm: "h-8 px-2.5 text-[13px]", md: "h-9 px-3.5 text-sm" };
  return (
    <Link
      href={href}
      className={`inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg font-semibold transition ${kinds[kind]} ${sizes[size]}`}
    >
      {children}
    </Link>
  );
}

function Seccion({ titulo, icon: Icon, href, ver, children }: {
  titulo: string;
  icon: LucideIcon;
  href: string;
  ver: string;
  children: ReactNode;
}) {
  return (
    <Card className="flex flex-col">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="flex min-w-0 items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
          <Icon className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{titulo}</span>
        </p>
        <Link
          href={href}
          className="inline-flex shrink-0 items-center gap-0.5 text-[12px] font-semibold text-primary transition hover:text-primary-dark"
        >
          {ver}
          <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </div>
      {children}
    </Card>
  );
}

function Esqueleto({ filas = 2 }: { filas?: number }) {
  return (
    <div className="rounded-xl border border-black/[0.07] bg-white p-4">
      <div className="h-2.5 w-24 animate-pulse rounded bg-black/[0.07]" />
      <div className="mt-4 space-y-2.5">
        {Array.from({ length: filas }).map((_, i) => (
          <div
            key={i}
            className="h-2.5 animate-pulse rounded bg-black/[0.05]"
            style={{ width: `${70 - i * 15}%` }}
          />
        ))}
      </div>
    </div>
  );
}

function Vacio({ children }: { children: ReactNode }) {
  return <p className="text-[13px] text-ink-soft">{children}</p>;
}

function Metrica({ valor, label, tone }: {
  valor: number;
  label: string;
  tone: "violet" | "amber" | "green" | "neutral";
}) {
  const tones = {
    violet: "bg-c-violet/50",
    amber: "bg-c-amber/50",
    green: "bg-c-green/50",
    neutral: "bg-black/[0.04]",
  };
  return (
    <div className={`rounded-lg px-3 py-2.5 ${tones[tone]}`}>
      <p className="text-2xl font-bold leading-none tabular-nums text-ink">{nf.format(valor)}</p>
      <p className="mt-1.5 text-[11px] font-medium leading-tight text-ink-soft">{label}</p>
    </div>
  );
}

/** Conexiones que el flujo del cliente necesita y faltan: el agente está
 *  instalado pero su flujo no puede arrancar — eso se dice ANTES que nada,
 *  con el botón que lo resuelve. Sin pendientes, el bloque no existe. */
function ParaArrancar({ agente, pendientes }: { agente: string; pendientes: Connection[] }) {
  if (pendientes.length === 0) return null;
  const n = pendientes.length;
  return (
    <Card tone="amber">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white">
            <Plug className="h-4 w-4 text-c-amber-ink" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-ink">
              {n === 1
                ? `A ${agente} le falta 1 conexión para arrancar tu flujo`
                : `A ${agente} le faltan ${n} conexiones para arrancar tu flujo`}
            </p>
            <p className="mt-0.5 text-[13px] text-ink-soft">
              {enumerar(pendientes.map((c) => c.label))}
              {" — "}
              {n === 1 ? pendientes[0].para_que : "sin eso, esa parte del trabajo queda esperando."}
            </p>
          </div>
        </div>
        <LinkBtn href="/app/conexiones">
          {n === 1 ? "Conectarla" : "Conectarlas"}
          <ArrowRight className="h-4 w-4" />
        </LinkBtn>
      </div>
    </Card>
  );
}

/** Lo que necesita tu atención. Con pendientes, destacada; sin nada, tranquila. */
function Atencion({ pendientes }: { pendientes: Approval[] }) {
  const vieja = useMemo(
    () => [...pendientes].sort((a, b) => toMs(a.created_at) - toMs(b.created_at))[0],
    [pendientes],
  );

  if (pendientes.length === 0) {
    return (
      <Card>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-c-green-ink" />
          <p className="text-sm text-ink">No hay nada esperando tu ok.</p>
          <Link
            href="/app/aprobaciones"
            className="ml-auto inline-flex shrink-0 items-center gap-0.5 text-[12px] font-semibold text-primary transition hover:text-primary-dark"
          >
            Ver aprobaciones
            <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </Card>
    );
  }

  const n = pendientes.length;
  const espera = duracion(vieja?.created_at);
  return (
    <Card tone="violet">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white">
            <Hand className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-ink">
              {n === 1 ? "Hay 1 cosa esperando tu ok" : `Hay ${n} cosas esperando tu ok`}
            </p>
            {vieja && (
              <p className="mt-0.5 truncate text-[13px] text-ink-soft">{vieja.title}</p>
            )}
            {espera && (
              <p className="mt-0.5 text-[12px] text-ink-soft/80">
                {n === 1 ? "Espera" : "La más vieja espera"} desde hace {espera}
              </p>
            )}
          </div>
        </div>
        <LinkBtn href="/app/aprobaciones">
          {n === 1 ? "Revisar" : `Revisar las ${n}`}
          <ArrowRight className="h-4 w-4" />
        </LinkBtn>
      </div>
    </Card>
  );
}

/** "¿Qué hace este señor por mí?" — la pregunta que el portal no contestaba en
 *  ninguna pantalla. Se arma con los flujos del cliente y su propio texto. */
function QueHace({ flujos }: { flujos: Flujo[] }) {
  const activos = flujos.filter((f) => f.estado !== "pausado").slice(0, 4);
  if (activos.length === 0) {
    return (
      <Card>
        <p className="text-sm font-bold text-ink">Todavía no tenés trabajos armados</p>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">
          Un trabajo es algo que tu agente hace siempre igual — un resumen los lunes, un
          informe cada vez que le pasás algo. Contale por el chat qué tarea te come tiempo
          y lo deja armado.
        </p>
        <div className="mt-3"><LinkBtn href="/app/chat" size="sm">Contarle qué necesito</LinkBtn></div>
      </Card>
    );
  }
  return (
    <Seccion titulo="Qué hace por vos" icon={Workflow} href="/app/flujos" ver="Ver todos">
      <ul className="flex flex-col gap-2">
        {activos.map((f) => (
          <li key={f.slug} className="flex gap-2">
            <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-primary/70" />
            <p className="min-w-0 text-[13px] leading-relaxed text-ink-soft">
              <span className="font-semibold text-ink">{f.nombre}</span>
              {f.para_cliente ? ` — ${f.para_cliente}` : ""}
            </p>
          </li>
        ))}
      </ul>
    </Seccion>
  );
}

// ── pantalla ──────────────────────────────────────────────────────────────

export default function InicioPage() {
  const [cfg, setCfg] = useState<PortalConfig | null>(null);
  useEffect(() => { setCfg(loadConfig()); }, []);

  // El layout se encarga del login cuando no hay config.
  if (!cfg) return <div className={WRAP}><Spinner /></div>;
  return <Inicio cfg={cfg} />;
}

function Inicio({ cfg }: { cfg: PortalConfig }) {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [caidas, setCaidas] = useState<string[]>([]);
  const [cargando, setCargando] = useState(false);
  const [ultima, setUltima] = useState<Date | null>(null);
  const tuvoManifest = useRef(false);

  const [conexiones, setConexiones] = useState<Slot<Connection[]>>({ t: "cargando" });
  const [aprob, setAprob] = useState<Slot<Approval[]>>({ t: "cargando" });
  const [tareas, setTareas] = useState<Slot<Ticket[]>>({ t: "cargando" });
  const [eventos, setEventos] = useState<Slot<Evento[]>>({ t: "cargando" });
  const [artefactos, setArtefactos] = useState<Slot<ArtifactMeta[]>>({ t: "cargando" });
  const [archivos, setArchivos] = useState<Slot<Archivo[]>>({ t: "cargando" });
  const [uso, setUso] = useState<Slot<Uso>>({ t: "cargando" });
  const [flujos, setFlujos] = useState<Slot<Flujo[]>>({ t: "cargando" });

  const cargar = useCallback((silencioso = false) => {
    if (!silencioso) {
      setFatal(null);
      setConexiones({ t: "cargando" });
      setAprob({ t: "cargando" });
      setTareas({ t: "cargando" });
      setEventos({ t: "cargando" });
      setArtefactos({ t: "cargando" });
      setArchivos({ t: "cargando" });
      setUso({ t: "cargando" });
      setFlujos({ t: "cargando" });
    }
    setCargando(true);

    // Cada fuente es independiente: pinta apenas llega y, si se cae, se lleva
    // sólo su bloque. Nada de esperar a la más lenta para mostrar algo.
    const caidos: string[] = [];
    const pedir = <T,>(
      habilitado: boolean,
      nombre: string,
      traer: () => Promise<T>,
      set: Setter<T>,
    ): Promise<void> => {
      if (!habilitado) { set({ t: "off" }); return Promise.resolve(); }
      return traer().then(
        (data) => { set({ t: "listo", data }); },
        (e: unknown) => {
          if (es404(e)) { set({ t: "off" }); return; } // el agente no expone esto
          caidos.push(nombre);
          // Si ya teníamos datos, los dejamos: viejos, pero ciertos.
          set((s) => (s.t === "listo" ? s : { t: "falla" }));
        },
      );
    };

    getManifest(cfg)
      .then((m) => {
        tuvoManifest.current = true;
        setManifest(m);
        setFatal(null);
        const on = (k: string) => Boolean(m?.modules?.[k]);
        return Promise.allSettled([
          // Solo hace falta pedirlas si el adapter dice que hay pendientes.
          pedir(on("connections") && (m?.conexiones_pendientes ?? 0) > 0, "las conexiones",
            () => getConnections(cfg).then((r) => arr<Connection>(r?.conexiones)), setConexiones),
          pedir(on("approvals"), "las aprobaciones",
            () => getApprovals(cfg).then((r) => arr<Approval>(r?.approvals)), setAprob),
          pedir(on("kanban"), "el tablero",
            () => getTickets(cfg).then((r) => arr<Ticket>(r?.tickets)), setTareas),
          pedir(on("activity"), "la actividad",
            () => getActivity(cfg).then((r) => arr<Evento>(r?.events)), setEventos),
          pedir(on("artifacts"), "los artefactos",
            () => getArtifacts(cfg).then((r) => arr<ArtifactMeta>(r?.artifacts)), setArtefactos),
          pedir(on("files"), "los archivos",
            () => getFiles(cfg).then((r) => arr<Archivo>(r?.files)), setArchivos),
          pedir(on("usage"), "el consumo",
            () => getUsage(cfg).then((r) => (r ?? {}) as Uso), setUso),
          pedir(on("flujos"), "tus trabajos",
            () => getFlujos(cfg).then((r) => arr<Flujo>(r?.flujos)), setFlujos),
        ]);
      })
      .then(() => { setCaidas(caidos); setUltima(new Date()); })
      .catch((e: Error) => {
        // Sin manifest no sabemos qué existe: ahí sí es la pantalla entera.
        if (!silencioso || !tuvoManifest.current) setFatal(e.message || "error");
      })
      .finally(() => setCargando(false));
  }, [cfg]);

  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => {
    const id = setInterval(() => cargar(true), REFRESH_MS);
    return () => clearInterval(id);
  }, [cargar]);

  // ── derivados ──
  const tablero = useMemo(() => {
    if (tareas.t !== "listo") return null;
    const c = { porHacer: 0, curso: 0, esperando: 0, hechas: 0 };
    for (const t of tareas.data) c[columna(t.status)]++;
    return { ...c, total: tareas.data.length };
  }, [tareas]);

  const ultimos = useMemo(() => {
    if (eventos.t !== "listo") return null;
    // Una tarea deja varios eventos seguidos (creada, comentada, frenada) y
    // acá se veían como cinco renglones idénticos: el cliente lee "cuatro
    // veces la misma cosa" y deja de confiar en los números. En el resumen
    // del día alcanza con lo último que le pasó a cada cosa; el detalle
    // completo, con su estado, sigue en Actividad.
    const vistos = new Set<string>();
    return [...eventos.data]
      .sort((a, b) => toMs(b.ts) - toMs(a.ts))
      .filter((e) => {
        const k = `${e.kind}|${(e.label || "").trim().toLowerCase()}`;
        if (vistos.has(k)) return false;
        vistos.add(k);
        return true;
      })
      .slice(0, 5);
  }, [eventos]);

  const recientes = useMemo(() => {
    if (artefactos.t !== "listo") return null;
    return [...artefactos.data]
      .sort((a, b) => toMs(b.created_at) - toMs(a.created_at))
      .slice(0, 3);
  }, [artefactos]);

  const entregables = useMemo(() => {
    if (archivos.t !== "listo") return null;
    return archivos.data
      .filter((f) => (f.path || "").replace(/^\/+/, "").startsWith(ENTREGABLES))
      .sort((a, b) => toMs(b.mtime) - toMs(a.mtime))
      .slice(0, 3);
  }, [archivos]);

  const costo = useMemo(() => {
    if (uso.t !== "listo" || uso.data.available === false) return null;
    const c = num(uso.data.cost_usd);
    if (c === null) return null;
    return { costo: c, sesiones: num(uso.data.sessions), periodo: periodo(uso.data.period) };
  }, [uso]);

  const ultimaSenal = ultimos && ultimos.length > 0 ? hace(ultimos[0].ts) : null;

  // ── El agentito como indicador de estado ──
  // Lazy y no en un efecto: si no, el primer frame lo pinta con el look por
  // defecto y se ve un parpadeo violeta antes del look del cliente.
  const [look] = useState(loadAgentLook);

  const pendientes = aprob.t === "listo" ? aprob.data.length : null;
  // "tranquilo" solo si sabemos que no hay nada; si el dato no llegó, ni ahí.
  const estadoAgente: EstadoAgentito =
    pendientes === null ? "normal" : pendientes > 0 ? "esperando" : "tranquilo";

  // Festeja cuando aparece algo nuevo que produjo (artefacto o entregable).
  // La primera carga no cuenta: ahí todavía no hizo nada, solo nos enteramos.
  const producido = useMemo(() => {
    if (artefactos.t !== "listo" || archivos.t !== "listo") return null;
    const entregas = archivos.data.filter(
      (f) => (f.path || "").replace(/^\/+/, "").startsWith(ENTREGABLES)).length;
    return artefactos.data.length + entregas;
  }, [artefactos, archivos]);
  const [festejos, setFestejos] = useState(0);
  const producidoPrevio = useRef<number | null>(null);
  useEffect(() => {
    if (producido === null) return;
    if (producidoPrevio.current !== null && producido > producidoPrevio.current) {
      setFestejos((f) => f + 1);
    }
    producidoPrevio.current = producido;
  }, [producido]);

  if (fatal) {
    return (
      <div className={WRAP}>
        <PageHeader title={saludo()} />
        <ErrorState message={fatal} onRetry={() => cargar()} />
      </div>
    );
  }

  if (!manifest) return <div className={WRAP}><Spinner /></div>;

  const slots = [aprob, tareas, eventos, artefactos, archivos, uso, flujos];
  const esperando = slots.some((s) => s.t === "cargando");
  const nada = slots.every((s) => s.t === "off" || s.t === "falla");

  // Línea de estado: dice lo que sabemos y nada más.
  const linea = [`${agentDisplayName(manifest)}, tu agente`];
  if (ultimaSenal) linea.push(`última actividad ${ultimaSenal}`);
  else if (esperando) linea.push("buscando novedades…");

  const bloquesProducido = [
    recientes && recientes.length > 0 ? "artefactos" : null,
    entregables && entregables.length > 0 ? "entregables" : null,
  ].filter(Boolean);

  return (
    <div className={WRAP}>
      {/* El agentito acá no decora: dice cómo viene la mano. Si algo espera tu
          ok mira hacia el badge; si no hay nada, se ceba unos mates. */}
      <div className="mb-6 flex items-start gap-3 sm:gap-4">
        {/* El tamaño va acá afuera, no en el componente: el placeholder de
            next/dynamic no recibe className y quedaría a pantalla completa. */}
        <div className="-mt-1 h-16 w-16 shrink-0 sm:h-[72px] sm:w-[72px]">
          <AgentitoRive
            festejos={festejos}
            look={look}
            estado={estadoAgente}
            className="h-full w-full"
          />
        </div>
        <div className="min-w-0 flex-1">
          <PageHeader
            title={saludo()}
            subtitle={linea.join(" · ")}
            actions={
              <>
                {ultima && (
                  <span className="hidden text-xs tabular-nums text-ink-soft sm:inline">
                    Actualizado {hora(ultima)}
                  </span>
                )}
                <IconBtn label="Actualizar" disabled={cargando} onClick={() => cargar(true)}>
                  <RefreshCw className={`h-4 w-4 ${cargando ? "animate-spin" : ""}`} />
                </IconBtn>
              </>
            }
          />
        </div>
      </div>

      {nada ? (
        <EmptyState
          icon={Hand}
          title="Tu agente todavía no publica novedades"
          hint="Cuando habilite sus módulos, el resumen del día aparece acá."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {/* 0 · Si el flujo no puede arrancar, eso va antes que todo */}
          {conexiones.t === "listo" && (
            <ParaArrancar
              agente={manifest.agent}
              pendientes={conexiones.data.filter((c) => c.requerida && c.estado !== "conectado")}
            />
          )}

          {/* 1 · Lo que necesita tu atención, arriba de todo */}
          {aprob.t === "cargando" && <Esqueleto filas={2} />}
          {aprob.t === "listo" && <Atencion pendientes={aprob.data} />}

          {/* 1.5 · QUÉ HACE POR VOS. Faltaba y era lo primero que un cliente
              nuevo busca: "en ninguna pantalla dice qué hace esto por MÍ".
              No lo inventamos: son sus flujos, con el texto que ya está
              escrito para él. Si todavía no tiene ninguno, lo decimos y le
              mostramos por dónde se pide. */}
          {flujos.t === "listo" && <QueHace flujos={flujos.data} />}

          {/* 2 · Cómo viene el tablero */}
          {tareas.t === "cargando" && <Esqueleto filas={1} />}
          {tablero && (
            <Seccion titulo="Tablero" icon={Columns3} href="/app/pipeline" ver="Ver el tablero">
              {tablero.total === 0 ? (
                <Vacio>Todavía no hay tareas en el tablero.</Vacio>
              ) : (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Metrica valor={tablero.porHacer} label="Por hacer" tone="neutral" />
                  <Metrica valor={tablero.curso} label="En curso" tone="amber" />
                  <Metrica valor={tablero.esperando} label="Esperando tu ok" tone="violet" />
                  <Metrica valor={tablero.hechas} label="Completadas" tone="green" />
                </div>
              )}
            </Seccion>
          )}

          {/* 3 · Qué estuvo haciendo */}
          {eventos.t === "cargando" && <Esqueleto filas={4} />}
          {ultimos && (
            <Seccion titulo="Qué estuvo haciendo" icon={Activity} href="/app/actividad" ver="Ver todo">
              {ultimos.length === 0 ? (
                <Vacio>Todavía no registró actividad.</Vacio>
              ) : (
                <ul className="-my-1">
                  {ultimos.map((e, i) => (
                    <li key={`${e.ts}-${e.status}-${i}`} className="flex items-center gap-2.5 py-1.5">
                      <span className="shrink-0 whitespace-nowrap text-[12px] tabular-nums text-ink-soft">
                        {cuando(e.ts)}
                      </span>
                      <span className={`h-2 w-2 shrink-0 rounded-full ${dotCls(e.kind, e.status)}`} />
                      <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{e.label}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Seccion>
          )}

          {/* 4 · Lo último que produjo */}
          {(artefactos.t === "cargando" || archivos.t === "cargando") && <Esqueleto filas={3} />}
          {bloquesProducido.length > 0 && (
            <div className={`grid gap-3 ${bloquesProducido.length > 1 ? "md:grid-cols-2" : ""}`}>
              {recientes && recientes.length > 0 && (
                <Seccion titulo="Lo último que produjo" icon={LayoutDashboard} href="/app/artefactos" ver="Ver entregas">
                  <ul className="-my-1">
                    {recientes.map((a) => (
                      <li key={a.id} className="flex items-center gap-2 py-1.5">
                        <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{a.title}</span>
                        <span className="shrink-0">
                          <Chip tone={kindTone(a.kind)}>{kindLabel(a.kind)}</Chip>
                        </span>
                      </li>
                    ))}
                  </ul>
                </Seccion>
              )}

              {entregables && entregables.length > 0 && (
                <Seccion titulo="Archivos nuevos para vos" icon={FolderOpen} href="/app/archivos" ver="Ver archivos">
                  <ul className="-my-1">
                    {entregables.map((f) => (
                      <li key={f.path} className="flex items-center gap-2 py-1.5">
                        <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
                          {nombreEntregable(f.path)}
                        </span>
                        {hace(f.mtime) && (
                          <span className="shrink-0 whitespace-nowrap text-[11px] text-ink-soft">
                            {hace(f.mtime)}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </Seccion>
              )}
            </div>
          )}

          {/* 5 · Cuánto costó el período */}
          {uso.t === "cargando" && <Esqueleto filas={1} />}
          {costo && (
            <Seccion titulo="Consumo" icon={BarChart3} href="/app/uso" ver="Ver el detalle">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <p className="text-[32px] font-extrabold leading-none tabular-nums text-ink">
                  {usd(costo.costo)}
                </p>
                <p className="text-[12px] text-ink-soft">
                  {costo.sesiones !== null && sesiones(costo.sesiones)}
                  {costo.sesiones !== null && costo.periodo ? " · " : ""}
                  {costo.periodo}
                </p>
              </div>
            </Seccion>
          )}
        </div>
      )}

      {/* 6 · Accesos rápidos */}
      {(manifest.modules?.chat || manifest.modules?.kanban) && (
        <div className="mt-4 flex flex-wrap gap-2">
          {manifest.modules?.chat && (
            <LinkBtn href="/app/chat">
              <MessageSquare className="h-4 w-4" />
              Hablar con el agente
            </LinkBtn>
          )}
          {manifest.modules?.kanban && (
            <LinkBtn kind="secondary" href="/app/pipeline">
              <Plus className="h-4 w-4" />
              Nueva tarea
            </LinkBtn>
          )}
        </div>
      )}

      {caidas.length > 0 && (
        <p className="mt-4 text-[12px] text-ink-soft">
          Recién no pude traer {enumerar(caidas)}. Te muestro el resto de lo que tengo.
        </p>
      )}
    </div>
  );
}
