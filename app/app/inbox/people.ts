// The Bandeja's list is ONE ROW PER PERSON, not one per ticket (Luis,
// 2026-09-24). On Instagram the board opens a ticket per COMMENT — each answer
// has to go out under its own comment, so that stays — plus one per DM thread,
// and a person who commented twice and wrote once was three rows that were
// the same conversation to the owner. The tickets do not change; this is how
// the screen reads them.
//
// WHO A PERSON IS, per channel:
//
//   instagram, instagram-dm   `ig:<handle>` — comments and DMs are one person.
//                             The handle is the plugin's field
//                             (`ig_tools.comment_extra` / `dm_extra`); a
//                             ticket without it falls back to the @ in its
//                             title, which is how the skill has always
//                             written them.
//   whatsapp                  `wa:<jid>` — already one ticket per chat.
//   mail                      `t:<ticket id>` — ONE ROW PER TICKET, as before.
//                             A mail ticket carries no structured sender (the
//                             address is inside the body's `**De:**` prose),
//                             and a mail thread is already its own subject.
//
// No runtime import on purpose: with its types stripped this file runs under
// plain `node`, which is how the grouping was checked without a browser or an
// agent.

import type { ChannelTicket, State, StateKey } from "./conversation";

/** One row: a person and every ticket they have on the Bandeja. */
export type PersonGroup = {
  key: string;
  /** Oldest first — the order the merged timeline reads them in. */
  tickets: ChannelTicket[];
  /** The ticket something last happened on: its line and its time are the row's. */
  latest: ChannelTicket;
  /** When something last happened on any of them, in ms. */
  at: number;
};

const HANDLE = /@([a-z0-9._]{2,30})/i;

/** The Instagram @ of whoever wrote, without the @ and in lower case. */
export function instagramHandle(t: ChannelTicket): string | null {
  const h = t.handle || HANDLE.exec(t.title ?? "")?.[1] || null;
  return h ? h.replace(/^@/, "").toLowerCase() : null;
}

export function personKey(t: ChannelTicket): string {
  const source = (t.source ?? "").trim().toLowerCase();
  if (source === "instagram" || source === "instagram-dm") {
    const h = instagramHandle(t);
    if (h) return `ig:${h}`;
  }
  if (source === "whatsapp" && t.source_ref) return `wa:${t.source_ref}`;
  return `t:${t.id}`;
}

/** The rows, the one something last happened on first. `msOf` is when a ticket
 *  last moved, in ms — the page's own, passed in so this stays pure. */
export function groupByPerson(
  tickets: ChannelTicket[], msOf: (t: ChannelTicket) => number,
): PersonGroup[] {
  const byKey = new Map<string, ChannelTicket[]>();
  for (const t of tickets) {
    const key = personKey(t);
    byKey.set(key, [...(byKey.get(key) ?? []), t]);
  }
  const created = (t: ChannelTicket) => Number(t.created_at) || 0;
  return Array.from(byKey.entries())
    .map(([key, list]): PersonGroup => {
      const latest = list.reduce((a, b) => (msOf(b) > msOf(a) ? b : a));
      return {
        key,
        tickets: [...list].sort((a, b) => created(a) - created(b)),
        latest,
        at: msOf(latest),
      };
    })
    .sort((a, b) => b.at - a.at);
}

/** Which state the row shows when a person has several tickets: the one that
 *  needs HER most. What the agent left for her, then what waits for her ok,
 *  then the chat she is answering herself, then something new, and last what
 *  is already answered. */
export const URGENCY: StateKey[] = [
  "left", "waiting_ok", "taken_over", "new", "working", "done", "archived",
];

export function mostUrgent(states: State[]): State {
  return states.reduce((a, b) => (URGENCY.indexOf(b.key) < URGENCY.indexOf(a.key) ? b : a));
}
