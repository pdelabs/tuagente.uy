"use client";

// THE TRUTH ABOUT A FLOW'S LAST RUN.
//
// The blind QA on 8/12 found the portal's worst bug: a veterinary client had
// two flows with the "Activo" (Active) banner IN GREEN, and both had already
// run and failed. She discovered it by going into Actividad -- tucked away
// under "Más" -- and when she asked the agent about it over chat, it told her
// the truth: "you can't put this out of your mind yet, the last automatic
// check failed." Her conclusion, verbatim: "as long as the screen lies in
// green, I carry the same mental load."
//
// The data existed and we weren't looking at it: `/portal/flows` already
// carries `last_run` with `status: "failed"`. What it does NOT carry -- when
// the next run is, why it failed, whether it is paused -- lives in the native
// gateway, at `/api/jobs`. This module joins the two sources and answers the
// client's three questions: did it run?, did it go well?, when is the next
// one?
//
// THE SECOND AUDIT (8/13) FOUND IT WAS STILL LYING, IN BOTH DIRECTIONS, and
// from that came the three rules that order this file:
//
// 1. WHAT THE ENGINE ASSERTS IS KEPT SEPARATE FROM WHAT THE PORTAL INFERS.
//    `Outcome` is only "ok" when the engine wrote a status that means "it went
//    well"; anything else -- including the `unknown` the engine writes when
//    the scheduler restarts mid-run, literally "whether side effects ran is
//    unknown" -- is "uncertain", which is never painted green.
// 2. NOT FINDING THE TASK AND NOT BEING ABLE TO ASK ARE DIFFERENT THINGS.
//    Before, both were the same `null` and both ended up green. Now they go
//    through `Cross`, which names them: `no-task` (the gateway answered and
//    this flow has no cron) and `no-data` (the gateway did not answer, nothing
//    can be asserted).
// 3. A MISSING CONNECTION IS NOT A CAUSE. At Faro, a flow that failed with
//    `No LLM provider configured` showed "Le falta correo · Conectar correo"
//    (Missing email · Connect email): the client connects the email and it
//    fails again. The real reason always travels in `note`; the missing
//    connections travel separately, in `missingConnections`.
//
// TYING A FLOW TO ITS TASK: when the adapter publishes `trigger_job` (it has
// it: it reads it from the frontmatter to compute `last_run`) this ties by id.
// Until then, by the name `flujo-<slug>`, which is what the kit sets on the
// cron when it creates it. See `docs/PENDING.md`.

import { useSyncExternalStore } from "react";
import { whenItHappened, whenItRuns, readFailure, moment } from "../lib/labels";
import {
  getJobs, jobAction, type CronJob, type Flow, type PortalConfig,
} from "../lib/agent";

export type StatusKey =
  | "unconfirmed" | "paused" | "running" | "no-task" | "delayed"
  | "failed" | "uncertain" | "incomplete" | "ok" | "never-run";

export type Tone = "violet" | "green" | "coral" | "amber" | "neutral";

/** What the client needs to be told about this flow, and what they can do.
 *  Answers the card's two questions: what happened and whether they have to
 *  do something. */
export type Note = {
  tone: "coral" | "amber";
  /** What happened, in one line, with no machine names. */
  what: string;
  /** What it implies and what will happen on its own. */
  detail: string;
  /** Offer "Probarlo ahora" (Try it now) as the FIRST action: the failure can
   *  be transient and the retry is what unblocked it in the lab. */
  retryable: boolean;
  /** Offer to ask over chat to have it rescheduled. */
  canReschedule: boolean;
  /** Offer to notify us. Always AFTER the retry, never instead of it. */
  notifyUs: boolean;
  /** What the client can do, if anything. "" = nothing to do. */
  canDo: string;
  /** The engine's own text, verbatim. It is not hidden: it is collapsed. */
  raw: string;
};

