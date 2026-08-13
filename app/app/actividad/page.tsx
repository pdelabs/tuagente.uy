"use client";

// Actividad: todo lo que hizo el agente, en orden cronológico.
// Contrato (adapter v0.3): GET {adapter}/portal/activity →
//   { events: [{ ts, kind: "job_run" | "ticket", label, status }] }
// Agrupado por día (Hoy/Ayer/fecha), refresh silencioso cada 30 s.
//
// Los eventos de ticket traen el TÍTULO del ticket pero no su id: lo
// resolvemos cruzando contra /portal/tickets (mapa título→id, se trae una vez
// y se refresca sólo a pedido). Si el ticket no está en esa lista —archivado o
// borrado— el evento no es clicable y no mostramos nada raro.
//
// POR QUÉ ESTA PANTALLA DECÍA "TODAVÍA NO HAY ACTIVIDAD" (QA a ciegas, 12/8).
// Una contadora armó tres flujos y le hizo escribir tres documentos, entró acá
// y leyó "Todavía no hay actividad. Cuando tu agente haga algo, lo vas a ver
// acá". Su conclusión fue peor que el bug: "si la bitácora me miente cuando
// estoy mirando, no la voy a creer cuando no estoy".
//
// No era una consulta rota: `/portal/activity` tiene DOS fuentes y solo dos —
// las corridas de crons (`executions`) y los eventos del tablero
// (`task_events`). Ella no tenía ninguna de las dos: sus flujos todavía no
// habían corrido (primera corrida el 17/08) y su tablero estaba vacío. Todo lo
// que su agente hizo lo hizo conversando: escribir archivos y dejar flujos
// armados NO deja fila en ninguna de esas dos tablas. Verificado el 13/8 contra
// el agente del laboratorio: `/portal/activity` devolvía UN evento mientras
// `/portal/files` tenía cuatro archivos y la sesión 128 mensajes.
//
// Se arregla sin tocar el agente: las otras dos fuentes ya las publica y el
// portal ya las usa en otras pestañas. Acá se suman a la misma línea de tiempo
// —lo que escribió (`/portal/files`) y cuándo hablaron (`/api/sessions`)— para
// que la bitácora no pueda estar vacía mientras hubo trabajo.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Activity, ChevronRight, RefreshCw, Search } from "lucide-react";
import {
  getActivity,
  getFiles,
  getFlujos,
  getJobs,
  getSessions,
  getTickets,
  loadConfig,
  type CronJob,
  type Flujo,
  type PortalConfig,
} from "../lib/agent";
import { EntityProvider } from "../lib/EntityViewer";
import { useOpenEntity } from "../lib/entities";
import {
  Btn, Card, Chip, EmptyState, ErrorState, IconBtn, PageHeader, SOPORTE, Spinner, inputCls,
} from "../lib/ui";
import {
  esEventoDeMaquina, husoDe, isoConHuso, leerFalla, momento, rotuloCanal, rotuloEvento,
} from "../lib/palabras";

type ActivityEvent = {
  ts: string;
  kind: string;
  label: string;
  status: string;
  /** Adónde lleva la fila (un flujo, un archivo). Los tickets van por `ticketId`. */
  href?: string;
  /** Por qué no pudo, en criollo. Solo en las corridas que fallaron. */
  porQue?: string;
};
/** Los status crudos del adapter son muchos; para filtrar alcanzan tres. */
type Grupo = "ok" | "error" | "curso";
type RangoKey = "hoy" | "7d" | "30d" | "todo";

const REFRESH_MS = 30_000;
const PAGINA = 30; // eventos por tanda
const WRAP = "mx-auto max-w-4xl px-6 py-6 md:px-8";

// Kind crudo del adapter → rótulo legible (los chips salen de los datos).
// `archivo` y `conversacion` los arma el portal: ver la nota de arriba.
const KIND_LABEL: Record<string, string> = {
  job_run: "Trabajo automático",
  ticket: "Tarea",
  archivo: "Documento",
  conversacion: "Conversación",
};

