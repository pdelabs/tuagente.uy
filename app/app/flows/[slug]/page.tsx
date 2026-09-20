"use client";

// A flow's detail: all of its results, its trigger, and -- cheap transparency
// -- the "how I work" the agent follows (the body of FLUJO.md, already
// written with no jargon). It is the page reached by clicking the card in
// /app/flows.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft, ArrowRight, BookOpen, Clock, FolderOpen, MessageSquare,
  RefreshCw, Workflow, Zap, type LucideIcon,
} from "lucide-react";
import {
  createTicket, connectionLabel, getFlowDetail, getFlows, getJobs, loadConfig,
  type CronJob, type Flow, type FlowDetail, type FlowRun, type HttpError, type PortalConfig,
} from "../../lib/agent";
import { whenItHappened } from "../../lib/labels";
import {
  crossTask, inFlight, realStatus, resumePauseQueue, useRuns, runOf,
} from "../runs";
import { FlowActions, StatusBanner, Runs, WhyItCouldNot } from "../FlowStatus";
import Markdown from "../../lib/Markdown";
import { EntityProvider } from "../../lib/EntityViewer";
import { EntityChip } from "../../lib/entities";
import {
  StaleLinkNotice, Btn, Card, Chip, ErrorState, IconBtn, PageHeader, Spinner,
} from "../../lib/ui";
import { CopyLink, PARAM } from "../../lib/routes";

const WRAP = "mx-auto max-w-4xl px-6 py-6 md:px-8";

const TRIGGER_ICON: Record<string, LucideIcon> = {
  drive: FolderOpen,
  schedule: Clock,
  webhook: Zap,
  // Runs when something arrives: a comment, a message, a mail.
  event: Zap,
  request: MessageSquare,
};

