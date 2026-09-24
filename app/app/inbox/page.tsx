"use client";

// Bandeja — the conversations that came in through a channel: mail, an
// Instagram comment, an Instagram DM.
//
// THERE IS NO SECOND STORE AND NO SECOND ROUTE. A conversation is a ticket of
// the board whose `source` is a channel, and this screen is
// `GET /portal/tickets?source=channels` (`kit/plugins/kanban/core/`). The
// Board asks the same call with `?source=work` and the two lists never
// overlap: a ticket lives on one screen, and a client who answers a mail on
// the board and then finds it again in the inbox is a client with two inboxes.
//
// WHAT THE CLIENT DOES HERE IS READ AND DECIDE. She does not write the answer:
// a mail's waits for her ok in Aprobaciones; an Instagram answer goes out on
// its own (since 2026-09-24), and a blocked Instagram thread is one the agent
// left for her, with its note on the thread. What she can do is TELL THE AGENT
// something about the conversation, and that goes where everything the client
// asks for goes — the chat, with the request already written (`?p=`).

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Hand, Inbox, Instagram, Mail, MessageCircle, RefreshCw, Send, X,
  type LucideIcon,
} from "lucide-react";
import {
  getApprovals, getFlows, getTicketDetail, getTickets, isTheAgent, loadConfig, readComment,
  authorLabel,
  type PortalConfig, type Ticket, type TicketComment, type TicketDetail,
} from "../lib/agent";
import { buildChatLink } from "../lib/flowExamples";
import { dateTime, momentOf } from "../lib/labels";
import { loadAgentName } from "../lib/onboarding";
import { AgentitoAvatar, loadAgentLook } from "../lib/agentito";
import { CopyLink, PARAM, closeInRoute, openInRoute, useRouteParam } from "../lib/routes";
import {
  Btn, Chip, EmptyState, ErrorState, IconBtn, PageHeader, Spinner, StaleLinkNotice, inputCls,
  connectRequest, enumerateEs, supportWhatsApp,
} from "../lib/ui";
import Markdown from "../lib/Markdown";
import { EntityProvider } from "../lib/EntityViewer";
import { isOurSide, messageOf, personOf, previewOf, stateOf } from "./conversation";
import { useChanges } from "../lib/live";

// One icon per channel. `instagram-dm` is a MessageCircle and not the
// Instagram glyph: what the row says first is that somebody is talking to you
// in private, and the handle underneath already says where.
const CHANNEL: Record<string, { icon: LucideIcon; label: string }> = {
  mail: { icon: Mail, label: "Mail" },
  instagram: { icon: Instagram, label: "Comentario de Instagram" },
  "instagram-dm": { icon: MessageCircle, label: "Mensaje de Instagram" },
};
/** The connections (catalog ids) whose messages land in this tab — the ones
 *  behind `CHANNEL`. A flow waiting on another one (a Google profile's
 *  reviews) is not why the Bandeja is empty. */
const INBOX_CONNECTIONS = new Set(["email", "instagram"]);

const channelOf = (t: Ticket) =>
  CHANNEL[(t.source ?? "").trim().toLowerCase()] ?? { icon: Inbox, label: "Mensaje" };

// When something last happened on it. `updated_at` is the comment or the move;
// `created_at` is the message that opened the thread and is all a conversation
// nobody has answered has.
const msOf = (t: Ticket): number => momentOf(t.updated_at ?? t.created_at)?.ms ?? 0;

const agentName = () => loadAgentName() || "Tu agente";

/** The line the client reads on a comment: her, the agent under the name she
 *  gave it, or the person — whose address or handle IS their name. */
const labelFor = (author: string) => authorLabel(author, agentName());

/* ── The list ───────────────────────────────────────────────────────────── */

