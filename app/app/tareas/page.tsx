"use client";

// Tareas: consola de operador sobre los crons del agente (GET /api/jobs).
// Lista plana en una Card con filas divididas + pausar/reanudar/correr ahora
// con confirmación inline. Sin crear/editar/borrar: ventana, no jaula.
// getJobs ya pide ?include_disabled=true, así que los pausados vienen en el
// listado y no hace falta retención local.
//
// Cada fila abre un detalle (Modal) con la consigna con la que corre la tarea
// y el historial de corridas: GET {adapter}/portal/crons/{id}.

import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Clock, Eye, Pause, Play, X, Zap } from "lucide-react";
import { loadConfig, getJobs, jobAction, type PortalConfig } from "../lib/agent";
import {
  Btn, Card, Chip, EmptyState, ErrorState, IconBtn, Modal, PageHeader, Spinner,
} from "../lib/ui";

// ── Tipos (shape real de /api/jobs, verificado contra el agente) ──

type Schedule = {
  kind?: string; // "cron" | "interval" | "once"
  expr?: string; // cron de 5 campos
  minutes?: number; // para kind "interval"
  run_at?: string; // para kind "once"
  display?: string;
} | null;

type Job = {
  id: string;
  name: string;
  enabled: boolean;
  state?: string | null; // "scheduled" | "paused" | "running" | ...
  schedule?: Schedule;
  schedule_display?: string | null;
  next_run_at?: string | null;
  last_run_at?: string | null;
  last_status?: string | null; // "ok" | "error" | ...
  last_error?: string | null;
};

type Action = "pause" | "resume" | "run";

// Detalle: shape real de {adapter}/portal/crons/{id} (adapter 0.8.0, verificado
// contra el agente). El job del detalle es más chico que el del listado —no trae
// el objeto `schedule`, solo `schedule_display`—, así que la cadencia se sigue
// calculando con el Job de la lista y esto sólo agrega lo que la lista no tiene.
type CronRun = {
  id: string;
  status?: string | null; // completed | failed | running | claimed | unknown
  claimed_at?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  error?: string | null;
};

type CronDetailJob = {
  id: string;
  name: string;
  prompt?: string | null; // "" cuando la tarea es un script
  script?: string | null; // "" cuando la tarea es un prompt
  schedule_display?: string | null;
  enabled?: boolean;
  state?: string | null;
  model?: string | null; // "" cuando no corre modelo (script)
  deliver?: string | null; // telegram | local | origin | ...
  last_status?: string | null;
  last_error?: string | null;
  next_run_at?: string | null;
};

type CronDetail = { job: CronDetailJob; runs: CronRun[] };

/* ── Lectura del detalle ──────────────────────────────────────────────────────
   TODO: getCronDetail DEBERÍA GRADUARSE a ../lib/agent.ts, que es el único punto
   de red del portal. Vive acá porque lib/ la está tocando otro agente en
   paralelo. Al mover: es el mismo `get()` de la lib contra el adapter, con el
   status a mano para distinguir el 404 (id inexistente o adapter viejo) de una
   caída. Contrato (adapter 0.8.0):
     GET /portal/crons/{id} → {job, runs[]}   ·   404 si el id no existe
     runs viene ordenado por más reciente primero, hasta 30.
   ────────────────────────────────────────────────────────────────────────── */

class DetalleError extends Error {
  status: number; // 0 = ni siquiera salió el request
  constructor(status: number, message: string) {
    super(message);
    this.name = "DetalleError";
    this.status = status;
  }
}

async function getCronDetail(cfg: PortalConfig, id: string): Promise<CronDetail> {
  let res: Response;
  try {
    res = await fetch(`${cfg.adapter}/portal/crons/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${cfg.key}` },
    });
  } catch {
    throw new DetalleError(0, "no hay conexión con tu agente");
  }
  if (!res.ok) {
    if (res.status === 404) throw new DetalleError(404, "tu agente no tiene el detalle de esta tarea");
    if (res.status === 401 || res.status === 403)
      throw new DetalleError(res.status, "tu sesión venció: volvé a entrar con tu link");
    throw new DetalleError(res.status, `error ${res.status}`);
  }
  return res.json();
}

function describirError(e: unknown): string {
  if (e instanceof DetalleError) return e.message;
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes("Failed to fetch") || msg.includes("NetworkError"))
    return "no hay conexión con tu agente";
  return msg;
}

