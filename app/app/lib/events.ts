"use client";

// HOW THE AGENT'S TIMELINE IS READ, IN ONE SINGLE PLACE.
//
// Three screens look at the same data -- Home's "Qué estuvo haciendo",
// Activity as a whole, Chat's list of conversations -- and each one had
// written its own criterion. The result, measured on 8/13:
//
//   - the cron's slug: Activity said "Avisos de ayuno para cirugías" and
//     Home, about the SAME event, "flujo-avisos-ayuno-cirugias".
//   - conversations: Activity listed 5 (one of them the portal's own internal
//     notice, linked to a conversation the Chat hides) and Chat showed 4. The
//     link landed on "Nueva conversación", empty.
//
// The criterion lives here; the screens choose how to draw it.

/** One line of the agent's history. `href` is added by the portal: the
 *  adapter only sends `ts/kind/label/status` and nothing else. */
export type AgentEvent = {
  ts: string;
  kind: string;
  label: string;
  status: string;
  /** Where the row leads (a file, a conversation). Tasks go by their id. */
  href?: string;
};

/* ── What kind of thing happened ──────────────────────────────────────────── */

// The kinds the engine writes (`db.append_event` across `engine/core/` and
// `kit/plugins/*/core/`), plus the two the portal builds itself in Activity
// (`archivo`, `conversacion`). SEVERAL KINDS, ONE WORD: a flow writes five
// kinds and the owner sees one thing, «Flujo» -- the filter chips are one per
// WORD, not one per kind, or «Flujo» shows up three times in a row.
const KIND_LABEL: Record<string, string> = {
  respuesta: "Respuesta",
  // The promises check completing an answer: still the answer.
  correction: "Respuesta",
  error: "Error",
  "flow.started": "Flujo",
  "flow.finished": "Flujo",
  "flow.failed": "Flujo",
  "flow.paused": "Flujo",
  "flow.incomplete": "Flujo",
  "delegation.started": "Encargo",
  "delegation.finished": "Encargo",
  "post.saved": "Posteo",
  "post.updated": "Posteo",
  "post.slide_replaced": "Posteo",
  "post.published": "Posteo",
  approval_requested: "Aprobación",
  approval_reproposed: "Aprobación",
  approval_approved: "Aprobación",
  approval_rejected: "Aprobación",
  "ticket.created": "Tarea",
  "ticket.moved": "Tarea",
  "ticket.commented": "Tarea",
  "message.sent": "Mensaje",
  "comment.replied": "Comentario",
  "comment.hidden": "Comentario",
  "mail.sent": "Mail",
  memoria: "Memoria",
  notify: "Aviso",
  "business.researched": "Negocio",
  archivo: "Archivo",
  conversacion: "Conversación",
};

/** The word for a kind. An unknown one is «Otro», never the raw id: a kind
 *  the engine starts writing tomorrow can't reach the owner as `foo.bar`. */
export const kindLabel = (kind: string): string =>
  KIND_LABEL[(kind || "").trim().toLowerCase()] ?? "Otro";

// WHAT IS THE ENGINE'S BOOKKEEPING AND NOT THE OWNER'S NEWS. `turn_usage`
// («Consumo del turno: 99049 tokens de entrada…») is one line per answer, in
// tokens, which no owner reads -- what it cost lives in Uso, in money.
// `compaction` is the engine folding a long conversation to fit.
const NOT_FOR_THE_FEED = new Set(["turn_usage", "compaction"]);

/** Does this event belong in the owner's feed (Home, Activity)? */
export const isForTheFeed = (e: { kind: string }) =>
  !NOT_FOR_THE_FEED.has((e.kind || "").trim().toLowerCase());

/* ── The label, as one line of plain text ─────────────────────────────────── */

/** A post's id (`2026-09-23-pan-masa-madre`) inside a sentence. Same shape as
 *  `entities.tsx`'s `POST_RE`, unanchored. */
const POST_ID_IN_TEXT = /\b\d{4}-\d{2}-\d{2}-((?=[a-z0-9-]*[a-z])[a-z0-9][a-z0-9-]{0,39})\b/gi;

/** A post's name as the owner reads it: its slug, in words
 *  (`pan-masa-madre` → «Pan masa madre»). A post carries no title of its own;
 *  the slug is the name the agent gave it. */
export function postTitle(slugOrId: string): string {
  const slug = slugOrId.replace(/^\d{4}-\d{2}-\d{2}-/, "");
  const words = slug.replace(/-+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The engine writes a label per log line and the model's words travel in it:
 *  the first line of an answer arrives with its markdown («Está en
 *  **Posteos**», cut in half at 120 characters) and a post's id as a slug. A
 *  row in a list is one line of plain text, so the marks go and the id reads
 *  as the post's name. */
export function plainLabel(label: string): string {
  return (label || "")
    .replace(/\*\*|__/g, "")
    .replace(/`/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#+\s+/, "")
    .replace(POST_ID_IN_TEXT, (_, slug: string) => postTitle(slug));
}

/* ── What counts as a conversation ────────────────────────────────────────── */

/** The little bit needed to know about a session to decide whether it's
 *  someone's. The gateway's listing carries a lot more. */
export type SessionToFilter = {
  source?: string | null;
  title?: string | null;
  preview?: string | null;
};

// A CONVERSATION IS SOMEONE TALKING. The engine also opens a "session" to run
// a cron and for the agent to work a ticket on its own; those aren't anyone's
// conversation and already have their own row (the flow's run, the board's
// event). Listing them put "Hablaron por Tareas programadas: '[IMPORTANT: You
// are running as a scheduled cron job…'" on a vet clinic's screen: the
// internal prompt, in English, presented as one of her own chats.
const HUMAN_CHANNELS = new Set([
  "api_server", "portal", "api", "telegram", "whatsapp", "discord", "signal",
]);

// AND THE CHANNEL ISN'T ENOUGH. The notices the portal injects into the agent
// ("client commented on ticket t_…") travel over the same channel as the
// chat, in a system session. Chat already hid it; Activity listed it as one
// more conversation, linked it -- and the link landed on an empty screen --
// and counted 5 where Chat counted 4.
const MACHINE_STARTS = ["### Task", "[Aviso del portal]"];

/** Is this session a conversation the client recognizes as their own? */
export function isHumanConversation(s: SessionToFilter): boolean {
  if (!HUMAN_CHANNELS.has((s.source ?? "").trim().toLowerCase())) return false;
  const t = (s.title ?? s.preview ?? "").trimStart();
  return !MACHINE_STARTS.some((a) => t.startsWith(a));
}
