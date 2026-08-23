"use client";

// Flujos: the client's jobs, with a name and results. This is the tab that
// answers "what does my agent do for me" with not one machine word -- the
// conclusion from the WIRED article applied to the portal (8/7, with Luis):
// the client does not want to see crons or scripts; they want to see their
// flows and what they produce. The cron, the skills and the folders are the
// HOW and stay below.
//
// Contract (adapter ≥0.29): GET {adapter}/portal/flows →
//   { available, flows: [{ slug, name, client_summary, trigger_type,
//     trigger, status, missing_connections, last_run, results,
//     results_total }] }
//
// Results are shown as file chips (EntityChip): the same viewer as the chat,
// zero new preview code.
//
// AND SINCE 8/13 IT TELLS THE TRUTH ABOUT THE LAST RUN. This screen exists so
// the client can stop thinking about it; showing "Activo" in green over two
// flows that had already failed did exactly the opposite. The cross-check
// with the engine's tasks (`/api/jobs`) lives in `runs.ts`.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle, ArrowRight, Clock, FolderOpen, MessageSquare, RefreshCw,
  WifiOff, Workflow, Zap, type LucideIcon,
} from "lucide-react";
import {
  connectionLabel, getConnections, getFlows, getJobs, loadConfig,
  type Connection, type CronJob, type Flow, type HttpError, type PortalConfig,
} from "../lib/agent";
import {
  crossTask, inFlight, realStatus, sortByUrgency, summarizeFlows,
  resumePauseQueue, useRuns, runOf, type RealStatus,
} from "./runs";
import { FlowActions, StatusBanner, Runs, WhyItCouldNot } from "./FlowStatus";
import { EntityProvider } from "../lib/EntityViewer";
import { EntityChip } from "../lib/entities";
import { ExampleCarousel, buildChatLink } from "../lib/flowExamples";
import {
  Card, ErrorState, IconBtn, PageHeader, Spinner,
} from "../lib/ui";

type Failure = { status?: number; message: string };

const WRAP = "mx-auto max-w-5xl px-6 py-6 md:px-8";
const REFRESH_MS = 30_000;
// After a button press the engine takes a moment to write the new status: a
// second read at 6 s keeps "Probarlo ahora" from looking like it did nothing.
const REREAD_MS = 6_000;

const is404 = (f: Failure) => f.status === 404 || /^404\b/.test(f.message);

const TRIGGER_ICON: Record<string, LucideIcon> = {
  drive: FolderOpen,
  schedule: Clock,
  webhook: Zap,
  request: MessageSquare,
};

