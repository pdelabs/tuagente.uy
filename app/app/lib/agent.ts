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
  /** Connections the client's flow needs and is missing (adapter >=0.24).
   *  Feeds the home notice and the sidebar's dot. */
  pending_connections?: number;
  /** Look the client chose for it, saved on the agent (adapter 0.26+).
   *  Absent on older adapters: the portal falls back to whatever the browser has. */
  look?: Record<string, number> | null;
  /** true if the client has ever named it from the portal. */
  named?: boolean;
  /** Where the agent notifies: `telegram`, `email` or `none` -- whatever the
   *  client answered at onboarding. Absent on older adapters and on anyone who
   *  never got around to answering; `"none"` is an explicit answer ("not right
   *  now") and it's the one that makes the portal offer it again. */
  notify_channel?: string | null;
  /** Telegram bot handle, without the @ (adapter 0.35+). Onboarding used to say
   *  "send me a hello" and never where: without this the step is impossible to
   *  complete unless the client already knows the handle. null if it has no bot. */
  telegram_bot?: string | null;
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
  /** Which role holds this task. The kanban is one board shared across every
   *  Hermes profile, and this is where it records the owner. `null` on an agent
   *  that never had a team: the ticket is simply drawn without a chip. */
  assignee: string | null;
  created_at: string | number; // Hermes emits it as an epoch in seconds
};

const DEFAULTS = { endpoint: "http://localhost:8642", adapter: "http://localhost:8643" };
export const CONFIG_KEY = "tuagente_portal_config";
const KEY = CONFIG_KEY;
// Everything the portal stores about ONE agent goes under this prefix: the
// credential, the name the client gave it, its look, which welcome screens
// were seen, the chat pins, the capabilities requested. NOTHING under here can
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

// The mark the portal puts on a ticket it creates itself when requesting a
// connection. Without it, that request comes back through Approvals and the
// portal sends the client to approve their own request -- a test client
// described it as "asking for a quote and getting sent to sign it yourself".
// It travels as an HTML comment: the markdown sanitizer never shows it.
export const REQUEST_MARKER = "<!-- portal:request -->";
// Tickets created before the rename still carry the old marker -- they live
// in kanban.db, which nothing here ever rewrites -- so the reader keeps
// accepting it too.
const LEGACY_REQUEST_MARKER = "<!-- portal:pedido -->";
/** Requests older than the marker are recognized by how the body starts. */
export const REQUEST_PREFIX = "Pedido desde el portal.";

/** Did the CLIENT request this ticket (and it's in our own queue), or is it
 *  the agent asking for permission? They're two different things: the
 *  client's own don't get approved and don't count toward the menu badge.
 *
 *  Lives here and not in every screen because it used to be copied in four
 *  places and they'd already drifted apart: the sidebar badge applied the new
 *  filter and Home didn't, so the menu said 2 and the home page said "3
 *  things waiting on your ok" on the very same screen. */
export function isClientRequest(body: string | null | undefined): boolean {
  const b = body ?? "";
  return b.includes(REQUEST_MARKER) || b.includes(LEGACY_REQUEST_MARKER) || b.trimStart().startsWith(REQUEST_PREFIX);
}

/** Which connections the client has already requested and are still pending,
 *  by the catalog label the title was built with (`Conectar {label}`).
 *
 *  THE TITLE IS THE ONLY LINK: the ticket doesn't store the connection's id,
 *  so anyone answering "did I already ask for this?" has to read it from
 *  there. Lives here -- not in Connections -- because ever since Team also
 *  leaves the request, two screens read the same convention, and if they
 *  drift apart one of the two offers the client something they're already
 *  waiting on. */
export function requestedConnections(tickets: Ticket[] | null | undefined): Set<string> {
  return new Set(
    (tickets ?? [])
      .filter((t) => isClientRequest(t.body) && t.status !== "done" && t.status !== "archived")
      .map((t) => (t.title ?? "").replace(/^Conectar\s+/i, "").trim().toLowerCase()),
  );
}

