"use client";

// What a teammate is missing to be able to work — with the button inside.
//
// The roster declares `needs` with catalog connection ids (`whatsapp`), and
// until now that was just a sentence: "Necesita WhatsApp para empezar", on the
// profile of someone the client ALREADY added and who, without it, cannot do
// anything. The sentence is true and leads nowhere: the request lives two tabs
// away and whoever reads it has no reason to know Conexiones exists.
//
// IT IS THE SAME CONNECTION REQUEST: `createConnectionRequest`, with the same
// title (`Conectar {label}`, the only thing the other screen uses to
// recognize you already requested it) and the same ticket blocked from the
// start. What the portal does not do is connect on its own something that
// needs paperwork on our side: it leaves the request noted and says so.
//
// ONLY FOR SOMEONE ALREADY ON THE TEAM (`isReady`). A connection missing for a
// role the client has not added yet is not their problem: it is a catalog
// fact, and it stays the plain sentence from before.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Link2 } from "lucide-react";
import {
  requestedConnections, createConnectionRequest, getConnections, getTickets,
  type Connection, type PortalConfig, type Role,
} from "../lib/agent";
import { describeError, isReady } from "../lib/hiring";
import { channelLabel } from "../lib/labels";
import { PARAM } from "../lib/routes";
import { Btn } from "../lib/ui";

/** The connection catalog and the open requests, ONCE PER SCREEN. Two calls
 *  for the whole tab -- not one per card -- for the same reason as the
 *  roster: the list is the same for every teammate. */
export type TeamConnections = {
  /** null only while LOADING (the screen draws nothing until it knows). If
   *  the catalog does not answer it stays [], and every need falls back to
   *  the plain sentence as always: without a catalog we do not offer to
   *  request what we cannot describe. */
  list: Connection[] | null;
  alreadyRequested: (c: Connection) => boolean;
  requesting: (c: Connection) => boolean;
  requestConnection: (c: Connection, role: Role) => Promise<void>;
  refresh: () => void;
};

export function useTeamConnections(cfg: PortalConfig | null): TeamConnections {
  const [list, setList] = useState<Connection[] | null>(null);
  // Requests already made come FROM THE BOARD, same as in Conexiones: if they
  // only lived in this state, reloading the page would offer to request what
  // is already waiting all over again.
  const [onBoard, setOnBoard] = useState<Set<string>>(new Set());
  // And what was just requested on this screen, so the row changes on the
  // same tick: the freshly created ticket takes a moment to show up in the
  // list.
  const [justRequested, setJustRequested] = useState<string[]>([]);
  // In-flight PER CONNECTION, not per row: two hired roles can need the same
  // connection, and two "Request it" buttons racing each other used to file
  // two identical tickets.
  const [sending, setSending] = useState<Set<string>>(new Set());

  const refresh = useCallback(() => {
    if (!cfg) return;
    getConnections(cfg)
      .then((r) => setList(r?.connections ?? []))
      .catch(() => setList([]));
    // The board is an extra: without it we lose the "already requested",
    // not the tab.
    getTickets(cfg)
      .then((t) => setOnBoard(requestedConnections(t?.tickets)))
      .catch(() => { /* without the board we keep whatever is in memory */ });
  }, [cfg]);

  useEffect(() => { refresh(); }, [refresh]);

  const alreadyRequested = useCallback(
    (c: Connection) =>
      justRequested.indexOf(c.id) >= 0 || onBoard.has((c.label ?? "").trim().toLowerCase()),
    [justRequested, onBoard],
  );

  const requesting = useCallback((c: Connection) => sending.has(c.id), [sending]);

  const requestConnection = useCallback(async (c: Connection, role: Role) => {
    if (!cfg || sending.has(c.id)) return;
    setSending((prev) => new Set(prev).add(c.id));
    const who = role.name || role.label;
    try {
      await createConnectionRequest(cfg, {
      title: `Conectar ${c.label}`,
      body:
        `Lo pidió desde Equipo: ${who} (${role.label}) no puede empezar sin esto.\n` +
        `Para qué sirve: ${c.purpose}\n` +
        `Cómo se conecta: ${c.how}\n\n` +
        `No hagas nada por tu cuenta con esto: avisale al equipo de tuagente ` +
        `que hay que conectarlo y dejá el ticket esperando.`,
      });
      setJustRequested((p) => (p.indexOf(c.id) >= 0 ? p : p.concat(c.id)));
      refresh();   // so "Requested" leaves from the board, not from here
    } finally {
      setSending((prev) => { const s = new Set(prev); s.delete(c.id); return s; });
    }
  }, [cfg, sending, refresh]);

  return { list, alreadyRequested, requesting, requestConnection, refresh };
}

