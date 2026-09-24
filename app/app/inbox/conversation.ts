"use client";

// What the Inbox has to know about a channel ticket that the ticket does not
// say in a field: who is on the other side, which side of the thread a comment
// is on, and what to call the state the client reads.
//
// WHY THE PERSON IS READ OUT OF THE TEXT AND NOT OUT OF A COLUMN. There is no
// column: a ticket carries `source` (`mail`, `instagram`, `instagram-dm`) and
// `source_ref` (the message id, the comment id, the conversation id), and
// neither one is a person. What the plugins DO write is a convention:
//
//   mail        the body opens with `**De:** Nombre <alguien@empresa.com>`,
//               written by code (`kit/plugins/mail/core/mail_imap.py`)
//   instagram   the title carries the handle, `Comentario de @usuario en …`,
//               written by the MODEL following its skill
//
// Which is exactly why this lives in the portal and not in `board_routes`: a
// `source_label` computed over there would make the board parse the mail
// plugin's prose — and the Instagram half of it is not the code's to begin
// with, so the engine would be guessing with the same odds and doing it in the
// one place every screen has to trust. Here a miss costs a row that shows the
// ticket's title instead of a name, which is the truth about what we know.
//
// WHATSAPP IS THE EXCEPTION THAT HAS A COLUMN: the engine keeps each chat
// (`GET /portal/whatsapp/chats/{jid}`, the jid being the ticket's
// `source_ref`) with the contact's name and number, so there the person comes
// from that record and not from prose.

import { isTheAgent, isTheClient, type Ticket, type WhatsAppChat } from "../lib/agent";
import { momentOf, type Tone } from "../lib/labels";

/** Who wrote in. `handle` is how their own messages are signed on the thread —
 *  the address, the `@usuario` — or null when the convention did not hold. */
export type Person = { name: string; handle: string | null };

/** The channels the Bandeja filters by. An Instagram comment and an Instagram
 *  DM are one channel to the owner: «lo que me escriben por Instagram». */
export type Channel = "whatsapp" | "instagram" | "mail";
export const CHANNELS: { key: Channel; label: string }[] = [
  { key: "whatsapp", label: "WhatsApp" },
  { key: "instagram", label: "Instagram" },
  { key: "mail", label: "Mail" },
];

export function channelKey(t: Ticket | null | undefined): Channel | null {
  const s = (t?.source ?? "").trim().toLowerCase();
  if (s === "whatsapp") return "whatsapp";
  if (s === "instagram" || s === "instagram-dm") return "instagram";
  if (s === "mail") return "mail";
  return null;
}

/** The chat a WhatsApp ticket is about, or null for any other channel. */
export const whatsAppJid = (t: Ticket | null | undefined): string | null =>
  channelKey(t) === "whatsapp" ? t?.source_ref ?? null : null;

/** `+598 99 123 456` → shown as the engine sends it; a bare jid user part
 *  (`59899123456`) gets its plus. */
export const phoneLabel = (phone: string | null | undefined): string =>
  !phone ? "" : phone.startsWith("+") ? phone : `+${phone}`;

/** The person on a WhatsApp chat: the name their contact card has, and their
 *  number next to it. Until the chat's record arrives, what the ticket says. */
export function whatsAppPerson(t: Ticket | null, chat: WhatsAppChat | null): Person {
  const phone = phoneLabel(chat?.phone);
  return { name: chat?.name?.trim() || phone || (t?.title ?? "").trim(), handle: null };
}

/** Until when the owner is answering this chat herself, if that is now. */
export function takenOverUntil(chat: WhatsAppChat | null | undefined): number | null {
  const ms = momentOf(chat?.taken_over_until)?.ms ?? null;
  return ms !== null && ms > Date.now() ? ms : null;
}

