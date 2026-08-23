"use client";

// The capability catalog and what this browser already requested, shared.
//
// Used to live inside `CapabilityChip.tsx` while the chat was the only thing
// reading it. Now each teammate's profile reads it too ("What it can do"),
// and the two screens HAVE TO look at the same thing:
//
//   - the catalog, because `active` is computed on the agent's side and two
//     copies drifting apart would be two different answers to "does it
//     already have this?";
//   - what's requested, because a request made from the chat can't be
//     offered again on the profile as if nothing happened.
//
// No UI lives here: just the two pieces of state, and how the catalog gets
// grouped for display -- which two screens also read (a teammate's profile
// and the role-hiring flow built out of capabilities) and also have to agree.

import { getCapabilities, loadConfig, type Capability } from "./agent";

let cache: Promise<Capability[]> | null = null;
// WHICH agent the cache is for: the cache belongs to the page, and the
// credential can change while the tab stays alive.
let cacheFor: string | null = null;

/** The whole catalog, once per tab and per credential. */
export function capabilityCatalog(): Promise<Capability[]> {
  const cfg = loadConfig();
  const key = cfg ? `${cfg.endpoint}|${cfg.key}` : "";
  if (!cache || cacheFor !== key) {
    cacheFor = key;
    cache = cfg
      ? getCapabilities(cfg)
          .then((r) => r?.capabilities ?? [])
          .catch(() => { cache = null; return []; })
      : Promise.resolve([]);
  }
  return cache;
}

// What this browser already requested. The adapter records requests in a file
// but doesn't return them, so there's no way to ask it: it's remembered here
// so nothing invites a double click or a "did I already ask for this?".
const REQUESTED_KEY = "tuagente_requested_capabilities";

export function readRequested(): string[] {
  try { return JSON.parse(localStorage.getItem(REQUESTED_KEY) || "[]"); } catch { return []; }
}

export function markRequested(id: string) {
  try {
    const all = Array.from(new Set([...readRequested(), id]));
    localStorage.setItem(REQUESTED_KEY, JSON.stringify(all));
  } catch { /* private mode: at least it's good for this screen */ }
}

/** The catalog's groups, in words. The catalog is closed but can grow: a
 *  group not listed here gets humanized (dashes to spaces) instead of
 *  breaking the screen or showing up raw. */
const GROUP_LABEL: Record<string, string> = {
  administration: "Administración",
  "documents-and-data": "Documentos y datos",
  information: "Información",
  content: "Contenido",
  "customer-service": "Atención a clientes",
  audio: "Audio",
  other: "Otras",
};

export function groupLabel(g: string): string {
  const known = GROUP_LABEL[g];
  if (known) return known;
  const free = g.replace(/-/g, " ");
  return free.charAt(0).toUpperCase() + free.slice(1);
}

/** The catalog split into groups, IN THE ORDER IT ARRIVES. The order is the
 *  catalog's own decision, and reordering it here would be a second opinion
 *  on the same thing. It's a function and not a per-screen copy because the
 *  portal's two capability lists -- a teammate's profile and the hiring flow
 *  -- have to read it identically: it's the same catalog. */
export function byGroup(caps: Capability[]): {
  group: string; label: string; capabilities: Capability[];
}[] {
  const order: string[] = [];
  const grouped: Record<string, Capability[]> = {};
  for (const c of caps) {
    const g = c.group || "other";
    if (!grouped[g]) { order.push(g); grouped[g] = []; }
    grouped[g].push(c);
  }
  return order.map((group) => ({ group, label: groupLabel(group), capabilities: grouped[group] }));
}
