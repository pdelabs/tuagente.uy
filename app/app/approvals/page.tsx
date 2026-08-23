"use client";

// Approvals: tasks the agent stopped, waiting for the client's ok.
// PRINCIPIO CERO: domain-free — the body is shown as-is (could be an email,
// a payment, a post...); the portal never assumes what it is.
// Adapter contract (docs/specs/03-approvals.md):
//   GET  /portal/approvals → { approvals: [{ id, title, summary, body, created_at }] }
//   POST /portal/approvals/{id}/approve { correction? } · POST .../reject { reason }
// Honest semantics: approving ONLY comments and unblocks the ticket; what
// happens after is decided by the agent's own rules. The copy never
// promises "it's already been sent".
//
// Approving with corrections: the adapter (0.6.0) accepts `{correction}` on
// approve and, before unblocking, leaves a comment signed `cliente` with the
// exact text the agent has to use. It does NOT edit the ticket's body (the
// Hermes CLI doesn't allow that on a blocked ticket), so the copy says
// exactly that: your version gets recorded as a comment.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowRight, Ban, CheckCircle2, ChevronDown, Clock, Hand, PencilLine, MessageSquareReply,
  Plug, RotateCcw,
} from "lucide-react";
import { loadAgentName } from "../lib/onboarding";
import {
  loadConfig, getApprovals, getConnections, getTicketDetail, approve, reject,
  notifyApprovalsChanged, missingConnections, isTheClient, isConnectionBlock,
  isClientRequest, isClientRejection, connectionLabel, readComment,
  rejectionReason, looksLikeProposal, authorLabel,
  type Connection, type PortalConfig, type TicketComment, type TicketDetail,
} from "../lib/agent";
import { COLUMN_LABEL, timeOf } from "../lib/labels";
import {
  StaleLinkNotice, Btn, Card, Chip, EmptyState, ErrorState, PageHeader, Spinner, inputCls,
} from "../lib/ui";
import {
  CopyLink, PARAM, openInRoute, closeInRoute, bringIntoView, useRouteParam,
} from "../lib/routes";
import Markdown from "../lib/Markdown";

const REFRESH_MS = 30_000;

type Approval = {
  id: string;
  title: string;
  summary: string;
  body: string;
  created_at: string | number; // Hermes may emit epoch in seconds
};

