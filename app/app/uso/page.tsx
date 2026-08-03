"use client";

// Uso: consumo del agente en tiles grandes tonales.
// Contrato (spec 05): GET {adapter}/portal/usage →
//   { sessions, input_tokens, output_tokens, total_tokens, period }
//   o { available: false } si el agente no reporta métricas.

import { useCallback, useEffect, useState } from "react";
import { loadConfig, getUsage, type PortalConfig } from "../lib/agent";
import { Btn, Card, EmptyState, ErrorState, Spinner } from "../lib/ui";

type Usage = {
  available?: boolean;
  sessions?: number;
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  period?: string;
};

const TILES: { key: keyof Usage; label: string; tone: "violet" | "green" | "amber" | "coral" }[] = [
  { key: "sessions", label: "Sesiones", tone: "violet" },
  { key: "input_tokens", label: "Tokens de entrada", tone: "green" },
  { key: "output_tokens", label: "Tokens de salida", tone: "amber" },
  { key: "total_tokens", label: "Tokens totales", tone: "coral" },
];

const nf = new Intl.NumberFormat("es-UY");
const is404 = (msg: string) => /^404\b/.test(msg);

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
            emoji="📊"
            title="El uso no está disponible en este agente"
            hint="Tu agente todavía no reporta métricas de uso."
          />
          <div className="flex justify-center"><Btn kind="ghost" onClick={load}>Reintentar</Btn></div>
        </>
      );
    }
    if (err) return <ErrorState message={err} onRetry={load} />;
    if (!usage) return <Spinner />;

    const tiles = TILES.filter(
      (t) => typeof usage[t.key] === "number" && Number.isFinite(usage[t.key] as number),
    );

    if (usage.available === false || tiles.length === 0) {
      return (
        <EmptyState
          emoji="🌱"
          title="Tu agente todavía no reporta métricas de uso"
          hint="Cuando empiece a reportarlas, las vas a ver acá."
        />
      );
    }

    return (
      <>
        {usage.period && (
          <p className="mb-4 px-1 text-sm text-ink-soft">
            Período: <span className="font-bold text-ink">{usage.period}</span>
          </p>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {tiles.map((t) => (
            <Card key={t.key} tone={t.tone}>
              <p className="text-xs font-bold uppercase tracking-wide opacity-70">{t.label}</p>
              <p className="mt-2 text-4xl font-extrabold tracking-tight tabular-nums">
                {nf.format(usage[t.key] as number)}
              </p>
            </Card>
          ))}
        </div>
      </>
    );
  };

  return (
    <div className="max-w-3xl">
      <header className="mb-6">
        <h1 className="text-2xl font-extrabold text-ink tracking-tight">Uso</h1>
        <p className="text-sm text-ink-soft mt-1">Cuánto trabajó tu agente en este período.</p>
      </header>
      {body()}
    </div>
  );
}
