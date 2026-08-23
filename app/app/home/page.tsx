"use client";

// Home: the first thing the client sees every day. Answers "what happened
// and what needs my attention?" without forcing them through the eight tabs.
//
// PRINCIPIO CERO: serves any Hermes agent for any client. No specific
// cases: it talks about "your agent", "tasks", "files".
//
// Honesty, which is the rule in charge here:
//   · Each block depends on its module in the manifest. Module off or
//     endpoint returning 404 → the block doesn't exist. Never a made-up zero.
//   · The six sources are requested in parallel (Promise.allSettled) and
//     each one paints as soon as it arrives: a failure takes down its own
//     block, not the screen.
//   · Silent refresh every 60s. If the refresh fails and we already had
//     data, we keep it (stale but true) and say so at the bottom.

import {
  useCallback, useEffect, useMemo, useRef, useState,
  type Dispatch, type ReactNode, type SetStateAction,
} from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  Activity, ArrowRight, CheckCircle2, ChevronRight, Clock, Columns3,
  FolderOpen, Hand, LayoutDashboard, MessageSquare, Plug, Plus, RefreshCw, Workflow,
  type LucideIcon,
} from "lucide-react";
import {
  isClientRequest,
  getActivity, getApprovals, getArtifacts, getConnections, getFiles, getFlows, getJobs,
  getManifest, getSessions, getTickets, loadConfig,
  type ArtifactMeta, type Connection, type CronJob, type Flow, type HttpError,
  type Manifest, type PortalConfig, type Ticket,
} from "../lib/agent";
// The SAME flow ↔ scheduled-task match that Flows uses: if each screen
// picked its own, we'd be back to two answers for "when does it run?".
import { crossTask } from "../flows/runs";
import { HIDDEN_MODULES } from "../layout";
import { Card, Chip, EmptyState, ErrorState, IconBtn, PageHeader, Spinner } from "../lib/ui";
import {
  BOARD_COLUMNS, learnUtcOffset, cronCadence, columnForTask, whenItRuns, timeOf,
  momentOf, artifactLabel, greetingOfTheDay, type TaskColumn, type Tone,
} from "../lib/labels";
import { humanizeRuns } from "../lib/events";
import { agentDisplayName } from "../lib/onboarding";
import { AgentitoLoading, loadAgentLook } from "../lib/agentito";
import type { AgentitoState } from "../lib/AgentitoRive";

// The animated character is only fetched here and in onboarding; the rest
// of the portal doesn't pay for the runtime. While it loads, the same
// face shows, still.
const AgentitoRive = dynamic(() => import("../lib/AgentitoRive"), {
  ssr: false,
  loading: () => <AgentitoLoading />,
});

const WRAP = "mx-auto max-w-5xl px-6 py-6 md:px-8";
const REFRESH_MS = 60_000;
const DELIVERABLES = "entregables/"; // what the agent produces FOR the client

type Approval = {
  id: string; title: string; summary?: string; created_at: string | number;
  /** Needed to tell apart what's waiting for YOUR ok from what you yourself requested. */
  body?: string;
};
type Event = { ts: string; kind: string; label: string; status: string };
type FileEntry = { path: string; size?: number; mtime?: string | number };

/** A source's status: off in the manifest / 404 are the same to the client. */
type Slot<T> =
  | { t: "loading" }
  | { t: "off" }
  | { t: "failed" }
  | { t: "ready"; data: T };

type Setter<T> = Dispatch<SetStateAction<Slot<T>>>;

// ── formatting ────────────────────────────────────────────────────────────

const nf = new Intl.NumberFormat("es-UY");
const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

const is404 = (e: unknown): boolean => {
  const err = e as HttpError | undefined;
  return err?.status === 404 || /^404\b/.test(String(err?.message ?? ""));
};

/** Tolerant: epoch in seconds (number or string), epoch in ms, or ISO. */
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

