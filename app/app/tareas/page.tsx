"use client";

// Tareas: consola de operador sobre los crons del agente (GET /api/jobs).
// Lista plana en una Card con filas divididas + pausar/reanudar/correr ahora
// con confirmación inline. Sin crear/editar/borrar: ventana, no jaula.
// getJobs ya pide ?include_disabled=true, así que los pausados vienen en el
// listado y no hace falta retención local.

import { ReactNode, useCallback, useEffect, useState } from "react";
import { Clock, Pause, Play, Zap } from "lucide-react";
import { loadConfig, getJobs, jobAction, type PortalConfig } from "../lib/agent";
import { Btn, Card, Chip, EmptyState, ErrorState, IconBtn, PageHeader, Spinner } from "../lib/ui";

// ── Tipos (shape real de /api/jobs, verificado contra el agente) ──

type Schedule = {
  kind?: string; // "cron" | "interval"
  expr?: string; // cron de 5 campos
  minutes?: number; // para kind "interval"
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

// ── Página ──

const ordenar = (jobs: Job[]) => [...jobs].sort((a, b) => a.name.localeCompare(b.name));

// El shell no pone padding: cada página envuelve su contenido.
function Shell({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-4xl px-6 py-6 md:px-8">{children}</div>;
}

export default function TareasPage() {
  const [cfg, setCfg] = useState<PortalConfig | null>(null);
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ id: string; action: Action } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);

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
                {/* Izquierda: nombre + cadencia humana + cron crudo */}
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink">{job.name}</p>
                  <p className="text-[13px] text-ink-soft">{legible}</p>
                  {cruda && cruda !== legible && (
                    <p className="font-mono text-[11px] text-ink-soft/60">{cruda}</p>
                  )}
                </div>

                {/* Centro: estado + última corrida */}
                <div className="order-3 col-span-2 flex flex-wrap items-center gap-2 md:order-none md:col-span-1">
                  {job.state === "running" ? (
                    <Chip tone="violet">Corriendo</Chip>
                  ) : job.enabled ? (
                    <Chip tone="green">Activa</Chip>
                  ) : (
                    <Chip tone="amber">Pausada</Chip>
                  )}
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
    </Shell>
  );
}