export type RealStatus = {
  key: StatusKey;
  tone: Tone;
  /** The banner. Never says "Activo" over something that failed, that was
   *  left unconfirmed, or that we could not cross-check with the engine. */
  banner: string;
  /** "Última vez: ayer a las 8:30 — salió bien" (Last time: yesterday at
   *  8:30 -- it went well). "" if there is nothing to tell. */
  lastRun: string;
  /** "Próxima vez: el lunes 17/08 a las 8:30" (Next time: Monday 8/17 at
   *  8:30). "" if there is no schedule to assert. */
  nextRun: string;
  /** What happened and what to do. null when there is nothing to explain. */
  note: Note | null;
  /** Connections it is missing. SECONDARY: never replaces `note`. */
  missingConnections: string[];
  /** Can it be paused / tried now? Only if we found its task. */
  jobId: string | null;
  paused: boolean;
  /** Is it running RIGHT NOW. */
  running: boolean;
  /** We could not read `/api/jobs`: the screen runs on partial data. */
  unconfirmed: boolean;
  /** Changes when a run starts or ends. Used by the re-pause guardian to know
   *  the engine already picked up the run. */
  fingerprint: string;
};

/* ── What the engine asserts ─────────────────────────────────────────────── */

/** `/api/jobs` also carries the last EXECUTION, and it is the only thing that
 *  says whether the flow is running RIGHT NOW: the engine NEVER writes
 *  `state: "running"` -- `cron/jobs.py` only writes scheduled / paused / error
 *  / completed -- what runs is `latest_execution.status`. It is not in the
 *  `CronJob` type yet (`lib/agent.ts` is another unit's), so it is read by
 *  structure. */
type Execution = {
  id?: string | null;
  /** claimed | running | completed | failed | unknown */
  status?: string | null;
  claimed_at?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  error?: string | null;
};
type JobWithExecution = CronJob & { latest_execution?: Execution | null };

/** How a run went ACCORDING TO THE ENGINE. `null` = it never ran.
 *
 *  "uncertain" is not "more or less fine": it is the engine saying it does not
 *  know. The default has to be this and not "ok" -- before, any status that
 *  did not match `fail|error|timeout|cancel` was painted green, and the engine
 *  writes `status='unknown'` with the text "whether side effects ran is
 *  unknown" when the scheduler restarts mid-run (`cron/executions.py:199`), a
 *  path that also does NOT call `mark_job_run`. Measured: banner "Activo" and
 *  "salió bien" over a run whose outcome the engine itself declares unknown. */
export type Outcome = "ok" | "failed" | "uncertain" | null;

// EXACT lists on purpose. A new engine status cannot fall into "went well" by
// elimination: it falls into "uncertain", which is the truth.
const OK_STATUSES = new Set([
  "ok", "completed", "complete", "success", "succeeded", "done", "finished",
]);
const FAILED_STATUSES = new Set([
  "error", "failed", "failure", "fail", "timeout", "timed_out", "cancelled",
  "canceled", "aborted", "crashed", "killed",
]);
/** Running: `create_execution` leaves it `claimed` and the engine moves it to
 *  `running` right before launching the agent. */
const IN_FLIGHT_STATUSES = new Set(["claimed", "running", "pending", "started"]);

const readOutcome = (s: string | null | undefined): Outcome => {
  const t = (s ?? "").trim().toLowerCase();
  if (!t) return null;
  if (OK_STATUSES.has(t)) return "ok";
  if (FAILED_STATUSES.has(t)) return "failed";
  return "uncertain";
};

const ms = (v: string | null | undefined): number => {
  const m = moment(v);
  return m ? m.ms : 0;
};

/* ── Cross-checking the flow with its scheduled task ─────────────────────── */

/** What we know about a flow's scheduled task. Three different things that
 *  used to be the same `null`, and that is why they all said the same thing
 *  (green). */
export type Cross =
  | { kind: "no-data" }
  | { kind: "no-task" }
  | { kind: "task"; job: JobWithExecution };

/** This flow's scheduled task. `jobs === null` = the gateway did not answer. */
export function crossTask(f: Flow, jobs: CronJob[] | null | undefined): Cross {
  if (!jobs) return { kind: "no-data" };
  const chosen = (() => {
    if (f.trigger_job) return jobs.find((j) => j.id === f.trigger_job) ?? null;
    // `flujo-` is a compatibility key: it is the prefix already written on the
    // cron jobs of deployed agents, so it is NOT translated.
    const name = `flujo-${f.slug}`;
    const matching = jobs.filter((j) => (j.name || "").trim() === name);
    if (matching.length === 0) return null;
    // With duplicates (the kit warns they can exist) the enabled one wins, and
    // among those the one that ran most recently: it is the one the client is
    // looking at.
    return matching.slice().sort((a, b) => {
      if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
      return ms(b.last_run_at) - ms(a.last_run_at);
    })[0];
  })();
  return chosen ? { kind: "task", job: chosen } : { kind: "no-task" };
}

