"use client";

// Bandeja — the conversations that came in through a channel: a WhatsApp
// chat, an Instagram comment or DM, a mail. It is the base plan's messages
// tab: the agent answers WhatsApp and Instagram on its own, with the owner's
// rules, and this is where she sees what was said.
//
// THERE IS NO SECOND STORE AND NO SECOND ROUTE. A conversation is a ticket of
// the board whose `source` is a channel, and this screen is
// `GET /portal/tickets?source=channels` (`kit/plugins/kanban/core/`). The
// Board asks the same call with `?source=work` and the two lists never
// overlap: a ticket lives on one screen, and a client who answers a mail on
// the board and then finds it again in the inbox is a client with two inboxes.
//
// WHAT THE CLIENT DOES HERE IS READ AND DECIDE. She does not write the answer:
// a mail's waits for her ok in Aprobaciones; an Instagram or WhatsApp answer
// goes out on its own (since 2026-09-24), and a blocked thread there is one
// the agent left for her, with its note on the thread. On WhatsApp she can
// also answer from her own phone, which takes the chat over for a while
// (`TakeoverBanner`), and give it back from here. What she can do is TELL THE AGENT
// something about the conversation, and that goes where everything the client
// asks for goes — the chat, with the request already written (`?p=`).
//
// IT IS DRAWN LIKE THE MESSAGING APPS SHE ALREADY USES (Luis, 2026-09-24):
// the list of chats on the left, the open one on the right with its bubbles,
// and at the bottom, where a composer would be, the box that asks the agent.
// The whole screen is one viewport tall and each pane scrolls on its own; on
// a phone it is one pane at a time.

import {
  useCallback, useEffect, useId, useMemo, useRef, useState, type ComponentType,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, ChevronDown, Hand, Inbox, Mail, MessagesSquare, RefreshCw, Search, Send, Smartphone, X,
} from "lucide-react";
import {
  getApprovals, getFlows, getManifest, getTicketDetail, getTickets, isTheAgent, isTheClient,
  loadConfig, readComment, authorLabel,
  type PortalConfig, type Ticket, type TicketComment, type TicketDetail,
} from "../lib/agent";
import { buildChatLink } from "../lib/flowExamples";
import { momentOf, timeOf } from "../lib/labels";
import { loadAgentName } from "../lib/onboarding";
import { AgentitoAvatar, loadAgentLook } from "../lib/agentito";
import { CopyLink, PARAM, closeInRoute, openInRoute, useRouteParam } from "../lib/routes";
import {
  Chip, EmptyState, ErrorState, IconBtn, Spinner, StaleLinkNotice,
  connectRequest, enumerateEs, supportWhatsApp,
} from "../lib/ui";
import Markdown from "../lib/Markdown";
import { EntityProvider } from "../lib/EntityViewer";
import {
  CHANNELS, channelKey, chatOfRow, dayLabel, isOurSide, lastLineOf, listWhen, messageOf,
  personOf, phoneLabel, stateOf, takenOverUntil, whatsAppJid, whatsAppPerson,
  type Channel, type ChannelTicket, type Person, type State,
} from "./conversation";
import {
  ContactAvatar, TakeoverBanner, WhatsAppCard, WhatsAppLine, useSeen, useWhatsAppChat,
  useWhatsAppLink,
} from "./whatsapp";
import { InstagramMark, WhatsAppMark } from "../lib/glyphs";
import { useChanges } from "../lib/live";

type Glyph = ComponentType<{ className?: string }>;

const WhatsAppBrand: Glyph = (p) => <WhatsAppMark brand {...p} />;
const InstagramBrand: Glyph = (p) => <InstagramMark brand {...p} />;

// One mark per channel: `icon` quiet, in the ink of the text around it (the
// badge on an avatar, the filter chips), `brand` in the network's colors for
// the one place that says which network it is — the open thread's header.
// An Instagram comment and an Instagram DM share the mark; the label is what
// tells them apart.
const CHANNEL: Record<string, { icon: Glyph; brand: Glyph; label: string }> = {
  whatsapp: { icon: WhatsAppMark, brand: WhatsAppBrand, label: "WhatsApp" },
  mail: { icon: Mail, brand: Mail, label: "Mail" },
  instagram: { icon: InstagramMark, brand: InstagramBrand, label: "Comentario de Instagram" },
  "instagram-dm": { icon: InstagramMark, brand: InstagramBrand, label: "Mensaje de Instagram" },
};
/** The connections (catalog ids) whose messages land in this tab — the ones
 *  behind `CHANNEL`. A flow waiting on another one (a Google profile's
 *  reviews) is not why the Bandeja is empty. */
const INBOX_CONNECTIONS = new Set(["email", "instagram"]);

