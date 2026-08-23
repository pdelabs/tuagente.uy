"use client";

// Activity: everything the agent did, in chronological order.
// Contract (adapter v0.3): GET {adapter}/portal/activity →
//   { events: [{ ts, kind: "job_run" | "ticket", label, status }] }
// Grouped by day (Today/Yesterday/date), silent refresh every 30s.
//
// Ticket events carry the ticket's TITLE but not its id: we resolve it by
// cross-referencing /portal/tickets (title→id map, fetched once and refreshed
// only on demand). If the ticket isn't in that list — archived or deleted —
// the event isn't clickable and we don't show anything weird.
//
// WHY THIS SCREEN SAID "NO ACTIVITY YET" (blind QA, 8/12).
// An accountant set up three flows and had it write three documents, came in
// here and read "No activity yet. When your agent does something, you'll see
// it here." Her conclusion was worse than the bug: "if the log lies to me
// while I'm watching, I'm not going to believe it when I'm not."
//
// It wasn't a broken query: `/portal/activity` has TWO sources and only two —
// cron runs (`executions`) and kanban events (`task_events`). She had neither:
// her flows hadn't run yet (first run on 8/17) and her kanban was empty.
// Everything her agent did, it did by conversing: writing files and setting
// up flows leaves NO row in either of those two tables. Verified on 8/13
// against the lab agent: `/portal/activity` returned ONE event while
// `/portal/files` had four files and the session had 128 messages.
//
// Fixed without touching the agent: the other two sources are already
// published and the portal already uses them in other tabs. Here they get
// added to the same timeline —what it wrote (`/portal/files`) and when they
// talked (`/api/sessions`)— so the log can't come up empty while there was
// work.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Activity, ChevronRight, RefreshCw, Search } from "lucide-react";
import {
  getActivity,
  getFiles,
  getFlows,
  getJobs,
  getSessions,
  getTickets,
  loadConfig,
  type CronJob,
  type Flow,
  type PortalConfig,
} from "../lib/agent";
import { EntityProvider } from "../lib/EntityViewer";
import { useOpenEntity } from "../lib/entities";
import { loadAgentName } from "../lib/onboarding";
import {
  Btn, Card, Chip, EmptyState, ErrorState, IconBtn, PageHeader, SUPPORT, Spinner, inputCls,
} from "../lib/ui";
import {
  learnUtcOffset, isFromRecentDays, isMachineEvent, timeOf, utcOffsetOf, isoWithOffset,
  momentOf, channelLabel, eventLabel,
} from "../lib/labels";
import {
  isHumanConversation, humanizeRuns, type AgentEvent,
} from "../lib/events";

type ActivityEvent = AgentEvent;
/** The adapter's raw statuses are many; for filtering, three are enough…
 *  plus `none`, which is where events with no result fall (a written
 *  document, a conversation). See `GROUPS`. */
type Group = "ok" | "error" | "progress" | "none";
type RangeKey = "today" | "7d" | "30d" | "all";

const REFRESH_MS = 30_000;
const PAGE_SIZE = 30; // events per batch
const WRAP = "mx-auto max-w-4xl px-6 py-6 md:px-8";

// Adapter's raw kind → readable label (the chips come from the data).
// `archivo` and `conversacion` are built by the portal: see the note above.
const KIND_LABEL: Record<string, string> = {
  job_run: "Trabajo automático",
  ticket: "Tarea",
  archivo: "Documento",
  conversacion: "Conversación",
};

// The status arrives raw from the engine and in English. It now comes from
// the portal's single dictionary (`lib/labels.ts`), the same one the
// ticket's history and the chat use: one word per thing across the whole
// product. And with the name the client gave the agent: "Your agent picked
// it up" is from before they'd named it.
const statusLabel = (s: string, agentName: string) => eventLabel(s, agentName);