/** Changes when a run starts or ends. Compared by identity and not by date on
 *  purpose: the browser's clock can be off against the agent's, and a `>`
 *  between the two time zones would give false negatives forever. */
export const fingerprintOf = (job: JobWithExecution | null): string =>
  `${job?.latest_execution?.id ?? ""}|${job?.last_run_at ?? ""}`;

/* ── The status, told as it is ───────────────────────────────────────────── */

// The engine checks crons every 60 s (`gateway/run.py`,
// `_start_cron_ticker(interval=60)`). A next run that is overdue by less than
// that still says nothing: it is the normal window between "its turn came"
// and "it started" -- and it is exactly what you see the instant after
// pressing "Probarlo ahora" (Try it now), because the engine advances
// `next_run_at` to NOW to fire it. After five ticks with no start, that is
// already the symptom the client needs to see named.
const GRACE_MS = 5 * 60_000;

const BODY_RETRY = "Lo que ya te dejó hecho no se pierde, y vuelve a intentarlo en la próxima corrida.";
const BODY_ALONE = "Lo que ya te dejó hecho no se pierde.";

export type StatusOptions = {
  /** So the delay can be tested without waiting. */
  now?: number;
  /** The portal fired a run and the engine has not picked it up yet. */
  portalTriggered?: boolean;
};

/** A flow's status, told as it is. Pure function: everything it needs comes
 *  in as a parameter (including "now"), so it can be tested with no screen. */
