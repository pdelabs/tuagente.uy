"use client";

// Tareas: consola de operador sobre los crons del agente (GET /api/jobs).
// Lista + pausar/reanudar/correr ahora con confirmación inline.
// Sin crear/editar/borrar: el portal es ventana, no jaula.
//
// Nota de API (verificado con curl): el listado por defecto de /api/jobs
// EXCLUYE los jobs pausados (hace falta ?include_disabled=true, que getJobs
// de la lib todavía no manda). Mientras tanto, retenemos localmente los
// jobs que vimos pausarse para que no desaparezcan de la lista.

import { useCallback, useEffect, useState } from "react";
import { loadConfig, getJobs, jobAction, type PortalConfig } from "../lib/agent";
import { Btn, Card, Chip, EmptyState, ErrorState, Spinner } from "../lib/ui";

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
  model?: string | null;
};

type Action = "pause" | "resume" | "run";

// ── Copy ──

const CONFIRM_TEXT: Record<Action, string> = {
  pause: "¿Pausar esta tarea? No va a correr hasta que la reanudes.",
  resume: "¿Reanudar esta tarea? Vuelve a correr según su cadencia.",
  run: "¿Correr esta tarea ahora, fuera de su horario?",
};
const CONFIRM_YES: Record<Action, string> = {
  pause: "Sí, pausar",
  resume: "Sí, reanudar",
  run: "Sí, correr",
};
const NOTICE_OK: Record<Action, string> = {
  pause: "Tarea pausada.",
  resume: "Tarea reanudada.",
  run: "Corrida disparada.",
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

// Devuelve la cadencia legible y, si difiere, el cron crudo como detalle.
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

export default function TareasPage() {
  const [cfg, setCfg] = useState<PortalConfig | null>(null);
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ id: string; action: Action } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ id: string; text: string; ok: boolean } | null>(null);

  const refresh = useCallback((c: PortalConfig) => {
    getJobs(c)
      .then((d) => {
        const fetched: Job[] = d?.jobs ?? [];
        setJobs((prev) => {
          const ids = new Set(fetched.map((j) => j.id));
          // El listado por defecto oculta los pausados: retenemos los que ya vimos.
          const retenidos = (prev ?? []).filter((j) => !ids.has(j.id) && !j.enabled);
          return ordenar([...fetched, ...retenidos]);
        });
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
      setNotice({ id: job.id, text: NOTICE_OK[action], ok: true });
      refresh(cfg);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "error";
      setNotice({ id: job.id, text: `No se pudo (${msg}). Probá de nuevo.`, ok: false });
    } finally {
      setBusy(null);
    }
  };

  if (!cfg || (jobs === null && !error)) return <Spinner />;

  if (jobs === null && error) {
    return <ErrorState message={error} onRetry={() => refresh(cfg)} />;
  }

  return (
    <div className="max-w-3xl">
      <header className="mb-6">
        <h1 className="text-2xl font-extrabold text-ink tracking-tight">⏰ Tareas</h1>
        <p className="text-sm text-ink-soft mt-1">
          Lo que tu agente hace solo, según agenda. Se actualiza cada 30 segundos.
        </p>
      </header>

      {error && (
        <div className="rounded-card bg-c-amber text-c-amber-ink px-5 py-3 text-sm font-bold mb-4">
          No pude actualizar recién ({error}). Te muestro lo último que vi.
        </div>
      )}

      {jobs!.length === 0 ? (
        <EmptyState
          emoji="⏰"
          title="Sin tareas programadas"
          hint="Cuando tu agente tenga tareas automáticas, van a aparecer acá."
        />
      ) : (
        <div className="flex flex-col gap-4">
          {jobs!.map((job) => {
            const { legible, cruda } = cadencia(job);
            const ultima = haceLegible(job.last_run_at);
            const proxima = job.enabled ? proximaLegible(job.next_run_at) : null;
            const fallo = job.last_status != null && job.last_status !== "ok";
            const enConfirm = confirm?.id === job.id ? confirm : null;
            const ocupado = busy === job.id;

            return (
              <Card key={job.id}>
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-3 flex-wrap">
                      <p className="font-bold text-ink truncate">{job.name}</p>
                      {job.state === "running" ? (
                        <Chip tone="violet">Corriendo</Chip>
                      ) : job.enabled ? (
                        <Chip tone="green">Activa</Chip>
                      ) : (
                        <Chip tone="amber">Pausada</Chip>
                      )}
                    </div>
                    <p className="text-sm text-ink mt-1">
                      {legible}
                      {cruda && cruda !== legible && (
                        <span className="ml-2 font-mono text-xs text-ink-soft">({cruda})</span>
                      )}
                    </p>
                    <p className="text-xs text-ink-soft mt-1.5">
                      {ultima ? (
                        <>
                          Última corrida {ultima} ·{" "}
                          {fallo ? (
                            <span className="font-bold text-c-coral-ink" title={job.last_error ?? undefined}>
                              falló
                            </span>
                          ) : (
                            <span className="font-bold text-c-green-ink">OK</span>
                          )}
                        </>
                      ) : (
                        "Todavía no corrió"
                      )}
                      {proxima && <> · Próxima {proxima}</>}
                      {job.model && <> · {job.model}</>}
                    </p>
                  </div>

                  <div className="shrink-0 max-w-full">
                    {enConfirm ? (
                      <div className="flex items-center gap-2 flex-wrap justify-end">
                        <span className="text-sm text-ink-soft">{CONFIRM_TEXT[enConfirm.action]}</span>
                        <Btn
                          kind={enConfirm.action === "pause" ? "danger" : "primary"}
                          disabled={ocupado}
                          onClick={() => ejecutar(job, enConfirm.action)}
                        >
                          {CONFIRM_YES[enConfirm.action]}
                        </Btn>
                        <Btn kind="ghost" disabled={ocupado} onClick={() => setConfirm(null)}>
                          Cancelar
                        </Btn>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 flex-wrap justify-end">
                        {job.enabled ? (
                          <Btn kind="ghost" disabled={ocupado} onClick={() => setConfirm({ id: job.id, action: "pause" })}>
                            Pausar
                          </Btn>
                        ) : (
                          <Btn kind="primary" disabled={ocupado} onClick={() => setConfirm({ id: job.id, action: "resume" })}>
                            Reanudar
                          </Btn>
                        )}
                        <Btn kind="ghost" disabled={ocupado} onClick={() => setConfirm({ id: job.id, action: "run" })}>
                          Correr ahora
                        </Btn>
                      </div>
                    )}
                    {notice?.id === job.id && (
                      <p className={`text-xs mt-2 text-right font-bold ${notice.ok ? "text-c-green-ink" : "text-c-coral-ink"}`}>
                        {notice.text}
                      </p>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
