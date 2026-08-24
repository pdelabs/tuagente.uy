"use client";

// TEAM HIRING: the first screen for a client whose agent has a team.
//
// On a agent-of-one, onboarding is the naming: the client gives a name and a
// face to something that's already on (`lib/onboarding.tsx`, untouched). On a
// TEAM agent there's nobody to name yet: the client hires roles, and until
// they hire the first one the portal has nobody to show. Landing there and
// being asked to name "your agent" would be promising an employee nobody chose.
//
// So the first screen is hiring: you pick ONE role from the offer, name it
// the same way the single agent used to get named -- same dice, same face,
// same name field -- and it's left requested. Just one and not several: the
// first is the one that decides whether this is any good, and picking five at
// once is picking four of them badly.
//
// WITH ONE EXCEPTION, AND IT'S THE ROLE THAT DOESN'T COME PRE-WRITTEN. Trade
// roles get picked for what they do, so picking one already says everything.
// The assistant is composed of capabilities: between picking it and naming it
// there's one more question -- what do you need it to do -- the agent checks
// off whatever in the catalog looks like a match, and the client corrects it.
// Whatever stays checked travels with the request; installing it is still our
// own job, same as the role.
//
// WHAT HAPPENS NEXT ISN'T THE PORTAL'S JOB. Installing a role means putting a
// profile into the client's agent: its SOUL, its skills, its permissions, and
// restarting the gateway. We do that by hand. That's why the last step is an
// honest wait -- no progress bar, no invented percentage -- that resolves on
// its own once the role shows up hired in the roster.
//
// AND WHEN THE ROLE ARRIVES, HIRING ISN'T DONE YET. Picking and naming don't
// answer the two questions a single agent's onboarding always asks anyway:
// what the business is (which triggers the brief) and where to notify them.
// Those two get asked by a trimmed-down `Onboarding`, with no naming step --
// `layout.tsx` builds it using this same hook's `hired` state.

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, ChevronLeft, Dices, Workflow } from "lucide-react";
import {
  createRoleRequest, suggestCapabilities, getRoles,
  type Capability, type HttpError, type Manifest, type RoleRequest,
  type PortalConfig, type Role,
} from "./agent";
import {
  AgentitoAnimated, AgentitoAvatar, LOOK_DEFAULT, type AgentitoLook,
} from "./agentito";
import { capabilityCatalog, byGroup } from "./capabilities";
import { randomizeLook } from "./onboarding";
import { channelLabel } from "./labels";
import { Btn, Card, Chip, inputCls, Support, Spinner } from "./ui";

// How often to check whether the role is already there. It's the wait of
// someone who knows a person on the other end is doing this: checking every
// two seconds doesn't bring it any sooner, and the portal has nothing else to
// do meanwhile. Same order of magnitude as the other tabs' refresh (60s), a
// bit shorter because here the client is actually watching the screen.
const POLL_MS = 30_000;

/** A role's look, filled in with the default: the catalog may only bring some
 *  axes. It's the same `faceOf` used by Team and the chips. */
function faceOf(look: Record<string, number> | null | undefined): AgentitoLook {
  return { ...LOOK_DEFAULT, ...(look ?? {}) } as AgentitoLook;
}

/** Does this role already work for the client? */
export const isHired = (r: Role) => Boolean(r.hired);

/** Hired ALL THE WAY: the profile installed AND its request closed in the
 *  book. Minutes pass between the two (hire-role.sh installs, restarts the
 *  gateway, and only persists the naming at the very end), and in that window
 *  the roster says hired under the CATALOG's name: flipping early would show
 *  "Lola" to a client who named her Rita (measured in the 8/19 E2E). As long
 *  as the request stays open, the portal still treats it as on its way. */
export const isReady = (r: Role) => isHired(r) && !r.request;

/** THE REQUEST THE AGENT HAS ON RECORD, which is the only one ever shown:
 *  whatever the waiting screen says -- the name, the face -- comes from here,
 *  not from what this browser remembers having typed.
 *
 *  If there's more than one (two tabs, two roles requested), THE OLDEST WINS:
 *  it's the one the client left first and the one we're going to install
 *  first. A request with no date ends up last -- it can't be sorted and can't
 *  beat one that does know when it was made. */