// ── Copy ──

const CONFIRM_Q: Record<Action, (name: string) => string> = {
  pause: (n) => `¿Pausar «${n}»?`,
  resume: (n) => `¿Reanudar «${n}»?`,
  run: (n) => `¿Correr «${n}» ahora?`,
};
const NOTICE_OK: Record<Action, (name: string) => string> = {
  pause: (n) => `Tarea «${n}» pausada.`,
  resume: (n) => `Tarea «${n}» reanudada.`,
  run: (n) => `Corrida de «${n}» disparada.`,
};

// ── Cadencia legible ──

const DIAS_PLURAL = ["domingos", "lunes", "martes", "miércoles", "jueves", "viernes", "sábados"];

const two = (n: number) => String(n).padStart(2, "0");

function cadaN(n: number, singular: string, plural: string): string {
  return n === 1 ? `Cada ${singular}` : `Cada ${n} ${plural}`;
}

function diasLegible(dow: string): string | null {
  if (dow === "1-5") return "Lunes a viernes";
  if (dow === "0,6" || dow === "6,0") return "Sábados y domingos";
  if (/^[0-6]$/.test(dow)) return `Los ${DIAS_PLURAL[Number(dow)]}`;
  return null;
}

// Traduce los patrones cron comunes; devuelve null si no lo reconoce.
function cronLegible(expr: string): string | null {
  const p = expr.trim().split(/\s+/);
  if (p.length !== 5) return null;
  const [min, hour, dom, mon, dow] = p;
  if (mon !== "*") return null;
  const minFijo = /^\d+$/.test(min);
  const horaFija = /^\d+$/.test(hour);
  const hora = () => `${two(Number(hour))}:${two(Number(min))}`;

  if (minFijo && horaFija && dom === "*") {
    if (dow === "*") return `Todos los días a las ${hora()}`;
    const dias = diasLegible(dow);
    return dias ? `${dias} a las ${hora()}` : null;
  }
  if (minFijo && horaFija && /^\d+$/.test(dom) && dow === "*") {
    return `El día ${Number(dom)} de cada mes a las ${hora()}`;
  }
  const pasoHora = hour.match(/^\*\/(\d+)$/);
  if (minFijo && pasoHora && dom === "*" && dow === "*") {
    return cadaN(Number(pasoHora[1]), "hora", "horas");
  }
  const pasoMin = min.match(/^\*\/(\d+)$/);
  if (pasoMin && hour === "*" && dom === "*" && dow === "*") {
    return cadaN(Number(pasoMin[1]), "minuto", "minutos");
  }
  if (min === "*" && hour === "*" && dom === "*" && dow === "*") return "Cada minuto";
  return null;
}

// Devuelve la cadencia legible y, si difiere, el cron/schedule crudo como detalle.
function cadencia(job: Job): { legible: string; cruda: string | null } {
  const s = job.schedule;
  if (s?.kind === "interval" && typeof s.minutes === "number") {
    const m = s.minutes;
    const legible =
      m % 1440 === 0 ? cadaN(m / 1440, "día", "días")
      : m % 60 === 0 ? cadaN(m / 60, "hora", "horas")
      : cadaN(m, "minuto", "minutos");
    return { legible, cruda: s.display ?? null };
  }
  if (s?.kind === "cron" && s.expr) {
    const legible = cronLegible(s.expr);
    return legible ? { legible, cruda: s.expr } : { legible: s.expr, cruda: null };
  }
  if (s?.kind === "once") {
    const cuando = proximaLegible(s.run_at ?? job.next_run_at);
    return { legible: cuando ? `Una sola vez, ${cuando}` : "Una sola vez", cruda: s.display ?? null };
  }
  const raw = s?.display ?? job.schedule_display ?? null;
  return { legible: raw ?? "Sin cadencia", cruda: null };
}

// ── Fechas legibles ──

function haceLegible(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const min = Math.round((Date.now() - t) / 60000);
  if (min < 1) return "recién";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? "ayer" : `hace ${d} días`;
}

function proximaLegible(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const dte = new Date(iso);
  if (Number.isNaN(dte.getTime())) return null;
  const ahora = new Date();
  const hm = `${two(dte.getHours())}:${two(dte.getMinutes())}`;
  const mismoDia = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (mismoDia(dte, ahora)) return `hoy a las ${hm}`;
  const maniana = new Date(ahora);
  maniana.setDate(ahora.getDate() + 1);
  if (mismoDia(dte, maniana)) return `mañana a las ${hm}`;
  const fecha = dte.toLocaleDateString("es-UY", { weekday: "short", day: "numeric", month: "short" });
  return `${fecha} a las ${hm}`;
}