// Tolerant: epoch in seconds (number or numeric string), epoch in ms, or ISO.
function toMs(v: string | number): number {
  if (typeof v === "number") return v < 1e12 ? v * 1000 : v;
  if (v && /^\d+(\.\d+)?$/.test(v)) {
    const n = Number(v);
    return n < 1e12 ? n * 1000 : n;
  }
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function timeAgo(v: string | number): string {
  const t = toMs(v);
  if (!t) return "";
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return "hace un momento";
  const m = Math.floor(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return h === 1 ? "hace 1 hora" : `hace ${h} horas`;
  const d = Math.floor(h / 24);
  return d === 1 ? "hace 1 día" : `hace ${d} días`;
}

// The summary is a loose one-liner: it goes out as plain text (half-parsed
// markdown on a clipped line looks worse than the raw thing). But the agent
// writes it with the same keyboard as the body, so we strip the obvious
// marks that would otherwise show. No parsing: it's one-line cosmetics.
function stripMarks(s: string): string {
  return s
    .replace(/^\s*(?:#{1,6}\s+|>\s+|[-*+]\s+)/, "") // # título · > cita · - ítem
    .replace(/\*\*(.+?)\*\*/g, "$1") // **negrita**
    .replace(/__(.+?)__/g, "$1") // __negrita__
    .replace(/`([^`]+)`/g, "$1") // `código`
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // [texto](url)
    .trim();
}

async function approveWithCorrection(cfg: PortalConfig, id: string, correction: string): Promise<void> {
  const result = await approve(cfg, id, correction);
  if (!result.ok) throw new Error("No se pudo aprobar con correcciones.");
}

// The markers the CLI leaves as a comment ("BLOCKED: …") are machine noise:
// the reason is already shown above, in its own words.
const isMarker = (s: string) => /^\s*(BLOCKED|UNBLOCKED|BLOQUEADO)\s*:/i.test(s);
// Who signs as the client is decided by `lib/agent.ts` and nobody else: it
// used to be copied here with its own expression, right next to the
// function that uses it to decide what shows and what doesn't. Two copies
// of that rule is one too many.
const isFromClient = isTheClient;

// `looksLikeProposal` —the markdown box from the `approval` skill— used to
// live here. It's now from `lib/agent.ts`: besides choosing which comment to
// show, it's half of the definition of what an approval IS, and that can't
// have two versions (see `isConnectionBlock`).

/** What we're asking them to approve. The `approval` skill leaves the
 *  request formatted AS A TICKET COMMENT, not in its description — that's
 *  why this screen used to show the summary twice and the email was
 *  nowhere to be found.
 *
 *  THE LAST ONE, not the first. With the rejection that didn't unblock
 *  anything, the whole negotiation happens in this same ticket: the agent
 *  proposes, the client says no, the agent proposes again in another
 *  comment. Keeping the first one means showing her, forever, the proposal
 *  she already rejected, and making her approve that. With no proposal
 *  shaped like one, it falls back to the old behavior (the agent's first
 *  comment) and, if there's none, to the ticket's body.
 *
 *  WHEN IT WAS WRITTEN IS RETURNED TOO, and that's not a detail: the agent
 *  can't be required to use the box. Seen live — the client rejects, the
 *  agent answers the new version IN PROSE, and since only the ones with a
 *  box get in here, the box kept showing "8% / Monday 17" with the Approve
 *  button underneath while the conversation two lines below said "12% /
 *  Monday 24". With the date, the screen can at least avoid claiming that
 *  what's on top is the current one. See `negotiationStatus`. */
type Proposal = { text: string; when: number };
function chooseProposal(d: TicketDetail | undefined, fallback: string): Proposal {
  const fromAgent = (d?.comments ?? []).filter(
    (x) => !isFromClient(x.author) && x.body?.trim() && !isMarker(x.body));
  const proposals = fromAgent.filter((x) => looksLikeProposal(x.body));
  const chosen = proposals[proposals.length - 1] ?? fromAgent[0];
  return {
    text: (chosen?.body ?? fallback ?? "").trim(),
    // With no comment chosen, what shows is the ticket's body, which is the
    // oldest thing there is: any later "no" leaves it behind.
    when: chosen ? toMs(chosen.created_at) : 0,
  };
}

/** THE STATE OF THE NEGOTIATION, READ FROM THE THREAD.
 *
 *  It used to live only in a `useState`: an F5 wiped it out and the client
 *  saw the proposal again with the Approve button underneath, with no sign
 *  at all that she'd already said no. It's derivable —her last comment is a
 *  rejection— and it's exactly what the rest of the portal does: what's
 *  open gets READ, not remembered. */
type NegotiationState = {
  when: Date;
  /** Her words, or "" if the comment doesn't carry the reason block. */
  reason: string;
  /** The agent already answered something after the "no". */
  replied: boolean;
  /** What's showing above predates the "no": it is NOT the current one. */
  staleProposal: boolean;
};
function negotiationStatus(
  d: TicketDetail | undefined, proposal: Proposal,
): NegotiationState | null {
  const thread = (d?.comments ?? []).filter(
    (c) => (c.body ?? "").trim() && !isMarker(c.body ?? ""));
  let i = -1;
  for (let k = 0; k < thread.length; k++) if (isClientRejection(thread[k])) i = k;
  if (i === -1) return null;
  const rejection: TicketComment = thread[i];
  return {
    when: new Date(toMs(rejection.created_at)),
    reason: rejectionReason(rejection.body ?? ""),
    replied: thread.slice(i + 1).some((c) => !isFromClient(c.author)),
    staleProposal: proposal.when <= toMs(rejection.created_at),
  };
}

/** The back-and-forth after the request: what you commented and what the
 *  agent answered. Shown apart from the proposal. */
function conversation(d: TicketDetail | undefined, proposal: string) {
  const seen = new Set<string>();
  return (d?.comments ?? []).filter((c) => {
    const b = (c.body ?? "").trim();
    if (!b || b === proposal || isMarker(b)) return false;
    // The adapter sometimes returns the same comment twice under different
    // authors (`worker` and the agent's name): to the client it looks like
    // it spoke twice. We keep the first one.
    if (seen.has(b)) return false;
    seen.add(b);
    return true;
  });
}

function describeError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes("404")) return "Tu agente todavía no expone aprobaciones (módulo no disponible).";
  if (msg.includes("Failed to fetch") || msg.includes("NetworkError")) return "No hay conexión con tu agente.";
  return msg;
}

/** Splits the BRIEF (the summary and the "if you approve / if you reject /
 *  why" box) from the TEXT THAT'S GOING TO BE SENT.
 *
 *  The brief is great for deciding and terrible for editing: "Correct and
 *  approve" used to open the entire markdown and the client would run into
 *  `| If you approve | It gets sent to the vendor… |` when all she wanted
 *  was to change a number. Cuts right after the last table row; if there's
 *  no box, nothing gets split and the whole thing is editable (which is
 *  what there used to be). */
function splitProposal(md: string): { brief: string; text: string } {
  const lines = (md || "").split("\n");
  let lastRow = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*\|.*\|\s*$/.test(lines[i])) lastRow = i;
  }
  if (lastRow === -1) return { brief: "", text: md };
  // The skill separates the brief from the text with a `---` line: it's
  // formatting punctuation, not part of what gets sent.
  const text = lines
    .slice(lastRow + 1)
    .join("\n")
    .replace(/^\s*(?:[-*_]\s*){3,}\s*$/m, "")
    .trim();
  // A box at the end, with no text below: there's nothing to split.
  if (text.length < 20) return { brief: "", text: md };
  return { brief: lines.slice(0, lastRow + 1).join("\n").trim(), text };
}

/** What the client just resolved, and keeps seeing.
 *
 *  Before, the card would vanish and leave "Nothing waiting for your
 *  approval": the product's most important button confirmed nothing, and
 *  the client didn't know whether the click had registered or whether the
 *  email had gone out. */
type Resolved = {
  id: string;
  title: string;
  action: "approved" | "corrected" | "closed" | "retry";
  when: Date;
};

/** The "no" that stays open. Unlike approving, rejecting does NOT close the
 *  request: the ticket stays blocked, the card stays in the list, and the
 *  agent comes back with another proposal on the same request. This is
 *  what shows up inside that card in the meantime.
 *
 *  `notified` is `null` when the "no" isn't one you just sent but was read
 *  from the thread (you came back to the screen, or refreshed): there we
 *  don't know whether the notice went out, and not knowing is said by
 *  staying quiet about it, not by making up an "it's reading it right now". */
type Rejected = {
  when: Date;
  reason: string;
  notified: boolean | null;
  /** The agent already answered after the "no". */
  replied?: boolean;
};

// On the BUSINESS's clock, same as the rest of the portal. This shows what
// time you said yes or no, and that "when" arrives by two paths: the click
// you just made (your machine's time) and the same "no" read later from the
// ticket's thread (the agent's time). With the browser in another
// timezone, the same card changed its time on page refresh. See
// `lib/labels.ts`.
const hhmm = (d: Date) => timeOf(d.getTime());

/** The confirmation that was missing. Stays up while the client remains on
 *  the screen: what they did, at what time, what's happening now, and the
 *  link to the task to go look at it. */
function ResolvedCard({ r, agentName }: { r: Resolved; agentName: string }) {
  const closed = r.action === "closed";
  const title = closed
    ? "Cerraste el pedido"
    : r.action === "approved" ? "Lo aprobaste"
    : r.action === "retry" ? "Le dijiste que lo vuelva a intentar"
    : "Lo aprobaste con tu corrección";
  const detail =
    r.action === "approved"
      ? `${agentName} ya lo sabe y está siguiendo con eso. Lo ves avanzar en el Tablero.`
      : r.action === "corrected"
      ? `${agentName} tiene que usar tu versión, no la original. Lo ves avanzar en el Tablero.`
      : r.action === "retry"
      ? `${agentName} retoma esta tarea con la conexión ya puesta. Si algo sigue faltando, `
        + "te lo va a decir ahí mismo. Lo ves avanzar en el Tablero."
      : `${agentName} no lo va a volver a proponer. Quedó anotado por qué, en el Tablero. `
        + "Si algún día cambiás de idea, pediselo por el chat.";
  const Icon = closed ? Ban : CheckCircle2;
  const ink = closed ? "text-ink" : "text-c-green-ink";
  return (
    <Card tone={closed ? "surface" : "green"}>
      <div className="flex items-start gap-2.5">
        <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${ink}`} />
        <div className="min-w-0 flex-1">
          <p className={`text-sm font-semibold ${ink}`}>
            {title} · {hhmm(r.when)}
          </p>
          <p className="mt-0.5 text-[13px] leading-snug text-ink">{r.title}</p>
          <p className="mt-1 text-[12.5px] leading-snug text-ink-soft">{detail}</p>
          <Link
            href={`/app/pipeline?task=${encodeURIComponent(r.id)}`}
            className="mt-1.5 inline-flex items-center gap-1 text-[12.5px] font-semibold text-primary transition hover:text-primary-dark"
          >
            Ver la tarea
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </Card>
  );
}

/** Inside the card of the request you just rejected, which STAYS there.
 *
 *  Not disappearing is half the fix: rejecting doesn't resolve anything, it
 *  opens a conversation. If the card vanished, the client would have
 *  nowhere to read the agent's answer or to approve the corrected version. */
function RejectedNotice({ r, agentName }: { r: Rejected; agentName: string }) {
  // Three different situations and none of them overclaims. The `null` is
  // the "no" read from the thread when coming back to the screen: we don't
  // know whether the notice went out, but we do know the request is still
  // waiting.
  const detail = r.replied
    ? `${agentName} ya te contestó: su respuesta está acá abajo, en "Lo que hablaron". El pedido queda esperando tu ok hasta que la versión que te traiga te sirva.`
    : r.notified === true
    ? `${agentName} lo está leyendo y te va a contestar acá abajo, en "Lo que hablaron". El pedido queda esperando tu ok hasta que la nueva versión te sirva.`
    : r.notified === false
    ? `Tu respuesta quedó anotada en el pedido, pero no pude avisarle en el momento: ${agentName} la va a leer la próxima vez que trabaje esta tarea. El pedido queda esperando tu ok.`
    : `${agentName} todavía no contestó. El pedido queda esperando tu ok hasta que la nueva versión te sirva.`;
  return (
    <div className="mt-3 rounded-lg border border-c-amber bg-c-amber/25 px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-[13px] font-semibold text-c-amber-ink">
        <MessageSquareReply className="h-3.5 w-3.5 shrink-0" />
        Le dijiste que no · {hhmm(r.when)}
      </p>
      {/* With no reason block, nothing gets quoted: putting quotation marks
          around the machine text would be putting words in its mouth it
          never wrote. */}
      {r.reason && (
        <p className="mt-1 text-[13px] leading-snug text-ink">Le dijiste: «{r.reason}»</p>
      )}
      <p className="mt-1 text-[12.5px] leading-snug text-c-amber-ink/85">{detail}</p>
    </div>
  );
}

/** A BLOCK IS NOT AN APPROVAL, AND THIS IS ITS CARD.
 *
 *  The agent stopped because it's missing a connection. The blind test on
 *  8/13 saw this request with the usual three buttons: "Approve what? It
 *  didn't do anything, it got stuck. That's not a permission I have to
 *  give, it's a problem you have to solve for me." And "got stuck" is
 *  literal: approving is `unblock`, the cause is still there, the agent
 *  blocks it again, and the second time the engine sends it to `triage`,
 *  where the request can never be approved again.
 *
 *  THE THREE WAYS OUT, and none of them is "Approve":
 *   · Connect what's missing — the only thing that truly unblocks this.
 *   · Have it try again — the same unblock, but offered ONLY when the
 *     catalog says the connection is already in place: only then does it
 *     actually move things forward, and it's the only moment where spending
 *     the unblock doesn't throw it away.
 *   · I don't need it anymore — really closes the request (a final
 *     `reject`, the same write already used by "no, and don't propose it to
 *     me again"). It's the alternative to Archive, which only hides it from
 *     the kanban and leaves the agent thinking the task is still alive.
 *
 *  "Ask how it's going" was ruled out: we're the ones who can solve it, not
 *  the agent, so it would be a message into the void — another button that
 *  does nothing, which is exactly what the test complained about. */
function BlockedCard({
  a, connections, agentName, waited, expanded, onToggle,
  askingReason, reason, setReason, rejecting, error,
  onOpenReason, onCancelReason, onConfirmClose, onRetry,
}: {
  a: Approval;
  connections: Connection[] | null;
  agentName: string;
  waited: string;
  expanded: boolean;
  onToggle: () => void;
  askingReason: boolean;
  reason: string;
  setReason: (s: string) => void;
  rejecting: boolean;
  error?: string;
  onOpenReason: () => void;
  onCancelReason: () => void;
  onConfirmClose: () => void;
  onRetry: () => void;
}) {
  const ids = missingConnections(a.body);
  const names = ids.map((id) => connectionLabel(id, connections));
  const states = ids.map((id) => connections?.find((c) => c.id === id) ?? null);
  // With no catalog, we don't claim it's connected: we offer to connect it,
  // which is the thing that can't go wrong.
  const connected = connections !== null && states.every((c) => c?.status === "connected");
  const isOurFault = states.some((c) => c?.status === "blocked");
  const firstMissing = ids.find((id, i) => states[i]?.status !== "connected") ?? ids[0];
  const multiple = names.length > 1;
  const list = multiple
    ? `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`
    : names[0] ?? "una conexión";

  return (
    <Card className={expanded ? "request-open scroll-mt-6" : ""}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-ink">{a.title}</h3>
          {a.summary && (
            <p className="mt-0.5 text-sm text-ink-soft line-clamp-2">{stripMarks(a.summary)}</p>
          )}
        </div>
        {waited && (
          <span className="shrink-0 whitespace-nowrap pt-0.5 text-[12px] text-ink-soft">
            frenado {waited}
          </span>
        )}
      </div>

      <p className="mt-2 text-[13px] leading-snug text-ink">
        {connected
          ? `${list} ${multiple ? "ya están conectados" : "ya está conectado"}: `
            + `${agentName} puede retomarlo.`
          : isOurFault
            ? `Para conectar ${list} falta un paso nuestro. Lo estamos viendo y te escribimos cuando esté.`
            : `${agentName} no puede seguir con esto hasta que ${list} `
              + `${multiple ? "estén conectados" : "esté conectado"}.`}
      </p>

      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className="mt-1.5 inline-flex items-center gap-1 text-[12px] font-semibold text-primary"
      >
        {expanded ? "Ocultar el detalle" : "Ver qué le falta"}
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>

      {/* The body carries the `connection:<id>` mention that the portal turns
          into the connection's card, with its real status and its own
          button: it's the same one seen in the chat, not a copy. */}
      {expanded && a.body && (
        <div className="mt-3 max-h-96 overflow-auto overscroll-contain rounded-lg bg-black/[0.03] p-3 [&>div]:text-[13px]">
          <Markdown>{a.body}</Markdown>
        </div>
      )}

      {error && (
        <p className="mt-3 rounded-lg border border-c-coral bg-c-coral/40 px-3 py-2 text-[13px] text-c-coral-ink">
          {error}
        </p>
      )}

      {askingReason ? (
        <div className="mt-3">
          <p className="mb-1.5 text-[12.5px] leading-snug text-ink-soft">
            Se cierra la tarea y {agentName} deja de intentarla. Contale por qué, para que
            quede anotado: si más adelante lo necesitás, se lo pedís por el chat.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onConfirmClose()}
              placeholder="Ya no me hace falta porque…"
              className={inputCls + " flex-1"}
            />
            <div className="flex shrink-0 justify-end gap-2">
              <Btn kind="ghost" size="sm" disabled={rejecting} onClick={onCancelReason}>
                Cancelar
              </Btn>
              <Btn
                kind="danger"
                size="sm"
                disabled={!reason.trim() || rejecting}
                onClick={onConfirmClose}
              >
                {rejecting ? "Cerrando…" : "Cerrar la tarea"}
              </Btn>
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
          <span className="mr-auto">
            <CopyLink label="Copiar el link de este pedido" />
          </span>
          <Btn kind="ghost" size="sm" onClick={onOpenReason}>
            Ya no lo necesito
          </Btn>
          {connected ? (
            <Btn kind="primary" size="sm" onClick={onRetry}>
              <RotateCcw className="h-3.5 w-3.5" />
              Que lo vuelva a intentar
            </Btn>
          ) : (
            <Link
              href={`/app/connections?connection=${encodeURIComponent(firstMissing ?? "")}`}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-2.5 text-[13px] font-semibold text-white transition hover:bg-primary-dark"
            >
              <Plug className="h-3.5 w-3.5" />
              {isOurFault ? "Ver cómo va" : `Conectar ${names[0] ?? "lo que falta"}`}
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>
      )}
    </Card>
  );
}

export default function ApprovalsPage() {
  const [cfg, setCfg] = useState<PortalConfig | null>(null);
  const [approvals, setApprovals] = useState<Approval[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Which one is expanded is decided by the URL (`?request=<id>`): the agent
  // can send the link to the exact request that's waiting for your ok.
  const expandedId = useRouteParam(PARAM.request);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  // "No, and don't propose it to me again": closes the request. The client
  // decides with a checkbox, not the model reading the reason.
  const [closeRequest, setCloseRequest] = useState(false);
  // Correction in progress: the card whose body is editable, and the typed text.
  const [correctingId, setCorrectingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  // Optimism: ids already out of the list (POST in flight or confirmed).
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  // What the client resolved during this visit, so the screen confirms it
  // instead of going blank.
  const [resolved, setResolved] = useState<Resolved[]>([]);
  // What they rejected: it does NOT leave the list (the ticket stays
  // blocked), so this is what puts the negotiation status inside the card.
  const [rejected, setRejected] = useState<Record<string, Rejected>>({});
  const [rejectingNow, setRejectingNow] = useState<string | null>(null);
  const [cardErrors, setCardErrors] = useState<Record<string, string>>({});
  // Ticket detail by id: this is where what needs approving actually lives
  // (the skill leaves it as a comment). Fetched on expand, once only.
  const [details, setDetails] = useState<Record<string, TicketDetail | "loading" | "failed">>({});
  // The connections catalog: only for blocks, which need to know whether
  // what's missing is already in place (and what it's called in plain
  // terms). If it doesn't arrive, the card doesn't claim to be connected
  // and offers to connect it, which is the safe thing to do.
  const [connections, setConnections] = useState<Connection[] | null>(null);

  useEffect(() => {
    setCfg(loadConfig()); // if null, the layout shows the login
  }, []);

  const load = useCallback(async (c: PortalConfig) => {
    try {
      const data = await getApprovals(c);
      const list = (Array.isArray(data.approvals) ? data.approvals : []) as Approval[];
      // The one waiting the longest, on top.
      list.sort((a, b) => toMs(a.created_at) - toMs(b.created_at));
      setApprovals(list);
      setLoadError(null);
      // Clean up hidden ids the adapter no longer returns (action confirmed).
      setHidden((h) => {
        const alive = new Set(list.map((a) => a.id));
        const next = new Set(Array.from(h).filter((id) => alive.has(id)));
        return next.size === h.size ? h : next;
      });
    } catch (e) {
      setLoadError(describeError(e));
    }
  }, []);

  useEffect(() => {
    if (!cfg) return;
    load(cfg);
    const t = setInterval(() => load(cfg), REFRESH_MS); // silent refresh
    return () => clearInterval(t);
  }, [cfg, load]);

  // Connections get re-read at the same frequency: the client goes off to
  // connect Google and comes back, and the card has to find out on its own.
  useEffect(() => {
    if (!cfg) return;
    const fetchConnections = () => getConnections(cfg)
      .then((r) => setConnections(r?.connections ?? []))
      .catch(() => { /* with no catalog the card still offers to connect */ });
    fetchConnections();
    const t = setInterval(fetchConnections, REFRESH_MS);
    return () => clearInterval(t);
  }, [cfg]);

  const setCardError = (id: string, msg: string | null) =>
    setCardErrors((errs) => {
      const next = { ...errs };
      if (msg) next[id] = msg;
      else delete next[id];
      return next;
    });

  const hide = (id: string) => setHidden((h) => new Set(h).add(id));
  const unhide = (id: string) =>
    setHidden((h) => {
      const next = new Set(h);
      next.delete(id);
      return next;
    });

  /** What got resolved stays IN VIEW with what happened and when. And the
   *  menu badge finds out right away: otherwise the sidebar keeps saying
   *  "1" until the next minute and the client thinks their click didn't
   *  register. */
  const markResolved = (r: Resolved) => {
    setResolved((prev) => [r, ...prev.filter((x) => x.id !== r.id)]);
    notifyApprovalsChanged();
  };
  const forgetResolved = (id: string) =>
    setResolved((prev) => prev.filter((x) => x.id !== id));

  /** Approving and "have it try again" are the SAME write (`unblock`) and
   *  two different things for the client: one authorizes something, the
   *  other just resumes work that was stopped by a connection that's now in
   *  place. What changes is the confirmation, which is what they read
   *  afterward. */
  const doApprove = (a: Approval, action: "approved" | "retry" = "approved") => {
    if (!cfg) return;
    setCardError(a.id, null);
    hide(a.id); // leaves the list right away; the refresh confirms it
    markResolved({ id: a.id, title: a.title, action, when: new Date() });
    approve(cfg, a.id).catch((e) => {
      unhide(a.id);
      forgetResolved(a.id);
      setCardError(a.id, action === "retry"
        ? `No se pudo retomar: ${describeError(e)}`
        : `No se pudo aprobar: ${describeError(e)}`);
    });
  };

  const stopCorrecting = () => {
    setCorrectingId(null);
    setDraft("");
  };

  // Approve with the edited version. Same optimism as the rest: the card
  // leaves right away; if the POST fails it comes back, with the typed text
  // intact to retry.
  const doApproveWithCorrection = (a: Approval, original: string) => {
    if (!cfg) return;
    const text = draft.trim();
    if (!text || text === original) return;
    setCardError(a.id, null);
    stopCorrecting();
    hide(a.id);
    markResolved({ id: a.id, title: a.title, action: "corrected", when: new Date() });
    approveWithCorrection(cfg, a.id, text).catch((e) => {
      unhide(a.id);
      forgetResolved(a.id);
      openInRoute({ [PARAM.request]: a.id });
      setCorrectingId(a.id);
      setDraft(text);
      setCardError(a.id, `No se pudo aprobar con correcciones: ${describeError(e)}`);
    });
  };

  /** REJECTING IS ANSWERING, NOT CLOSING. One call, and the request stays.
   *
   *  What used to be here made three non-atomic writes —comment, comment,
   *  and moving the ticket to `ready`— and hid the card. Both things were
   *  wrong, and the second was the serious one: `ready` SPENDS the ticket's
   *  one and only unblock before the engine declares it a loop. The agent
   *  would re-propose, get blocked again, hit the limit, and the request
   *  would die — either in `triage` (where Approve answers "it got stuck")
   *  or split by the auto-decomposer with the old body, which is how the
   *  client ended up with an 8-hinge task in her queue after having
   *  corrected it down to a 20.
   *
   *  Now: a `POST /reject` and nothing else. The adapter writes ONE comment
   *  signed `cliente` and wakes the agent up; the ticket isn't touched and
   *  stays `blocked`, meaning it stays in this list. The card keeps the
   *  notice inside it and the agent's answer is going to show up right
   *  there. The unblock is spent only once in the whole negotiation: on
   *  approving. */
  const doReject = async (a: Approval) => {
    if (!cfg) return;
    const trimmedReason = reason.trim();
    if (!trimmedReason) return;
    // On a block, the "no" is always final: there's no other version to ask
    // for —what's missing is a connection, not a proposal—, so "I don't
    // need it anymore" closes the task in the same write.
    const final = closeRequest || isConnectionBlock(a.body);
    setCardError(a.id, null);
    setRejectingNow(a.id);
    try {
      const res = await reject(cfg, a.id, trimmedReason, final);
      setRejectingId(null);
      setReason("");
      setCloseRequest(false);
      // With `final`, the adapter comments AND closes the ticket in the same
      // write: the request leaves the list, and like anything else that
      // gets resolved, it's confirmed on screen instead of vanishing.
      if (res?.closed || res?.in_approvals === false) {
        hide(a.id);
        markResolved({ id: a.id, title: a.title, action: "closed", when: new Date() });
        load(cfg);
        return;
      }
      // `notified` can come back false: the comment stayed put, but the
      // agent didn't find out right away. We say so, we don't dress it up.
      setRejected((prev) => ({
        ...prev,
        [a.id]: { when: new Date(), reason: trimmedReason, notified: res?.notified !== false },
      }));
      // Its own answer has to show up in "Lo que hablaron" right away, not
      // in 30 seconds: it's the proof the message got through.
      fetchDetail(a.id, true);
      // If the adapter unblocked it anyway (an old one, or one that changes
      // its mind), the request will leave the list on the next refresh
      // alone. We don't guess it here.
      if (res?.unblocked) load(cfg);
    } catch (e) {
      setCardError(a.id, `No se pudo rechazar: ${describeError(e)}`);
    } finally {
      setRejectingNow(null);
    }
  };

  /** Fetches the detail once per ticket. If it fails, the card falls back
   *  to the usual body: we never leave the client with nothing to read.
   *
   *  TWO THINGS THAT LOOK LIKE DETAILS AND AREN'T, because together they
   *  made an INFINITE FETCH LOOP —~2000 GETs in 6 seconds against the
   *  client's agent— with any old link to an already-resolved approval:
   *    1. what's already been requested is remembered in a REF, not in
   *       state. With `details` in the deps, every response changed this
   *       function's identity, and the effect that calls it ran again.
   *    2. the failure is STORED. Before, the entry was deleted "to retry on
   *       reopening", and that closed the loop: it failed → deleted →
   *       changed `details` → effect → failed…
   *  Retrying is still possible, but at the client's request, not on its own. */
  const requestedDetails = useRef<Set<string>>(new Set());
  const fetchDetail = useCallback((id: string, retry = false) => {
    if (!cfg) return;
    if (requestedDetails.current.has(id) && !retry) return;
    requestedDetails.current.add(id);
    setDetails((d) => ({ ...d, [id]: "loading" }));
    getTicketDetail(cfg, id)
      .then((d) => setDetails((prev) => ({ ...prev, [id]: d })))
      .catch(() => setDetails((prev) => ({ ...prev, [id]: "failed" })));
  }, [cfg]);

  // The detail is fetched by watching the URL, not the click: that way a
  // shared link arrives with the request already open and its text inside.
  useEffect(() => {
    if (expandedId) fetchDetail(expandedId);
  }, [expandedId, fetchDetail]);

  // Expanding a request is NAVIGATING: it lands in the URL and "back" collapses it.
  const toggle = (id: string) => {
    if (expandedId === id) closeInRoute(PARAM.request);
    else openInRoute({ [PARAM.request]: id });
    if (rejectingId === id) {
      setRejectingId(null);
      setReason("");
      setCloseRequest(false);
    }
    if (correctingId === id) stopCorrecting(); // collapsing discards the edit
  };

  const visible = approvals ? approvals.filter((a) => !hidden.has(a.id)) : null;
  // THREE different lists, not two. What the agent is asking your
  // permission to do; what it can't do until something gets connected; and
  // what you yourself requested, which is on our court. Mixing them put the
  // same buttons under "send this email to a stranger", "missing Google
  // access", and "connect my email", which for the client are three very
  // different things — and on the middle one, Approve also breaks the request.
  const blocked = visible?.filter((a) => isConnectionBlock(a.body)) ?? null;
  const pending = visible?.filter(
    (a) => !isClientRequest(a.body) && !isConnectionBlock(a.body)) ?? null;
  const requested = visible?.filter((a) => isClientRequest(a.body)) ?? null;

  const agentName = loadAgentName() || "Tu agente";

  /* THE REQUEST'S LINK HAS TO LEAVE THE REQUEST IN VIEW, and it didn't —
     precisely the link the agent is going to send the most ("look, this is
     waiting for your ok"). Measured in the lab with `?request=<id>`:
     `scrollY` at 0 and the card starting at 1055px with an 862 window,
     meaning the client landed looking at SOMEONE ELSE's request, with its
     own Approve/Reject pair up front. The helper already existed and Skills
     and Connections use it: here it was one call.

     The deps are the id and two booleans, never the list: it refreshes on
     its own every 30 seconds and with `approvals` here the page would jump
     on its own while the client reads another card. And it retries once the
     detail arrives because the card GROWS (the request's text, the
     conversation) and what we centered with the card collapsed ends up off. */
  const inList = Boolean(expandedId && visible?.some((x) => x.id === expandedId));
  const openDetail = expandedId ? details[expandedId] : undefined;
  const detailReady = openDetail !== undefined && openDetail !== "loading";
  useEffect(() => {
    if (!inList) return;
    return bringIntoView(".request-open");
  }, [expandedId, inList, detailReady]);

  return (
    <div className="mx-auto max-w-3xl px-6 py-6 md:px-8">
      <PageHeader
        title="Aprobaciones"
        subtitle="Lo que tu agente frenó y no puede seguir solo. Abrí cada uno: adentro está el texto completo, y abajo lo que hace falta para destrabarlo."
      />

      {/* What you just resolved, at the very top and with its time. Goes
          before any other branch: if you approved the only thing there was,
          the screen can't stay on "Nothing waiting for your approval" as if
          you hadn't done anything. */}
      {/* The link points to a request that's no longer in the queue: it got
          resolved, archived, or the agent withdrew it. It's said, and the
          list stays below. */}
      {expandedId && visible !== null
        && !visible.some((a) => a.id === expandedId)
        && !resolved.some((r) => r.id === expandedId) && (
        <StaleLinkNotice>
          Ese pedido ya no está esperando tu ok — puede que ya lo hayas contestado o que
          tu agente lo haya retirado. Abajo está lo que sí espera tu respuesta.
        </StaleLinkNotice>
      )}

      {resolved.length > 0 && (
        <div className="mb-4 flex flex-col gap-2">
          {resolved.map((r) => (
            <ResolvedCard key={r.id} r={r} agentName={agentName} />
          ))}
        </div>
      )}

      {!cfg || visible === null ? (
        cfg && loadError ? (
          <ErrorState
            message={loadError}
            onRetry={() => {
              setLoadError(null);
              load(cfg);
            }}
          />
        ) : (
          <Spinner />
        )
      ) : visible.length === 0 ? (
        resolved.length > 0 ? (
          <p className="px-1 text-sm text-ink-soft">
            No queda nada más esperando tu ok.
          </p>
        ) : (
          <EmptyState
            icon={Hand}
            title="Nada esperando tu aprobación"
            hint="Cuando tu agente necesite tu ok, lo vas a ver acá."
          />
        )
      ) : (
        <div className="flex flex-col gap-3">
          {pending !== null && pending.length === 0 && (
            <p className="text-sm text-ink-soft">
              Tu agente no te está pidiendo permiso para nada ahora mismo.
            </p>
          )}
          {(pending ?? []).map((a) => {
            const waited = timeAgo(a.created_at);
            const expanded = expandedId === a.id;
            const rejecting = rejectingId === a.id;
            const summary = a.summary ? stripMarks(a.summary) : "";
            const detail = details[a.id];
            const det = typeof detail === "string" ? undefined : detail;
            // What has to be read to decide: the agent's comment with the
            // formatted request. Before, `a.body` was shown, which is the
            // ticket's description — i.e. the same summary from above,
            // repeated. Expanding added nothing and the email wasn't there.
            const proposal = chooseProposal(det, a.body?.trim() ?? "");
            const body = proposal.text;
            const discussion = conversation(det, body);
            // The "no" already in the thread. What you just sent wins (it
            // knows whether the notice went out); otherwise it's derived
            // from the comments, which is what makes it survive an F5.
            const negotiation = negotiationStatus(det, proposal);
            const localRejection = rejected[a.id];
            const rejection: Rejected | null = localRejection
              ? { ...localRejection, replied: negotiation?.replied ?? false }
              : negotiation
              ? {
                  when: negotiation.when,
                  reason: negotiation.reason,
                  notified: null,
                  replied: negotiation.replied,
                }
              : null;
            const blockReason = det?.outcome?.summary?.trim() ?? "";
            const correcting = correctingId === a.id;
            // The brief (summary + "if you approve / if you reject / why"
            // box) is read to decide; what gets edited is ONLY the text
            // that's going to be sent. See `splitProposal`.
            const { brief, text: sendable } = splitProposal(body);
            /** THE BOX IS THE VERSION SHE ALREADY REJECTED. Happens when the
             *  agent re-proposes in prose: only proposals with a markdown
             *  box get in above, so what keeps showing is the old one. It's
             *  the condition that governs both halves of "Correct and
             *  approve" — the notice and the text that starts in the editor. */
            const wasRejected = Boolean(negotiation?.staleProposal);
            // A TEXT SHE ALREADY REJECTED IS NEVER PRELOADED. Approving with
            // a correction sends whatever's in the box as "use exactly this
            // version": preloading it with the rejected proposal turns the
            // screen's most careful button into the most dangerous of the
            // three — worse than plain Approve, because it also signs it as
            // her own decision. With no new parseable proposal, the box
            // starts empty and the screen explains why.
            const draftStart = wasRejected ? "" : sendable;
            // With no real changes there's nothing to correct: it's a
            // regular approval. Doesn't apply when it starts empty: there,
            // "you didn't change anything" would be telling her to approve
            // exactly what she rejected.
            const noChanges = correcting && !wasRejected && draft.trim() === sendable.trim();
            return (
              // The marker is a class and not a ref because `Card` doesn't
              // take a ref; it's what `bringIntoView` looks for.
              <Card key={a.id} className={expanded ? "request-open scroll-mt-6" : ""}>
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => toggle(a.id)}
                  className="flex w-full items-start justify-between gap-3 text-left"
                >
                  <div className="min-w-0 flex-1">
                    <h2 className="text-sm font-semibold text-ink">{a.title}</h2>
                    {summary && (
                      <p className="mt-0.5 text-sm text-ink-soft line-clamp-2">{summary}</p>
                    )}
                    {/* Say what's behind the arrow. Without this the client
                        expands blind, and when what showed up was the same
                        text, it felt dumb ("I thought it didn't open"). */}
                    <span className="mt-1 inline-flex items-center gap-1 text-[12px] font-semibold text-primary">
                      {expanded ? "Ocultar el detalle" : "Ver qué quiere hacer"}
                      <ChevronDown
                        className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`}
                      />
                    </span>
                  </div>
                  {waited && (
                    <span className="shrink-0 whitespace-nowrap pt-0.5 text-[12px] text-ink-soft">
                      espera {waited}
                    </span>
                  )}
                </button>

                {/* You answered no and the request is still here: the agent
                    is about to come back with another version. Goes above
                    all of the detail, expanded or not, because it's the
                    card's status. */}
                {rejection && <RejectedNotice r={rejection} agentName={agentName} />}

                {/* Why it stopped: comes from the block event, not from the
                    agent remembering to explain it. */}
                {expanded && blockReason && (
                  <p className="mt-3 rounded-lg border border-c-amber bg-c-amber/30 px-3 py-2 text-[13px] text-c-amber-ink">
                    <span className="font-semibold">Por qué se frenó: </span>{blockReason}
                  </p>
                )}

                {expanded && detail === "loading" && !body && (
                  <div className="mt-3"><Spinner /></div>
                )}

                {/* The request comes in markdown (an email draft, a
                    plan...): rendered with the same component as the chat.
                    The box keeps its own internal scroll, and wide content
                    (code, tables, KaTeX) already brings its own overflow-x,
                    so the page doesn't shift. The `[&>div]` is <Markdown>'s
                    wrapper: we bring it down to 13px so it doesn't override
                    the card's density. */}
                {/* THE BOX CAN BE THE VERSION YOU ALREADY REJECTED, and
                    that's said. Only proposals with a markdown box get in
                    below, and the agent can't be required to use it: if it
                    answers in prose, what's below stays the old one. Before,
                    the screen said nothing and it stayed at "8% / Monday
                    17" with Approve underneath while the conversation said
                    "12% / Monday 24" two lines below.

                    AND THE NOTICE DOESN'T TURN OFF WHEN CORRECTING. It had
                    `!correcting`, so tapping "Correct and approve" —the
                    button that does exactly what the notice is there to
                    prevent— made it disappear. The warning went away
                    exactly at the step where it was needed. */}
                {expanded && body && wasRejected && (
                  <p className="mt-3 rounded-lg border border-c-amber bg-c-amber/25 px-3 py-2 text-[12.5px] leading-snug text-c-amber-ink">
                    {correcting ? (
                      <>
                        <span className="font-semibold">Empezás de cero, a propósito.</span>{" "}
                        {negotiation?.replied
                          ? "No te dejo puesto el texto que rechazaste. Lo que te contestó después está justo acá abajo, en “Lo que hablaron”: copiá de ahí lo que te sirva."
                          : "No te dejo puesto el texto que rechazaste. Escribí vos la versión que sí querés que use."}
                      </>
                    ) : (
                      <>
                        <span className="font-semibold">Le dijiste que no a esto.</span>{" "}
                        {negotiation?.replied
                          ? "Lo que te contestó después está más abajo, en “Lo que hablaron”: fijate ahí cuál es la versión nueva."
                          : "Esperá la versión nueva; esto es lo que rechazaste."}
                      </>
                    )}
                  </p>
                )}

                {expanded && body && !correcting && (
                  <div className="mt-3 max-h-96 overflow-auto overscroll-contain rounded-lg bg-black/[0.03] p-3 [&>div]:text-[13px]">
                    <Markdown>{body}</Markdown>
                  </div>
                )}

                {/* What was discussed after the request. Used to go only on
                    the kanban: if you commented something to the agent and
                    it answered, you need to be able to read it HERE, which
                    is where you decide.

                    Hidden while correcting so it doesn't distract — EXCEPT
                    when what you're correcting is a proposal you rejected:
                    there, the new version lives precisely in this
                    conversation, and hiding it would be asking her to write
                    from memory what the agent just answered. */}
                {expanded && (!correcting || wasRejected) && discussion.length > 0 && (
                  <div className="mt-3">
                    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
                      Lo que hablaron
                    </p>
                    <div className="flex flex-col gap-2">
                      {discussion.map((c, i) => {
                        // Signed `cliente` doesn't mean she wrote it:
                        // approve-with-correction and reject leave an
                        // instruction there for the machine ("REJECTED BY
                        // YOUR CLIENT. Don't do what you asked to have
                        // approved…"). What shows is the label for what it
                        // was and HER words, nothing more.
                        // THE AUTHOR ALWAYS SHOWS: without it, the same
                        // filter applied to the AGENT's comments, and since
                        // a rejection only shows the reason block —which one
                        // of its own comments doesn't have—, anything it
                        // wrote starting with "REJECTED BY YOUR CLIENT."
                        // came out as «Tu agente · Lo rechazaste» and
                        // NOTHING ELSE.
                        const { text, label } = readComment(c.body ?? "", c.author);
                        return (
                          <div key={`${c.created_at}-${i}`} className="rounded-lg border border-black/[0.07] px-3 py-2">
                            <p className="mb-0.5 text-[11px] font-semibold text-ink-soft">
                              {/* THE LABEL WASN'T BINARY AND HERE IT WAS READ
                                  AS IF IT WERE. On the screen where the
                                  client AUTHORIZES, a comment from the
                                  company's founder —"Careful, I promised
                                  Panadería Rivas the old price until the end
                                  of the month"— came out signed «Tu
                                  agente». The kanban, with the same data,
                                  showed it right: the good label existed on
                                  only one of the two screens. Now it's the
                                  same one, and it lives in the lib. */}
                              {authorLabel(c.author, agentName)}
                              {label && <span className="font-normal"> · {label}</span>}
                              {" · "}{timeAgo(c.created_at)}
                            </p>
                            {text && (
                              <div className="[&>div]:text-[13px]"><Markdown>{text}</Markdown></div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* In correction mode, EL TEXTO QUE SE VA A MANDAR gets
                    edited, not the whole brief. Before, the entire markdown
                    showed up here —`**Qué quiero hacer:**`, `| Si aprobás |
                    … |`— and a client who only wanted to change a number ran
                    into something meant for a programmer. Cmd/Ctrl+Enter confirms. */}
                {expanded && correcting && (
                  <div className="mt-3">
                    <p className="mb-1.5 text-[12.5px] font-semibold text-ink">
                      {wasRejected
                        ? "Escribí el texto que sí querés que mande."
                        : "Este es el texto que se va a mandar. Cambiá lo que quieras."}
                    </p>
                    <textarea
                      autoFocus
                      rows={Math.min(16, Math.max(6, draft.split("\n").length + 2))}
                      aria-label="El texto que se va a mandar"
                      placeholder={wasRejected ? "Escribí acá la versión que sí va" : undefined}
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                          doApproveWithCorrection(a, draftStart);
                        }
                        if (e.key === "Escape") stopCorrecting();
                      }}
                      className={`${inputCls} resize-y leading-relaxed`}
                    />
                    {/* The brief that's kept is the one for the request she
                        rejected: promising her that "it stays exactly as you
                        read it above" would be reassuring her with what she
                        doesn't want. */}
                    {brief && !wasRejected && (
                      <p className="mt-1.5 text-[12px] leading-snug text-ink-soft">
                        El resto del pedido (para qué es y qué pasa si decís que sí) no se
                        toca: se mantiene tal cual lo leíste arriba.
                      </p>
                    )}
                  </div>
                )}

                {cardErrors[a.id] && (
                  <p className="mt-3 rounded-lg border border-c-coral bg-c-coral/40 px-3 py-2 text-[13px] text-c-coral-ink">
                    {cardErrors[a.id]}
                  </p>
                )}

                {expanded &&
                  (rejecting ? (
                    <div className="mt-3">
                      {/* What's going to happen, BEFORE writing. The two
                          ways of saying no end up different, so the text
                          changes with the checkbox instead of describing
                          only one. */}
                      <p className="mb-1.5 text-[12.5px] leading-snug text-ink-soft">
                        Esto le llega como un mensaje tuyo en este mismo pedido.{" "}
                        {closeRequest
                          ? "Al cerrarlo, el pedido sale de esta lista y no te lo va a volver a proponer."
                          : "El pedido se queda acá, esperando tu ok, hasta que la versión que te traiga te sirva."}
                      </p>
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <input
                        autoFocus
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && doReject(a)}
                        placeholder={closeRequest
                          ? "Contale por qué no va"
                          : "Contale a tu agente por qué lo rechazás"}
                        className={inputCls + " flex-1"}
                      />
                      <div className="flex shrink-0 justify-end gap-2">
                        <Btn
                          kind="ghost"
                          size="sm"
                          disabled={rejectingNow === a.id}
                          onClick={() => {
                            setRejectingId(null);
                            setReason("");
                            setCloseRequest(false);
                          }}
                        >
                          Cancelar
                        </Btn>
                        <Btn
                          kind="danger"
                          size="sm"
                          disabled={!reason.trim() || rejectingNow === a.id}
                          onClick={() => doReject(a)}
                        >
                          {rejectingNow === a.id
                            ? (closeRequest ? "Cerrando…" : "Mandando…")
                            : (closeRequest ? "Cerrar el pedido" : "Mandarle esto")}
                        </Btn>
                      </div>
                      </div>
                      {/* THE DECISION TO CLOSE BELONGS TO THE CLIENT, NOT TO
                          THE MODEL READING THE REASON. There are two
                          different "no"s —"not like this, bring me another"
                          and "this isn't happening"— and without this
                          checkbox only the first existed: a truly rejected
                          request stayed forever in the list with a live
                          Approve button that no longer approved anything. */}
                      <label className="mt-2.5 flex cursor-pointer items-start gap-2">
                        <input
                          type="checkbox"
                          checked={closeRequest}
                          onChange={(e) => setCloseRequest(e.target.checked)}
                          className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-primary"
                        />
                        <span className="min-w-0">
                          <span className="text-[13px] font-semibold text-ink">
                            Cerrar el pedido: esto no va más, no me lo vuelvas a proponer
                          </span>
                          <span className="mt-0.5 block text-[12px] leading-snug text-ink-soft">
                            Dejala sin marcar si lo que querés es otra versión. Marcala si el
                            pedido no va: se cierra, desaparece de esta lista y tu agente no te lo
                            vuelve a proponer. Si más adelante cambiás de idea, pediselo por el chat.
                          </span>
                        </span>
                      </label>
                    </div>
                  ) : correcting ? (
                    <>
                      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                        {noChanges && (
                          <span className="mr-auto text-[12px] text-ink-soft">
                            No cambiaste nada — usá Aprobar
                          </span>
                        )}
                        <Btn kind="ghost" size="sm" onClick={stopCorrecting}>
                          Cancelar
                        </Btn>
                        <Btn
                          kind="primary"
                          size="sm"
                          disabled={!draft.trim() || noChanges}
                          onClick={() => doApproveWithCorrection(a, draftStart)}
                        >
                          Aprobar con esta versión
                        </Btn>
                      </div>
                      {/* Honesty: the original request stays as it is; what
                          gets sent is your comment. No "we edited the ticket". */}
                      <p className="mt-2 text-[12px] leading-snug text-ink-soft">
                        Tu versión queda asentada como comentario y es la que el agente tiene que
                        usar. El texto original del pedido no se modifica.
                      </p>
                    </>
                  ) : (
                    <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                      <span className="mr-auto">
                        <CopyLink label="Copiar el link de este pedido" />
                      </span>
                      <Btn
                        kind="danger"
                        size="sm"
                        onClick={() => {
                          setRejectingId(a.id);
                          setReason("");
                          setCloseRequest(false);
                        }}
                      >
                        {rejection ? "Decirle que no otra vez" : "Rechazar"}
                      </Btn>
                      {body && (
                        <Btn
                          kind="secondary"
                          size="sm"
                          onClick={() => {
                            setRejectingId(null);
                            setReason("");
                            setCorrectingId(a.id);
                            // Just the text, not the brief — and empty if
                            // the only thing there is to copy is what she
                            // already rejected.
                            setDraft(draftStart);
                          }}
                        >
                          <PencilLine className="h-3.5 w-3.5" />
                          Corregir y aprobar
                        </Btn>
                      )}
                      <Btn kind="primary" size="sm" onClick={() => doApprove(a)}>
                        Aprobar
                      </Btn>
                    </div>
                  ))}
              </Card>
            );
          })}

          {/* Blocked on something missing. Carries no Approve: there's
              nothing to approve, and tapping it spends the request's only
              unblock without moving anything. See `BlockedCard`. */}
          {blocked !== null && blocked.length > 0 && (
            <section className="mt-4">
              <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-soft">
                Frenado hasta que se conecte algo
              </h2>
              <div className="flex flex-col gap-2">
                {blocked.map((f) => (
                  <BlockedCard
                    key={f.id}
                    a={f}
                    connections={connections}
                    agentName={agentName}
                    waited={timeAgo(f.created_at)}
                    expanded={expandedId === f.id}
                    onToggle={() => toggle(f.id)}
                    askingReason={rejectingId === f.id}
                    reason={reason}
                    setReason={setReason}
                    rejecting={rejectingNow === f.id}
                    error={cardErrors[f.id]}
                    onOpenReason={() => { setRejectingId(f.id); setReason(""); }}
                    onCancelReason={() => { setRejectingId(null); setReason(""); }}
                    onConfirmClose={() => doReject(f)}
                    onRetry={() => doApprove(f, "retry")}
                  />
                ))}
              </div>
            </section>
          )}

          {/* What you yourself requested. Carries no Approve/Reject: you
              don't have to authorize yourself — it's waiting on us. */}
          {requested !== null && requested.length > 0 && (
            <section className="mt-4">
              <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-soft">
                Lo que pediste
              </h2>
              <div className="flex flex-col gap-2">
                {requested.map((p) => (
                  <Card key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <span className="min-w-0 flex-1 text-sm font-semibold text-ink">{p.title}</span>
                    {/* The word comes from the dictionary, not from here:
                        it's the same one the kanban puts on the column for
                        these same tickets. Handwritten on both screens, it
                        had already drifted apart once. */}
                    <Chip tone={COLUMN_LABEL.ours.tone}>
                      <Clock className="h-3 w-3" /> {COLUMN_LABEL.ours.label}
                    </Chip>
                    <span className="w-full text-[12px] text-ink-soft">
                      Lo pediste {timeAgo(p.created_at)}. Te escribimos cuando esté; no tenés
                      que hacer nada.
                    </span>
                  </Card>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
