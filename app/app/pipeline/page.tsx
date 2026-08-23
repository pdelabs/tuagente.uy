"use client";

// Pipeline — kanban of the agent's tickets (GET {adapter}/portal/tickets)
// + detail with comments (GET {adapter}/portal/tickets/{id}).
// No longer read-only: the client creates tickets, comments, and moves
// statuses. GENERIC: titles, tenants, statuses, authors and events are shown
// exactly as they arrive; zero domain parsing. The agent's long prose
// (description and comments) comes in markdown and is drawn with <Markdown>
// -- the same renderer as the chat, with sanitized HTML. The board's cards
// stay in plain text.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  Archive,
  Check,
  CircleCheck,
  CirclePause,
  Inbox,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  SearchX,
  Unlock,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  loadConfig,
  createTicket,
  commentTicket,
  setTicketStatus,
  approve,
  getTickets,
  getTicketDetail,
  isTheClient,
  isTheSystem,
  isConnectionBlock,
  isClientRequest,
  readComment,
  authorLabel,
  type PortalConfig,
  type Ticket,
  type TicketComment,
  type TicketDetail,
  type TicketOutcome,
} from "../lib/agent";
import { loadAgentName } from "../lib/onboarding";
import {
  BOARD_COLUMNS, columnForTask, isMachineEvent, taskStatus, timeOf,
  momentOf, eventLabel, type TaskColumn, type Tone,
} from "../lib/labels";
import { AgentitoAvatar, loadAgentLook } from "../lib/agentito";
import { CopyLink, PARAM, openInRoute, closeInRoute, useRouteParam } from "../lib/routes";
import {
  Btn,
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
import { EntityProvider } from "../lib/EntityViewer";
import { EntityChip } from "../lib/entities";
import { RoleChip, useRoles } from "../lib/roles";

const REFRESH_MS = 30_000;
const NO_TENANT = "__sin_tenant__"; // sentinel for tickets with a null tenant

/* ── Authorship ──────────────────────────────────────────────────────────── */

/** What the portal signs the client's own writing with. */
const CLIENT_AUTHOR = "cliente";

// WHO THE CLIENT IS AND HOW AN AUTHOR IS LABELED IS DECIDED BY `lib/agent.ts`,
// and nobody else. They used to live here, with their own set of "own
// authors" and their own `authorLabel`, and the two got out of sync with the
// lib: `user` was the client over there and not here (the same line read
// «user · Lo rechazaste»), and the good label -- the one that resolves a
// third party's name -- existed only on this screen while Approvals, where
// authorization happens, showed a third party as if it were the agent.
const isOwn = isTheClient;
const labelFor = (author: string) => authorLabel(author, loadAgentName() || "Tu agente");

// Events come from the portal's single dictionary (`lib/labels.ts`): the
// same word in the history, in Activity, and in the chat. There used to be a
// half-built table here, and anything not in it came out raw and in English
// -- "commented", "dependency_wait", "tip_scratch_workspace" -- in the middle
// of a Spanish-language screen.
const ticketEventLabel = (kind: string) =>
  eventLabel(kind, loadAgentName() || "Tu agente");

/* ── Portal writes ────────────────────────────────────────────────────────
   TODO: these three functions SHOULD GRADUATE to ../lib/agent.ts, which is
   the portal's only network point. They live here because another agent is
   touching lib/ in parallel. When moved: they're the same `post()` as the
   lib, with one difference worth keeping -- they read the body's `{error}`
   so it can be shown to the client (the lib today only throws the status).
   Contract:
     POST /portal/tickets                {title, body?, tenant?} → {ok, id}
     POST /portal/tickets/{id}/comment   {body, author?}         → {ok}
     POST /portal/tickets/{id}/status    {status}                → {ok}
   ──────────────────────────────────────────────────────────────────────── */

type TargetStatus = "done" | "blocked" | "ready" | "archived";

function describeError(e: unknown): string {
  const status = (e as { status?: number } | null)?.status;
  if (status === 404) return "Tu agente todavía no expone esta acción (falta actualizarlo).";
  if (status === 401 || status === 403) return "Tu sesión venció: volvé a entrar con tu link.";
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes("Failed to fetch") || msg.includes("NetworkError"))
    return "No hay conexión con tu agente.";
  return msg;
}

/* ── Board ──────────────────────────────────────────────────────────────── */

type ColKey = TaskColumn;

// What color each column's dot is. This one really is the screen's call:
// it's paint, not a word.
const DOT: Record<Tone, string> = {
  neutral: "bg-ink-soft/50",
  amber: "bg-c-amber-ink",
  violet: "bg-primary",
  green: "bg-c-green-ink",
  coral: "bg-c-coral-ink",
};