function Conversation({ t, open, onClick }: {
  t: Ticket; open: boolean; onClick: () => void;
}) {
  const { icon: Icon, label } = channelOf(t);
  const person = personOf(t);
  const state = stateOf(t.status);
  const preview = previewOf(t);
  return (
    <button
      onClick={onClick}
      aria-current={open}
      title={label}
      className={`w-full rounded-lg border px-3 py-2.5 text-left transition ${
        open
          ? "border-c-violet bg-c-violet/40"
          : "border-black/[0.07] bg-white hover:bg-black/[0.02]"
      }`}
    >
      <div className="flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 shrink-0 text-ink-soft" />
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">
          {person.name || t.title}
        </span>
        <span className="shrink-0 text-[11px] text-ink-soft">{dateTime(t.updated_at ?? t.created_at)}</span>
      </div>
      <p className="mt-1 truncate text-[13px] text-ink-soft">{t.title}</p>
      {preview && <p className="mt-0.5 truncate text-[12px] text-ink-soft/80">{preview}</p>}
      <div className="mt-1.5">
        <Chip tone={state.tone}>{state.label}</Chip>
      </div>
    </button>
  );
}

/* ── The thread ─────────────────────────────────────────────────────────── */

/** One message: theirs on the left, ours on the right and marked with the
 *  agent's face, the same way the Board draws a ticket's comments.
 *
 *  WHICH SIDE IT IS ON COMES IN AS A PROP and is not worked out from the
 *  author here, because the thread's FIRST message has no author at all: it is
 *  the ticket's body, the mail or the comment that started the conversation,
 *  and it is theirs by definition. */
function Message({ ours, who, author, body, at, look }: {
  ours: boolean;
  who: string;
  author: string;
  body: string;
  at: string | number;
  look: ReturnType<typeof loadAgentLook>;
}) {
  // The face goes next to the AGENT's messages and not next to the client's
  // own: both are drawn on the right, and only one of the two is it.
  const face = ours && isTheAgent(author);
  const { text, label } = readComment(body ?? "", author);
  return (
    <li className={`flex min-w-0 items-start gap-2 ${ours ? "justify-end" : "justify-start"}`}>
      {face && <AgentitoAvatar look={look} className="order-2 mt-0.5 h-7 w-7 shrink-0" />}
      <div
        className={`min-w-0 max-w-[85%] rounded-lg border px-3 py-2 ${
          ours ? "border-c-violet bg-c-violet/50" : "border-black/[0.07] bg-black/[0.02]"
        }`}
      >
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className={`text-[12px] font-semibold ${ours ? "text-c-violet-ink" : "text-ink"}`}>
            {who}
          </span>
          {label && <span className="text-[11px] font-medium text-ink-soft">{label}</span>}
          <span className="text-[11px] text-ink-soft">{dateTime(at)}</span>
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
}

/** «Pedirle al agente»: one line about this conversation, and the chat opens
 *  with the request already sent.
 *
 *  The sentence is FINISHED before the link exists. `?p=` sends itself the
 *  moment the chat opens (`docs/portal-routes.md`), so a link ending in a
 *  colon for the client to complete would land her in a screen where there is
 *  nothing left to complete — the same reason Posteos asks what is wrong with
 *  the image before it builds the link. */
function AskAgent({ ticket }: { ticket: Ticket }) {
  const [open, setOpen] = useState(false);
  const [what, setWhat] = useState("");
  const router = useRouter();
  const field = useId();
  const ask = what.trim();
  const href = ask
    ? buildChatLink(`Sobre la conversación «${ticket.title}» (${ticket.id}): ${ask}`)
    : null;

  if (!open) {
    return (
      <Btn kind="secondary" size="sm" onClick={() => setOpen(true)}>
        <Send className="h-3.5 w-3.5" />
        Pedirle al agente
      </Btn>
    );
  }
  return (
    <div className="w-full">
      <label htmlFor={field} className="block text-[12px] font-semibold text-ink">
        Qué querés que haga con esta conversación
      </label>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <input
          id={field}
          autoFocus
          value={what}
          onChange={(e) => setWhat(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && href) { e.preventDefault(); router.push(href); }
            if (e.key === "Escape") { setOpen(false); setWhat(""); }
          }}
          placeholder="Contestale que sí, pero pedile la dirección"
          className={`${inputCls} min-w-[200px] flex-1`}
        />
        <Btn kind="primary" size="sm" disabled={!href} onClick={() => href && router.push(href)}>
          <Send className="h-3.5 w-3.5" />
          Pedírselo
        </Btn>
      </div>
    </div>
  );
}

