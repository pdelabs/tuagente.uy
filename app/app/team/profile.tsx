"use client";

// One teammate's page: what they do, what they run, what they have been doing.
//
// IT ANSWERS "WHAT IS THIS ONE FOR", NOT "SHOW ME ONLY THEIR STUFF". The board,
// the files and the deliveries stay whole in their own tabs -- splitting the
// client's work by employee would mean remembering who did what before you can
// find anything. What lives here is what genuinely BELONGS to the role: its
// flows ship inside its distribution, and its recent turns are the proof it is
// earning its place.

import { useEffect, useState } from "react";
import { isReady, isHired } from "../lib/hiring";
import Link from "next/link";
import { Workflow } from "lucide-react";
import { AgentitoAvatar, LOOK_DEFAULT, type AgentitoLook } from "../lib/agentito";
import {
  getFlows, getTickets, loadConfig,
  type Flow, type PortalConfig, type Role, type Ticket,
} from "../lib/agent";
import { channelLabel } from "../lib/labels";
import { Card, Chip, Spinner } from "../lib/ui";
import { PARAM } from "../lib/routes";
import { WhatIsMissing, type TeamConnections } from "./needs";
import WhatItCanDo from "./knowHow";

/** `Flow.status` in plain words. Closed to the three values the adapter sends
 *  (`active | paused | incomplete`): showing the raw English value on this
 *  profile was the one screen in the portal that did not translate the
 *  status. */
const FLOW_STATUS_LABEL: Record<string, string> = {
  active: "Activo",
  paused: "Pausado",
  incomplete: "Incompleto",
};

function faceOf(role: Role): AgentitoLook {
  // The request's look wins for the same reason as the name: while the role
  // is on its way, the face the client chose only lives there.
  return { ...LOOK_DEFAULT, ...((role.request && !isHired(role) ? role.request.look : null) ?? role.look ?? {}) } as AgentitoLook;
}

