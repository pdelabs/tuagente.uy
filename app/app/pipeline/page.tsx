"use client";

// Pipeline — kanban read-only de tickets del agente (GET {adapter}/portal/tickets)
// + detalle con comentarios (GET {adapter}/portal/tickets/{id}).
// GENÉRICO: títulos, tenants, estados, autores y eventos se muestran tal cual
// llegan; cero parseo de dominio. La prosa larga del agente (descripción y
// comentarios) viene en markdown y se dibuja con <Markdown> — el mismo renderer
// del chat, con HTML sanitizado. Las cards del tablero quedan en texto plano.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Inbox, RefreshCw, Search, SearchX, X } from "lucide-react";
import {
  loadConfig,
  getTickets,
  getTicketDetail,
  type PortalConfig,
  type Ticket,
  type TicketDetail,
} from "../lib/agent";
import {
  Chip,
  EmptyState,
  ErrorState,
  IconBtn,
  Modal,
  PageHeader,
  Spinner,
  inputCls,
} from "../lib/ui";
import Markdown from "../lib/Markdown";

const REFRESH_MS = 30_000;
const SIN_TENANT = "__sin_tenant__"; // sentinel para tickets con tenant null

type ColKey = "blocked" | "active" | "done";

const COLUMNS: {
  key: ColKey;
  label: string;
  chip: string;
  tone: "violet" | "amber" | "green";
  dot: string;
}[] = [
  { key: "blocked", label: "Esperando aprobación", chip: "Esperando aprobación", tone: "violet", dot: "bg-primary" },
  { key: "active", label: "En curso", chip: "En curso", tone: "amber", dot: "bg-c-amber-ink" },
  { key: "done", label: "Completados", chip: "Completado", tone: "green", dot: "bg-c-green-ink" },
];

// blocked y done tienen columna propia; ready, running y cualquier estado
// desconocido caen en "En curso" (no ocultamos tickets por un estado nuevo).
function columnOf(status: string): ColKey {
  if (status === "blocked") return "blocked";
  if (status === "done") return "done";
  return "active";
}

