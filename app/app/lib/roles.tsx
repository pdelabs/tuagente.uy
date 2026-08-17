"use client";

// The team, portal side.
//
// A role is a Hermes profile with its own SOUL, skills and memory. The client
// hires one at a time and each arrives with a name and a face: in a list of
// twenty cards a face is read without reading, a text label has to be read.
//
// THE FACE IS NEITHER DECORATION NOR NAVIGATION. The role is not a switcher at
// the top level -- that hands the client the job of knowing who does what,
// which is exactly what they pay not to do. The work stays global and the role
// is an attribute of each thing: who made this delivery, who holds this task,
// who answered this message.
//
// An agent with no team (every one we run today) does not expose `roles` in its
// manifest: `useRoles` returns an empty map, `RoleChip` draws nothing, and the
// portal looks exactly as it did.

import { useEffect, useState } from "react";
import { AgentitoAvatar, LOOK_DEFAULT, type AgentitoLook } from "./agentito";
import { getRoles, loadConfig, type Role } from "./agent";

export type RolesById = Record<string, Role>;

function faceOf(role?: Role): AgentitoLook {
  return { ...LOOK_DEFAULT, ...(role?.look ?? {}) } as AgentitoLook;
}

/** Display name. A name the client set wins over the catalog label; the raw id
 *  is the last resort and means the agent has a profile the roster does not
 *  know about. */
export function roleName(id: string | null | undefined, roles: RolesById): string {
  if (!id) return "";
  const role = roles[id];
  return role?.name || role?.label || id;
}

/** This agent's hired roles, by id. Empty when the agent has no team. */
export function useRoles(): RolesById {
  const [roles, setRoles] = useState<RolesById>({});
  useEffect(() => {
    const cfg = loadConfig();
    if (!cfg) return;
    let alive = true;
    getRoles(cfg)
      .then((r) => {
        if (!alive) return;
        const byId: RolesById = {};
        for (const role of r?.roles ?? []) if (role.hired) byId[role.id] = role;
        setRoles(byId);
      })
      // An agent with no roster answers 404, and that is NOT a failure: it is a
      // single-role agent. It keeps looking the way it always did.
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  return roles;
}

/** Who did this. Drawn next to the work, never as a filter you pass first.
 *
 *  `default` is the agent the client named, and it carries no chip. Badging it
 *  as "one more member" turns their agent into an employee of a team they never
 *  hired. */
export function RoleChip({ id, roles, className = "" }: {
  id: string | null | undefined;
  roles: RolesById;
  className?: string;
}) {
  if (!id || id === "default") return null;
  const role = roles[id];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-lg border border-black/[0.07] bg-white px-1.5 py-0.5 text-[11px] font-medium text-ink-soft ${className}`}
      title={role?.does}
    >
      <AgentitoAvatar look={faceOf(role)} className="h-4 w-4 shrink-0" />
      {roleName(id, roles)}
    </span>
  );
}

/** The same fact, larger, to head one of their replies in the chat. */
export function RoleSignature({ id, roles }: { id: string | null | undefined; roles: RolesById }) {
  if (!id || id === "default") return null;
  return (
    <span className="inline-flex items-center gap-2 text-[12px] font-semibold text-ink">
      <AgentitoAvatar look={faceOf(roles[id])} className="h-5 w-5 shrink-0" />
      {roleName(id, roles)}
    </span>
  );
}
