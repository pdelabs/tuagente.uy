"use client";

// The portal's only network entry point. Magic-link config:
//   /app#endpoint=https://...&adapter=https://...&key=...
// Local defaults for developing against the fixture agent.

import { setUtcOffset, hasLearnedOffset, utcOffsetOf, utcOffsetForZone } from "./labels";

export type PortalConfig = {
  endpoint: string; // the agent's api server (:8642)
  adapter: string;  // adapter sidecar (:8643)
  key: string;
};

export type Manifest = {
  agent: string;
  /** Which adapter is answering, as `adapter-<semver>`. Called
   *  `portal_plugin` up to adapter 0.40.0, from when this sidecar was going
   *  to be a Hermes plugin and never became one; the word now means the
   *  kit's plugins (`/portal/plugins`), so the field says what it holds. */
  adapter_version: string;
  modules: Record<string, boolean>;
  /** Look the client chose for it, saved on the agent (adapter 0.26+).
   *  Absent on older adapters: the portal falls back to whatever the browser has. */
  look?: Record<string, number> | null;
  /** true if the client has ever named it from the portal. */
  named?: boolean;
  /** What the client's BUSINESS is called, as they wrote it at onboarding
   *  (adapter 0.32+). The agent has always sent it; the portal only started
   *  reading it when Posts needed an account name to sign the feed with. */
  company?: string | null;
  /** Where the agent notifies: `email` or `none` -- whatever the
   *  client answered at onboarding. Absent on older adapters and on anyone who
   *  never got around to answering; `"none"` is an explicit answer ("not right
   *  now") and it's the one that makes the portal offer it again. */
  notify_channel?: string | null;
  /** The channels this agent can actually notify through, today `[]` or
   *  `["email"]`. It's what onboarding offers: a channel the agent can't send
   *  through isn't an option, it's a promise nobody keeps. Email goes out from
   *  our domain, so it only needs the client's address -- not the company's
   *  inbox connected. Absent reads as empty. */
  notify_channels?: string[];
  /** WHAT CLOCK THE BUSINESS LIVES ON. DOES NOT EXIST YET: it's item 4 of
   *  `docs/PENDING.md` ("The agent's declared timezone"), declared here so
   *  that the day the adapter publishes it the portal can use it without
   *  touching anything else. Either shape is accepted: the IANA zone
   *  (`"America/Montevideo"` -- the good datum, it knows about daylight
   *  saving) or the offset in minutes. Until it arrives, the portal infers it
   *  from whichever dates DO carry an offset -- see `learnAgentUtcOffset`. */
  timezone?: string | null;
  utc_offset?: number | null;
};

/** The offset the manifest declares, if it declares one. It beats the
 *  inferred value: it's the agent saying where it lives, not us guessing. */
export function utcOffsetFromManifest(m: Manifest | null | undefined): number | null {
  if (!m) return null;
  const byZone = utcOffsetForZone(m.timezone);
  if (byZone !== null) return byZone;
  const raw = m.utc_offset;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) && Math.abs(n) <= 900 ? n : null;
}

export type Ticket = {
  id: string;
  title: string;
  body: string | null;
  status: string;
  tenant: string | null;
  /** Who holds this task, as the kanban records it. NOTHING IN THE PORTAL
   *  DRAWS IT TODAY: the chip that did belonged to the team tab. The field is
   *  described here because the adapter still sends it, not because it is
   *  read — whoever removes it there removes this line too. */
  assignee: string | null;
  created_at: string | number; // Hermes emits it as an epoch in seconds
  /** When something last happened on it. The Board sorts by `created_at` — a
   *  task is what it was opened for — and the Inbox by this one: a
   *  conversation is read by when the last thing was said on it. */
  updated_at?: string | number | null;
  /** Where the ticket came from: `client` (she opened it from the portal),
   *  `agent`, or the plugin that brought it in (`mail`, `instagram`,
   *  `instagram-dm`). */
  source?: string | null;
  /** That plugin's own key for it — the message id, the comment id, the
   *  conversation id. With `source` it is the board's dedupe. */
  source_ref?: string | null;
};

/** The sources that are a CONVERSATION: somebody wrote in and is waiting for
 *  an answer. Those tickets live in the Inbox (`app/app/inbox/`) and the Board
 *  keeps the rest — one ticket, one screen, never both.
 *
 *  The engine has the same list (`board_store.CHANNELS`) and it is the one
 *  that filters: the portal asks for `?source=channels` or `?source=work` and
 *  never sends the names. This copy answers a different question — "is THIS
 *  ticket, already in my hands, a conversation?" — which is what the board's
 *  detail needs to send the client to the right screen. */
export const CHANNEL_SOURCES = ["mail", "instagram", "instagram-dm"];

/** Is this ticket a conversation with someone outside the company? */
export const isChannelTicket = (t: { source?: string | null } | null | undefined) =>
  CHANNEL_SOURCES.includes((t?.source ?? "").trim().toLowerCase());

const DEFAULTS = { endpoint: "http://localhost:8642", adapter: "http://localhost:8643" };
export const CONFIG_KEY = "tuagente_portal_config";
const KEY = CONFIG_KEY;
// Everything the portal stores about ONE agent goes under this prefix: the
// credential, the name the client gave it, its look, which welcome screens
// were seen, the chat pins. NOTHING under here can
// survive a change of agent.
const PREFIX = "tuagente_";

/** Same agent, same key? The WHOLE credential is the identity: two different
 *  clients share nothing in the browser, and the same client with a rotated
 *  key doesn't drag along any cache either (the name and the look come back
 *  from the manifest, which is where they really live). */
export function sameSession(
  a: Partial<PortalConfig> | null | undefined,
  b: Partial<PortalConfig> | null | undefined,
): boolean {
  return Boolean(a && b && a.endpoint === b.endpoint && a.adapter === b.adapter && a.key === b.key);
}

/** The credential this browser has stored. READS ONLY: it doesn't write it,
 *  doesn't look at the hash and doesn't erase anything. */
export function savedConfig(): PortalConfig | null {
  if (typeof window === "undefined") return null;
  try {
    const c = JSON.parse(localStorage.getItem(KEY) || "null");
    return c?.key ? (c as PortalConfig) : null;
  } catch {
    return null;
  }
}

/** Erases EVERYTHING this browser knows about the agent. Used on logout and
 *  when entering with someone else's link.
 *
 *  Goes by prefix and not by a list of keys on purpose: a list drifts out of
 *  date on its own -- the module that starts caching something forgets to add
 *  itself -- and the cost of forgetting is showing one client another
 *  client's things. This was exactly the 8/12 bug: `clearConfig` erased the
 *  credential but left the previous agent's name, look and welcome screens,
 *  so an accounting firm's portal introduced itself with a vet clinic's name
 *  -- and since the welcome screen was marked seen, it never asked for its
 *  name. */