export default function InboxPage() {
  const [agentLook] = useState(loadAgentLook);
  const [cfg] = useState<PortalConfig | null>(() => loadConfig());
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
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

  const conversations = useMemo(
    () => [...(tickets ?? [])].sort((a, b) => msOf(b) - msOf(a)),
    [tickets],
  );

  // The detail wins — it carries the status after whatever just happened — and
  // until it arrives the row the client clicked paints the header.
  const ticket = useMemo<Ticket | null>(() => {
    if (!openId) return null;
    return detail?.ticket ?? conversations.find((t) => t.id === openId) ?? null;
  }, [openId, detail, conversations]);

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
   *  When no card names it — an Instagram reply's card is about the comment,
   *  not about the ticket — the chip still points at Aprobaciones, the tab.
   *  That is the honest fallback: the request IS there, and what we cannot do
   *  is say which card it is. */
  const approvalFor = (t: Ticket) =>
    approvals.find((a) => (a.body ?? "").includes(t.id))?.id ?? null;

  const wrap = "mx-auto max-w-6xl px-6 py-6 md:px-8";
  if (!cfg) return <div className={wrap}><Spinner /></div>;
  if (tickets === null && error)
    return <div className={wrap}><ErrorState message={error} onRetry={load} /></div>;
  if (tickets === null) return <div className={wrap}><Spinner /></div>;

  const person = personOf(ticket);
  const state = ticket ? stateOf(ticket.status) : null;
  const Channel = ticket ? channelOf(ticket).icon : Inbox;
  const requestId = ticket ? approvalFor(ticket) : null;
  const comments: TicketComment[] = detail?.comments ?? [];
  // The link is stale when the list has no such conversation AND the agent has
  // no such ticket: a plain notice and the list underneath, like every other
  // screen.
  const stale = Boolean(openId && detailError && !ticket);
  // A STALE LINK OPENS NOTHING. With the notice up top and an empty thread
  // panel next to it, the screen said both things at once: «that conversation
  // is not here any more» and a header with a close button over nothing.
  const showThread = Boolean(openId && !stale);

  return (
    <div className={wrap}>
      <PageHeader
        title="Bandeja"
        subtitle="Los mensajes que le entraron a tu agente."
        actions={
          <IconBtn label="Actualizar" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </IconBtn>
        }
      />
      {stale && (
        <StaleLinkNotice>
          Esa conversación ya no está acá — puede que se haya archivado o que el link
          sea viejo. Abajo está todo lo que hay hoy.
        </StaleLinkNotice>
      )}
      {conversations.length === 0 && !openId ? (
        <>
          <EmptyState
            icon={Inbox}
            title="Todavía no entró ningún mensaje"
            hint={missing.length > 0
              ? `Cuando alguien escriba o comente, tu agente lo deja acá con la respuesta lista para que la mires. Para eso falta conectar ${enumerateEs(missing)}: nos lo pedís y lo conectamos nosotros.`
              : "Cuando alguien escriba al mail de la empresa o comente un posteo, tu agente lo deja acá con la respuesta lista para que la mires."}
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
        </>
      ) : (
        <div className="grid gap-4 md:grid-cols-[minmax(0,19rem)_minmax(0,1fr)] md:items-start">
          {/* On a phone the two panes are one screen at a time: the list, or
              the conversation with a way back to it. */}
          <div className={`flex flex-col gap-1.5 ${showThread ? "max-md:hidden" : ""}`}>
            {conversations.map((t) => (
              <Conversation
                key={t.id}
                t={t}
                open={t.id === openId}
                onClick={() => openThread(t.id)}
              />
            ))}
          </div>

          <div className={showThread ? "" : "max-md:hidden"}>
            {!showThread ? (
              <div className="rounded-xl border border-black/[0.07] bg-white px-4 py-16 text-center">
                <p className="text-sm text-ink-soft">Elegí una conversación para leerla.</p>
              </div>
            ) : (
              <EntityProvider cfg={cfg}>
                <section className="rounded-xl border border-black/[0.07] bg-white">
                  <header className="flex items-start gap-2 border-b border-black/[0.07] px-4 py-3">
                    <button
                      onClick={closeThread}
                      aria-label="Volver a la lista"
                      className="mt-0.5 text-ink-soft transition hover:text-ink md:hidden"
                    >
                      <ArrowLeft className="h-4 w-4" />
                    </button>
                    <Channel className="mt-1 h-4 w-4 shrink-0 text-ink-soft" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="truncate text-sm font-bold text-ink">
                          {person.name || ticket?.title}
                        </h2>
                        {/* The address or the handle, when it is not already
                            the name: it is how the client knows WHICH Laura
                            this is, and the body no longer carries it. */}
                        {person.handle && person.handle !== person.name && (
                          <span className="truncate text-[12px] text-ink-soft">{person.handle}</span>
                        )}
                        {state && <Chip tone={state.tone}>{state.label}</Chip>}
                      </div>
                      {ticket && <p className="mt-0.5 truncate text-[13px] text-ink-soft">{ticket.title}</p>}
                    </div>
                    <CopyLink label="Copiar el link de esta conversación" />
                    <IconBtn label="Cerrar" onClick={closeThread}>
                      <X className="h-4 w-4" />
                    </IconBtn>
                  </header>

                  <div className="px-4 py-4">
                    {ticket?.status === "blocked" && requestId && (
                      <Link
                        href={`/app/approvals?${PARAM.request}=${encodeURIComponent(requestId)}`}
                        className="mb-4 flex items-center gap-2 rounded-lg border border-c-amber bg-c-amber/25 px-3 py-2 text-[13px] font-medium text-c-amber-ink transition hover:bg-c-amber/40"
                      >
                        <Hand className="h-3.5 w-3.5 shrink-0" />
                        La respuesta está escrita y espera tu ok. Ver en Aprobaciones
                      </Link>
                    )}
                    {ticket?.status === "blocked" && !requestId && (
                      <p className="mb-4 flex items-center gap-2 rounded-lg border border-c-amber bg-c-amber/25 px-3 py-2 text-[13px] font-medium text-c-amber-ink">
                        <Hand className="h-3.5 w-3.5 shrink-0" />
                        Tu agente te dejó esta conversación a vos: su nota está abajo.
                      </p>
                    )}

                    {!detail && !detailError && !ticket ? (
                      <Spinner />
                    ) : (
                      <ul className="flex flex-col gap-3">
                        {/* THE BODY IS THE FIRST MESSAGE: it is the mail, or
                            the comment, that opened the conversation — and it
                            is drawn with <Markdown> inside the provider, which
                            is what turns the `correo/<id>/factura.pdf` lines
                            the mail plugin writes under «Adjuntos» into chips
                            that open the file. */}
                        {ticket?.body?.trim() && (
                          <Message
                            ours={false}
                            who={person.name || "Quien escribió"}
                            author=""
                            body={messageOf(ticket)}
                            at={ticket.created_at}
                            look={agentLook}
                          />
                        )}
                        {comments.map((c, i) => {
                          const ours = isOurSide(c.author, person);
                          return (
                            <Message
                              key={`${c.created_at}-${i}`}
                              ours={ours}
                              who={ours ? labelFor(c.author) : person.name || labelFor(c.author)}
                              author={c.author}
                              body={c.body}
                              at={c.created_at}
                              look={agentLook}
                            />
                          );
                        })}
                      </ul>
                    )}
                    {detailError && ticket && (
                      <p className="mt-3 text-sm text-ink-soft">
                        No pude traer el resto de la conversación.
                      </p>
                    )}

                    {ticket && (
                      <div className="mt-5 border-t border-black/[0.07] pt-4">
                        <AskAgent ticket={ticket} />
                      </div>
                    )}
                  </div>
                </section>
              </EntityProvider>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