/** One row per missing connection. */
function Missing({ id, connection, role, connections }: {
  id: string;
  connection: Connection | null;
  role: Role;
  connections: TeamConnections;
}) {
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The catalog does not have it (old id, or it did not answer): stays the
  // plain sentence as always. We do not offer to request something we cannot
  // name or describe.
  if (!connection) {
    return (
      <p className="text-[13px] text-ink-soft">Necesita {channelLabel(id)} para empezar.</p>
    );
  }

  const label = connection.label;
  const toConnections = `/app/connections?${PARAM.connection}=${encodeURIComponent(connection.id)}`;
  const linkCls =
    "inline-flex items-center gap-1 text-[13px] font-semibold text-primary underline-offset-2 hover:underline";

  // "Ready": our half is already done and theirs is missing -- a message to
  // the bot -- so the request unblocks nothing. It sends them where it can
  // actually be finished.
  if (connection.status === "ready") {
    return (
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink-soft">
        <span>Necesita {label} para empezar: falta tu primer mensaje.</span>
        <Link href={toConnections} className={linkCls}>
          Terminar en Conexiones <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </p>
    );
  }


  if (connections.alreadyRequested(connection)) {
    // Already noted and someone on the other end is doing it: a button here
    // would be requesting the same thing twice.
    return (
      <p className="text-[13px] text-ink-soft">
        Necesita {label} para empezar.{" "}
        <span className="font-medium text-ink">Pedida: la estamos conectando.</span>{" "}
        Te escribimos cuando esté.
      </p>
    );
  }

  // With a self-service flow the client connects it on their own (today,
  // Google and its step-by-step dialog). The steps belong to Conexiones and
  // stay there: duplicating them here would be a second place to keep in
  // sync.
  //
  // THE SAME GATE AS CONEXIONES, not a rule of its own: having `setup_flow`
  // is not enough. WhatsApp has a flow (the QR) and a warning that forbids it
  // on the commercial line; Google with the secret unset is `blocked` and its
  // flow unblocks nothing. Telling either of those "you connect it" is
  // sending them to a wall with a smile.
  if (connection.setup_flow && connection.status === "disconnected"
      && connection.who === "client_only" && !connection.warning) {
    return (
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink-soft">
        <span>Necesita {label} para empezar. La conectás vos, en un par de minutos.</span>
        <Link href={toConnections} className={linkCls}>
          Conectala <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </p>
    );
  }

  const busy = requesting || connections.requesting(connection);
  const handleRequest = async () => {
    setRequesting(true);
    setError(null);
    try {
      await connections.requestConnection(connection, role);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setRequesting(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <p className="text-[13px] text-ink-soft">
        Necesita {label} para empezar. La conectamos nosotros.
      </p>
      <Btn size="sm" kind="secondary" onClick={handleRequest} disabled={busy}>
        <Link2 className="h-3.5 w-3.5" />
        {busy ? "Pidiendo…" : "Pedirla"}
      </Btn>
      {error && <p className="w-full text-[12px] font-medium text-c-coral-ink">{error}</p>}
    </div>
  );
}

export function WhatIsMissing({ role, connections, className = "" }: {
  role: Role;
  connections: TeamConnections;
  className?: string;
}) {
  // The rule lives here and not on every screen: someone not yet on the team
  // is told what they will need, with no button.
  if (!isReady(role)) return null;
  // Until the catalog answers, nothing is claimed to be missing: "Necesita X"
  // flickering on a role that has everything connected is a false alarm.
  if (connections.list === null) return null;
  const missing = (role.needs ?? [])
    .map((id) => ({ id, connection: connections.list?.find((c) => c.id === id) ?? null }))
    .filter(({ connection }) => !connection || connection.status !== "connected");
  // Everything connected: nothing to say. Nothing missing is not news.
  if (missing.length === 0) return null;

  return (
    <div className={`mt-2 flex flex-col gap-1.5 ${className}`}>
      {missing.map(({ id, connection }) => (
        <Missing key={id} id={id} connection={connection} role={role} connections={connections} />
      ))}
    </div>
  );
}
