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
//
// THIS IS ALSO WHERE PEOPLE GET ADDED, and it is not an extra button: it is the
// same alta action (`lib/hiring.tsx`) for the second teammate onward. The
// portal does not INSTALL anything -- we do that by hand: the profile, the
// permissions, the gateway restart -- but it can leave the request noted down
// with the name and the face the client chose. This used to say "write to us
// and we'll add them to your team", which, now that the request exists on its
// own, meant sending someone to write an email for something the screen does
// by itself.

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ChevronLeft, RefreshCw, UserPlus, Users } from "lucide-react";
import { AgentitoAvatar, LOOK_DEFAULT, type AgentitoLook } from "../lib/agentito";
import { getRoles, loadConfig, type HttpError, type PortalConfig, type Role } from "../lib/agent";
import {
  RoleNaming, NeedsForm, NOT_COUNTED, isReady, isBespokeRole, isHired,
  type RoleHiringOutcome, type WhatItNeeds,
} from "../lib/hiring";
import { loadAgentName } from "../lib/onboarding";
import { timeOf, channelLabel } from "../lib/labels";
import { Btn, Card, Chip, EmptyState, ErrorState, IconBtn, PageHeader, Support, Spinner } from "../lib/ui";
import { PARAM, openInRoute, closeInRoute, useRouteParam } from "../lib/routes";
import RoleProfile from "./profile";
import { WhatIsMissing, useTeamConnections, type TeamConnections } from "./needs";

const WRAP = "mx-auto max-w-5xl px-6 py-6 md:px-8";
const REFRESH_MS = 60_000;

/** Requested but not yet installed: it is neither on the team nor requestable
 *  again. Without this distinction, a client who already waited would see the
 *  role offered again and request it twice. */
// An open request means "on its way" even mid-install: until the baptism
// persists, the roster carries the CATALOG name and face, and this tab is
// exactly where the client checks that their hire arrived.
const isOnTheWay = (role: Role) => Boolean(role.request);

/** The name the client sees. If they baptized it when requesting it, THAT one
 *  wins even while the roster still serves the catalog's, because the profile
 *  only becomes theirs once we install it -- so until then, what they chose
 *  travels inside the request. */
function roleDisplayName(role: Role): string {
  return (isOnTheWay(role) ? role.request?.name : "") || role.name || role.label;
}

function faceOf(role: Role): AgentitoLook {
  return { ...LOOK_DEFAULT, ...((isOnTheWay(role) ? role.request?.look : null) ?? role.look ?? {}) } as AgentitoLook;
}