/* ── A block is NOT an approval ──────────────────────────────────────────────
   A THIRD THING IN THE SAME QUEUE, AND IT'S THE OPPOSITE OF AN APPROVAL. In
   `blocked` there aren't two kinds but three. The two known ones: the agent
   asking for permission (yours) and the client having asked for something
   (ours, `isClientRequest`). The third one was found by the blind test on
   8/13: the agent blocked because it's MISSING something we have to connect.
   Verbatim:

     "I got 'Weekly contract review -- missing access to Google' with buttons
      Reject / Correct and approve / Approve. Approve what? It didn't do
      anything, it just got stuck. That's not a permission I have to grant,
      it's a problem THEY have to fix for me."

   And "got stuck" is literal, not an impression: approving IS `unblock`, and
   a ticket has ONE useful unblock before the engine calls it a loop
   (BLOCK_RECURRENCE_LIMIT = 2 -> `triage`, where it can't be approved anymore).
   Since the cause is still there, the agent blocks it again right away:
   pressing Approve on one of these doesn't move anything forward and spends
   the request's only unblock.

   THE ENGINE DOESN'T TELL THEM APART: verified in both labs, permission
   requests and this kind of block share the same `block_kind = needs_input`
   (and `/portal/approvals` doesn't even publish it). What DOES tell them
   apart is what the agent WRITES: the SOUL tells it to put `connection:<id>`
   alone on its own line when it's missing a connection
   (`soul/04-language.md`), which is the mark the portal already turns into a
   card. Measured over Tero's and Zaguán's 13 blocked requests: the mark shows
   up in 1 -- exactly that one -- and in none of the 10 real permission
   requests.
   ─────────────────────────────────────────────────────────────────────────── */

// Same expression as the chip in `lib/entities.tsx`, without the line anchor:
// here it searches INSIDE the body.
const CONNECTION_IN_TEXT = /\bconnection:([a-z0-9][a-z0-9-]*)/gi;

/** The shape the `approval` skill gives a request: a markdown box ("if you
 *  approve / if you reject / why"). It's what tells a PROPOSAL apart from any
 *  other text from the agent. */
export const looksLikeProposal = (s: string | null | undefined) =>
  /^\s*\|.*\|\s*$/m.test(s || "");

/** The connections the ticket names as missing, by catalog id. */
export function missingConnections(text: string | null | undefined): string[] {
  const seen = new Set<string>();
  // `exec` in a loop and not `matchAll`: this project's target is ES5 and the
  // iterator doesn't compile. The regex is global, so `lastIndex` advances on
  // its own -- and it's reset here so two calls in a row don't step on each
  // other.
  CONNECTION_IN_TEXT.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CONNECTION_IN_TEXT.exec(text ?? "")) !== null) seen.add(m[1].toLowerCase());
  return Array.from(seen);
}

/** Is this blocked request waiting for something to get CONNECTED, rather
 *  than a decision from the client? There's nothing to approve there.
 *
 *  WHEN IN DOUBT, IT'S AN APPROVAL. If the body carries the skill's box, the
 *  proposal wins even if it mentions a connection: stripping the buttons off
 *  a real permission request is worse than leaving them on a connection
 *  block -- the client ends up unable to authorize what they actually want. */
export function isConnectionBlock(body: string | null | undefined): boolean {
  if (isClientRequest(body)) return false;
  if (looksLikeProposal(body)) return false;
  return missingConnections(body).length > 0;
}

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
const AGENT_SIGNATURES = new Set([
  "", "default", "worker", "agent", "hermes", "user", "usuario",
]);

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
export const getTickets = (c: PortalConfig) => get<{ tickets: Ticket[] }>(c.adapter, "/portal/tickets", c);
export const getTicketDetail = (c: PortalConfig, id: string) =>
  get<TicketDetail>(c.adapter, `/portal/tickets/${encodeURIComponent(id)}`, c);
export const getApprovals = (c: PortalConfig) => get<{ approvals: any[] }>(c.adapter, "/portal/approvals", c);
/** `correction` (optional): your corrected version gets recorded as your own
 *  comment before unblocking -- the original ticket isn't touched. */
export const approve = (c: PortalConfig, id: string, correction?: string) =>
  post<{ ok: boolean }>(c.adapter, `/portal/approvals/${id}/approve`, c,
     correction ? { correction } : undefined);
