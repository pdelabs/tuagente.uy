"use client";

// Network layer for the Artifacts module.
//
// HEADS UP / DEBT: this should NOT live in a feature folder. The portal has
// a single network entry point (../lib/agent.ts) and these functions SHOULD
// GRADUATE TO THE LIB (same style as getTickets / getFiles) as soon as lib/
// can be touched; in the meantime they stay here to avoid clashing with
// another agent.
//
// While writing this, lib/agent.ts already gained getArtifacts() and
// getArtifact(). When moving, make sure the lib version doesn't lose what's
// here:
//   1. the cache by id + dedupe of in-flight requests (the thumbnail and the
//      large view request the SAME html; without a cache that's two
//      downloads per artifact),
//   2. deleteArtifact (the lib doesn't have DELETE yet),
//   3. the HTTP status on the error: without it you can't tell "old adapter"
//      (404) apart from "agent down", and the page shows the wrong message.
//
// Adapter CONTRACT (:8643), all with bearer:
//   GET    {adapter}/portal/artifacts       → { artifacts: [{id,title,kind,summary,created_at,bytes}] }
//   GET    {adapter}/portal/artifacts/{id}  → { ...meta, html: "<full html>" }
//   DELETE {adapter}/portal/artifacts/{id}  → { ok: true }
// If the adapter is old, any of the three returns 404: that is NOT a network
// error, it's "this agent doesn't expose artifacts yet" (told apart by
// err.status).

import type { PortalConfig } from "../lib/agent";

export type ArtifactMeta = {
  id: string;
  title: string;
  /** chart | table | report | dashboard | diagram | other … and whatever the
   *  agent comes up with: we do NOT close it into a union, it renders as-is
   *  when we don't recognize it. */
  kind: string;
  summary: string | null;
  created_at: string | number; // Hermes emits epoch in SECONDS
  bytes: number | null;
};

export type ArtifactDetail = ArtifactMeta & { html: string };

/** Network error with the HTTP status at hand (no `class`: the tsconfig
 *  doesn't set a target and extending Error downlevel breaks instanceof). */
export type ApiError = Error & { status?: number };

export function statusOf(e: unknown): number | undefined {
  return typeof e === "object" && e !== null ? (e as ApiError).status : undefined;
}

export function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function fail(status: number, path: string): ApiError {
  const e = new Error(`${status} at ${path}`) as ApiError;
  e.status = status;
  return e;
}

const auth = (c: PortalConfig): HeadersInit => ({ Authorization: `Bearer ${c.key}` });

const base = (c: PortalConfig, id?: string) =>
  `${c.adapter}/portal/artifacts${id ? `/${encodeURIComponent(id)}` : ""}`;

export async function listArtifacts(c: PortalConfig): Promise<ArtifactMeta[]> {
  const res = await fetch(base(c), { headers: auth(c) });
  if (!res.ok) throw fail(res.status, "/portal/artifacts");
  const data = await res.json();
  const arr = Array.isArray(data?.artifacts) ? data.artifacts : [];
  // Defensive: without an id there's no possible card; the rest normalizes gently.
  return arr
    .filter((a: any) => a && typeof a.id === "string")
    .map((a: any) => ({
      id: a.id,
      title: typeof a.title === "string" && a.title.trim() ? a.title : a.id,
      kind: typeof a.kind === "string" && a.kind ? a.kind : "other",
      summary: typeof a.summary === "string" ? a.summary : null,
      created_at: a.created_at ?? 0,
      bytes: typeof a.bytes === "number" ? a.bytes : null,
    }));
}

// The full HTML of an artifact is requested only once per id: both the grid
// thumbnail and the large view use it, and it never changes (artifacts are
// immutable; if the agent regenerates it, the id changes).
const cache = new Map<string, ArtifactDetail>();
const inFlight = new Map<string, Promise<ArtifactDetail>>();

// With the adapter baked in: if the client switches agent without reloading,
// we don't show them the previous one's artifact.
// NUL (\0) separates the two halves: it can never appear in a URL or an id.
const cacheKey = (c: PortalConfig, id: string) => `${c.adapter}\0${id}`;

export function getArtifact(c: PortalConfig, id: string): Promise<ArtifactDetail> {
  const k = cacheKey(c, id);
  const hit = cache.get(k);
  if (hit) return Promise.resolve(hit);
  const pending = inFlight.get(k);
  if (pending) return pending;

  const req = (async () => {
    const res = await fetch(base(c, id), { headers: auth(c) });
    if (!res.ok) throw fail(res.status, `/portal/artifacts/${id}`);
    const d = (await res.json()) as ArtifactDetail;
    if (typeof d?.html !== "string") throw new Error("el artefacto vino sin html");
    cache.set(k, d);
    return d;
  })().finally(() => inFlight.delete(k));

  inFlight.set(k, req);
  return req;
}

export function forgetArtifact(c: PortalConfig, id: string) {
  cache.delete(cacheKey(c, id));
}

export async function deleteArtifact(c: PortalConfig, id: string): Promise<void> {
  const res = await fetch(base(c, id), { method: "DELETE", headers: auth(c) });
  if (!res.ok) throw fail(res.status, `/portal/artifacts/${id}`);
  forgetArtifact(c, id);
}
