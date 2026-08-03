"use client";

// Actividad: timeline de lo que hizo el agente (corridas de jobs, entregas).
// Contrato (spec 05): GET {adapter}/portal/activity → { events: [{ ts, kind, label, status }] }
// Agrupado por día, fecha relativa, kind como chip, status con color semántico.
// Refresh silencioso cada 30 s.

import { useCallback, useEffect, useRef, useState } from "react";
import { loadConfig, getActivity, type PortalConfig } from "../lib/agent";
import { Btn, Card, Chip, EmptyState, ErrorState, Spinner } from "../lib/ui";

type ActivityEvent = { ts: string; kind: string; label: string; status: string };

const REFRESH_MS = 30_000;

function statusTone(status: string): "green" | "coral" | "amber" | "ink" {
  const s = (status || "").toLowerCase();
  if (/(ok|success|done|complet|deliver|sent|entregad|listo)/.test(s)) return "green";
  if (/(error|fail|timeout|cancel|rechaz)/.test(s)) return "coral";
  if (/(run|progress|pend|start|queue|curso|proceso)/.test(s)) return "amber";
  return "ink";
}

const DOT: Record<string, string> = {
  green: "bg-c-green-ink",
  coral: "bg-c-coral-ink",
  amber: "bg-c-amber-ink",
  ink: "bg-ink-soft",
};

function relTime(ts: string): string {
  const t = new Date(ts).getTime();
  if (Number.isNaN(t)) return "";
  const min = Math.floor((Date.now() - t) / 60_000);
  if (min < 1) return "recién";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? "hace 1 día" : `hace ${d} días`;
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
            emoji="📈"
            title="La actividad no está disponible en este agente"
            hint="Tu agente todavía no publica su historial de actividad."
          />
          <div className="flex justify-center"><Btn kind="ghost" onClick={() => load()}>Reintentar</Btn></div>
        </>
      );
    }
    if (err) return <ErrorState message={err} onRetry={() => load()} />;
    if (!events) return <Spinner />;
    if (events.length === 0) {
      return (
        <EmptyState
          emoji="🌱"
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
            <h2 className="text-xs font-bold uppercase tracking-wide text-ink-soft mb-2 px-1 capitalize">
              {g.label}
            </h2>
            <Card className="!p-0">
              <ul className="divide-y divide-surface">
                {g.items.map((ev, i) => {
                  const tone = statusTone(ev.status);
                  return (
                    <li key={`${ev.ts}-${i}`} className="flex items-center gap-3 px-5 py-3.5">
                      <span
                        className={`h-2.5 w-2.5 shrink-0 rounded-full ${DOT[tone]}`}
                        title={ev.status}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-ink truncate">{ev.label}</p>
                        <div className="mt-1 flex items-center gap-2">
                          {ev.kind && <Chip tone="violet">{ev.kind}</Chip>}
                          {ev.status && <Chip tone={tone}>{ev.status}</Chip>}
                        </div>
                      </div>
                      <span className="shrink-0 text-xs text-ink-soft">{relTime(ev.ts)}</span>
                    </li>
                  );
                })}
              </ul>
            </Card>
          </section>
        ))}
      </div>
    );
  };

  return (
    <div className="max-w-2xl">
      <header className="mb-6">
        <h1 className="text-2xl font-extrabold text-ink tracking-tight">Actividad</h1>
        <p className="text-sm text-ink-soft mt-1">Lo que tu agente estuvo haciendo, día a día.</p>
      </header>
      {body()}
    </div>
  );
}