export function forgetAgent() {
  if (typeof window === "undefined") return;
  try {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith(PREFIX)) localStorage.removeItem(k);
    }
  } catch {
    /* private mode */
  }
}

/** The credential carried in the URL hash, READ and nothing else: it doesn't
 *  save, doesn't erase, doesn't forget the previous agent. That's
 *  `loadConfig`'s job.
 *
 *  It exists on its own because the layout needs to notice a fresh magic link
 *  was pasted in without reloading the page, and for that it has to be able
 *  to look at the hash without side effects. It's the SAME read `loadConfig`
 *  does -- a single one -- so the two never drift apart. */
export function credentialInUrl(): Partial<PortalConfig> | null {
  if (typeof window === "undefined") return null;
  const h = window.location.hash;
  const get = (k: string) => h.match(new RegExp(`${k}=([^&]+)`))?.[1];
  if (!get("key")) return null;
  return {
    endpoint: get("endpoint") ? decodeURIComponent(get("endpoint")!) : undefined,
    adapter: get("adapter") ? decodeURIComponent(get("adapter")!) : undefined,
    key: get("key"),
  };
}

export function loadConfig(): PortalConfig | null {
  if (typeof window === "undefined") return null;
  const fromHash = credentialInUrl() ?? {};
  const stored = savedConfig();
  const cfg = {
    endpoint: fromHash.endpoint || stored?.endpoint || DEFAULTS.endpoint,
    adapter: fromHash.adapter || stored?.adapter || DEFAULTS.adapter,
    key: fromHash.key || stored?.key,
  };
  if (!cfg.key) return null;
  // The agent changed: the previous one's stuff leaves ENTIRELY before the new
  // one gets saved.
  if (stored && !sameSession(stored, cfg)) forgetAgent();
  localStorage.setItem(KEY, JSON.stringify(cfg));
  return cfg as PortalConfig;
}

/** Log out: dropping the credential isn't enough. The name, the face and the
 *  welcome screens belong to the client who's leaving. */
export function clearConfig() {
  forgetAgent();
}

// Runs ONCE, when the portal's JS loads, not inside an effect: the layout
// reads the name and the look from the browser in ITS OWN effects, which run
// before the first `loadConfig()`. Syncing here -- before the first render --
// means that when the client enters with a different link, the previous
// agent's stuff is already gone by the time anything tries to read it.
if (typeof window !== "undefined") loadConfig();

function headers(cfg: PortalConfig): HeadersInit {
  return { Authorization: `Bearer ${cfg.key}` };
}

/** A network error with the status handy: modules tell a 404 apart from an outage. */
export type HttpError = Error & { status?: number };
function httpError(status: number, path: string, detail?: string): HttpError {
  const e: HttpError = new Error(detail || `${status} at ${path}`);
  e.status = status;
  return e;
}

/** The adapter explains its 400s/409s in `{error}`: that text is worth more
 *  than the number. */
async function failure(res: Response, path: string): Promise<HttpError> {
  let detail = "";
  try {
    const body = await res.json();
    if (typeof body?.error === "string") detail = body.error;
  } catch { /* no JSON body */ }
  return httpError(res.status, path, detail);
}

/* ── What clock the business lives on ────────────────────────────────────────
   The portal shows EVERY date in the agent's timezone, not the viewer's (see
   the long note in `lib/labels.ts`). That offset is inferred from whichever
   dates DO carry one... and until now only three of eleven screens learned
   it: Home, Activity and Tasks. The other eight CONSUME it, and with nothing
   saved they fell back to the browser's clock without saying so. Measured on
   8/13 with the browser at -06: clearing `tuagente_utc_offset` and going
   straight to /app/pipeline, the timestamp read "Updated 10:51"; going
   through Home first, "Updated 13:52". Same agent, same minute, two clocks.

   You get there by two real paths: a client's first day, and any failure of
   Home's fetch. So learning it stops being the screens' job and becomes this
   module's, since this is where EVERY response from the agent passes through:
   any date with an offset that arrives on any endpoint teaches it, no matter
   which tab the client came in through.
   ─────────────────────────────────────────────────────────────────────────── */

// ONLY THESE KEYS. It would be enough to sweep the whole JSON body looking for
// anything that looks like a date, but then the portal's clock could be set
// by the TEXT of a ticket (bodies are markdown the model writes, and a date
// with an offset inside a table doesn't say where the business lives). These
// are the ones the engine and the adapter write: `ts` in /portal/activity,
// `next_run_at` and `last_run_at` in /api/jobs, `claimed_at`/`started_at`/
// `finished_at` in a cron's runs, `at` in a flow's last run.
const OFFSET_KEYS = new Set([
  "ts", "next_run_at", "last_run_at", "paused_at", "claimed_at",
  "started_at", "finished_at", "created_at", "updated_at", "at",
]);

/** The first offset a response from the agent carries, or null. Budgeted:
 *  `/api/sessions` and `/portal/tickets` are long lists and this runs on
 *  every response. */
function utcOffsetInResponse(value: unknown, budget = { nodes: 3000 }): number | null {
  if (budget.nodes-- <= 0 || value === null || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const v of value) {
      const o = utcOffsetInResponse(v, budget);
      if (o !== null) return o;
    }
    return null;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "string" && OFFSET_KEYS.has(k)) {
      // A date in `Z` teaches NOTHING. It says the instant, not where the
      // business lives: it's what comes out of serializing in UTC. Today
      // neither the engine nor the adapter send any like that -- verified
      // endpoint by endpoint against the lab on 8/13: they all come `-03:00`
      // -- but the day one shows up, learning "the agent lives in UTC" would
      // shift the whole portal's clock. With no offset to infer, it falls
      // back to the browser's clock, same as before.
      const o = /[zZ]$/.test(v.trim()) ? null : utcOffsetOf(v);
      if (o !== null) return o;
      continue;
    }
    if (v !== null && typeof v === "object") {
      const o = utcOffsetInResponse(v, budget);
      if (o !== null) return o;
    }
  }
  return null;
}

function learnFromResponse(data: unknown) {
  const o = utcOffsetInResponse(data);
  if (o !== null) setUtcOffset(o);
}

/** Get the portal to know what clock the business lives on BEFORE it paints
 *  the first screen, no matter which door the client came in through. Called
 *  by the layout's startup.
 *
 *  Order: what the agent declares about itself (the manifest, once the kit
 *  publishes it) beats what the portal infers. And if it already knows, it
 *  asks nothing. The two inferred sources are the only ones that carry dates
 *  WITH an offset; if the agent has neither activity nor tasks -- a client's
 *  first day -- there's nothing to learn and it falls back to the browser's
 *  clock, same as before. */