export const getGoogleAuthUrl = (c: PortalConfig) =>
  post<{ auth_url: string }>(c.adapter, "/portal/connections/google/auth-url", c);
export const exchangeGoogleAuthCode = (c: PortalConfig, code: string) =>
  post<{ ok: boolean }>(c.adapter, "/portal/connections/google/auth-code", c, { code });
export const activateTelegramPairing = (c: PortalConfig, code: string) =>
  post<{ ok: boolean }>(c.adapter, "/portal/connections/telegram/pairing", c, { code });
export const getWhatsAppPairStatus = (c: PortalConfig) =>
  get<{ paired: boolean; pairing: boolean; has_qr: boolean }>(c.adapter, "/portal/connections/whatsapp/pair", c);
export const startWhatsAppPairing = (c: PortalConfig) =>
  post<{ ok?: boolean }>(c.adapter, "/portal/connections/whatsapp/pair/start", c);
export const getWhatsAppPairQr = async (c: PortalConfig) => {
  const res = await fetch(`${c.adapter}/portal/connections/whatsapp/pair/qr.png?t=${Date.now()}`, {
    headers: headers(c),
  });
  if (!res.ok) throw await failure(res, "WhatsApp QR");
  return res.blob();
};
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
    contact?: { channel: "telegram" | "email" | "none"; value?: string };
    /** A PNG capture (bare base64) of the mascot at naming time: the agent
     *  saves it and one of our tools uploads it as the Telegram bot's photo. */
    avatar_png?: string;
  },
) => post<{ ok: boolean }>(c.adapter, "/portal/identity", c, identity);
/** Change what the agent can do with a connection. Client only. */
export const savePermissions = (
  c: PortalConfig, id: string, permissions: { read?: boolean; act?: boolean },
) => post<{ ok: boolean; permissions: { read: boolean; act: boolean } }>(
  c.adapter, `/portal/connections/${encodeURIComponent(id)}/permissions`, c, permissions);
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
  trigger_type: "drive" | "schedule" | "webhook" | "request" | string;
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
export type FlowDetail = Flow & { how: string };
export const getFlowDetail = (c: PortalConfig, slug: string) =>
  get<FlowDetail>(c.adapter, `/portal/flows/${encodeURIComponent(slug)}`, c);

/** The full SKILL.md of one of our skills (adapter >=0.21). */
export const getSkillContent = (c: PortalConfig, name: string) =>
  get<{ name: string; content: string }>(c.adapter, `/portal/skills/${encodeURIComponent(name)}`, c);
/** Editing the skill IS editing how the agent works: the engine reindexes it
 *  on its own within a few minutes, nothing needs restarting. */
export const saveSkill = (c: PortalConfig, name: string, content: string) =>
  post<{ ok: boolean }>(c.adapter, `/portal/skills/${encodeURIComponent(name)}`, c, { content });

/** Which of the client's systems the agent is plugged into.
 *  The adapter reports PRESENCE, never values: no credential travels here. */
export type Connection = {
  id: string;
  label: string;
  group: "channel" | "system" | string;
  purpose: string;
  how: string;
  effort?: "minutes" | "hours" | "days" | string;
  who?: "client_only" | "assisted" | "us" | string;
  warning?: string | null;
  recommended?: boolean;
  status: "connected" | "disconnected" | "blocked" | "ready" | string;
  missing: { type: string; name: string }[];
  missing_prerequisite: { type: string; name: string }[];
  /** true if THIS client's flow needs it (adapter >=0.24). */
  required?: boolean;
  /** What the agent can do with this connection (adapter >=0.33). The client
   *  decides it and it's enforced by the guard, not the prompt: the agent
   *  can't change it (the file is mounted read-only on its side). */
  permissions?: { read: boolean; act: boolean };
  /** "google-oauth" = the portal connects it on its own with its dialog
   *  (adapter >=0.25); with no setup flow, the button falls back to "Ask them
   *  to connect it". */
  setup_flow?: string | null;
  /** "ready" status (adapter >=0.27): our half is there (the bot exists) but
   *  the client never chatted. `link` is the t.me/… for their first message. */
  link?: string | null;
};
export const getConnections = (c: PortalConfig) =>
  get<{ available: boolean; connections: Connection[] }>(c.adapter, "/portal/connections", c);