function timeAgo(mtime: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000 - mtime));
  if (s < 3600) return `hace ${Math.max(1, Math.floor(s / 60))} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  const d = Math.floor(s / 86400);
  return d === 1 ? "ayer" : `hace ${d} días`;
}

function fileName(path: string): string {
  const base = (path || "").split("/").pop() || path;
  return base.replace(/^\d{4}-\d{2}-\d{2}[-_ ]/, "") || base;
}

/** What this flow is missing, what it is called and what it is for. */
function MissingConnection({ ids, connections }: {
  ids: string[]; connections: Connection[] | null;
}) {
  const names = ids.map((id) => connectionLabel(id, connections));
  const why = ids
    .map((id) => connections?.find((c) => c.id === id)?.purpose)
    .filter(Boolean) as string[];
  return (
    <div className="rounded-lg border border-c-amber bg-c-amber/25 p-3">
      <p className="text-[13px] font-semibold text-c-amber-ink">
        Le falta {names.length === 1 ? names[0] : names.join(" y ")}.
      </p>
      {why.length > 0 && (
        <p className="mt-1 text-[12.5px] leading-relaxed text-c-amber-ink/85">
          {why.join(" ")}
        </p>
      )}
      <Link
        href={`/app/connections?connection=${encodeURIComponent(ids[0])}`}
        className="mt-2.5 inline-flex h-9 w-fit items-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-semibold text-white transition hover:bg-primary-dark"
      >
        Conectar {names[0]}
        <ArrowRight className="h-4 w-4" />
      </Link>
    </div>
  );
}

function FlowCard({ f, e, cfg, connections, onChange }: {
  f: Flow;
  e: RealStatus;
  cfg: PortalConfig;
  connections: Connection[] | null;
  onChange: () => void;
}) {
  const Icon = TRIGGER_ICON[f.trigger_type] ?? Workflow;
  return (
    <Card className="flex flex-col gap-2.5">
      <div className="flex items-start justify-between gap-3">
        <Link
          href={`/app/flows/${f.slug}`}
          className="text-[16px] font-bold leading-snug text-ink underline-offset-4 transition hover:text-primary hover:underline"
        >
          {f.name}
        </Link>
        <span className="shrink-0"><StatusBanner e={e} /></span>
      </div>

      {f.client_summary && (
        <p className="text-sm leading-relaxed text-ink-soft">{f.client_summary}</p>
      )}

      {f.trigger && (
        <p className="flex items-center gap-1.5 text-[12px] text-ink-soft/90">
          <Icon className="h-3.5 w-3.5 shrink-0" />
          {f.trigger}
        </p>
      )}

      {/* Ran / didn't run / when the next one is. The three questions the
          card did not answer while it said "Activo" in green. */}
      <Runs e={e} />

      {/* THE REAL REASON FIRST, ALWAYS. This used to be a ternary: if a
          connection was missing, `WhyItCouldNot` was not drawn and the real
          cause disappeared. At Faro that showed up as "Le falta correo ·
          Conectar correo" over a run that had failed for a different reason:
          the client connects the email and it fails again. */}
      <WhyItCouldNot cfg={cfg} e={e} name={f.name} onChange={onChange} />

      {/* The missing connection, SECOND and separate: it is the one thing the
          client can unblock on their own, but it is not a diagnosis. And with
          NAME and REASON: "Conectar lo que falta" says neither what is
          missing nor what for, and on reaching Conexiones the client got lost
          among six cards not knowing which was theirs. The "what for" comes
          from the catalog, which already has it written in plain words -- we
          do not make it up here. */}
      {e.missingConnections.length > 0 && (
        <MissingConnection ids={e.missingConnections} connections={connections} />
      )}

      {f.results.length > 0 && (
        <div>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
            Resultados
            <span className="ml-1.5 tabular-nums text-ink-soft/70">{f.results_total}</span>
          </p>
          <ul className="flex flex-col gap-1">
            {f.results.slice(0, 5).map((r) => (
              <li key={r.path} className="flex items-center gap-2">
                <span className="min-w-0 flex-1">
                  <EntityChip
                    entity={{ kind: "file", path: r.path }}
                    label={fileName(r.path)}
                  />
                </span>
                <span className="shrink-0 whitespace-nowrap text-[11px] text-ink-soft">
                  {timeAgo(r.mtime)}
                </span>
              </li>
            ))}
          </ul>
          {f.results_total > 5 && (
            <Link
              href="/app/files"
              className="mt-1.5 inline-block text-[12px] font-semibold text-primary transition hover:text-primary-dark"
            >
              Ver todos en Archivos
            </Link>
          )}
        </div>
      )}

      {/* "Todavía no produjo resultados" (Hasn't produced results yet) over a
          flow that ran and failed was the same lie said quietly: there it is
          not that it hasn't produced yet, it is that it couldn't. It stays
          quiet whenever there is something to say -- even paused, which is
          how a broken flow the client stopped ends up looking. */}
      {!e.note && e.missingConnections.length === 0 && !e.unconfirmed && f.results.length === 0 && (
        <p className="text-[12px] text-ink-soft/80">
          Todavía no produjo resultados: van a aparecer acá solos.
        </p>
      )}

      <FlowActions cfg={cfg} e={e} name={f.name} trigger={f.trigger} onChange={onChange} />
    </Card>
  );
}

/** Can I stop thinking about this? The question the veterinary client walked
 *  in and out with no answer to. One line above everything, and only when
 *  there is something to say: when all is well the screen stays quiet and the
 *  cards do the talking.
 *
 *  THE TEXT IS BUILT IN `runs.ts`, next to the statuses it counts. This is
 *  where the last lie left on this screen used to live -- "N no pudieron
 *  terminar la última vez" (N failed to finish last time) over delayed or
 *  cron-less flows that had run fine -- and the count could not be tested
 *  without mounting React. */
function Summary({ statuses }: { statuses: RealStatus[] }) {
  const text = summarizeFlows(statuses);
  if (!text) return null;
  return (
    <div className="mb-4 flex items-start gap-2 rounded-lg border border-c-coral bg-c-coral/25 px-3 py-2.5">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-c-coral-ink" />
      <p className="text-[13px] font-medium leading-snug text-c-coral-ink">{text}</p>
    </div>
  );
}

/** Without the cross-check against `/api/jobs` the screen runs on partial
 *  data, and it says so. Verified with the gateway down: a paused flow looked
 *  "Activo", the buttons disappeared with no explanation and there was not a
 *  single word that half the screen was missing. */
function NoCrossCheck() {
  return (
    <div className="mb-4 flex items-start gap-2 rounded-lg border border-c-amber bg-c-amber/25 px-3 py-2.5">
      <WifiOff className="mt-0.5 h-4 w-4 shrink-0 text-c-amber-ink" />
      <p className="text-[13px] font-medium leading-snug text-c-amber-ink">
        No pude confirmar el estado con tu agente. Abajo está lo último que sé —
        puede haber cambiado, y no puedo decirte si alguno quedó en pausa.
      </p>
    </div>
  );
}

function NoFlows() {
  return (
    <div>
      <div className="mx-auto max-w-xl text-center">
        <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-c-violet">
          <Workflow className="h-5 w-5 text-primary" />
        </div>
        <h2 className="text-[19px] font-bold tracking-tight text-ink">
          Todavía no hay nada corriendo solo
        </h2>
        <p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-ink-soft">
          Un flujo es un trabajo que tu agente hace sin que se lo pidas: se ocupa
          cada vez que corresponde y te deja el resultado acá para que lo revises.
          Estos son ejemplos de lo que le pide otra gente — el tuyo va a salir de
          contarle a qué te dedicás.
        </p>
      </div>

      <div className="mt-7"><ExampleCarousel /></div>

      <div className="mt-6 flex flex-col items-center gap-2">
        <Link
          href={buildChatLink(
            "Quiero que te encargues de algo que se repite en mi empresa. " +
            "Proponeme dos o tres cosas que podrías hacer solo, de a una por " +
            "vez, y armamos la que más me sirva.")}
          className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-white transition hover:bg-primary-dark"
        >
          Contarle lo mío
        </Link>
        <span className="text-[12px] text-ink-soft">
          O tocá uno de arriba y lo armamos a partir de ahí.
        </span>
      </div>
    </div>
  );
}

export default function FlowsPage() {
  const [cfg, setCfg] = useState<PortalConfig | null>(null);
  const [flows, setFlows] = useState<Flow[] | null>(null);
  // The engine's scheduled tasks: they are the ones that know when the next
  // one runs, why the last one failed and whether it is paused. If the
  // gateway does not answer, `jobs` stays null and the card falls back to the
  // adapter's `last_run`: it says less, but still does not lie.
  const [jobs, setJobs] = useState<CronJob[] | null>(null);
  const [error, setError] = useState<Failure | null>(null);
  const [loading, setLoading] = useState(false);
  // Only so the missing connection can be named and its purpose said.
  const [connections, setConnections] = useState<Connection[] | null>(null);

  useEffect(() => setCfg(loadConfig()), []);

  useEffect(() => {
    if (!cfg) return;
    getConnections(cfg)
      .then((r) => setConnections(r.connections ?? []))
      .catch(() => { /* without the catalog we fall back to the known labels */ });
  }, [cfg]);

  const load = useCallback(() => {
    if (!cfg) return;
    setLoading(true);
    getJobs(cfg)
      .then((r) => setJobs(Array.isArray(r?.jobs) ? r.jobs : []))
      .catch(() => setJobs(null));
    getFlows(cfg)
      .then((r) => { setFlows(r?.flows ?? []); setError(null); })
      .catch((e: HttpError) => setError({ status: e?.status, message: e?.message || "error" }))
      .finally(() => setLoading(false));
  }, [cfg]);

  // After pausing, resuming or triggering: now and again in a bit.
  const reread = useCallback(() => {
    load();
    const t = setTimeout(load, REREAD_MS);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!cfg) return;
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [cfg, load]);

  // A re-pause left mid-way (an F5 right between "run" and "pause") is
  // resumed on entry: the pause cannot depend on the tab having stayed open.
  // See the guardian in `runs.ts`.
  useEffect(() => { if (cfg) resumePauseQueue(cfg, load); }, [cfg, load]);

  // Runs the portal itself fired and the engine has not noted yet: while they
  // are in flight the card has to say it is working, not show the previous
  // run with the button enabled.
  const v = useRuns();
  const withStatus = useMemo(
    () => sortByUrgency(
      (flows ?? []).map((f) => {
        const cross = crossTask(f, jobs);
        const jobId = cross.kind === "task" ? cross.job.id : null;
        return {
          flow: f,
          status: realStatus(f, cross, { portalTriggered: inFlight(runOf(jobId)) }),
        };
      })),
    // `v` is the flight registry's version: it changes with every transition.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [flows, jobs, v],
  );

  if (!cfg) return <div className={WRAP}><Spinner /></div>;

  const body = () => {
    if (error && flows === null) {
      if (is404(error)) {
        return <NoFlows />;
      }
      return <ErrorState message={error.message} onRetry={load} />;
    }
    if (flows === null) return <Spinner />;
    if (flows.length === 0) return <NoFlows />;
    return (
      <>
        {jobs === null && <NoCrossCheck />}
        <Summary statuses={withStatus.map((x) => x.status)} />
        <div className="grid items-start gap-3 md:grid-cols-2">
          {withStatus.map(({ flow, status }) => (
            <FlowCard
              key={flow.slug}
              f={flow}
              e={status}
              cfg={cfg}
              connections={connections}
              onChange={reread}
            />
          ))}
        </div>
      </>
    );
  };

  return (
    <EntityProvider cfg={cfg}>
      <div className={WRAP}>
        <PageHeader
          title="Flujos"
          subtitle="Los trabajos que tu agente hace por vos, y lo que producen"
          actions={
            <IconBtn label="Actualizar" disabled={loading} onClick={load}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </IconBtn>
          }
        />
        {body()}
      </div>
    </EntityProvider>
  );
}