// THE FOUR ADD UP TO THE TOTAL, AND THAT'S THE POINT OF THE FOURTH ONE. The
// row said «All 41 · Good 9 · Errored 2 · In progress 3» and 9+2+3 doesn't
// add up to 41: the missing 27 are the events with no result —what it
// wrote, the conversations—, which didn't fit in any chip and so looked
// lost. A counter that doesn't add up is a counter the client stops
// believing.
const GROUPS: { key: Group; label: string; dot: [string, string] }[] = [
  // dot: [inactive, active] — the light tone goes over the active chip (ink background).
  { key: "ok", label: "Bien", dot: ["bg-c-green-ink", "bg-c-green"] },
  { key: "error", label: "Con error", dot: ["bg-c-coral-ink", "bg-c-coral"] },
  { key: "progress", label: "En curso", dot: ["bg-c-amber-ink", "bg-c-amber"] },
  // The same gray that `dotCls` gives these events in the list.
  { key: "none", label: "Sin estado", dot: ["bg-ink-soft/50", "bg-white/60"] },
];

const RANGES: { key: RangeKey; label: string; days: number | null }[] = [
  { key: "today", label: "Hoy", days: 1 },
  { key: "7d", label: "7 días", days: 7 },
  { key: "30d", label: "30 días", days: 30 },
  { key: "all", label: "Todo", days: null },
];

/** Raw status → one of the three groups, or none (informational events). */
function groupOf(status: string): Exclude<Group, "none"> | null {
  const s = (status || "").toLowerCase();
  if (/(^ok$|complet|success|done|deliver|sent|unblock|resolv|entregad|listo)/.test(s)) return "ok";
  if (/(fail|error|timeout|cancel|reject|rechaz)/.test(s)) return "error";
  if (/(run|progress|pend|claim|start|queue|block|curso|proceso)/.test(s)) return "progress";
  return null;
}

/** The same criterion, but with NO hole: events with no result fall into
 *  `none` instead of nowhere. It's the only thing that makes the row's chips
 *  add up to the total its own "All" reports. */
const filterGroup = (status: string): Group => groupOf(status) ?? "none";

// Puntito de estado: verde OK · coral falla · ámbar en curso ·
// violeta evento de ticket neutral · gris resto.
function dotCls(kind: string, status: string): string {
  const g = groupOf(status);
  if (g === "ok") return "bg-c-green-ink";
  if (g === "error") return "bg-c-coral-ink";
  if (g === "progress") return "bg-c-amber-ink";
  return kind === "ticket" ? "bg-c-violet-ink" : "bg-ink-soft/50";
}

/** Comparison insensitive to case, accents and extra spaces. */
const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();

const msOf = (ts: string) => {
  const t = new Date(ts).getTime();
  return Number.isNaN(t) ? 0 : t;
};

/** Hermes emits created_at as epoch in seconds; the contract also allows string. */
function createdMs(value: string | number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (Number.isFinite(n) && n > 0) return n > 1e12 ? n : n * 1000;
  const d = new Date(String(value)).getTime();
  return Number.isNaN(d) ? 0 : d;
}

/** Does it fall within the chosen range? "7 days" is 7 calendar days
 *  counting today, and the business counts the days.
 *
 *  THIS FILTER WAS HIDING THE BUG FROM THE CLIENT. It computed midnight with
 *  the browser's `new Date()` while the section titles already counted the
 *  days over there: from Mexico, tapping "Today" cut the list off at the
 *  agent's 03:00, left the "Errored" counter at 0, and made the run that had
 *  failed at 02:58 disappear — with the section still titled "TODAY". */
function inRange(ts: string, key: RangeKey): boolean {
  const days = RANGES.find((r) => r.key === key)?.days;
  if (!days) return true;
  return isFromRecentDays(ts, days);
}

// The hour and day are the BUSINESS's, not the browser's: the 02:37 run in
// Montevideo can't show up under "Yesterday 23:37" just because whoever's
// looking opened the portal from another timezone. See the long note in
// `lib/labels.ts`.
function hourLabel(ts: string): string {
  return timeOf(ts) || "—";
}

function dayKey(ts: string): string {
  const m = momentOf(ts);
  return m ? String(m.days) : "—";
}

function dayLabel(ts: string): string {
  const m = momentOf(ts);
  if (!m) return "Sin fecha";
  if (m.days === 0) return "Hoy";
  if (m.days === -1) return "Ayer";
  return m.shortDate;
}

const is404 = (msg: string) => /^404\b/.test(msg);

/* ── The sources that were missing ────────────────────────────────────────── */

const SCRIPT_EXT = /\.(py|sh|bash|zsh|rb|pl|js|mjs|cjs|ts|tsx|jsx|ipynb)$/i;
const INBOX_PREFIX = "entrada/";