function RoleCard({ role, onOpen, connections, action }: {
  role: Role;
  onOpen: () => void;
  /** The tab's connection catalog: what a role ALREADY on the team is missing
   *  is said with the button that unblocks it. */
  connections: TeamConnections;
  /** The only thing touched on the card besides the card itself: today,
   *  "Add them". */
  action?: ReactNode;
}) {
  const name = roleDisplayName(role);
  return (
    // The button is INSIDE the Card and does not wrap it: `Card` is
    // presentational and shared by half the portal -- teaching it to be
    // clickable for one caller is how a UI kit turns into a pile of props --
    // and a button inside a button (the "Add them" one) is not valid HTML.
    <Card className={`p-4 transition hover:border-primary/40 ${isHired(role) ? "" : "opacity-70"}`}>
      <div className="flex items-start gap-3">
        <button onClick={onOpen} className="flex min-w-0 flex-1 gap-4 text-left">
          <AgentitoAvatar
            look={faceOf(role)}
            className="h-14 w-14 shrink-0"
            asleep={!isHired(role)}
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[15px] font-semibold text-ink">{name}</p>
              {/* The job title stays visible even after a rename: "Vera" on its own
                  does not say what Vera does. */}
              {name !== role.label && (
                <span className="text-[13px] text-ink-soft">{role.label}</span>
              )}
              {isHired(role)
                ? <Chip tone="green">En tu equipo</Chip>
                : isOnTheWay(role)
                  ? <Chip tone="amber">En camino</Chip>
                  : <Chip tone="neutral">Podés sumarlo</Chip>}
            </div>
            {isOnTheWay(role) && (
              <p className="mt-1.5 text-[14px] leading-snug text-ink">
                «{name}» está en camino: lo estamos preparando.
              </p>
            )}
            <p className="mt-1.5 text-[14px] leading-snug text-ink-soft">{role.does}</p>
            {role.never && (
              // The hard limit is a selling point, not fine print: it is the same
              // sentence that lives in this role's SOUL, so what the screen promises
              // and what the agent obeys cannot drift apart.
              <p className="mt-1.5 text-[13px] text-ink-soft">
                <span className="font-medium text-ink">Nunca:</span> {role.never}
              </p>
            )}
            {!!role.needs?.length && !isReady(role) && (
              // Connection ids travel raw (`whatsapp`); the portal has one
              // dictionary that turns them into names the client recognises, and it
              // is the same one Actividad and Conexiones use.
              //
              // For someone NOT YET on the team this stays a fact: a connection
              // missing for someone who does not work here is not a problem the
              // client has to solve today. `WhatIsMissing`, below, handles the one
              // who already is, with the button.
              <p className="mt-1.5 text-[13px] text-ink-soft">
                Necesita {role.needs.map(channelLabel).join(", ")} para empezar.
              </p>
            )}
          </div>
        </button>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {/* OUTSIDE the button that opens the profile: inside would be a button
          inside another one -- invalid HTML -- and pressing "Request it" would
          open the profile instead of leaving the request. Aligned with the
          text, not the avatar. */}
      <WhatIsMissing role={role} connections={connections} className="sm:pl-[72px]" />
    </Card>
  );
}

