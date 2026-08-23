"use client";

// A flow's status, told in full: the banner, when it ran, how it went, when
// the next one is, why it could not -- and the buttons to touch it.
//
// Lives here and not in each page because the list and the detail used to
// show the same green chip with two copies of the same ternary, and both lied
// the same way.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle, CalendarClock, CheckCircle2, HelpCircle, Loader2, Pause, Play, Zap,
} from "lucide-react";
import { jobAction, type PortalConfig } from "../lib/agent";
import { Chip, SUPPORT } from "../lib/ui";
import { buildChatLink } from "../lib/flowExamples";
import {
  runOnce, inFlight, useRuns, runOf, type RealStatus, type Note,
} from "./runs";

export function StatusBanner({ e }: { e: RealStatus }) {
  return <Chip tone={e.tone}>{e.banner}</Chip>;
}

/** The two lines the two clients asked for separately: what happened last
 *  time and when the next one is. Plus the third, which was missing: when the
 *  screen could not confirm anything. */
export function Runs({ e, className = "" }: { e: RealStatus; className?: string }) {
  if (!e.lastRun && !e.nextRun && !e.unconfirmed) return null;
  const Icon =
    e.key === "failed" ? AlertTriangle
      : e.key === "uncertain" || e.key === "delayed" || e.key === "no-task" ? HelpCircle
        : e.key === "ok" ? CheckCircle2
          : e.key === "running" ? Loader2
            : null;
  return (
    <div className={`flex flex-col gap-0.5 ${className}`}>
      {e.lastRun && (
        <p className={`flex items-center gap-1.5 text-[12.5px] ${
          e.key === "failed" ? "font-semibold text-c-coral-ink" : "text-ink-soft"
        }`}>
          {Icon && (
            <Icon className={`h-3.5 w-3.5 shrink-0 ${
              e.key === "ok" ? "text-c-green-ink"
                : e.key === "running" ? "animate-spin text-primary" : ""
            }`} />
          )}
          {e.lastRun}
        </p>
      )}
      {e.nextRun && <p className="text-[12.5px] text-ink-soft">{e.nextRun}</p>}
      {/* Without the cross-check against the engine, the screen cannot assert
          anything in green, and has to say why it fell short: before, the
          buttons simply disappeared and the banner kept saying "Activo". */}
      {e.unconfirmed && (
        <p className="text-[12.5px] text-ink-soft/85">
          No pude confirmar con tu agente cómo viene: esto es lo último que sé y
          puede haber cambiado.
        </p>
      )}
    </div>
  );
}

/** What happened and what can be done. The engine's own text is not hidden:
 *  it is collapsed.
 *
 *  «RuntimeError: No LLM provider configured. Run `hermes model`…» was the
 *  real error behind the veterinary client's two runs. Showing it as is is a
 *  scare and an order she cannot follow; hiding it is covering up the truth
 *  again.
 *
 *  AND THIS BLOCK IS NEVER SUPPRESSED ANYMORE. At Faro, a flow that failed
 *  with «no LLM provider» showed «Le falta una conexión · Conectar correo»
 *  and the real reason disappeared: the client connects the email and it
 *  fails again. The missing connection is secondary information and goes
 *  below, in its own block; the real cause is always told. */
