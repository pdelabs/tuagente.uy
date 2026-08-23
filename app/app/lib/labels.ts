"use client";

// The portal's dictionary: engine-speak -> small-business Spanish.
//
// WHY THIS IS ONE FILE AND NOT THREE LOOSE TABLES: an experience QA pass
// (8/12) wrote down the seventeen phrases that made a distributor's manager
// feel dumb. Six were engine words leaking straight onto the screen, each in
// a different module and each module with its own half-filled little table:
// "Usando skill view…" in the chat, "commented" in the ticket's history,
// "dependency_wait / spawned / promoted / heartbeat" in Activity, "cli" on
// the money screen. Our own SOUL forbids the agent from talking like that;
// the portal can't do it on its behalf either.
//
// RULE: no raw engine name reaches the client's eyes. Whatever isn't listed
// here gets translated to something generic but in Spanish -- never to the
// identifier. The technical name can still travel in a `title=` for us.

/* ── What the agent is doing ─────────────────────────────────────────────── */

/** Every tool in two tenses: while it's happening and once it happened. */
export type Action = { inProgress: string; done: string };

const THINKING: Action = { inProgress: "Pensando", done: "Pensó un momento" };

// The exact name wins; if not, the family. What matters is the OBJECT ("a
// file", "the board"): "Reading" alone says nothing, and the tool's name says
// too much, and in another language.
const BY_NAME: Record<string, Action> = {
  _thinking: THINKING,
  clarify: THINKING,
  todo: THINKING,
  memory: { inProgress: "Repasando lo que hablamos", done: "Repasó lo que hablaron" },
  session_search: { inProgress: "Buscando en lo que hablaron", done: "Buscó en lo que hablaron" },
  read_file: { inProgress: "Leyendo un archivo", done: "Leyó un archivo" },
  search_files: { inProgress: "Buscando entre tus archivos", done: "Buscó entre tus archivos" },
  write_file: { inProgress: "Escribiendo un archivo", done: "Escribió un archivo" },
  patch: { inProgress: "Corrigiendo un archivo", done: "Corrigió un archivo" },
  skill_view: { inProgress: "Repasando cómo se hace", done: "Repasó cómo se hace" },
  skills_list: { inProgress: "Repasando cómo se hace", done: "Repasó cómo se hace" },
  image_generate: { inProgress: "Armando una imagen", done: "Armó una imagen" },
  video_generate: { inProgress: "Armando un video", done: "Armó un video" },
  vision_analyze: { inProgress: "Mirando una imagen", done: "Miró una imagen" },
  video_analyze: { inProgress: "Mirando un video", done: "Miró un video" },
  send_message: { inProgress: "Mandando un mensaje", done: "Mandó un mensaje" },
  cronjob: { inProgress: "Programando una tarea", done: "Programó una tarea" },
  delegate_task: { inProgress: "Repartiendo el trabajo", done: "Repartió el trabajo" },
};

const BY_FAMILY: { re: RegExp; action: Action }[] = [
  { re: /^kanban_(show|list|get)/, action: { inProgress: "Mirando el tablero", done: "Miró el tablero" } },
  { re: /^(kanban_|project_)/, action: { inProgress: "Anotando en el tablero", done: "Anotó en el tablero" } },
  { re: /^(web_|browser_|x_search)/, action: { inProgress: "Buscando en internet", done: "Buscó en internet" } },
  { re: /^(read_|search_|.*_read$|.*_get$)/, action: { inProgress: "Leyendo", done: "Leyó lo que necesitaba" } },
  { re: /^(write_|.*_write$|.*_create$)/, action: { inProgress: "Escribiendo", done: "Escribió lo suyo" } },
];

const WORKING: Action = { inProgress: "Trabajando", done: "Trabajó un rato" };

/** What the agent is doing, in words. NEVER the tool's name. */
export function actionFor(tool: string | undefined | null): Action {
  const t = (tool || "").trim().toLowerCase();
  if (!t) return THINKING;
  const exact = BY_NAME[t];
  if (exact) return exact;
  for (const f of BY_FAMILY) if (f.re.test(t)) return f.action;
  return WORKING;
}

/** The trail's summary once the agent has already answered. */
export function summarizeActions(tools: string[]): string {
  const useful = tools.filter((t) => t && t !== "_thinking");
  if (useful.length === 0) return THINKING.done;
  if (useful.length === 1) return actionFor(useful[0]).done;
  return `Hizo ${useful.length} cosas antes de responder`;
}

/* ── What happened to a task ─────────────────────────────────────────────── */

/** Events that are pure machinery: they tell the client NOTHING and in a row
 *  they look like a hang. QA saw twelve rows of these in a row in Activity and
 *  the conclusion was "it hung, and on top of that I don't understand any of
 *  it". They're hidden behind a toggle, same as the technical stuff in Files.
 *
 *  WHAT DOES **NOT** GO HERE, and this is the part that matters:
 *  `block_loop_detected` and `decomposed`. Both SOUND like machinery and both
 *  mean "your request broke". The first is the engine saying the task blocked
 *  twice for the same reason; the second is the auto-decomposer splitting it
 *  into pieces -- and when it splits, it splits with the OLD BODY, so the
 *  client ends up with a task asking for 8 of something they already
 *  corrected to 20. Hiding exactly those two behind the toggle would hide the
 *  only signal that something needs intervening on. The toggle is for noise
 *  (heartbeats, startups, waits), not for bad news. */