export default function TeamPage() {
  // Which teammate is open is READ FROM THE URL, never from a useState in
  // parallel: that is what makes a reload land on the same one and the link
  // shareable. Same with the baptism of whoever is being added (`?hire=`):
  // refreshing in the middle returns to the same place, and "back" closes it.
  const openRoleId = useRouteParam(PARAM.role);
  const hiringId = useRouteParam(PARAM.hire);
  const [cfg, setCfg] = useState<PortalConfig | null>(null);
  const [roles, setRoles] = useState<Role[] | null>(null);
  const [err, setErr] = useState<{ status?: number; message: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [agentName, setAgentName] = useState("");
  // The made-to-measure role (asistente) asks what the client needs BEFORE the
  // baptism, exactly like the first-run alta does. The answer lives here so
  // going back from the baptism keeps the text and the checks.
  const [needs, setNeeds] = useState<WhatItNeeds>(NOT_COUNTED);
  const [answered, setAnswered] = useState(false);
  // Connections are fetched ONCE PER SCREEN, next to the roster: they are the
  // same for every teammate, and one call per card would be the same list
  // requested six times.
  const connections = useTeamConnections(cfg);

  useEffect(() => {
    setCfg(loadConfig());
    setAgentName(loadAgentName() || "");
  }, []);

  // silent: the periodic refresh must not blank the screen, and must not
  // replace data that is still good with an error.
  const load = useCallback((silent = false) => {
    if (!cfg) return;
    if (!silent) { setRoles(null); setErr(null); }
    setLoading(true);
    getRoles(cfg)
      .then((r) => {
        setRoles(r?.roles ?? []);
        setErr(null);
        setLastUpdated(new Date());
      })
      .catch((e: HttpError) => setErr({ status: e?.status, message: e?.message || "error" }))
      .finally(() => setLoading(false));
  }, [cfg]);

  useEffect(() => { load(); }, [load]);
  const refreshConnections = connections.refresh;
  useEffect(() => {
    if (!cfg) return;
    // The same tick refreshes both things: a connection someone connected
    // while the client is looking at the screen has to drop its own row.
    const t = setInterval(() => { load(true); refreshConnections(); }, REFRESH_MS);
    return () => clearInterval(t);
  }, [cfg, load, refreshConnections]);

  // The baptism takes care of the request and of the 409; what is left here is
  // keeping the roster current. If the 409 answered that the role is ALREADY
  // installed, the fresh roster comes back and that one wins. If not, the
  // request is noted exactly as the agent returned it -- so the card says "on
  // its way" on the same tick -- and it is asked again, which is what confirms
  // it.
  const onHiringOutcome = (r: RoleHiringOutcome) => {
    // Only close what is still open: if the client already navigated away, a
    // late resolve must not pop an unrelated history entry.
    if (hiringId) closeInRoute(PARAM.hire);
    if (r.kind === "hired") { setRoles(r.roles); return; }
    setRoles((prev) => (prev ?? []).map((x) => (
      x.id === r.role.id
        ? { ...x, request: r.request ?? { name: r.name, look: r.look, requested_at: "" } }
        : x
    )));
    load(true);
  };

  const body = () => {
    if (openRoleId && roles) {
      const role = roles.find((r) => r.id === openRoleId);
      // A link to a teammate this agent does not have is a stale link, not a
      // crash: the roster is shown instead of an error about an id.
      if (role) return <RoleProfile role={role} connections={connections} />;
    }
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

    const hired = roles.filter(isReady);
    const pending = roles.filter(isOnTheWay);
    // ONLY WHAT CAN BE REQUESTED gets a button. `state` comes straight from
    // the catalog and the adapter does not fill it in: a role with no `state`,
    // or in draft, answers 404 to the request. Offering "Add them" there is
    // offering the client an error after they already picked and named it.
    // Same filter as the alta.
    const offered = roles.filter((r) => !isHired(r) && !r.request && r.state === "ready");
    const inPreparation = roles.filter((r) => !isHired(r) && !r.request && r.state !== "ready");

    const openProfile = (role: Role) => () => openInRoute({ [PARAM.role]: role.id });

    return (
      <>
        <div className="flex flex-col gap-2">
          {hired.map((role) => (
            <RoleCard key={role.id} role={role} onOpen={openProfile(role)} connections={connections} />
          ))}
        </div>

        {pending.length > 0 && (
          <>
            <h2 className="mb-2 mt-7 text-[15px] font-semibold text-ink">En camino</h2>
            <div className="flex flex-col gap-2">
              {pending.map((role) => (
                <RoleCard key={role.id} role={role} onOpen={openProfile(role)} connections={connections} />
              ))}
            </div>
            {/* Same truth as the alta's waiting screen, and for the same
                reason: there is a person on the other end preparing it. Without
                this, a role requested three days ago looks like a frozen
                screen. */}
            <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">
              Lo prepara alguien de tuagente: hay que darle su lugar en tu
              agente, sus permisos y lo que necesita para arrancar. No es
              automático y no lo podés apurar desde acá. Cuando esté, aparece
              acá arriba trabajando.
            </p>
          </>
        )}

        {offered.length > 0 && (
          <>
            <h2 className="mb-2 mt-7 text-[15px] font-semibold text-ink">Podés sumar</h2>
            <div className="flex flex-col gap-2">
              {offered.map((role) => (
                <RoleCard key={role.id} role={role} onOpen={openProfile(role)} connections={connections}
                  action={
                    <Btn size="sm" kind="secondary"
                      onClick={() => openInRoute({ [PARAM.hire]: role.id })}>
                      <UserPlus className="h-4 w-4" /> Sumarlo
                    </Btn>
                  } />
              ))}
            </div>
            <div className="mt-3">
              <Support label="¿No sabés cuál te sirve? Escribinos" />
            </div>
          </>
        )}

        {inPreparation.length > 0 && (
          <>
            {/* Roles the catalog does not consider ready yet. Shown all the
                same -- what is coming is also part of the offer -- but with no
                button, because requesting one of these answers 404. */}
            <h2 className="mb-2 mt-7 text-[15px] font-semibold text-ink">
              Todavía los estamos armando
            </h2>
            <div className="flex flex-col gap-2">
              {inPreparation.map((role) => (
                <RoleCard key={role.id} role={role} onOpen={openProfile(role)} connections={connections} />
              ))}
            </div>
            <div className="mt-3">
              <Support label="¿Te sirve alguno de estos? Escribinos" />
            </div>
          </>
        )}
      </>
    );
  };

  const openRole = openRoleId ? (roles ?? []).find((r) => r.id === openRoleId) : undefined;
  // Who is being baptized comes from the ROSTER and not from the URL alone: a
  // `?hire=` with an id that does not exist, with someone already on the team,
  // or with one already requested is a stale link, and a stale link shows the
  // list -- never a form to request the same thing twice.
  useEffect(() => { setNeeds(NOT_COUNTED); setAnswered(false); }, [hiringId]);

  const hiringRole = cfg && hiringId
    ? (roles ?? []).find((r) => r.id === hiringId && !isHired(r) && !r.request && r.state === "ready")
    : undefined;

  // The baptism takes over the whole tab: it is a decision -- what they will
  // be called and what face they have -- not a detail on the side of the list.
  if (hiringRole && cfg) {
    return (
      <div className={WRAP}>
        <button
          onClick={() => closeInRoute(PARAM.hire)}
          className="mb-2 inline-flex items-center gap-1 text-[13px] text-ink-soft transition hover:text-ink"
        >
          <ChevronLeft className="h-3.5 w-3.5" /> Tu equipo
        </button>
        <div className="flex justify-center py-6">
          {isBespokeRole(hiringRole) && !answered ? (
            <NeedsForm
              key={hiringRole.id}
              cfg={cfg}
              value={needs}
              onChange={setNeeds}
              onDone={() => setAnswered(true)}
            />
          ) : (
            <RoleNaming
              key={hiringRole.id}
              cfg={cfg}
              role={hiringRole}
              capabilities={isBespokeRole(hiringRole) ? needs.checked ?? [] : undefined}
              backLabel={isBespokeRole(hiringRole) ? "Cambiar lo que va a hacer" : undefined}
              onBack={isBespokeRole(hiringRole) ? () => setAnswered(false) : undefined}
              onDone={onHiringOutcome}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={WRAP}>
      {openRoleId && (
        <button
          onClick={() => closeInRoute(PARAM.role)}
          className="mb-2 inline-flex items-center gap-1 text-[13px] text-ink-soft transition hover:text-ink"
        >
          <ChevronLeft className="h-3.5 w-3.5" /> Tu equipo
        </button>
      )}
      <PageHeader
        title={openRole ? roleDisplayName(openRole) : "Tu equipo"}
        subtitle={
          openRole ? undefined
            : agentName
              ? `${agentName} no trabaja solo: cada uno se ocupa de lo suyo y comparten lo que saben de tu empresa.`
              : "Cada uno se ocupa de lo suyo y comparten lo que saben de tu empresa."
        }
        actions={
          <>
            {/* One clock in the whole portal: the business's. Same stamp as
                Inicio, Actividad and Entregas. */}
            {lastUpdated && (
              <span className="hidden text-xs tabular-nums text-ink-soft sm:inline">
                Actualizado {timeOf(lastUpdated.getTime())}
              </span>
            )}
            <IconBtn label="Actualizar" disabled={loading} onClick={() => { load(true); refreshConnections(); }}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </IconBtn>
          </>
        }
      />

      {err && roles !== null && (
        <p className="mb-4 inline-flex items-center rounded-lg border border-c-coral bg-c-coral/40 px-3 py-1.5 text-[12px] font-medium text-c-coral-ink">
          No pude actualizar recién ({err.message}). Te muestro lo último que tengo.
        </p>
      )}

      {body()}
    </div>
  );
}