// El estado viene crudo del motor y en inglés. Ahora sale del diccionario
// único del portal (`lib/palabras.ts`), el mismo que usan el historial del
// ticket y el chat: una sola palabra por cosa en todo el producto.
const estadoLabel = (s: string) => rotuloEvento(s);

const GRUPOS: { key: Grupo; label: string; dot: [string, string] }[] = [
  // dot: [inactivo, activo] — sobre el chip activo (fondo ink) va el tono claro.
  { key: "ok", label: "Bien", dot: ["bg-c-green-ink", "bg-c-green"] },
  { key: "error", label: "Con error", dot: ["bg-c-coral-ink", "bg-c-coral"] },
  { key: "curso", label: "En curso", dot: ["bg-c-amber-ink", "bg-c-amber"] },
];

const RANGOS: { key: RangoKey; label: string; dias: number | null }[] = [
  { key: "hoy", label: "Hoy", dias: 1 },
  { key: "7d", label: "7 días", dias: 7 },
  { key: "30d", label: "30 días", dias: 30 },
  { key: "todo", label: "Todo", dias: null },
];

/** Estado crudo → uno de los tres grupos, o ninguno (eventos informativos). */
function grupoDe(status: string): Grupo | null {
  const s = (status || "").toLowerCase();
  if (/(^ok$|complet|success|done|deliver|sent|unblock|resolv|entregad|listo)/.test(s)) return "ok";
  if (/(fail|error|timeout|cancel|reject|rechaz)/.test(s)) return "error";
  if (/(run|progress|pend|claim|start|queue|block|curso|proceso)/.test(s)) return "curso";
  return null;
}

// Puntito de estado: verde OK · coral falla · ámbar en curso ·
// violeta evento de ticket neutral · gris resto.
function dotCls(kind: string, status: string): string {
  const g = grupoDe(status);
  if (g === "ok") return "bg-c-green-ink";
  if (g === "error") return "bg-c-coral-ink";
  if (g === "curso") return "bg-c-amber-ink";
  return kind === "ticket" ? "bg-c-violet-ink" : "bg-ink-soft/50";
}

/** Comparación insensible a mayúsculas, tildes y espacios de más. */
const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();

const msDe = (ts: string) => {
  const t = new Date(ts).getTime();
  return Number.isNaN(t) ? 0 : t;
};

/** Hermes emite created_at como epoch en segundos; el contrato admite string. */
function creadoMs(value: string | number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (Number.isFinite(n) && n > 0) return n > 1e12 ? n : n * 1000;
  const d = new Date(String(value)).getTime();
  return Number.isNaN(d) ? 0 : d;
}

/** Desde cuándo mostrar: "7 días" son 7 días calendario contando hoy. */
function desdeRango(key: RangoKey): number | null {
  const dias = RANGOS.find((r) => r.key === key)?.dias;
  if (!dias) return null;
  const hoy = new Date();
  return new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - (dias - 1)).getTime();
}

// La hora y el día son los del NEGOCIO, no los del browser: la corrida de las
// 02:37 en Montevideo no puede aparecer bajo "Ayer 23:37" porque quien mira
// abrió el portal desde otro huso. Ver la nota larga en `lib/palabras.ts`.
function hourLabel(ts: string): string {
  return momento(ts)?.hora ?? "—";
}

function dayKey(ts: string): string {
  const m = momento(ts);
  return m ? String(m.dias) : "—";
}

function dayLabel(ts: string): string {
  const m = momento(ts);
  if (!m) return "Sin fecha";
  if (m.dias === 0) return "Hoy";
  if (m.dias === -1) return "Ayer";
  return m.fechaCorta;
}

const is404 = (msg: string) => /^404\b/.test(msg);

/* ── Las fuentes que faltaban ─────────────────────────────────────────────── */

const SCRIPT_EXT = /\.(py|sh|bash|zsh|rb|pl|js|mjs|cjs|ts|tsx|jsx|ipynb)$/i;
const ENTRADA = "entrada/";

