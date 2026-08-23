"use client";

// Portal routes -- the URL is the client's memory.
//
// WHY THIS WAY AND NOT PATH SEGMENTS: the portal is static. In the build,
// EVERY tab comes out as `○ (Static)` except `/app/flows/[slug]`, the only
// `ƒ (Dynamic, server-rendered on demand)`. A segment per detail (a ticket, a
// file, a conversation) would multiply that exception and tie the portal to
// needing a server. With search params the detail lives on a page that's
// already prerendered: the same HTML serves `/app/pipeline` and
// `/app/pipeline?task=t_ab12`, and a shared link works the same served by
// Vercel or by a plain directory of files.
//
// THE HASH IS NEVER TOUCHED. That's where the magic link's credential arrives
// (`/app#endpoint=…&adapter=…&key=…`): no URL we build here copies it, and
// `shareableLink()` explicitly strips it. That's also why we don't use
// hash-routing: it would collide with the one thing in the portal that can
// never break.
//
// MECHANICS: native `history.pushState` / `replaceState`. Next 14.2 patches
// them (app-router.js: copyNextJsInternalHistoryState) to copy its own
// internal state and keep the router in sync, so pushing from here doesn't
// desync it. Every screen's state is READ from the URL -- there's no local
// copy -- which is why refreshing restores the exact same view.

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { Check, Link2 } from "lucide-react";

/** The params that open a detail. They all live here because they're the
 *  contract the agent can quote: see `docs/portal-routes.md`. */
export const PARAM = {
  /** /app/chat?conversation=<session id> */
  conversation: "conversation",
  /** /app/pipeline?task=<ticket id> */
  task: "task",
  /** /app/approvals?request=<blocked ticket id> */
  request: "request",
  /** /app/artifacts?artifact=<artifact id> */
  artifact: "artifact",
  /** /app/files?folder=<path> */
  folder: "folder",
  /** /app/files?file=<path> */
  file: "file",
  /** /app/skills?skill=<name> */
  skill: "skill",
  /** /app/connections?connection=<catalog id> */
  connection: "connection",
  /** /app/tasks?scheduled=<cron id> */
  scheduled: "scheduled",
  /** /app/team?role=<role id> */
  role: "role",
  /** /app/team?hire=<role id> -- naming the one being added.
   *  It's ANOTHER param and not a mode of `?role=`: they're two different
   *  things about the same id -- looking at someone's profile, and naming
   *  someone who isn't there yet -- and folding them into a single param
   *  would force a second value next to it just to tell the two apart. */
  hire: "hire",
} as const;

/** `?p=` (the request the chat starts with) also counts as arriving with an
 *  intention: it's not a detail, but it hides the welcome screen just the same. */
export const PARAM_CHAT_REQUEST = "p";

const DETAILS: string[] = [...Object.values(PARAM), PARAM_CHAT_REQUEST];

/** Does this URL point at something concrete (and not a tab's home screen)?
 *  Used by the shell to NOT get in the way with the module's welcome screen:
 *  whoever arrives through a shared link is here to see one thing, not to be
 *  introduced to the tab. */
/** Routes by PATH that are also a detail. Today only flows: a link to
 *  `/app/flows/weekly-report` is just as much "I'm here to see this" as a
 *  `?task=`, and if it doesn't count, the shell puts the Flows welcome screen
 *  in front of it. */
const DETAIL_PATHS = [/^\/app\/flows\/[^/]+$/];

export function urlPointsToDetail(search?: string, pathname?: string): boolean {
  if (typeof window !== "undefined" || pathname !== undefined) {
    const p = pathname ?? window.location.pathname;
    if (DETAIL_PATHS.some((re) => re.test(p))) return true;
  }
  const s = search ?? (typeof window === "undefined" ? "" : window.location.search);
  if (!s) return false;
  const q = new URLSearchParams(s);
  return DETAILS.some((k) => (q.get(k) ?? "").trim() !== "");
}

/* ── Reading ─────────────────────────────────────────────────────────────── */

/** Same as `urlPointsToDetail`, but reactive (the shell uses it to decide
 *  whether it's its turn to show the module's welcome screen). */
export function useUrlPointsToDetail(pathname?: string): boolean {
  const q = useSearch();
  if (pathname && DETAIL_PATHS.some((re) => re.test(pathname))) return true;
  return DETAILS.some((k) => (q.get(k) ?? "").trim() !== "");
}

const EVENT = "tuagente:ruta";

function subscribe(notify: () => void) {
  window.addEventListener("popstate", notify);
  window.addEventListener(EVENT, notify);
  return () => {
    window.removeEventListener("popstate", notify);
    window.removeEventListener(EVENT, notify);
  };
}

const read = () => window.location.search;
// There's no URL during prerender: the first paint is always the plain list
// with no detail, and React re-renders with the real value as soon as it
// hydrates. Without this there would be a hydration mismatch on a static page.
const readOnServer = () => "";