export default function RoleProfile({ role, connections }: {
  role: Role;
  /** The tab's connection catalog: Equipo fetches it once and shares it with
   *  the cards. Used here so that "Necesita WhatsApp" stops being a fact and
   *  becomes the request. */
  connections: TeamConnections;
}) {
  const [flows, setFlows] = useState<Flow[] | null>(null);
  const [tasks, setTasks] = useState<Ticket[] | null>(null);

  useEffect(() => {
    const cfg: PortalConfig | null = loadConfig();
    if (!cfg) return;
    let alive = true;
    // The flows this role SHIPS WITH are listed in the roster by slug; the
    // agent's own list says which are actually installed and how they are
    // doing. Both are needed: one is the promise, the other the state.
    getFlows(cfg)
      .then((r) => { if (alive) setFlows(r?.flows ?? []); })
      .catch(() => { if (alive) setFlows([]); });
    getTickets(cfg)
      .then((r) => { if (alive) setTasks((r?.tickets ?? []).filter((t) => t.assignee === role.id)); })
      .catch(() => { if (alive) setTasks([]); });
    return () => { alive = false; };
  }, [role.id]);

  const own = (flows ?? []).filter((f) => (role.flows ?? []).includes(f.slug));
  const promised = (role.flows ?? []).filter((slug) => !own.some((f) => f.slug === slug));

  const isOnTheWay = Boolean(role.request);

  return (
    <div className="flex flex-col gap-5">
      <Card className="flex gap-4 p-5">
        <AgentitoAvatar look={faceOf(role)} className="h-16 w-16 shrink-0" asleep={!role.hired} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {/* A role ON ITS WAY still serves the catalog's name: the profile
                only becomes theirs once we install it, so until then the name
                the client chose travels in the request. */}
            <p className="text-[18px] font-semibold text-ink">
              {(isOnTheWay ? role.request?.name : "") || role.name || role.label}
            </p>
            {(((isOnTheWay ? role.request?.name : "") || role.name || role.label) !== role.label) && (
              <span className="text-[14px] text-ink-soft">{role.label}</span>
            )}
            {isHired(role)
              ? <Chip tone="green">En tu equipo</Chip>
              : isOnTheWay
                // Already requested: saying "you can add them" invites
                // requesting again what is already waiting.
                ? <Chip tone="amber">En camino</Chip>
                : <Chip tone="neutral">Podés sumarlo</Chip>}
          </div>
          <p className="mt-2 text-[14px] leading-snug text-ink-soft">{role.does}</p>
          {role.never && (
            <p className="mt-1.5 text-[13px] text-ink-soft">
              <span className="font-medium text-ink">Nunca:</span> {role.never}
            </p>
          )}
          {/* Someone not yet on the team is only told what they are going to
              need, nothing more: requesting a connection for someone who does
              not work here unblocks nothing. */}
          {!!role.needs?.length && !isReady(role) && (
            <p className="mt-1.5 text-[13px] text-ink-soft">
              Necesita {role.needs.map(channelLabel).join(", ")} para empezar.
            </p>
          )}
          {/* Someone ALREADY on the team gets the same, but with the button:
              it is the one screen where the client sees that their teammate
              cannot start. */}
          <WhatIsMissing role={role} connections={connections} />
        </div>
      </Card>

      <section>
        <h2 className="mb-2 text-[15px] font-semibold text-ink">Lo que hace solo</h2>
        {flows === null ? <Spinner /> : (
          <div className="flex flex-col gap-2">
            {own.map((f) => (
              <Link key={f.slug} href={`/app/flows/${encodeURIComponent(f.slug)}`}>
                <Card className="flex items-center gap-3 p-3 transition hover:border-primary/40">
                  <Workflow className="h-4 w-4 shrink-0 text-ink-soft" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-medium text-ink">{f.name}</p>
                    <p className="truncate text-[13px] text-ink-soft">{f.client_summary}</p>
                  </div>
                  <Chip tone={f.status === "active" ? "green" : "neutral"}>
                    {FLOW_STATUS_LABEL[f.status] ?? f.status}
                  </Chip>
                </Card>
              </Link>
            ))}
            {/* A flow the role ships with but the agent has not installed. It is
                listed, not hidden: what the client was promised has to be
                visible even when it is not running yet. */}
            {promised.map((slug) => (
              <Card key={slug} className="flex items-center gap-3 p-3 opacity-70">
                <Workflow className="h-4 w-4 shrink-0 text-ink-soft" />
                <p className="min-w-0 flex-1 truncate text-[14px] text-ink-soft">{slug}</p>
                <Chip tone="neutral">sin instalar</Chip>
              </Card>
            ))}
            {own.length === 0 && promised.length === 0 && (
              <p className="text-[13px] text-ink-soft">
                Todavía no tiene trabajos que corra solo. Pedíselos por el chat.
              </p>
            )}
          </div>
        )}
      </section>

      {/* What tools it has at hand. Only for someone ALREADY on the team: for
          one who has not arrived yet, this would tell them about the agent
          -- the catalog is one and the same for everyone -- on the profile of
          someone who does not work here. */}
      {isHired(role) && <WhatItCanDo role={role} />}

      <section>
        <h2 className="mb-2 text-[15px] font-semibold text-ink">En qué anduvo</h2>
        {tasks === null ? <Spinner /> : tasks.length === 0 ? (
          <p className="text-[13px] text-ink-soft">Todavía no le tocó ninguna tarea.</p>
        ) : (
          // THE ONLY HONEST ANSWER TO "IS THIS ONE EARNING ITS PLACE". With a
          // role charged separately, a teammate that never receives work is a
          // line on the bill with nothing behind it -- and the client should
          // find that out here, not at renewal.
          <ul className="flex flex-col gap-1.5">
            {tasks.slice(0, 8).map((t) => (
              <li key={t.id}>
                {/* The task opens where tasks live. Its detail is the board's
                    job, and duplicating it here would be a second place to keep
                    right. */}
                <Link
                  href={`/app/pipeline?${PARAM.task}=${encodeURIComponent(t.id)}`}
                  className="block w-full rounded-lg border border-black/[0.07] bg-white p-2.5 text-left transition hover:border-primary/40"
                >
                  <p className="truncate text-[13px] text-ink">{t.title}</p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