function timeAgo(mtime: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000 - mtime));
  if (s < 3600) return `hace ${Math.max(1, Math.floor(s / 60))} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  const d = Math.floor(s / 86400);
  return d === 1 ? "ayer" : `hace ${d} días`;
}

function fileName(path: string): string {
  const base = (path || "").split("/").pop() || path;
  return base.replace(/^\d{4}-\d{2}-\d{2}[-_ ]/, "") || base;
}

export default function FlowDetailPage() {
  const params = useParams<{ slug: string }>();
  const slug = String(params?.slug ?? "");
  const [cfg, setCfg] = useState<PortalConfig | null>(null);
  const [flow, setFlow] = useState<FlowDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // A slug that does not exist is NOT the agent going down. Before, this
  // screen answered "No pude hablar con tu agente" -- the pattern the routes
  // doc declares eliminated -- to a stale link, which is the most normal
  // thing in the world: flows get renamed and retired. Now it is said in
  // plain words and the list of what the agent does have is shown, which is
  // where they can keep going.
  const [doesNotExist, setDoesNotExist] = useState(false);
  const [others, setOthers] = useState<Flow[] | null>(null);
  // The flow's scheduled task: the next run, the last one's error and
  // whether it is paused. Without it the detail still works, with less to
  // tell.
  const [jobs, setJobs] = useState<CronJob[] | null>(null);

  useEffect(() => setCfg(loadConfig()), []);

  const load = useCallback(() => {
    if (!cfg || !slug) return;
    setLoading(true);
    getJobs(cfg)
      .then((r) => setJobs(Array.isArray(r?.jobs) ? r.jobs : []))
      .catch(() => setJobs(null));
    getFlowDetail(cfg, slug)
      .then((f) => { setFlow(f); setError(null); setDoesNotExist(false); })
      .catch((e: HttpError) => {
        if (e?.status === 404 || /^404\b/.test(e?.message ?? "")) {
          setDoesNotExist(true);
          setError(null);
          getFlows(cfg).then((r) => setOthers(r.flows ?? [])).catch(() => setOthers([]));
        } else {
          setError(e?.message || "error");
        }
      })
      .finally(() => setLoading(false));
  }, [cfg, slug]);

  useEffect(() => { load(); }, [load]);
  // A re-pause left mid-way is resumed on entry here too: the flow's link
  // gets shared, and an F5 can land on the detail. Mind the order -- the
  // hooks all go BEFORE the conditional returns below.
  useEffect(() => { if (cfg) resumePauseQueue(cfg, load); }, [cfg, load]);
  useRuns();

  if (!cfg) return <div className={WRAP}><Spinner /></div>;
  if (doesNotExist) {
    return (
      <div className={WRAP}>
        <Link
          href="/app/flows"
          className="mb-3 inline-flex items-center gap-1 text-[13px] font-semibold text-ink-soft transition hover:text-ink"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Flujos
        </Link>
        <StaleLinkNotice>
          Ese trabajo ya no está — puede que lo hayamos renombrado o dado de baja. Abajo
          están los que tu agente tiene hoy.
        </StaleLinkNotice>
        {others === null ? <Spinner /> : others.length === 0 ? (
          <p className="text-sm text-ink-soft">Tu agente todavía no tiene ningún trabajo armado.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {others.map((f) => (
              <Link key={f.slug} href={`/app/flows/${encodeURIComponent(f.slug)}`}>
                <Card className="transition hover:border-black/[0.14]">
                  <p className="text-sm font-semibold text-ink">{f.name}</p>
                  {f.client_summary && (
                    <p className="mt-0.5 text-[13px] leading-snug text-ink-soft">{f.client_summary}</p>
                  )}
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    );
  }
  if (error && !flow) return <div className={WRAP}><ErrorState message={error} onRetry={load} /></div>;
  if (!flow) return <div className={WRAP}><Spinner /></div>;

  const Icon = TRIGGER_ICON[flow.trigger_type] ?? Workflow;
  const cross = crossTask(flow, jobs);
  const e = realStatus(flow, cross, {
    portalTriggered: inFlight(runOf(cross.kind === "task" ? cross.job.id : null)),
  });

  return (
    <EntityProvider cfg={cfg}>
      <div className={WRAP}>
        <Link
          href="/app/flows"
          className="mb-3 inline-flex items-center gap-1 text-[13px] font-semibold text-ink-soft transition hover:text-ink"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Flujos
        </Link>

        <PageHeader
          title={flow.name}
          subtitle={flow.client_summary}
          actions={
            <>
              <CopyLink label="Copiar el link de este flujo" />
              <IconBtn label="Actualizar" disabled={loading} onClick={load}>
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              </IconBtn>
            </>
          }
        />

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <StatusBanner e={e} />
          {flow.trigger && (
            <span className="flex items-center gap-1.5 text-[13px] text-ink-soft">
              <Icon className="h-3.5 w-3.5 shrink-0" />
              {flow.trigger}
            </span>
          )}
        </div>

        {/* Ran, how it went, when the next one is -- and the buttons to touch
            it. Same as the list's card, so the client does not have to learn
            two different screens. */}
        <Runs e={e} className="mb-3" />
        <div className="mb-5 flex flex-col gap-3">
          {/* The real reason is NEVER suppressed, not here either: it used to
              be hidden behind `status !== "incomplete"`, so a flow missing a
              connection never said why it had truly failed. */}
          <WhyItCouldNot cfg={cfg} e={e} name={flow.name} onChange={load} />
          <FlowActions
            cfg={cfg}
            e={e}
            name={flow.name}
            trigger={flow.trigger}
            onChange={load}
          />
        </div>

        {/* Same as the list: with name and reason, and the link points at the
            specific card. The catalog is not fetched here (one more call for
            a detail screen is not worth it): the label comes from the table
            of known ones and the flow supplies the reason. */}
        {e.missingConnections.length > 0 && (
          <div className="mb-5 rounded-lg border border-c-amber bg-c-amber/25 p-3">
            <p className="text-[13px] font-semibold text-c-amber-ink">
              Le falta {e.missingConnections.map((c) => connectionLabel(c)).join(" y ")}.
            </p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-c-amber-ink/85">
              Hasta que esté conectada, este trabajo queda a medias: te dejo lo que puedo
              y el resto espera.
            </p>
            <Link
              href={`/app/connections?connection=${encodeURIComponent(e.missingConnections[0])}`}
              className="mt-2.5 inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-semibold text-white transition hover:bg-primary-dark"
            >
              Conectar {connectionLabel(e.missingConnections[0])}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        )}

        <section className="mb-6">
          <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-soft">
            Resultados
            <span className="ml-1.5 tabular-nums text-ink-soft/70">{flow.results_total}</span>
          </h2>
          {flow.results.length === 0 ? (
            <p className="text-[13px] text-ink-soft">
              Todavía no hay resultados: cuando el flujo produzca algo, queda acá.
            </p>
          ) : (
            <Card className="!p-3">
              <ul className="flex flex-col gap-1.5">
                {flow.results.map((r) => (
                  <li key={r.path} className="flex items-center gap-2">
                    {/* min-w-0 + flex-1: the chip truncates INSIDE the row. */}
                    <span className="min-w-0 flex-1">
                      <EntityChip entity={{ kind: "file", path: r.path }} label={fileName(r.path)} />
                    </span>
                    <span className="shrink-0 whitespace-nowrap text-[11px] text-ink-soft">
                      {timeAgo(r.mtime)}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </section>

        <PastRuns runs={flow.runs ?? []} />

        {flow.how && (
          <section className="mb-6">
            <h2 className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-ink-soft">
              <BookOpen className="h-3.5 w-3.5" /> Cómo lo trabaja tu agente
            </h2>
            <Card>
              <Markdown>{flow.how}</Markdown>
            </Card>
          </section>
        )}

        <RequestChange cfg={cfg} flow={flow} />
      </div>
    </EntityProvider>
  );
}

const RUN_OUTCOME: Record<string, { label: string; tone: "green" | "coral" | "amber" | "violet" }> = {
  completed: { label: "Salió bien", tone: "green" },
  failed: { label: "Falló", tone: "coral" },
  paused: { label: "Esperando tu ok", tone: "amber" },
  running: { label: "Trabajando ahora", tone: "violet" },
};

/** Every run of this flow, newest first, and THE WAY INTO ITS CONVERSATION.
 *  A run is a conversation the client did not type in, and the chat's list
 *  does not carry them (a flow every 15 minutes buried the real ones): this is
 *  where one is opened. A run with no `session_id` went well long enough ago
 *  that the engine let its transcript go; the row still says it ran. */
function PastRuns({ runs }: { runs: FlowRun[] }) {
  if (runs.length === 0) return null;
  return (
    <section className="mb-6">
      <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-soft">
        Últimas corridas
      </h2>
      <Card className="!p-0">
        <ul className="divide-y divide-black/[0.07]">
          {runs.map((r) => {
            const outcome = RUN_OUTCOME[r.status];
            const when = whenItHappened(r.finished_at ?? r.started_at);
            const row = (
              <>
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink first-letter:uppercase">
                  {when}
                  {r.manual && <span className="ml-1.5 text-ink-soft">· la pediste vos</span>}
                </span>
                {outcome && <Chip tone={outcome.tone}>{outcome.label}</Chip>}
                {r.session_id && <ArrowRight className="h-3.5 w-3.5 shrink-0 text-ink-soft" />}
              </>
            );
            return (
              <li key={r.id}>
                {r.session_id ? (
                  <Link
                    href={`/app/chat?${PARAM.conversation}=${encodeURIComponent(r.session_id)}`}
                    className="flex items-center gap-2.5 px-3.5 py-2.5 transition hover:bg-black/[0.02]"
                  >
                    {row}
                  </Link>
                ) : (
                  <div className="flex items-center gap-2.5 px-3.5 py-2.5">{row}</div>
                )}
              </li>
            );
          })}
        </ul>
      </Card>
    </section>
  );
}

/** The client asks for a change in THEIR OWN words; it travels as a ticket
 *  and the agent edits FLUJO.md (or PREFERENCIAS.md if it applies to
 *  everyone) as it already knows how. No config forms: the prompt IS the
 *  interface. */
function RequestChange({ cfg, flow }: { cfg: PortalConfig; flow: FlowDetail }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    if (!text.trim()) return;
    setSending(true);
    setError(null);
    try {
      const scope =
        `Aplica solo a este flujo: actualizá las instrucciones de flujos/${flow.slug}/FLUJO.md.`;
      const res = await createTicket(cfg, {
        title: `Ajustar el flujo ${flow.name}`,
        body:
          `Pedido del cliente desde la página del flujo "${flow.name}":\n\n` +
          `"${text.trim()}"\n\n${scope}\n` +
          "Anotá al final del archivo qué cambiaste y cuándo, y cerrá este ticket " +
          "contando el cambio en una línea, en palabras del cliente.",
      });
      if (!res.ok) throw new Error("No se pudo pedir el cambio.");
      setDone(text.trim());
      setText("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <section>
      <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-soft">
        Pedir un cambio
      </h2>
      <Card className="flex flex-col gap-2.5">
        <p className="text-[13px] leading-snug text-ink-soft">
          Contale en tus palabras qué querés distinto — &ldquo;no uses emojis&rdquo;,
          &ldquo;las frases más cortas&rdquo;, &ldquo;avisame también por Telegram&rdquo;.
          Lo aplica solo y el cambio queda a la vista acá arriba.
        </p>
        <textarea
          value={text}
          onChange={(e) => { setText(e.target.value); setDone(null); }}
          placeholder="Qué querés cambiar…"
          rows={2}
          className="w-full resize-y rounded-lg border border-black/[0.1] bg-white p-3 text-sm text-ink outline-none transition placeholder:text-ink-soft/50 focus:border-primary/50"
        />
        <div>
          <Btn size="sm" onClick={send} disabled={!text.trim() || sending}>
            {sending ? "Mandando…" : "Pedírselo"}
          </Btn>
        </div>
        {done && (
          <p className="text-[13px] font-medium text-c-green-ink">
            Pedido. Lo ves avanzar en el Tablero, y estas instrucciones se actualizan solas.
          </p>
        )}
        {error && <p className="text-[13px] font-medium text-c-coral-ink">{error}</p>}
      </Card>
    </section>
  );
}
