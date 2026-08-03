"use client";

// Uso: consumo del agente en tiles + barras diarias.
// Contrato (adapter v0.3): GET {adapter}/portal/usage →
//   { available, sessions, input_tokens, output_tokens, total_tokens,
//     period: "30d", daily: [{ date: "2026-08-03", input_tokens, output_tokens }] }
//   o { available: false } si el agente no reporta métricas.
// "daily" puede faltar o venir vacío: en ese caso se omite el gráfico.

import { useCallback, useEffect, useState } from "react";
import { BarChart3 } from "lucide-react";
import { loadConfig, getUsage, type PortalConfig } from "../lib/agent";
import { Btn, Card, EmptyState, ErrorState, PageHeader, Spinner } from "../lib/ui";

type DailyUsage = { date?: string; input_tokens?: number; output_tokens?: number };

type Usage = {
  available?: boolean;
  sessions?: number;
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  period?: string;
  daily?: DailyUsage[];
};

const CHART_DAYS = 14;
const nf = new Intl.NumberFormat("es-UY");
const is404 = (msg: string) => /^404\b/.test(msg);

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

// "30d" → "últimos 30 días"; cualquier otro formato se muestra crudo.
function periodLabel(period?: string): string | null {
  if (!period || typeof period !== "string") return null;
  const m = /^(\d+)\s*d$/i.exec(period.trim());
  return m ? `últimos ${m[1]} días` : period;
}

type Day = { key: string; label: string; title: string; input: number; output: number };

// Últimos CHART_DAYS días calendario (terminando hoy), con los datos de
// "daily" mapeados por fecha; días sin datos quedan en cero.
function buildDays(daily: DailyUsage[]): { days: Day[]; hasData: boolean } {
  const byDate = new Map<string, { input: number; output: number }>();
  for (const d of daily) {
    if (!d || typeof d.date !== "string") continue;
    byDate.set(d.date, { input: num(d.input_tokens) ?? 0, output: num(d.output_tokens) ?? 0 });
  }
  const days: Day[] = [];
  const now = new Date();
  for (let i = CHART_DAYS - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const v = byDate.get(key);
    days.push({
      key,
      label: d.toLocaleDateString("es-UY", { weekday: "short" }),
      title: d.toLocaleDateString("es-UY", { weekday: "long", day: "numeric", month: "long" }),
      input: v?.input ?? 0,
      output: v?.output ?? 0,
    });
  }
  return { days, hasData: byDate.size > 0 };
}

export default function UsoPage() {
  const [cfg, setCfg] = useState<PortalConfig | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { setCfg(loadConfig()); }, []);

  const load = useCallback(() => {
    if (!cfg) return;
    setUsage(null);
    setErr(null);
    getUsage(cfg)
      .then((r: Usage) => setUsage(r ?? {}))
      .catch((e: Error) => setErr(e.message || "error"));
  }, [cfg]);

  useEffect(() => { load(); }, [load]);

  const body = () => {
    if (err && is404(err)) {
      return (
        <>
          <EmptyState
            icon={BarChart3}
            title="El uso no está disponible en este agente"
            hint="Tu agente todavía no reporta métricas de uso."
          />
          <div className="flex justify-center"><Btn kind="ghost" size="sm" onClick={load}>Reintentar</Btn></div>
        </>
      );
    }
    if (err) return <ErrorState message={err} onRetry={load} />;
    if (!usage) return <Spinner />;

    const input = num(usage.input_tokens);
    const output = num(usage.output_tokens);
    const total =
      num(usage.total_tokens) ??
      (input != null || output != null ? (input ?? 0) + (output ?? 0) : null);
    const tiles = [
      { label: "Sesiones", value: num(usage.sessions) },
      { label: "Tokens de entrada", value: input },
      { label: "Tokens de salida", value: output },
      { label: "Total", value: total },
    ].filter((t): t is { label: string; value: number } => t.value != null);

    if (usage.available === false || tiles.length === 0) {
      return (
        <EmptyState
          icon={BarChart3}
          title="Tu agente todavía no reporta métricas de uso"
          hint="Cuando empiece a reportarlas, las vas a ver acá."
        />
      );
    }

    const { days, hasData } = buildDays(Array.isArray(usage.daily) ? usage.daily : []);
    const max = Math.max(...days.map((d) => d.input + d.output), 1);

    return (
      <>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {tiles.map((t) => (
            <Card key={t.label}>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
                {t.label}
              </p>
              <p className="mt-1.5 text-2xl font-bold tabular-nums text-ink">
                {nf.format(t.value)}
              </p>
            </Card>
          ))}
        </div>

        {hasData && (
          <Card className="mt-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
              Tokens por día · últimos {CHART_DAYS} días
            </p>
            <div className="mt-4 flex h-40 items-end gap-1.5">
              {days.map((d) => {
                const t = d.input + d.output;
                const pct = Math.max(Math.round((t / max) * 100), t > 0 ? 2 : 0);
                return (
                  <div
                    key={d.key}
                    title={`${d.title}: ${nf.format(d.input)} entrada · ${nf.format(d.output)} salida`}
                    className="group flex h-full flex-1 flex-col justify-end"
                  >
                    {t > 0 ? (
                      <div
                        className="rounded-t bg-primary transition group-hover:opacity-80"
                        style={{ height: `${pct}%` }}
                      />
                    ) : (
                      <div className="h-0.5 rounded-t bg-black/[0.06]" />
                    )}
                  </div>
                );
              })}
            </div>
            <div className="mt-1.5 flex gap-1.5">
              {days.map((d) => (
                <span key={d.key} className="flex-1 text-center text-[10px] text-ink-soft">
                  {d.label}
                </span>
              ))}
            </div>
          </Card>
        )}
      </>
    );
  };

  const period = usage ? periodLabel(usage.period) : null;

  return (
    <div className="mx-auto max-w-5xl px-6 py-6 md:px-8">
      <PageHeader
        title="Uso"
        subtitle={period ? `Cuánto trabajó tu agente · ${period}` : "Cuánto trabajó tu agente"}
      />
      {body()}
    </div>
  );
}
