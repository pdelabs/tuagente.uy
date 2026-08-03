"use client";

// Pipeline — kanban read-only de tickets del agente (GET {adapter}/portal/tickets).
// GENÉRICO: títulos, tenants y estados se muestran tal cual llegan; cero parseo
// de dominio. El body se renderiza como texto plano preformateado (anti-XSS).

import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadConfig, getTickets, type PortalConfig, type Ticket } from "../lib/agent";
import { Btn, Card, Chip, EmptyState, ErrorState, Spinner } from "../lib/ui";

const REFRESH_MS = 30_000;
const SIN_TENANT = "__sin_tenant__"; // sentinel para tickets con tenant null

type ColKey = "blocked" | "active" | "done";

const COLUMNS: { key: ColKey; label: string; chip: string; tone: "violet" | "amber" | "green" }[] = [
  { key: "blocked", label: "Esperando aprobación", chip: "Esperando aprobación", tone: "violet" },
  { key: "active", label: "En curso", chip: "En curso", tone: "amber" },
  { key: "done", label: "Completados", chip: "Completado", tone: "green" },
];

// blocked y done tienen columna propia; ready, running y cualquier estado
// desconocido caen en "En curso" (no ocultamos tickets por un estado nuevo).
function columnOf(status: string): ColKey {
  if (status === "blocked") return "blocked";
  if (status === "done") return "done";
  return "active";
}

// created_at llega del adapter como epoch en SEGUNDOS (int), aunque la lib lo
// tipa string. Acepto número, string numérico o fecha parseable.
function toDate(v: string | number): Date | null {
  const n = typeof v === "number" ? v : Number(v);
  if (Number.isFinite(n) && String(v).trim() !== "") return new Date(n > 1e12 ? n : n * 1000);
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function fmtFecha(v: string | number): string {
  const d = toDate(v);
  if (!d) return "";
  const hoy = new Date();
  if (d.toDateString() === hoy.toDateString())
    return d.toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit" });
  const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };
  if (d.getFullYear() !== hoy.getFullYear()) opts.year = "numeric";
  return d.toLocaleDateString("es-UY", opts);
}

// Búsqueda insensible a mayúsculas y tildes.
function normalizar(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function FiltroChip({ activo, onClick, children }: {
  activo: boolean; onClick: () => void; children: ReactNode;
}) {
  return (
    <button onClick={onClick} aria-pressed={activo} className="transition hover:opacity-80">
      <Chip tone={activo ? "ink" : "violet"}>{children}</Chip>
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

  if (!cfg) return <Spinner />; // el layout muestra el login
  if (tickets === null && error) return <ErrorState message={error} onRetry={cargar} />;
  if (tickets === null) return <Spinner />;

  const colDe = (t: Ticket) => COLUMNS.find((c) => c.key === columnOf(t.status))!;

  return (
    <div className="max-w-6xl mx-auto">
      <header className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-extrabold text-ink tracking-tight">📋 Pipeline</h1>
          <p className="text-sm text-ink-soft mt-0.5">Lo que tu agente tiene entre manos.</p>
        </div>
        <div className="flex items-center gap-3">
          {ultima && (
            <span className="text-xs text-ink-soft">
              Actualizado {ultima.toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          <Btn kind="ghost" disabled={cargando} onClick={cargar}>
            {cargando ? "Actualizando…" : "Actualizar"}
          </Btn>
        </div>
      </header>

      {error && (
        <p className="inline-block rounded-pill bg-c-coral text-c-coral-ink text-xs font-bold px-4 py-2 mb-4">
          No pude actualizar recién ({error}). Te muestro lo último que tengo.
        </p>
      )}

      {tickets.length === 0 ? (
        <EmptyState
          emoji="📋"
          title="Todavía no hay tickets"
          hint="Cuando tu agente empiece a trabajar, los vas a ver acá."
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-6">
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar por título…"
              className="w-full sm:w-72 rounded-pill border border-c-violet bg-white px-5 py-2.5 text-sm text-ink outline-none focus:border-primary"
            />
            {tenants.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <FiltroChip activo={tenant === null} onClick={() => setTenant(null)}>
                  Todos
                </FiltroChip>
                {tenants.map((t) => (
                  <FiltroChip
                    key={t}
                    activo={tenant === t}
                    onClick={() => setTenant(tenant === t ? null : t)}
                  >
                    {t === SIN_TENANT ? "Sin etiqueta" : t}
                  </FiltroChip>
                ))}
              </div>
            )}
          </div>

          {visibles.length === 0 ? (
            <EmptyState
              emoji="🔍"
              title="Ningún ticket coincide"
              hint="Probá con otra búsqueda o sacá el filtro."
            />
          ) : (
            <div className="grid gap-4 md:grid-cols-3 items-start">
              {COLUMNS.map((col) => (
                <Card key={col.key} tone={col.tone}>
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="text-sm font-extrabold uppercase tracking-wide">{col.label}</h2>
                    <span className="rounded-pill bg-white/70 px-2.5 py-0.5 text-xs font-bold">
                      {porColumna[col.key].length}
                    </span>
                  </div>
                  {porColumna[col.key].length === 0 ? (
                    <p className="py-4 text-center text-sm opacity-70">Sin tickets</p>
                  ) : (
                    <ul className="flex flex-col gap-3">
                      {porColumna[col.key].map((t) => (
                        <li key={t.id}>
                          <button
                            onClick={() => setAbierto(t)}
                            aria-haspopup="dialog"
                            className="block w-full text-left"
                          >
                            <Card className="cursor-pointer transition hover:shadow-lift">
                              <p className="text-sm font-bold text-ink leading-snug line-clamp-3">
                                {t.title}
                              </p>
                              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                                {t.tenant && <Chip tone="violet">{t.tenant}</Chip>}
                                {t.status === "running" && <Chip tone="amber">En ejecución</Chip>}
                                <span className="ml-auto text-xs text-ink-soft">
                                  {fmtFecha(t.created_at)}
                                </span>
                              </div>
                            </Card>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      {abierto && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={abierto.title}
          onClick={() => setAbierto(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4 sm:p-8"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-card bg-white shadow-lift"
          >
            <div className="flex items-start justify-between gap-4 border-b border-surface p-6 pb-4">
              <div className="min-w-0">
                <h2 className="text-lg font-extrabold leading-snug text-ink">{abierto.title}</h2>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Chip tone={colDe(abierto).tone}>{colDe(abierto).chip}</Chip>
                  {abierto.tenant && <Chip tone="ink">{abierto.tenant}</Chip>}
                  <span className="text-xs text-ink-soft">{fmtFecha(abierto.created_at)}</span>
                </div>
              </div>
              <button
                onClick={() => setAbierto(null)}
                aria-label="Cerrar"
                className="shrink-0 text-xl leading-none text-ink-soft transition hover:text-ink"
              >
                ✕
              </button>
            </div>
            <div className="overflow-y-auto p-6">
              {abierto.body ? (
                <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-ink">
                  {abierto.body}
                </pre>
              ) : (
                <p className="text-sm text-ink-soft">Este ticket no tiene descripción.</p>
              )}
            </div>
            <div className="flex justify-end border-t border-surface p-4">
              <Btn kind="ghost" onClick={() => setAbierto(null)}>
                Cerrar
              </Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
