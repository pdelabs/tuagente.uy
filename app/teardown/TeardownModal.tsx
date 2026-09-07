"use client";

// The free "workflow teardown" modal: two panes — the pitch + a checklist on
// the left, a form on the right. The visitor types the task that eats their day
// and gets an instant, grounded teardown rendered right here (no "we'll email
// you in two days"). Our design system, light-only (the landing has no dark
// mode). Accessible: focus trap, Esc to close, focus-visible rings, aria labels,
// prefers-reduced-motion respected via Tailwind's motion-safe variant.

import { useEffect, useId, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Ban,
  Check,
  Loader2,
  MessageCircle,
  Plug,
  Puzzle,
  ShieldCheck,
  Sparkles,
  Target,
  X,
} from "lucide-react";

// Same number as the rest of the site (page.tsx WHATSAPP / ui.tsx SUPPORT).
const WHATSAPP = "https://wa.me/59899002835";
const MAX_WORKFLOW_CHARS = 1500;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function wa(text: string) {
  return `${WHATSAPP}?text=${encodeURIComponent(text)}`;
}

type Teardown = {
  headline: string;
  automation_fit: "buena" | "parcial" | "todavia-no";
  recommended: string;
  capabilities: { name: string; why: string }[];
  integrations: string[];
  nunca: string;
  pilot: string;
  kpi: string;
  honesty: string;
};

type Phase = "form" | "loading" | "result" | "error";

const CHECKLIST = [
  "El agente y el plugin que te escribiríamos primero, con qué capacidades nuestras lo cubrimos.",
  "Qué hay que conectar de lo que ya usás, y qué habría que escribir a medida.",
  "El piloto más chico que ya sirve, con el número para saber si valió la pena.",
];

const FIT: Record<Teardown["automation_fit"], { label: string; box: string; ink: string }> = {
  buena: { label: "Conviene automatizarlo", box: "bg-c-green", ink: "text-c-green-ink" },
  parcial: { label: "Se puede, con matices", box: "bg-c-amber", ink: "text-c-amber-ink" },
  "todavia-no": { label: "Todavía no te conviene", box: "bg-c-coral", ink: "text-c-coral-ink" },
};