export function WhyItCouldNot({ cfg, e, name, onChange }: {
  cfg?: PortalConfig;
  e: RealStatus;
  name?: string;
  onChange?: () => void;
}) {
  const [showRaw, setShowRaw] = useState(false);
  useRuns();
  const note: Note | null = e.note;
  if (!note) return null;
  const flight = runOf(e.jobId);
  const running = inFlight(flight);
  const coral = note.tone === "coral";

  return (
    <div className={`rounded-lg border p-3 ${
      coral ? "border-c-coral bg-c-coral/25" : "border-c-amber bg-c-amber/25"
    }`}>
      <p className={`text-[13px] font-semibold leading-snug ${
        coral ? "text-c-coral-ink" : "text-c-amber-ink"
      }`}>
        {note.what}
      </p>
      <p className={`mt-1 text-[12.5px] leading-relaxed ${
        coral ? "text-c-coral-ink/85" : "text-c-amber-ink/85"
      }`}>
        {note.detail}
      </p>

      {/* THE RETRY GOES FIRST. For «no llm provider» the screen used to say
          "you can't unblock this yourself" and only offered Notify Us -- and
          the run that got unblocked in the lab got unblocked with exactly
          this button. */}
      {note.retryable && cfg && e.jobId && (
        <div className="mt-2">
          <p className={`mb-1.5 text-[12.5px] leading-relaxed ${
            coral ? "text-c-coral-ink/85" : "text-c-amber-ink/85"
          }`}>
            Puede ser algo pasajero: probalo ahora y fijate.
          </p>
          <button
            onClick={() => runOnce(
              cfg, e.jobId as string,
              { paused: e.paused, fingerprint: e.fingerprint },
              onChange ?? (() => {}),
            )}
            disabled={running}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-[13px] font-semibold text-white transition hover:bg-primary-dark disabled:opacity-50"
          >
            {running
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <Zap className="h-3.5 w-3.5" />}
            Probarlo ahora
          </button>
          {e.paused && (
            <span className="ml-2 text-[12px] text-c-coral-ink/80">
              Lo corro una vez y sigue en pausa.
            </span>
          )}
        </div>
      )}

      {note.canReschedule && name && (
        <Link
          href={buildChatLink(
            `El flujo "${name}" no tiene ninguna tarea programada que lo dispare. ` +
            "Volvé a programarlo como estaba y confirmame el día y la hora que le dejaste.")}
          className="mt-2 inline-flex h-8 items-center rounded-lg bg-primary px-3 text-[13px] font-semibold text-white transition hover:bg-primary-dark"
        >
          Pedirle que lo vuelva a programar
        </Link>
      )}

      {note.canDo && (
        <p className={`mt-2 text-[12.5px] leading-relaxed ${
          coral ? "text-c-coral-ink/85" : "text-c-amber-ink/85"
        }`}>
          {note.canDo}
        </p>
      )}

      {note.notifyUs && (
        <div className="mt-2">
          <a
            href={SUPPORT.whatsapp}
            target="_blank"
            rel="noopener noreferrer"
            className={`text-[12.5px] font-semibold underline underline-offset-2 ${
              coral ? "text-c-coral-ink" : "text-c-amber-ink"
            }`}
          >
            {note.retryable || note.canReschedule
              ? "Si vuelve a pasar, avisanos y lo miramos"
              : "Avisanos para que lo miremos"}
          </a>
        </div>
      )}

      {note.raw && (
        <div className="mt-2">
          <button
            onClick={() => setShowRaw((v) => !v)}
            className={`text-[11.5px] font-semibold underline underline-offset-2 transition ${
              coral ? "text-c-coral-ink/80 hover:text-c-coral-ink" : "text-c-amber-ink/80 hover:text-c-amber-ink"
            }`}
          >
            {showRaw ? "Ocultar el detalle técnico" : "Ver el detalle técnico"}
          </button>
          {showRaw && (
            <p className="mt-1.5 break-words rounded-md bg-white/60 p-2 font-mono text-[11px] leading-relaxed text-ink-soft">
              {note.raw}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

type Notice = { text: string; ok: boolean } | null;

/** Pause, resume, try it now — and ask for a schedule change.
 *
 *  «I can't pause it, or change its day, or try it now» -- all three came up
 *  in both reports. Pausing, resuming and running are NATIVE engine verbs
 *  (`POST /api/jobs/{id}/{pause|resume|run}`), they pass CORS and have been
 *  there since the start: they are real buttons.
 *
 *  BUT "run" WAS NOT "run once": the engine implements it by unpausing the
 *  flow (see the guardian in `runs.ts`), so the button silently dismantled
 *  the one valve the client had triggered on purpose. Now "Probarlo ahora"
 *  (Try it now) on a paused flow runs it ONCE and gives the pause back, and it
 *  says so before and after.
 *
 *  Changing the day is NOT possible yet -- it is `PATCH /api/jobs/{id}` and
 *  the gateway does not publish PATCH in `Access-Control-Allow-Methods`,
 *  verified against the lab; noted in `docs/PENDING.md`. Meanwhile the
 *  button neither stays silent nor lies: it goes to chat with the request
 *  already written, which is what both clients ended up doing by hand. */
export function FlowActions({ cfg, e, name, trigger, onChange }: {
  cfg: PortalConfig;
  e: RealStatus;
  name: string;
  trigger?: string;
  onChange: () => void;
}) {
  const [busy, setBusy] = useState<"pause" | "resume" | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  useRuns();
  const flight = runOf(e.jobId);
  const flying = inFlight(flight);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 12_000);
    return () => clearTimeout(t);
  }, [notice]);

  const act = useCallback(async (action: "pause" | "resume") => {
    if (!e.jobId) return;
    setBusy(action);
    setNotice(null);
    try {
      await jobAction(cfg, e.jobId, action);
      setNotice({
        ok: true,
        text: action === "pause"
          ? "Pausado. No va a correr hasta que lo reanudes."
          : "Listo, vuelve a correr en el horario de siempre.",
      });
      onChange();
    } catch (err) {
      setNotice({
        ok: false,
        text: `No pude (${err instanceof Error ? err.message : "error"}). Probá de nuevo en un rato.`,
      });
    } finally {
      setBusy(null);
    }
  }, [cfg, e.jobId, onChange]);

  // With no scheduled task there is nothing to pause or trigger. Staying
  // quiet here is more honest than a dead button -- what CANNOT happen is the
  // silence being the whole explanation: `StatusBanner` and `WhyItCouldNot`
  // take care of that.
  if (!e.jobId) return null;

  const rescheduleLink = buildChatLink(
    `Quiero cambiarle el día y la hora al flujo "${name}"` +
    (trigger ? ` (hoy corre así: ${trigger}).` : ".") +
    " Decime cuándo puede correr y dejámelo cambiado.");

  // When the explanation above already offers the retry as the first step,
  // the button is not repeated: it would be the same verb twice on the same
  // card.
  const retryAbove = Boolean(e.note?.retryable);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {!retryAbove && (
          <SmallButton
            onClick={() => runOnce(
              cfg, e.jobId as string, { paused: e.paused, fingerprint: e.fingerprint }, onChange)}
            loading={flying}
            disabled={flying || busy !== null || e.running}
            icon={Zap}
          >
            Probarlo ahora
          </SmallButton>
        )}
        {e.paused ? (
          <SmallButton
            onClick={() => act("resume")}
            loading={busy === "resume"}
            disabled={flying || busy !== null}
            icon={Play}
          >
            Reanudar
          </SmallButton>
        ) : (
          <SmallButton
            onClick={() => act("pause")}
            loading={busy === "pause"}
            disabled={flying || busy !== null}
            icon={Pause}
          >
            Pausar
          </SmallButton>
        )}
        <Link
          href={rescheduleLink}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-black/10 bg-white px-2.5 text-[12.5px] font-semibold text-ink transition hover:bg-black/[0.03]"
        >
          <CalendarClock className="h-3.5 w-3.5" />
          Cambiar día u hora
        </Link>
      </div>

      {/* BEFORE pressing it: on a paused flow, "Probarlo ahora" does not
          resume it. Said here so the decision is informed, and again when it
          finishes. */}
      {e.paused && !flight && !retryAbove && (
        <p className="text-[12.5px] leading-snug text-ink-soft">
          &laquo;Probarlo ahora&raquo; lo corre una sola vez: sigue en pausa.
        </p>
      )}

      {flight && (
        <p className={`text-[12.5px] font-medium leading-snug ${
          flight.ok ? "text-c-green-ink" : "text-c-coral-ink"
        }`}>
          {flight.message}
        </p>
      )}
      {notice && (
        <p className={`text-[12.5px] font-medium leading-snug ${
          notice.ok ? "text-c-green-ink" : "text-c-coral-ink"
        }`}>
          {notice.text}
        </p>
      )}
    </div>
  );
}

function SmallButton({ onClick, loading, disabled, icon: Icon, children }: {
  onClick: () => void;
  loading: boolean;
  disabled?: boolean;
  icon: typeof Zap;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-black/10 bg-white px-2.5 text-[12.5px] font-semibold text-ink transition hover:bg-black/[0.03] disabled:opacity-50"
    >
      {loading
        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
        : <Icon className="h-3.5 w-3.5" />}
      {children}
    </button>
  );
}