export const MACHINE_EVENTS = new Set([
  "heartbeat", "spawned", "dependency_wait", "promoted", "claimed",
  "tip_scratch_workspace", "reclaim_deferred", "assigned",
]);

export const isMachineEvent = (kind: string) =>
  MACHINE_EVENTS.has((kind || "").trim().toLowerCase());

// `agentName` comes in as a parameter: the client named it, and the portal
// uses that name instead of "the agent" wherever it can.
const EVENTS: Record<string, string | ((n: string) => string)> = {
  created: "Se creó",
  claimed: (n) => `${n} la agarró`,
  running: (n) => `${n} está trabajando`,
  in_progress: (n) => `${n} está trabajando`,
  comment: "Comentario",
  commented: "Comentario",
  // NOT "waiting on your reply". The `blocked` event is fired by BOTH kinds of
  // block and the event itself doesn't know which one it is: the agent asking
  // for permission, or a request the client themselves made from the portal
  // -- which is born blocked on purpose and is waiting on US. The blind test
  // read, on the card for the client's OWN connection request, "Blocked --
  // waiting on your reply" while the Board's column said "We're looking at
  // it": the same ticket sending her to do something and telling her to do
  // nothing, at once. The event reports the FACT (it blocked); who's waiting
  // on whom is said by the status, which does know (`taskStatus`). It's paired
  // with `unblocked`, which was already worded on this same criterion.
  blocked: "Se frenó y quedó esperando",
  // NEVER "You gave it the go-ahead", which is what it used to say. This event
  // is fired by the engine's `unblock` and carries no author: the portal has
  // no way to know who unblocked it or why. Back when rejecting still moved
  // the ticket to `ready`, this put "You gave it the go-ahead" in Activity and
  // in the history of the request the client had just REJECTED. A label that
  // describes the fact (it moved on) and not the intent (you approved it)
  // can't go back to lying, by any path, including ones that don't exist yet.
  unblocked: "Se destrabó y siguió",
  completed: "Terminada",
  done: "Terminada",
  failed: "No pudo",
  error: "No pudo",
  cancelled: "Cancelada",
  canceled: "Cancelada",
  archived: "Archivada",
  skipped: "Se salteó",
  timeout: "Tardó demasiado",
  delivered: "Entregada",
  sent: "Enviada",
  status_changed: "Cambió de estado",
  scheduled: "Quedó programada",
  // The engine pulled it out of the queue because it's stuck: approving it
  // from here doesn't work anymore and it has to be asked of the agent again.
  // Said plainly, not hidden.
  triage: "Quedó trabada — hay que volver a pedirla",
  // BAD NEWS, not machinery: always shown (see MACHINE_EVENTS). Worded to be
  // understood on their own, without the rest of the history next to them.
  decomposed: "Se partió sola en tareas más chicas — revisá que digan lo que pediste",
  block_loop_detected: "Se frenó dos veces por lo mismo y quedó trabada",
  // Machinery: only shown if the client asks to see the technical detail, but
  // still in Spanish.
  heartbeat: "Sigue trabajando",
  spawned: "Arrancó el trabajo",
  dependency_wait: "Esperando otra tarea",
  promoted: "Pasó al frente de la cola",
  assigned: (n) => `Quedó a cargo de ${n}`,
  reclaim_deferred: "Reintento postergado",
  tip_scratch_workspace: "Nota interna del sistema",
};

/** What happened to the task, in words. The unknown gets humanized (dashes
 *  removed, first letter capitalized) rather than shown as-is: a brand-new
 *  `foo_bar` from the engine can't show up like that on the client's screen. */
