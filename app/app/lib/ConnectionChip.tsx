"use client";

// Connection card INSIDE the chat. The agent writes `connection:<id>` (its
// SOUL teaches it to) and here it turns into a card with the real status and
// a button -- the model puts the mention, the code puts the card. That way
// "connect your Google" isn't a paragraph of instructions: it's a button.
//
// The data comes from getConnections with a module-level cache (one fetch per
// page session, even if the chat mentions five connections).

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { getConnections, loadConfig, type Connection } from "./agent";
import { ConnectionLogo } from "./ConnectionLogo";
import Permissions from "./Permissions";

let cache: Promise<Connection[]> | null = null;
// WHICH agent the cache holds. Without this, the cache belongs to the page
// and not the agent: if the credential changes while the tab is alive, the
// cards keep showing the previous client's connections.
let cacheFor: string | null = null;
function connections(): Promise<Connection[]> {
  const cfg = loadConfig();
  const key = cfg ? `${cfg.endpoint}|${cfg.key}` : "";
  if (!cache || cacheFor !== key) {
    cacheFor = key;
    cache = cfg
      ? getConnections(cfg)
          .then((r) => r?.connections ?? [])
          .catch(() => { cache = null; return []; })
      : Promise.resolve([]);
  }
  return cache;
}

export function ConnectionCardInline({ id }: { id: string }) {
  const [c, setC] = useState<Connection | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    connections().then((cs) => { if (alive) setC(cs.find((x) => x.id === id) ?? null); });
    return () => { alive = false; };
  }, [id]);

  // Unknown id or an unreachable catalog: shown as code, we don't break the
  // agent's message over a mention we couldn't resolve.
  if (c === null) {
    return (
      <code className="rounded bg-black/[0.06] px-1.5 py-0.5 font-mono text-[0.88em] text-ink">
        {id}
      </code>
    );
  }
  if (c === undefined) {
    return <span className="inline-block h-4 w-28 animate-pulse rounded bg-black/[0.06] align-middle" />;
  }

  const connected = c.status === "connected";
  return (
    <span className="not-prose my-1.5 flex w-full max-w-md items-center gap-3 rounded-xl border border-black/[0.08] bg-white px-3.5 py-3 shadow-soft">
      <ConnectionLogo id={c.id} size="sm" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-ink">{c.label}</span>
        <span className="block truncate text-[12px] leading-snug text-ink-soft">{c.purpose}</span>
      </span>
      {connected ? (
        <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-c-green/60 px-2 py-1 text-[11px] font-semibold text-c-green-ink">
          <CheckCircle2 className="h-3 w-3" />
          Conectada
        </span>
      ) : (
        <Link
          href="/app/connections"
          className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg bg-primary px-2.5 text-[13px] font-semibold text-white transition hover:bg-primary-dark"
        >
          Conectar
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      )}
    </span>
  );
}

/** The permission switches, INSIDE the chat. The agent writes
 *  `permissions:<id>` when it runs into the policy: instead of a flat "I
 *  can't", it puts the control right there and the client decides without
 *  leaving the conversation. It can't change it -- only point at it. */
export function PermissionsInline({ id }: { id: string }) {
  const [c, setC] = useState<Connection | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    connections()
      .then((cs) => { if (alive) setC(cs.find((x) => x.id === id) ?? null); })
      .catch(() => { if (alive) setC(null); });
    return () => { alive = false; };
  }, [id]);

  if (c === undefined) return <span className="text-[13px] text-ink-soft">…</span>;
  if (!c) return null;   // connection that doesn't exist: we don't invent a card
  return <div className="my-2 max-w-sm"><Permissions connection={c} /></div>;
}