// WHAT A STATUS IS CALLED -- AND WHAT THE COLUMNS ARE -- IS DECIDED BY
// `palabras.ts`. The five words and the split used to live here, and one of
// the five was specific to the Board ("Lo estamos viendo"): Home had its own
// split and its own name ("Frenadas", both classes lumped together), and the
// blind test read three different names for the same status on three
// screens. Now all five come from `BOARD_COLUMNS` and the split from
// `columnForTask`, so Home, the Board, the detail chip and the entity viewer
// can't drift apart.
const COLUMNS: { key: ColKey; label: string; dot: string }[] =
  BOARD_COLUMNS.map((c) => ({ key: c.key, label: c.label, dot: DOT[c.tone] }));

// The request marker only redirects blocked ones: a request in progress or
// finished is already in the column it belongs to, and there no word lies.
const columnOf = (t: { status: string; body?: string | null }): ColKey =>
  columnForTask(t.status, isClientRequest(t.body));

/** A ticket's banner: the status, except when we're the ones it's waiting
 *  on. It's what the column and the detail chip show, so the link to the
 *  task never says something different from the board. */
const statusOf = (t: { status: string; body?: string | null }) =>
  taskStatus(t.status, isClientRequest(t.body));

// Transitions that make sense from the current status. Archiving is
// separate: it's always offered, with confirmation.
type Transition = { status: TargetStatus; label: string; inProgress: string; icon: LucideIcon };

// APPROVING IS NOT THE ACTION FOR EVERYTHING THAT'S BLOCKED, and offering it
// anyway isn't free: approving is `unblock`, and a ticket has ONE useful
// unblock before the engine declares it a loop and sends it to `triage`,
// where nothing can be approved anymore. On a request from the client
// themselves ("Conectar WhatsApp") it also sets the worker loose on a ticket
// whose body says "don't do anything on your own with this"; on a block from
// a missing connection, the cause is still there and the agent blocks it
// again right away. Both cases go without a transition and with a line
// saying where they actually get resolved. See `isConnectionBlock`.
const noApproval = (t: { status: string; body?: string | null }) =>
  t.status === "blocked" && (isClientRequest(t.body) || isConnectionBlock(t.body));

function transitionsFor(t: { status: string; body?: string | null }): Transition[] {
  if (t.status === "blocked") {
    if (noApproval(t)) return [];
    // "Aprobar", same as on the Approvals tab. This same action used to be
    // called "Desbloquear" here, "Aprobar" there, and "se destraba" in the
    // explanation: three words for the same thing, and the client with no
    // way to know whether they were three different things.
    return [{ status: "ready", label: "Aprobar", inProgress: "Aprobando…", icon: Unlock }];
  }
  if (t.status === "done")
    return [{ status: "ready", label: "Reabrir", inProgress: "Reabriendo…", icon: RotateCcw }];
  return [{ status: "done", label: "Marcar completado", inProgress: "Completando…", icon: Check }];
}

// `created_at` arrives from the adapter as epoch in SECONDS (int), though the
// lib sometimes types it as a string. Whoever reads it is `momentOf`, the
// portal's single gate: it accepts both forms and returns the instant (`ms`,
// for sorting) already read on the business's clock.
const msOf = (v: string | number): number => momentOf(v)?.ms ?? 0;

// Compact relative date; past a week, a short absolute date.
// The relative part ("3 h ago") can be counted from any clock; the date for
// old ones can't: it's written in the business's, like the rest of the
// portal.
function formatRelative(v: string | number): string {
  const m = momentOf(v);
  if (!m) return "";
  const min = Math.round((Date.now() - m.ms) / 60_000);
  if (min < 1) return "recién";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const days = Math.round(h / 24);
  if (days < 7) return days === 1 ? "hace 1 día" : `hace ${days} días`;
  // The year is also theirs: 12/31 at 23:30 on the agent's clock, looked at
  // from up north, can't end up dated next year.
  const thisYear = momentOf(Date.now())?.year;
  return m.year === thisYear ? m.date : `${m.date} ${m.year}`;
}

