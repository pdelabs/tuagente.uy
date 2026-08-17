"use client";

// Equipo — who works for you (GET {adapter}/portal/roles).
//
// A role is a Hermes profile with its own SOUL, skills and memory. The client
// hires one at a time and each arrives with a name and a face.
//
// THIS IS THE ONLY PER-ROLE VIEW IN THE PORTAL, and on purpose. Everything else
// -- board, files, deliveries, activity, chat -- stays global with the role as a
// chip or a signature. A top-level role switcher would multiply navigation by N
// and hand the client an org chart to learn, which is exactly the work they pay
// not to do. This tab answers "who is on my team", not "show me only their
// stuff".
//
// It only exists on an agent that has a team: the `roles` module is false on
// every single-role agent, so the tab is not in the nav and this page is never
// reached.

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Users } from "lucide-react";
import { AgentitoAvatar, LOOK_DEFAULT, type AgentitoLook } from "../lib/agentito";
import { getRoles, loadConfig, type HttpError, type PortalConfig, type Role } from "../lib/agent";
import { loadAgentName } from "../lib/onboarding";
import { horaDe, rotuloCanal } from "../lib/palabras";
import { Card, Chip, EmptyState, ErrorState, IconBtn, PageHeader, Soporte, Spinner } from "../lib/ui";

const WRAP = "mx-auto max-w-5xl px-6 py-6 md:px-8";
const REFRESH_MS = 60_000;

function faceOf(role: Role): AgentitoLook {
  return { ...LOOK_DEFAULT, ...(role.look ?? {}) } as AgentitoLook;
}

function RoleCard({ role }: { role: Role }) {
  return (
    <Card className={`flex gap-4 p-4 ${role.hired ? "" : "opacity-70"}`}>
      <AgentitoAvatar
        look={faceOf(role)}
        className="h-14 w-14 shrink-0"
        apagado={!role.hired}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[15px] font-semibold text-ink">{role.name || role.label}</p>
          {/* The job title stays visible even after a rename: "Vera" on its own
              does not say what Vera does. */}
          {role.name && role.name !== role.label && (
            <span className="text-[13px] text-ink-soft">{role.label}</span>
          )}
          {role.hired
            ? <Chip tone="green">En tu equipo</Chip>
            : <Chip tone="neutral">Podés sumarlo</Chip>}
        </div>
        <p className="mt-1.5 text-[14px] leading-snug text-ink-soft">{role.does}</p>
        {role.never && (
          // The hard limit is a selling point, not fine print: it is the same
          // sentence that lives in this role's SOUL, so what the screen promises
          // and what the agent obeys cannot drift apart.
          <p className="mt-1.5 text-[13px] text-ink-soft">
            <span className="font-medium text-ink">Nunca:</span> {role.never}
          </p>
        )}
        {!!role.needs?.length && (
          // Connection ids travel raw (`whatsapp`); the portal has one
          // dictionary that turns them into names the client recognises, and it
          // is the same one Actividad and Conexiones use.
          <p className="mt-1.5 text-[13px] text-ink-soft">
            Necesita {role.needs.map(rotuloCanal).join(", ")} para empezar.
          </p>
        )}
      </div>
    </Card>
  );
}

export default function EquipoPage() {
  const [cfg, setCfg] = useState<PortalConfig | null>(null);
  const [roles, setRoles] = useState<Role[] | null>(null);
  const [err, setErr] = useState<{ status?: number; message: string } | null>(null);
  const [cargando, setCargando] = useState(false);
  const [ultima, setUltima] = useState<Date | null>(null);
  const [nombreAgente, setNombreAgente] = useState("");

  useEffect(() => {
    setCfg(loadConfig());
    setNombreAgente(loadAgentName() || "");
  }, []);

  // silent: the periodic refresh must not blank the screen, and must not
  // replace data that is still good with an error.
  const load = useCallback((silent = false) => {
    if (!cfg) return;
    if (!silent) { setRoles(null); setErr(null); }
    setCargando(true);
    getRoles(cfg)
      .then((r) => {
        setRoles(r?.roles ?? []);
        setErr(null);
        setUltima(new Date());
      })
      .catch((e: HttpError) => setErr({ status: e?.status, message: e?.message || "error" }))
      .finally(() => setCargando(false));
  }, [cfg]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!cfg) return;
    const t = setInterval(() => load(true), REFRESH_MS);
    return () => clearInterval(t);
  }, [cfg, load]);

  const cuerpo = () => {
    if (err && roles === null) {
      return <ErrorState message={err.message} onRetry={() => load()} />;
    }
    if (roles === null) return <Spinner />;
    if (roles.length === 0) {
      return (
        <EmptyState
          icon={Users}
          title="Todavía sos vos y tu agente"
          hint="Cuando sumes a alguien más al equipo, va a aparecer acá."
        />
      );
    }

    const hired = roles.filter((r) => r.hired);
    const offered = roles.filter((r) => !r.hired);

    return (
      <>
        <div className="flex flex-col gap-2">
          {hired.map((role) => <RoleCard key={role.id} role={role} />)}
        </div>

        {offered.length > 0 && (
          <>
            <h2 className="mb-2 mt-7 text-[15px] font-semibold text-ink">Podés sumar</h2>
            <div className="flex flex-col gap-2">
              {offered.map((role) => <RoleCard key={role.id} role={role} />)}
            </div>
            {/* No hire button. Hiring installs a profile and restarts the
                gateway, and neither belongs behind a click before we have
                decided what a role costs. The roster informs; we do the hiring.
                The link is the shared one so the contact URL keeps living in a
                single place -- only the words change. */}
            <div className="mt-3">
              <Soporte label="Escribinos y lo sumamos a tu equipo" />
            </div>
          </>
        )}
      </>
    );
  };

  return (
    <div className={WRAP}>
      <PageHeader
        title="Tu equipo"
        subtitle={
          nombreAgente
            ? `${nombreAgente} no trabaja solo: cada uno se ocupa de lo suyo y comparten lo que saben de tu empresa.`
            : "Cada uno se ocupa de lo suyo y comparten lo que saben de tu empresa."
        }
        actions={
          <>
            {/* One clock in the whole portal: the business's. Same stamp as
                Inicio, Actividad and Entregas. */}
            {ultima && (
              <span className="hidden text-xs tabular-nums text-ink-soft sm:inline">
                Actualizado {horaDe(ultima.getTime())}
              </span>
            )}
            <IconBtn label="Actualizar" disabled={cargando} onClick={() => load(true)}>
              <RefreshCw className={`h-4 w-4 ${cargando ? "animate-spin" : ""}`} />
            </IconBtn>
          </>
        }
      />

      {err && roles !== null && (
        <p className="mb-4 inline-flex items-center rounded-lg border border-c-coral bg-c-coral/40 px-3 py-1.5 text-[12px] font-medium text-c-coral-ink">
          No pude actualizar recién ({err.message}). Te muestro lo último que tengo.
        </p>
      )}

      {cuerpo()}
    </div>
  );
}