const channelOf = (t: Ticket) =>
  CHANNEL[(t.source ?? "").trim().toLowerCase()] ?? { icon: Inbox, brand: Inbox, label: "Mensaje" };

// When something last happened on it. `updated_at` is the comment or the move;
// `created_at` is the message that opened the thread and is all a conversation
// nobody has answered has.
const msOf = (t: Ticket): number => momentOf(t.updated_at ?? t.created_at)?.ms ?? 0;

const agentName = () => loadAgentName() || "Tu agente";

/** The line the client reads on a comment: her, the agent under the name she
 *  gave it, or the person — whose address or handle IS their name. */
const labelFor = (author: string) => authorLabel(author, agentName());

/** The person on a row or a thread: the WhatsApp chat's record when there is
 *  one, what the plugin wrote into the ticket otherwise. */
const personFor = (t: ChannelTicket | null, chat = t ? chatOfRow(t) : null): Person =>
  whatsAppJid(t) ? whatsAppPerson(t, chat) : personOf(t);

/** «laura», «Laura», «Láura» are one search. */
const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/* ── The list ───────────────────────────────────────────────────────────── */

/** What the row says about where the thread stands, when it is something
 *  she has to see. «Nuevo» is not a marker: it is the row in bold with a dot,
 *  the way every messaging app says «unread»; «Respondido» and «En curso»
 *  are the normal life of a chat and say nothing. */
const MARKER: Partial<Record<State["key"], { icon: Glyph; cls: string }>> = {
  left: { icon: Hand, cls: "text-c-amber-ink" },
  waiting_ok: { icon: Hand, cls: "text-c-amber-ink" },
  taken_over: { icon: Smartphone, cls: "text-c-violet-ink" },
};

/** A row: the person's face with the channel on it, their name, when, the
 *  last thing said, and — when it needs her — where it stands.
 *
 *  A WhatsApp row carries the chat's record (name, number, takeover) on the
 *  ticket itself, and asks WhatsApp for the picture ONLY ONCE IT IS ON SCREEN
 *  (`useSeen`): a Bandeja with two hundred chats does not ask for two hundred
 *  pictures on load (see `whatsapp.tsx` for why that matters). */
function Conversation({ cfg, t, open, waitingOk, onClick }: {
  cfg: PortalConfig; t: ChannelTicket; open: boolean; waitingOk: boolean; onClick: () => void;
}) {
  const [ref, seen] = useSeen<HTMLButtonElement>();
  const jid = whatsAppJid(t);
  const chat = chatOfRow(t);
  const { icon: Icon, label } = channelOf(t);
  const person = personFor(t, chat);
  const state = stateOf(t.status, { waitingOk, takenOver: takenOverUntil(chat) !== null });
  const marker = MARKER[state.key];
  const unread = state.key === "new";
  const last = lastLineOf(t);
  // Our side's last line says who wrote it, the way a group chat does: the
  // agent's answer and hers are both «ours», and only one is her.
  const by = last.author && isOurSide(last.author, person) ? `${labelFor(last.author)}: ` : "";
  // A mail has a subject worth its own line; an Instagram or WhatsApp
  // ticket's title only repeats who wrote and where, which the row says.
  const subject = channelKey(t) === "mail" ? t.title : null;
  const name = person.name || t.title;
  return (
    <button
      ref={ref}
      onClick={onClick}
      aria-current={open}
      title={label}
      className={`flex w-full items-center gap-3 border-b border-black/[0.07] px-3 py-2.5 text-left transition ${
        open ? "bg-c-violet/50" : "hover:bg-black/[0.025]"
      }`}
    >
      <span className="relative shrink-0">
        <ContactAvatar cfg={cfg} jid={jid} name={name} seen={seen} className="h-11 w-11" />
        <span className="absolute -bottom-0.5 -right-0.5 inline-flex h-[18px] w-[18px] items-center justify-center rounded-full border border-black/[0.07] bg-white">
          <Icon className="h-2.5 w-2.5 text-ink-soft" />
        </span>
      </span>
      <span className="block min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className={`min-w-0 flex-1 truncate text-[14px] text-ink ${unread ? "font-bold" : "font-semibold"}`}>
            {name}
          </span>
          <span className={`shrink-0 text-[11px] ${unread ? "font-semibold text-primary" : "text-ink-soft"}`}>
            {listWhen(t.updated_at ?? t.created_at)}
          </span>
        </span>
        {subject && <span className="block truncate text-[12px] font-medium text-ink">{subject}</span>}
        <span className="mt-0.5 flex items-center gap-2">
          <span className={`min-w-0 flex-1 truncate text-[13px] ${unread ? "font-medium text-ink" : "text-ink-soft"}`}>
            {by}{last.text}
          </span>
          {unread && <span aria-label="Nuevo" className="h-2.5 w-2.5 shrink-0 rounded-full bg-primary" />}
        </span>
        {marker && (
          <span className={`mt-1 flex items-center gap-1 text-[11px] font-semibold ${marker.cls}`}>
            <marker.icon className="h-3 w-3 shrink-0" />
            {state.label}
          </span>
        )}
      </span>
    </button>
  );
}