// Search, insensitive to case and accents.
function normalize(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** How the ticket ended (or why it got blocked), with what it left in writing.
 *
 *  Hermes stores the summary and the deliverables in the closing event; the
 *  adapter exposes them as `outcome`. Showing it up here is what avoids the
 *  ugly case: a ticket that goes from "created" to "done" with no way for the
 *  client to know what was done or where it ended up. */
function Outcome({ outcome, cfg, status }: {
  outcome: TicketOutcome; cfg: PortalConfig; status: string;
}) {
  const closed = outcome.kind === "completed";
  // THE BANNER CAN'T CONTRADICT WHAT THE CLIENT JUST DID. The block event
  // stays in the history forever, so a ticket that was already approved kept
  // showing "WHY IT GOT BLOCKED: I need your explicit approval…" in the "To
  // do" column. QA read that as "my ok got lost". If it's no longer blocked,
  // that's history, not status: it's told in the past tense and without the
  // alert tone.
  const stillBlocked = status === "blocked";
  const Icon = closed ? CircleCheck : CirclePause;
  const tone = closed
    ? "border-c-green bg-c-green/30 text-c-green-ink"
    : stillBlocked
      ? "border-c-amber bg-c-amber/30 text-c-amber-ink"
      : "border-black/[0.07] bg-black/[0.02] text-ink-soft";
  // The closing payload only brings `artifacts` sometimes (depends on how the
  // agent completed it). That's why the main source is the summary itself:
  // <Markdown> already turns workspace paths into chips that open the file,
  // and down here we only add what the text didn't name.
  const inText = (f: string) => (outcome.summary ?? "").includes(f.split("/").pop() ?? f);
  const extra = (outcome.files ?? []).filter((f) => !inText(f));
  return (
    <EntityProvider cfg={cfg}>
      <section className={`mt-6 rounded-xl border px-4 py-3 ${tone}`}>
        <h3 className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide">
          <Icon className="h-3.5 w-3.5" />
          {closed ? "Resultado" : stillBlocked ? "Por qué se frenó" : "Estuvo frenada por esto"}
        </h3>
        {!closed && !stillBlocked && (
          <p className="mb-1.5 text-[12px] font-medium text-c-green-ink">
            Ya la destrabaste — esto es lo que había pasado antes.
          </p>
        )}
        {outcome.summary ? (
          <div className="text-sm text-ink">
            <Markdown>{outcome.summary}</Markdown>
          </div>
        ) : (
          <p className="text-sm text-ink-soft">Sin detalle.</p>
        )}
        {extra.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {extra.map((f) => (
              <EntityChip key={f} entity={{ kind: "file", path: f }} label={f.split("/").pop() ?? f} />
            ))}
          </div>
        )}
      </section>
    </EntityProvider>
  );
}