export function realStatus(f: Flow, cross: Cross, opts: StatusOptions = {}): RealStatus {
  const now = opts.now ?? Date.now();
  const job = cross.kind === "task" ? cross.job : null;
  const exec = job?.latest_execution ?? null;
  const unconfirmed = cross.kind === "no-data";
  const missingConnections = f.status === "incomplete" ? f.missing_connections ?? [] : [];

  const jobId = job?.id ?? null;
  const paused = Boolean(job && (job.enabled === false || job.state === "paused"))
    || (!job && f.status === "paused");

  // Running? Only if the engine says so (a run picked up and not finished) or
  // if the portal itself just fired it and the engine has not noted it yet.
  // The "Trabajando ahora" (Working now) banner used to hang off
  // `job.state === "running"`, a value the engine never writes: it was dead
  // code.
  //
  // THE TWO THINGS ARE KEPT SEPARATE. `execInFlight` is "the engine has THIS
  // run picked up"; `opts.portalTriggered` is "the portal fired it and the
  // engine has not picked it up yet", and during that stretch `exec` is still
  // the PREVIOUS run. Mixing the two is what made the card put the old run's
  // time on the new run.
  const execInFlight = Boolean(
    exec && IN_FLIGHT_STATUSES.has((exec.status ?? "").trim().toLowerCase()) && !exec.finished_at,
  );
  const running = Boolean(opts.portalTriggered || execInFlight);

  // Of the three sources, the FRESHEST wins. The execution is the first to
  // know -- and on the `unknown` path it is the only one that knows, because
  // there the engine does not call `mark_job_run` and `last_status` is left
  // with the previous run's "ok".
  const execTime = ms(exec?.finished_at) || ms(exec?.claimed_at);
  const jobTime = ms(job?.last_run_at);
  const adapterTime = ms(f.last_run?.at);
  let whenISO = "";
  let outcome: Outcome = null;
  let raw = "";
  if (execTime && execTime >= jobTime && execTime >= adapterTime) {
    whenISO = exec?.finished_at || exec?.claimed_at || "";
    outcome = exec?.finished_at ? readOutcome(exec?.status) : null;
    raw = exec?.error ?? "";
  } else if (jobTime && jobTime >= adapterTime) {
    whenISO = job?.last_run_at ?? "";
    outcome = readOutcome(job?.last_status) ?? "uncertain";
    raw = job?.last_error ?? "";
  } else if (adapterTime || f.last_run?.status) {
    whenISO = f.last_run?.at ?? "";
    outcome = readOutcome(f.last_run?.status) ?? "uncertain";
  }
  const when = whenItHappened(whenISO);

  const nextRunMs = ms(job?.next_run_at);
  const delayMs = nextRunMs ? now - nextRunMs : 0;
  const delayed = !paused && !running && delayMs > GRACE_MS;
  const nextRun = paused || !nextRunMs || delayed
    ? ""
    : delayMs > 0
      ? "Le toca ahora: arranca en cualquier momento."
      : `Próxima vez: ${whenItRuns(job?.next_run_at)}`;

  // "Probarlo ahora" (Try it now) is only offered as an option when it truly
  // exists.
  const retryable = Boolean(jobId) && !running;

  const base = {
    nextRun, missingConnections, jobId, paused, running, unconfirmed,
    fingerprint: fingerprintOf(job),
  };

  const failureNote = (): Note => {
    const l = readFailure(raw);
    return {
      tone: "coral",
      what: l.what,
      detail: jobId && !paused ? BODY_RETRY : BODY_ALONE,
      // THIS USED TO SEND THE CLIENT OFF TO WAIT. For `no llm provider` the
      // screen said "you can't unblock this yourself, it's on our side" and
      // only offered "Notify us" -- and the lab data shows "Probarlo ahora"
      // fixed that exact run: the failure was transient. The retry goes
      // first; writing to us is left for when it happens again.
      retryable,
      canReschedule: false,
      notifyUs: l.ours,
      canDo: l.canDo,
      raw: l.raw,
    };
  };

  const uncertainNote = (): Note => ({
    tone: "amber",
    what: "La corrida se cortó por el medio y tu agente no llegó a anotar cómo salió.",
    detail:
      "No sé si alcanzó a hacer el trabajo o si quedó a mitad de camino. "
      + "Fijate en Resultados si dejó algo de esa fecha; si no dejó nada, corrélo de nuevo.",
    retryable,
    canReschedule: false,
    notifyUs: !retryable,
    canDo: "",
    raw,
  });

  // Without a cross-check against the engine, NOTHING can be asserted in
  // green: not "Activo", not "Próxima vez", not that it is running. With the
  // gateway down a paused flow looked "Activo" and the buttons simply
  // vanished, with not a word that the screen was running on partial data.
  if (unconfirmed) {
    if (outcome === "failed") {
      return { ...base, key: "failed", tone: "coral", banner: "La última vez falló",
        lastRun: `Corrió ${when} y no pudo terminar`, note: failureNote() };
    }
    return {
      ...base, key: "unconfirmed", tone: "neutral", banner: "Sin confirmar",
      lastRun: when ? `Última vez que sé que corrió: ${when}` : "",
      note: null,
    };
  }

  if (paused) {
    // Paused does NOT erase what happened: if the last run failed, it still
    // says so. A paused flow over a broken run is exactly the one to look at
    // before resuming it.
    return {
      ...base, key: "paused", tone: "neutral", banner: "En pausa",
      // AND IT DOES NOT ERASE THE OUTCOME WHEN IT WENT WELL EITHER. Active
      // said «Última vez: hoy a las 13:06 — salió bien» and the same flow,
      // paused, said only «Última vez: hoy a las 13:06». Pausing is exactly
      // what the client does to go check how it had gone: that was the data
      // we were taking away from them.
      lastRun: !when ? ""
        : outcome === "failed" ? `Última vez: ${when} — no pudo terminar`
        : outcome === "uncertain" ? `Última vez: ${when} — quedó sin confirmar`
        : outcome === "ok" ? `Última vez: ${when} — salió bien`
        : `Última vez: ${when}`,
      note: outcome === "failed" ? failureNote() : outcome === "uncertain" ? uncertainNote() : null,
    };
  }

  if (running) {
    // THE START TIME IS ONLY ASSERTED IF THE ENGINE PICKED UP THIS RUN. While
    // it has not, `exec` is the PREVIOUS one: reading its `started_at` was
    // putting the old run's time on the new run. Measured: "Probarlo ahora"
    // was pressed at 13:10 and the card said «Arrancó hoy a las 12:39 y sigue
    // trabajando», half an hour earlier. The fallback did not help either: it
    // only showed up when there was NO previous execution at all, which is
    // exactly the rare case.
    //
    // With no confirmed start, neither the time nor that it is already
    // working is asserted: the banner says the only thing that is known.
    // "I sent it to run" is already said by the flight, below in the buttons;
    // it is not repeated here.
    if (!execInFlight) {
      return {
        ...base, key: "running", tone: "violet", banner: "Arrancando",
        lastRun: "Arranca en cualquier momento.", note: null,
      };
    }
    const started = whenItHappened(exec?.started_at || exec?.claimed_at);
    return {
      ...base, key: "running", tone: "violet", banner: "Trabajando ahora",
      lastRun: started ? `Arrancó ${started} y sigue trabajando` : "Está trabajando ahora",
      note: null,
    };
  }

  // A flow that says "every Monday at 8:30" and has no task behind it is not
  // an active flow: it is a job that today nobody does. Verified by forcing
  // the case -- green banner, the cadence intact and not a word that the
  // automatic task no longer existed.
  if (cross.kind === "no-task" && f.trigger_type === "schedule") {
    return {
      ...base, key: "no-task", tone: "amber", banner: "No está programado",
      lastRun: when ? `Última vez que corrió: ${when}` : "",
      note: {
        tone: "amber",
        what: "No hay ninguna tarea programada que lo dispare.",
        detail: f.trigger
          ? `Acá dice que corre así: «${f.trigger}». Eso hoy no está agendado en tu agente, `
            + "así que no va a correr solo hasta que se vuelva a programar."
          : "Hoy no está agendado en tu agente, así que no va a correr solo.",
        retryable: false, canReschedule: true, notifyUs: true, canDo: "", raw: "",
      },
    };
  }

  if (delayed) {
    return {
      ...base, key: "delayed", tone: "amber", banner: "No arrancó cuando le tocaba",
      lastRun: when ? `Última vez que corrió: ${when}` : "",
      note: {
        tone: "amber",
        what: `Tenía que haber corrido ${whenItHappened(job?.next_run_at)} y todavía no arrancó.`,
        detail: "El horario pasó y la corrida no salió. Mientras tanto, ese trabajo no se está haciendo.",
        retryable, canReschedule: false, notifyUs: true, canDo: "", raw: "",
      },
    };
  }

  if (outcome === "failed") {
    return {
      ...base, key: "failed", tone: "coral", banner: "La última vez falló",
      lastRun: `Corrió ${when} y no pudo terminar`, note: failureNote(),
    };
  }

  if (outcome === "uncertain") {
    return {
      ...base, key: "uncertain", tone: "amber", banner: "Quedó sin confirmar",
      lastRun: `Última vez: ${when} — no quedó claro si terminó`, note: uncertainNote(),
    };
  }

  // A missing connection: only HERE, when there is no broken run nor a doubt
  // to tell. It used to go first and hide the real reason.
  if (missingConnections.length > 0) {
    return {
      ...base, key: "incomplete", tone: "amber", banner: "Le falta una conexión",
      lastRun: when ? `Última vez que corrió: ${when}` : "", note: null,
    };
  }

  if (outcome === "ok") {
    return {
      ...base, key: "ok", tone: "green", banner: "Activo",
      lastRun: `Última vez: ${when} — salió bien`, note: null,
    };
  }

  // Never ran. With a schedule that is a fact (it is programmed and its turn
  // has not come yet); with no schedule -- "whenever I ask you to" -- there is
  // nothing to report.
  if (f.trigger_type === "schedule") {
    return { ...base, key: "never-run", tone: "neutral", banner: "Todavía no corrió", lastRun: "", note: null };
  }
  return { ...base, key: "never-run", tone: "green", banner: "Activo", lastRun: "", note: null };
}