export function eventLabel(kind: string, agentName = "Tu agente"): string {
  const k = (kind || "").trim().toLowerCase();
  const v = EVENTS[k];
  if (typeof v === "function") return v(agentName);
  if (v) return v;
  if (!k) return "Novedad";
  const cleaned = k.replace(/[_-]+/g, " ").trim();
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/* ── What state a task is in ──────────────────────────────────────────────── */

/** The UI kit's tones. They travel with the word: the color also informs. */
export type Tone = "violet" | "amber" | "green" | "coral" | "neutral";

// THE CHIP SAID `done`. In English, raw, in the modal a row in Activity
// opens -- literally what the client who blind-tested the portal wrote down
// in her report. And translating it wasn't enough: the SAME task, on the
// Board, was already called "Completado". The words are the Board's, since
// that's where the task lives, and the mapping is the same as its columns:
// each column has its name, and any new status falls into "En curso" instead
// of hiding or coming out in English.
//
// THE SECOND BLIND TEST FOUND THAT ONE STATUS HAD THREE NAMES. Verbatim: "In
// Home the column is called 'Frenadas', on the Board 'Lo estamos viendo',
// inside the card 'Frenada — espera tu respuesta'." Three places each with
// their own little table: Home counted the whole of blocked under "Frenadas",
// the Board had the right word but from its own pocket, and the event spoke
// for both. Now the columns -- their name, their tone and which task goes to
// which -- live ONCE, here, and all four screens read them from this same
// place.

/** The Board's columns. It's also the mapping Home uses to count: with two
 *  different mappings, the two screens' numbers never added up. */
export type TaskColumn = "todo" | "inProgress" | "waiting" | "ours" | "done";

const TODO = { label: "Por hacer", tone: "neutral" as const };
const IN_PROGRESS = { label: "En curso", tone: "amber" as const };
/** The agent blocked the task to ask you for permission: the ball is in YOUR
 *  court. It's the word the Board's and Approvals' welcome screens already
 *  teach. */
const WAITING_ON_YOU = { label: "Esperando aprobación", tone: "violet" as const };
/** WHAT'S WAITING ON THE CLIENT AND WHAT'S WAITING ON US ARE TWO DIFFERENT
 *  THINGS.
 *
 *  Both fall into `blocked`: the agent asking for permission, and the request
 *  the client themselves made from the portal ("Connect WhatsApp"), which is
 *  ALSO born blocked. With a single name, their own request told them
 *  "Esperando aprobación" -- waiting on their own approval. The discriminant
 *  isn't in `status` (both are `blocked`) but in whose request it is: that's
 *  answered by `isClientRequest` in `lib/agent.ts` and comes in as a
 *  parameter, because `agent.ts` imports this module and there can't be a
 *  cycle. */
const OURS = { label: "Lo estamos viendo", tone: "amber" as const };
const DONE = { label: "Completado", tone: "green" as const };

/** What each column is called. Read by the Board, Home, Approvals and the
 *  entity viewer: it's THE list of names, not one of several. */
export const COLUMN_LABEL: Record<TaskColumn, { label: string; tone: Tone }> = {
  todo: TODO, inProgress: IN_PROGRESS, waiting: WAITING_ON_YOU,
  ours: OURS, done: DONE,
};

/** The five columns, in the order they're read. */
export const BOARD_COLUMNS: { key: TaskColumn; label: string; tone: Tone }[] =
  (["todo", "inProgress", "waiting", "ours", "done"] as TaskColumn[])
    .map((key) => ({ key, ...COLUMN_LABEL[key] }));

/** Which Board column a task goes to.
 *
 *  `todo` IS THE REAL STATUS OF A JUST-CREATED TASK. The portal only knew
 *  `ready` -- which is the name of the VERB it writes with (`unblock`) -- so
 *  new tasks fell into "En curso" and the "Por hacer" column was always
 *  empty. Measured against the lab agent on 8/13: 3 of its 28 tasks are in
 *  `todo` and all three showed as if the agent were already working them. */
export function columnForTask(
  status: string | null | undefined, isClientRequest = false,
): TaskColumn {
  const s = (status || "").trim().toLowerCase();
  if (s === "ready" || s === "todo") return "todo";
  if (s === "blocked") return isClientRequest ? "ours" : "waiting";
  if (s === "done") return "done";
  return "inProgress";
}

// Archived isn't in any column -- it leaves the board -- but its link still
// opens the detail, and there "En curso" would be a lie.
const ARCHIVED = { label: "Archivada", tone: "neutral" as const };

/** What state a task is in, with the Board's words. `isClientRequest` (from
 *  `lib/agent.ts`) is the only thing that tells apart "waiting on you" from
 *  "we're waiting on it": without it, the client's own request says it's
 *  waiting on its own approval. */
export function taskStatus(
  status: string | null | undefined, isClientRequest = false,
): { label: string; tone: Tone } {
  const s = (status || "").trim().toLowerCase();
  if (s === "archived") return ARCHIVED;
  return COLUMN_LABEL[columnForTask(s, isClientRequest)];
}

/** How a SCHEDULED task (a cron) is doing, as a single banner.
 *
 *  "ACTIVE" IN GREEN ISN'T THE TRUTH IF THE LAST RUN FAILED. It's the worst
 *  bug the blind QA pass found -- the vet clinic had two jobs with the green
 *  banner and both had failed -- and on /app/tasks it was still alive with
 *  both halves stuck together: the green "Activa" chip next to the coral
 *  "falló" chip, on the same task, each one saying something different.
 *  Same criterion as a flow's banner (`flows/runs.ts`): running -> paused ->
 *  failed -> active. */
export function scheduledStatus(
  { running, paused, failed }: { running: boolean; paused: boolean; failed: boolean },
): { label: string; tone: Tone; countsAsFailure: boolean } {
  // `countsAsFailure` is what avoids the two halves: when the banner ALREADY
  // says it failed, the screen doesn't repeat the coral chip next to it; when
  // it says something else (paused, running), the failure still gets shown
  // separately and isn't lost.
  if (running) return { label: "Corriendo", tone: "violet", countsAsFailure: false };
  // Paused wins over the failure: it's the first thing that explains why it
  // isn't running. That the last run failed still gets said alongside it.
  if (paused) return { label: "Pausada", tone: "amber", countsAsFailure: false };
  if (failed) return { label: "La última vez falló", tone: "coral", countsAsFailure: true };
  return { label: "Activa", tone: "green", countsAsFailure: false };
}

/* ── What the agent produced ──────────────────────────────────────────────── */

// Three screens had their own little table for this and didn't agree: an
// `other` artifact was "Otro" in Artifacts, "Artefacto" in the modal, and came
// out raw -- "other" -- in Home.
const ARTIFACT_LABEL: Record<string, { label: string; tone: Tone }> = {
  chart: { label: "Gráfico", tone: "violet" },
  table: { label: "Tabla", tone: "green" },
  report: { label: "Informe", tone: "amber" },
  dashboard: { label: "Panel", tone: "coral" },
  diagram: { label: "Diagrama", tone: "violet" },
  other: { label: "Otro", tone: "neutral" },
};

/** What kind of deliverable this is, in one word. A new kind from the agent
 *  isn't hidden: it's shown humanized, same as an unknown event. */
export function artifactLabel(kind: string | null | undefined): { label: string; tone: Tone } {
  const k = (kind || "").trim().toLowerCase();
  if (ARTIFACT_LABEL[k]) return ARTIFACT_LABEL[k];
  const cleaned = k.replace(/[_-]+/g, " ").trim();
  return { label: cleaned ? cleaned.charAt(0).toUpperCase() + cleaned.slice(1) : "Entrega", tone: "neutral" };
}

/* ── Why it couldn't ─────────────────────────────────────────────────────── */

/** A failure told in a way the client can tell what happened and what to do.
 *  `raw` always travels along: it's not hidden, it's folded away. */
export type Failure = {
  /** What happened, in one line, with no machine names. */
  what: string;
  /** What THEY can do about it. Empty = there's nothing they can do, we look
   *  into it. */
  canDo: string;
  /** true when the ball is in our court: the screen offers to write to us. */
  ours: boolean;
  /** The engine's text, exactly as it came, for whoever wants to open it. */
  raw: string;
};

// THE ENGINE WRITES IN ENGLISH AND FOR AN OPERATOR: a vet clinic's Monday run
// failed with "RuntimeError: No LLM provider configured. Run `hermes model`
// to select a provider." On a vet clinic's screen that's not information,
// it's a scare -- and on top of it, it asks her to run a command she can't
// run. But erasing it is worse: the client discovered the failure in Activity
// and the sentence that saved it was the one telling her the truth. Rule:
// translate the known, tell the unknown honestly, and keep the raw text one
// click away.
//
// Empty `canDo` = there's nothing the client can do. Inventing a step ("check
// your connection") when the problem is ours costs her the afternoon.
const FAILURES: { re: RegExp; what: string; canDo: string; ours: boolean }[] = [
  {
    re: /no llm provider|no model configured|hermes setup|provider not configured/i,
    what: "Tu agente se quedó sin el motor que usa para pensar, así que la corrida ni arrancó.",
    canDo: "",
    ours: true,
  },
  {
    re: /rate.?limit|429|quota exceeded|insufficient.?(credit|quota|funds)|payment required|402/i,
    what: "El servicio de IA cortó a tu agente por consumo: no lo dejó trabajar esta vez.",
    canDo: "",
    ours: true,
  },
  {
    re: /401|403|unauthorized|forbidden|invalid.?(api.?)?key|authentication|credential|token expired|invalid_grant/i,
    what: "Una clave de las que usa tu agente dejó de servir, y sin eso no pudo entrar a buscar los datos.",
    canDo: "Fijate en Conexiones si alguna quedó desconectada: reconectarla lo destraba.",
    ours: true,
  },
  {
    re: /timeout|timed out|deadline exceeded|took too long/i,
    what: "Se hizo muy largo y se cortó por tiempo antes de terminar.",
    canDo: "Con «Probarlo ahora» ves si fue algo de ese momento o si se repite.",
    ours: false,
  },
  {
    re: /name or service not known|connection refused|network is unreachable|dns|econnrefused|temporary failure in name resolution|urlopen error/i,
    what: "No pudo llegar a un servicio de afuera: estaba caído o sin red en ese momento.",
    canDo: "Con «Probarlo ahora» ves si ya volvió.",
    ours: false,
  },
  {
    re: /no such file|file not found|filenotfound|directory.*not exist|is a directory/i,
    what: "Le faltó un archivo que esperaba encontrar y no siguió para no inventar nada.",
    canDo: "Si es un archivo que subís vos, subilo y probalo de nuevo.",
    ours: false,
  },
  {
    re: /permission denied|read-only file system|eacces/i,
    what: "Quiso hacer algo que no tiene permitido y se frenó ahí.",
    canDo: "",
    ours: true,
  },
  {
    re: /disk|no space left|quota.*disk/i,
    what: "Se quedó sin lugar para guardar y no pudo terminar.",
    canDo: "",
    ours: true,
  },
];

const GENERIC_FAILURE = {
  what: "La corrida se cortó antes de terminar y no dejó resultado.",
  canDo: "",
  ours: true,
};

/** Why it couldn't, in plain terms. Used for a scheduled task's `last_error`
 *  and for a run's error. */
export function readFailure(raw: string | null | undefined): Failure {
  const text = (raw ?? "").trim();
  const m = FAILURES.find((f) => f.re.test(text));
  const base = m ?? GENERIC_FAILURE;
  return { what: base.what, canDo: base.canDo, ours: base.ours, raw: text };
}

/* ── When: the business's clock, not the viewer's ────────────────────────── */

// THE SAME LINE SAID TWO DIFFERENT TIMES. On /app/tasks: "Los lunes a las
// 09:00" and, three centimeters to the right, "Próxima lun 17 ago a las
// 06:00." Both are the same run. The cadence comes from the cron, which is
// written in the agent's time; the next one came from `next_run_at` -- which
// carries its own offset, "2026-08-17T09:00:00-03:00" -- formatted with the
// clock of whoever's looking at the screen. With a browser in Mexico that's a
// three-hour difference and the client has no way to know which of the two is
// right.
//
// There's only ONE correct answer: the time the client chose. They said
// "Mondays at nine" and their agent lives in their city. The portal being
// opened from another timezone -- a trip, a bookkeeper looking in from
// outside -- can't move their company's schedule. So every date from the
// engine is shown in the offset it arrived with, not the browser's.

/** An instant from the engine, already converted to the business's clock. */
export type Moment = {
  /** The real instant (epoch ms). For sorting and comparing. */
  ms: number;
  /** "08:30" -- wall-clock time where the agent lives. */
  time: string;
  /** "lunes" */
  weekday: string;
  /** "17/08" */
  dayMonth: string;
  /** "17 ago" */
  date: string;
  /** "lun 17 ago" */
  shortDate: string;
  /** The year over there. Used to write it only when it isn't the current one. */
  year: number;
  /** Calendar days against today, counted over there: 0 today, -1 yesterday, 1 tomorrow. */
  days: number;
};

// "…-03:00", "…+0000" or "…Z". With no suffix we return null and fall back to
// the local clock, which is the only thing that can be assumed of a date with
// no offset.
const OFFSET_RE = /(?:(Z)|([+-])(\d{2}):?(\d{2}))$/;

function offsetOf(iso: string): number | null {
  const m = OFFSET_RE.exec(iso);
  if (!m) return null;
  if (m[1]) return 0;
  const min = Number(m[3]) * 60 + Number(m[4]);
  return m[2] === "-" ? -min : min;
}

/** The offset a date from the engine came with, in minutes. null if it
 *  doesn't carry one. Used to know what clock the agent lives on and apply it
 *  to data that arrives WITHOUT an offset (files' `mtime` is a bare number of
 *  seconds). */
export const utcOffsetOf = (iso: string | null | undefined): number | null =>
  iso ? offsetOf(iso.trim()) : null;

/** An instant (epoch ms) written as ISO with the given offset, so that later
 *  `moment()` can show it on the business's clock. */
export function isoWithOffset(ms: number, off: number): string {
  const d = new Date(ms + off * 60_000);
  const sign = off < 0 ? "-" : "+";
  const abs = Math.abs(off);
  const pad2 = (n: number) => String(n).padStart(2, "0");
  return d.toISOString().replace(/\.\d+Z$/, "")
    + `${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
}

// Formatted in UTC on purpose: the agent's offset gets added to the instant
// first, so the result's "UTC" hour IS its wall-clock hour. It's the only way
// to draw someone else's timezone without asking Intl for a timeZone name we
// don't know (the engine sends the offset, not the zone's name).
const inUTC = (o: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("es-UY", { ...o, timeZone: "UTC" });
const TIME_FMT = inUTC({ hour: "2-digit", minute: "2-digit", hour12: false });
const WEEKDAY_FMT = inUTC({ weekday: "long" });
const DAY_MONTH_FMT = inUTC({ day: "2-digit", month: "2-digit" });
const DATE_FMT = inUTC({ day: "numeric", month: "short" });
const SHORT_FMT = inUTC({ weekday: "short", day: "numeric", month: "short" });

export function moment(iso: string | null | undefined): Moment | null {
  const text = (iso ?? "").trim();
  if (!text) return null;
  const actual = new Date(text);
  const ms = actual.getTime();
  if (Number.isNaN(ms)) return null;
  const off = offsetOf(text) ?? -actual.getTimezoneOffset();
  const d = new Date(ms + off * 60_000);
  // "Today" is also theirs: if it's 23:40 on Monday at the vet clinic and it's
  // already Tuesday here, the run from a moment ago has to say "today", not
  // "yesterday".
  const today = new Date(Date.now() + off * 60_000);
  const utcMidnight = (x: Date) => Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate());
  return {
    ms,
    time: TIME_FMT.format(d),
    weekday: WEEKDAY_FMT.format(d),
    dayMonth: DAY_MONTH_FMT.format(d),
    date: DATE_FMT.format(d).replace(/[.,]/g, "").trim(),
    // es-UY returns "lun, 17 ago."; the comma and the period are extra when
    // reading it inside a sentence ("Próxima lun 17 ago a las 08:30").
    shortDate: SHORT_FMT.format(d).replace(/[.,]/g, "").trim(),
    year: d.getUTCFullYear(),
    days: Math.round((utcMidnight(d) - utcMidnight(today)) / 86_400_000),
  };
}

/** When it happened: "ayer a las 08:30", "el 02/08 a las 19:00". */
export function whenItHappened(iso: string | null | undefined): string {
  const m = moment(iso);
  if (!m) return "";
  if (m.days === 0) return `hoy a las ${m.time}`;
  if (m.days === -1) return `ayer a las ${m.time}`;
  if (m.days > -7) return `el ${m.weekday} a las ${m.time}`;
  return `el ${m.dayMonth} a las ${m.time}`;
}

/** When it's going to happen. ALWAYS CARRIES THE DATE: "el lunes 17/08 a las
 *  08:30". Two different clients asked for this separately, and both wrote it
 *  with the day AND the date -- "el lunes", read on a Tuesday, doesn't say
 *  whether it's in six days or thirteen. */
export function whenItRuns(iso: string | null | undefined): string {
  const m = moment(iso);
  if (!m) return "";
  if (m.days === 0) return `hoy a las ${m.time}`;
  if (m.days === 1) return `mañana a las ${m.time}`;
  if (m.days > 1 && m.days < 7) return `el ${m.weekday} ${m.dayMonth} a las ${m.time}`;
  return `el ${m.dayMonth} a las ${m.time}`;
}

/* ── The same clock on EVERY screen ───────────────────────────────────────── */

// `moment()` is enough as long as the date carries its own offset
// ("…-03:00"). The problem is everything else: tickets' and artifacts'
// `created_at`, files' `mtime` and sessions are bare epoch numbers. Formatting
// that with `new Date().toLocaleString()` -- i.e., with the viewer's clock --
// meant the SAME ticket said "11:50" in Activity's row and "13 ago, 08:50" in
// the modal that same row opens: a three-hour difference one click away,
// measured with the machine at -06 and the agent at -03.
//
// So the business's offset gets LEARNED once, from any date from the engine
// that does carry one (activity, runs, scheduled tasks), and stays saved for
// the screens that only receive a bare epoch. Until one has been learned it
// falls back to the browser's clock, which is the only thing that can be
// assumed -- and is exactly what all of them used to do.
//
// WHO LEARNS IT ISN'T EACH SCREEN. `lib/agent.ts` does, since that's where
// every response from the agent passes through: any date with an offset that
// arrives on any endpoint teaches it, and the portal's startup goes looking
// for it even if the client came in through a screen that carries no dates
// with an offset. The portal's clock depending on which tab the client
// entered through was the bug.
//
// PENDING: the right fix would be for the manifest to publish the agent's
// offset instead of the portal having to infer it. Noted in
// `docs/PENDING.md`; the portal already reads the field if it shows up (see
// `utcOffsetFromManifest` in `lib/agent.ts`).

const UTC_OFFSET_KEY = "tuagente_utc_offset";
/** undefined = haven't looked yet; null = none learned. */
let learnedOffset: number | null | undefined;

function readSavedOffset(): number | null {
  if (typeof window === "undefined") return null;
  try {
    // Watch the shortcut: `Number(null)` is 0, meaning "haven't learned one
    // yet" would read as "the agent lives in UTC" and shift the clock for the
    // whole portal. With nothing saved, null.
    const raw = localStorage.getItem(UTC_OFFSET_KEY);
    if (raw === null || raw.trim() === "") return null;
    const v = Number(raw);
    return Number.isFinite(v) && Math.abs(v) <= 900 ? v : null;
  } catch {
    return null;
  }
}

/** What clock the business lives on, in minutes of offset. */
export function businessUtcOffset(): number {
  if (learnedOffset === undefined) learnedOffset = readSavedOffset();
  return learnedOffset ?? -new Date().getTimezoneOffset();
}

/** Do we already know what clock the business lives on, or are we falling
 *  back to the browser's?
 *
 *  `lib/agent.ts` ASKS THIS SO IT NEVER ENTERS A SCREEN WITHOUT KNOWING. Only
 *  three screens called `learnUtcOffset` (Home, Activity and Tasks) and the
 *  other eight just consumed it: going straight to /app/pipeline with the
 *  browser at -06 and nothing saved, the stamp said "Actualizado 10:51" where
 *  a minute later -- going through Home -- it said 13:52. Measured on 8/13
 *  against the lab agent. */
export function hasLearnedOffset(): boolean {
  if (learnedOffset === undefined) learnedOffset = readSavedOffset();
  return learnedOffset !== null;
}

/** TODAY's offset for an IANA zone ("America/Montevideo" -> -180).
 *
 *  For the day the manifest publishes the agent's zone instead of the portal
 *  inferring it from dates (see `docs/PENDING.md`). The zone's name is a
 *  better datum than the offset because it knows about daylight saving; the
 *  portal, which works with offsets, keeps today's. */
export function utcOffsetForZone(zone: string | null | undefined): number | null {
  const z = (zone ?? "").trim();
  if (!z) return null;
  try {
    // A made-up zone throws a RangeError right here: no need to validate it
    // beforehand, and validating with an `includes("/")` check would have
    // left "UTC" out.
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: z, timeZoneName: "longOffset" })
      .formatToParts(new Date());
    const text = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
    // "GMT-03:00", "GMT+5:30" and "GMT" (which is UTC, i.e. 0).
    if (/^GMT$/i.test(text.trim())) return 0;
    const m = /GMT([+-])(\d{1,2}):?(\d{2})?/.exec(text);
    if (!m) return null;
    const min = Number(m[2]) * 60 + Number(m[3] ?? 0);
    return m[1] === "-" ? -min : min;
  } catch {
    return null; // made-up zone: nothing gets assumed
  }
}

/** Learns the offset from the first date that carries one. Called by the
 *  screens that request data with an offset (Home, Activity, Tasks); the rest
 *  just use it. */
export function learnUtcOffset(...dates: (string | null | undefined)[]): number {
  for (const f of dates) {
    const o = utcOffsetOf(f);
    if (o === null) continue;
    setUtcOffset(o);
    break;
  }
  return businessUtcOffset();
}

/** The same value, already in minutes. Used by `lib/agent.ts`, which pulls
 *  the offset out of the response (or the manifest) and has no date to pass
 *  in: building a fake ISO string just to have it reparsed here would be
 *  going around twice. */
export function setUtcOffset(minutes: number): number {
  if (!Number.isFinite(minutes) || Math.abs(minutes) > 900) return businessUtcOffset();
  if (minutes !== learnedOffset) {
    learnedOffset = minutes;
    try { localStorage.setItem(UTC_OFFSET_KEY, String(minutes)); } catch { /* private mode */ }
  }
  return minutes;
}

/** Any date from the agent -- epoch in seconds or ms, a numeric string, or ISO
 *  with or without an offset -- read on the business's clock. It's the single
 *  gate: whatever already carries an offset keeps it (and teaches it to us
 *  along the way). */
export function momentOf(value: string | number | null | undefined): Moment | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string") {
    const text = value.trim();
    if (text && !/^\d+(\.\d+)?$/.test(text)) {
      if (utcOffsetOf(text) !== null) { learnUtcOffset(text); return moment(text); }
      // With no offset there's nothing to infer from the text: it's read as
      // an instant and drawn on the business's clock.
      const t = new Date(text).getTime();
      return Number.isNaN(t) ? null : moment(isoWithOffset(t, businessUtcOffset()));
    }
  }
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return moment(isoWithOffset(n > 1e12 ? n : n * 1000, businessUtcOffset()));
}

/** "hoy" + "11:50", "ayer" + "09:12", "jue 13 ago" + "11:50". Split in two
 *  because the time aligns separately (tabular-nums) on several screens. */
export function dateAndTime(value: string | number | null | undefined):
{ date: string; time: string } | null {
  const m = momentOf(value);
  if (!m) return null;
  return {
    date: m.days === 0 ? "hoy" : m.days === -1 ? "ayer" : m.shortDate,
    time: m.time,
  };
}

/** The same, on one line: "hoy 11:50". "" if there's no date. */
export function dateTime(value: string | number | null | undefined): string {
  const p = dateAndTime(value);
  return p ? `${p.date} ${p.time}` : "";
}

/** Just the business's wall-clock time: "11:50". */
export const timeOf = (value: string | number | null | undefined): string =>
  momentOf(value)?.time ?? "";

/** Does it fall within the last N days, COUNTING THE WAY THE BUSINESS COUNTS?
 *  (1 = today.)
 *
 *  Activity's "Today" filter used to compute midnight with the browser's
 *  `new Date()` while the section titles counted days over there: from
 *  Mexico, tapping "Today" cut the list off at 03:00 the agent's time, left
 *  the "Con error" counter at 0 and made the run that had failed at 02:58
 *  disappear -- with the section still titled "HOY". There's only one day:
 *  the business's. */
export function isFromRecentDays(
  value: string | number | null | undefined, days: number,
): boolean {
  const m = momentOf(value);
  if (!m) return true; // no date, nothing gets hidden
  return m.days > -days;
}

/** The business's wall-clock hour, 0-23. */
const businessHour = (ms = Date.now()): number =>
  new Date(ms + businessUtcOffset() * 60_000).getUTCHours();

/** "Buenas tardes". THE GREETING GOES ON THE BUSINESS'S CLOCK, like
 *  everything else.
 *
 *  It used to be on the BROWSER's clock on purpose, on the argument that the
 *  greeting speaks to whoever's looking and not to the agent. The argument is
 *  nice and the result is false: the blind test on 8/13 wrote down "it's
 *  three in the afternoon and the screen greets me with 'Buen día'".
 *  Reproduced here with the real functions: agent in Montevideo (-03) at
 *  15:04, browser in `America/Mexico_City` (-06) -> "Buen día"; browser in
 *  `Europe/Madrid` (+02) -> "Buenas noches".
 *
 *  Why the business's and not the browser's:
 *   - The client IS the business. Her agent lives in her city and her portal
 *     talks about her own things; the business's offset is her time in any
 *     realistic case, and it's the only one the portal can verify (it learns
 *     it from the agent's own dates -- the browser's zone can be set wrong,
 *     which is exactly the case that was measured).
 *   - And above all: it's the ONLY time read on this screen. Below the
 *     greeting it says "Actualizado 15:04" and "corrió hoy a las 14:35", both
 *     on the business's clock. A greeting on a different measure doesn't read
 *     as attentive to the viewer: it reads as the product not knowing what
 *     time it is. */
export function greetingOfTheDay(ms = Date.now()): string {
  const h = businessHour(ms);
  if (h < 6) return "Buenas noches";
  if (h < 13) return "Buen día";
  if (h < 20) return "Buenas tardes";
  return "Buenas noches";
}

/* ── How often a scheduled task runs ──────────────────────────────────────── */

// WHAT RUNS BEATS WHAT'S WRITTEN. A flow's cadence is declared in its FLOW.md
// (`trigger`, `client_summary`) AND scheduled in a cron, and the two can drift
// apart: when the client asks to change the schedule, what's sure to change
// is the cron. The blind test on 8/13: Flows said "Todos los jueves a las
// 8:30 · Próxima vez: el 20/8 a las 08:30" -- the cron -- and the home page
// still said "Todos los viernes a las 9:30" -- the text. Verbatim: "Two
// screens of the same program tell me two different days. Which one do I
// believe?" The one that runs. This function is the one that puts it into
// words.
//
// (There's an older, private copy in `app/app/tasks/page.tsx::readableCron`,
// owned by someone else today. TODO: have that one graduate to this one so
// there's just the one.)

const WEEKDAY_PLURALS = ["domingos", "lunes", "martes", "miércoles", "jueves", "viernes", "sábados"];
const pad2 = (n: number) => String(n).padStart(2, "0");

function cronDays(dow: string): string | null {
  if (dow === "1-5") return "De lunes a viernes";
  if (dow === "0,6" || dow === "6,0") return "Los sábados y domingos";
  if (/^[0-6]$/.test(dow)) return `Todos los ${WEEKDAY_PLURALS[Number(dow)]}`;
  if (/^[0-6](,[0-6])+$/.test(dow)) {
    const days = Array.from(new Set(dow.split(",").map(Number))).sort()
      .map((d) => WEEKDAY_PLURALS[d]);
    const last = days.pop()!;
    return `Los ${days.join(", ")} y ${last}`;
  }
  return null;
}

/** "Todos los jueves a las 08:30" built from the cron the engine has
 *  scheduled. `null` when the pattern isn't recognized: nothing gets invented
 *  there and the screen sticks to the next run, which is always true. */
export function cronCadence(expr: string | null | undefined): string | null {
  const p = (expr ?? "").trim().split(/\s+/);
  if (p.length !== 5) return null;
  const [min, hour, dom, mon, dow] = p;
  if (mon !== "*") return null;
  if (!/^\d+$/.test(min) || !/^\d+$/.test(hour)) return null;
  const time = `${pad2(Number(hour))}:${pad2(Number(min))}`;
  if (dom === "*") {
    if (dow === "*") return `Todos los días a las ${time}`;
    const days = cronDays(dow);
    return days ? `${days} a las ${time}` : null;
  }
  if (/^\d+$/.test(dom) && dow === "*") {
    return Number(dom) === 1
      ? `El primer día de cada mes a las ${time}`
      : `El día ${Number(dom)} de cada mes a las ${time}`;
  }
  return null;
}

/* ── Where the agent was talked to from ───────────────────────────────────── */

// Used in Usage ("cli · 28 sesiones" was the money screen talking jargon) and
// anywhere that shows a session's origin.
const CHANNEL_LABEL: Record<string, string> = {
  api_server: "Portal",
  portal: "Portal",
  telegram: "Telegram",
  whatsapp: "WhatsApp",
  discord: "Discord",
  signal: "Signal",
  cron: "Tareas programadas",
  // `cli` is the kanban dispatcher working a ticket on its own: to the client
  // that's "the agent working its tasks", not a console.
  cli: "Tareas del tablero",
  kanban: "Tablero",
  "kanban-research": "Tablero (investigación)",
  tui: "Consola",
  api: "Portal",
};

export function channelLabel(source: string): string {
  const s = (source || "").trim().toLowerCase();
  if (CHANNEL_LABEL[s]) return CHANNEL_LABEL[s];
  if (!s) return "Otro";
  const cleaned = s.replace(/[_-]+/g, " ").trim();
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}