function TenantFilter({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-md px-2 py-0.5 text-[11px] font-semibold transition ${
        active
          ? "bg-ink text-white"
          : "bg-black/[0.05] text-ink-soft hover:bg-black/[0.08] hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-c-coral bg-c-coral/40 px-3 py-2 text-[13px] text-c-coral-ink">
      {children}
    </p>
  );
}

function Label({ children, optional }: { children: string; optional?: boolean }) {
  return (
    <span className="mb-1.5 block text-[12px] font-semibold text-ink">
      {children}
      {optional && <span className="ml-1 font-normal text-ink-soft">(opcional)</span>}
    </span>
  );
}

// A comment not yet confirmed by the agent: drawn the same as the client's
// own but dimmed, and it disappears if the POST fails.
type LocalComment = TicketComment & { local: number };

export default function PipelinePage() {
  // The team, if this agent has one. Empty map on every agent running today.
  const roles = useRoles();
  // The agent's look for the stamp on its comments (lazy: no flash).
  const [agentLook] = useState(loadAgentLook);
  const [cfg] = useState<PortalConfig | null>(() => loadConfig());
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [tenant, setTenant] = useState<string | null>(null); // null = all
  const [search, setSearch] = useState("");

  // Open detail: decided by the URL (`?task=t_ab12`), not local state. It's
  // an id and not the whole ticket so a just-created one the board hasn't
  // brought yet can still be opened, and so the modal's header reflects the
  // fresh status the detail returns after every action.
  const openId = useRouteParam(PARAM.task);
  const [detail, setDetail] = useState<TicketDetail | null>(null);
  const [detailError, setDetailError] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const openIdRef = useRef<string | null>(null); // the current id, without waiting for a render

  // Ticket creation.
  const [createOpen, setCreateOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newBody, setNewBody] = useState("");
  const [newTenant, setNewTenant] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Comments.
  const [draft, setDraft] = useState("");
  const [commenting, setCommenting] = useState(false);
  const [pending, setPending] = useState<LocalComment[]>([]);
  const [commentError, setCommentError] = useState<string | null>(null);
  const localSeq = useRef(0);

  // Status changes.
  const [actionInProgress, setActionInProgress] = useState<TargetStatus | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [showMachine, setShowMachine] = useState(false);

  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (!cfg || inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    try {
      const res = await getTickets(cfg);
      setTickets(res.tickets);
      setError(null);
      setLastUpdated(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [cfg]);

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  // Detail: returns what it read so the caller knows whether it could
  // confirm. Discards the response if the client already closed it or
  // switched tickets.
  const loadDetail = useCallback(
    async (id: string): Promise<TicketDetail | null> => {
      if (!cfg) return null;
      try {
        const d = await getTicketDetail(cfg, id);
        if (openIdRef.current === id) {
          setDetail(d);
          setDetailError(false);
          setDetailLoading(false);
        }
        return d;
      } catch {
        if (openIdRef.current === id) {
          setDetailError(true);
          setDetailLoading(false);
        }
        return null;
      }
    },
    [cfg],
  );

  // Opening and closing is NAVIGATING: every task has its link and "back"
  // closes it.
  const openTask = useCallback((id: string) => openInRoute({ [PARAM.task]: id }), []);
  const closeTask = useCallback(() => closeInRoute(PARAM.task), []);

  // Everything "per ticket" resets when the URL's changes -- which is the
  // only place where which one is open lives. Goes BEFORE the effect that
  // fetches the detail: that way `openIdRef` already points at the new id by
  // the time the response comes back and decides whether it's still being
  // looked at.
  useEffect(() => {
    openIdRef.current = openId;
    setDetail(null);
    setDetailError(false);
    setDetailLoading(openId !== null);
    setDraft("");
    setPending([]);
    setCommentError(null);
    setActionError(null);
    setActionInProgress(null);
    setConfirmArchive(false);
  }, [openId]);

  // The creation draft does NOT get cleared on close: if the client closes it
  // by accident (a click outside), what they wrote is still there next time
  // they open it.
  const closeCreate = useCallback(() => {
    setCreateOpen(false);
    setCreateError(null);
  }, []);

  useEffect(() => {
    if (openId) loadDetail(openId);
  }, [openId, loadDetail]);

  // Modals: close on Escape and block the background scroll.
  const hasModal = createOpen || openId !== null;
  useEffect(() => {
    if (!hasModal) return;
    const fn = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (createOpen) {
        if (!creating) closeCreate();
      } else {
        closeTask();
      }
    };
    window.addEventListener("keydown", fn);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", fn);
      document.body.style.overflow = "";
    };
  }, [hasModal, createOpen, creating, closeTask, closeCreate]);

  // Tenants present in the data (never hardcoded).
  const tenants = useMemo(() => {
    const set = new Set<string>();
    let noTenant = false;
    for (const t of tickets ?? []) {
      if (t.tenant) set.add(t.tenant);
      else noTenant = true;
    }
    const list = Array.from(set).sort((a, b) => a.localeCompare(b));
    if (noTenant) list.push(NO_TENANT);
    return list;
  }, [tickets]);

  const visible = useMemo(() => {
    const q = normalize(search.trim());
    return (tickets ?? []).filter((t) => {
      if (tenant === NO_TENANT && t.tenant) return false;
      if (tenant && tenant !== NO_TENANT && t.tenant !== tenant) return false;
      if (q && !normalize(t.title).includes(q)) return false;
      return true;
    });
  }, [tickets, tenant, search]);

  const byColumn = useMemo(() => {
    const m: Record<ColKey, Ticket[]> = { todo: [], inProgress: [], waiting: [], ours: [], done: [] };
    for (const t of visible) m[columnOf(t)].push(t);
    for (const k of Object.keys(m) as ColKey[]) {
      m[k].sort((a, b) => msOf(b.created_at) - msOf(a.created_at));
    }
    return m;
  }, [visible]);

  // The requests column only exists if the client has ever asked for
  // something: on a freshly installed agent it would be a fifth column,
  // empty forever. It looks at the FULL list, not the filtered one -- if it
  // depended on the search, the board would change shape while the client
  // types.
  const hasRequests = useMemo(
    () => (tickets ?? []).some((t) => columnOf(t) === "ours"),
    [tickets],
  );

  // The detail wins (it brings the just-changed status); if it hasn't
  // arrived yet, the board's card is used to paint the modal without
  // waiting.
  const openTicket = useMemo<Ticket | null>(() => {
    if (!openId) return null;
    return detail?.ticket ?? (tickets ?? []).find((t) => t.id === openId) ?? null;
  }, [openId, detail, tickets]);

  /* ── Actions ────────────────────────────────────────────────────────────── */

  const create = async () => {
    if (!cfg || creating) return;
    const title = newTitle.trim();
    if (!title) return;
    const body = newBody.trim();
    const tnt = newTenant.trim();
    setCreating(true);
    setCreateError(null);
    try {
      const res = await createTicket(cfg, {
        title,
        ...(body ? { body } : {}),
        ...(tnt ? { tenant: tnt } : {}),
      });
      setCreateOpen(false);
      setNewTitle("");
      setNewBody("");
      setNewTenant("");
      load(); // the board catches up in the background
      if (res?.id) openTask(res.id); // and we open the just-created one
    } catch (e) {
      setCreateError(describeError(e));
    } finally {
      setCreating(false);
    }
  };

  const submitComment = async () => {
    if (!cfg || !openId || commenting) return;
    const body = draft.trim();
    if (!body) return;
    const id = openId;
    const local = ++localSeq.current;
    setPending((p) => [
      ...p,
      { local, author: CLIENT_AUTHOR, body, created_at: Math.floor(Date.now() / 1000) },
    ]);
    setDraft("");
    setCommentError(null);
    setCommenting(true);
    try {
      await commentTicket(cfg, id, body, CLIENT_AUTHOR);
      // Re-read the detail to keep the comment as the agent actually stored it
      // (real timestamp and author). Only once that comes back OK do we drop
      // the optimistic one; if the re-read fails, the comment still exists
      // and we leave it.
      const d = await loadDetail(id);
      if (d) setPending((p) => p.filter((c) => c.local !== local));
    } catch (e) {
      setPending((p) => p.filter((c) => c.local !== local));
      setDraft((current) => current || body); // give back what they wrote
      setCommentError(describeError(e));
    } finally {
      setCommenting(false);
    }
  };

  const changeStatus = async (status: TargetStatus) => {
    if (!cfg || !openId || actionInProgress) return;
    const id = openId;
    const ticket = openTicket;
    // APPROVING IS NOT UNBLOCKING, even though the button says the same thing
    // on both tabs. `setTicketStatus(..., "ready")` ends up in a bare
    // `unblock`: the ticket is freed and the agent wakes up with NO approval
    // comment at all. And the agent does the right thing with that -- it
    // doesn't spend money because someone released the block without saying
    // yes -- so it closes the request without running it, and the client
    // sees an "Approve" that approved nothing.
    // It happened: a request to generate 3 images (US$0.135) got closed
    // without being done. The approvals endpoint leaves "Aprobado desde el
    // portal" signed before unblocking, which is what the agent looks for.
    // It's the same one the Approvals tab uses: one path for one word.
    const isApproval = status === "ready" && ticket?.status === "blocked";
    setActionInProgress(status);
    setActionError(null);
    try {
      if (isApproval) await approve(cfg, id);
      else await setTicketStatus(cfg, id, status);
      load();
      if (status === "archived") closeTask(); // no longer on the board
      else await loadDetail(id);
      setConfirmArchive(false);
    } catch (e) {
      setActionError(describeError(e));
    } finally {
      setActionInProgress(null);
    }
  };

  const wrap = "mx-auto max-w-6xl px-6 py-6 md:px-8";

  if (!cfg) return <div className={wrap}><Spinner /></div>; // the layout shows the login
  if (tickets === null && error)
    return <div className={wrap}><ErrorState message={error} onRetry={load} /></div>;
  if (tickets === null) return <div className={wrap}><Spinner /></div>;

  // Most recent history first, however the adapter sends it.
  const events = detail
    ? [...detail.events].sort((a, b) => msOf(b.created_at) - msOf(a.created_at))
    : [];
  const comments: (TicketComment & { local?: number })[] = [
    ...(detail?.comments ?? []),
    ...pending,
  ];
  const freeTenants = tenants.filter((t) => t !== NO_TENANT);
  const columns = COLUMNS.filter((c) => c.key !== "ours" || hasRequests);

  return (
    <div className={wrap}>
      <PageHeader
        title="Tablero"
        subtitle="Lo que tu agente tiene entre manos."
        actions={
          <>
            {/* The business's clock, same as the rest of the portal: this
                stamp is read AGAINST the data below ("actualizado 11:50" /
                "creada hace 5 min"), so on the viewer's clock it would be the
                only number on the screen measuring with a different ruler. */}
            {lastUpdated && (
              <span className="hidden text-xs tabular-nums text-ink-soft sm:inline">
                Actualizado {timeOf(lastUpdated.getTime())}
              </span>
            )}
            <div className="relative w-56">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft/60" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por título…"
                className={`${inputCls} pl-8`}
              />
            </div>
            <IconBtn label="Actualizar" disabled={loading} onClick={load}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </IconBtn>
            <Btn onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" />
              Nueva tarea
            </Btn>
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
          title="Todavía no hay tareas"
          hint="Creá la primera con “Nueva tarea”, o esperá a que tu agente arranque una."
        />
      ) : (
        <>
          {tenants.length > 0 && (
            <div className="mb-5 flex flex-wrap items-center gap-1.5">
              <TenantFilter active={tenant === null} onClick={() => setTenant(null)}>
                Todos
              </TenantFilter>
              {tenants.map((t) => (
                <TenantFilter
                  key={t}
                  active={tenant === t}
                  onClick={() => setTenant(tenant === t ? null : t)}
                >
                  {t === NO_TENANT ? "Sin etiqueta" : t}
                </TenantFilter>
              ))}
            </div>
          )}

          {visible.length === 0 ? (
            <EmptyState
              icon={SearchX}
              title="Ninguna tarea coincide"
              hint="Probá con otra búsqueda o sacá el filtro."
            />
          ) : (
            <div
              className={`grid items-start gap-4 md:grid-cols-2 ${
                columns.length === 5 ? "xl:grid-cols-5" : "xl:grid-cols-4"
              }`}
            >
              {columns.map((col) => (
                <section key={col.key} className="rounded-xl bg-black/[0.02] p-2">
                  {/* ONE LINE, ALWAYS THE SAME HEIGHT. With five columns and
                      the window between ~1280 and ~1378 px, "Esperando
                      aprobación" didn't fit and broke into two lines: that
                      header measured 50 px against 32 for the other four, the
                      header row ended up misaligned, and that column's first
                      card started 18 px lower than the rest (measured on 8/13
                      with the columns at 186 px). Fixed height, and the title
                      gets truncated before it gets broken; the full label
                      stays in the `title`. */}
                  <div className="flex h-8 items-center gap-1.5 px-2">
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${col.dot}`} />
                    {/* `min-w-0` and no `flex-1`: the title only shrinks when
                        it needs to and the count stays stuck to it, as it
                        was, instead of going to the column's right edge. */}
                    <h2
                      title={col.label}
                      className="min-w-0 truncate text-[12px] font-semibold tracking-tight text-ink"
                    >
                      {col.label}
                    </h2>
                    <span className="shrink-0 text-[12px] tabular-nums text-ink-soft">
                      {byColumn[col.key].length}
                    </span>
                  </div>
                  {byColumn[col.key].length === 0 ? (
                    <p className="px-2 py-3 text-center text-[12px] text-ink-soft">Sin tareas</p>
                  ) : (
                    <ul className="flex flex-col gap-1.5">
                      {byColumn[col.key].map((t) => (
                        <li key={t.id}>
                          <button
                            onClick={() => openTask(t.id)}
                            aria-haspopup="dialog"
                            className="block w-full rounded-lg border border-black/[0.07] bg-white p-3 text-left transition hover:border-primary/40"
                          >
                            <p className="line-clamp-3 text-[13px] font-medium leading-snug text-ink">
                              {t.title}
                            </p>
                            <div className="mt-2 flex flex-wrap items-center gap-1.5">
                              {/* Who holds this task. Draws nothing on an agent
                                  with no team, so a single-role board is
                                  unchanged. */}
                              <RoleChip id={t.assignee} roles={roles} />
                              {t.tenant && <Chip tone="neutral">{t.tenant}</Chip>}
                              <span className="ml-auto text-[11px] text-ink-soft">
                                {formatRelative(t.created_at)}
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

      {/* ── Ticket creation ─────────────────────────────────────────────── */}
      {createOpen && (
        <Modal onClose={() => !creating && closeCreate()}>
          <div className="flex items-start justify-between gap-4 border-b border-black/[0.07] px-5 py-4">
            <div className="min-w-0">
              <h2 className="text-base font-bold leading-snug text-ink">Nueva tarea</h2>
              <p className="mt-0.5 text-sm text-ink-soft">
                Entra al tablero de tu agente como cualquier otro.
              </p>
            </div>
            <IconBtn label="Cerrar" disabled={creating} onClick={closeCreate}>
              <X className="h-4 w-4" />
            </IconBtn>
          </div>

          <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
            <label className="block">
              <Label>Título</Label>
              <input
                autoFocus
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && create()}
                placeholder="Qué necesitás que haga"
                className={inputCls}
              />
            </label>

            <label className="block">
              <Label optional>Descripción</Label>
              <textarea
                rows={5}
                value={newBody}
                onChange={(e) => setNewBody(e.target.value)}
                placeholder="Contexto, links, criterios de listo…"
                className={`${inputCls} resize-y`}
              />
              <span className="mt-1 block text-[11px] text-ink-soft">Podés usar markdown.</span>
            </label>

            <label className="block">
              <Label optional>Etiqueta</Label>
              <input
                list="pipeline-tenants"
                value={newTenant}
                onChange={(e) => setNewTenant(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && create()}
                placeholder="Un cliente, un área, un proyecto…"
                className={inputCls}
              />
              <datalist id="pipeline-tenants">
                {freeTenants.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
              <span className="mt-1 block text-[11px] text-ink-soft">
                Sirve para filtrar el tablero. Elegí una de las que ya usás o escribí una nueva.
              </span>
            </label>

            {createError && <Notice>No pude crear la tarea: {createError}</Notice>}
          </div>

          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-black/[0.07] px-5 py-3">
            <Btn kind="ghost" size="sm" disabled={creating} onClick={closeCreate}>
              Cancelar
            </Btn>
            <Btn kind="primary" size="sm" disabled={!newTitle.trim() || creating} onClick={create}>
              {creating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Creando…
                </>
              ) : (
                "Crear tarea"
              )}
            </Btn>
          </div>
        </Modal>
      )}

      {/* ── Detail ─────────────────────────────────────────────────────── */}
      {openId && (
        <Modal wide onClose={closeTask}>
          <div className="flex items-start justify-between gap-4 border-b border-black/[0.07] px-5 py-4">
            <div className="min-w-0">
              {openTicket ? (
                <>
                  <h2 className="text-base font-bold leading-snug text-ink">{openTicket.title}</h2>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {/* The chip is set by the same criteria that build the
                        columns -- including the client's own requests --
                        plus what `taskStatus` knows about statuses with no
                        column: an archived one leaves the board but the link
                        to its detail still opens, and it used to say "En
                        curso" [In progress], which was a lie. */}
                    <Chip tone={statusOf(openTicket).tone}>
                      {statusOf(openTicket).label}
                    </Chip>
                    {openTicket.tenant && <Chip tone="neutral">{openTicket.tenant}</Chip>}
                    <span className="text-[11px] text-ink-soft">
                      {formatRelative(openTicket.created_at)}
                    </span>
                  </div>
                </>
              ) : detailError ? (
                <h2 className="text-base font-bold leading-snug text-ink">
                  No encontré esa tarea
                </h2>
              ) : (
                <h2 className="text-base font-bold leading-snug text-ink-soft">Abriendo la tarea…</h2>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              <CopyLink label="Copiar el link de esta tarea" />
              <IconBtn label="Cerrar" onClick={closeTask}>
                <X className="h-4 w-4" />
              </IconBtn>
            </div>
          </div>

          {/* min-w-0: without this a table or a wide code block stretches
              the modal instead of scrolling inside its own container. */}
          <div className="min-w-0 flex-1 overflow-y-auto px-5 py-4">
            {/* The link went stale: the task got archived or deleted. This
                modal used to get stuck on "Abriendo la tarea…" forever. */}
            {!openTicket && detailError && (
              <p className="text-sm leading-relaxed text-ink-soft">
                Esa tarea ya no está en el tablero — puede que la hayan archivado o que el
                link sea viejo. Cerrá esta ventana y vas a ver todo lo que hay hoy.
              </p>
            )}
            {openTicket?.body?.trim() ? (
              <Markdown>{openTicket.body}</Markdown>
            ) : openTicket ? (
              <p className="text-sm text-ink-soft">Esta tarea no tiene descripción.</p>
            ) : null}

            {/* Why the ticket ended up this way. Comes from the closing
                event, not from the agent having remembered to comment: a
                ticket closed with no explanation is a ticket the client can't
                audit. */}
            {detail?.outcome && openTicket && (
              <Outcome outcome={detail.outcome} cfg={cfg} status={openTicket.status} />
            )}

            <h3 className="mb-2 mt-6 text-[12px] font-semibold uppercase tracking-wide text-ink-soft">
              Comentarios
            </h3>
            {detailLoading && !detail ? (
              <Spinner />
            ) : detailError && !detail ? (
              <p className="text-sm text-ink-soft">No pude cargar los comentarios.</p>
            ) : comments.length > 0 ? (
              <ul className="flex flex-col gap-3">
                {comments.map((c, i) => {
                  const own = isOwn(c.author);
                  const isPending = c.local != null;
                  // Signed `cliente` doesn't mean the client wrote it.
                  // Rejecting and approve-with-correction leave an
                  // instruction for the machine in the ticket ("RECHAZADO POR
                  // TU CLIENTE. No hagas lo que pediste aprobar…") signed as
                  // theirs: this used to show up in the violet bubble, above
                  // "Vos". What's shown is what it was and the client's own
                  // words, not the prompt.
                  //
                  // THE AUTHOR IS ALWAYS SHOWN: without it, the same filter
                  // gets applied to the AGENT's comments, and since a
                  // rejection only shows the reason block -- which an agent
                  // comment doesn't have -- anything the agent writes that
                  // starts with "RECHAZADO POR TU CLIENTE." disappeared
                  // entirely from the screen. See `readComment`.
                  const { text, label } = readComment(c.body ?? "", c.author);
                  return (
                    <li
                      key={c.local != null ? `l${c.local}` : `s${i}`}
                      className={`flex min-w-0 items-start gap-2 ${own ? "justify-end" : "justify-start"}`}
                    >
                      {/* The agent's face next to ITS OWN comments: the same
                          static stamp as the chat (Rive per comment would be
                          a real cost on long threads). */}
                      {!own && !isTheSystem(c.author) && (
                        <AgentitoAvatar look={agentLook} className="mt-0.5 h-7 w-7 shrink-0" />
                      )}
                      <div
                        className={`min-w-0 max-w-[85%] rounded-lg border px-3 py-2 ${
                          own
                            ? "border-c-violet bg-c-violet/50"
                            : "border-black/[0.07] bg-black/[0.02]"
                        } ${isPending ? "opacity-60" : ""}`}
                      >
                        <div className="flex items-baseline gap-2">
                          <span
                            className={`text-[12px] font-semibold ${
                              own ? "text-c-violet-ink" : "text-ink"
                            }`}
                          >
                            {labelFor(c.author)}
                          </span>
                          {label && (
                            <span className="text-[11px] font-medium text-ink-soft">{label}</span>
                          )}
                          <span className="text-[11px] text-ink-soft">
                            {isPending ? "enviando…" : formatRelative(c.created_at)}
                          </span>
                        </div>
                        {text ? (
                          <div className="mt-1 [&>div]:text-[13px]">
                            <Markdown>{text}</Markdown>
                          </div>
                        ) : label ? null : (
                          <p className="mt-1 text-sm text-ink-soft">(sin texto)</p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-ink-soft">Sin comentarios todavía.</p>
            )}

            {/* Comment: the agent reads it like any other comment on the ticket. */}
            <div className="mt-3">
              <textarea
                rows={3}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submitComment();
                }}
                placeholder="Escribile algo a tu agente sobre esta tarea…"
                className={`${inputCls} resize-y`}
              />
              {commentError && <div className="mt-2"><Notice>{commentError}</Notice></div>}
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="text-[11px] text-ink-soft">
                  Podés usar markdown. Ctrl + Enter para enviar.
                </span>
                <Btn
                  kind="primary"
                  size="sm"
                  disabled={!draft.trim() || commenting}
                  onClick={submitComment}
                >
                  {commenting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Enviando…
                    </>
                  ) : (
                    "Comentar"
                  )}
                </Btn>
              </div>
            </div>

            {events.length > 0 && (
              <>
                <h3 className="mb-2 mt-6 text-[12px] font-semibold uppercase tracking-wide text-ink-soft">
                  Historial
                </h3>
                <ul className="flex flex-col gap-1">
                  {(showMachine ? events : events.filter((e) => !isMachineEvent(e.kind)))
                    .map((e, i) => (
                      <li key={i} className="flex items-baseline gap-2 text-[12px] text-ink-soft">
                        <span className="font-medium">{ticketEventLabel(e.kind)}</span>
                        <span>{formatRelative(e.created_at)}</span>
                      </li>
                    ))}
                </ul>
                {/* The engine's machinery (heartbeats, startups, waits)
                    doesn't tell the client anything and in a list it looks
                    like it's hung. It stays behind a toggle, same as in
                    Files. */}
                {events.some((e) => isMachineEvent(e.kind)) && (
                  <button
                    onClick={() => setShowMachine((v) => !v)}
                    className="mt-1.5 text-[12px] text-ink-soft transition hover:text-ink"
                  >
                    {showMachine
                      ? "Ocultar los pasos técnicos"
                      : `Ver los pasos técnicos (${events.filter((e) => isMachineEvent(e.kind)).length})`}
                  </button>
                )}
              </>
            )}
          </div>

          {openTicket && (
            <div className="shrink-0 border-t border-black/[0.07] px-5 py-3">
              {actionError && <div className="mb-2"><Notice>{actionError}</Notice></div>}
              {confirmArchive ? (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[13px] text-ink">
                    ¿Archivar la tarea? Sale del tablero.
                  </p>
                  <div className="flex shrink-0 gap-2">
                    <Btn
                      kind="ghost"
                      size="sm"
                      disabled={actionInProgress !== null}
                      onClick={() => setConfirmArchive(false)}
                    >
                      Cancelar
                    </Btn>
                    <Btn
                      kind="danger"
                      size="sm"
                      disabled={actionInProgress !== null}
                      onClick={() => changeStatus("archived")}
                    >
                      {actionInProgress === "archived" ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Archivando…
                        </>
                      ) : (
                        "Sí, archivar"
                      )}
                    </Btn>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {/* With no approve button, the task can't be left with no
                      way out: it says who unblocks it and -- when there's
                      something to do -- where the button that actually works
                      is. */}
                  {noApproval(openTicket) && (
                    <p className="mr-auto max-w-[26rem] text-[12px] leading-snug text-ink-soft">
                      {isClientRequest(openTicket.body)
                        ? "Esto lo pediste vos y lo estamos viendo nosotros: no hay nada que aprobar acá. Te escribimos cuando esté."
                        : "Está frenada hasta que se conecte lo que le falta. "}
                      {!isClientRequest(openTicket.body) && (
                        <Link
                          href={`/app/approvals?request=${encodeURIComponent(openTicket.id)}`}
                          className="font-semibold text-primary transition hover:text-primary-dark"
                        >
                          Verlo en Aprobaciones
                        </Link>
                      )}
                    </p>
                  )}
                  <Btn
                    kind="ghost"
                    size="sm"
                    disabled={actionInProgress !== null}
                    onClick={() => setConfirmArchive(true)}
                  >
                    <Archive className="h-4 w-4" />
                    Archivar
                  </Btn>
                  {transitionsFor(openTicket).map((t) => (
                    <Btn
                      key={t.status}
                      kind={t.status === "done" ? "primary" : "secondary"}
                      size="sm"
                      disabled={actionInProgress !== null}
                      onClick={() => changeStatus(t.status)}
                    >
                      {actionInProgress === t.status ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          {t.inProgress}
                        </>
                      ) : (
                        <>
                          <t.icon className="h-4 w-4" />
                          {t.label}
                        </>
                      )}
                    </Btn>
                  ))}
                </div>
              )}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