// THE ORDER ALSO SAYS SOMETHING. The adapter sorts by saved status, which
// knows nothing about runs: the veterinary client's two broken flows stayed
// at the bottom, below the healthy ones. Whatever asks the client for
// something goes on top.
const WEIGHT: Record<StatusKey, number> = {
  failed: 0, delayed: 1, "no-task": 2, uncertain: 3, incomplete: 4,
  running: 5, ok: 6, "never-run": 7, unconfirmed: 8, paused: 9,
};

export const sortByUrgency = <T extends { status: RealStatus; flow: Flow }>(xs: T[]): T[] =>
  xs.slice().sort((a, b) =>
    WEIGHT[a.status.key] - WEIGHT[b.status.key] ||
    a.flow.name.localeCompare(b.flow.name, "es"));

/* ── The strip up top: how many of EACH thing there are ──────────────────── */

// THE LIE SURVIVED HERE, in the very first line read. Every card already told
// the truth and the summary kept lumping `failed`, `delayed` and `no-task`
// into the same bucket, worded as "N no pudieron terminar la última vez" (N
// could not finish last time). Measured with one failed flow and one delayed
// one, the strip said
//
//   «Tus 2 trabajos automáticos necesitan que los mires: 2 no pudieron
//    terminar la última vez»
//
// while the card right next to it said "Última vez que corrió: hoy a las
// 13:06" and "No arrancó cuando le tocaba". The same screen against itself.
// Same thing with a cron-less flow whose last run went well.
//
// They are THREE different things and the client does three different things
// with each: failed to run / did not start when it should have / is no longer
// scheduled. Each is counted and named separately, WITH THE SAME WORDS AS THE
// CARD'S BANNER, so the summary's number can be checked by counting banners
// below.
//
// The order is `WEIGHT`'s, i.e. the same one the cards end up in: the strip
// reads left to right and goes down finding them in that order.
//
// `paused` is NOT counted on purpose: the client triggered the pause and the
// card already tells how the last run went. Putting it here would be asking
// them to look at something they themselves decided to stop.
const PROBLEMS: { key: StatusKey; singular: string; plural: string }[] = [
  { key: "failed", singular: "no pudo terminar la última vez", plural: "no pudieron terminar la última vez" },
  { key: "delayed", singular: "no arrancó cuando le tocaba", plural: "no arrancaron cuando les tocaba" },
  { key: "no-task", singular: "ya no está programado", plural: "ya no están programados" },
  { key: "uncertain", singular: "quedó sin confirmar", plural: "quedaron sin confirmar" },
  { key: "incomplete", singular: "necesita una conexión", plural: "necesitan una conexión" },
];

