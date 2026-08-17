"use client";

// The roster: who is on the team and who could join.
//
// It sits at the top of Habilidades because that tab already answers "what can
// my agent do". With a team the honest answer starts one level up -- WHO does
// it -- and the same screen becomes the place to hire the missing one.
//
// This is the only per-role view in the portal, and on purpose. Everything else
// (board, files, deliveries, activity) stays global with the role as a chip: a
// top-level role switcher would multiply navigation by N and hand the client an
// org chart to learn.
//
// Nothing renders when the agent has no roster, so every agent running today is
// untouched.

import { useEffect, useState } from "react";
import { AgentitoAvatar, LOOK_DEFAULT, type AgentitoLook } from "../lib/agentito";
import { getRoles, loadConfig, type Role } from "../lib/agent";
import { rotuloCanal } from "../lib/palabras";
import { Card, Chip } from "../lib/ui";

function faceOf(role: Role): AgentitoLook {
  return { ...LOOK_DEFAULT, ...(role.look ?? {}) } as AgentitoLook;
}

function RoleCard({ role }: { role: Role }) {
  const name = role.name || role.label;
  return (
    <Card className={`flex gap-3 p-4 ${role.hired ? "" : "opacity-70"}`}>
      <AgentitoAvatar look={faceOf(role)} className="h-11 w-11 shrink-0" apagado={!role.hired} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[14px] font-semibold text-ink">{name}</p>
          {/* The role label stays visible even when the client renamed it:
              "Vera" alone does not say what Vera does. */}
          {role.name && role.name !== role.label && (
            <span className="text-[12px] text-ink-soft">{role.label}</span>
          )}
          {role.hired
            ? <Chip tone="green">En tu equipo</Chip>
            : <Chip tone="neutral">Podés sumarlo</Chip>}
        </div>
        <p className="mt-1.5 text-[13px] leading-snug text-ink-soft">{role.does}</p>
        {role.never && (
          // The hard limit is a selling point, not fine print: it is the same
          // sentence that lives in the role's SOUL, so the promise on screen and
          // the rule the agent follows cannot drift.
          <p className="mt-1 text-[12px] text-ink-soft">
            <span className="font-medium text-ink">Nunca:</span> {role.never}
          </p>
        )}
        {!!role.needs?.length && (
          <p className="mt-1 text-[12px] text-ink-soft">
            {/* Connection ids travel raw (`whatsapp`); the portal has one
                dictionary that turns them into names the client recognises,
                and it is the same one Actividad and Conexiones use. */}
            Necesita {role.needs.map(rotuloCanal).join(", ")} para empezar.
          </p>
        )}
      </div>
    </Card>
  );
}

export default function Equipo() {
  const [roles, setRoles] = useState<Role[]>([]);
  useEffect(() => {
    const cfg = loadConfig();
    if (!cfg) return;
    let alive = true;
    getRoles(cfg)
      .then((r) => { if (alive) setRoles(r?.roles ?? []); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  if (roles.length === 0) return null;

  const hired = roles.filter((r) => r.hired);
  const offered = roles.filter((r) => !r.hired);

  return (
    <section className="mb-8">
      <h2 className="mb-1 text-[15px] font-semibold text-ink">Tu equipo</h2>
      <p className="mb-3 text-[13px] text-ink-soft">
        Cada uno trabaja en lo suyo y comparten lo que saben de tu empresa.
      </p>
      <div className="flex flex-col gap-2">
        {hired.map((role) => <RoleCard key={role.id} role={role} />)}
      </div>

      {offered.length > 0 && (
        <>
          <h3 className="mb-2 mt-5 text-[13px] font-semibold text-ink">Podés sumar</h3>
          <div className="flex flex-col gap-2">
            {offered.map((role) => <RoleCard key={role.id} role={role} />)}
          </div>
          {/* No hire button yet: hiring installs a profile and restarts the
              gateway, and neither is something a click should do before we
              decide what it costs. The roster informs; we do the hiring. */}
          <p className="mt-2 text-[12px] text-ink-soft">
            Escribinos y lo sumamos.
          </p>
        </>
      )}
    </section>
  );
}