// Fecha + hora de una corrida: "hoy 09:56", "ayer 04:07", "1 ago 23:10".
function fechaHoraCorrida(iso: string | null | undefined): { fecha: string; hora: string } | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const ahora = new Date();
  const ayer = new Date(ahora);
  ayer.setDate(ahora.getDate() - 1);
  const mismoDia = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const fecha =
    mismoDia(d, ahora) ? "hoy"
    : mismoDia(d, ayer) ? "ayer"
    : d.toLocaleDateString("es-UY", { day: "numeric", month: "short" });
  return { fecha, hora: `${two(d.getHours())}:${two(d.getMinutes())}` };
}

// Cuánto tardó una corrida. null si todavía no terminó (o si las fechas no
// parsean): el chip de estado ya cuenta que sigue en curso.
function duracionLegible(inicio: string | null | undefined, fin: string | null | undefined): string | null {
  if (!inicio || !fin) return null;
  const a = new Date(inicio).getTime();
  const b = new Date(fin).getTime();
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return null;
  const ms = b - a;
  if (ms < 1000) return "<1 s";
  const seg = Math.round(ms / 1000);
  if (seg < 90) return `${seg} s`;
  const min = Math.round(seg / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const resto = min % 60;
  return resto === 0 ? `${h} h` : `${h} h ${resto} min`;
}

// ── Estados de corrida ──

type Tone = "violet" | "green" | "coral" | "amber" | "neutral";

const RUN_ESTADO: Record<string, { label: string; tone: Tone }> = {
  completed: { label: "completada", tone: "green" },
  failed: { label: "falló", tone: "coral" },
  running: { label: "corriendo", tone: "amber" },
  claimed: { label: "arrancando", tone: "amber" },
  unknown: { label: "sin confirmar", tone: "neutral" },
};

function estadoCorrida(status: string | null | undefined): { label: string; tone: Tone } {
  const s = (status ?? "").trim();
  return RUN_ESTADO[s] ?? { label: s || "sin estado", tone: "neutral" };
}

// Cómo entrega el resultado. Cualquier canal nuevo del agente se muestra crudo
// antes que esconderlo.
const CANAL_LABEL: Record<string, string> = {
  telegram: "Telegram",
  whatsapp: "WhatsApp",
  email: "Email",
  local: "Queda en el agente",
  origin: "Donde se pidió",
};

// ── Página ──

const ordenar = (jobs: Job[]) => [...jobs].sort((a, b) => a.name.localeCompare(b.name));

// El shell no pone padding: cada página envuelve su contenido.
function Shell({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-4xl px-6 py-6 md:px-8">{children}</div>;
}

// Mismo chip de estado en la fila y en el detalle: una sola verdad.
function EstadoChip({ estado, activa }: { estado?: string | null; activa: boolean }) {
  if (estado === "running") return <Chip tone="violet">Corriendo</Chip>;
  return activa ? <Chip tone="green">Activa</Chip> : <Chip tone="amber">Pausada</Chip>;
}

function Rotulo({ children }: { children: ReactNode }) {
  return (
    <p className="text-[11px] font-bold uppercase tracking-wide text-ink-soft/70">{children}</p>
  );
}

function Dato({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <Rotulo>{label}</Rotulo>
      <div className="mt-0.5 text-[13px] text-ink">{children}</div>
    </div>
  );
}

/** Detalle de una tarea: qué hace y cómo le fue las últimas veces. */
function DetalleTarea({ job, detalle, error, onRetry, onClose }: {
  job: Job; // el de la lista: es el único que trae el objeto `schedule` completo
  detalle: CronDetail | null;
  error: string | null;
  onRetry: () => void;
  onClose: () => void;
}) {
  const d = detalle?.job;
  const { legible, cruda } = cadencia(job);
  const activa = d?.enabled ?? job.enabled;
  const estado = d?.state ?? job.state;
  const proxima = activa ? proximaLegible(d?.next_run_at ?? job.next_run_at) : null;
  const modelo = (d?.model ?? "").trim();
  const canal = (d?.deliver ?? "").trim();
  const prompt = (d?.prompt ?? "").trim();
  const script = (d?.script ?? "").trim();
  const esScript = !prompt && !!script;
  const ultimoError = d?.last_error ?? job.last_error ?? null;
  const ultimoStatus = d?.last_status ?? job.last_status;
  const fallo = ultimoStatus != null && ultimoStatus !== "ok";
  const runs = detalle?.runs ?? [];

  return (
    <Modal wide onClose={onClose}>
      <div className="flex items-start justify-between gap-4 border-b border-black/[0.07] px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-base font-bold leading-snug text-ink">{job.name}</h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <EstadoChip estado={estado} activa={activa} />
            {fallo && (
              <span title={ultimoError ?? undefined}>
                <Chip tone="coral">la última falló</Chip>
              </span>
            )}
          </div>
        </div>
        <IconBtn label="Cerrar" onClick={onClose}>
          <X className="h-4 w-4" />
        </IconBtn>
      </div>

      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-5 py-4">
        {error ? (
          <ErrorState message={`No pude abrir el detalle (${error}).`} onRetry={onRetry} />
        ) : !detalle ? (
          <Spinner />
        ) : (
          <>
            <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              <Dato label="Cada cuánto">
                {legible}
                {cruda && cruda !== legible && (
                  <span className="ml-1.5 font-mono text-[11px] tabular-nums text-ink-soft/60">
                    {cruda}
                  </span>
                )}
              </Dato>
              {proxima && <Dato label="Próxima corrida">{proxima}</Dato>}
              {modelo && (
                <Dato label="Modelo">
                  <span className="font-mono text-[12px]">{modelo}</span>
                </Dato>
              )}
              {canal && <Dato label="Te llega por">{CANAL_LABEL[canal] ?? canal}</Dato>}
            </div>

            {/* Lo más valioso del detalle: la consigna tal cual corre. */}
            <div className="mt-5">
              <Rotulo>{esScript ? "Corre un script" : "Qué hace esta tarea"}</Rotulo>
              <p className="mt-0.5 text-[12px] text-ink-soft">
                {esScript
                  ? "Esta tarea no pasa por el modelo: ejecuta este script en el servidor de tu agente."
                  : "Es la consigna con la que corre, tal cual se la damos al agente. No es una descripción escrita a mano."}
              </p>
              {prompt || script ? (
                <div className="mt-2 max-h-64 overflow-y-auto rounded-lg bg-black/[0.03] p-3">
                  <p
                    className={`whitespace-pre-wrap break-words leading-relaxed text-ink-soft ${
                      esScript ? "font-mono text-[12px]" : "text-[12.5px]"
                    }`}
                  >
                    {esScript ? script : prompt}
                  </p>
                </div>
              ) : (
                <p className="mt-2 text-[13px] text-ink-soft">
                  Tu agente no guarda una consigna para esta tarea.
                </p>
              )}
            </div>

            <div className="mt-5">
              <Rotulo>Últimas corridas</Rotulo>
              {runs.length === 0 ? (
                <p className="mt-1 text-[13px] text-ink-soft">Todavía no corrió ninguna vez.</p>
              ) : (
                <div className="mt-1 divide-y divide-black/[0.06]">
                  {runs.map((r) => {
                    const cuando = fechaHoraCorrida(r.started_at ?? r.claimed_at);
                    const dur = duracionLegible(r.started_at ?? r.claimed_at, r.finished_at);
                    const { label, tone } = estadoCorrida(r.status);
                    return (
                      <div key={r.id} className="py-2">
                        <div className="flex items-center gap-2">
                          <span className="text-[13px] text-ink">
                            {cuando ? (
                              <>
                                {cuando.fecha} <span className="tabular-nums">{cuando.hora}</span>
                              </>
                            ) : (
                              "sin fecha"
                            )}
                          </span>
                          {dur && (
                            <span className="text-[12px] tabular-nums text-ink-soft">· {dur}</span>
                          )}
                          <span className="ml-auto shrink-0">
                            <Chip tone={tone}>{label}</Chip>
                          </span>
                        </div>
                        {r.error && (
                          <p className="mt-0.5 truncate text-[12px] text-c-coral-ink" title={r.error}>
                            {r.error}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

export default function TareasPage() {
  const [cfg, setCfg] = useState<PortalConfig | null>(null);
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ id: string; action: Action } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  const [abiertoId, setAbiertoId] = useState<string | null>(null);
  const [detalle, setDetalle] = useState<CronDetail | null>(null);
  const [detalleErr, setDetalleErr] = useState<string | null>(null);
  const pedido = useRef(0); // descarta respuestas de detalles que ya no se ven

  const refresh = useCallback((c: PortalConfig) => {
    getJobs(c)
      .then((d) => {
        setJobs(ordenar(d?.jobs ?? []));
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "sin detalle"));
  }, []);

  useEffect(() => {
    const c = loadConfig();
    if (!c) return; // el layout muestra el login
    setCfg(c);
    refresh(c);
    const t = setInterval(() => refresh(c), 30_000);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice]);

  // silencioso: el refresco de fondo no vacía lo que el cliente está leyendo ni
  // le tira un error encima si justo falla ese pedido.
  const cargarDetalle = useCallback(
    (id: string, silencioso = false) => {
      if (!cfg) return;
      const n = ++pedido.current;
      if (!silencioso) {
        setDetalle(null);
        setDetalleErr(null);
      }
      getCronDetail(cfg, id)
        .then((d) => {
          if (pedido.current !== n) return;
          setDetalle(d);
          setDetalleErr(null);
        })
        .catch((e: unknown) => {
          if (pedido.current !== n || silencioso) return;
          setDetalleErr(describirError(e));
        });
    },
    [cfg],
  );

  useEffect(() => {
    if (abiertoId) cargarDetalle(abiertoId);
  }, [abiertoId, cargarDetalle]);

  // Abrir limpia el detalle en el mismo evento: sin esto, el primer frame del
  // modal nuevo muestra las corridas de la tarea anterior.
  const abrir = (id: string) => {
    setAbiertoId(id);
    setDetalle(null);
    setDetalleErr(null);
  };

  // Mientras el detalle está abierto también se refresca solo (misma cadencia
  // que la lista): una corrida disparada desde acá aparece sin recargar.
  useEffect(() => {
    if (!abiertoId) return;
    const t = setInterval(() => cargarDetalle(abiertoId, true), 30_000);
    return () => clearInterval(t);
  }, [abiertoId, cargarDetalle]);

  // Modal: Escape cierra, el fondo no scrollea.
  useEffect(() => {
    if (!abiertoId) return;
    const fn = (e: KeyboardEvent) => e.key === "Escape" && setAbiertoId(null);
    window.addEventListener("keydown", fn);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", fn);
      document.body.style.overflow = "";
    };
  }, [abiertoId]);

  const ejecutar = async (job: Job, action: Action) => {
    if (!cfg) return;
    setConfirm(null);
    setBusy(job.id);
    try {
      const res = await jobAction(cfg, job.id, action);
      const actualizado: Job | undefined = res?.job;
      if (actualizado) {
        setJobs((prev) => ordenar([...(prev ?? []).filter((j) => j.id !== actualizado.id), actualizado]));
      }
      setNotice({ text: NOTICE_OK[action](job.name), ok: true });
      refresh(cfg);
      if (abiertoId === job.id) cargarDetalle(job.id, true);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "error";
      setNotice({ text: `No se pudo (${msg}). Probá de nuevo.`, ok: false });
    } finally {
      setBusy(null);
    }
  };

  if (!cfg || (jobs === null && !error)) {
    return (
      <Shell>
        <Spinner />
      </Shell>
    );
  }

  if (jobs === null && error) {
    return (
      <Shell>
        <ErrorState message={error} onRetry={() => refresh(cfg)} />
      </Shell>
    );
  }

  // El detalle se ancla al id: la lista se refresca sola y reemplaza los objetos.
  const abierto = abiertoId ? (jobs!.find((j) => j.id === abiertoId) ?? null) : null;

  return (
    <Shell>
      <PageHeader title="Tareas" subtitle="Lo que tu agente hace solo, y cuándo" />

      {notice && (
        <div
          className={`mb-3 rounded-lg border px-3 py-2 text-[13px] font-medium ${
            notice.ok
              ? "border-c-green bg-c-green/40 text-c-green-ink"
              : "border-c-coral bg-c-coral/40 text-c-coral-ink"
          }`}
        >
          {notice.text}
        </div>
      )}

      {error && (
        <div className="mb-3 rounded-lg border border-c-amber bg-c-amber/40 px-3 py-2 text-[13px] font-medium text-c-amber-ink">
          No pude actualizar recién ({error}). Te muestro lo último que vi.
        </div>
      )}

      {jobs!.length === 0 ? (
        <Card>
          <EmptyState
            icon={Clock}
            title="Sin tareas programadas"
            hint="Cuando tu agente tenga tareas automáticas, van a aparecer acá."
          />
        </Card>
      ) : (
        <Card className="divide-y divide-black/[0.06] py-1">
          {jobs!.map((job) => {
            const { legible, cruda } = cadencia(job);
            const ultima = haceLegible(job.last_run_at);
            const proxima = job.enabled ? proximaLegible(job.next_run_at) : null;
            const fallo = job.last_status != null && job.last_status !== "ok";
            const enConfirm = confirm?.id === job.id ? confirm : null;
            const ocupado = busy === job.id;

            return (
              <div
                key={job.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 py-3.5 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto]"
              >
                {/* Izquierda: nombre + cadencia humana + cron crudo. Abre el detalle. */}
                <button
                  type="button"
                  onClick={() => abrir(job.id)}
                  className="min-w-0 rounded-lg text-left outline-none transition hover:opacity-70 focus-visible:ring-2 focus-visible:ring-primary/25"
                  title="Ver detalle"
                >
                  {/* spans, no <p>: adentro de un button el markup tiene que ser inline */}
                  <span className="block truncate text-sm font-semibold text-ink">{job.name}</span>
                  <span className="block text-[13px] text-ink-soft">{legible}</span>
                  {cruda && cruda !== legible && (
                    <span className="block font-mono text-[11px] text-ink-soft/60">{cruda}</span>
                  )}
                </button>

                {/* Centro: estado + última corrida */}
                <div className="order-3 col-span-2 flex flex-wrap items-center gap-2 md:order-none md:col-span-1">
                  <EstadoChip estado={job.state} activa={job.enabled} />
                  {ultima ? (
                    fallo ? (
                      <>
                        <span className="text-[12px] text-ink-soft">{ultima}</span>
                        <span title={job.last_error ?? undefined}>
                          <Chip tone="coral">falló</Chip>
                        </span>
                      </>
                    ) : (
                      <span className="text-[12px] text-ink-soft">{ultima} · ok</span>
                    )
                  ) : (
                    <span className="text-[12px] text-ink-soft">todavía no corrió</span>
                  )}
                </div>

                {/* Derecha: próxima corrida + acciones (o confirmación inline) */}
                <div className="flex items-center justify-end justify-self-end">
                  {enConfirm ? (
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <span className="text-[13px] text-ink-soft">
                        {CONFIRM_Q[enConfirm.action](job.name)}
                      </span>
                      <Btn
                        size="sm"
                        kind={enConfirm.action === "pause" ? "danger" : "primary"}
                        disabled={ocupado}
                        onClick={() => ejecutar(job, enConfirm.action)}
                      >
                        Sí
                      </Btn>
                      <Btn size="sm" kind="ghost" disabled={ocupado} onClick={() => setConfirm(null)}>
                        Cancelar
                      </Btn>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      {proxima && (
                        <span className="mr-1 text-[12px] text-ink-soft">Próxima {proxima}</span>
                      )}
                      <IconBtn label="Ver detalle" onClick={() => abrir(job.id)}>
                        <Eye className="h-4 w-4" />
                      </IconBtn>
                      <IconBtn
                        label="Correr ahora"
                        disabled={ocupado}
                        onClick={() => setConfirm({ id: job.id, action: "run" })}
                      >
                        <Zap className="h-4 w-4" />
                      </IconBtn>
                      {job.enabled ? (
                        <IconBtn
                          label="Pausar"
                          disabled={ocupado}
                          onClick={() => setConfirm({ id: job.id, action: "pause" })}
                        >
                          <Pause className="h-4 w-4" />
                        </IconBtn>
                      ) : (
                        <IconBtn
                          label="Reanudar"
                          disabled={ocupado}
                          onClick={() => setConfirm({ id: job.id, action: "resume" })}
                        >
                          <Play className="h-4 w-4" />
                        </IconBtn>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </Card>
      )}

      {abierto && (
        <DetalleTarea
          job={abierto}
          detalle={detalle}
          error={detalleErr}
          onRetry={() => cargarDetalle(abierto.id)}
          onClose={() => setAbiertoId(null)}
        />
      )}
    </Shell>
  );
}