const enumerate = (xs: string[]): string =>
  xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`;

/** What to say up top. `""` = there is nothing to say and the screen stays
 *  quiet, which is the answer to "can I stop thinking about this".
 *
 *  Lives here and not in the page because it is the same count `realStatus`
 *  does, and because being pure it can be tested against a list of flows where
 *  the three cases coexist. */
export function summarizeFlows(statuses: RealStatus[]): string {
  const counts = PROBLEMS
    .map((p) => ({ ...p, n: statuses.filter((e) => e.key === p.key).length }))
    .filter((p) => p.n > 0);
  const withProblem = counts.reduce((s, p) => s + p.n, 0);
  if (withProblem === 0) return "";

  const total = statuses.length;
  const subject =
    total === 1 ? "Tu trabajo automático"
      : withProblem === total ? `Tus ${total} trabajos automáticos`
        : `${withProblem} de tus ${total} trabajos automáticos`;
  const plural = withProblem > 1;
  // With a single kind of problem the number was already said by the subject
  // and repeating it ("1 de tus 3 trabajos… : 1 no pudo terminar") is noise.
  // With two or more, each one's number is exactly the data that was missing.
  const detail = enumerate(counts.map(({ n, singular, plural: pl }) =>
    (counts.length === 1 ? "" : `${n} `) + (n === 1 ? singular : pl)));

  return `${subject} ${plural ? "necesitan" : "necesita"} que ${plural ? "los" : "lo"} mires: `
    + `${detail}. ${plural ? "Abajo dice qué pasó en cada uno." : "Abajo dice qué pasó."}`;
}

/* ── Running it once without dismantling the pause ───────────────────────── */

// THE BUTTON NEXT TO IT DISMANTLED THE SAFETY VALVE. `POST
// /api/jobs/{id}/run` does not mean "run this once": the engine implements it
// as `enabled:true, state:scheduled, paused_at:null, next_run_at:now`
// (`cron/jobs.py::trigger_job`), i.e. it UNPAUSES the flow and leaves it
// unpaused, silently. The pause is the one thing the client triggered on
// purpose. It is respected: it runs once and goes back to paused.
//
// THE ORDER IS NOT NEGOTIABLE. It cannot be paused before or right away: the
// ticker checks crons every 60 s (`gateway/run.py::_start_cron_ticker
// (interval=60)`) and skips paused ones, so an immediate re-pause would eat
// the run without saying anything. It CAN be paused as soon as the run has
// started: the tick calls `create_execution` BEFORE sending it to the pool,
// `_fire_job_body` works on a copy of the job and never looks at `enabled`
// again, and on finishing `mark_job_run` respects `state == "paused"` (all in
// `cron/`). That is why the guardian waits for the fingerprint to change -- a
// new execution -- and only then pauses: the unpaused window lasts as long as
// one tick, not as long as the run.
//
// AND IT LIVES OUTSIDE REACT, in the module and not in an effect, because the
// re-pause cannot depend on the card staying mounted: the client presses the
// button and goes to another tab. It is also noted in localStorage, so an F5
// in the middle picks it back up.