export default function TeardownModal({ onClose }: { onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>("form");
  const [email, setEmail] = useState("");
  const [workflow, setWorkflow] = useState("");
  const [touched, setTouched] = useState(false);
  const [teardown, setTeardown] = useState<Teardown | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [mounted, setMounted] = useState(false);

  const panelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const titleId = useId();

  const emailOk = EMAIL_RE.test(email.trim());
  const workflowOk = workflow.trim().length > 0;

  // Mount transition + focus trap + Esc + body scroll lock.
  useEffect(() => {
    setMounted(true);
    firstFieldRef.current?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const focusables = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => el.offsetParent !== null);
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKey, true);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!emailOk || !workflowOk || phase === "loading") return;
    setPhase("loading");
    setErrorMsg("");
    try {
      const r = await fetch("/api/teardown", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim(), workflow: workflow.trim() }),
      });
      if (r.ok) {
        const data = await r.json();
        if (data?.teardown) {
          setTeardown(data.teardown as Teardown);
          setPhase("result");
          scrollRef.current?.scrollTo({ top: 0 });
          return;
        }
      }
      if (r.status === 400) {
        setErrorMsg("Revisá el mail y contanos el workflow en una o dos líneas.");
        setPhase("form");
        return;
      }
      if (r.status === 429) {
        setErrorMsg("Probaste varias veces seguidas. Esperá un ratito o escribinos por WhatsApp.");
        setPhase("error");
        return;
      }
      // 503 (sin API key) o cualquier otro: caemos al WhatsApp.
      setPhase("error");
    } catch {
      setPhase("error");
    }
  }

  return (
    <div
      className={`fixed inset-0 z-[100] flex items-stretch justify-center bg-ink/50 p-0 sm:items-center sm:p-6 ${
        mounted ? "opacity-100" : "opacity-0"
      } motion-safe:transition-opacity motion-safe:duration-200`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`relative flex w-full max-w-4xl flex-col overflow-hidden bg-white sm:max-h-[90vh] sm:rounded-card ${
          mounted ? "opacity-100 sm:scale-100" : "opacity-0 sm:scale-95"
        } motion-safe:transition motion-safe:duration-200 motion-safe:ease-out`}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar"
          className="absolute right-3 top-3 z-10 grid h-9 w-9 place-items-center rounded-full bg-white/80 text-ink-soft transition hover:bg-ink/5 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <X size={18} />
        </button>

        <div ref={scrollRef} className="grid flex-1 overflow-y-auto sm:grid-cols-2">
          {/* Left pane: the pitch + what you get. */}
          <aside className="flex flex-col gap-6 bg-c-violet p-7 sm:p-9">
            <span className="inline-flex w-fit items-center gap-2 rounded-pill bg-white/70 px-4 py-1.5 text-sm font-bold text-c-violet-ink">
              <Sparkles size={15} /> Gratis y al toque
            </span>
            <div>
              <h2
                id={titleId}
                className="text-3xl font-extrabold leading-tight tracking-tight text-c-violet-ink sm:text-4xl"
              >
                ¿Qué tarea te está comiendo el día?
              </h2>
              <p className="mt-4 text-lg text-c-violet-ink/80">
                Contanos el trabajo que repetís todas las semanas y te devolvemos, en el momento, cómo lo
                resolvería tu agente. Sin llamada y sin esperar dos días. Y si automatizarlo todavía no te
                conviene, también te lo decimos.
              </p>
            </div>
            <ul className="space-y-3">
              {CHECKLIST.map((item) => (
                <li key={item} className="flex items-start gap-2.5">
                  <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-white/70">
                    <Check size={13} className="text-c-violet-ink" />
                  </span>
                  <span className="text-c-violet-ink/85">{item}</span>
                </li>
              ))}
            </ul>
            <p className="mt-auto rounded-2xl bg-white/50 p-4 text-sm font-semibold text-c-violet-ink/80">
              Es la antesala del diagnóstico: esto es gratis y automático; el diagnóstico va más a fondo, con
              tu caso a la vista.
            </p>
          </aside>

          {/* Right pane: form -> loading -> result -> error. */}
          <div className="p-7 sm:p-9">
            {phase === "form" && (
              <form onSubmit={submit} noValidate className="flex h-full flex-col">
                <div className="space-y-5">
                  <div>
                    <label htmlFor="td-email" className="mb-1.5 block text-sm font-bold text-ink">
                      Email de trabajo
                    </label>
                    <input
                      ref={firstFieldRef}
                      id="td-email"
                      type="email"
                      autoComplete="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="vos@tuempresa.com"
                      aria-invalid={touched && !emailOk}
                      className="w-full rounded-xl border border-black/[0.12] bg-surface px-4 py-3 text-ink outline-none transition placeholder:text-ink-soft/60 focus:border-primary focus-visible:ring-2 focus-visible:ring-primary/20"
                    />
                    {touched && !emailOk && (
                      <p className="mt-1.5 text-sm text-c-coral-ink">Poné un mail válido.</p>
                    )}
                  </div>

                  <div>
                    <label htmlFor="td-workflow" className="mb-1.5 block text-sm font-bold text-ink">
                      ¿Qué workflow querés que mejore?
                    </label>
                    <textarea
                      id="td-workflow"
                      required
                      rows={5}
                      maxLength={MAX_WORKFLOW_CHARS}
                      value={workflow}
                      onChange={(e) => setWorkflow(e.target.value)}
                      placeholder="Ej: calificar los mensajes de WhatsApp, cargar el pedido y avisar al depósito."
                      aria-invalid={touched && !workflowOk}
                      className="w-full resize-y rounded-xl border border-black/[0.12] bg-surface px-4 py-3 text-ink outline-none transition placeholder:text-ink-soft/60 focus:border-primary focus-visible:ring-2 focus-visible:ring-primary/20"
                    />
                    <div className="mt-1.5 flex items-center justify-between">
                      {touched && !workflowOk ? (
                        <p className="text-sm text-c-coral-ink">Contanos qué tarea querés sacarte de encima.</p>
                      ) : (
                        <span />
                      )}
                      <span className="text-xs text-ink-soft/70">
                        {workflow.length}/{MAX_WORKFLOW_CHARS}
                      </span>
                    </div>
                  </div>

                  {errorMsg && <p className="text-sm text-c-coral-ink">{errorMsg}</p>}
                </div>

                <div className="mt-6">
                  <button
                    type="submit"
                    disabled={!emailOk || !workflowOk}
                    className="group inline-flex w-full items-center justify-center gap-2 rounded-pill bg-primary px-6 py-4 text-base font-bold text-white transition hover:bg-primary-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:pointer-events-none disabled:opacity-40"
                  >
                    Armá mi teardown
                    <ArrowRight size={18} className="transition group-hover:translate-x-1" />
                  </button>
                  <p className="mt-3 text-xs text-ink-soft/80">
                    Te lo mostramos acá mismo. Guardamos tu mail para escribirte solo sobre esto.
                  </p>
                </div>
              </form>
            )}

            {phase === "loading" && (
              <div className="flex h-full min-h-[22rem] flex-col items-center justify-center text-center">
                <Loader2 size={28} className="animate-spin text-primary" />
                <p className="mt-4 text-lg font-bold text-ink">Armando tu teardown…</p>
                <p className="mt-1 max-w-xs text-sm text-ink-soft">
                  Estamos cruzando tu tarea con lo que sabemos hacer. Son unos segundos.
                </p>
              </div>
            )}

            {phase === "error" && (
              <div className="flex h-full min-h-[22rem] flex-col items-center justify-center text-center">
                <span className="grid h-12 w-12 place-items-center rounded-2xl bg-c-coral text-c-coral-ink">
                  <AlertTriangle size={22} />
                </span>
                <p className="mt-4 text-lg font-bold text-ink">Se nos cortó el teardown en vivo</p>
                <p className="mt-1 max-w-sm text-sm text-ink-soft">
                  {errorMsg || "No pudimos armarlo ahora mismo. Escribinos por WhatsApp y te lo hacemos con tu caso a la vista."}
                </p>
                <a
                  href={wa("Hola! Quería probar el teardown de mi workflow: ")}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-6 inline-flex items-center gap-2 rounded-pill bg-c-green px-5 py-3 text-sm font-extrabold text-c-green-ink transition hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  <MessageCircle size={16} /> Escribinos por WhatsApp
                </a>
              </div>
            )}

            {phase === "result" && teardown && (
              <Result teardown={teardown} workflow={workflow} onReset={() => setPhase("form")} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Result({
  teardown,
  workflow,
  onReset,
}: {
  teardown: Teardown;
  workflow: string;
  onReset: () => void;
}) {
  const fit = FIT[teardown.automation_fit];
  const notRecommended = teardown.automation_fit === "todavia-no";
  const waMsg = `Hola! Hice el teardown de este workflow: "${workflow}". Quiero avanzar con el diagnóstico.`;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <span className={`inline-flex w-fit items-center gap-2 rounded-pill px-3.5 py-1.5 text-xs font-extrabold ${fit.box} ${fit.ink}`}>
          {notRecommended ? <AlertTriangle size={13} /> : <Sparkles size={13} />} {fit.label}
        </span>
        {teardown.headline && (
          <h3 className="mt-3 text-2xl font-extrabold leading-tight tracking-tight text-ink">
            {teardown.headline}
          </h3>
        )}
      </div>

      <Section icon={Puzzle} title="Lo que te armaríamos">
        <p className="text-ink-soft">{teardown.recommended}</p>
        {teardown.capabilities.length > 0 && (
          <ul className="mt-3 space-y-2.5">
            {teardown.capabilities.map((c) => (
              <li key={c.name} className="flex items-start gap-2.5">
                <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                  <Check size={12} />
                </span>
                <span className="text-sm text-ink-soft">
                  <strong className="font-extrabold text-ink">{c.name}</strong> — {c.why}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {teardown.integrations.length > 0 && (
        <Section icon={Plug} title="Qué hay que conectar">
          <div className="flex flex-wrap gap-2">
            {teardown.integrations.map((x) => (
              <span
                key={x}
                className="rounded-pill bg-c-green px-3.5 py-1.5 text-xs font-extrabold text-c-green-ink"
              >
                {x}
              </span>
            ))}
          </div>
        </Section>
      )}

      <div className="flex items-start gap-2.5 rounded-2xl bg-ink/[0.04] p-4">
        <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-c-coral text-c-coral-ink">
          <Ban size={12} />
        </span>
        <p className="text-sm text-ink-soft">
          <strong className="font-extrabold text-ink">Nunca</strong> {teardown.nunca}
        </p>
      </div>

      <div className="rounded-2xl bg-c-green/60 p-4">
        <p className="flex items-center gap-2 text-sm font-extrabold text-c-green-ink">
          <Target size={15} /> El piloto más chico
        </p>
        <p className="mt-1.5 text-sm text-c-green-ink/85">{teardown.pilot}</p>
        {teardown.kpi && (
          <p className="mt-2 text-sm text-c-green-ink/85">
            <strong className="font-extrabold">Se mide con:</strong> {teardown.kpi}
          </p>
        )}
      </div>

      {teardown.honesty && (
        <div
          className={`flex items-start gap-2.5 rounded-2xl p-4 ${
            notRecommended ? "bg-c-amber" : "bg-c-violet/60"
          }`}
        >
          <span
            className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full ${
              notRecommended ? "bg-white/70 text-c-amber-ink" : "bg-white/70 text-c-violet-ink"
            }`}
          >
            {notRecommended ? <AlertTriangle size={12} /> : <ShieldCheck size={12} />}
          </span>
          <p className={`text-sm ${notRecommended ? "text-c-amber-ink/90" : "text-c-violet-ink/90"}`}>
            <strong className="font-extrabold">Te lo decimos derecho:</strong> {teardown.honesty}
          </p>
        </div>
      )}

      <div className="mt-1 border-t border-black/[0.07] pt-5">
        <p className="text-sm text-ink-soft">
          ¿Te cierra? El próximo paso es el diagnóstico: una llamada y un informe con los números de tu caso.
        </p>
        <div className="mt-3 flex flex-col gap-2.5 sm:flex-row">
          <a
            href={wa(waMsg)}
            target="_blank"
            rel="noopener noreferrer"
            className="group inline-flex flex-1 items-center justify-center gap-2 rounded-pill bg-primary px-5 py-3 text-sm font-extrabold text-white transition hover:bg-primary-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            Agendá el diagnóstico
            <ArrowRight size={15} className="transition group-hover:translate-x-1" />
          </a>
          <button
            type="button"
            onClick={onReset}
            className="inline-flex items-center justify-center gap-2 rounded-pill border border-black/10 bg-white px-5 py-3 text-sm font-bold text-ink transition hover:bg-black/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            Probar otro workflow
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Puzzle;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="flex items-center gap-2 text-sm font-extrabold text-ink">
        <span className="grid h-6 w-6 place-items-center rounded-lg bg-primary/10 text-primary">
          <Icon size={14} />
        </span>
        {title}
      </p>
      <div className="mt-2">{children}</div>
    </div>
  );
}