/** What the agent CAN'T do yet and could be turned on. The adapter computes it
 *  by PRESENCE (`active`), same as connections, and hides our own internals
 *  (`installs`, `verifies`): only what the client reads makes it here. */
export type Capability = {
  id: string;
  label: string;
  group?: string;
  purpose: string;
  how?: string;
  cost?: string;
  effort?: string;
  who?: string;
  /** `base` ships on EVERY agent: drawn as included and NEVER with a request
   *  button (asking for something you already have is the worst possible
   *  screen). `menu` is what can be added. An older adapter doesn't send it:
   *  with the field absent, `menu` is assumed, which is how the portal used
   *  to behave. */
  level?: "base" | "menu" | string;
  /** null = can't be asserted (the engine doesn't expose the tool index). */
  active: boolean | null;
};
export const getCapabilities = (c: PortalConfig) =>
  get<{ available: boolean; capabilities: Capability[] }>(c.adapter, "/portal/capabilities", c);

/** What the client wrote that they need, translated into catalog ids.
 *
 *  The agent resolves it with ONE short call to the model -- not a whole
 *  run -- and answers with ids validated against the catalog: whatever the
 *  model makes up never reaches this far.
 *
 *  `no_match` is the honest answer to "couldn't ask" (the agent has nothing
 *  to call the model with): the screen shows the whole menu unmarked instead
 *  of cutting the flow short. An empty list WITHOUT that field says something
 *  else: it did ask, and nothing in the menu was what the client requested. */
export const suggestCapabilities = (c: PortalConfig, text: string) =>
  post<{ suggested: string[]; no_match?: boolean }>(
    c.adapter, "/portal/capabilities/suggest", c, { text });

/** What the client requested for a role that isn't running yet: what name and
 *  what look they gave it when they picked it. A REQUESTED role still serves
 *  the CATALOG'S name and look (only once it's installed does the profile
 *  become its own), so what the client chose travels here and is the only
 *  thing the portal can show them while they wait. */
export type RoleRequest = {
  name: string;
  /** The mascot's look, exactly as the naming step saved it. */
  look?: Record<string, number> | null;
  /** When it was requested, as the agent recorded it (ISO). */
  requested_at: string;
  /** The capabilities the client chose when requesting it, if the role asked
   *  (today only the assistant, which doesn't ship pre-built). They don't turn
   *  anything on by themselves: they're what the client expects, and whoever
   *  sets it up reads them to know what to give it. */
  capabilities?: string[];
};

/** One member of the team -- hired or on offer.
 *
 *  A role is a Hermes profile with its own SOUL, skills and memory. `name` and
 *  `look` only come back for hired ones: they are read from the profile the
 *  client owns, so a rename survives. */
export type Role = {
  id: string;
  label: string;
  /** What it does, in the client's words. */
  does: string;
  /** Its hard limit, also in their words. The same sentence lives in its SOUL. */
  never?: string;
  hired: boolean;
  name?: string;
  look?: Record<string, number>;
  /** Connections it cannot start without. */
  needs?: string[];
  flows?: string[];
  state?: string;
  /** Requested and not installed yet. It's what separates "you can hire it"
   *  from "you already requested it and it's on its way" -- without this, a
   *  waiting client sees the role offered again and requests it a second
   *  time. */
  request?: RoleRequest | null;
};
export const getRoles = (c: PortalConfig) =>
  get<{ available: boolean; roles: Role[] }>(c.adapter, "/portal/roles", c);

/** The client picks a role from the catalog, names it and leaves it requested.
 *
 *  IT TURNS NOTHING ON BY ITSELF: installing a profile is our own work (SOUL,
 *  skills, permissions, restarting the gateway). This just records it on the
 *  agent's side and the portal waits for the role to show up hired in the
 *  roster.
 *
 *  The adapter answers 409 with two different reasons -- you already
 *  requested it, or you already have it -- and 400 if the name comes in
 *  empty. The text travels in `{error}`, which is what `failure` leaves in
 *  the error's message. */