/** How often the engine is asked whether it already picked up the run. */
const POLL_MS = 4_000;
/** Six engine ticks. If it has not started in that time, it is not going to. */
const LIMIT_MS = 6 * 60_000;
/** Older than this is from another session: the run already finished a while
 *  ago. */
const STALE_MS = 60 * 60_000;
const STORAGE_KEY = "tuagente_flows_repause";
/** How long the final message stays visible before clearing. */
const NOTICE_MS = 14_000;

export type RunPhase = "triggering" | "running" | "re-pausing" | "done" | "error";

export type Run = {
  jobId: string;
  phase: RunPhase;
  /** The flow was paused: the pause has to be given back once it starts. */
  rePause: boolean;
  message: string;
  ok: boolean;
};

const flights = new Map<string, Run>();
const listeners = new Set<() => void>();
let version = 0;

const notify = () => { version += 1; listeners.forEach((f) => f()); };

const subscribe = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };

/** Re-renders the screen when a flight changes phase. */
export const useRuns = (): number =>
  useSyncExternalStore(subscribe, () => version, () => 0);

export const runOf = (jobId: string | null): Run | null =>
  jobId ? flights.get(jobId) ?? null : null;

/** A flight is "in the air" while it has not finished re-pausing. */
export const inFlight = (v: Run | null): boolean =>
  Boolean(v && (v.phase === "triggering" || v.phase === "running" || v.phase === "re-pausing"));

const sleep = (t: number) => new Promise((r) => setTimeout(r, t));
const errorMessage = (e: unknown) => (e instanceof Error ? e.message : "error");

type PendingRepause = { since: number; fingerprint: string };

function readPending(): Record<string, PendingRepause> {
  try {
    const v = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return v && typeof v === "object" ? v : {};
  } catch { return {}; }
}