/** Tells the screens the URL changed. Needed when whoever changes it is
 *  neither the user (popstate) nor us (for example, a Next `<Link>` to the tab
 *  you're already on). */
export function notifyRouteChange() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT));
}

export function useSearch(): URLSearchParams {
  const search = useSyncExternalStore(subscribe, read, readOnServer);
  return useMemo(() => new URLSearchParams(search), [search]);
}

/** A URL param's value, or null. THIS is the source of truth for what's open:
 *  no parallel `useState`. */
export function useRouteParam(name: string): string | null {
  const q = useSearch();
  const v = q.get(name);
  return v && v.trim() !== "" ? v : null;
}

/* ── Writing ─────────────────────────────────────────────────────────────── */

type Changes = Record<string, string | null>;

// `encodeURIComponent` escapes slashes and leaves `entregables%2Finforme.md`.
// A slash in a param's value is legal, and it's the difference between a URL
// the client can read and one that looks like an error.
const enc = (s: string) => encodeURIComponent(s).replace(/%2F/gi, "/");

function build(search: string, changes: Changes): string {
  const q = new URLSearchParams(search);
  for (const [k, v] of Object.entries(changes)) {
    if (v == null || v === "") q.delete(k);
    else q.set(k, v);
  }
  const parts: string[] = [];
  q.forEach((v, k) => parts.push(`${enc(k)}=${enc(v)}`));
  return parts.length ? `?${parts.join("&")}` : "";
}

/** The URL that results from applying `changes`, WITHOUT the hash (that's
 *  where the credential lives). */
function target(changes: Changes): string {
  return window.location.pathname + build(window.location.search, changes);
}

const DETAIL_MARK = "tuagenteDetail";

const here = () => window.location.pathname + window.location.search;

/** Open something: a new history entry, so "back" closes it. */
export function openInRoute(changes: Changes) {
  if (typeof window === "undefined") return;
  const url = target(changes);
  if (url === here()) return;
  window.history.pushState({ [DETAIL_MARK]: true }, "", url);
  notifyRouteChange();
}

/** Close: if WE pushed the entry that opened it, undo it with "back" (and let
 *  "forward" reopen it). If the client LANDED here -- they pasted the shared
 *  link -- there's nothing to undo, and kicking them out with `back()` would
 *  throw them out of the portal: here the URL just gets rewritten. */
export function closeInRoute(...names: string[]) {
  if (typeof window === "undefined") return;
  const st = window.history.state as Record<string, unknown> | null;
  if (st && typeof st === "object" && st[DETAIL_MARK]) {
    window.history.back();
    return;
  }
  const changes: Changes = {};
  for (const n of names) changes[n] = null;
  window.history.replaceState(null, "", target(changes));
  notifyRouteChange();
}

/** Go back to the home screen of the tab you're already on: used when the
 *  client clicks, in the menu, the module they're currently looking at. */
export function backToTab() {
  const changes: Changes = {};
  for (const n of DETAILS) changes[n] = null;
  openInRoute(changes);
}

/** Change without dirtying the history (filters, current folder, cleanups). */
export function replaceInRoute(changes: Changes) {
  if (typeof window === "undefined") return;
  const url = target(changes);
  if (url === here()) return;
  window.history.replaceState(null, "", url);
  notifyRouteChange();
}

/* ── Bring into view whatever the link came to show ─────────────────────── */

/** Leaves in view the thing the link came to show.
 *
 *  TWO THINGS THAT LOOK LIKE DETAILS AND ARE THE WHOLE BUG:
 *
 *  1. `behavior: "smooth"` NEVER ARRIVES. Measured in the lab with
 *     `/app/skills?skill=approval`: the highlighted row ended up at 823px with
 *     an 813px window -- i.e. just below the fold -- and `scrollY` stayed at
 *     0. With `"instant"`, the same element and the same `scrollIntoView`
 *     move the page to 442. Smooth scroll swallows the animation when there's
 *     an `overflow-hidden` container above it (the card that groups the
 *     system's skills) and while the page is still settling. And landing on a
 *     link doesn't have to be an animation: the client came to see one thing,
 *     it has to be there.
 *  2. A FIXED 150ms `setTimeout` IS A BET. The element appears once the
 *     adapter answers, and against a client's agent over the internet that
 *     takes longer than against the lab; at 150ms it might not exist yet and
 *     the effect got silently lost. Here it waits until it exists, with a cap.
 *
 *  And it waits with `setTimeout`, NOT `requestAnimationFrame`: in a
 *  background tab the browser doesn't paint frames, so a poll on rAF never
 *  runs even once -- measured: `document.hidden` true and `scrollY` at 0
 *  forever. A client opening a link in a new tab is the normal case, not the
 *  rare one. Timers there still run at ~1 per second, which is enough for
 *  this.
 *
 *  Returns the cancel function (goes straight into the effect's `return`).
 *  `marker` is a marker class because `Card` and `li` don't take a ref. */
