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

import { readFailure } from "./labels";
import type { CronJob, Flow } from "./agent";

/** One line of the agent's history. `href` and `reason` are added by the
 *  portal: the adapter only sends `ts/kind/label/status` and nothing else. */
export type AgentEvent = {
  ts: string;
  kind: string;
  label: string;
  status: string;
  /** Where the row leads (a flow, a file). Tickets go by their id. */
  href?: string;
  /** Why it couldn't, in plain terms. Only on runs that failed. */
  reason?: string;
};

const msOf = (ts: string | null | undefined): number => {
  const t = new Date(ts ?? "").getTime();
  return Number.isNaN(t) ? 0 : t;
};

/** Flow runs, with the name the client gave them.
 *
 *  "flujo-vacunas-vencidas-semanal · No pudo" was the line that revealed the
 *  failure to the vet clinic, and also the only one she couldn't open to see
 *  why. Now it says the flow's name, states the reason in plain terms, and
 *  leads to the screen where it can be paused or retried.
 *
 *  `jobs` is optional: without the list of scheduled tasks there's no way to
 *  know why it failed, but the name and the link still come out. */
export function humanizeRuns(
  evs: AgentEvent[], flows: Flow[] | null, jobs?: CronJob[] | null,
): AgentEvent[] {
  if (!flows?.length) return evs;
  const byJobName = new Map<string, Flow>();
  // `flujo-` is a compatibility key: it is the prefix already written on the
  // cron jobs of deployed agents, so it is NOT translated.
  for (const f of flows) byJobName.set(`flujo-${f.slug}`, f);
  return evs.map((ev) => {
    if (ev.kind !== "job_run") return ev;
    const f = byJobName.get((ev.label || "").trim());
    if (!f) return ev;
    const job = jobs?.find((j) => (j.name || "").trim() === `flujo-${f.slug}`);
    // The engine's error is from the LATEST run: it can only be attributed to
    // this row if this row IS the latest one. Pinning it on an old one would
    // be making it up.
    const isTheLatest = Boolean(
      job?.last_run_at && ev.ts && Math.abs(msOf(job.last_run_at) - msOf(ev.ts)) < 120_000);
    const failed = /(fail|error|timeout|cancel)/i.test(ev.status || "");
    return {
      ...ev,
      label: f.name,
      href: `/app/flows/${encodeURIComponent(f.slug)}`,
      reason: failed && isTheLatest ? readFailure(job?.last_error).what : undefined,
    };
  });
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