function notePending(jobId: string, p: PendingRepause | null) {
  try {
    const all = readPending();
    if (p) all[jobId] = p; else delete all[jobId];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch { /* without localStorage the guardian keeps working in memory */ }
}

/** Waits for the engine to pick up the run. `true` if it started.
 *
 *  Checks BEFORE sleeping on purpose: when resuming an old re-pause, the run
 *  already happened and the fingerprint already changed -- without this first
 *  read the guardian would report "never started" on something that ran an
 *  hour ago. */
async function waitForStart(
  cfg: PortalConfig, jobId: string, fingerprint: string, deadline: number,
): Promise<boolean> {
  for (;;) {
    let jobs: CronJob[] | null = null;
    try { jobs = (await getJobs(cfg))?.jobs ?? []; } catch { /* retries */ }
    if (jobs) {
      const j = (jobs as JobWithExecution[]).find((x) => x.id === jobId);
      if (!j) return false; // the task no longer exists: nothing to pause
      if (fingerprintOf(j) !== fingerprint) return true;
    }
    if (Date.now() >= deadline) return false;
    await sleep(POLL_MS);
  }
}

async function rePause(
  cfg: PortalConfig, jobId: string, fingerprint: string, deadline: number,
  patch: (v: Partial<Run>) => void, onChange: () => void,
): Promise<void> {
  const started = await waitForStart(cfg, jobId, fingerprint, deadline);
  patch({ phase: "re-pausing" });
  try {
    await jobAction(cfg, jobId, "pause");
    notePending(jobId, null);
    patch({
      phase: "done", ok: true,
      message: started
        ? "Ya corrió esta vez y quedó de nuevo en pausa."
        : "No llegó a arrancar, así que lo dejé en pausa como estaba. Probá de nuevo más tarde.",
    });
  } catch (e) {
    // The only case where the pause is lost. Said, with the next step.
    patch({
      phase: "error", ok: false,
      message: `Lo mandé a correr pero no pude volver a pausarlo (${errorMessage(e)}). Pausalo vos acá al lado.`,
    });
  }
  onChange();
}

function clearLater(jobId: string) {
  setTimeout(() => {
    const v = flights.get(jobId);
    if (v && !inFlight(v)) { flights.delete(jobId); notify(); }
  }, NOTICE_MS);
}

/** "Probarlo ahora": runs it ONCE and, if it was paused, gives the pause back. */
export async function runOnce(
  cfg: PortalConfig, jobId: string, opts: { paused: boolean; fingerprint: string },
  onChange: () => void,
): Promise<void> {
  if (inFlight(flights.get(jobId) ?? null)) return;
  const patch = (v: Partial<Run>) => {
    const before = flights.get(jobId);
    if (!before) return;
    flights.set(jobId, { ...before, ...v });
    notify();
  };
  flights.set(jobId, {
    jobId, phase: "triggering", rePause: opts.paused, ok: true,
    message: opts.paused ? "Lo corro una vez. Sigue en pausa." : "Lo mando a correr…",
  });
  notify();

  const deadline = Date.now() + LIMIT_MS;
  if (opts.paused) notePending(jobId, { since: Date.now(), fingerprint: opts.fingerprint });

  try {
    await jobAction(cfg, jobId, "run");
  } catch (e) {
    notePending(jobId, null);
    patch({ phase: "error", ok: false, message: `No pude (${errorMessage(e)}). Probá de nuevo en un rato.` });
    clearLater(jobId);
    return;
  }
  onChange();

  patch({
    phase: "running",
    message: opts.paused
      ? "Lo mandé a correr. Cuando arranque lo vuelvo a dejar en pausa."
      : "Lo mandé a correr ahora. Puede tardar unos minutos; el resultado aparece acá solo.",
  });

  if (opts.paused) {
    await rePause(cfg, jobId, opts.fingerprint, deadline, patch, onChange);
  } else {
    // With no pause to give back, the flight only holds up the "Trabajando
    // ahora" banner until the engine picks up the run and says so itself.
    await waitForStart(cfg, jobId, opts.fingerprint, deadline);
    patch({ phase: "done", ok: true, message: "Ya arrancó. El resultado aparece acá solo." });
    onChange();
  }
  clearLater(jobId);
}

/** Resumes re-pauses left mid-way (an F5 in the middle). Called when the
 *  screen mounts; without this, a refresh between the "run" and the "pause"
 *  left the flow unpaused forever with nobody saying so. */
export function resumePauseQueue(cfg: PortalConfig, onChange: () => void): void {
  const all = readPending();
  for (const [jobId, p] of Object.entries(all)) {
    if (flights.has(jobId)) continue;
    const since = Number(p?.since) || 0;
    if (!since) { notePending(jobId, null); continue; }
    flights.set(jobId, {
      jobId, phase: "re-pausing", rePause: true, ok: true,
      message: "Estoy terminando de devolverle la pausa a este flujo.",
    });
    notify();
    const patch = (v: Partial<Run>) => {
      const before = flights.get(jobId);
      if (!before) return;
      flights.set(jobId, { ...before, ...v });
      notify();
    };
    // Very old = the run finished a while ago: pause it and done, no waiting.
    const deadline = Date.now() - since > STALE_MS ? 0 : since + LIMIT_MS;
    void rePause(cfg, jobId, String(p?.fingerprint ?? ""), deadline, patch, onChange)
      .then(() => clearLater(jobId));
  }
}