/** The file's name, with no date up front and no folder trailing behind. */
const fileName = (path: string) => {
  const base = (path || "").split("/").pop() || path;
  return base.replace(/^\d{4}-\d{2}-\d{2}[-_ ]/, "").replace(/\.[a-z0-9]+$/i, "") || base;
};

/** What the agent wrote, as events. The scaffolding (its own scripts,
 *  `interno/`) stays out: what goes here is what the client recognizes as work. */
function eventsFromFiles(
  files: { path: string; mtime: number }[] | null, utcOffset: number,
): ActivityEvent[] {
  if (!files) return [];
  return files
    .filter((f) => {
      const p = f.path || "";
      return p && !p.startsWith("interno/") && !SCRIPT_EXT.test(p);
    })
    .slice(0, 60)
    .map((f) => ({
      ts: isoWithOffset(f.mtime * 1000, utcOffset),
      kind: "archivo",
      // Who put it there matters: `entrada/` is what the client uploads, and
      // saying "your agent wrote" about the CSV she uploaded would be a cheap lie.
      label: (f.path.startsWith(INBOX_PREFIX) ? "Recibió " : "Escribió ") + `«${fileName(f.path)}»`,
      status: "",
      href: `/app/files?file=${encodeURIComponent(f.path)}`,
    }));
}

type RawSession = {
  id?: string; source?: string; started_at?: number; last_active?: number;
  message_count?: number; title?: string | null; preview?: string;
};

/** Each conversation, one line. A session with 128 messages is ONE fact for
 *  the client ("we talked on Tuesday"), not a hundred and twenty-eight.
 *
 *  WHAT COUNTS AS A CONVERSATION is decided by `lib/events.ts`, the same
 *  criterion the Chat uses. There used to be a copy here that only looked at
 *  the channel: the session for the portal's internal notices ("client
 *  commented on ticket t_…") came in as «Conversation via Portal» and its
 *  link landed on an empty conversation, because the Chat —with the good
 *  criterion— hides it. Activity counted 5 conversations and the Chat 4. */
function eventsFromSessions(sessions: RawSession[] | null, utcOffset: number): ActivityEvent[] {
  if (!sessions) return [];
  return sessions
    .filter((s) =>
      (s.message_count ?? 0) > 0
      && (s.started_at || s.last_active)
      && isHumanConversation(s))
    .slice(0, 40)
    .map((s) => {
      // The quote is what the client wrote. Anything that starts with a
      // bracketed label is a machine prompt with ids she can't search
      // anywhere: the row goes without a quote before it gets that one.
      const p = (s.preview ?? "").trim();
      const quote = p && !p.startsWith("[") ? `: «${p.slice(0, 70)}…»` : "";
      return {
        ts: isoWithOffset((s.started_at ?? s.last_active ?? 0) * 1000, utcOffset),
        kind: "conversacion",
        label: `Conversación por ${channelLabel(s.source ?? "")}${quote}`,
        status: "",
        href: s.id ? `/app/chat?conversation=${encodeURIComponent(s.id)}` : undefined,
      };
    });
}

