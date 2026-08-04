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

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Activity, ChevronRight, RefreshCw, Search } from "lucide-react";
import {
  getActivity,
  getTickets,
  loadConfig,
  type PortalConfig,
} from "../lib/agent";
import { EntityProvider } from "../lib/EntityViewer";
import { useOpenEntity } from "../lib/entities";
import {
  Btn, Card, Chip, EmptyState, ErrorState, IconBtn, PageHeader, Spinner, inputCls,
} from "../lib/ui";

type ActivityEvent = { ts: string; kind: string; label: string; status: string };
/** Los status crudos del adapter son muchos; para filtrar alcanzan tres. */
type Grupo = "ok" | "error" | "curso";
type RangoKey = "hoy" | "7d" | "30d" | "todo";

const REFRESH_MS = 30_000;
const PAGINA = 30; // eventos por tanda
const WRAP = "mx-auto max-w-4xl px-6 py-6 md:px-8";

// Kind crudo del adapter → rótulo legible (los chips salen de los datos).
const KIND_LABEL: Record<string, string> = {
  job_run: "Tarea programada",
  ticket: "Ticket",
};

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

function hourLabel(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit" });
}

function dayKey(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayLabel(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "Sin fecha";
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(new Date()) - startOf(d)) / 86_400_000);
  if (days === 0) return "Hoy";
  if (days === 1) return "Ayer";
  return d.toLocaleDateString("es-UY", { weekday: "long", day: "numeric", month: "long" });
}

const is404 = (msg: string) => /^404\b/.test(msg);

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

/** Una línea del historial. Con ticketId, toda la fila abre el detalle. */
function Fila({ ev, ticketId }: { ev: ActivityEvent; ticketId?: string }) {
  const open = useOpenEntity();
  const cuerpo = (
    <>
      <span className="w-12 shrink-0 text-[12px] tabular-nums text-ink-soft">
        {hourLabel(ev.ts)}
      </span>
      <span className={`h-2 w-2 shrink-0 rounded-full ${dotCls(ev.kind, ev.status)}`} />
      <p className="min-w-0 flex-1 truncate text-sm text-ink">{ev.label}</p>
      <span className="flex shrink-0 items-center gap-2">
        <Chip>{KIND_LABEL[ev.kind] ?? ev.kind}</Chip>
        {ev.status && <span className="text-[11px] text-ink-soft">{ev.status}</span>}
      </span>
    </>
  );

  if (!ticketId || !open) {
    return (
      <li className="flex items-center gap-3 px-4 py-2.5">
        {cuerpo}
        {/* mismo ancho que el chevron: las columnas quedan alineadas */}
        <span className="w-4 shrink-0" />
      </li>
    );
  }

  return (
    <li>
      <button
        onClick={() => open({ kind: "ticket", id: ticketId })}
        title="Ver el ticket"
        className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-black/[0.03]"
      >
        {cuerpo}
        <ChevronRight className="h-4 w-4 shrink-0 text-ink-soft/50" />
      </button>
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
  const hasData = useRef(false);

  const [kind, setKind] = useState<string | null>(null);
  const [grupo, setGrupo] = useState<Grupo | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [rango, setRango] = useState<RangoKey>("todo");
  const [limite, setLimite] = useState(PAGINA);

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

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadTickets(); }, [loadTickets]);

  useEffect(() => {
    const t = setInterval(() => load(true), REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  const refrescar = useCallback(() => { load(true); loadTickets(); }, [load, loadTickets]);

  // Al cambiar cualquier filtro, volvemos a la primera tanda.
  useEffect(() => { setLimite(PAGINA); }, [kind, grupo, busqueda, rango]);

  const ordenados = useMemo(
    () => [...(events ?? [])].sort((a, b) => msDe(b.ts) - msDe(a.ts)),
    [events],
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

  const grupos = useMemo(() => {
    const out: { key: string; label: string; items: ActivityEvent[] }[] = [];
    for (const ev of mostrados) {
      const key = dayKey(ev.ts);
      const last = out[out.length - 1];
      if (last && last.key === key) last.items.push(ev);
      else out.push({ key, label: dayLabel(ev.ts), items: [ev] });
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
                {ultima.toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit" })}
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

      {!events ? (
        <Spinner />
      ) : events.length === 0 ? (
        <EmptyState
          icon={Activity}
          title="Todavía no hay actividad"
          hint="Cuando tu agente haga algo, lo vas a ver acá."
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
              <div className="flex flex-col gap-6">
                {grupos.map((g) => (
                  <section key={g.key}>
                    <h2 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
                      {g.label}
                    </h2>
                    <Card className="overflow-hidden !p-0">
                      <ul className="divide-y divide-black/[0.06]">
                        {g.items.map((ev, i) => (
                          <Fila key={`${ev.ts}-${ev.status}-${i}`} ev={ev} ticketId={idDe(ev)} />
                        ))}
                      </ul>
                    </Card>
                  </section>
                ))}
              </div>

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