/** El nombre del archivo, sin fecha adelante ni carpeta atrás. */
const nombreArchivo = (path: string) => {
  const base = (path || "").split("/").pop() || path;
  return base.replace(/^\d{4}-\d{2}-\d{2}[-_ ]/, "").replace(/\.[a-z0-9]+$/i, "") || base;
};

/** Lo que el agente escribió, como eventos. El andamiaje (sus propios scripts,
 *  `interno/`) queda afuera: acá va lo que el cliente reconoce como trabajo. */
function eventosDeArchivos(
  files: { path: string; mtime: number }[] | null, huso: number,
): ActivityEvent[] {
  if (!files) return [];
  return files
    .filter((f) => {
      const p = f.path || "";
      return p && !p.startsWith("interno/") && !SCRIPT_EXT.test(p);
    })
    .slice(0, 60)
    .map((f) => ({
      ts: isoConHuso(f.mtime * 1000, huso),
      kind: "archivo",
      // Quién lo puso importa: `entrada/` es lo que sube el cliente, y decir
      // "tu agente escribió" sobre el CSV que subió ella sería mentir barato.
      label: (f.path.startsWith(ENTRADA) ? "Recibió " : "Escribió ") + `«${nombreArchivo(f.path)}»`,
      status: "",
      href: `/app/archivos?archivo=${encodeURIComponent(f.path)}`,
    }));
}

type SesionCruda = {
  id?: string; source?: string; started_at?: number; last_active?: number;
  message_count?: number; preview?: string;
};

// UNA CONVERSACIÓN ES ALGUIEN HABLANDO. El motor abre una "sesión" también para
// correr un cron y para que el agente trabaje un ticket solo; esas no son
// conversaciones de nadie y ya tienen su propia fila (la corrida del flujo, el
// evento del tablero). Listarlas acá ponía «Hablaron por Tareas programadas:
// "[IMPORTANT: You are running as a scheduled cron job…"» en la pantalla de una
// veterinaria: el prompt interno, en inglés, presentado como una charla suya.
const CANALES_HUMANOS = new Set([
  "api_server", "portal", "api", "telegram", "whatsapp", "discord", "signal",
]);

/** Cada conversación, una línea. Una sesión de 128 mensajes es UN hecho para el
 *  cliente ("hablamos el martes"), no ciento veintiocho. */
function eventosDeSesiones(sesiones: SesionCruda[] | null, huso: number): ActivityEvent[] {
  if (!sesiones) return [];
  return sesiones
    .filter((s) =>
      (s.message_count ?? 0) > 0
      && (s.started_at || s.last_active)
      && CANALES_HUMANOS.has((s.source ?? "").trim().toLowerCase()))
    .slice(0, 40)
    .map((s) => {
      // Los avisos que el portal le inyecta al agente empiezan con un rótulo
      // entre corchetes («[Aviso del portal] … ticket t_b2dd6735») y traen ids
      // que el cliente no puede buscar en ningún lado. No son lo que él
      // escribió: el renglón se queda sin cita antes que con esa.
      const p = (s.preview ?? "").trim();
      const cita = p && !p.startsWith("[") ? `: «${p.slice(0, 70)}…»` : "";
      return {
        ts: isoConHuso((s.started_at ?? s.last_active ?? 0) * 1000, huso),
        kind: "conversacion",
        label: `Conversación por ${rotuloCanal(s.source ?? "")}${cita}`,
        status: "",
        href: s.id ? `/app/chat?sesion=${encodeURIComponent(s.id)}` : undefined,
      };
    });
}

/** Las corridas de los flujos, con el nombre que les puso el cliente.
 *
 *  «flujo-vacunas-vencidas-semanal · No pudo» era la línea que a la veterinaria
 *  le reveló la falla, y también la única que no podía abrir para ver por qué.
 *  Ahora dice el nombre del flujo, cuenta el motivo en criollo y lleva a la
 *  pantalla donde se puede pausar o volver a probar. */