/** Todos · WhatsApp · Instagram · Mail — only the channels this agent has. */
function ChannelFilter({ channels, value, onChange }: {
  channels: Channel[]; value: Channel | null; onChange: (c: Channel | null) => void;
}) {
  const options: { key: Channel | null; label: string }[] = [
    { key: null, label: "Todos" },
    ...CHANNELS.filter((c) => channels.includes(c.key)),
  ];
  return (
    <div role="tablist" aria-label="Canal" className="flex gap-1.5 overflow-x-auto px-3 pb-2">
      {options.map((o) => {
        const on = o.key === value;
        const Icon = o.key ? CHANNEL[o.key].icon : Inbox;
        return (
          <button
            key={o.label}
            role="tab"
            aria-selected={on}
            onClick={() => onChange(o.key)}
            className={`inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-[12px] font-semibold transition ${
              on
                ? "border-c-violet bg-c-violet/60 text-c-violet-ink"
                : "border-black/[0.07] bg-white text-ink-soft hover:bg-black/[0.03] hover:text-ink"
            }`}
          >
            <Icon className="h-3 w-3" />
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ── The thread ─────────────────────────────────────────────────────────── */

/** The channels whose sends are marked `sent` (`board_store.comment`). Mail
 *  is not one of them: an agent line on a mail thread is still drawn as a
 *  message, as it always was. */
const NOTED_CHANNELS = new Set(["whatsapp", "instagram", "instagram-dm"]);

/** Whose a bubble is. `agent` is every line of our side that is not hers —
 *  the agent, and on a mail the mailbox the answer went out as. */
type Side = "theirs" | "agent" | "owner";

type Line =
  | { kind: "day"; key: string; label: string }
  | { kind: "note"; key: string; body: string; at: number | string }
  | {
      kind: "msg"; key: string; side: Side; author: string; who: string; body: string;
      at: number | string;
      /** The first of a run by the same author: it carries the name. */
      head: boolean;
    };

/** The thread as the timeline draws it: the message that opened it, then the
 *  comments, with a separator where the day changes and the author's name
 *  once per run of consecutive messages.
 *
 *  THE FIRST MESSAGE HAS NO AUTHOR: it is the ticket's body, the mail or the
 *  comment that started the conversation, and it is theirs by definition. */
function linesOf(ticket: Ticket, comments: TicketComment[], person: Person): Line[] {
  const raw: { author: string; body: string; at: number | string; theirs?: boolean; sent?: boolean }[] = [];
  if (ticket.body?.trim()) raw.push({ author: "", body: messageOf(ticket), at: ticket.created_at, theirs: true });
  for (const c of comments) raw.push({ author: c.author, body: c.body, at: c.created_at, sent: c.sent });

  const noted = NOTED_CHANNELS.has(ticket.source ?? "");
  const lines: Line[] = [];
  let day: number | null = null;
  let run: string | null = null;
  raw.forEach((r, i) => {
    const m = momentOf(r.at);
    if (m && m.days !== day) {
      day = m.days;
      run = null;
      lines.push({ kind: "day", key: `day-${i}`, label: dayLabel(m) });
    }
    // THE AGENT'S NOTE FOR THE OWNER is not a message the person got: on
    // WhatsApp and Instagram, what went out is marked `sent`, and an agent
    // line that wasn't is drawn as a note across the thread, in its place.
    if (noted && !r.theirs && isTheAgent(r.author) && !r.sent) {
      run = null;
      lines.push({ kind: "note", key: `note-${i}`, body: r.body, at: r.at });
      return;
    }
    const ours = !r.theirs && isOurSide(r.author, person);
    const side: Side = !ours ? "theirs" : isTheClient(r.author) ? "owner" : "agent";
    const runKey = side === "theirs" ? "theirs" : `${side}:${r.author}`;
    lines.push({
      kind: "msg",
      key: `msg-${i}`,
      side,
      author: r.author,
      who: ours ? labelFor(r.author) : person.name || (r.author ? labelFor(r.author) : "Quien escribió"),
      body: r.body,
      at: r.at,
      head: runKey !== run,
    });
    run = runKey;
  });
  return lines;
}

const BUBBLE: Record<Side, string> = {
  theirs: "border-black/[0.07] bg-white",
  agent: "border-c-violet bg-c-violet/70",
  owner: "border-c-green bg-c-green/50",
};

/** One message. Theirs on the left, ours on the right: the agent's in
 *  violet with its face by its name, hers — what she typed on her own phone —
 *  in green, as «Vos». The time sits inside, at the bottom right. */
function Bubble({ line, look, wide }: {
  line: Extract<Line, { kind: "msg" }>;
  look: ReturnType<typeof loadAgentLook>;
  wide: boolean;
}) {
  const ours = line.side !== "theirs";
  const { text, label } = readComment(line.body ?? "", line.author);
  // The corner the bubble comes out of, on the first of a run.
  const corner = line.head ? (ours ? "rounded-tr-sm" : "rounded-tl-sm") : "";
  return (
    <li className={`flex ${ours ? "justify-end" : "justify-start"} ${line.head ? "mt-3" : "mt-1"}`}>
      <div
        className={`flex min-w-0 flex-col ${ours ? "items-end" : "items-start"} ${
          wide ? "max-w-[92%]" : "max-w-[85%] md:max-w-[70%]"
        }`}
      >
        {line.head && (
          <span className="mb-1 flex items-center gap-1.5 px-1 text-[11px] font-semibold text-ink-soft">
            {line.side === "agent" && isTheAgent(line.author) && (
              <AgentitoAvatar look={look} className="h-4 w-4 shrink-0" />
            )}
            {line.who}
            {label && <span className="font-medium">· {label}</span>}
          </span>
        )}
        <div className={`min-w-0 max-w-full rounded-xl border px-3 py-1.5 ${BUBBLE[line.side]} ${corner}`}>
          <div className="flex flex-wrap items-end gap-x-3">
            {text ? (
              <div className="min-w-0 max-w-full [&>div]:text-[13px]">
                <Markdown>{text}</Markdown>
              </div>
            ) : label ? null : (
              <p className="text-[13px] text-ink-soft">(sin texto)</p>
            )}
            <span className="ml-auto pb-0.5 text-[10px] leading-none text-ink-soft">{timeOf(line.at)}</span>
          </div>
        </div>
      </div>
    </li>
  );
}

/** What the agent wrote FOR THE OWNER when it didn't answer the person: not a
 *  bubble on either side, a card across the thread.
 *
 *  ONLY THE LAST THING SAID GETS THE CARD OPEN. A note with the conversation
 *  going on after it was already dealt with — the person wrote again, someone
 *  answered — so it folds to one line she can open (Luis, 2026-09-24). */
function AgentNote({ body, at, latest }: { body: string; at: string | number; latest: boolean }) {
  const [open, setOpen] = useState(latest);
  useEffect(() => { setOpen(latest); }, [latest]);
  const head = (
    <>
      <Hand className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate text-left">
        Nota de {agentName()} para vos · no se la mandó
      </span>
      <span className="shrink-0 font-normal text-ink-soft">{timeOf(at)}</span>
    </>
  );
  return (
    <li className="my-3 flex justify-center">
      <div className={`w-full max-w-lg rounded-xl border border-c-amber ${open ? "bg-c-amber/40" : "bg-c-amber/15"} px-3 py-2`}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex w-full items-center gap-1.5 text-[11px] font-semibold text-c-amber-ink"
        >
          {head}
          <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition ${open ? "rotate-180" : ""}`} />
        </button>
        {open && (
          <div className="mt-1 [&>div]:text-[13px]">
            <Markdown>{body}</Markdown>
          </div>
        )}
      </div>
    </li>
  );
}

/** The timeline. It opens at the bottom — the last thing said is what she
 *  came to read — and goes back to the bottom when something new arrives
 *  (`useChanges` reloads the detail, the line count grows). */
function Thread({ ticket, comments, person, look }: {
  ticket: Ticket; comments: TicketComment[]; person: Person; look: ReturnType<typeof loadAgentLook>;
}) {
  const lines = useMemo(() => linesOf(ticket, comments, person), [ticket, comments, person]);
  const scroller = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  // Whether she is reading the end. A bubble's height is not final when it
  // mounts — a mermaid, an image, an attachment chip land later — and the
  // pane changes size with the window: while she is at the bottom, it keeps
  // her there; once she scrolls up to read, it leaves her alone.
  const atEnd = useRef(true);
  const toEnd = () => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  };
  useEffect(() => { atEnd.current = true; toEnd(); }, [ticket.id, lines.length]);
  useEffect(() => {
    const ro = new ResizeObserver(() => { if (atEnd.current) toEnd(); });
    if (list.current) ro.observe(list.current);
    if (scroller.current) ro.observe(scroller.current);
    return () => ro.disconnect();
  }, []);
  const onScroll = () => {
    const el = scroller.current;
    if (el) atEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  };
  // A mail is read as a letter, not a line: its bubbles take the width.
  const wide = channelKey(ticket) === "mail";
  // The last line that is a message or a note: a note is «latest» only when
  // nothing was said after it (day separators don't count).
  const last = [...lines].reverse().find((l) => l.kind !== "day");
  return (
    <div ref={scroller} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto bg-black/[0.025] px-3 py-3 [overflow-anchor:none] md:px-6">
      <ul ref={list} className="mx-auto flex max-w-3xl flex-col pb-2">
        {lines.map((l) =>
          l.kind === "day" ? (
            <li key={l.key} className="my-3 flex justify-center">
              <span className="rounded-lg border border-black/[0.07] bg-white px-2.5 py-0.5 text-[11px] font-semibold text-ink-soft">
                {l.label}
              </span>
            </li>
          ) : l.kind === "note" ? (
            <AgentNote key={l.key} body={l.body} at={l.at} latest={l === last} />
          ) : (
            <Bubble key={l.key} line={l} look={look} wide={wide} />
          ),
        )}
      </ul>
    </div>
  );
}

// Where she answers the person HERSELF, said under the box that does not.
const ANSWER_YOURSELF: Record<Channel, string> = {
  whatsapp: "Para escribirle vos, contestale desde tu celular.",
  instagram: "Para escribirle vos, contestale desde Instagram.",
  mail: "Para escribirle vos, contestale desde tu mail.",
};

/** Where a composer would be: one line to the AGENT about this conversation,
 *  and the chat opens with the request already sent. The person never reads
 *  it — the line under the box says so, and where she writes to them.
 *
 *  The sentence is FINISHED before the link exists. `?p=` sends itself the
 *  moment the chat opens (`docs/portal-routes.md`), so a link ending in a
 *  colon for the client to complete would land her in a screen where there is
 *  nothing left to complete — the same reason Posteos asks what is wrong with
 *  the image before it builds the link. */
function AskAgent({ ticket }: { ticket: Ticket }) {
  const [what, setWhat] = useState("");
  const router = useRouter();
  const field = useId();
  const ask = what.trim();
  const href = ask
    ? buildChatLink(`Sobre la conversación «${ticket.title}» (${ticket.id}): ${ask}`)
    : null;
  const channel = channelKey(ticket);
  return (
    <div className="shrink-0 border-t border-black/[0.07] bg-white px-3 pb-2.5 pt-2.5 md:px-4">
      <form
        className="mx-auto flex max-w-3xl items-center gap-2"
        onSubmit={(e) => { e.preventDefault(); if (href) router.push(href); }}
      >
        <label htmlFor={field} className="sr-only">
          Qué querés que haga {agentName()} con esta conversación
        </label>
        <input
          id={field}
          value={what}
          onChange={(e) => setWhat(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Escape") setWhat(""); }}
          placeholder={`Pedile algo a ${agentName()} sobre esta conversación…`}
          className="h-10 min-w-0 flex-1 rounded-xl border border-black/10 bg-black/[0.025] px-3.5 text-[14px] text-ink outline-none transition placeholder:text-ink-soft/70 focus:border-primary focus:bg-white focus:ring-2 focus:ring-primary/15"
        />
        <button
          type="submit"
          disabled={!href}
          aria-label="Pedírselo"
          title="Pedírselo"
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-white transition hover:bg-primary-dark disabled:opacity-40"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
      <p className="mx-auto mt-1.5 max-w-3xl px-1 text-[11px] text-ink-soft">
        Se lo pedís a {agentName()} en el chat; la persona no lo ve.
        {channel && ` ${ANSWER_YOURSELF[channel]}`}
      </p>
    </div>
  );
}

export default function InboxPage() {
  const [agentLook] = useState(loadAgentLook);
  const [cfg] = useState<PortalConfig | null>(() => loadConfig());
  const [tickets, setTickets] = useState<ChannelTicket[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // WHAT IS OPEN IS THE URL'S TO SAY: `/app/inbox?thread=t_ab12`.
  const openId = useRouteParam(PARAM.thread);
  const [detail, setDetail] = useState<TicketDetail | null>(null);
  const [detailError, setDetailError] = useState(false);
  const openIdRef = useRef<string | null>(null);

  // The pending requests, only to answer one question: does THIS conversation
  // have one waiting? See `approvalFor`.
  const [approvals, setApprovals] = useState<{ id: string; body?: string }[]>([]);

  // What the channels that fill this tab are still waiting on: the flows'
  // own labels (`missing_connection_labels`). An empty Bandeja on an agent
  // with no mailbox connected is not «nothing came in», and saying where to
  // ask for it is the only useful thing that screen can do.
  const [missing, setMissing] = useState<string[]>([]);
  useEffect(() => {
    if (!cfg) return;
    getFlows(cfg)
      .then((r) => setMissing(Array.from(new Set(
        (r.flows ?? []).filter((f) => f.status === "incomplete")
          .flatMap((f) => f.missing_connection_labels
            .filter((_, i) => INBOX_CONNECTIONS.has(f.missing_connections[i])))))))
      .catch(() => {});
  }, [cfg]);

  const inFlight = useRef(false);
  const load = useCallback(async () => {
    if (!cfg || inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    try {
      const res = await getTickets(cfg, "channels");
      setTickets(res.tickets);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
    getApprovals(cfg)
      .then((r) => setApprovals(r.approvals ?? []))
      .catch(() => setApprovals([]));
  }, [cfg]);

  useEffect(() => { load(); }, [load]);

  const loadDetail = useCallback(() => {
    if (!cfg || !openId) return;
    getTicketDetail(cfg, openId)
      .then((d) => { if (openIdRef.current === openId) setDetail(d); })
      .catch(() => { if (openIdRef.current === openId) setDetailError(true); });
  }, [cfg, openId]);

  useEffect(() => {
    openIdRef.current = openId;
    setDetail(null);
    setDetailError(false);
    loadDetail();
  }, [openId, loadDetail]);

  // A mail or a DM that came in, an answer the agent sent, a decision on a
  // reply: the list and the open thread move without a reload.
  useChanges(["tickets"], () => { load(); loadDetail(); });

  const openThread = useCallback((id: string) => openInRoute({ [PARAM.thread]: id }), []);
  const closeThread = useCallback(() => closeInRoute(PARAM.thread), []);

  // Whether this agent has WhatsApp at all: the messages plugin flips
  // `modules.whatsapp`, and without it there is no link, no line and no chip.
  const [hasWhatsApp, setHasWhatsApp] = useState(false);
  useEffect(() => {
    if (!cfg) return;
    getManifest(cfg).then((m) => setHasWhatsApp(Boolean(m.modules.whatsapp))).catch(() => {});
  }, [cfg]);
  const whatsApp = useWhatsAppLink(hasWhatsApp ? cfg : null);

  // THE FILTER AND THE SEARCH ARE A VIEW, NOT SOMETHING THAT OPENS: they have
  // no URL, and a link to a thread lands on it whatever they were.
  const [channel, setChannel] = useState<Channel | null>(null);
  const [query, setQuery] = useState("");

  const conversations = useMemo(
    () => [...(tickets ?? [])].sort((a, b) => msOf(b) - msOf(a)),
    [tickets],
  );
  // The chips are the channels this agent HAS: the ones something came in
  // through, and WhatsApp once it is installed even before its first message.
  const channels = useMemo(() => {
    const present = new Set(conversations.map(channelKey));
    if (hasWhatsApp) present.add("whatsapp");
    return CHANNELS.map((c) => c.key).filter((k) => present.has(k));
  }, [conversations, hasWhatsApp]);
  // The search reads what the row shows and what the thread opened with:
  // the name, the number or the address, the subject, the first and the last
  // message. It is the list the portal already has — nothing is asked for.
  const shown = useMemo(() => {
    const q = fold(query.trim());
    return conversations.filter((t) => {
      if (channel && channelKey(t) !== channel) return false;
      if (!q) return true;
      const p = personFor(t);
      return fold([
        p.name, p.handle, phoneLabel(t.phone), t.title, t.body, t.last_comment?.body,
      ].filter(Boolean).join(" ")).includes(q);
    });
  }, [conversations, channel, query]);

  // The detail wins — it carries the status after whatever just happened — and
  // until it arrives the row the client clicked paints the header.
  const ticket = useMemo<ChannelTicket | null>(() => {
    if (!openId) return null;
    return detail?.ticket ?? conversations.find((t) => t.id === openId) ?? null;
  }, [openId, detail, conversations]);

  // The open thread's WhatsApp chat: who it is and whether she took it over.
  const openJid = whatsAppJid(ticket);
  const { chat: openChat, reload: reloadChat } = useWhatsAppChat(cfg, openJid);
  const comments = useMemo<TicketComment[]>(() => detail?.comments ?? [], [detail]);
  const person = useMemo(
    () => (openJid ? whatsAppPerson(ticket, openChat) : personOf(ticket)),
    [openJid, ticket, openChat],
  );

  /** The request waiting on the client's ok FOR THIS CONVERSATION, if the card
   *  names it.
   *
   *  THE ENGINE HAS NO LINK FROM A TICKET TO ITS APPROVAL: a row in `approvals`
   *  carries the session it stopped in and the tool call it stopped at, not the
   *  ticket (`kit/plugins/approval/core/store.py`). What it DOES carry is the
   *  card's text, and the mail plugin writes the ticket's id into it («la
   *  conversación — tarea «…» (t_ab12)»), so an id found in a body is a true
   *  match — an id is unique and nothing else writes one there.
   *
   *  When no card names it, a blocked thread is one the agent LEFT for her:
   *  an Instagram or WhatsApp answer goes out with no card at all, so there is
   *  nothing in Aprobaciones to point at — only the agent's note on the
   *  thread. */
  const approvalFor = (t: Ticket) =>
    approvals.find((a) => (a.body ?? "").includes(t.id))?.id ?? null;

  const wrap = "mx-auto max-w-6xl px-6 py-6 md:px-8";
  if (!cfg) return <div className={wrap}><Spinner /></div>;
  if (tickets === null && error)
    return <div className={wrap}><ErrorState message={error} onRetry={load} /></div>;
  if (tickets === null) return <div className={wrap}><Spinner /></div>;

  // On WhatsApp the number goes where the address or the handle goes: it is
  // how she tells two Lauras apart.
  const handle = openJid ? phoneLabel(openChat?.phone) || null : person.handle;
  const requestId = ticket ? approvalFor(ticket) : null;
  const takenOver = takenOverUntil(openChat) !== null;
  const state = ticket ? stateOf(ticket.status, { waitingOk: Boolean(requestId), takenOver }) : null;
  const { brand: ChannelBrand, label: channelLabel } = ticket
    ? channelOf(ticket) : { brand: Inbox, label: "" };
  // The link is stale when the list has no such conversation AND the agent has
  // no such ticket: a plain notice and the list underneath, like every other
  // screen.
  const stale = Boolean(openId && detailError && !ticket);
  // A STALE LINK OPENS NOTHING. With the notice up top and an empty thread
  // panel next to it, the screen said both things at once: «that conversation
  // is not here any more» and a header with a close button over nothing.
  const showThread = Boolean(openId && !stale);
  const empty = conversations.length === 0 && !openId;
  // On a phone the open thread is the whole screen: what sits above the
  // panes belongs to the list.
  const listOnly = showThread ? "max-md:hidden" : "";

  return (
    <div className="flex h-dvh flex-col">
      <div className={`flex shrink-0 items-center justify-between gap-3 border-b border-black/[0.07] bg-white px-4 py-3 md:px-5 ${listOnly}`}>
        <h1 className="text-lg font-bold tracking-tight text-ink">Bandeja</h1>
        <IconBtn label="Actualizar" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </IconBtn>
      </div>
      {(stale || whatsApp.place === "card") && (
        <div className={`shrink-0 border-b border-black/[0.07] px-4 pt-4 md:px-5 ${whatsApp.place === "card" ? "pb-4" : ""} ${listOnly}`}>
          {stale && (
            <StaleLinkNotice>
              Esa conversación ya no está acá — puede que se haya archivado o que el link
              sea viejo. Abajo está todo lo que hay hoy.
            </StaleLinkNotice>
          )}
          {whatsApp.place === "card" && <WhatsAppCard link={whatsApp} />}
        </div>
      )}

      {empty ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {whatsApp.place === "line" && <WhatsAppLine link={whatsApp} />}
          <EmptyState
            icon={Inbox}
            title="Todavía no entró ningún mensaje"
            hint={missing.length > 0
              ? `Cuando alguien te escriba, la conversación aparece acá con lo que le contestó tu agente. Para eso falta conectar ${enumerateEs(missing)}: nos lo pedís y lo conectamos nosotros.`
              : "Cuando alguien te escriba, la conversación aparece acá con lo que le contestó tu agente."}
          />
          {missing.length > 0 && (
            <div className="-mt-10 flex justify-center pb-10">
              <a
                href={supportWhatsApp(connectRequest(missing))}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[13px] font-semibold text-primary underline underline-offset-2 transition hover:text-primary-dark"
              >
                Pedírnoslo por WhatsApp
              </a>
            </div>
          )}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <aside
            className={`flex min-h-0 w-full flex-col border-black/[0.07] bg-white md:w-[340px] md:shrink-0 md:border-r ${listOnly}`}
          >
            {whatsApp.place === "line" && <WhatsAppLine link={whatsApp} />}
            <div className="px-3 pb-2 pt-3">
              <label className="relative block">
                <span className="sr-only">Buscar una conversación</span>
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-soft" />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Escape") setQuery(""); }}
                  placeholder="Buscar por nombre, número o mensaje"
                  className="h-9 w-full rounded-lg border border-transparent bg-black/[0.04] pl-8 pr-3 text-[13px] text-ink outline-none transition placeholder:text-ink-soft/70 focus:border-primary focus:bg-white focus:ring-2 focus:ring-primary/15"
                />
              </label>
            </div>
            {channels.length > 1 && (
              <ChannelFilter channels={channels} value={channel} onChange={setChannel} />
            )}
            <div className="min-h-0 flex-1 overflow-y-auto border-t border-black/[0.07]">
              {shown.map((t) => (
                <Conversation
                  key={t.id}
                  cfg={cfg}
                  t={t}
                  open={t.id === openId}
                  waitingOk={t.status === "blocked" && approvalFor(t) !== null}
                  onClick={() => openThread(t.id)}
                />
              ))}
              {shown.length === 0 && (
                <p className="px-4 py-8 text-center text-[13px] text-ink-soft">
                  {query.trim()
                    ? `No hay conversaciones que digan «${query.trim()}».`
                    : `Todavía no hay conversaciones por ${CHANNELS.find((c) => c.key === channel)?.label}.`}
                </p>
              )}
            </div>
          </aside>

          <section className={`flex min-h-0 min-w-0 flex-1 flex-col ${showThread ? "" : "max-md:hidden"}`}>
            {!showThread ? (
              <div className="flex flex-1 flex-col items-center justify-center bg-black/[0.025] px-6 text-center">
                <span className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full bg-c-violet">
                  <MessagesSquare className="h-5 w-5 text-c-violet-ink" />
                </span>
                <p className="text-sm font-semibold text-ink">Elegí una conversación para leerla</p>
                <p className="mt-1 max-w-xs text-[13px] text-ink-soft">
                  Vas a ver lo que te escribieron y lo que les contestó tu agente.
                </p>
              </div>
            ) : (
              <EntityProvider cfg={cfg}>
                <header className="shrink-0 border-b border-black/[0.07] bg-white">
                  <div className="flex items-center gap-3 px-3 py-2.5 md:px-4">
                    <button
                      onClick={closeThread}
                      aria-label="Volver a la lista"
                      className="-ml-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-soft transition hover:bg-black/[0.04] hover:text-ink md:hidden"
                    >
                      <ArrowLeft className="h-4 w-4" />
                    </button>
                    <ContactAvatar
                      cfg={cfg}
                      jid={openJid}
                      name={person.name || ticket?.title || ""}
                      seen
                      className="h-10 w-10"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h2 className="min-w-0 truncate text-[15px] font-bold text-ink">
                          {person.name || ticket?.title}
                        </h2>
                        {state && <span className="shrink-0"><Chip tone={state.tone}>{state.label}</Chip></span>}
                      </div>
                      {/* Where, and the address, the handle or the number when
                          it is not already the name: it is how the client
                          knows WHICH Laura this is. */}
                      <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12px] text-ink-soft">
                        <ChannelBrand className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">
                          {channelLabel}
                          {handle && handle !== person.name && ` · ${handle}`}
                        </span>
                      </p>
                    </div>
                    <CopyLink label="Copiar el link de esta conversación" />
                    <span className="max-md:hidden">
                      <IconBtn label="Cerrar" onClick={closeThread}>
                        <X className="h-4 w-4" />
                      </IconBtn>
                    </span>
                  </div>
                  {ticket && channelKey(ticket) === "mail" && (
                    <p className="truncate border-t border-black/[0.07] px-4 py-1.5 text-[12px] text-ink">
                      <span className="text-ink-soft">Asunto: </span>{ticket.title}
                    </p>
                  )}
                  {openChat && takenOver && (
                    <TakeoverBanner
                      cfg={cfg}
                      chat={openChat}
                      onResumed={() => { reloadChat(); load(); }}
                    />
                  )}
                  {ticket?.status === "blocked" && requestId && (
                    <Link
                      href={`/app/approvals?${PARAM.request}=${encodeURIComponent(requestId)}`}
                      className="flex items-center gap-2 border-t border-black/[0.07] bg-c-amber/40 px-4 py-1.5 text-[12px] font-medium text-c-amber-ink transition hover:bg-c-amber/60"
                    >
                      <Hand className="h-3.5 w-3.5 shrink-0" />
                      La respuesta está escrita y espera tu ok. Ver en Aprobaciones
                    </Link>
                  )}
                  {ticket?.status === "blocked" && !requestId && (
                    <p className="flex items-center gap-2 border-t border-black/[0.07] bg-c-amber/40 px-4 py-1.5 text-[12px] font-medium text-c-amber-ink">
                      <Hand className="h-3.5 w-3.5 shrink-0" />
                      Tu agente te dejó esta conversación a vos: su nota está abajo.
                    </p>
                  )}
                </header>

                {!ticket ? (
                  <div className="flex-1"><Spinner /></div>
                ) : (
                  <Thread ticket={ticket} comments={comments} person={person} look={agentLook} />
                )}
                {detailError && ticket && (
                  <p className="shrink-0 border-t border-black/[0.07] bg-white px-4 py-2 text-[13px] text-ink-soft">
                    No pude traer el resto de la conversación.
                  </p>
                )}
                {ticket && <AskAgent ticket={ticket} />}
              </EntityProvider>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