// created_at llega del adapter como epoch en SEGUNDOS (int), aunque a veces la
// lib lo tipa string. Acepto número, string numérico o fecha parseable.
function toDate(v: string | number): Date | null {
  const n = typeof v === "number" ? v : Number(v);
  if (Number.isFinite(n) && String(v).trim() !== "") return new Date(n > 1e12 ? n : n * 1000);
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Fecha relativa compacta; pasada una semana, fecha corta absoluta.
function fmtRelativa(v: string | number): string {
  const d = toDate(v);
  if (!d) return "";
  const min = Math.round((Date.now() - d.getTime()) / 60_000);
  if (min < 1) return "recién";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const dias = Math.round(h / 24);
  if (dias < 7) return dias === 1 ? "hace 1 día" : `hace ${dias} días`;
  const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = "numeric";
  return d.toLocaleDateString("es-UY", opts);
}

// Búsqueda insensible a mayúsculas y tildes.
function normalizar(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function FiltroTenant({ activo, onClick, children }: {
  activo: boolean; onClick: () => void; children: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={activo}
      className={`rounded-md px-2 py-0.5 text-[11px] font-semibold transition ${
        activo
          ? "bg-ink text-white"
          : "bg-black/[0.05] text-ink-soft hover:bg-black/[0.08] hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

export default function PipelinePage() {
  const [cfg] = useState<PortalConfig | null>(() => loadConfig());
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [ultima, setUltima] = useState<Date | null>(null);
  const [tenant, setTenant] = useState<string | null>(null); // null = todos
  const [busqueda, setBusqueda] = useState("");
  const [abierto, setAbierto] = useState<Ticket | null>(null);
  const [detalle, setDetalle] = useState<TicketDetail | null>(null);
  const [detalleError, setDetalleError] = useState(false);
  const [detalleCargando, setDetalleCargando] = useState(false);
  const enVuelo = useRef(false);

  const cargar = useCallback(async () => {
    if (!cfg || enVuelo.current) return;
    enVuelo.current = true;
    setCargando(true);
    try {
      const res = await getTickets(cfg);
      setTickets(res.tickets);
      setError(null);
      setUltima(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      enVuelo.current = false;
      setCargando(false);
    }
  }, [cfg]);

  useEffect(() => {
    cargar();
    const id = setInterval(cargar, REFRESH_MS);
    return () => clearInterval(id);
  }, [cargar]);

  // Detalle del ticket abierto (comentarios + historial).
  useEffect(() => {
    if (!abierto || !cfg) return;
    let vivo = true; // descarta respuestas de un ticket ya cerrado/cambiado
    setDetalle(null);
    setDetalleError(false);
    setDetalleCargando(true);
    getTicketDetail(cfg, abierto.id)
      .then((d) => { if (vivo) setDetalle(d); })
      .catch(() => { if (vivo) setDetalleError(true); })
      .finally(() => { if (vivo) setDetalleCargando(false); });
    return () => { vivo = false; };
  }, [abierto, cfg]);

  // Modal: cerrar con Escape y bloquear el scroll de fondo.
  useEffect(() => {
    if (!abierto) return;
    const fn = (e: KeyboardEvent) => e.key === "Escape" && setAbierto(null);
    window.addEventListener("keydown", fn);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", fn);
      document.body.style.overflow = "";
    };
  }, [abierto]);

  // Tenants presentes en los datos (nunca hardcodeados).
  const tenants = useMemo(() => {
    const set = new Set<string>();
    let sinTenant = false;
    for (const t of tickets ?? []) {
      if (t.tenant) set.add(t.tenant);
      else sinTenant = true;
    }
    const lista = Array.from(set).sort((a, b) => a.localeCompare(b));
    if (sinTenant) lista.push(SIN_TENANT);
    return lista;
  }, [tickets]);

  const visibles = useMemo(() => {
    const q = normalizar(busqueda.trim());
    return (tickets ?? []).filter((t) => {
      if (tenant === SIN_TENANT && t.tenant) return false;
      if (tenant && tenant !== SIN_TENANT && t.tenant !== tenant) return false;
      if (q && !normalizar(t.title).includes(q)) return false;
      return true;
    });
  }, [tickets, tenant, busqueda]);

  const porColumna = useMemo(() => {
    const m: Record<ColKey, Ticket[]> = { blocked: [], active: [], done: [] };
    for (const t of visibles) m[columnOf(t.status)].push(t);
    for (const k of Object.keys(m) as ColKey[]) {
      m[k].sort(
        (a, b) => (toDate(b.created_at)?.getTime() ?? 0) - (toDate(a.created_at)?.getTime() ?? 0),
      );
    }
    return m;
  }, [visibles]);

  const wrap = "mx-auto max-w-6xl px-6 py-6 md:px-8";

  if (!cfg) return <div className={wrap}><Spinner /></div>; // el layout muestra el login
  if (tickets === null && error)
    return <div className={wrap}><ErrorState message={error} onRetry={cargar} /></div>;
  if (tickets === null) return <div className={wrap}><Spinner /></div>;

  const colDe = (t: Ticket) => COLUMNS.find((c) => c.key === columnOf(t.status))!;
  // Historial más reciente primero, pase como pase del adapter.
  const eventos = detalle
    ? [...detalle.events].sort(
        (a, b) => (toDate(b.created_at)?.getTime() ?? 0) - (toDate(a.created_at)?.getTime() ?? 0),
      )
    : [];

  return (
    <div className={wrap}>
      <PageHeader
        title="Pipeline"
        subtitle="Lo que tu agente tiene entre manos."
        actions={
          <>
            {ultima && (
              <span className="hidden text-xs text-ink-soft sm:inline">
                Actualizado{" "}
                {ultima.toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
            <div className="relative w-56">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft/60" />
              <input
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Buscar por título…"
                className={`${inputCls} pl-8`}
              />
            </div>
            <IconBtn label="Actualizar" disabled={cargando} onClick={cargar}>
              <RefreshCw className={`h-4 w-4 ${cargando ? "animate-spin" : ""}`} />
            </IconBtn>
          </>
        }
      />

      {error && (
        <p className="mb-4 inline-flex items-center rounded-lg border border-c-coral bg-c-coral/40 px-3 py-1.5 text-[12px] font-medium text-c-coral-ink">
          No pude actualizar recién ({error}). Te muestro lo último que tengo.
        </p>
      )}

      {tickets.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="Todavía no hay tickets"
          hint="Cuando tu agente empiece a trabajar, los vas a ver acá."
        />
      ) : (
        <>
          {tenants.length > 0 && (
            <div className="mb-5 flex flex-wrap items-center gap-1.5">
              <FiltroTenant activo={tenant === null} onClick={() => setTenant(null)}>
                Todos
              </FiltroTenant>
              {tenants.map((t) => (
                <FiltroTenant
                  key={t}
                  activo={tenant === t}
                  onClick={() => setTenant(tenant === t ? null : t)}
                >
                  {t === SIN_TENANT ? "Sin etiqueta" : t}
                </FiltroTenant>
              ))}
            </div>
          )}

          {visibles.length === 0 ? (
            <EmptyState
              icon={SearchX}
              title="Ningún ticket coincide"
              hint="Probá con otra búsqueda o sacá el filtro."
            />
          ) : (
            <div className="grid items-start gap-4 md:grid-cols-3">
              {COLUMNS.map((col) => (
                <section key={col.key} className="rounded-xl bg-black/[0.02] p-2">
                  <div className="flex items-center gap-2 px-2 pb-2 pt-1.5">
                    <span className={`h-1.5 w-1.5 rounded-full ${col.dot}`} />
                    <h2 className="text-[12px] font-semibold text-ink">{col.label}</h2>
                    <span className="text-[12px] text-ink-soft">{porColumna[col.key].length}</span>
                  </div>
                  {porColumna[col.key].length === 0 ? (
                    <p className="px-2 py-3 text-center text-[12px] text-ink-soft">Sin tickets</p>
                  ) : (
                    <ul className="flex flex-col gap-1.5">
                      {porColumna[col.key].map((t) => (
                        <li key={t.id}>
                          <button
                            onClick={() => setAbierto(t)}
                            aria-haspopup="dialog"
                            className="block w-full rounded-lg border border-black/[0.07] bg-white p-3 text-left transition hover:border-primary/40"
                          >
                            <p className="line-clamp-3 text-[13px] font-medium leading-snug text-ink">
                              {t.title}
                            </p>
                            <div className="mt-2 flex flex-wrap items-center gap-1.5">
                              {t.tenant && <Chip tone="neutral">{t.tenant}</Chip>}
                              <span className="ml-auto text-[11px] text-ink-soft">
                                {fmtRelativa(t.created_at)}
                              </span>
                            </div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              ))}
            </div>
          )}
        </>
      )}

      {abierto && (
        <Modal wide onClose={() => setAbierto(null)}>
          <div className="flex items-start justify-between gap-4 border-b border-black/[0.07] px-5 py-4">
            <div className="min-w-0">
              <h2 className="text-base font-bold leading-snug text-ink">{abierto.title}</h2>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <Chip tone={colDe(abierto).tone}>{colDe(abierto).chip}</Chip>
                {abierto.tenant && <Chip tone="neutral">{abierto.tenant}</Chip>}
                <span className="text-[11px] text-ink-soft">{fmtRelativa(abierto.created_at)}</span>
              </div>
            </div>
            <IconBtn label="Cerrar" onClick={() => setAbierto(null)}>
              <X className="h-4 w-4" />
            </IconBtn>
          </div>

          {/* min-w-0: sin esto una tabla o un bloque de código ancho estira el
              modal en vez de scrollear dentro de su propio contenedor. */}
          <div className="min-w-0 overflow-y-auto px-5 py-4">
            {abierto.body?.trim() ? (
              <Markdown>{abierto.body}</Markdown>
            ) : (
              <p className="text-sm text-ink-soft">Este ticket no tiene descripción.</p>
            )}

            <h3 className="mb-2 mt-6 text-[12px] font-semibold uppercase tracking-wide text-ink-soft">
              Comentarios
            </h3>
            {detalleCargando ? (
              <Spinner />
            ) : detalleError ? (
              <p className="text-sm text-ink-soft">No pude cargar los comentarios.</p>
            ) : detalle && detalle.comments.length > 0 ? (
              <ul className="flex flex-col gap-4">
                {detalle.comments.map((c, i) => (
                  <li key={i} className="min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="text-[13px] font-semibold text-ink">{c.author}</span>
                      <span className="text-[11px] text-ink-soft">{fmtRelativa(c.created_at)}</span>
                    </div>
                    {c.body?.trim() ? (
                      <div className="mt-1">
                        <Markdown>{c.body}</Markdown>
                      </div>
                    ) : (
                      <p className="mt-1 text-sm text-ink-soft">(sin texto)</p>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-soft">Sin comentarios.</p>
            )}

            {eventos.length > 0 && (
              <>
                <h3 className="mb-2 mt-6 text-[12px] font-semibold uppercase tracking-wide text-ink-soft">
                  Historial
                </h3>
                <ul className="flex flex-col gap-1">
                  {eventos.map((e, i) => (
                    <li key={i} className="flex items-baseline gap-2 text-[12px] text-ink-soft">
                      <span className="font-medium">{e.kind}</span>
                      <span>{fmtRelativa(e.created_at)}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
