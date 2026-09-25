"use client";

// HOW THE PORTAL LEARNS THAT SOMETHING CHANGED, IN ONE SINGLE PLACE.
//
// «Nada actualiza las aprobaciones, tengo que hacer refresh» (Luis,
// 2026-09-24). Every tab read its data on mount and then every 30 or 60
// seconds, each on its own timer: an approval the agent asked for sat
// invisible for up to a minute, the sidebar's count for another, and Chat's
// list and Archivos never moved at all.
//
// NOW ONE POLLER, IN THE LAYOUT. It asks the agent `GET /portal/changes?since=`
// (`engine/server/portal.py`): the log's cursor, the event kinds written after
// it, and a stamp of the conversation list. Every few seconds while the tab is
// visible, every half minute while it is hidden (the cursor keeps what
// happened meanwhile, so one ask catches all of it), and right away on focus,
// on coming back online, and when this tab itself just did something
// (`pollNow`). What changed is published as TOPICS, and each tab refetches only
// when one it draws is among them (`useChanges`).
//
// WHY POLLING AND NOT SSE: the engine does have SSE, for a chat turn. A stream
// open for hours is what a proxy cuts, a laptop lid kills without telling
// anybody, and a phone suspends -- and each of those needs a reconnect path
// that is this same "what did I miss since X" question anyway. A tiny GET
// every 4 s is two SQLite reads on the agent.

import { useEffect, useRef } from "react";
import { getChanges, type PortalConfig } from "./agent";

/** What a tab can listen for. Several kinds, one topic: a tab thinks in
 *  "the approvals moved", not in `approval_reproposed`. */
export type Topic =
  | "approvals" | "tickets" | "posts" | "flows" | "chat" | "usage" | "activity" | "files"
  | "whatsapp" | "business";

/** The topics one event kind moves. Most kinds are something the agent did
 *  for the owner: Activity and Inicio list it and it may have left a file
 *  behind, so `activity` + `files` is the default and each family adds its own
 *  tab. The engine's bookkeeping is the exception: `turn_usage` / `spend` are
 *  Uso's numbers and nothing else, and a `correction` or `compaction`
 *  rewrites a conversation. */
function topicsOf(kind: string): Topic[] {
  if (kind === "turn_usage" || kind === "spend") return ["usage"];
  if (kind === "compaction" || kind === "correction") return ["chat"];
  const base: Topic[] = ["activity", "files"];
  // A decision moves the ticket it unblocks, too.
  if (kind.startsWith("approval_")) return [...base, "approvals", "tickets"];
  if (kind.startsWith("ticket.")) return [...base, "tickets"];
  if (kind.startsWith("post.")) return [...base, "posts"];
  if (kind.startsWith("flow.")) return [...base, "flows"];
  // The business context moved: a research run started or finished, a
  // section was confirmed or edited, a file or the notes changed. Marca
  // redraws; the agent may have written to it from a chat turn too.
  if (kind.startsWith("business.")) return [...base, "business"];
  // The link to the owner's WhatsApp came up or dropped, a message came in or
  // went out, the owner took a chat over from her phone: the Bandeja's panel
  // and its list, both. A message is a ticket moving even when the plugin
  // writes only its own kind.
  if (kind.startsWith("whatsapp.")) return [...base, "whatsapp", "tickets"];
  // The end of any chat turn: the conversation moved, and the agent may have
  // created or paused a flow with its tools, which writes no event of its own.
  if (kind === "respuesta" || kind === "error") return [...base, "chat", "flows"];
  return base;
}

type Listener = (topics: ReadonlySet<Topic>) => void;
const listeners = new Set<Listener>();

function publish(topics: Set<Topic>) {
  if (topics.size) listeners.forEach((l) => l(topics));
}

/** Refetch when one of `topics` changed on the agent. `onChange` may change
 *  identity on every render: the latest one is called, and the subscription
 *  is made once. */
export function useChanges(topics: readonly Topic[], onChange: () => void) {
  const latest = useRef(onChange);
  latest.current = onChange;
  const key = topics.join(",");
  useEffect(() => {
    const wanted = new Set(key.split(",") as Topic[]);
    const listener: Listener = (changed) => {
      for (const t of Array.from(changed)) if (wanted.has(t)) { latest.current(); return; }
    };
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, [key]);
}

const VISIBLE_MS = 4_000;
// HIDDEN IS NOT "NOBODY LOOKS". Chrome marks a window `hidden` when another
// one covers it, focused or not (measured: `visibilityState: "hidden"` with
// `hasFocus(): true`), and a portal left on a second screen behind the mail
// is still read at a glance. So a hidden tab slows down instead of stopping;
// the cursor catches up on whatever happened between two asks either way.
const HIDDEN_MS = 30_000;
// A failed ask waits longer each time, up to this: an agent that is down is
// not asked every 4 s by every tab left open on it.
const MAX_BACKOFF_MS = 60_000;

let poke: (() => void) | null = null;

/** Ask now instead of at the next tick: this tab just did something (approved,
 *  rejected) and its effects should show without waiting. */
export function pollNow() {
  poke?.();
}

/** Starts the one poller; returns its stop. The layout runs it once per
 *  agent (`cfg`). */
export function startChangeFeed(cfg: PortalConfig): () => void {
  let cursor: number | null = null;
  let sessions: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight = false;
  let again = false;
  let failures = 0;
  let stopped = false;

  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (stopped) return;
    const every = document.visibilityState === "visible" ? VISIBLE_MS : HIDDEN_MS;
    const wait = failures ? Math.min(every * 2 ** failures, MAX_BACKOFF_MS) : every;
    timer = setTimeout(tick, wait);
  };

  const tick = async () => {
    if (stopped) return;
    // One ask at a time; a poke during one asks again right after it.
    if (inFlight) { again = true; return; }
    inFlight = true;
    try {
      const r = await getChanges(cfg, cursor);
      const topics = new Set<Topic>();
      for (const kind of r.kinds) topicsOf(kind).forEach((t) => topics.add(t));
      if (sessions !== null && r.sessions !== sessions) topics.add("chat");
      cursor = r.last;
      sessions = r.sessions;
      failures = 0;
      publish(topics);
    } catch {
      failures++;
    } finally {
      inFlight = false;
    }
    if (again) { again = false; tick(); return; }
    schedule();
  };

  const wake = () => {
    if (document.visibilityState === "visible") tick();
    else schedule();
  };
  poke = tick;
  document.addEventListener("visibilitychange", wake);
  window.addEventListener("focus", wake);
  window.addEventListener("online", wake);
  tick();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    if (poke === tick) poke = null;
    document.removeEventListener("visibilitychange", wake);
    window.removeEventListener("focus", wake);
    window.removeEventListener("online", wake);
  };
}