export const createRoleRequest = (
  c: PortalConfig, role: string, name: string, look: Record<string, number> | null,
  /** Only for the role made up of capabilities: the ids the client left
   *  checked. The adapter validates them against the catalog and answers 400
   *  if any of them can't be requested. */
  capabilities?: string[],
) => post<{ request: RoleRequest & { role: string } }>(
  c.adapter, "/portal/roles/request", c,
  capabilities?.length ? { role, name, look, capabilities } : { role, name, look });

/** One turn of a room, as the adapter stored it. */
export type RoomTurn = {
  ts: number;
  role: "user" | "assistant";
  content: string;
  /** Which teammate answered. Absent = the agent the client named. */
  by?: string;
};
export type RoomSummary = { id: string; title: string; updated_at: number; turns: number };

/** The rooms this client has.
 *
 *  A room is ONE conversation the whole team shares, and it is stored by the
 *  adapter rather than the engine: its turns are answered by different profiles,
 *  each of which persists into its own store, so an engine-side conversation
 *  would end up scattered with no way to reassemble it. Measured 2026-08-17 --
 *  pinning every turn to one `session_id` does not work either, the engine mints
 *  its own per turn. */
export const getRooms = (c: PortalConfig) =>
  get<{ rooms: RoomSummary[] }>(c.adapter, "/portal/rooms", c);
export const getRoom = (c: PortalConfig, id: string) =>
  get<{ turns: RoomTurn[] }>(c.adapter, `/portal/rooms/${encodeURIComponent(id)}`, c);
/** Name a conversation, and throw one away.
 *
 *  THE SAME TWO GESTURES THE SIDEBAR OFFERS OVER AN ENGINE SESSION, pointed at
 *  the store that actually holds a room. They used to go to the engine for
 *  every row -- `PATCH`/`DELETE /api/sessions/{id}` -- and the engine has never
 *  heard of a room, so on a client with a team both menu items could only fail.
 *
 *  Renaming is a POST because the adapter's door publishes GET, POST and
 *  DELETE and nothing else: a PATCH from the browser dies in the preflight. */
export const renameRoom = async (c: PortalConfig, id: string, title: string) => {
  await post<{ ok: boolean }>(c.adapter, `/portal/rooms/${encodeURIComponent(id)}`, c, { title });
};
export const deleteRoom = async (c: PortalConfig, id: string) => {
  await del<{ ok: boolean }>(c.adapter, `/portal/rooms/${encodeURIComponent(id)}`, c);
};

/** The client requests a capability. It gets recorded on the agent's side (one
 *  line per request) and WE look at it: nothing turns on by itself. */
export const requestCapability = async (c: PortalConfig, id: string | null, text: string) => {
  const r = await post<{ ok?: boolean; error?: string; duplicate?: boolean }>(
    c.adapter, "/portal/capabilities/request", c, { id, text });
  // The adapter can answer 200 with `{ok:false}`: without this check the
  // portal would tell the client "requested" for something that never got
  // recorded anywhere, which is the worst possible version of this button.
  if (r?.ok === false) throw new Error(r.error || "el pedido no quedó registrado");
  return r;
};

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

// ── Writing to the board (the adapter does it via CLI, never via SQL) ──
export const createTicket = (c: PortalConfig, t: { title: string; body?: string; tenant?: string }) =>
  post<{ ok: boolean; id: string | null }>(c.adapter, "/portal/tickets", c, t);
export const commentTicket = (c: PortalConfig, id: string, body: string, author?: string) =>
  post<{ ok: boolean }>(c.adapter, `/portal/tickets/${encodeURIComponent(id)}/comment`, c,
    author ? { body, author } : { body });
export type TicketStatus = "done" | "blocked" | "ready" | "archived";
export const setTicketStatus = (c: PortalConfig, id: string, status: TicketStatus) =>
  post<{ ok: boolean }>(c.adapter, `/portal/tickets/${encodeURIComponent(id)}/status`, c, { status });