function pendingRequest(roles: Role[]): Role | null {
  const when = (r: Role) => r.request?.requested_at || "9999";
  // An open request is pending even if the profile is already installed: the
  // naming persists last, and until it does the hire isn't finished. With the
  // old !isHired term, a reload mid-hire fell through to the PICKER and
  // offered a second role to a client who already chose one.
  const pending = roles.filter((r) => r.request);
  if (pending.length === 0) return null;
  return pending.slice().sort((a, b) => when(a).localeCompare(when(b)))[0];
}

/** The error, in the client's language. Same criterion as the other tabs:
 *  "Failed to fetch" is what the browser says when the agent doesn't answer,
 *  and showing it as-is is showing them our own console. */
export function describeError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes("Failed to fetch") || msg.includes("NetworkError"))
    return "No hay conexión con tu agente. Probá de nuevo en un rato.";
  return msg || "No pude dejar el pedido. Probá de nuevo.";
}

/** Flows come in by slug (`resumen-diario`), which is the machine name. The
 *  dashes get stripped and nothing more: what it says is still whatever the
 *  catalog declares, not a description we make up here. */
function flowLabel(slug: string): string {
  const t = slug.replace(/[-_]+/g, " ").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/* ── What this client gets to see ─────────────────────────────────────────── */

export type HiringState =
  | "loading"          // team agent: we don't know yet whether they've hired anyone
  | "not-applicable"   // single agent, or the roster didn't answer
  | "hiring"           // team with nobody hired or requested: time to pick the first one
  | "pending"          // already requested one and we're preparing it
  | "hired";           // already has someone: what follows is what team hiring doesn't ask

/** Hiring's precedence, in one single place.
 *
 *  The roster is the source: the browser doesn't know whether the client
 *  hired someone (they could have done it from another machine, and changing
 *  agent erases everything local).
 *
 *  IF THE ROSTER DOESN'T ANSWER, HIRING NEVER SHOWS UP -- on purpose. A client
 *  who already hired someone lands on their normal portal, which is all that
 *  matters to them. A team client who hasn't hired anyone yet lands on the
 *  portal with no hiring screen: they don't see the hiring flow, but they also
 *  don't get a single agent's naming step shoved in front of them
 *  (`layout.tsx` checks `modules.roles` for that), and the Team tab shows its
 *  own error with its own retry button. In other words: the price of a down
 *  roster is a screen that doesn't appear, never a wrong screen. That's why
 *  there are no retries here. */
export function useTeamHiring(manifest: Manifest | null, cfg: PortalConfig | null) {
  const isTeam = Boolean(manifest?.modules?.roles);
  const [roles, setRoles] = useState<Role[] | null>(null);
  const [noRoster, setNoRoster] = useState(false);
  const [hired, setHired] = useState(false);

  useEffect(() => {
    if (!isTeam || !cfg) return;
    let alive = true;
    getRoles(cfg)
      .then((r) => {
        if (!alive) return;
        if (r?.available === false) { setNoRoster(true); return; }
        setRoles(r?.roles ?? []);
      })
      .catch(() => { if (alive) setNoRoster(true); });
    return () => { alive = false; };
  }, [isTeam, cfg]);

  const list = roles ?? [];
  const state: HiringState = !isTeam || noRoster
    ? "not-applicable"
    : hired
      ? "hired"
      : roles === null
        ? "loading"
        : list.some(isReady)
          ? "hired"
          : pendingRequest(list)
            ? "pending"
            : "hiring";

  // Who the portal talks to as soon as they've hired someone: the teammate
  // who just came on, with the name and the face the client gave them. It's
  // who asks the remaining questions.
  const first = list.find(isReady) ?? null;
  const team = first
    ? { name: first.name || first.label, look: faceOf(first.look) }
    : null;

  return {
    state,
    roles: list,
    team,
    /** The role arrived: pass the fresh roster because the one this hook holds
     *  is from the first load, from back when nobody had been hired yet. */
    markHired: (fresh?: Role[]) => {
      if (fresh) setRoles(fresh);
      setHired(true);
    },
  };
}

/* ── The screens ──────────────────────────────────────────────────────────── */

function RoleCard({ role, onPick }: { role: Role; onPick: () => void }) {
  return (
    // The button sits OUTSIDE the Card, same as in Team: `Card` is
    // presentational and half the portal uses it.
    <button onClick={onPick} className="block w-full text-left">
      <Card className="flex gap-4 p-4 transition hover:border-primary/40">
        <AgentitoAvatar look={faceOf(role.look)} className="h-14 w-14 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold text-ink">{role.name || role.label}</p>
          <p className="mt-1.5 text-[14px] leading-snug text-ink-soft">{role.does}</p>
          {!!role.flows?.length && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Workflow className="h-3.5 w-3.5 shrink-0 text-ink-soft" />
              {role.flows.map((slug) => (
                <Chip key={slug}>{flowLabel(slug)}</Chip>
              ))}
            </div>
          )}
          {role.never && (
            // The hard limit is part of the offer, not fine print: it's the
            // exact same sentence that lives in the role's SOUL.
            <p className="mt-2 text-[13px] text-ink-soft">
              <span className="font-medium text-ink">Nunca:</span> {role.never}
            </p>
          )}
          {!!role.needs?.length && (
            // WHAT IT'S MISSING, BEFORE PICKING IT. On Team this is read in
            // passing; here it's the decision: hiring the one that needs the
            // WhatsApp we haven't connected yet means starting to wait on two
            // things at once. The ids travel raw (`whatsapp`) and the portal
            // has a single dictionary that turns them into names -- the same
            // one Team, Activity and Connections use.
            <p className="mt-2 text-[13px] text-ink-soft">
              Necesita {role.needs.map(channelLabel).join(", ")} para empezar.
            </p>
          )}
        </div>
      </Card>
    </button>
  );
}

