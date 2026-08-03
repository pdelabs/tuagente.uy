"use client";

// Actividad: todo lo que hizo el agente, en orden cronológico.
// Contrato (adapter v0.3): GET {adapter}/portal/activity →
//   { events: [{ ts, kind: "job_run" | "ticket", label, status }] }
// Agrupado por día (Hoy/Ayer/fecha), refresh silencioso cada 30 s.

import { useCallback, useEffect, useRef, useState } from "react";
import { Activity } from "lucide-react";
import { loadConfig, getActivity, type PortalConfig } from "../lib/agent";
import { Btn, Card, Chip, EmptyState, ErrorState, PageHeader, Spinner } from "../lib/ui";

type ActivityEvent = { ts: string; kind: string; label: string; status: string };

const REFRESH_MS = 30_000;

// Kind crudo del adapter → rótulo legible.
const KIND_LABEL: Record<string, string> = {
  job_run: "Tarea programada",
  ticket: "Ticket",
};

// Puntito de estado: verde OK · coral falla · ámbar en curso ·
// violeta evento de ticket neutral · gris resto.
function dotCls(kind: string, status: string): string {
  const s = (status || "").toLowerCase();
  if (/(^ok$|complet|success|done|deliver|sent|unblock|resolv|entregad|listo)/.test(s)) return "bg-c-green-ink";
  if (/(fail|error|timeout|cancel|reject|rechaz)/.test(s)) return "bg-c-coral-ink";
  if (/(run|progress|pend|claim|start|queue|block|curso|proceso)/.test(s)) return "bg-c-amber-ink";
  if (kind === "ticket") return "bg-c-violet-ink";
  return "bg-ink-soft/50";
}

function hourLabel(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit" });
}

function dayKey(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayLabel(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "Sin fecha";
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(new Date()) - startOf(d)) / 86_400_000);
  if (days === 0) return "Hoy";
  if (days === 1) return "Ayer";
  return d.toLocaleDateString("es-UY", { weekday: "long", day: "numeric", month: "long" });
}

const is404 = (msg: string) => /^404\b/.test(msg);

export default function ActividadPage() {
  const [cfg, setCfg] = useState<PortalConfig | null>(null);
  const [events, setEvents] = useState<ActivityEvent[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const hasData = useRef(false);

  useEffect(() => { setCfg(loadConfig()); }, []);

  const load = useCallback((silent = false) => {
    if (!cfg) return;
    if (!silent) { setEvents(null); setErr(null); }
    getActivity(cfg)
      .then((r) => {
        hasData.current = true;
        setEvents(Array.isArray(r.events) ? r.events : []);
        setErr(null);
      })
      .catch((e: Error) => {
        // En refresh silencioso, si ya tenemos datos, los mantenemos.
        if (!silent || !hasData.current) setErr(e.message || "error");
      });
  }, [cfg]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!cfg) return;
    const t = setInterval(() => load(true), REFRESH_MS);
    return () => clearInterval(t);
  }, [cfg, load]);

  const body = () => {
    if (err && is404(err)) {
      return (
        <>
          <EmptyState
            icon={Activity}
            title="La actividad no está disponible en este agente"
            hint="Tu agente todavía no publica su historial de actividad."
          />
          <div className="flex justify-center"><Btn kind="ghost" size="sm" onClick={() => load()}>Reintentar</Btn></div>
        </>
      );
    }
    if (err) return <ErrorState message={err} onRetry={() => load()} />;
    if (!events) return <Spinner />;
    if (events.length === 0) {
      return (
        <EmptyState
          icon={Activity}
          title="Todavía no hay actividad"
          hint="Cuando tu agente haga algo, lo vas a ver acá."
        />
      );
    }

    const sorted = [...events].sort(
      (a, b) => (new Date(b.ts).getTime() || 0) - (new Date(a.ts).getTime() || 0),
    );
    const groups: { key: string; label: string; items: ActivityEvent[] }[] = [];
    for (const ev of sorted) {
      const key = dayKey(ev.ts);
      const last = groups[groups.length - 1];
      if (last && last.key === key) last.items.push(ev);
      else groups.push({ key, label: dayLabel(ev.ts), items: [ev] });
    }

    return (
      <div className="flex flex-col gap-6">
        {groups.map((g) => (
          <section key={g.key}>
            <h2 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
              {g.label}
            </h2>
            <Card className="overflow-hidden !p-0">
              <ul className="divide-y divide-black/[0.06]">
                {g.items.map((ev, i) => (
                  <li key={`${ev.ts}-${i}`} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="w-12 shrink-0 text-[12px] tabular-nums text-ink-soft">
                      {hourLabel(ev.ts)}
                    </span>
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${dotCls(ev.kind, ev.status)}`}
                    />
                    <p className="min-w-0 flex-1 truncate text-sm text-ink">{ev.label}</p>
                    <span className="flex shrink-0 items-center gap-2">
                      <Chip>{KIND_LABEL[ev.kind] ?? ev.kind}</Chip>
                      {ev.status && (
                        <span className="text-[11px] text-ink-soft">{ev.status}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          </section>
        ))}
      </div>
    );
  };

  return (
    <div className="mx-auto max-w-4xl px-6 py-6 md:px-8">
      <PageHeader title="Actividad" subtitle="Todo lo que tu agente hizo, en orden" />
      {body()}
    </div>
  );
}