/** ONLY ONE PLACE CREATES CONNECTION REQUESTS. Connections and the hiring flow
 *  used to build them separately, with different bodies and a stray fetch on
 *  one side.
 *
 *  AND THEY'RE BORN BLOCKED, which is the part that matters. `POST
 *  /portal/tickets` creates them `ready` and already assigned, so the
 *  dispatcher picks them up within seconds even though the body says "don't
 *  do anything on your own": the agent finishes its run saying it's waiting
 *  on something, the engine reads that as `dependency_wait` -- which is not a
 *  sticky block -- returns it to `ready` and picks it up again. Measured on
 *  8/13 against a lab agent: 8 runs on t_dd0c0fa1 and 10 on another, ~US$0.007
 *  each, until the model happened to use the typed block. With the ticket
 *  blocked from the start (`hermes kanban block`, which does emit the sticky
 *  event) the worker leaves it alone: verified on t_276ddb2b, zero `claimed`
 *  in 4 minutes against an unblocked control that took off running at 6
 *  seconds.
 *
 *  Blocking is also where the client expects to see it: the approvals queue
 *  is the blocked tickets, and it shows up there under "What you asked for". */
export async function createConnectionRequest(
  c: PortalConfig, request: { title: string; body: string },
) {
  const r = await createTicket(c, {
    title: request.title,
    body: `${REQUEST_PREFIX} ${REQUEST_MARKER}\n\n${request.body}`,
  });
  // If it couldn't be blocked, the request still got recorded: the worst that
  // happens is the agent picks it up, which is exactly what used to happen
  // before.
  if (r?.id) await setTicketStatus(c, r.id, "blocked").catch(() => {});
  return r;
}

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
  /** Which member of the team answers. Absent = the agent the client named.
   *  It travels in the body and the client's key never changes: the adapter
   *  holds the per-role credential, because the engine fails a named profile
   *  closed rather than let it inherit the listener's key. */
  role?: string | null,
): Promise<void> {
  const res = await fetch(
    `${cfg.adapter}/portal/sessions/${encodeURIComponent(sessionId)}/chat/stream`,
    {
      method: "POST",
      headers: { ...headers(cfg), "Content-Type": "application/json" },
      body: JSON.stringify(role ? { message, role } : { message }),
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
  /** Which member of the team answers, when the client named someone. */
  role?: string | null,
  /** True when this agent has a team, so the room can route a message nobody
   *  addressed. Without it we would pay the adapter hop on every single-role
   *  agent for a routing decision that has nothing to decide. */
  hasTeam?: boolean,
  /** Who ended up taking the turn. Only the adapter knows when the room routed
   *  it, and it arrives before the first token so the reply is drawn with the
   *  right face from the start. */
  onRole?: (role: string) => void,
  /** Which room to record this turn in. Without it nothing is stored, which is
   *  what the chat did until rooms existed. */
  room?: string | null,
): Promise<string> {
  // The ADAPTER, not the gateway, whenever a role could be involved: addressing
  // one needs that profile's own key and the browser only ever holds one.
  const url = role || hasTeam
    ? cfg.adapter + "/portal/chat/stream"
    : cfg.endpoint + "/v1/chat/completions";
  const res = await fetch(url, {
    method: "POST",
    headers: { ...headers(cfg), "Content-Type": "application/json" },
    body: JSON.stringify({
      messages,
      stream: true,
      ...(role ? { role } : {}),
      ...(room ? { room } : {}),
    }),
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
      if (eventName === "portal.role") {
        if (typeof payload?.role === "string") onRole?.(payload.role);
        continue;
      }
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

/** A connection's label by its id, to name it wherever the client needs it.
 *  Catalog ids (`email`, `google-workspace`) are ours; the client should never
 *  have to read them. If the catalog isn't at hand, it falls back to
 *  something readable instead of spitting out the id. */
export function connectionLabel(id: string, connections?: Connection[] | null): string {
  const c = connections?.find((x) => x.id === id);
  if (c?.label) return c.label;
  const KNOWN: Record<string, string> = {
    email: "el correo de la empresa",
    telegram: "Telegram",
    whatsapp: "WhatsApp",
    slack: "Slack",
    "google-workspace": "Google Planillas y Drive",
    "gmail-lectura": "Gmail",
    "auxiliary-models": "los modelos de IA auxiliares",
  };
  return KNOWN[id] ?? id.replace(/-/g, " ");
}