function humanizarCorridas(
  evs: ActivityEvent[], flujos: Flujo[] | null, jobs: CronJob[] | null,
): ActivityEvent[] {
  if (!flujos?.length) return evs;
  const porNombreDeJob = new Map<string, Flujo>();
  for (const f of flujos) porNombreDeJob.set(`flujo-${f.slug}`, f);
  return evs.map((ev) => {
    if (ev.kind !== "job_run") return ev;
    const f = porNombreDeJob.get((ev.label || "").trim());
    if (!f) return ev;
    const job = jobs?.find((j) => (j.name || "").trim() === `flujo-${f.slug}`);
    // El error del motor es el de la ÚLTIMA corrida: solo se le puede atribuir
    // a esta fila si esta fila ES la última. Colgárselo a una vieja sería
    // inventar.
    const esLaUltima = Boolean(
      job?.last_run_at && ev.ts && Math.abs(msDe(job.last_run_at) - msDe(ev.ts)) < 120_000);
    const fallo = /(fail|error|timeout|cancel)/i.test(ev.status || "");
    return {
      ...ev,
      label: f.nombre,
      href: `/app/flujos/${encodeURIComponent(f.slug)}`,
      porQue: fallo && esLaUltima ? leerFalla(job?.last_error).que : undefined,
    };
  });
}