/* ── The role built out of what the client needs ─────────────────────────── */

/** THE ONLY ROLE THAT DOESN'T COME PRE-WRITTEN. The others are sold by what
 *  they do -- answering, selling, invoicing -- and the client picks them for
 *  that. This one is composed of capabilities, so before naming it we need to
 *  know what they want it for: without that question, what arrives is "an
 *  assistant" and nobody knows what to give it.
 *
 *  The id comes from the agent's own role catalog, not a category the portal
 *  makes up: if that role isn't in the offer, this step doesn't exist for
 *  anyone. */
const BESPOKE_ROLE_ID = "asistente";
export const isBespokeRole = (r: Role) => r.id === BESPOKE_ROLE_ID;

/** What the client told us and what stayed checked.
 *
 *  Lives OUTSIDE the screen -- hiring holds it -- so going back from naming
 *  doesn't erase what they wrote or spend another question on the model.
 *  `checked: null` means "haven't asked yet"; a list, even an empty one,
 *  means "already chose". */
export type WhatItNeeds = {
  text: string;
  checked: string[] | null;
  /** Couldn't ask: the agent has nothing to call the model with. Travels with
   *  the rest because they're two different messages and the screen says them
   *  differently -- "we couldn't read what you wrote" isn't the same as "we
   *  asked and none of this was on the list". */
  noMatch?: boolean;
};
export const NOT_COUNTED: WhatItNeeds = { text: "", checked: null };

/** How much text it takes for asking to be worth it: the same minimum the
 *  adapter validates. With "hi" the model answers with whatever, and a made-up
 *  suggestion is worse than no suggestion at all. */
const MIN_TEXT = 10;

/** "What do you need it to do?" -- the step that turns the client's own
 *  sentence into catalog capabilities.
 *
 *  TWO SCREENS AND A SINGLE CALL TO THE MODEL: first they tell it in their own
 *  words, and with that the agent checks off whatever in the menu looks like
 *  a match. What's checked is always editable -- this suggests, it doesn't
 *  decide, and the client is the one who knows what they run on.
 *
 *  WHAT STAYS CHECKED TURNS NOTHING ON. It travels with the request so
 *  whoever sets it up knows what to give it; installing it is our own job,
 *  same as the role. That's said on the screen, not here: promising it turns
 *  on by itself is the kind of thing a client discovers on Monday. */