/** Bare duration ("12 min", "3 días") to build phrases without repeating "hace". */
function duration(v: string | number | undefined): string | null {
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

const ago = (v: string | number | undefined): string | null => {
  const d = duration(v);
  return d ? `hace ${d}` : null;
};

// THIS USED TO BE THE PORTAL'S LAST BROWSER CLOCK, and that was on purpose:
// the greeting isn't about a piece of agent data, it's about the person
// looking at the screen. The blind test on 8/13 read it as a product bug
// —"it's three in the afternoon and the screen greets me with 'Good
// morning'"— and she was right: with the browser in a different timezone
// than the agent, the greeting was the only line on this screen measuring
// with a different yardstick. Now it runs on the business's clock, like
// everything else; the why, at length, is in `greetingOfTheDay` (`lib/labels.ts`).
const greeting = greetingOfTheDay;

/** An event's moment: today just the time; before that, with the day up front.
 *
 *  The run that failed at the agent's 02:58 used to read here as "yesterday
 *  23:58" and in Flows and Activity as "today 02:58": the same run, two
 *  different days, because this screen formatted it with the browser's clock. */
function whenLabel(ts: string): string {
  const m = momentOf(ts);
  if (!m) return "—";
  if (m.days === 0) return m.time;
  if (m.days === -1) return `ayer ${m.time}`;
  return `${m.dayMonth} ${m.time}`;
}

/** ["el tablero", "el consumo"] → "el tablero y el consumo" */
function enumerate(xs: string[]): string {
  if (xs.length <= 1) return xs[0] ?? "";
  return `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`;
}

// Artifact kind → client label. This little table used to live here, another
// in Artifacts, and another in the modal, and all three said different
// things about the same thing: an `other` was "Otro" over there, "Artefacto"
// in the modal, and here it came out raw, in English. Now there's just one,
// in `lib/labels.ts`.
const kindLabel = (k: string) => artifactLabel(k).label;
const kindTone = (k: string) => artifactLabel(k).tone;

/** Deliverable name with no folder and no date, which it usually comes with. */
function deliverableName(path: string): string {
  const base = (path || "").split("/").pop() || path;
  return base.replace(/^\d{4}-\d{2}-\d{2}[-_ ]/, "") || base;
}

// Same criterion as Activity: the raw statuses are many, the dot is three.
// Whatever doesn't fit stays neutral instead of lying about a color.
function dotCls(kind: string, status: string): string {
  const s = (status || "").toLowerCase();
  if (/(^ok$|complet|success|done|deliver|sent|unblock|resolv|entregad|listo)/.test(s)) return "bg-c-green-ink";
  if (/(fail|error|timeout|cancel|reject|rechaz)/.test(s)) return "bg-c-coral-ink";
  if (/(run|progress|pend|claim|start|queue|block|curso|proceso)/.test(s)) return "bg-c-amber-ink";
  return kind === "ticket" ? "bg-c-violet-ink" : "bg-ink-soft/50";
}

// THE SPLIT AND THE NAMES ARE THE KANBAN'S, read from `lib/labels.ts`. A copy
// used to live here with FOUR columns against the kanban's five: the two
// kinds of block —the one waiting for your ok and the request you yourself
// made, which is waiting on us— fell together into one metric called
// "Frenadas" ("Blocked"), a word that didn't exist on any other screen. The
// blind test noted it like this: "On Home the column is called 'Frenadas',
// on the kanban 'Lo estamos viendo', inside the card 'Frenada — espera tu
// respuesta'." Same split, same words, so the numbers on the two screens can
// be checked against each other.
const columnOf = (t: Ticket): TaskColumn =>
  columnForTask(t.status, isClientRequest(t.body));

// The kit's tone → the metric's background. It's paint, not a word.
const BACKGROUND: Record<Tone, string> = {
  violet: "bg-c-violet/50",
  amber: "bg-c-amber/50",
  green: "bg-c-green/50",
  coral: "bg-c-coral/50",
  neutral: "bg-black/[0.04]",
};

// ── pieces ─────────────────────────────────────────────────────────────────

// The kit's Btn is a <button> and here everything navigates: same visual language, <a>.
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

function Section({ title, icon: Icon, href, viewLabel, children }: {
  title: string;
  icon: LucideIcon;
  href: string;
  viewLabel: string;
  children: ReactNode;
}) {
  return (
    <Card className="flex flex-col">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="flex min-w-0 items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
          <Icon className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{title}</span>
        </p>
        <Link
          href={href}
          className="inline-flex shrink-0 items-center gap-0.5 text-[12px] font-semibold text-primary transition hover:text-primary-dark"
        >
          {viewLabel}
          <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </div>
      {children}
    </Card>
  );
}

function Skeleton({ rows = 2 }: { rows?: number }) {
  return (
    <div className="rounded-xl border border-black/[0.07] bg-white p-4">
      <div className="h-2.5 w-24 animate-pulse rounded bg-black/[0.07]" />
      <div className="mt-4 space-y-2.5">
        {Array.from({ length: rows }).map((_, i) => (
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

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-[13px] text-ink-soft">{children}</p>;
}

function Stat({ value, label, tone }: { value: number; label: string; tone: Tone }) {
  return (
    <div className={`rounded-lg px-3 py-2.5 ${BACKGROUND[tone]}`}>
      <p className="text-2xl font-bold leading-none tabular-nums text-ink">{nf.format(value)}</p>
      <p className="mt-1.5 text-[11px] font-medium leading-tight text-ink-soft">{label}</p>
    </div>
  );
}

/** Connections the client's flow needs and is missing: the agent is
 *  installed but its flow can't start — that's said BEFORE anything else,
 *  with the button that solves it. With nothing missing, the block doesn't
 *  exist. */
function StartBlockers({ agentName, missing }: { agentName: string; missing: Connection[] }) {
  if (missing.length === 0) return null;
  const n = missing.length;
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
                ? `A ${agentName} le falta 1 conexión para arrancar tu flujo`
                : `A ${agentName} le faltan ${n} conexiones para arrancar tu flujo`}
            </p>
            <p className="mt-0.5 text-[13px] text-ink-soft">
              {enumerate(missing.map((c) => c.label))}
              {" — "}
              {n === 1 ? missing[0].purpose : "sin eso, esa parte del trabajo queda esperando."}
            </p>
          </div>
        </div>
        <LinkBtn href="/app/connections">
          {n === 1 ? "Conectarla" : "Conectarlas"}
          <ArrowRight className="h-4 w-4" />
        </LinkBtn>
      </div>
    </Card>
  );
}

/** What needs your attention. With something pending, highlighted; with
 *  nothing, calm. */
function NeedsAttention({ pending }: { pending: Approval[] }) {
  const oldest = useMemo(
    () => [...pending].sort((a, b) => toMs(a.created_at) - toMs(b.created_at))[0],
    [pending],
  );

  if (pending.length === 0) {
    return (
      <Card>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-c-green-ink" />
          <p className="text-sm text-ink">No hay nada esperando tu ok.</p>
          <Link
            href="/app/approvals"
            className="ml-auto inline-flex shrink-0 items-center gap-0.5 text-[12px] font-semibold text-primary transition hover:text-primary-dark"
          >
            Ver aprobaciones
            <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </Card>
    );
  }

  const n = pending.length;
  const waiting = duration(oldest?.created_at);
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
            {oldest && (
              <p className="mt-0.5 truncate text-[13px] text-ink-soft">{oldest.title}</p>
            )}
            {waiting && (
              <p className="mt-0.5 text-[12px] text-ink-soft/80">
                {n === 1 ? "Espera" : "La más vieja espera"} desde hace {waiting}
              </p>
            )}
          </div>
        </div>
        <LinkBtn href="/app/approvals">
          {n === 1 ? "Revisar" : `Revisar las ${n}`}
          <ArrowRight className="h-4 w-4" />
        </LinkBtn>
      </div>
    </Card>
  );
}

/* ── When a job runs: what it RUNS, not what's written ───────────────────────
   HOME AND FLOWS USED TO SAY TWO DIFFERENT DAYS FOR THE SAME JOB. Verbatim,
   from the blind test on 8/13: "Now Flows says 'Every Thursday at 8:30 ·
   Next time: 8/20 at 08:30', but Home still says 'Weekly contract check —
   Every Friday at 9:30'. Which one do I believe?".

   There are two sources: the text the agent declared in its FLOW.md
   (`client_summary`, which is what shows here) and the task the engine has
   SCHEDULED (`/api/jobs`). When the client asks to change the schedule,
   what's guaranteed to change is the cron; the text updates if the agent
   remembers to.

   Rule: the home screen NEVER repeats the declared cadence. Either it says
   the scheduled one —the one that's actually going to happen— or it says
   none. The flow's phrase keeps showing in full minus its schedule clause,
   which is the only part that can lie. Reproduced and measured against the
   real functions; see the report.

   A flow with no cron ("whenever you ask me", a delivery to Drive) has
   nothing to contradict itself with: that one shows exactly as it was. */

// The schedule clause these phrases start with: "Todos los viernes a las
// 9:30 …", "Los lunes y miércoles a las 18:00 …", "El primer día de cada
// mes a las 9:00 …". The cut point is the time; what follows is what the
// job DOES.
const DECLARED_CADENCE =
  /^\s*(?:todos los|todas las|los|las|cada|el|una vez (?:por|al)|de)\b[^.;:]{0,60}?\ba las?\s+\d{1,2}(?::\d{2})?(?:\s*(?:h|hs|horas))?\b[,.]?\s*/i;
// The same clause when it carries no time ("Una vez por mes te dejo…"): a
// short, closed list, so it doesn't eat the start of a phrase that isn't a cadence.
const FREQUENCY_ONLY =
  /^\s*(?:una vez (?:por|al) (?:mes|semana|d[ií]a)|todos los d[ií]as|todas las semanas|cada (?:semana|mes|d[ií]a))\b[,.]?\s*/i;

/** The flow's phrase with its schedule clause removed. If removing it
 *  leaves no real phrase, the original is returned: we'd rather repeat than mutilate. */
function withoutCadence(text: string): string {
  const s = (text || "").trim();
  const short = s.replace(DECLARED_CADENCE, "").replace(FREQUENCY_ONLY, "").trim();
  if (short.length < 15) return s;
  return short.charAt(0).toUpperCase() + short.slice(1);
}

/** When this job runs ACCORDING TO THE ENGINE. `null` = nothing can be
 *  claimed (couldn't read the scheduled tasks, or the flow isn't schedule-based). */
function engineSchedule(f: Flow, jobs: CronJob[] | null): string | null {
  if (f.trigger_type !== "schedule" || !jobs) return null;
  // The same match Flows makes, so the two screens look at the SAME
  // scheduled task and can't pick differently.
  const match = crossTask(f, jobs);
  if (match.kind !== "task") {
    // Says it runs at a set time and there's no scheduled task to trigger it.
    // Same fact that Flows puts on its "Not scheduled" banner.
    return "Hoy no está agendado: no va a correr solo.";
  }
  const job = match.job;
  if (job.enabled === false || job.state === "paused") return "En pausa.";
  const cadence = cronCadence(job.schedule?.expr ?? job.schedule_display);
  if (cadence) return `${cadence}.`;
  // An odd cron we don't know how to put into words: the next run is
  // always certain, and it's the same phrase Flows uses.
  const next = whenItRuns(job.next_run_at);
  return next ? `Próxima vez: ${next}.` : null;
}

/** "What does this thing do for me?" — the question the portal didn't
 *  answer on any screen. Built from the client's flows and their own text. */
function WhatItDoes({ flows, jobs }: { flows: Flow[]; jobs: CronJob[] | null }) {
  const active = flows.filter((f) => f.status !== "paused").slice(0, 4);
  if (active.length === 0) {
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
    <Section title="Qué hace por vos" icon={Workflow} href="/app/flows" viewLabel="Ver todos">
      <ul className="flex flex-col gap-2">
        {active.map((f) => {
          const runs = engineSchedule(f, jobs);
          // A scheduled job ALWAYS has the declared cadence stripped, even
          // when we couldn't read the scheduled tasks: not being able to
          // verify it doesn't make it more true, and there the screen just
          // goes without saying when (the footer already warns what
          // couldn't be fetched). An on-request flow isn't touched: it has
          // nothing to contradict itself with.
          const text = f.trigger_type === "schedule"
            ? withoutCadence(f.client_summary)
            : f.client_summary;
          return (
            <li key={f.slug} className="flex gap-2">
              <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-primary/70" />
              <div className="min-w-0">
                <p className="text-[13px] leading-relaxed text-ink-soft">
                  <span className="font-semibold text-ink">{f.name}</span>
                  {text ? ` — ${text}` : ""}
                </p>
                {runs && (
                  <p className="mt-0.5 flex items-center gap-1.5 text-[12px] text-ink-soft/85">
                    <Clock className="h-3 w-3 shrink-0" />
                    {runs}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

// ── screen ─────────────────────────────────────────────────────────────────

export default function HomePage() {
  const [cfg, setCfg] = useState<PortalConfig | null>(null);
  useEffect(() => { setCfg(loadConfig()); }, []);

  // The layout handles login when there's no config.
  if (!cfg) return <div className={WRAP}><Spinner /></div>;
  return <HomeBody cfg={cfg} />;
}

function HomeBody({ cfg }: { cfg: PortalConfig }) {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [failed, setFailed] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const hadManifest = useRef(false);

  const [connections, setConnections] = useState<Slot<Connection[]>>({ t: "loading" });
  const [approvals, setApprovals] = useState<Slot<Approval[]>>({ t: "loading" });
  const [tickets, setTickets] = useState<Slot<Ticket[]>>({ t: "loading" });
  const [events, setEvents] = useState<Slot<Event[]>>({ t: "loading" });
  const [artifacts, setArtifacts] = useState<Slot<ArtifactMeta[]>>({ t: "loading" });
  const [files, setFiles] = useState<Slot<FileEntry[]>>({ t: "loading" });
  const [flows, setFlows] = useState<Slot<Flow[]>>({ t: "loading" });
  // The engine's scheduled tasks: the only ones that know when each job
  // truly runs. See `engineSchedule`.
  const [jobs, setJobs] = useState<Slot<CronJob[]>>({ t: "loading" });
  // And conversations: without this, "last activity" doesn't count the
  // message the client just wrote. See `lastSignal`.
  const [chats, setChats] = useState<Slot<number>>({ t: "loading" });

  const load = useCallback((silent = false) => {
    if (!silent) {
      setFatal(null);
      setConnections({ t: "loading" });
      setApprovals({ t: "loading" });
      setTickets({ t: "loading" });
      setEvents({ t: "loading" });
      setArtifacts({ t: "loading" });
      setFiles({ t: "loading" });
      setFlows({ t: "loading" });
      setJobs({ t: "loading" });
      setChats({ t: "loading" });
    }
    setLoading(true);

    // Each source is independent: it paints as soon as it arrives and, if
    // it fails, it only takes down its own block. No waiting for the
    // slowest one to show something.
    const failedNames: string[] = [];
    const request = <T,>(
      enabled: boolean,
      name: string,
      fetcher: () => Promise<T>,
      set: Setter<T>,
    ): Promise<void> => {
      if (!enabled) { set({ t: "off" }); return Promise.resolve(); }
      return fetcher().then(
        (data) => { set({ t: "ready", data }); },
        (e: unknown) => {
          if (is404(e)) { set({ t: "off" }); return; } // the agent doesn't expose this
          failedNames.push(name);
          // If we already had data, we keep it: stale, but true.
          set((s) => (s.t === "ready" ? s : { t: "failed" }));
        },
      );
    };

    getManifest(cfg)
      .then((m) => {
        hadManifest.current = true;
        setManifest(m);
        setFatal(null);
        // A hidden module is treated as if the agent didn't expose it:
        // neither requested nor drawn. `request(false, …)` leaves it at
        // "off", so no skeleton stays loading forever waiting for data
        // nobody went looking for.
        const on = (k: string) => !HIDDEN_MODULES.has(k) && Boolean(m?.modules?.[k]);
        return Promise.allSettled([
          // Only worth requesting if the adapter says there's something pending.
          request(on("connections") && (m?.pending_connections ?? 0) > 0, "las conexiones",
            () => getConnections(cfg).then((r) => arr<Connection>(r?.connections)), setConnections),
          // WHAT'S WAITING FOR YOUR OK, not everything in the queue. The
          // requests the client herself made ("connect my email") live in
          // the same list and are waiting on US: their card says "you don't
          // have to do anything". The filter got added to the sidebar
          // badge and not here, and the home screen was left saying "3
          // things waiting for your ok" with the menu showing 2, on the
          // same screen. It's the same filter, in one single place, in
          // `lib/agent.ts`.
          request(on("approvals"), "las aprobaciones",
            () => getApprovals(cfg)
              .then((r) => arr<Approval>(r?.approvals).filter((a) => !isClientRequest(a.body))),
            setApprovals),
          request(on("kanban"), "el tablero",
            () => getTickets(cfg).then((r) => arr<Ticket>(r?.tickets)), setTickets),
          // Activity is the only one that arrives with a utc offset, so
          // that's where the rest of the portal gets the business's clock
          // from (`lib/labels.ts`).
          request(on("activity"), "la actividad",
            () => getActivity(cfg).then((r) => {
              const evs = arr<Event>(r?.events);
              learnUtcOffset(...evs.map((e) => e.ts));
              return evs;
            }), setEvents),
          request(on("artifacts"), "los artefactos",
            () => getArtifacts(cfg).then((r) => arr<ArtifactMeta>(r?.artifacts)), setArtifacts),
          request(on("files"), "los archivos",
            () => getFiles(cfg).then((r) => arr<FileEntry>(r?.files)), setFiles),
          request(on("flows"), "tus trabajos",
            () => getFlows(cfg).then((r) => arr<Flow>(r?.flows)), setFlows),
          // When each job runs. Comes from the native gateway, not the
          // adapter: doesn't depend on any manifest module, but with no
          // flows there's nothing to match it against.
          request(on("flows"), "cuándo corren tus trabajos",
            () => getJobs(cfg).then((r) => arr<CronJob>(r?.jobs)), setJobs),
          // THE LAST SIGN OF LIFE IS ALSO CHATS. `/portal/activity` is the
          // kanban and the crons and nothing else (verified endpoint by
          // endpoint: it only emits `ticket` and `job_run`), so a message
          // from the client a minute ago didn't count. Measured on 8/13
          // against the Zaguán agent: the newest activity was 23 minutes
          // old and the conversation, 0.
          request(true, "las conversaciones",
            () => getSessions(cfg).then((r) => {
              const sessions = arr<{ last_active?: number; started_at?: number }>(r?.data);
              const ms = sessions.map((s) => toMs(s.last_active ?? s.started_at ?? 0));
              // 0 sessions is a valid piece of data —the agent was just
              // installed—, not a failure: it returns 0 and the signal
              // falls back to activity.
              return ms.length ? Math.max(...ms) : 0;
            }), setChats),
        ]);
      })
      .then(() => { setFailed(failedNames); setLastUpdated(new Date()); })
      .catch((e: Error) => {
        // With no manifest we don't know what exists: that's when it IS the whole screen.
        if (!silent || !hadManifest.current) setFatal(e.message || "error");
      })
      .finally(() => setLoading(false));
  }, [cfg]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const id = setInterval(() => load(true), REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  // ── derived ──
  const board = useMemo(() => {
    if (tickets.t !== "ready") return null;
    const counts: Record<TaskColumn, number> =
      { todo: 0, inProgress: 0, waiting: 0, ours: 0, done: 0 };
    for (const t of tickets.data) counts[columnOf(t)]++;
    // The requests column only shows up if the client has ever asked for
    // something, same as on the kanban: on a freshly installed agent it
    // would be a fifth metric stuck at zero forever.
    const columns = BOARD_COLUMNS.filter((c) => c.key !== "ours" || counts.ours > 0);
    return { counts, columns, total: tickets.data.length };
  }, [tickets]);

  const latest = useMemo(() => {
    if (events.t !== "ready") return null;
    // THE CRON'S SLUG IS NOT A NAME. This used to show `flujo-vacunas-
    // vencidas-semanal` and `flujo-avisos-ayuno-cirugias` as-is, on the
    // product's FIRST screen, while Activity —with the same data— already
    // showed the name the client gave their job. Same humanizer, in
    // `lib/events.ts`.
    const humanized = humanizeRuns(
      events.data, flows.t === "ready" ? flows.data : null);
    // A task leaves several events in a row (created, commented, blocked)
    // and here they showed up as five identical rows: the client reads
    // "the same thing four times" and stops trusting the numbers. In the
    // day's summary, the last thing that happened to each thing is enough;
    // the full detail, with its status, stays in Activity.
    const seen = new Set<string>();
    return humanized
      .slice()
      .sort((a, b) => toMs(b.ts) - toMs(a.ts))
      .filter((e) => {
        const k = `${e.kind}|${(e.label || "").trim().toLowerCase()}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .slice(0, 5);
  }, [events, flows]);

  const recent = useMemo(() => {
    if (artifacts.t !== "ready") return null;
    return [...artifacts.data]
      .sort((a, b) => toMs(b.created_at) - toMs(a.created_at))
      .slice(0, 3);
  }, [artifacts]);

  const deliverables = useMemo(() => {
    if (files.t !== "ready") return null;
    return files.data
      .filter((f) => (f.path || "").replace(/^\/+/, "").startsWith(DELIVERABLES))
      .sort((a, b) => toMs(b.mtime) - toMs(a.mtime))
      .slice(0, 3);
  }, [files]);

  /** "last activity 5 min ago", counting EVERYTHING the agent did: the
   *  kanban, the runs, and the conversations.
   *
   *  AND ONLY IF IT CAN BE CLAIMED. With one of the two sources down, the
   *  number would come out short —exactly the bug the blind test found,
   *  "it says '24 min ago' when I'd just written to it"—, and a "24 min
   *  ago" that lies is worse than saying nothing. A source that's off in
   *  the manifest DOES count as answered: there, what exists is all there
   *  is. */
  const lastSignal = useMemo(() => {
    const answered = (s: Slot<unknown>) => s.t === "ready" || s.t === "off";
    if (!answered(events) || !answered(chats)) return null;
    const fromEvents = latest && latest.length > 0 ? toMs(latest[0].ts) : 0;
    const fromChats = chats.t === "ready" ? chats.data : 0;
    const ms = Math.max(fromEvents, fromChats);
    return ms > 0 ? ago(ms) : null;
  }, [events, chats, latest]);

  // ── The agentito as a status indicator ──
  // Lazy and not in an effect: otherwise the first frame paints it with the
  // default look and there's a violet flicker before the client's own look.
  const [look] = useState(loadAgentLook);

  const pendingCount = approvals.t === "ready" ? approvals.data.length : null;
  // "calm" only if we know there's nothing; if the data hasn't
  // arrived, not even then.
  const agentState: AgentitoState =
    pendingCount === null ? "normal" : pendingCount > 0 ? "waiting" : "calm";

  // Celebrates when something new it produced shows up (an artifact or a
  // deliverable). The first load doesn't count: there it hasn't done
  // anything yet, we're just finding out.
  const produced = useMemo(() => {
    if (artifacts.t !== "ready" || files.t !== "ready") return null;
    const delivered = files.data.filter(
      (f) => (f.path || "").replace(/^\/+/, "").startsWith(DELIVERABLES)).length;
    return artifacts.data.length + delivered;
  }, [artifacts, files]);
  const [celebrations, setCelebrations] = useState(0);
  const producedPrev = useRef<number | null>(null);
  useEffect(() => {
    if (produced === null) return;
    if (producedPrev.current !== null && produced > producedPrev.current) {
      setCelebrations((f) => f + 1);
    }
    producedPrev.current = produced;
  }, [produced]);

  if (fatal) {
    return (
      <div className={WRAP}>
        <PageHeader title={greeting()} />
        <ErrorState message={fatal} onRetry={() => load()} />
      </div>
    );
  }

  if (!manifest) return <div className={WRAP}><Spinner /></div>;

  const slots = [approvals, tickets, events, artifacts, files, flows];
  // Chats don't build their own block, but the life signal waits for them:
  // without this the line stays mute for an instant instead of saying it's looking.
  const waitingForData = slots.some((s) => s.t === "loading") || chats.t === "loading";
  const nothing = slots.every((s) => s.t === "off" || s.t === "failed");

  // Status line: says what we know and nothing more.
  const statusLine = [`${agentDisplayName(manifest)}, tu agente`];
  if (lastSignal) statusLine.push(`última actividad ${lastSignal}`);
  else if (waitingForData) statusLine.push("buscando novedades…");

  const producedBlocks = [
    recent && recent.length > 0 ? "artefactos" : null,
    deliverables && deliverables.length > 0 ? "entregables" : null,
  ].filter(Boolean);

  return (
    <div className={WRAP}>
      {/* The agentito here isn't decoration: it says how things are going.
          If something's waiting for your ok it looks toward the badge; if
          there's nothing, it pours itself some mate. */}
      <div className="mb-6 flex items-start gap-3 sm:gap-4">
        {/* The size goes out here, not in the component: next/dynamic's
            placeholder doesn't take a className and would end up full-screen. */}
        <div className="-mt-1 h-16 w-16 shrink-0 sm:h-[72px] sm:w-[72px]">
          <AgentitoRive
            celebrations={celebrations}
            look={look}
            state={agentState}
            className="h-full w-full"
          />
        </div>
        <div className="min-w-0 flex-1">
          <PageHeader
            title={greeting()}
            subtitle={statusLine.join(" · ")}
            actions={
              <>
                {lastUpdated && (
                  <span className="hidden text-xs tabular-nums text-ink-soft sm:inline">
                    Actualizado {timeOf(lastUpdated.getTime())}
                  </span>
                )}
                <IconBtn label="Actualizar" disabled={loading} onClick={() => load(true)}>
                  <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                </IconBtn>
              </>
            }
          />
        </div>
      </div>

      {nothing ? (
        <EmptyState
          icon={Hand}
          title="Tu agente todavía no publica novedades"
          hint="Cuando habilite sus módulos, el resumen del día aparece acá."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {/* 0 · If the flow can't start, that goes before everything else */}
          {connections.t === "ready" && (
            <StartBlockers
              agentName={manifest.agent}
              missing={connections.data.filter((c) => c.required && c.status !== "connected")}
            />
          )}

          {/* 1 · What needs your attention, above everything */}
          {approvals.t === "loading" && <Skeleton rows={2} />}
          {approvals.t === "ready" && <NeedsAttention pending={approvals.data} />}

          {/* 1.5 · WHAT IT DOES FOR YOU. This was missing and it was the
              first thing a new client looks for: "no screen says what this
              thing does for ME". We didn't make it up: these are their
              flows, with the text already written for them. If they don't
              have any yet, we say so and show where to ask for one. */}
          {flows.t === "ready" && (
            <WhatItDoes flows={flows.data} jobs={jobs.t === "ready" ? jobs.data : null} />
          )}

          {/* 2 · How the kanban is doing */}
          {tickets.t === "loading" && <Skeleton rows={1} />}
          {board && (
            <Section title="Tablero" icon={Columns3} href="/app/pipeline" viewLabel="Ver el tablero">
              {board.total === 0 ? (
                <Empty>Todavía no hay tareas en el tablero.</Empty>
              ) : (
                <div
                  className={`grid grid-cols-2 gap-2 ${
                    board.columns.length === 5 ? "sm:grid-cols-5" : "sm:grid-cols-4"
                  }`}
                >
                  {board.columns.map((c) => (
                    <Stat
                      key={c.key}
                      value={board.counts[c.key]}
                      label={c.label}
                      tone={c.tone}
                    />
                  ))}
                </div>
              )}
            </Section>
          )}

          {/* 3 · What it's been doing */}
          {events.t === "loading" && <Skeleton rows={4} />}
          {latest && (
            <Section title="Qué estuvo haciendo" icon={Activity} href="/app/activity" viewLabel="Ver todo">
              {latest.length === 0 ? (
                <Empty>Todavía no registró actividad.</Empty>
              ) : (
                <ul className="-my-1">
                  {latest.map((e, i) => (
                    <li key={`${e.ts}-${e.status}-${i}`} className="flex items-center gap-2.5 py-1.5">
                      <span className="shrink-0 whitespace-nowrap text-[12px] tabular-nums text-ink-soft">
                        {whenLabel(e.ts)}
                      </span>
                      <span className={`h-2 w-2 shrink-0 rounded-full ${dotCls(e.kind, e.status)}`} />
                      <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{e.label}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          )}

          {/* 4 · The last thing it produced */}
          {(artifacts.t === "loading" || files.t === "loading") && <Skeleton rows={3} />}
          {producedBlocks.length > 0 && (
            <div className={`grid gap-3 ${producedBlocks.length > 1 ? "md:grid-cols-2" : ""}`}>
              {recent && recent.length > 0 && (
                <Section title="Lo último que produjo" icon={LayoutDashboard} href="/app/artifacts" viewLabel="Ver entregas">
                  <ul className="-my-1">
                    {recent.map((a) => (
                      <li key={a.id} className="flex items-center gap-2 py-1.5">
                        <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{a.title}</span>
                        <span className="shrink-0">
                          <Chip tone={kindTone(a.kind)}>{kindLabel(a.kind)}</Chip>
                        </span>
                      </li>
                    ))}
                  </ul>
                </Section>
              )}

              {deliverables && deliverables.length > 0 && (
                <Section title="Archivos nuevos para vos" icon={FolderOpen} href="/app/files" viewLabel="Ver archivos">
                  <ul className="-my-1">
                    {deliverables.map((f) => (
                      <li key={f.path} className="flex items-center gap-2 py-1.5">
                        <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
                          {deliverableName(f.path)}
                        </span>
                        {ago(f.mtime) && (
                          <span className="shrink-0 whitespace-nowrap text-[11px] text-ink-soft">
                            {ago(f.mtime)}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </Section>
              )}
            </div>
          )}

          {/* "Consumo" ("Usage") used to live here. It left on 8/16/2026:
              we still don't know how we're going to charge the client, and
              showing them a dollar figure before that's been defined
              answers a question nobody asked — with a number that was
              also wrong on top of it (see PENDING). */}
        </div>
      )}

      {/* 6 · Quick access */}
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

      {failed.length > 0 && (
        <p className="mt-4 text-[12px] text-ink-soft">
          Recién no pude traer {enumerate(failed)}. Te muestro el resto de lo que tengo.
        </p>
      )}
    </div>
  );
}