export async function learnAgentUtcOffset(cfg: PortalConfig, manifest?: Manifest | null) {
  const declared = utcOffsetFromManifest(manifest);
  if (declared !== null) { setUtcOffset(declared); return; }
  if (hasLearnedOffset()) return;
  // One at a time, in order: activity is the freshest source, scheduled tasks
  // the one that exists even before the agent has ever done anything. `get`
  // learns from whatever comes back on its own; the only job here is to
  // trigger them.
  await getActivity(cfg).catch(() => null);
  if (hasLearnedOffset()) return;
  await getJobs(cfg).catch(() => null);
}

async function get<T>(base: string, path: string, cfg: PortalConfig): Promise<T> {
  const res = await fetch(base + path, { headers: headers(cfg) });
  if (!res.ok) throw await failure(res, path);
  const data = await res.json();
  learnFromResponse(data);
  return data as T;
}

async function post<T>(base: string, path: string, cfg: PortalConfig, body?: unknown): Promise<T> {
  const res = await fetch(base + path, {
    method: "POST",
    headers: { ...headers(cfg), "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw await failure(res, path);
  return res.json();
}

async function del<T>(base: string, path: string, cfg: PortalConfig): Promise<T> {
  const res = await fetch(base + path, { method: "DELETE", headers: headers(cfg) });
  if (!res.ok) throw await failure(res, path);
  return res.json();
}

/** The shape the `approval` skill gives a request: a markdown box ("if you
 *  approve / if you reject / why"). It's what tells a PROPOSAL apart from any
 *  other text from the agent. */
export const looksLikeProposal = (s: string | null | undefined) =>
  /^\s*\|.*\|\s*$/m.test(s || "");

/* ── What the client "said", according to the machine ────────────────────────
   Approve-with-correction and reject leave a comment on the ticket signed
   `cliente` that the client did NOT write: it's an instruction for the agent,
   in caps and orders ("REJECTED BY YOUR CLIENT. Don't do what you asked to
   approve, or anything like it…"). The instruction has to exist -- it's what
   keeps the agent from reading a "no" as a permission -- but showing it to
   the client signed "You" puts a prompt in her mouth that she never wrote. It
   is stored whole and only its OWN part is shown: her words.
   ─────────────────────────────────────────────────────────────────────────── */

const REJECTION_RE = /^\s*RECHAZADO POR (?:TU|EL) CLIENTE\b/i;
/** THE PORTAL'S ONLY DEFINITION OF "THE CLIENT".
 *
 *  The authors the ADAPTER signs with when it writes on the client's behalf:
 *  `cliente` (the rejection, the correction) and `portal` (the audit trail
 *  entry). Everything else -- `default`, `worker`, the profile's name, a
 *  person's name -- is not the client, and nobody speaks for her.
 *
 *  THERE USED TO BE THREE COPIES OF THIS RULE and they didn't agree: this one
 *  also let in `user` and `usuario`, the Board didn't, and the entity viewer
 *  rendered `portal` as "Portal" instead of "You". With a comment signed
 *  `user`, the Board showed "**user** · You rejected it": the label said the
 *  client had rejected it and the name said something else, on the same line.
 *
 *  And `user`/`usuario` LEFT THE SET. The adapter doesn't sign that way --
 *  only `cliente` and `portal` -- so they weren't matching anything real;
 *  what they DID do was hand out surface area right in the function that
 *  decides which content gets hidden (see `readComment`: whatever the client
 *  signs gets filtered). That the engine's hook today blocks `--author=` and
 *  `HERMES_PROFILE=` is a defense on the other end, and defenses on the other
 *  end fall apart on their own. */
export const isTheClient = (author: string | null | undefined) =>
  /^(cliente|portal)$/i.test((author ?? "").trim());
// The engine's auto-decomposer comments in English and signs with its own
// name. Right at the moment a client's request broke, the screen answered
// "Decomposed into t_f7052f4d, t_c8a7f149. Root will wake when all children
// complete." And what needs saying there isn't what happened but what to
// check: when the engine splits a task, the split carries the ORIGINAL text
// -- which is why the client was left with an 8-hinge task in the queue after
// having corrected it to 20.
const DECOMPOSED_RE =
  /^\s*Decomposed into (.+?)\.\s*Root will wake when all children complete\.?\s*$/i;
/** Whoever signs a comment that is neither the client nor the agent. */
export const isTheSystem = (author: string) =>
  /^(auto-decomposer|system|kanban|engine)$/i.test((author || "").trim());

// Hermes signs the agent's comments with the CLI's author: "default",
// "worker" or the profile's name, depending on which path wrote it. To the
// client they're all THE SAME person: their agent, under the name they gave
// it.
//
// `user` and `usuario` ARE HERE AND NOT IN `isTheClient`, and the difference
// is everything: `user` is what `hermes kanban comment` sets when nobody said
// who's writing (the CLI's default, not an identity), and inside a client's
// agent the only thing that runs the CLI is the agent. As a LABEL it's its
// name -- showing the word "user" on screen is a machine identifier in the
// client's face -- but as TRUST it's nobody: it never hides content or speaks
// on the client's behalf.
//
// `agente` IS THE ENGINE'S OWN SIGNATURE and it was missing: the approval
// plugin signs the agent's side of a request with it and the board signs its
// comments the same way, so the client read the literal word "agente" where
// the name she gave it belongs -- on the Approvals thread, which is the screen
// where a wrong author label costs the most.
const AGENT_SIGNATURES = new Set([
  "", "default", "worker", "agent", "agente", "hermes", "user", "usuario",
]);

/** Any of the signatures the agent's own comments come under.
 *
 *  Exported next to `isTheClient` and `isTheSystem`, and off the SAME set
 *  `authorLabel` draws the agent's name for, because the Inbox has to know
 *  which SIDE of a conversation a comment is on: the person who wrote in goes
 *  on the left and everyone on our side on the right, and "not the person" is
 *  not enough on a channel that does not sign with a handle. */
export const isTheAgent = (author: string | null | undefined) =>
  AGENT_SIGNATURES.has((author ?? "").trim().toLowerCase());

/** WHO WROTE THIS COMMENT, first and last name if it has one.
 *
 *  Lives here, next to `isTheClient` and `isTheSystem`, because the label is
 *  the visible face of those two rules and splitting them apart already cost
 *  us: Approvals -- the screen where the client AUTHORIZES -- had its own
 *  binary ternary (`fromClient ? "You" : "Your agent"`), which is why a
 *  comment from a real third person, the company's founder, read "**Your
 *  agent** -- Heads up, I promised Panadería Rivas the old price through the
 *  end of the month." The Board, with the same data, showed it correctly. An
 *  author label that lies on the approval screen is the worst possible place
 *  for it to lie.
 *
 *  Four cases, none of them invented: the client ("You"), the engine ("The
 *  system"), the agent under any of its internal signatures (the name the
 *  client gave it), and any other author -- shown EXACTLY as it came, because
 *  it's a person at the company and their name is the datum.
 *
 *  `agentName` comes in as a parameter, same as in `eventLabel`: reading it
 *  here would tie this module to onboarding, which already depends on this
 *  one. */
export function authorLabel(author: string | null | undefined, agentName = "Tu agente"): string {
  if (isTheClient(author)) return "Vos";
  const a = (author ?? "").trim();
  if (isTheSystem(a)) return "El sistema";
  return AGENT_SIGNATURES.has(a.toLowerCase()) ? agentName : a;
}
// The adapter writes "Reason, in their own words: '…'". The "Te dijo" variant
// is from the version the portal used to build: it's left over on old
// tickets.
const REASON_HEADER_RE = /(?:Motivo|Te dijo),? con sus palabras:[ \t]*/i;
/** The quote marks the adapter wraps the reason in. */
const QUOTE_PAIRS: [string, string][] = [["«", "»"], ["“", "”"], ['"', '"']];

/** The client's own words, pulled from the block the adapter builds.
 *
 *  UP TO THE LAST QUOTE MARK, not the first. With a lazy capture (`[\s\S]*?`)
 *  the reason used to cut off at the first inner quote mark, so a client who
 *  wrote "I don't like the word 'discount', change it to 'markdown'" read on
 *  screen "I don't like the word 'discount'" -- their own words, half-said and
 *  meaning something else. The closing mark the adapter appends after the
 *  reason carries no quotes, so the last closed one is theirs. Without quotes
 *  (the old format), up to the blank line. */
function extractRejectionReason(b: string): string {
  const m = b.match(REASON_HEADER_RE);
  if (!m || m.index === undefined) return "";
  const rest = b.slice(m.index + m[0].length);
  for (const [open, close] of QUOTE_PAIRS) {
    if (!rest.startsWith(open)) continue;
    const end = rest.lastIndexOf(close);
    if (end > open.length - 1) return rest.slice(open.length, end).trim();
  }
  return rest.split(/\n\s*\n/)[0].trim();
}

// The correction's header, with its preamble up to the colon. The `\n+` this
// used to require coupled the filter to the adapter always putting the
// corrected version on its own line: a one-line correction didn't match and
// the whole machine prompt came out raw, signed "You".
const CORRECTION_RE = /^\s*Aprobado CON CORRECCIONES\.[ \t]*(?:[^\n:]*:)?\s*/i;
const APPROVED_RE = /^\s*Aprobado desde el portal(\s*\(con correcciones\))?\s*$/i;

export type ReadableComment = {
  /** What gets shown. Empty = no text, just the label. */
  text: string;
  /** What this was, in one line. Only when the raw text can't be shown. */
  label?: string;
};

/** A ticket comment, ready for the client's eyes.
 *
 *  THE AUTHOR IS NOT DECORATION: WITHOUT IT, THE PREFIX IS A LIGHT SWITCH. The
 *  machine formats below are written by the ADAPTER signing `cliente`, and the
 *  labels speak on the client's behalf ("You rejected it"). Recognizing them
 *  by text alone, no matter who they came from, did two bad things at once.
 *  The first is a label that contradicts itself: a comment from the AGENT that
 *  started with "REJECTED BY YOUR CLIENT." showed on screen as "Your agent ·
 *  You rejected it". The second is worse and is the one that matters: since
 *  only the reason block is shown afterward -- which a comment from the agent
 *  doesn't have -- the comment went ENTIRELY INVISIBLE. In other words, a
 *  channel where the model hides anything it writes just by prefixing it.
 *  Measured against the lab agent: the comment showed up in the ticket and
 *  not one word of it made it to the screen.
 *
 *  The product's promise is "you see what your agent does". Rule: the filter
 *  only applies to what the client signs; everything else shows up raw. */
export function readComment(body: string, author?: string): ReadableComment {
  const b = (body ?? "").trim();
  const fromClient = isTheClient(author);
  if (fromClient && REJECTION_RE.test(b)) {
    const reason = extractRejectionReason(b);
    // WITH NO REASON BLOCK, SHOW THE RAW TEXT -- NEVER NOTHING. Today the
    // adapter always writes it, but tying "hide the whole comment" to "the
    // other side didn't change format" is the same coupling that has bitten
    // us before: the day it changes, the client stops seeing what they said.
    return reason ? { label: "Lo rechazaste", text: reason } : { label: "Lo rechazaste", text: b };
  }
  if (fromClient && CORRECTION_RE.test(b)) {
    const text = b.replace(CORRECTION_RE, "").trim();
    return text
      ? { label: "Tu versión corregida", text }
      : { label: "Tu versión corregida", text: b };
  }
  // The auto-decomposer is the engine, not the client: if this came signed by
  // it, it would be its own comment that happens to start the same way, and
  // it's shown as-is.
  const split = fromClient ? null : b.match(DECOMPOSED_RE);
  if (split) {
    const children = split[1].split(/\s*,\s*/).filter(Boolean);
    return {
      label: "Se partió sola",
      text:
        `Era muy grande y el sistema la partió en ${children.length === 1 ? "otra tarea" : `${children.length} tareas`} más chicas: `
        + `${children.join(", ")}. Conviene abrirlas y revisar que digan lo que pediste: al partirla `
        + "se copia el pedido original, no las correcciones que hayas hecho después. Esta tarea "
        + "sigue abierta y se retoma cuando terminen las otras.",
    };
  }
  if (fromClient && APPROVED_RE.test(b)) {
    return { label: b.toLowerCase().includes("correcciones") ? "Lo aprobaste con tu corrección" : "Le diste el ok", text: "" };
  }
  return { text: b };
}

/** Was this comment a "no" from the client? Same thing `readComment`
 *  recognizes, exposed for screens that need the STATE of the negotiation and
 *  not just the text (see `docs/PENDING.md`: what's open is read from the
 *  data, not from a `useState` that dies on F5). */
/** The reason the client wrote when rejecting, or "" if the comment doesn't
 *  carry the block the adapter builds. Screens use it to quote it in quote
 *  marks: with no block, nothing gets quoted (quoting the machine prompt would
 *  put words in their mouth they never said). */
export const rejectionReason = (body: string) => extractRejectionReason((body ?? "").trim());

export function isClientRejection(c: { author?: string; body?: string } | null | undefined) {
  return Boolean(c && isTheClient(c.author) && REJECTION_RE.test((c.body ?? "").trim()));
}

export type TicketComment = { author: string; body: string; created_at: number };
export type TicketEvent = {
  kind: string;
  created_at: number;
  summary?: string;
  files?: string[];
  blocked_kind?: string;
};
/** Why the ticket ended up the way it did. Built by the adapter from the
 *  closing (or blocking) event, doesn't depend on the agent remembering to
 *  comment. */
export type TicketOutcome = {
  kind: string;
  summary?: string;
  files?: string[];
  created_at: number;
};
export type TicketDetail = {
  ticket: Ticket;
  outcome?: TicketOutcome | null;
  comments: TicketComment[];
  events: TicketEvent[];
};

// ── Adapter (:8643) ──
export const getManifest = (c: PortalConfig) => get<Manifest>(c.adapter, "/portal/manifest", c);
/** The board. `source` picks the screen: `channels` is the Inbox's list,
 *  `work` the Board's, and with nothing it is everything, which is what the
 *  screens that count tickets read. */
export const getTickets = (c: PortalConfig, source?: "channels" | "work") =>
  get<{ tickets: Ticket[] }>(
    c.adapter, source ? `/portal/tickets?source=${source}` : "/portal/tickets", c);
export const getTicketDetail = (c: PortalConfig, id: string) =>
  get<TicketDetail>(c.adapter, `/portal/tickets/${encodeURIComponent(id)}`, c);
export const getApprovals = (c: PortalConfig) => get<{ approvals: any[] }>(c.adapter, "/portal/approvals", c);
/** `correction` (optional): your corrected version gets recorded as your own
 *  comment before unblocking -- the original ticket isn't touched. */
export const approve = (c: PortalConfig, id: string, correction?: string) =>
  post<{ ok: boolean }>(c.adapter, `/portal/approvals/${id}/approve`, c,
     correction ? { correction } : undefined);
export type Rejection = {
  ok: boolean;
  /** What state the ticket ended up in: `blocked` with an ordinary "no" (same
   *  as before rejecting), `done` when the client closed it. */
  status?: string;
  /** Always false: rejecting does NOT spend the unblock (see below). */
  unblocked?: boolean;
  /** true only with `final`: the ticket is now finished and the request
   *  leaves the tab. */
  closed?: boolean;
  /** The request STAYS in the tab waiting on your ok. */
  in_approvals?: boolean;
  /** The comment was written safely; notifying the agent is best-effort. */
  notified?: boolean;
  /** How many times it re-blocked for the same reason. The engine counts from
   *  1: the FIRST block already leaves it at 1, and it stays there for the
   *  whole negotiation as long as the ticket doesn't unblock. What matters is
   *  that it never reaches 2, which is where the engine sends it to triage and
   *  the request dies. Measured in the lab with two rejections and one
   *  approval-with-correction: it never went past 1. */
  block_recurrences?: number | null;
};

/** REJECTING IS A COMMENT SIGNED BY THE CLIENT, AND NOTHING MORE.
 *
 *  ONE call, one write. The portal used to make three -- comment, comment
 *  again, and move the ticket to `ready` -- and none of them were atomic: if
 *  the last one failed, the comment was already in, the screen said "could
 *  not save" and retrying commented twice.
 *
 *  And above all: THE TICKET'S STATE IS NEVER TOUCHED. A ticket has only one
 *  useful `unblock` before the engine calls it a loop (two re-blocks for the
 *  same cause and it goes to `triage`, where Approve answers "it's stuck" and
 *  no verb brings it back). If rejecting unblocked, the normal shape of a
 *  negotiation -- ask, get told no, correct it, ask again -- would spend that
 *  one unblock on the first "no", and the second block would kill the
 *  request: either triage, or the auto-decomposer splitting the task with the
 *  OLD BODY (the client corrected it to 20 hinges and was left with a card in
 *  the queue that said 8).
 *
 *  With the ticket sitting still in `blocked`: the comment wakes the agent up
 *  just the same (`notify_agent_of_comment`), the agent proposes again on the
 *  same ticket, the request never disappears from the tab while it's being
 *  negotiated, and the unblock gets spent ONCE, on approval, which is the end.
 *
 *  `final` IS THE OTHER HALF, AND THE CLIENT DECIDES IT. There are two
 *  different "no"s and only they know which one they mean: "not like this,
 *  bring me another version" (the one above) and "this isn't happening, don't
 *  propose it to me again". The second closes the ticket (`done`) in the SAME
 *  write as the comment, on the adapter's side. Without it, a definitively
 *  rejected request used to sit forever in Approvals with a live Approve
 *  button that no longer approved anything. And it's never inferred from the
 *  reason's text: having the model guess whether a "no" was final is exactly
 *  the decision that isn't its call to make. */
export const reject = (c: PortalConfig, id: string, reason: string, final = false) =>
  post<Rejection>(c.adapter, `/portal/approvals/${id}/reject`, c,
    final ? { reason, final: true } : { reason });

/** Something changed in the approvals queue: let the menu badge know right
 *  away instead of within a minute. */
export const APPROVALS_EVENT = "tuagente:approvals";
export function notifyApprovalsChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(APPROVALS_EVENT));
}
/** Naming and look, saved ON THE AGENT so they follow it to any machine. On an
 *  older adapter this 404s and the portal keeps using the browser's copy. */
export const saveIdentity = (
  c: PortalConfig,
  identity: {
    name?: string;
    look?: Record<string, number>;
    /** Who the CLIENT is (adapter 0.32+). The company name is used to talk
     *  about their own business by name; the url triggers the brief (the
     *  agent researches its own company and delivers a draft). */
    company?: string;
    url?: string;
    /** Where the agent notifies. The notification is sent by IT, not us. */
    contact?: { channel: "email" | "none"; value?: string };
  },
) => post<{ ok: boolean }>(c.adapter, "/portal/identity", c, identity);
export const getActivity = (c: PortalConfig) => get<{ events: any[] }>(c.adapter, "/portal/activity", c);
export const getFiles = (c: PortalConfig) => get<{ files: any[] }>(c.adapter, "/portal/files", c);
export const getFileText = async (c: PortalConfig, path: string) => {
  const res = await fetch(`${c.adapter}/portal/files/${encodeURIComponent(path)}`, { headers: headers(c) });
  if (!res.ok) throw httpError(res.status, path);
  return res.text();
};
/** The raw bytes, without passing them through text.
 *
 *  Downloads must ALWAYS use this. `res.text()` decodes as UTF-8, and on a
 *  binary (.xlsx, .pdf, an image) every invalid byte gets replaced with
 *  U+FFFD: the file that comes down ends up broken even though the adapter
 *  sent it intact. Verified with a 9316-byte .xlsx that traveled perfectly
 *  and only got corrupted in the browser. */
export const getFileBytes = async (c: PortalConfig, path: string) => {
  const res = await fetch(`${c.adapter}/portal/files/${encodeURIComponent(path)}`, { headers: headers(c) });
  if (!res.ok) throw httpError(res.status, path);
  return res.arrayBuffer();
};
/** What the agent has spent, per whoever bills for it (adapter 0.39+).
 *
 *  Replaces `getUsage` (`/portal/usage`) from before this rename, which added
 *  up what we saw pass through the proxy and missed it 9x LOW -- image
 *  generation hits the provider directly and never entered the count. The
 *  number now comes from OpenRouter for THIS agent's key. The key never
 *  reaches the browser: the adapter makes the call.
 *
 *  `available: false` (no key, or the provider isn't answering) comes back
 *  with 200: the screen says so and no number gets drawn. */
export type Usage = {
  available?: boolean;
  reason?: string;
  /** All in USD. `null` means "the provider doesn't report it", which is NOT
   *  zero. */
  today_usd?: number | null;
  month_usd?: number | null;
  total_usd?: number | null;
  /** The key's cap; null = no cap. */
  limit_usd?: number | null;
  updated_at?: string;
};
export const getUsage = (c: PortalConfig) => get<Usage>(c.adapter, "/portal/usage", c);

/** Uploads a file to the agent's inbox (workspace/entrada) and returns its path. */
export async function uploadFile(c: PortalConfig, file: File) {
  const buf = new Uint8Array(await file.arrayBuffer());
  // In chunks: with large files, a single apply blows the stack.
  let bin = "";
  for (let i = 0; i < buf.length; i += 8192) {
    bin += String.fromCharCode.apply(null, Array.from(buf.subarray(i, i + 8192)));
  }
  return post<{ ok: boolean; path: string; bytes: number }>(
    c.adapter, "/portal/upload", c, { name: file.name, content_b64: btoa(bin) },
  );
}

/** One entry of the agent's TECHNICAL inventory: a skill, a plugin, or an MCP
 *  server it already has installed. Distinct from `Capability` below, which
 *  is the commercial catalog of things the client could hire that the agent
 *  does NOT have yet -- see the rename notes on both types. */
export type InventoryItem = {
  name: string; summary: string; source: string; category?: string;
  /** true only on our own (adapter >=0.21): the engine's own aren't editable. */
  editable?: boolean;
  /** Human name with accents (frontmatter `title`, adapter >=0.23); without
   *  it, the portal humanizes the slug -- which can't invent accents. */
  label?: string;
};
export type Inventory = {
  skills: InventoryItem[];
  /** The ENGINE's plugins (`hermes plugins list`), which are not the kit's
   *  plugins -- hence the name (adapter 0.40+, `plugins` before that). */
  engine_plugins: { name: string; summary: string }[];
  mcp: { name: string; detail: string }[];
};
export const getInventory = (c: PortalConfig) =>
  get<Inventory>(c.adapter, "/portal/inventory", c);

/** A flow: the client's work, with a name, a trigger and results (adapter
 *  >=0.29). The `incomplete` status is derived by the adapter from missing
 *  connections -- it's never stored. */
export type Flow = {
  slug: string;
  name: string;
  client_summary: string;
  trigger_type: "drive" | "schedule" | "event" | "webhook" | "request" | string;
  trigger: string;
  status: "active" | "paused" | "incomplete" | string;
  missing_connections: string[];
  last_run?: { at?: string | null; status?: string } | null;
  /** Id of the scheduled task that fires the flow. The adapter HAS IT (reads
   *  it from the frontmatter to compute `last_run`) but doesn't publish it
   *  yet; see `docs/PENDING.md`. Until then, the portal ties the flow to its
   *  task by the name `flujo-<slug>`, which is what the kit gives it (that
   *  cron-name prefix stays Spanish on purpose -- it's a compatibility key on
   *  jobs already created inside deployed agents). */
  trigger_job?: string | null;
  results: { path: string; mtime: number }[];
  results_total: number;
};
export const getFlows = (c: PortalConfig) =>
  get<{ available: boolean; flows: Flow[] }>(c.adapter, "/portal/flows", c);
/** Detail: full results + the "how I work" from FLOW.md (>=0.30). */
/** One past run of a flow. `session_id` is the conversation it happened in —
 *  a run's conversation is NOT in the chat's list, this is how it is opened —
 *  and it is null once the engine has cleaned up an old run that went well. */
export type FlowRun = {
  id: string;
  status: "running" | "completed" | "failed" | "paused" | string;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
  manual: boolean;
  session_id: string | null;
};
export type FlowDetail = Flow & { how: string; runs?: FlowRun[] };
export const getFlowDetail = (c: PortalConfig, slug: string) =>
  get<FlowDetail>(c.adapter, `/portal/flows/${encodeURIComponent(slug)}`, c);

/** The full SKILL.md of one of our skills (adapter >=0.21). */
export const getSkillContent = (c: PortalConfig, name: string) =>
  get<{ name: string; content: string }>(c.adapter, `/portal/skills/${encodeURIComponent(name)}`, c);
/** Editing the skill IS editing how the agent works: the engine reindexes it
 *  on its own within a few minutes, nothing needs restarting. */
export const saveSkill = (c: PortalConfig, name: string, content: string) =>
  post<{ ok: boolean }>(c.adapter, `/portal/skills/${encodeURIComponent(name)}`, c, { content });

export type ArtifactMeta = {
  id: string; title: string; kind: string; summary: string;
  created_at: number; bytes: number;
};
export const getArtifacts = (c: PortalConfig) =>
  get<{ artifacts: ArtifactMeta[] }>(c.adapter, "/portal/artifacts", c);
export const getArtifact = (c: PortalConfig, id: string) =>
  get<ArtifactMeta & { html: string }>(c.adapter, `/portal/artifacts/${encodeURIComponent(id)}`, c);
export const deleteArtifact = (c: PortalConfig, id: string) =>
  del<{ ok: boolean }>(c.adapter, `/portal/artifacts/${encodeURIComponent(id)}`, c);

/** A post the agent left READY TO PUBLISH: the image, the text and the
 *  hashtags. Served by the social plugin's own router, and only present when
 *  the manifest flips `posts`.
 *
 *  Nothing here publishes anything: the client copies the caption, downloads
 *  the images and posts them from their own account. The tab says so.
 *
 *  `format` is left open like an artifact's `kind`: the plugin can grow a
 *  shape tomorrow and the tab draws it raw instead of hiding it. */
/** One slide as it was before a fix replaced it. `file` is its path inside the
 *  post (`anteriores/02-1.png`) and `url` where its bytes are — same rule as
 *  an image's: the bytes need the bearer, so it never goes into an `<img src>`.
 *  `reason` is what the client said was wrong, in their own words. */
export type PostVersion = {
  file: string;
  prompt: string;
  alt: string;
  reason: string;
  replaced_at: string;
  url: string;
};

export type Post = {
  /** `<YYYY-MM-DD>-<slug>`, the name of its folder in `posteos/`. */
  id: string;
  slug: string;
  /** The day the post is FOR, as a bare calendar day ("2026-09-15"): no
   *  offset, because it isn't an instant. `created_at` is the instant. */
  date: string;
  format: "feed" | "square" | "story" | string;
  /** PLAIN TEXT with line breaks, not markdown: it gets pasted into the
   *  network as-is, and rendering it would eat the `#` and the line breaks
   *  that are part of what the client publishes. */
  caption: string;
  /** The first slide's; a carousel carries one per image in `alts`. */
  alt: string;
  /** One per image, same order as `images`, when the post is a carousel
   *  (social plugin >= carousel). Absent on a one-image post. */
  alts?: string[];
  /** The brief each image was made from, same order as `images`: what the
   *  agent asked the model for, kept with the post so the client can read it
   *  and ask for one slide to be fixed. Absent on a post saved before the
   *  sidecar existed. */
  prompts?: string[];
  /** The earlier takes of each slide, keyed by the slide's CURRENT file name
   *  and oldest first. A fix throws nothing away: which of the two pictures is
   *  the good one is the client's call, so the one that was replaced is still
   *  there with its brief, its alt and what the client said was wrong. `{}`
   *  when nothing was fixed; absent on a post from before this existed. */
  versions?: Record<string, PostVersion[]>;
  /** Without the "#": the portal writes it when it copies them. */
  hashtags: string[];
  /** `url` is relative to the adapter (`/portal/posts/<id>/01.png`) and the
   *  bytes need the bearer, so it never goes into an `<img src>`. */
  images: { name: string; bytes: number; url: string }[];
  created_at: string;
  /** The slug of the flow that produced it, if a flow did. */
  flow: string | null;
  /** WHERE IT ENDED UP, once the client approved publishing it. Written by
   *  the social plugin's `publish_instagram` and never by the portal: the tab
   *  reads this, it doesn't publish. Absent on everything that hasn't gone
   *  out, which is most of what's in the tab. */
  published?: { at: string; media_id: string; permalink: string };
};
export const getPosts = (c: PortalConfig) =>
  get<{ available: boolean; posts: Post[] }>(c.adapter, "/portal/posts", c);
export const getPost = (c: PortalConfig, id: string) =>
  get<Post>(c.adapter, `/portal/posts/${encodeURIComponent(id)}`, c);
/** One image's raw bytes. Same reason as `getFileBytes`: a PNG that goes
 *  through `res.text()` comes back with every invalid byte replaced, and both
 *  the preview and the download would be broken. */
export const getPostImage = (c: PortalConfig, id: string, name: string) =>
  getAdapterBytes(c, `/portal/posts/${encodeURIComponent(id)}/${encodeURIComponent(name)}`);

/** The raw bytes of one of the ADAPTER'S OWN paths, with the bearer.
 *
 *  For a path the agent WROTE rather than one the portal built: the approval
 *  card for `publish_instagram` carries the post's slides as
 *  `![Imagen 1](/portal/posts/<id>/01.png)`, and an `<img src>` carries no
 *  header — which is why `lib/Markdown.tsx` fetches those bytes through here
 *  and draws an object URL. The key never travels in a query string. */
export const getAdapterBytes = async (c: PortalConfig, path: string) => {
  const res = await fetch(c.adapter + path, { headers: headers(c) });
  if (!res.ok) throw httpError(res.status, path);
  return res.arrayBuffer();
};

// ── Writing to the board (the adapter does it via CLI, never via SQL) ──
export const createTicket = (c: PortalConfig, t: { title: string; body?: string; tenant?: string }) =>
  post<{ ok: boolean; id: string | null }>(c.adapter, "/portal/tickets", c, t);
export const commentTicket = (c: PortalConfig, id: string, body: string, author?: string) =>
  post<{ ok: boolean }>(c.adapter, `/portal/tickets/${encodeURIComponent(id)}/comment`, c,
    author ? { body, author } : { body });
export type TicketStatus = "done" | "blocked" | "ready" | "archived";
export const setTicketStatus = (c: PortalConfig, id: string, status: TicketStatus) =>
  post<{ ok: boolean }>(c.adapter, `/portal/tickets/${encodeURIComponent(id)}/status`, c, { status });

export type CronRun = {
  id: string; status: string; claimed_at: string;
  started_at: string | null; finished_at: string | null; error: string | null;
};
export type CronDetail = {
  job: {
    id: string; name: string; prompt: string; script: string;
    schedule_display: string; enabled: boolean; state: string; model: string;
    deliver: string; last_status: string | null; last_error: string | null;
    next_run_at: string | null;
  };
  runs: CronRun[];
};
export const getCronDetail = (c: PortalConfig, id: string) =>
  get<CronDetail>(c.adapter, `/portal/crons/${encodeURIComponent(id)}`, c);

// ── Agent (:8642) ──

/** A scheduled task, exactly as the gateway publishes it in `/api/jobs`.
 *
 *  IT'S THE ONLY SOURCE THAT KNOWS WHEN IT WILL RUN AND WHY IT FAILED. The
 *  adapter publishes a `last_run` in `/portal/flows` with the date and a
 *  `"failed"`, and nothing else: no next schedule, no error, no whether it's
 *  paused. Flows merges the two. */
export type CronJob = {
  id: string;
  name: string;
  enabled: boolean;
  /** "scheduled" | "paused" | "running" | … */
  state?: string | null;
  schedule?: { kind?: string; expr?: string; minutes?: number; run_at?: string; display?: string } | null;
  schedule_display?: string | null;
  next_run_at?: string | null;
  last_run_at?: string | null;
  /** "ok" | "error" | … */
  last_status?: string | null;
  last_error?: string | null;
  paused_at?: string | null;
};

// include_disabled: the bare listing excludes paused jobs.
export const getJobs = (c: PortalConfig) =>
  get<{ jobs: CronJob[] }>(c.endpoint, "/api/jobs?include_disabled=true", c);
/** Pause, resume and run now. THESE ARE NATIVE TO THE ENGINE (`POST
 *  /api/jobs/{id}/{pause|resume|run}`) and the gateway lets them through CORS:
 *  nothing from the adapter is needed for the client to touch their flow.
 *  Changing the day and time does NOT go through here: it's `PATCH
 *  /api/jobs/{id}` and the gateway doesn't publish PATCH in
 *  `Access-Control-Allow-Methods` (see `docs/PENDING.md`). */
export const jobAction = (c: PortalConfig, id: string, action: "pause" | "resume" | "run") =>
  post<{ job?: CronJob }>(c.endpoint, `/api/jobs/${encodeURIComponent(id)}/${action}`, c);
export const getSessions = (c: PortalConfig) => get<any>(c.endpoint, "/api/sessions", c);
export const getSessionMessages = (c: PortalConfig, id: string) =>
  get<any>(c.endpoint, `/api/sessions/${id}/messages`, c);
export const deleteSession = async (c: PortalConfig, id: string) => {
  const res = await fetch(`${c.endpoint}/api/sessions/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: headers(c),
  });
  if (!res.ok) throw httpError(res.status, "deleting the session");
};
export const renameSession = async (c: PortalConfig, id: string, title: string) => {
  const res = await fetch(`${c.endpoint}/api/sessions/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { ...headers(c), "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw httpError(res.status, "renaming the session");
};

export type ChatMessage = { role: "user" | "assistant" | "system"; content: string };

export type RunMessage = { role: string; content: string | null };

export type SessionStreamHandlers = {
  onMessageStart?: () => void;
  /** Raw delta (NOT accumulated, unlike chatStream). */
  onDelta?: (delta: string) => void;
  /** Full, authoritative content of the message that just closed. */
  onMessageComplete?: (content: string) => void;
  onToolProgress?: (toolName: string) => void;
  /** HEADS UP: the WHOLE session comes back (verified: 327 messages), not just
   *  this turn. */
  onRunComplete?: (messages: RunMessage[]) => void;
};

// Hermes's NATIVE SSE streaming to continue an existing session.
// Events: run.started / message.started / assistant.delta {delta} /
// tool.progress {tool_name} / assistant.completed {content} /
// run.completed {messages} / done. Incompatible with chatStream()'s OpenAI
// format in both request and response (sending {messages} gives a 400).
//
// Goes through the adapter, NOT the gateway: the gateway answers
// /api/sessions/{id}/chat/stream with no Access-Control-Allow-Origin (it only
// sends it on the preflight), so the browser discards the response with
// "Failed to fetch". The sidecar proxies it and adds CORS.
export async function sessionChatStream(
  cfg: PortalConfig,
  sessionId: string,
  message: string,
  h: SessionStreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(
    `${cfg.adapter}/portal/sessions/${encodeURIComponent(sessionId)}/chat/stream`,
    {
      method: "POST",
      headers: { ...headers(cfg), "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
      signal,
    },
  );
  if (!res.ok || !res.body) {
    let detail = `${res.status} at session chat`;
    try {
      const err = await res.json();
      if (err?.error?.message) detail = err.error.message;
    } catch { /* no JSON body */ }
    throw new Error(detail);
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let event = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      // Same as chatStream: the blank line closes the event. Leaving it
      // hanging here is the same trap.
      if (line.trim() === "") { event = ""; continue; }
      if (line.startsWith("event: ")) {
        event = line.slice(7).trim();
        continue;
      }
      if (!line.startsWith("data: ")) continue;
      let data: any;
      try {
        data = JSON.parse(line.slice(6));
      } catch {
        continue; // partial chunk
      }
      switch (event) {
        case "message.started":
          h.onMessageStart?.();
          break;
        case "assistant.delta":
          if (typeof data.delta === "string" && data.delta) h.onDelta?.(data.delta);
          break;
        // HEADS UP: in the session stream, `tool.progress` is NOT the
        // notice that a tool is starting -- it's the thinking channel
        // (`tool_name: "_thinking"`). The real name comes in `tool.started`.
        // Listening only to progress, a RESUMED conversation stayed on
        // "Thinking" from start to finish even while the agent was browsing
        // and running commands: 38 tools and the client watching a dot.
        // (This didn't happen on a new conversation: that path is the
        // OpenAI one, which does send `hermes.tool.progress` with the name.)
        case "tool.started":
        case "tool.progress":
          if (typeof data.tool_name === "string") h.onToolProgress?.(data.tool_name);
          break;
        case "assistant.completed":
          if (typeof data.content === "string") h.onMessageComplete?.(data.content);
          break;
        case "run.completed":
          if (Array.isArray(data.messages)) h.onRunComplete?.(data.messages);
          break;
        case "done":
          return;
      }
    }
  }
}

// OpenAI-compatible SSE streaming. onDelta receives incremental text.
export async function chatStream(
  cfg: PortalConfig,
  messages: ChatMessage[],
  onDelta: (text: string) => void,
  /** Tool that's starting. HEADS UP: here the event is NOT named the same as
   *  in the session stream. The gateway sends `event: hermes.tool.progress`
   *  with `{tool, label, status}` (verified in
   *  gateway/platforms/api_server.py), while the session one sends
   *  `tool.progress` with `{tool_name}`. Without this, a NEW conversation
   *  reports no tool at all: the trail stays on "Thinking" forever and the
   *  mascot never changes expression. `_internal` ones (like `_thinking`) the
   *  gateway doesn't even send through here. */
  onTool?: (tool: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  // THROUGH THE ADAPTER, NOT THE GATEWAY, and it stays that way now that there
  // are no roles: the adapter proxies `/v1/chat/completions` on the agent
  // itself, with the client's own key and no prefix. Going straight to the
  // gateway would work too and it is not worth the churn -- one door for the
  // chat is one place to add CORS, a timeout or a log to.
  const res = await fetch(cfg.adapter + "/portal/chat/stream", {
    method: "POST",
    headers: { ...headers(cfg), "Content-Type": "application/json" },
    body: JSON.stringify({ messages, stream: true }),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`${res.status} at chat`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let acc = "", buf = "", eventName = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      // The blank line CLOSES the SSE event and resets the type to default.
      // Without this, the first tool's `event: hermes.tool.progress` used to
      // stick forever and EVERY text chunk that came after it (which are
      // unnamed events) got discarded in the `continue` below: on a NEW
      // conversation, the moment the agent used a tool, the whole reply
      // vanished and the client saw silence. Verified on 8/8 against the
      // gateway's raw stream.
      if (line.trim() === "") { eventName = ""; continue; }
      if (line.startsWith("event: ")) { eventName = line.slice(7).trim(); continue; }
      if (!line.startsWith("data: ") || line.includes("[DONE]")) continue;
      let payload: any;
      try {
        payload = JSON.parse(line.slice(6));
      } catch { continue; /* partial chunk */ }
      if (eventName === "hermes.tool.progress") {
        // Only the start: the `completed` that comes after would duplicate it.
        if (payload?.status !== "completed" && typeof payload?.tool === "string") {
          onTool?.(payload.tool);
        }
        continue;
      }
      const delta = payload?.choices?.[0]?.delta?.content;
      if (delta) { acc += delta; onDelta(acc); }
    }
  }
  return acc;
}

/** A connection's label by its id, to name it wherever the client needs it
 *  (a flow's `missing_connections`). Catalog ids (`email`, `google-workspace`)
 *  are ours; the client should never have to read them, so an unknown one
 *  falls back to something readable instead of the raw id. */
export function connectionLabel(id: string): string {
  const KNOWN: Record<string, string> = {
    email: "el correo de la empresa",
    whatsapp: "WhatsApp",
    slack: "Slack",
    "google-workspace": "Google Planillas y Drive",
    "gmail-lectura": "Gmail",
    "auxiliary-models": "los modelos de IA auxiliares",
  };
  return KNOWN[id] ?? id.replace(/-/g, " ");
}