/** «LM» for «Laura Méndez», «TC» for «@tu.cliente», «59» for a bare number. */
export function initialsOf(name: string): string {
  const words = name.replace(/[@+<>"]/g, " ").split(/[\s._-]+/).filter(Boolean);
  const letters = words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}

// `**De:** Nombre <alguien@empresa.com>`, the first line of a mail ticket.
const FROM_LINE = /^\s*\*\*De:\*\*\s*(.+)$/m;
const ANGLED = /<([^<>@\s]+@[^<>\s]+)>/;
const BARE_ADDRESS = /([^\s<>@]+@[^\s<>]+\.[a-z]{2,})/i;
// An Instagram handle, as the skill writes it into the title.
const HANDLE = /@([a-z0-9._]{2,30})/i;

export function personOf(t: Ticket | null | undefined): Person {
  if (!t) return { name: "", handle: null };
  const body = t.body ?? "";
  const from = FROM_LINE.exec(body)?.[1]?.trim();
  if (from) {
    const address = ANGLED.exec(from)?.[1] ?? BARE_ADDRESS.exec(from)?.[1] ?? null;
    // The display name if the sender has one, the address if that is all they
    // sent. Never both: the row is narrow and the name is what identifies them.
    const name = from.replace(ANGLED, "").replace(/["']/g, "").trim();
    return { name: name || address || from, handle: address };
  }
  const handle = HANDLE.exec(`${t.title ?? ""} ${body}`)?.[0];
  if (handle) return { name: handle, handle };
  return { name: (t.title ?? "").trim(), handle: null };
}

/** Is this comment ours (the agent, the client, the mailbox the answer went
 *  out as), or theirs?
 *
 *  With a handle it is exact: their messages are signed with it and everything
 *  else is our side — including `info@…`, which is an address like theirs and
 *  is the one thing a "looks like an address" rule would get backwards. With
 *  no handle it falls back to what the portal already knows how to recognise. */
export function isOurSide(author: string | null | undefined, person: Person): boolean {
  const a = (author ?? "").trim().toLowerCase();
  if (person.handle) return a !== person.handle.trim().toLowerCase();
  return isTheClient(a) || isTheAgent(a);
}

/** The words a conversation is read in. They are the board's five statuses
 *  said the way this screen says them: on the Board a ticket is work («Por
 *  hacer», «Completado»), here it is an answer somebody is waiting for. An
 *  unknown status lands in «En curso», the same rule `columnForTask` uses.
 *
 *  `blocked` IS TWO THINGS, and which one is not in the status. A mail's
 *  answer waits for the owner's ok in Aprobaciones; an Instagram or WhatsApp
 *  answer goes out on its own, so a blocked thread there is one the agent LEFT
 *  for her, with its note. The page knows which by whether a pending request
 *  names the ticket (`waitingOk`). */
const STATE: Record<string, { label: string; tone: Tone }> = {
  ready: { label: "Nuevo", tone: "violet" },
  in_progress: { label: "En curso", tone: "neutral" },
  blocked: { label: "Te la dejó a vos", tone: "amber" },
  done: { label: "Respondido", tone: "green" },
  archived: { label: "Archivada", tone: "neutral" },
};
const WAITING_OK = { label: "Esperando tu ok", tone: "amber" as Tone };
/** The owner is answering this WhatsApp chat from her phone: whatever the
 *  ticket's status, what the row has to say is that the agent stepped back. */
const TAKEN_OVER = { label: "La estás atendiendo vos", tone: "neutral" as Tone };

export function stateOf(
  status: string | null | undefined,
  { waitingOk = false, takenOver = false }: { waitingOk?: boolean; takenOver?: boolean } = {},
): { label: string; tone: Tone } {
  if (takenOver) return TAKEN_OVER;
  const s = (status || "").trim().toLowerCase();
  if (s === "blocked" && waitingOk) return WAITING_OK;
  return STATE[s] ?? STATE.in_progress;
}

// The lines the mail plugin writes above the message itself. They are the
// row's job, not the preview's: the row already shows who wrote and when.
const HEADERS = /^\s*\*\*(De|Fecha|Asunto|Para):\*\*.*$/gm;
// What markdown leaves in a line that is meant to be read at a glance.
const MARKS = /[*_`>#]/g;

/** The message itself: the body without the lines that say who wrote it and
 *  when. Both are already on the bubble — the person's name over it and the
 *  date next to it — and a message that opens by repeating its own envelope
 *  reads like a forwarded mail, not like something somebody said to you. */
export const messageOf = (t: Ticket | null | undefined): string =>
  (t?.body ?? "").replace(HEADERS, "").trim();

/** The first thing the message says, on one line. */
export function previewOf(t: Ticket | null | undefined, limit = 120): string {
  const text = messageOf(t).replace(MARKS, "").trim();
  const first = text.split(/\n+/).map((l) => l.trim()).find(Boolean) ?? "";
  return first.length > limit ? `${first.slice(0, limit).trimEnd()}…` : first;
}