export function bringIntoView(marker: string, maxAttempts = 60): () => void {
  if (typeof window === "undefined") return () => {};
  let cancelled = false;
  let attempts = 0;
  const pending: number[] = [];
  // WHAT DOESN'T FIT ON SCREEN DOESN'T GET CENTERED: IT ALIGNS TO THE TOP.
  // Centering something taller than the window cuts off its head, and the
  // head is what needs reading -- the title, the status, the notice.
  // Measured with `/app/approvals?request=<id>`: the request's card measures
  // 1208px against an 806px window, and `block: "center"` left it starting at
  // **-201**, i.e. with "You told them no to this" above the fold. What DOES
  // fit still gets centered, which reads better than pinned to the edge.
  const doesNotFit = (r: DOMRect) => r.height > window.innerHeight * 0.9;
  const settle = (el: Element) =>
    el.scrollIntoView({
      block: doesNotFit(el.getBoundingClientRect()) ? "start" : "center",
      behavior: "instant",
    });
  const inView = (el: Element) => {
    const r = el.getBoundingClientRect();
    // For something too tall, seeing the start is enough: demanding the whole
    // thing fit would be asking for the impossible, and re-scrolling forever.
    if (doesNotFit(r)) return r.top >= 0 && r.top < window.innerHeight / 2;
    return r.top >= 0 && r.bottom <= window.innerHeight;
  };
  const step = () => {
    if (cancelled) return;
    const el = document.querySelector(marker);
    if (!el) {
      if (++attempts < maxAttempts) pending.push(window.setTimeout(step, 40));
      return;
    }
    settle(el);
    // A single confirmation pass: whatever's next to it can still keep
    // growing for a moment (markdown, tables) and shove what we just centered
    // out of place.
    pending.push(window.setTimeout(() => {
      if (cancelled) return;
      const other = document.querySelector(marker);
      if (other && !inView(other)) settle(other);
    }, 250));
  };
  step();
  return () => {
    cancelled = true;
    pending.forEach(clearTimeout);
  };
}

/* ── Canonical links ─────────────────────────────────────────────────────── */

/** The link for one concrete thing, exactly as it's shared and exactly as the
 *  agent quotes it. Absolute and without the hash. */
export function urlFor(path: string, changes: Changes = {}): string {
  const search = build("", changes);
  const base = typeof window === "undefined" ? "" : window.location.origin;
  return `${base}${path}${search}`;
}

/** The link for whatever the client is looking at right now. NEVER the hash:
 *  if the client just arrived through the magic link, that's where their key
 *  is. */
export function shareableLink(): string {
  return `${window.location.origin}${window.location.pathname}${window.location.search}`;
}

/** Strips the magic link's credential out of the address bar.
 *
 *  It arrives in the hash and stays there forever: a client who copies the
 *  URL to pass along to a teammate is also handing over their key. It's
 *  already saved in localStorage by the time this runs, so erasing it here
 *  doesn't take anything away. Uses `replaceState` so the entry with the key
 *  doesn't stay in the history. */
export function stripCredentialFromUrl() {
  if (typeof window === "undefined") return;
  const h = window.location.hash.replace(/^#/, "");
  if (!h) return;
  const rest = h.split("&").filter((p) => !/^(endpoint|adapter|key)=/i.test(p)).join("&");
  if (rest === h) return;
  window.history.replaceState(
    null, "", window.location.pathname + window.location.search + (rest ? `#${rest}` : ""));
}

/* ── Copying the link ────────────────────────────────────────────────────── */

/** A discreet button to grab a link. From the kit: no shadows, a lucide icon,
 *  the same size as the rest of the IconBtns. The URL is computed when it's
 *  clicked (there's no `window` during render).
 *
 *  `navigator.clipboard` doesn't exist outside a secure context (plain http):
 *  it falls back to the browser's prompt there, which is ugly but still lets
 *  you copy. A button that does nothing is worse. */
export function CopyUrl({ get, label }: { get: () => string; label: string }) {
  const [done, setDone] = useState(false);
  const copy = useCallback(() => {
    const url = get();
    const ok = () => { setDone(true); setTimeout(() => setDone(false), 1800); };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).then(ok).catch(() => window.prompt("Copiá el link:", url));
      return;
    }
    window.prompt("Copiá el link:", url);
  }, [get]);
  return (
    <button
      aria-label={done ? "Link copiado" : label}
      title={done ? "Link copiado" : label}
      onClick={copy}
      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-ink-soft transition hover:bg-black/[0.05] hover:text-ink"
    >
      {done ? <Check className="h-4 w-4 text-c-green-ink" /> : <Link2 className="h-4 w-4" />}
    </button>
  );
}

/** The link for whatever the client is looking at right this moment. */
export function CopyLink({ label = "Copiar el link de esto" }: { label?: string }) {
  return <CopyUrl get={shareableLink} label={label} />;
}