function FilterChip({ active, onClick, count, children }: {
  active: boolean;
  onClick: () => void;
  count?: number;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold transition ${
        active
          ? "bg-ink text-white"
          : "bg-black/[0.05] text-ink-soft hover:bg-black/[0.08] hover:text-ink"
      }`}
    >
      {children}
      {count !== undefined && (
        <span className={active ? "tabular-nums text-white/60" : "tabular-nums text-ink-soft/60"}>
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

/** One line of the history. With a ticketId or an href, the whole row opens something. */
function Row({ ev, ticketId, times = 1, agentName }: {
  ev: ActivityEvent; ticketId?: string; times?: number; agentName: string;
}) {
  const open = useOpenEntity();
  const body = (
    <>
      <span className="w-12 shrink-0 text-[12px] tabular-nums text-ink-soft">
        {hourLabel(ev.ts)}
      </span>
      <span className={`mt-1.5 h-2 w-2 shrink-0 self-start rounded-full ${dotCls(ev.kind, ev.status)}`} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-ink">{ev.label}</span>
        {/* The line the vet couldn't open. Now the reason is written right
            here, in plain terms, without having to go dig for it. */}
        {ev.reason && (
          <span className="block truncate text-[12px] text-c-coral-ink">{ev.reason}</span>
        )}
      </span>
      <span className="flex shrink-0 items-center gap-2 self-start pt-0.5">
        <Chip>{KIND_LABEL[ev.kind] ?? ev.kind}</Chip>
        {ev.status && (
          <span className="text-[11px] text-ink-soft">
            {statusLabel(ev.status, agentName)}
            {times > 1 && <span className="ml-1 tabular-nums text-ink-soft/70">×{times}</span>}
          </span>
        )}
      </span>
    </>
  );

  const ROW = "flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-black/[0.03]";

  if (ticketId && open) {
    return (
      <li>
        <button onClick={() => open({ kind: "ticket", id: ticketId })} title="Ver la tarea" className={ROW}>
          {body}
          <ChevronRight className="h-4 w-4 shrink-0 self-start text-ink-soft/50" />
        </button>
      </li>
    );
  }

  if (ev.href) {
    return (
      <li>
        <Link href={ev.href} className={ROW}>
          {body}
          <ChevronRight className="h-4 w-4 shrink-0 self-start text-ink-soft/50" />
        </Link>
      </li>
    );
  }

  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      {body}
      {/* same width as the chevron: keeps the columns aligned */}
      <span className="w-4 shrink-0" />
    </li>
  );
}

export default function ActivityPage() {
  const [cfg, setCfg] = useState<PortalConfig | null>(null);
  useEffect(() => { setCfg(loadConfig()); }, []);

  // The layout handles login when there's no config.
  if (!cfg) return <div className={WRAP}><Spinner /></div>;
  return (
    <EntityProvider cfg={cfg}>
      <ActivityBody cfg={cfg} />
    </EntityProvider>
  );
}

function ActivityBody({ cfg }: { cfg: PortalConfig }) {
  const [events, setEvents] = useState<ActivityEvent[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null); // a refresh failed, data is stale
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [ticketIds, setTicketIds] = useState<Map<string, string>>(new Map());
  // The sources the adapter doesn't mix into /portal/activity. None of them
  // is mandatory: if one fails, the timeline just loses that row and continues.
  const [files, setFiles] = useState<{ path: string; mtime: number }[] | null>(null);
  const [sessions, setSessions] = useState<RawSession[] | null>(null);
  const [flows, setFlows] = useState<Flow[] | null>(null);
  const [jobs, setJobs] = useState<CronJob[] | null>(null);
  const hasData = useRef(false);

  const [kind, setKind] = useState<string | null>(null);
  const [group, setGroup] = useState<Group | null>(null);
  const [search, setSearch] = useState("");
  const [range, setRange] = useState<RangeKey>("all");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [showTechnical, setShowTechnical] = useState(false);

  const load = useCallback((silent = false) => {
    if (!silent) { setEvents(null); setErr(null); }
    setLoading(true);
    getActivity(cfg)
      .then((r) => {
        hasData.current = true;
        setEvents(Array.isArray(r.events) ? r.events : []);
        setErr(null);
        setNotice(null);
        setLastUpdated(new Date());
      })
      .catch((e: Error) => {
        // On a silent refresh, if we already have data, we keep it.
        if (!silent || !hasData.current) setErr(e.message || "error");
        else setNotice(e.message || "error");
      })
      .finally(() => setLoading(false));
  }, [cfg]);

  // Title→id map so we can open the ticket that originated each event.
  // If the tickets module isn't there or fails, there just aren't any links.
  const loadTickets = useCallback(() => {
    getTickets(cfg)
      .then((r) => {
        const list = Array.isArray(r.tickets) ? r.tickets : [];
        // Newest first: on a repeated title, the most recent ticket wins.
        const sorted = [...list].sort((a, b) => createdMs(b.created_at) - createdMs(a.created_at));
        const m = new Map<string, string>();
        for (const t of sorted) {
          const k = norm(t.title || "");
          if (k && !m.has(k)) m.set(k, t.id);
        }
        setTicketIds(m);
      })
      .catch(() => { /* with no tickets there's nowhere to go: stays as is */ });
  }, [cfg]);

  // Everything else the agent did. Each on its own and without breaking
  // anything: an old agent that doesn't publish one of these simply contributes less.
  const loadExtras = useCallback(() => {
    getFiles(cfg).then((r) => setFiles(Array.isArray(r?.files) ? r.files : [])).catch(() => {});
    getSessions(cfg)
      .then((r) => setSessions(Array.isArray(r?.data) ? r.data : []))
      .catch(() => {});
    getFlows(cfg).then((r) => setFlows(r?.flows ?? [])).catch(() => {});
    getJobs(cfg).then((r) => setJobs(Array.isArray(r?.jobs) ? r.jobs : [])).catch(() => {});
  }, [cfg]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadTickets(); }, [loadTickets]);
  useEffect(() => { loadExtras(); }, [loadExtras]);

  useEffect(() => {
    const t = setInterval(() => { load(true); loadExtras(); }, REFRESH_MS);
    return () => clearInterval(t);
  }, [load, loadExtras]);

  const refresh = useCallback(
    () => { load(true); loadTickets(); loadExtras(); },
    [load, loadTickets, loadExtras],
  );

  // Changing any filter takes us back to the first batch.
  useEffect(() => { setLimit(PAGE_SIZE); }, [kind, group, search, range]);

  // THE SCREEN SAID "everything your agent did, in order" and showed twelve
  // identical rows for the same task with `dependency_wait / spawned /
  // promoted / heartbeat`. QA read that as "it hung, and on top of that I
  // don't understand any of it". Machine steps stay behind a toggle.
  // What clock the agent lives on. Its own dates say so (they come with a
  // utc offset); the files' and sessions' `mtime` don't, so we lend it to
  // them. And along the way it gets learned for the screens that only
  // receive epoch —a task's modal, approvals—: see `lib/labels.ts`.
  const utcOffset = useMemo(() => {
    for (const e of events ?? []) { const o = utcOffsetOf(e.ts); if (o !== null) return learnUtcOffset(e.ts); }
    for (const j of jobs ?? []) {
      const o = utcOffsetOf(j.next_run_at) ?? utcOffsetOf(j.last_run_at);
      if (o !== null) return learnUtcOffset(j.next_run_at, j.last_run_at);
    }
    return -new Date().getTimezoneOffset();
  }, [events, jobs]);

  const all = useMemo(
    () => [
      ...humanizeRuns(events ?? [], flows, jobs),
      ...eventsFromFiles(files, utcOffset),
      ...eventsFromSessions(sessions, utcOffset),
    ].sort((a, b) => msOf(b.ts) - msOf(a.ts)),
    [events, flows, jobs, files, sessions, utcOffset],
  );
  const technicalCount = useMemo(
    () => all.filter((e) => isMachineEvent(e.status)).length, [all]);
  const sortedEvents = useMemo(
    () => (showTechnical ? all : all.filter((e) => !isMachineEvent(e.status))),
    [all, showTechnical],
  );

  // Available types: the ones that actually came in, sorted by label.
  const kinds = useMemo(() => {
    const set = new Set(sortedEvents.map((e) => e.kind).filter(Boolean));
    return Array.from(set).sort((a, b) =>
      (KIND_LABEL[a] ?? a).localeCompare(KIND_LABEL[b] ?? b, "es"),
    );
  }, [sortedEvents]);

  const groupsPresent = useMemo(() => {
    const set = new Set(sortedEvents.map((e) => filterGroup(e.status)));
    return GROUPS.filter((g) => set.has(g.key));
  }, [sortedEvents]);

  // Date + search first: the chips are counted on top of this base.
  const base = useMemo(() => {
    const q = norm(search);
    return sortedEvents.filter((e) => {
      if (!inRange(e.ts, range)) return false;
      if (q && !norm(e.label || "").includes(q)) return false;
      return true;
    });
  }, [sortedEvents, range, search]);

  // WHAT EACH NUMBER COUNTS. Each chip says how many events you'd see IF YOU
  // TAPPED IT: that's why the "Type" row is counted over whatever the status
  // filter let through, and vice versa. That's correct and stays —tapping a
  // chip can't lead to a list of a different size than the one it
  // advertised—, but it left two loose readings and neither was the list
  // below: with "Today" + "Errored" active at once, «TYPE: All 2» and
  // «STATUS: All 41» coexisted across two rows on screen, and the client
  // didn't know which of the two numbers was hers. Fixed without lying to
  // either: the groups add up (see `filterGroup`) and right at the top it
  // says, in plain words, how many events she's looking at.
  const byGroup = useMemo(
    () => (group ? base.filter((e) => filterGroup(e.status) === group) : base),
    [base, group],
  );
  const byKind = useMemo(
    () => (kind ? base.filter((e) => e.kind === kind) : base),
    [base, kind],
  );
  const visible = useMemo(
    () =>
      base.filter(
        (e) => (!kind || e.kind === kind) && (!group || filterGroup(e.status) === group),
      ),
    [base, kind, group],
  );

  const shown = useMemo(() => visible.slice(0, limit), [visible, limit]);
  const filtering = kind !== null || group !== null || search.trim() !== "" || range !== "all";
  const clearFilters = () => { setKind(null); setGroup(null); setSearch(""); setRange("all"); };

  // And repeats get merged: the same task with the same status back to back
  // is one row with "×3", not three rows that look like a loop.
  const dayGroups = useMemo(() => {
    const out: { key: string; label: string; items: { ev: ActivityEvent; times: number }[] }[] = [];
    for (const ev of shown) {
      const key = dayKey(ev.ts);
      let last = out[out.length - 1];
      if (!last || last.key !== key) {
        out.push({ key, label: dayLabel(ev.ts), items: [] });
        last = out[out.length - 1];
      }
      const previous = last.items[last.items.length - 1];
      if (previous && previous.ev.label === ev.label && previous.ev.status === ev.status
          && previous.ev.kind === ev.kind) {
        previous.times += 1;
      } else {
        last.items.push({ ev, times: 1 });
      }
    }
    return out;
  }, [shown]);

  const idFor = (ev: ActivityEvent) =>
    ev.kind === "ticket" ? ticketIds.get(norm(ev.label || "")) : undefined;

  // What the agent is called for this client: they named it. "Your agent
  // picked it up" was the generic label on the screen of someone who'd
  // already given it a name.
  const agentName = loadAgentName() || "Tu agente";

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
            {lastUpdated && (
              // Also in the business's clock: otherwise "Updated 09:15" sits
              // next to an 11:52 row and it looks like the portal is showing
              // the future.
              <span className="hidden text-xs text-ink-soft sm:inline">
                Actualizado {timeOf(lastUpdated.getTime())}
              </span>
            )}
            <IconBtn label="Actualizar" disabled={loading} onClick={refresh}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </IconBtn>
          </>
        }
      />

      {notice && (
        <p className="mb-4 inline-flex items-center rounded-lg border border-c-coral bg-c-coral/40 px-3 py-1.5 text-[12px] font-medium text-c-coral-ink">
          No pude actualizar recién ({notice}). Te muestro lo último que tengo.
        </p>
      )}

      {/* The empty state is measured against the ENTIRE timeline, not one of
          its sources: saying "no activity yet" while looking only at crons
          and the kanban is what made this screen declare itself empty next
          to three freshly written documents. */}
      {!events ? (
        <Spinner />
      ) : sortedEvents.length === 0 ? (
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
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar en la actividad…"
                  className={`${inputCls} pl-8`}
                />
              </div>
              <div className="flex-1" />
              <div className="inline-flex items-center gap-0.5 rounded-lg border border-black/10 bg-white p-0.5">
                {RANGES.map((r) => (
                  <button
                    key={r.key}
                    onClick={() => setRange(r.key)}
                    aria-pressed={range === r.key}
                    className={`rounded-md px-2 py-1 text-[12px] font-semibold transition ${
                      range === r.key
                        ? "bg-ink text-white"
                        : "text-ink-soft hover:bg-black/[0.05] hover:text-ink"
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>

            {/* THE NUMBER THAT'S HERS, SAID ONCE. Each chip counts what would
                happen if you tapped it; this line counts what's below, right
                now. It only shows up when something is actually filtering
                —otherwise it would repeat the total three times—. */}
            {visible.length !== base.length && (
              <div className="flex flex-wrap items-center gap-1.5">
                <Caption>En pantalla</Caption>
                <span className="text-[11px] font-semibold tabular-nums text-ink">
                  {visible.length} de {base.length} eventos
                </span>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              {kinds.length > 1 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <Caption>Tipo</Caption>
                  <FilterChip active={kind === null} onClick={() => setKind(null)} count={byGroup.length}>
                    Todos
                  </FilterChip>
                  {kinds.map((k) => (
                    <FilterChip
                      key={k}
                      active={kind === k}
                      onClick={() => setKind(kind === k ? null : k)}
                      count={byGroup.filter((e) => e.kind === k).length}
                    >
                      {KIND_LABEL[k] ?? k}
                    </FilterChip>
                  ))}
                </div>
              )}

              {groupsPresent.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <Caption>Estado</Caption>
                  <FilterChip active={group === null} onClick={() => setGroup(null)} count={byKind.length}>
                    Todos
                  </FilterChip>
                  {groupsPresent.map((g) => {
                    const active = group === g.key;
                    return (
                      <FilterChip
                        key={g.key}
                        active={active}
                        onClick={() => setGroup(active ? null : g.key)}
                        count={byKind.filter((e) => filterGroup(e.status) === g.key).length}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${g.dot[active ? 1 : 0]}`} />
                        {g.label}
                      </FilterChip>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {visible.length === 0 ? (
            <>
              <EmptyState
                icon={Activity}
                title="No hay eventos con estos filtros"
                hint="Probá ampliar el rango de fechas o limpiar la búsqueda."
              />
              <div className="flex justify-center">
                <Btn kind="ghost" size="sm" onClick={clearFilters}>Limpiar filtros</Btn>
              </div>
            </>
          ) : (
            <>
              {/* Seeing "failed" three times with no explanation leaves the
                  client with the worry and nothing to do about it. We can't
                  invent the cause (the engine doesn't expose it here), but we
                  can say what we DO know: that no work gets lost, and who's
                  watching. */}
              {group === "error" && (
                <p className="mb-4 rounded-lg border border-c-amber bg-c-amber/25 px-3 py-2 text-[13px] leading-relaxed text-c-amber-ink">
                  Que algo falle acá no significa que se haya perdido trabajo: las tareas
                  programadas se vuelven a intentar en la próxima corrida. Si una misma
                  falla se repite, la miramos nosotros.{" "}
                  <a
                    href={SUPPORT.whatsapp}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold underline underline-offset-2"
                  >
                    Escribinos si querés que la revisemos ahora
                  </a>.
                </p>
              )}
              <div className="flex flex-col gap-6">
                {dayGroups.map((g) => (
                  <section key={g.key}>
                    <h2 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
                      {g.label}
                    </h2>
                    <Card className="overflow-hidden !p-0">
                      <ul className="divide-y divide-black/[0.06]">
                        {g.items.map(({ ev, times }, i) => (
                          <Row
                            key={`${ev.ts}-${ev.status}-${i}`}
                            ev={ev}
                            times={times}
                            ticketId={idFor(ev)}
                            agentName={agentName}
                          />
                        ))}
                      </ul>
                    </Card>
                  </section>
                ))}
              </div>

              {/* The engine's internal steps: they exist, they're not
                  hidden, but they don't compete with what the client came to see. */}
              {technicalCount > 0 && (
                <div className="mt-4 flex justify-center">
                  <button
                    onClick={() => setShowTechnical((v) => !v)}
                    className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12px] text-ink-soft transition hover:bg-black/[0.04] hover:text-ink"
                  >
                    {showTechnical
                      ? "Ocultar los pasos internos"
                      : `Ver los pasos internos de tu agente (${technicalCount})`}
                  </button>
                </div>
              )}

              <div className="mt-6 flex flex-col items-center gap-2">
                {shown.length < visible.length ? (
                  <>
                    <Btn
                      kind="secondary"
                      size="sm"
                      onClick={() => setLimit((n) => n + PAGE_SIZE)}
                    >
                      Cargar más
                    </Btn>
                    <p className="text-[12px] text-ink-soft">
                      Mostrando {shown.length} de {visible.length} eventos
                    </p>
                  </>
                ) : (
                  <p className="text-[12px] text-ink-soft">
                    {filtering
                      ? `Estos son todos los eventos que coinciden (${visible.length} de ${sortedEvents.length}).`
                      : `Estos son los últimos ${sortedEvents.length} eventos que guarda tu agente.`}
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