function FiltroChip({ activo, onClick, count, children }: {
  activo: boolean;
  onClick: () => void;
  count?: number;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={activo}
      className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold transition ${
        activo
          ? "bg-ink text-white"
          : "bg-black/[0.05] text-ink-soft hover:bg-black/[0.08] hover:text-ink"
      }`}
    >
      {children}
      {count !== undefined && (
        <span className={activo ? "tabular-nums text-white/60" : "tabular-nums text-ink-soft/60"}>
          {count}
        </span>
      )}
    </button>
  );
}

function Caption({ children }: { children: ReactNode }) {
  return (
    <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-soft/70">
      {children}
    </span>
  );
}

/** Una línea del historial. Con ticketId o con href, toda la fila abre algo. */
function Fila({ ev, ticketId, veces = 1 }: {
  ev: ActivityEvent; ticketId?: string; veces?: number;
}) {
  const open = useOpenEntity();
  const cuerpo = (
    <>
      <span className="w-12 shrink-0 text-[12px] tabular-nums text-ink-soft">
        {hourLabel(ev.ts)}
      </span>
      <span className={`mt-1.5 h-2 w-2 shrink-0 self-start rounded-full ${dotCls(ev.kind, ev.status)}`} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-ink">{ev.label}</span>
        {/* La línea que la veterinaria no podía abrir. Ahora el motivo está
            escrito acá mismo, en criollo, sin tener que ir a buscarlo. */}
        {ev.porQue && (
          <span className="block truncate text-[12px] text-c-coral-ink">{ev.porQue}</span>
        )}
      </span>
      <span className="flex shrink-0 items-center gap-2 self-start pt-0.5">
        <Chip>{KIND_LABEL[ev.kind] ?? ev.kind}</Chip>
        {ev.status && (
          <span className="text-[11px] text-ink-soft">
            {estadoLabel(ev.status)}
            {veces > 1 && <span className="ml-1 tabular-nums text-ink-soft/70">×{veces}</span>}
          </span>
        )}
      </span>
    </>
  );

  const FILA = "flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-black/[0.03]";

  if (ticketId && open) {
    return (
      <li>
        <button onClick={() => open({ kind: "ticket", id: ticketId })} title="Ver la tarea" className={FILA}>
          {cuerpo}
          <ChevronRight className="h-4 w-4 shrink-0 self-start text-ink-soft/50" />
        </button>
      </li>
    );
  }

  if (ev.href) {
    return (
      <li>
        <Link href={ev.href} className={FILA}>
          {cuerpo}
          <ChevronRight className="h-4 w-4 shrink-0 self-start text-ink-soft/50" />
        </Link>
      </li>
    );
  }

  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      {cuerpo}
      {/* mismo ancho que el chevron: las columnas quedan alineadas */}
      <span className="w-4 shrink-0" />
    </li>
  );
}

export default function ActividadPage() {
  const [cfg, setCfg] = useState<PortalConfig | null>(null);
  useEffect(() => { setCfg(loadConfig()); }, []);

  // El layout se encarga del login cuando no hay config.
  if (!cfg) return <div className={WRAP}><Spinner /></div>;
  return (
    <EntityProvider cfg={cfg}>
      <Actividad cfg={cfg} />
    </EntityProvider>
  );
}

function Actividad({ cfg }: { cfg: PortalConfig }) {
  const [events, setEvents] = useState<ActivityEvent[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null); // falló un refresh, hay datos viejos
  const [cargando, setCargando] = useState(false);
  const [ultima, setUltima] = useState<Date | null>(null);
  const [ticketIds, setTicketIds] = useState<Map<string, string>>(new Map());
  // Las fuentes que el adapter no mezcla en /portal/activity. Ninguna es
  // obligatoria: si alguna falla, la línea de tiempo pierde ese renglón y sigue.
  const [archivos, setArchivos] = useState<{ path: string; mtime: number }[] | null>(null);
  const [sesiones, setSesiones] = useState<SesionCruda[] | null>(null);
  const [flujos, setFlujos] = useState<Flujo[] | null>(null);
  const [jobs, setJobs] = useState<CronJob[] | null>(null);
  const hasData = useRef(false);

  const [kind, setKind] = useState<string | null>(null);
  const [grupo, setGrupo] = useState<Grupo | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [rango, setRango] = useState<RangoKey>("todo");
  const [limite, setLimite] = useState(PAGINA);
  const [verTecnico, setVerTecnico] = useState(false);

  const load = useCallback((silent = false) => {
    if (!silent) { setEvents(null); setErr(null); }
    setCargando(true);
    getActivity(cfg)
      .then((r) => {
        hasData.current = true;
        setEvents(Array.isArray(r.events) ? r.events : []);
        setErr(null);
        setAviso(null);
        setUltima(new Date());
      })
      .catch((e: Error) => {
        // En refresh silencioso, si ya tenemos datos, los mantenemos.
        if (!silent || !hasData.current) setErr(e.message || "error");
        else setAviso(e.message || "error");
      })
      .finally(() => setCargando(false));
  }, [cfg]);

  // Mapa título→id para poder abrir el ticket que originó cada evento.
  // Si el módulo de tickets no está o falla, simplemente no hay links.
  const loadTickets = useCallback(() => {
    getTickets(cfg)
      .then((r) => {
        const lista = Array.isArray(r.tickets) ? r.tickets : [];
        // Más nuevo primero: ante títulos repetidos gana el ticket reciente.
        const orden = [...lista].sort((a, b) => creadoMs(b.created_at) - creadoMs(a.created_at));
        const m = new Map<string, string>();
        for (const t of orden) {
          const k = norm(t.title || "");
          if (k && !m.has(k)) m.set(k, t.id);
        }
        setTicketIds(m);
      })
      .catch(() => { /* sin tickets no hay a dónde ir: queda como está */ });
  }, [cfg]);

  // Lo demás que hizo el agente. Cada una por su lado y sin romper nada: un
  // agente viejo que no publique alguna de estas simplemente aporta menos.
  const loadExtras = useCallback(() => {
    getFiles(cfg).then((r) => setArchivos(Array.isArray(r?.files) ? r.files : [])).catch(() => {});
    getSessions(cfg)
      .then((r) => setSesiones(Array.isArray(r?.data) ? r.data : []))
      .catch(() => {});
    getFlujos(cfg).then((r) => setFlujos(r?.flujos ?? [])).catch(() => {});
    getJobs(cfg).then((r) => setJobs(Array.isArray(r?.jobs) ? r.jobs : [])).catch(() => {});
  }, [cfg]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadTickets(); }, [loadTickets]);
  useEffect(() => { loadExtras(); }, [loadExtras]);

  useEffect(() => {
    const t = setInterval(() => { load(true); loadExtras(); }, REFRESH_MS);
    return () => clearInterval(t);
  }, [load, loadExtras]);

  const refrescar = useCallback(
    () => { load(true); loadTickets(); loadExtras(); },
    [load, loadTickets, loadExtras],
  );

  // Al cambiar cualquier filtro, volvemos a la primera tanda.
  useEffect(() => { setLimite(PAGINA); }, [kind, grupo, busqueda, rango]);

  // LA PANTALLA DECÍA "todo lo que tu agente hizo, en orden" y mostraba doce
  // renglones idénticos de la misma tarea con `dependency_wait / spawned /
  // promoted / heartbeat`. El QA lo leyó como "se colgó, y encima no entiendo
  // nada". Los pasos de máquina quedan detrás de un interruptor.
  // En qué reloj vive el agente. Lo dicen sus propias fechas (vienen con huso);
  // los `mtime` de los archivos y las sesiones, no, así que se lo prestamos.
  const huso = useMemo(() => {
    for (const e of events ?? []) { const o = husoDe(e.ts); if (o !== null) return o; }
    for (const j of jobs ?? []) {
      const o = husoDe(j.next_run_at) ?? husoDe(j.last_run_at);
      if (o !== null) return o;
    }
    return -new Date().getTimezoneOffset();
  }, [events, jobs]);

  const todos = useMemo(
    () => [
      ...humanizarCorridas(events ?? [], flujos, jobs),
      ...eventosDeArchivos(archivos, huso),
      ...eventosDeSesiones(sesiones, huso),
    ].sort((a, b) => msDe(b.ts) - msDe(a.ts)),
    [events, flujos, jobs, archivos, sesiones, huso],
  );
  const tecnicos = useMemo(
    () => todos.filter((e) => esEventoDeMaquina(e.status)).length, [todos]);
  const ordenados = useMemo(
    () => (verTecnico ? todos : todos.filter((e) => !esEventoDeMaquina(e.status))),
    [todos, verTecnico],
  );

  // Tipos disponibles: los que realmente vinieron, ordenados por rótulo.
  const kinds = useMemo(() => {
    const set = new Set(ordenados.map((e) => e.kind).filter(Boolean));
    return Array.from(set).sort((a, b) =>
      (KIND_LABEL[a] ?? a).localeCompare(KIND_LABEL[b] ?? b, "es"),
    );
  }, [ordenados]);

  const gruposPresentes = useMemo(() => {
    const set = new Set(ordenados.map((e) => grupoDe(e.status)).filter(Boolean));
    return GRUPOS.filter((g) => set.has(g.key));
  }, [ordenados]);

  // Fecha + búsqueda primero: sobre esa base contamos los chips.
  const base = useMemo(() => {
    const desde = desdeRango(rango);
    const q = norm(busqueda);
    return ordenados.filter((e) => {
      if (desde !== null && msDe(e.ts) < desde) return false;
      if (q && !norm(e.label || "").includes(q)) return false;
      return true;
    });
  }, [ordenados, rango, busqueda]);

  const porGrupo = useMemo(
    () => (grupo ? base.filter((e) => grupoDe(e.status) === grupo) : base),
    [base, grupo],
  );
  const porKind = useMemo(
    () => (kind ? base.filter((e) => e.kind === kind) : base),
    [base, kind],
  );
  const visibles = useMemo(
    () =>
      base.filter(
        (e) => (!kind || e.kind === kind) && (!grupo || grupoDe(e.status) === grupo),
      ),
    [base, kind, grupo],
  );

  const mostrados = useMemo(() => visibles.slice(0, limite), [visibles, limite]);
  const filtrando = kind !== null || grupo !== null || busqueda.trim() !== "" || rango !== "todo";
  const limpiar = () => { setKind(null); setGrupo(null); setBusqueda(""); setRango("todo"); };

  // Y lo repetido se junta: la misma tarea con el mismo estado seguido son un
  // renglón con "×3", no tres renglones que parecen un bucle.
  const grupos = useMemo(() => {
    const out: { key: string; label: string; items: { ev: ActivityEvent; veces: number }[] }[] = [];
    for (const ev of mostrados) {
      const key = dayKey(ev.ts);
      let last = out[out.length - 1];
      if (!last || last.key !== key) {
        out.push({ key, label: dayLabel(ev.ts), items: [] });
        last = out[out.length - 1];
      }
      const previo = last.items[last.items.length - 1];
      if (previo && previo.ev.label === ev.label && previo.ev.status === ev.status
          && previo.ev.kind === ev.kind) {
        previo.veces += 1;
      } else {
        last.items.push({ ev, veces: 1 });
      }
    }
    return out;
  }, [mostrados]);

  const idDe = (ev: ActivityEvent) =>
    ev.kind === "ticket" ? ticketIds.get(norm(ev.label || "")) : undefined;

  if (err && is404(err)) {
    return (
      <div className={WRAP}>
        <PageHeader title="Actividad" subtitle="Todo lo que tu agente hizo, en orden" />
        <EmptyState
          icon={Activity}
          title="La actividad no está disponible en este agente"
          hint="Tu agente todavía no publica su historial de actividad."
        />
        <div className="flex justify-center">
          <Btn kind="ghost" size="sm" onClick={() => load()}>Reintentar</Btn>
        </div>
      </div>
    );
  }

  if (err) {
    return (
      <div className={WRAP}>
        <PageHeader title="Actividad" subtitle="Todo lo que tu agente hizo, en orden" />
        <ErrorState message={err} onRetry={() => load()} />
      </div>
    );
  }

  return (
    <div className={WRAP}>
      <PageHeader
        title="Actividad"
        subtitle="Todo lo que tu agente hizo, en orden"
        actions={
          <>
            {ultima && (
              <span className="hidden text-xs text-ink-soft sm:inline">
                Actualizado{" "}
                {ultima.toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit", hour12: false })}
              </span>
            )}
            <IconBtn label="Actualizar" disabled={cargando} onClick={refrescar}>
              <RefreshCw className={`h-4 w-4 ${cargando ? "animate-spin" : ""}`} />
            </IconBtn>
          </>
        }
      />

      {aviso && (
        <p className="mb-4 inline-flex items-center rounded-lg border border-c-coral bg-c-coral/40 px-3 py-1.5 text-[12px] font-medium text-c-coral-ink">
          No pude actualizar recién ({aviso}). Te muestro lo último que tengo.
        </p>
      )}

      {/* El vacío se mide sobre la línea de tiempo ENTERA, no sobre una de sus
          fuentes: decir "todavía no hay actividad" mirando solo los crons y el
          tablero es lo que hizo que esta pantalla se declarara vacía con tres
          documentos recién escritos al lado. */}
      {!events ? (
        <Spinner />
      ) : ordenados.length === 0 ? (
        <EmptyState
          icon={Activity}
          title="Todavía no hay actividad"
          hint="Cuando tu agente haga algo —escribir un documento, correr uno de tus trabajos— lo vas a ver acá."
        />
      ) : (
        <>
          <div className="mb-5 flex flex-col gap-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative w-full sm:w-64">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft/60" />
                <input
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                  placeholder="Buscar en la actividad…"
                  className={`${inputCls} pl-8`}
                />
              </div>
              <div className="flex-1" />
              <div className="inline-flex items-center gap-0.5 rounded-lg border border-black/10 bg-white p-0.5">
                {RANGOS.map((r) => (
                  <button
                    key={r.key}
                    onClick={() => setRango(r.key)}
                    aria-pressed={rango === r.key}
                    className={`rounded-md px-2 py-1 text-[12px] font-semibold transition ${
                      rango === r.key
                        ? "bg-ink text-white"
                        : "text-ink-soft hover:bg-black/[0.05] hover:text-ink"
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              {kinds.length > 1 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <Caption>Tipo</Caption>
                  <FiltroChip activo={kind === null} onClick={() => setKind(null)} count={porGrupo.length}>
                    Todos
                  </FiltroChip>
                  {kinds.map((k) => (
                    <FiltroChip
                      key={k}
                      activo={kind === k}
                      onClick={() => setKind(kind === k ? null : k)}
                      count={porGrupo.filter((e) => e.kind === k).length}
                    >
                      {KIND_LABEL[k] ?? k}
                    </FiltroChip>
                  ))}
                </div>
              )}

              {gruposPresentes.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <Caption>Estado</Caption>
                  <FiltroChip activo={grupo === null} onClick={() => setGrupo(null)} count={porKind.length}>
                    Todos
                  </FiltroChip>
                  {gruposPresentes.map((g) => {
                    const activo = grupo === g.key;
                    return (
                      <FiltroChip
                        key={g.key}
                        activo={activo}
                        onClick={() => setGrupo(activo ? null : g.key)}
                        count={porKind.filter((e) => grupoDe(e.status) === g.key).length}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${g.dot[activo ? 1 : 0]}`} />
                        {g.label}
                      </FiltroChip>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {visibles.length === 0 ? (
            <>
              <EmptyState
                icon={Activity}
                title="No hay eventos con estos filtros"
                hint="Probá ampliar el rango de fechas o limpiar la búsqueda."
              />
              <div className="flex justify-center">
                <Btn kind="ghost" size="sm" onClick={limpiar}>Limpiar filtros</Btn>
              </div>
            </>
          ) : (
            <>
              {/* Ver "falló" tres veces sin ninguna explicación deja al cliente
                  con la preocupación y sin nada que hacer con ella. No podemos
                  inventar la causa (el motor no la expone acá), pero sí decir
                  lo que SÍ sabemos: que no se pierde trabajo y quién lo mira. */}
              {grupo === "error" && (
                <p className="mb-4 rounded-lg border border-c-amber bg-c-amber/25 px-3 py-2 text-[13px] leading-relaxed text-c-amber-ink">
                  Que algo falle acá no significa que se haya perdido trabajo: las tareas
                  programadas se vuelven a intentar en la próxima corrida. Si una misma
                  falla se repite, la miramos nosotros.{" "}
                  <a
                    href={SOPORTE.whatsapp}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold underline underline-offset-2"
                  >
                    Escribinos si querés que la revisemos ahora
                  </a>.
                </p>
              )}
              <div className="flex flex-col gap-6">
                {grupos.map((g) => (
                  <section key={g.key}>
                    <h2 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
                      {g.label}
                    </h2>
                    <Card className="overflow-hidden !p-0">
                      <ul className="divide-y divide-black/[0.06]">
                        {g.items.map(({ ev, veces }, i) => (
                          <Fila
                            key={`${ev.ts}-${ev.status}-${i}`}
                            ev={ev}
                            veces={veces}
                            ticketId={idDe(ev)}
                          />
                        ))}
                      </ul>
                    </Card>
                  </section>
                ))}
              </div>

              {/* Los pasos internos del motor: existen, no se esconden, pero
                  no compiten con lo que el cliente vino a ver. */}
              {tecnicos > 0 && (
                <div className="mt-4 flex justify-center">
                  <button
                    onClick={() => setVerTecnico((v) => !v)}
                    className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12px] text-ink-soft transition hover:bg-black/[0.04] hover:text-ink"
                  >
                    {verTecnico
                      ? "Ocultar los pasos internos"
                      : `Ver los pasos internos de tu agente (${tecnicos})`}
                  </button>
                </div>
              )}

              <div className="mt-6 flex flex-col items-center gap-2">
                {mostrados.length < visibles.length ? (
                  <>
                    <Btn
                      kind="secondary"
                      size="sm"
                      onClick={() => setLimite((n) => n + PAGINA)}
                    >
                      Cargar más
                    </Btn>
                    <p className="text-[12px] text-ink-soft">
                      Mostrando {mostrados.length} de {visibles.length} eventos
                    </p>
                  </>
                ) : (
                  <p className="text-[12px] text-ink-soft">
                    {filtrando
                      ? `Estos son todos los eventos que coinciden (${visibles.length} de ${ordenados.length}).`
                      : `Estos son los últimos ${ordenados.length} eventos que guarda tu agente.`}
                  </p>
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
