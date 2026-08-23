"use client";

// Tasks: an operator console over the agent's crons (GET /api/jobs).
// Flat list in one Card with divided rows + pause/resume/run now with inline
// confirmation. No create/edit/delete: a window, not a cage.
// getJobs already asks for ?include_disabled=true, so paused ones come in the
// listing and no local retention is needed.
//
// Each row opens a detail (Modal) with the instruction the task runs with and
// its run history: GET {adapter}/portal/crons/{id}.

import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Clock, Eye, Pause, Play, TriangleAlert, X, Zap } from "lucide-react";
import {
  loadConfig, getCronDetail, getFlows, getJobs, jobAction,
  type CronDetail, type Flow, type PortalConfig,
} from "../lib/agent";
import { learnUtcOffset, scheduledStatus, dateAndTime, moment } from "../lib/labels";
import {
  StaleLinkNotice, Btn, Card, Chip, EmptyState, ErrorState, IconBtn, Modal, PageHeader, Spinner,
} from "../lib/ui";
import { CopyLink, PARAM, openInRoute, closeInRoute, useRouteParam } from "../lib/routes";

// ── Types (real shape of /api/jobs, verified against the agent) ──

type Schedule = {
  kind?: string; // "cron" | "interval" | "once"
  expr?: string; // 5-field cron
  minutes?: number; // for kind "interval"
  run_at?: string; // for kind "once"
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

function describeError(e: unknown): string {
  const status = (e as { status?: number } | null)?.status;
  if (status === 404) return "tu agente no tiene el detalle de esta tarea";
  if (status === 401 || status === 403) return "tu sesión venció: volvé a entrar con tu link";
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

// ── Names ──

// THE SLUG IS NOT A NAME. The flow's task is called, on the engine's side,
// `flujo-revision-precios-proveedores`, and that's how it used to show to the
// client. Its flow, on the other hand, has the name the client gave it:
// «Revisión de precios de proveedores». It's the same job written in two
// languages and only one of them is theirs. Without the flow list on hand, at
// least the hyphens get stripped.
function taskName(name: string, flows: Flow[] | null): string {
  const n = (name || "").trim();
  const m = /^flujo-(.+)$/.exec(n);
  if (!m) return n;
  const f = flows?.find((x) => x.slug === m[1]);
  if (f?.name) return f.name;
  const clean = m[1].replace(/-+/g, " ").trim();
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

// ── Readable cadence ──

const WEEKDAY_PLURAL = ["domingos", "lunes", "martes", "miércoles", "jueves", "viernes", "sábados"];

const two = (n: number) => String(n).padStart(2, "0");

function everyN(n: number, singular: string, plural: string): string {
  return n === 1 ? `Cada ${singular}` : `Cada ${n} ${plural}`;
}

function readableDays(dow: string): string | null {
  if (dow === "1-5") return "Lunes a viernes";
  if (dow === "0,6" || dow === "6,0") return "Sábados y domingos";
  if (/^[0-6]$/.test(dow)) return `Los ${WEEKDAY_PLURAL[Number(dow)]}`;
  // Day lists. Without this, «0 18 * * 1,3» wasn't recognized and the raw
  // cron became the row's main text: the veterinary clinic's flow that runs
  // Mondays and Wednesdays showed up as "0 18 * * 1,3".
  if (/^[0-6](,[0-6])+$/.test(dow)) {
    const days = Array.from(new Set(dow.split(",").map(Number))).sort()
      .map((d) => WEEKDAY_PLURAL[d]);
    const last = days.pop()!;
    return `Los ${days.join(", ")} y ${last}`;
  }
  return null;
}

// Translates common cron patterns; returns null if it doesn't recognize it.
function readableCron(expr: string): string | null {
  const p = expr.trim().split(/\s+/);
  if (p.length !== 5) return null;
  const [min, hour, dom, mon, dow] = p;
  if (mon !== "*") return null;
  const minFixed = /^\d+$/.test(min);
  const hourFixed = /^\d+$/.test(hour);
  const time = () => `${two(Number(hour))}:${two(Number(min))}`;

  if (minFixed && hourFixed && dom === "*") {
    if (dow === "*") return `Todos los días a las ${time()}`;
    const days = readableDays(dow);
    return days ? `${days} a las ${time()}` : null;
  }
  if (minFixed && hourFixed && /^\d+$/.test(dom) && dow === "*") {
    return `El día ${Number(dom)} de cada mes a las ${time()}`;
  }
  const hourStep = hour.match(/^\*\/(\d+)$/);
  if (minFixed && hourStep && dom === "*" && dow === "*") {
    return everyN(Number(hourStep[1]), "hora", "horas");
  }
  const minStep = min.match(/^\*\/(\d+)$/);
  if (minStep && hour === "*" && dom === "*" && dow === "*") {
    return everyN(Number(minStep[1]), "minuto", "minutos");
  }
  if (min === "*" && hour === "*" && dom === "*" && dow === "*") return "Cada minuto";
  return null;
}

// Returns the readable cadence and, if it differs, the raw cron/schedule as detail.
function cadence(job: Job): { readable: string; raw: string | null } {
  const s = job.schedule;
  if (s?.kind === "interval" && typeof s.minutes === "number") {
    const m = s.minutes;
    const readable =
      m % 1440 === 0 ? everyN(m / 1440, "día", "días")
      : m % 60 === 0 ? everyN(m / 60, "hora", "horas")
      : everyN(m, "minuto", "minutos");
    return { readable, raw: s.display ?? null };
  }
  if (s?.kind === "cron" && s.expr) {
    const readable = readableCron(s.expr);
    return readable ? { readable, raw: s.expr } : { readable: s.expr, raw: null };
  }
  if (s?.kind === "once") {
    const when = readableNext(s.run_at ?? job.next_run_at);
    return { readable: when ? `Una sola vez, ${when}` : "Una sola vez", raw: s.display ?? null };
  }
  const raw = s?.display ?? job.schedule_display ?? null;
  return { readable: raw ?? "Sin cadencia", raw: null };
}

// ── Readable dates ──

function readableAgo(iso: string | null | undefined): string | null {
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

// THE SAME ROW USED TO SAY TWO DIFFERENT TIMES: «Los lunes a las 09:00» and,
// next to it, «Próxima lun 17 ago a las 06:00». They're the same run. The
// cadence comes from the cron -- written in the agent's time -- and the next
// one came from `next_run_at` (which arrives with its own offset:
// "2026-08-17T09:00:00-03:00") formatted with the browser's clock; with the
// machine in Mexico that's three hours off. Now both are read on the
// business's clock. See the note in `lib/labels.ts`.
function readableNext(iso: string | null | undefined): string | null {
  const m = moment(iso);
  if (!m) return null;
  if (m.days === 0) return `hoy a las ${m.time}`;
  if (m.days === 1) return `mañana a las ${m.time}`;
  return `${m.shortDate} a las ${m.time}`;
}

// Date + time of a run: "hoy 09:56", "ayer 04:07", "vie 1 ago 23:10".
// Also on the business's clock: the history and the next run are read one
// below the other and can't be in different offsets. The split lives in
// `lib/labels.ts` because a task's modal and a ticket's modal show the same
// class of date and ended up showing it differently.
const runDateTime = dateAndTime;

// How long a run took. null if it hasn't finished yet (or if the dates don't
// parse): the status chip already accounts for it still being in progress.
function readableDuration(start: string | null | undefined, end: string | null | undefined): string | null {
  if (!start || !end) return null;
  const a = new Date(start).getTime();
  const b = new Date(end).getTime();
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return null;
  const ms = b - a;
  if (ms < 1000) return "<1 s";
  const sec = Math.round(ms / 1000);
  if (sec < 90) return `${sec} s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const rest = min % 60;
  return rest === 0 ? `${h} h` : `${h} h ${rest} min`;
}

// ── Run statuses ──

type Tone = "violet" | "green" | "coral" | "amber" | "neutral";

const RUN_STATUS: Record<string, { label: string; tone: Tone }> = {
  completed: { label: "completada", tone: "green" },
  failed: { label: "falló", tone: "coral" },
  running: { label: "corriendo", tone: "amber" },
  claimed: { label: "arrancando", tone: "amber" },
  unknown: { label: "sin confirmar", tone: "neutral" },
};

function runStatus(status: string | null | undefined): { label: string; tone: Tone } {
  const s = (status ?? "").trim();
  return RUN_STATUS[s] ?? { label: s || "sin estado", tone: "neutral" };
}

// How the result gets delivered. Any new channel the agent adds is shown raw
// rather than hidden.
const CHANNEL_LABEL: Record<string, string> = {
  telegram: "Telegram",
  whatsapp: "WhatsApp",
  email: "Email",
  local: "Queda en el agente",
  // NOTE: `origin` means "to the session the task was created from". If that
  // session is the portal's or the API's, it CANNOT receive messages: the
  // task runs fine and the result reaches nobody, with no warning at all.
  // Verified on 8/5: a salesperson asked for their route sheet every Monday
  // at 7, and the task was left like this -- they would have waited for a
  // message that was never going to exist.
  origin: "A donde se pidió",
};

/** Does this task run with the result reaching nobody? */
const CHANNEL_NO_DESTINATION = new Set(["origin", "local"]);

// ── Page ──

const sortJobs = (jobs: Job[]) => [...jobs].sort((a, b) => a.name.localeCompare(b.name));

// The shell adds no padding: each page wraps its own content.
function Shell({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-4xl px-6 py-6 md:px-8">{children}</div>;
}

// Same status chip on the row and in the detail: one single truth. What it
// says -- including that a green "Activa" can't coexist with "falló" -- is
// decided by `scheduledStatus` in `lib/labels.ts`.
const statusFor = (status: string | null | undefined, active: boolean, failed: boolean) =>
  scheduledStatus({ running: status === "running", paused: !active, failed });

function StatusChip({ status, active, failed }: {
  status?: string | null; active: boolean; failed?: boolean;
}) {
  const { label, tone } = statusFor(status, active, Boolean(failed));
  return <Chip tone={tone}>{label}</Chip>;
}

function Label({ children }: { children: ReactNode }) {
  return (
    <p className="text-[11px] font-bold uppercase tracking-wide text-ink-soft/70">{children}</p>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <Label>{label}</Label>
      <div className="mt-0.5 text-[13px] text-ink">{children}</div>
    </div>
  );
}

/** A task's detail: what it does and how the last few runs went. */
function TaskDetail({ job, flows, detail, error, onRetry, onClose }: {
  job: Job; // the one from the list: it's the only one carrying the full `schedule` object
  flows: Flow[] | null; // to title it with the client's own name, not the slug
  detail: CronDetail | null;
  error: string | null;
  onRetry: () => void;
  onClose: () => void;
}) {
  const d = detail?.job;
  const { readable, raw } = cadence(job);
  const active = d?.enabled ?? job.enabled;
  const status = d?.state ?? job.state;
  const next = active ? readableNext(d?.next_run_at ?? job.next_run_at) : null;
  const model = (d?.model ?? "").trim();
  const channel = (d?.deliver ?? "").trim();
  const prompt = (d?.prompt ?? "").trim();
  const script = (d?.script ?? "").trim();
  const isScript = !prompt && !!script;
  const lastError = d?.last_error ?? job.last_error ?? null;
  const lastStatus = d?.last_status ?? job.last_status;
  const failed = lastStatus != null && lastStatus !== "ok";
  const runs = detail?.runs ?? [];

  return (
    <Modal wide onClose={onClose}>
      <div className="flex items-start justify-between gap-4 border-b border-black/[0.07] px-5 py-4">
        <div className="min-w-0">
          {/* The detail's title used to show the engine's slug
              («flujo-vacunas-vencidas-semanal») while the row that opens it
              already said the client's name. Now it's the same name in both. */}
          <h2 className="text-base font-bold leading-snug text-ink">
            {taskName(job.name, flows)}
          </h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span title={failed ? lastError ?? undefined : undefined}>
              <StatusChip status={status} active={active} failed={failed} />
            </span>
            {/* Paused (or running) AND broken: the chip above accounts for
                the first, this one for the second. A task paused on top of a
                broken run is exactly the one to look at before resuming it. */}
            {failed && !statusFor(status, active, failed).countsAsFailure && (
              <span title={lastError ?? undefined}>
                <Chip tone="coral">la última falló</Chip>
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <CopyLink label="Copiar el link de esta tarea" />
          <IconBtn label="Cerrar" onClick={onClose}>
            <X className="h-4 w-4" />
          </IconBtn>
        </div>
      </div>

      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-5 py-4">
        {error ? (
          <ErrorState message={`No pude abrir el detalle (${error}).`} onRetry={onRetry} />
        ) : !detail ? (
          <Spinner />
        ) : (
          <>
            <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              <Field label="Cada cuánto">
                {readable}
                {raw && raw !== readable && (
                  <span className="ml-1.5 font-mono text-[11px] tabular-nums text-ink-soft/60">
                    {raw}
                  </span>
                )}
              </Field>
              {next && <Field label="Próxima corrida">{next}</Field>}
              {model && (
                <Field label="Modelo">
                  <span className="font-mono text-[12px]">{model}</span>
                </Field>
              )}
              {channel && <Field label="Te llega por">{CHANNEL_LABEL[channel] ?? channel}</Field>}
            </div>

            {/* A cron with no real channel runs perfectly and tells nobody.
                It's the system's most silent failure: better to say it here
                than leave the client waiting on a message that doesn't exist. */}
            {channel && CHANNEL_NO_DESTINATION.has(channel) && (
              <p className="mt-3 flex items-start gap-1.5 rounded-lg border border-c-amber bg-c-amber/30 px-3 py-2 text-[12px] text-c-amber-ink">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  Esta tarea corre, pero <strong>el resultado no te llega por ningún lado</strong>:
                  queda guardado en tu agente. Si querés recibirla, pedinos que le pongamos un
                  canal (Telegram, WhatsApp o correo).
                </span>
              </p>
            )}

            {/* The most valuable part of the detail: the instruction exactly as it runs. */}
            <div className="mt-5">
              <Label>{isScript ? "Corre un script" : "Qué hace esta tarea"}</Label>
              <p className="mt-0.5 text-[12px] text-ink-soft">
                {isScript
                  ? "Esta tarea no pasa por el modelo: ejecuta este script en el servidor de tu agente."
                  : "Es la consigna con la que corre, tal cual se la damos al agente. No es una descripción escrita a mano."}
              </p>
              {prompt || script ? (
                <div className="mt-2 max-h-64 overflow-y-auto rounded-lg bg-black/[0.03] p-3">
                  <p
                    className={`whitespace-pre-wrap break-words leading-relaxed text-ink-soft ${
                      isScript ? "font-mono text-[12px]" : "text-[12.5px]"
                    }`}
                  >
                    {isScript ? script : prompt}
                  </p>
                </div>
              ) : (
                <p className="mt-2 text-[13px] text-ink-soft">
                  Tu agente no guarda una consigna para esta tarea.
                </p>
              )}
            </div>

            <div className="mt-5">
              <Label>Últimas corridas</Label>
              {runs.length === 0 ? (
                <p className="mt-1 text-[13px] text-ink-soft">Todavía no corrió ninguna vez.</p>
              ) : (
                <div className="mt-1 divide-y divide-black/[0.06]">
                  {runs.map((r) => {
                    const when = runDateTime(r.started_at ?? r.claimed_at);
                    const dur = readableDuration(r.started_at ?? r.claimed_at, r.finished_at);
                    const { label, tone } = runStatus(r.status);
                    return (
                      <div key={r.id} className="py-2">
                        <div className="flex items-center gap-2">
                          <span className="text-[13px] text-ink">
                            {when ? (
                              <>
                                {when.date} <span className="tabular-nums">{when.time}</span>
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

export default function TasksPage() {
  const [cfg, setCfg] = useState<PortalConfig | null>(null);
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ id: string; action: Action } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  // Which one is open is decided by the URL (`?scheduled=<id>`).
  const openId = useRouteParam(PARAM.scheduled);
  const [detail, setDetail] = useState<CronDetail | null>(null);
  const [detailErr, setDetailErr] = useState<string | null>(null);
  // Only so each task can carry the name the client gave their flow.
  const [flows, setFlows] = useState<Flow[] | null>(null);
  const requestSeq = useRef(0); // discards detail responses for one no longer being viewed

  const refresh = useCallback((c: PortalConfig) => {
    getJobs(c)
      .then((d) => {
        const list = sortJobs(d?.jobs ?? []);
        // Runs arrive with their own offset: this is where the business's
        // clock comes from for screens that only receive epoch (see
        // `lib/labels.ts`).
        learnUtcOffset(...list.flatMap((j) => [j.next_run_at, j.last_run_at]));
        setJobs(list);
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "sin detalle"));
  }, []);

  useEffect(() => {
    const c = loadConfig();
    if (!c) return; // the layout shows the login
    setCfg(c);
    refresh(c);
    getFlows(c).then((r) => setFlows(r?.flows ?? [])).catch(() => { /* falls back to the slug */ });
    const t = setInterval(() => refresh(c), 30_000);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice]);

  // silent: the background refresh doesn't empty what the client is reading,
  // nor does it throw an error over it if that particular request happens to fail.
  const loadDetail = useCallback(
    (id: string, silent = false) => {
      if (!cfg) return;
      const n = ++requestSeq.current;
      if (!silent) {
        setDetail(null);
        setDetailErr(null);
      }
      getCronDetail(cfg, id)
        .then((d) => {
          if (requestSeq.current !== n) return;
          setDetail(d);
          setDetailErr(null);
        })
        .catch((e: unknown) => {
          if (requestSeq.current !== n || silent) return;
          setDetailErr(describeError(e));
        });
    },
    [cfg],
  );

  useEffect(() => {
    if (openId) loadDetail(openId);
  }, [openId, loadDetail]);

  // Opening and closing is navigating. `loadDetail` already clears the
  // previous detail, so the new modal's first frame doesn't show the other
  // one's runs.
  const openTask = (id: string) => openInRoute({ [PARAM.scheduled]: id });
  const closeTask = useCallback(() => closeInRoute(PARAM.scheduled), []);

  // While the detail is open it also refreshes itself (same cadence as the
  // list): a run triggered from here shows up without a reload.
  useEffect(() => {
    if (!openId) return;
    const t = setInterval(() => loadDetail(openId, true), 30_000);
    return () => clearInterval(t);
  }, [openId, loadDetail]);

  // Modal: Escape closes it, the background doesn't scroll.
  useEffect(() => {
    if (!openId) return;
    const fn = (e: KeyboardEvent) => e.key === "Escape" && closeTask();
    window.addEventListener("keydown", fn);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", fn);
      document.body.style.overflow = "";
    };
  }, [openId, closeTask]);

  const runAction = async (job: Job, action: Action) => {
    if (!cfg) return;
    setConfirm(null);
    setBusy(job.id);
    try {
      const res = await jobAction(cfg, job.id, action);
      const updated: Job | undefined = res?.job;
      if (updated) {
        setJobs((prev) => sortJobs([...(prev ?? []).filter((j) => j.id !== updated.id), updated]));
      }
      setNotice({ text: NOTICE_OK[action](taskName(job.name, flows)), ok: true });
      refresh(cfg);
      if (openId === job.id) loadDetail(job.id, true);
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

  // The detail is anchored to the id: the list refreshes itself and replaces the objects.
  const openJob = openId ? (jobs!.find((j) => j.id === openId) ?? null) : null;

  return (
    <Shell>
      <PageHeader title="Tareas" subtitle="Lo que tu agente hace solo, y cuándo" />

      {openId && jobs !== null && !jobs.some((j) => j.id === openId) && (
        <StaleLinkNotice>
          Esa tarea programada ya no existe — puede que la hayamos sacado o cambiado de
          nombre. Abajo están las que tu agente tiene hoy.
        </StaleLinkNotice>
      )}

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
            const { readable, raw } = cadence(job);
            const lastRun = readableAgo(job.last_run_at);
            const next = job.enabled ? readableNext(job.next_run_at) : null;
            const failed = job.last_status != null && job.last_status !== "ok";
            const inConfirm = confirm?.id === job.id ? confirm : null;
            const isBusy = busy === job.id;

            return (
              <div
                key={job.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 py-3.5 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto]"
              >
                {/* Left: name + human cadence + raw cron. Opens the detail. */}
                <button
                  type="button"
                  onClick={() => openTask(job.id)}
                  className="min-w-0 rounded-lg text-left outline-none transition hover:opacity-70 focus-visible:ring-2 focus-visible:ring-primary/25"
                  title="Ver detalle"
                >
                  {/* spans, not <p>: inside a button the markup has to be inline */}
                  <span className="block truncate text-sm font-semibold text-ink">
                    {taskName(job.name, flows)}
                  </span>
                  {/* The raw cron («0 9 * * 1») used to be shown to the client
                      below the already-translated cadence. It adds nothing
                      they can use and tells them "this isn't for you". It
                      goes in the `title` and NOT in the text: hidden with
                      `sr-only` it would still get read aloud to a blind
                      client, which is worse. */}
                  <span
                    className="block text-[13px] text-ink-soft"
                    title={raw && raw !== readable ? raw : undefined}
                  >
                    {readable}
                  </span>
                </button>

                {/* Center: status + last run */}
                <div className="order-3 col-span-2 flex flex-wrap items-center gap-2 md:order-none md:col-span-1">
                  {/* The engine's raw error still travels in the `title`:
                      it's for us, not for the screen. */}
                  <span title={failed ? job.last_error ?? undefined : undefined}>
                    <StatusChip status={job.state} active={job.enabled} failed={failed} />
                  </span>
                  {lastRun ? (
                    failed ? (
                      <>
                        <span className="text-[12px] text-ink-soft">{lastRun}</span>
                        {/* The standalone "falló" is only needed when the
                            status chip is counting something else (paused,
                            running): that way there's no two chips arguing,
                            and no information gets lost. */}
                        {!statusFor(job.state, job.enabled, failed).countsAsFailure && (
                          <span title={job.last_error ?? undefined}>
                            <Chip tone="coral">falló</Chip>
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-[12px] text-ink-soft">{lastRun} · ok</span>
                    )
                  ) : (
                    <span className="text-[12px] text-ink-soft">todavía no corrió</span>
                  )}
                </div>

                {/* Right: next run + actions (or inline confirmation) */}
                <div className="flex items-center justify-end justify-self-end">
                  {inConfirm ? (
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <span className="text-[13px] text-ink-soft">
                        {CONFIRM_Q[inConfirm.action](taskName(job.name, flows))}
                      </span>
                      <Btn
                        size="sm"
                        kind={inConfirm.action === "pause" ? "danger" : "primary"}
                        disabled={isBusy}
                        onClick={() => runAction(job, inConfirm.action)}
                      >
                        Sí
                      </Btn>
                      <Btn size="sm" kind="ghost" disabled={isBusy} onClick={() => setConfirm(null)}>
                        Cancelar
                      </Btn>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      {next && (
                        <span className="mr-1 text-[12px] text-ink-soft">Próxima {next}</span>
                      )}
                      <IconBtn label="Ver detalle" onClick={() => openTask(job.id)}>
                        <Eye className="h-4 w-4" />
                      </IconBtn>
                      <IconBtn
                        label="Correr ahora"
                        disabled={isBusy}
                        onClick={() => setConfirm({ id: job.id, action: "run" })}
                      >
                        <Zap className="h-4 w-4" />
                      </IconBtn>
                      {job.enabled ? (
                        <IconBtn
                          label="Pausar"
                          disabled={isBusy}
                          onClick={() => setConfirm({ id: job.id, action: "pause" })}
                        >
                          <Pause className="h-4 w-4" />
                        </IconBtn>
                      ) : (
                        <IconBtn
                          label="Reanudar"
                          disabled={isBusy}
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

      {openJob && (
        <TaskDetail
          job={openJob}
          flows={flows}
          detail={detail}
          error={detailErr}
          onRetry={() => loadDetail(openJob.id)}
          onClose={closeTask}
        />
      )}
    </Shell>
  );
}