export function NeedsForm({ cfg, value, onChange, onDone, onBack, backLabel }: {
  cfg: PortalConfig;
  value: WhatItNeeds;
  onChange: (v: WhatItNeeds) => void;
  onDone: () => void;
  onBack?: () => void;
  backLabel?: string;
}) {
  const [menu, setMenu] = useState<Capability[] | null>(null);
  const [thinking, setThinking] = useState(false);

  const onDoneRef = useRef(onDone);
  useEffect(() => { onDoneRef.current = onDone; });

  useEffect(() => {
    let alive = true;
    // The catalog is cached per tab by `lib/capabilities`: coming back from
    // naming doesn't request it again.
    capabilityCatalog().then((cs) => {
      if (!alive) return;
      // `base` isn't chosen: it comes turned on for every agent. Same rule as
      // a teammate's profile, and the adapter applies it on its own side.
      const available = cs.filter((c) => c.level !== "base");
      // With no catalog there's nothing to ask, and a question with no
      // possible answers is a stuck screen: hiring goes straight to naming.
      if (available.length === 0) { onDoneRef.current(); return; }
      setMenu(available);
    });
    return () => { alive = false; };
  }, []);

  const cleaned = value.text.replace(/\s+/g, " ").trim();
  const ask = async () => {
    if (cleaned.length < MIN_TEXT || thinking) return;
    setThinking(true);
    // AN ERROR HERE CAN'T CUT HIRING SHORT. The suggestion is a help: if the
    // agent can't ask the model, or doesn't answer, the client picks from the
    // whole list -- which is what they'd be able to do anyway.
    const r = await suggestCapabilities(cfg, cleaned).catch(() => null);
    onChange({
      text: cleaned,
      checked: r?.suggested ?? [],
      noMatch: !r || r.no_match === true,
    });
    setThinking(false);
  };

  const toggle = (id: string) => {
    const checked = value.checked ?? [];
    onChange({
      ...value,
      checked: checked.includes(id)
        ? checked.filter((x) => x !== id)
        : [...checked, id],
    });
  };

  /* First screen -- tell it in their own words. */
  if (value.checked === null) {
    return (
      <div className="flex w-full max-w-2xl flex-col items-center text-center">
        <div className="mb-7 animate-fadeup">
          <h1 className="text-[30px] font-extrabold leading-tight tracking-tight text-ink sm:text-[38px]">
            ¿Qué necesitás que haga?
          </h1>
          <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-ink-soft">
            Contalo como se lo contarías a alguien que entra a trabajar el lunes.
            Con eso te marcamos lo que sabemos hacer, y vos sacás y agregás.
          </p>
        </div>

        <textarea
          autoFocus
          rows={6}
          maxLength={600}
          value={value.text}
          onChange={(e) => onChange({ ...value, text: e.target.value })}
          aria-label="Qué necesitás que haga"
          placeholder={"Por ejemplo:\n\nQue me arme los presupuestos y me lleve la agenda de los turnos.\n\nQue cargue las facturas de los proveedores en una planilla y me avise lo que vence.\n\nQue conteste las preguntas de siempre y me pase lo que no sabe."}
          className={`${inputCls} min-h-[11rem] resize-none text-left text-[15px] leading-relaxed`}
        />

        <div className="mt-7 flex flex-col items-center gap-3">
          <Btn disabled={cleaned.length < MIN_TEXT || thinking} onClick={ask}>
            {thinking ? "Leyendo lo que escribiste…" : "Seguir"}
            {!thinking && <ArrowRight className="h-4 w-4" />}
          </Btn>
          {onBack && (
            <button
              onClick={onBack}
              className="inline-flex items-center gap-1 text-[13px] font-semibold text-ink-soft underline-offset-4 transition hover:text-ink hover:underline"
            >
              <ChevronLeft className="h-3.5 w-3.5" /> {backLabel ?? "Volver"}
            </button>
          )}
        </div>
      </div>
    );
  }

  /* Second screen -- the menu, with what we understood checked off. */
  if (!menu) {
    return <Spinner />;
  }

  const checked = value.checked;
  const notice = value.noMatch
    ? "No pudimos leer lo que escribiste, así que no marcamos nada: elegilo vos de la lista."
    : checked.length === 0
      ? "No encontramos nada de esta lista que sea lo que pediste. Mirala igual, y si lo que necesitás no está, escribinos."
      : "Esto es lo que entendimos. Sacá lo que no va y sumá lo que falte: lo decidís vos.";

  return (
    <div className="flex w-full max-w-2xl flex-col">
      <div className="animate-fadeup text-center">
        <h1 className="text-[30px] font-extrabold leading-tight tracking-tight text-ink sm:text-[38px]">
          Lo que va a hacer
        </h1>
        <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-ink-soft">
          {notice}
        </p>
      </div>

      {/* THE CURATED MODEL'S TRUTH, BEFORE THE LIST AND NOT IN FINE PRINT:
          checking doesn't turn it on. We're the ones who set each one up, and
          the client has to know that before picking ten. */}
      <p className="mx-auto mt-4 max-w-md text-center text-[13px] leading-snug text-ink-soft">
        Marcar no lo prende: queda anotado con el pedido y lo preparamos nosotros
        junto con el resto.
      </p>

      <div className="mt-6 flex flex-col gap-4">
        {byGroup(menu).map(({ group, label, capabilities }) => (
          <div key={group}>
            <h3 className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
              {label}
            </h3>
            <div className="flex flex-col gap-2">
              {capabilities.map((c) => (
                <label
                  key={c.id}
                  className={`flex cursor-pointer items-start gap-2.5 rounded-xl border bg-white p-3.5 text-left transition ${
                    checked.includes(c.id)
                      ? "border-primary/40 bg-primary/[0.03]"
                      : "border-black/[0.07] hover:border-primary/30"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked.includes(c.id)}
                    onChange={() => toggle(c.id)}
                    className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-primary"
                  />
                  <span className="min-w-0">
                    <span className="block text-[14px] font-medium text-ink">{c.label}</span>
                    {c.purpose && (
                      <span className="mt-0.5 block text-[13px] leading-snug text-ink-soft">
                        {c.purpose}
                      </span>
                    )}
                  </span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-8 flex flex-col items-center gap-3">
        <Btn onClick={onDone}>
          {checked.length === 0
            ? "Seguir sin marcar nada"
            : `Seguir con ${checked.length} ${checked.length === 1 ? "elegida" : "elegidas"}`}
          <ArrowRight className="h-4 w-4" />
        </Btn>
        <button
          onClick={() => onChange({ ...value, checked: null })}
          className="inline-flex items-center gap-1 text-[13px] font-semibold text-ink-soft underline-offset-4 transition hover:text-ink hover:underline"
        >
          <ChevronLeft className="h-3.5 w-3.5" /> Contarlo de nuevo
        </button>
      </div>
    </div>
  );
}

/* ── Naming a role ────────────────────────────────────────────────────────── */

/** How the naming step ended. These are the two possible endings and neither
 *  is a client error: either the agent has the request on record -- the one
 *  that just got created, or the one it already had -- or the role is already
 *  working and there's nothing to wait for. */
export type RoleHiringOutcome =
  | {
      kind: "requested";
      /** The role the request ended up being for, which is NOT always the one
       *  that got named: on a 409 another one the client had requested before
       *  can win instead. */
      role: Role;
      request: RoleRequest | null;
      /** Name and look already reconciled with what the agent answered. */
      name: string;
      look: AgentitoLook;
    }
  | { kind: "hired"; roles: Role[] };

/** What's shown comes from the response, not from what was typed: the adapter
 *  passes the name through the same sanitizing as the agent's own naming
 *  (it ends up in a SOUL block), so it can come back trimmed. If the request
 *  carries no name or look, whatever the client picked stays. */
function whatTheAgentRecorded(
  role: Role, request: RoleRequest | null | undefined, name: string, look: AgentitoLook,
): RoleHiringOutcome {
  return {
    kind: "requested",
    role,
    request: request ?? null,
    name: request?.name || name,
    look: request?.look ? faceOf(request.look) : look,
  };
}

/** NAMING A ROLE, ONCE IN THE WHOLE PORTAL. Used by the two moments a client
 *  adds someone: hiring (their first teammate, full screen) and the Team tab
 *  (everyone they add afterward). It's the same screen because it's the same
 *  moment -- you pick what it's going to be called and what face what you're
 *  adding has -- and having it twice was a guarantee that one day they'd say
 *  different things.
 *
 *  Handles the whole request, including the 409: whoever uses it only gets
 *  how it ended (`RoleHiringOutcome`) and decides what to do with that. The
 *  dice change ITS look, not the page, and the name is the only thing left to
 *  decide. */
export function RoleNaming({ cfg, role, capabilities, onDone, onBack, backLabel }: {
  cfg: PortalConfig;
  role: Role;
  /** What the client checked in `NeedsForm`, when the role asks for it.
   *  Travels with the request and nothing more: whoever passes nothing (the
   *  Team tab) requests exactly what it requested before. */
  capabilities?: string[];
  onDone: (r: RoleHiringOutcome) => void;
  /** Without this the exit at the bottom isn't drawn: on Team the back button
   *  already sits above, and two "back"s on the same screen is one too many. */
  onBack?: () => void;
  backLabel?: string;
}) {
  // The catalog already carries a name and a face: naming starts with theirs
  // already set, and changing them is optional. A blank screen turns "pick a
  // role" into "invent a character".
  const [name, setName] = useState(role.name || role.label);
  const [look, setLook] = useState<AgentitoLook>(() => faceOf(role.look));
  const [requesting, setRequesting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const request = async () => {
    const cleaned = name.trim();
    if (!cleaned || requesting) return;
    setRequesting(true);
    setErr(null);
    try {
      const d = await createRoleRequest(cfg, role.id, cleaned, look, capabilities);
      onDone(whatTheAgentRecorded(role, d?.request, cleaned, look));
    } catch (e) {
      const h = e as HttpError;
      // A 409 is two different things and neither is a client error: either
      // they'd already requested it (two tabs, or they came back in), or we
      // installed it while they were naming it. The roster answers which one,
      // not the text.
      if (h?.status === 409) {
        const r = await getRoles(cfg).catch(() => null);
        const fresh = r?.roles ?? [];
        if (fresh.some(isReady)) { onDone({ kind: "hired", roles: fresh }); return; }
        // Whichever request already existed wins: it could be this same role
        // requested in another tab, or a completely different one. It returns
        // whatever the agent has on record, not whatever this browser just
        // tried.
        const p = pendingRequest(fresh);
        onDone(p
          ? whatTheAgentRecorded(p, p.request, cleaned, look)
          : whatTheAgentRecorded(role, null, cleaned, look));
        return;
      }
      setErr(describeError(e));
    } finally {
      setRequesting(false);
    }
  };

  return (
    <div className="flex w-full max-w-2xl flex-col items-center text-center">
      <div className="mb-8 animate-fadeup">
        <h1 className="text-[30px] font-extrabold leading-tight tracking-tight text-ink sm:text-[38px]">
          Ponele nombre
        </h1>
        <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-ink-soft">
          Así lo vas a ver acá adentro: al lado de cada cosa que haga, y
          cuando te conteste en el chat.
        </p>
      </div>

      <div className="relative h-40 w-40">
        {/* No celebration: the agent's own naming fires it and stays to watch,
            but here the next screen is the wait and the character unmounts on
            the same tick. A counter nobody's watching is a promised animation
            that never happens. */}
        <AgentitoAnimated celebrations={0} look={look} state="normal" className="h-full w-full" />
        <button
          onClick={() => setLook(randomizeLook(look))}
          title="Otro look"
          aria-label="Otro look"
          className="absolute -bottom-1 -right-1 flex h-10 w-10 items-center justify-center rounded-full border border-black/10 bg-white transition hover:scale-105 hover:bg-black/[0.03] active:scale-95"
        >
          <Dices className="h-[18px] w-[18px] text-ink" />
        </button>
      </div>

      <input
        autoFocus
        value={name}
        maxLength={24}
        onChange={(e) => { setName(e.target.value); setErr(null); }}
        onKeyDown={(e) => { if (e.key === "Enter") request(); }}
        placeholder={role.label}
        aria-label={`Nombre para tu ${role.label}`}
        className="mt-7 w-[8em] max-w-[80vw] border-b-[3px] border-black/15 bg-transparent text-center text-[32px] font-extrabold tracking-tight text-primary outline-none transition placeholder:font-extrabold placeholder:text-ink-soft/35 focus:border-primary sm:text-[38px]"
      />
      {/* The role stays visible even if the name changes: "Vera" on its own
          doesn't say what Vera does. */}
      <p className="mt-3 text-[14px] font-medium text-ink-soft">{role.label}</p>
      <p className="mx-auto mt-1.5 max-w-md text-[13px] leading-relaxed text-ink-soft">
        {role.does}
      </p>

      {err && <p className="mt-4 text-[13px] text-c-coral-ink">{err}</p>}

      <div className="mt-8 flex flex-col items-center gap-3">
        <Btn disabled={!name.trim() || requesting} onClick={request}>
          {requesting ? "Pidiéndolo…" : "Sumarlo a mi equipo"}
          {!requesting && <ArrowRight className="h-4 w-4" />}
        </Btn>
        {onBack && (
          <button
            onClick={() => { setErr(null); onBack(); }}
            className="inline-flex items-center gap-1 text-[13px] font-semibold text-ink-soft underline-offset-4 transition hover:text-ink hover:underline"
          >
            <ChevronLeft className="h-3.5 w-3.5" /> {backLabel ?? "Volver"}
          </button>
        )}
      </div>
    </div>
  );
}

/* ── The hiring screens ───────────────────────────────────────────────────── */

export default function TeamHiring({ cfg, roles, onHired }: {
  cfg: PortalConfig;
  roles: Role[];
  onHired: (roles: Role[]) => void;
}) {
  // If there's already a request in flight, the client lands straight on the
  // wait screen: they don't get the catalog they picked from offered again,
  // which would mean requesting the same thing twice. And with the name and
  // face THE AGENT RECORDED, not whatever this browser remembers: the request
  // could have been left from another machine.
  const pending = pendingRequest(roles);
  const [chosen, setChosen] = useState<Role | null>(pending);
  const [step, setStep] = useState<"choosing" | "needs" | "naming" | "pending">(
    pending ? "pending" : "choosing");
  // What the client told and checked, if the role they picked asks for it.
  // Lives here and not inside the screen so going to naming and back doesn't
  // erase it.
  const [needs, setNeeds] = useState<WhatItNeeds>(NOT_COUNTED);
  const [name, setName] = useState(pending?.request?.name ?? "");
  const [look, setLook] = useState<AgentitoLook>(
    () => faceOf(pending?.request?.look ?? pending?.look));

  /** Show what the AGENT has on record. Called with whatever request the
   *  adapter answered -- when creating it, when finding it again on a 409, or
   *  on every poll of the wait -- and it never makes anything up: if the
   *  request carries no name or look, whatever's already on screen stays. */
  const show = useCallback((role: Role, request?: RoleRequest | null) => {
    setChosen(role);
    if (request?.name) setName(request.name);
    if (request?.look) setLook(faceOf(request.look));
  }, []);

  // The "it's here" callback has to survive re-renders: if the effect
  // depended on the callback exactly as it arrives (a new arrow every
  // render), the interval would reset before it ever fired and would never
  // actually check.
  const onHiredRef = useRef(onHired);
  useEffect(() => { onHiredRef.current = onHired; });

  useEffect(() => {
    if (step !== "pending") return;
    let alive = true;
    const check = () => {
      getRoles(cfg)
        .then((r) => {
          if (!alive) return;
          const fresh = r?.roles ?? [];
          if (fresh.some(isReady)) { onHiredRef.current(fresh); return; }
          // Still not there: keep showing the request exactly as the agent
          // has it. If someone cancelled it or an older one takes precedence,
          // the screen corrects itself.
          const p = pendingRequest(fresh);
          if (p) show(p, p.request);
        })
        .catch(() => { /* the agent could be restarting for exactly this reason */ });
    };
    // The first check happens right away, not at 30 seconds: the role could
    // have arrived while the client had the tab closed, and landing on "it's
    // on its way" when it's actually been ready for a while makes them wait
    // for nothing.
    check();
    const t = setInterval(check, POLL_MS);
    return () => { alive = false; clearInterval(t); };
  }, [step, cfg, show]);

  const choose = (role: Role) => {
    setChosen(role);
    // The bespoke role asks before naming: without that, what arrives is "an
    // assistant" and nobody knows what to give it. The rest go straight to
    // naming, exactly like today.
    if (isBespokeRole(role)) {
      setNeeds(NOT_COUNTED);
      setStep("needs");
      return;
    }
    setStep("naming");
  };

  // ONLY THE ONES THAT CAN BE REQUESTED. `state` comes exactly as the catalog
  // has it and the adapter doesn't fill it in: a role with no `state`, or
  // still a draft, answers 404 to the request. Offering something that can't
  // be requested is offering the client an error after they've already picked
  // and named it.
  const offered = roles.filter((r) => r.state === "ready" && !isHired(r));

  /* Step 1 -- pick. */
  if (step === "choosing") {
    return (
      <main className="app-shell min-h-screen bg-surface px-6 py-12">
        <div className="mx-auto flex w-full max-w-2xl flex-col">
          <div className="animate-fadeup text-center">
            <h1 className="text-[30px] font-extrabold leading-tight tracking-tight text-ink sm:text-[38px]">
              Elegí tu primer rol
            </h1>
            <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-ink-soft">
              Cada uno se ocupa de una sola cosa y la hace todos los días.
              Empezá por el que más te aprieta hoy; los demás los sumás cuando
              quieras.
            </p>
          </div>

          {offered.length === 0 ? (
            <Card className="mt-8 p-5 text-center">
              <p className="text-[14px] leading-relaxed text-ink-soft">
                Todavía no hay ningún rol para sumar a tu equipo. Escribinos y lo
                vemos con vos.
              </p>
              <div className="mt-3 flex justify-center"><Support /></div>
            </Card>
          ) : (
            <div className="mt-8 flex flex-col gap-2">
              {offered.map((role) => (
                <RoleCard key={role.id} role={role} onPick={() => choose(role)} />
              ))}
            </div>
          )}

          <div className="mt-6 text-center">
            <Support label="¿No sabés cuál te sirve? Escribinos" />
          </div>
        </div>
      </main>
    );
  }

  /* Step 2 (bespoke role only) -- what it needs to do. */
  if (step === "needs" && chosen) {
    return (
      <main className="app-shell flex min-h-screen items-center justify-center bg-surface px-6 py-12">
        <NeedsForm
          key={chosen.id}
          cfg={cfg}
          value={needs}
          onChange={setNeeds}
          backLabel="Ver los otros roles"
          onBack={() => setStep("choosing")}
          onDone={() => setStep("naming")}
        />
      </main>
    );
  }

  /* Step 3 -- name it. The same screen the Team tab gives every role added
     afterward: it lives in `RoleNaming`, above. */
  if (step === "naming" && chosen) {
    const bespoke = isBespokeRole(chosen);
    return (
      <main className="app-shell flex min-h-screen items-center justify-center bg-surface px-6 py-12">
        <RoleNaming
          key={chosen.id}
          cfg={cfg}
          role={chosen}
          capabilities={bespoke ? needs.checked ?? [] : undefined}
          backLabel={bespoke ? "Cambiar lo que va a hacer" : "Ver los otros roles"}
          onBack={() => setStep(bespoke ? "needs" : "choosing")}
          onDone={(r) => {
            // The role was already installed (the "you already have it" 409):
            // nothing left to wait for.
            if (r.kind === "hired") { onHired(r.roles); return; }
            // What the wait screen shows is what the AGENT recorded -- the
            // request that just landed, or the one it already had -- never
            // whatever was typed here.
            setChosen(r.role);
            setName(r.name);
            setLook(r.look);
            setStep("pending");
          }}
        />
      </main>
    );
  }

  /* Step 4 -- the wait. No progress bar, no percentage: there's a person on
     the other side preparing it, and a made-up number only serves to let the
     client discover we lied to them when it stops moving. */
  // This screen's name has already passed through the agent: `show` set it
  // from whatever the adapter answered when creating the request, from what
  // the roster brings on entry, or from whatever showed up on a 409's
  // comeback. What follows is the last resort for an adapter that doesn't
  // return the request.
  const displayName = name.trim() || chosen?.request?.name || chosen?.label || "Tu compañero";
  return (
    <main className="app-shell flex min-h-screen items-center justify-center bg-surface px-6 py-12">
      <div className="flex w-full max-w-xl flex-col items-center text-center">
        <AgentitoAvatar look={look} alive className="h-32 w-32" />
        <h1 className="mt-6 animate-fadeup text-[28px] font-extrabold leading-tight tracking-tight text-ink sm:text-[34px]">
          «{displayName}» está en camino
        </h1>
        {chosen && (
          <p className="mt-2 text-[14px] font-medium text-ink-soft">{chosen.label}</p>
        )}
        <p className="mx-auto mt-4 max-w-md text-[15px] leading-relaxed text-ink-soft">
          Lo prepara alguien de tuagente: hay que darle su lugar en tu agente,
          sus permisos y lo que necesita para arrancar. No es automático y no lo
          podés apurar desde acá.
        </p>
        <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-ink-soft">
          No tenés que hacer nada. Cuando esté, esta pantalla se abre sola en tu
          portal; y si cerrás, te lo vas a encontrar la próxima vez que entres.
        </p>
        {chosen && (
          <Card className="mt-7 w-full p-4 text-left">
            <p className="text-[13px] font-semibold text-ink">Lo que le pediste</p>
            <p className="mt-1.5 text-[14px] leading-snug text-ink-soft">{chosen.does}</p>
            {!!chosen.flows?.length && (
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                <Workflow className="h-3.5 w-3.5 shrink-0 text-ink-soft" />
                {chosen.flows.map((slug) => (
                  <Chip key={slug}>{flowLabel(slug)}</Chip>
                ))}
              </div>
            )}
          </Card>
        )}
        <Support className="mt-6" label="¿Alguna duda mientras tanto? Escribinos" />
      </div>
    </main>
  );
}
