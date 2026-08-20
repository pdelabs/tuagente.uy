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
import { yaEsta } from "../lib/altaEquipo";
import Link from "next/link";
import { Workflow } from "lucide-react";
import { AgentitoAvatar, LOOK_DEFAULT, type AgentitoLook } from "../lib/agentito";
import {
  getFlujos, getTickets, loadConfig,
  type Flujo, type PortalConfig, type Role, type Ticket,
} from "../lib/agent";
import { rotuloCanal } from "../lib/palabras";
import { Card, Chip, Spinner } from "../lib/ui";
import { PARAM } from "../lib/rutas";
import QueSabeHacer from "./saberHacer";

function faceOf(role: Role): AgentitoLook {
  // La pinta del pedido gana por lo mismo que el nombre: mientras el rol está
  // en camino, la cara que el cliente eligió sólo vive ahí.
  return { ...LOOK_DEFAULT, ...((role.pedido && !yaEsta(role) ? role.pedido.pinta : null) ?? role.look ?? {}) } as AgentitoLook;
}

export default function FichaDelRol({ role }: { role: Role }) {
  const [flujos, setFlujos] = useState<Flujo[] | null>(null);
  const [tareas, setTareas] = useState<Ticket[] | null>(null);

  useEffect(() => {
    const cfg: PortalConfig | null = loadConfig();
    if (!cfg) return;
    let alive = true;
    // The flows this role SHIPS WITH are listed in the roster by slug; the
    // agent's own list says which are actually installed and how they are
    // doing. Both are needed: one is the promise, the other the state.
    getFlujos(cfg)
      .then((r) => { if (alive) setFlujos(r?.flujos ?? []); })
      .catch(() => { if (alive) setFlujos([]); });
    getTickets(cfg)
      .then((r) => { if (alive) setTareas((r?.tickets ?? []).filter((t) => t.assignee === role.id)); })
      .catch(() => { if (alive) setTareas([]); });
    return () => { alive = false; };
  }, [role.id]);

  const suyos = (flujos ?? []).filter((f) => (role.flows ?? []).includes(f.slug));
  const prometidos = (role.flows ?? []).filter((slug) => !suyos.some((f) => f.slug === slug));

  const enCamino = Boolean(role.pedido);

  return (
    <div className="flex flex-col gap-5">
      <Card className="flex gap-4 p-5">
        <AgentitoAvatar look={faceOf(role)} className="h-16 w-16 shrink-0" apagado={!role.hired} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {/* Un rol PEDIDO sigue sirviendo el nombre del catálogo: el perfil
                recién pasa a ser suyo cuando se lo instalamos, así que hasta
                entonces el nombre que el cliente eligió viaja en el pedido. */}
            <p className="text-[18px] font-semibold text-ink">
              {(enCamino ? role.pedido?.nombre : "") || role.name || role.label}
            </p>
            {(((enCamino ? role.pedido?.nombre : "") || role.name || role.label) !== role.label) && (
              <span className="text-[14px] text-ink-soft">{role.label}</span>
            )}
            {yaEsta(role)
              ? <Chip tone="green">En tu equipo</Chip>
              : enCamino
                // Ya lo pidió: decirle "podés sumarlo" es invitarlo a pedir de
                // nuevo lo que ya está esperando.
                ? <Chip tone="amber">En camino</Chip>
                : <Chip tone="neutral">Podés sumarlo</Chip>}
          </div>
          <p className="mt-2 text-[14px] leading-snug text-ink-soft">{role.does}</p>
          {role.never && (
            <p className="mt-1.5 text-[13px] text-ink-soft">
              <span className="font-medium text-ink">Nunca:</span> {role.never}
            </p>
          )}
          {!!role.needs?.length && (
            <p className="mt-1.5 text-[13px] text-ink-soft">
              Necesita {role.needs.map(rotuloCanal).join(", ")} para empezar.
            </p>
          )}
        </div>
      </Card>

      <section>
        <h2 className="mb-2 text-[15px] font-semibold text-ink">Lo que hace solo</h2>
        {flujos === null ? <Spinner /> : (
          <div className="flex flex-col gap-2">
            {suyos.map((f) => (
              <Link key={f.slug} href={`/app/flujos?flujo=${encodeURIComponent(f.slug)}`}>
                <Card className="flex items-center gap-3 p-3 transition hover:border-primary/40">
                  <Workflow className="h-4 w-4 shrink-0 text-ink-soft" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-medium text-ink">{f.nombre}</p>
                    <p className="truncate text-[13px] text-ink-soft">{f.para_cliente}</p>
                  </div>
                  <Chip tone={f.estado === "activo" ? "green" : "neutral"}>{f.estado}</Chip>
                </Card>
              </Link>
            ))}
            {/* A flow the role ships with but the agent has not installed. It is
                listed, not hidden: what the client was promised has to be
                visible even when it is not running yet. */}
            {prometidos.map((slug) => (
              <Card key={slug} className="flex items-center gap-3 p-3 opacity-70">
                <Workflow className="h-4 w-4 shrink-0 text-ink-soft" />
                <p className="min-w-0 flex-1 truncate text-[14px] text-ink-soft">{slug}</p>
                <Chip tone="neutral">sin instalar</Chip>
              </Card>
            ))}
            {suyos.length === 0 && prometidos.length === 0 && (
              <p className="text-[13px] text-ink-soft">
                Todavía no tiene trabajos que corra solo. Pedíselos por el chat.
              </p>
            )}
          </div>
        )}
      </section>

      {/* Qué herramientas tiene a mano. Solo para el que YA está en el equipo:
          a uno que todavía no llegó, esto le contaría del agente —el catálogo es
          uno solo para todos— en la ficha de alguien que no trabaja acá. */}
      {yaEsta(role) && <QueSabeHacer role={role} />}

      <section>
        <h2 className="mb-2 text-[15px] font-semibold text-ink">En qué anduvo</h2>
        {tareas === null ? <Spinner /> : tareas.length === 0 ? (
          <p className="text-[13px] text-ink-soft">Todavía no le tocó ninguna tarea.</p>
        ) : (
          // THE ONLY HONEST ANSWER TO "IS THIS ONE EARNING ITS PLACE". With a
          // role charged separately, a teammate that never receives work is a
          // line on the bill with nothing behind it -- and the client should
          // find that out here, not at renewal.
          <ul className="flex flex-col gap-1.5">
            {tareas.slice(0, 8).map((t) => (
              <li key={t.id}>
                {/* The task opens where tasks live. Its detail is the board's
                    job, and duplicating it here would be a second place to keep
                    right. */}
                <Link
                  href={`/app/pipeline?${PARAM.tarea}=${encodeURIComponent(t.id)}`}
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