"use client";

// Uso: cuánto te sale el agente. El costo manda; los tokens son el detalle.
// Contrato (adapter v0.7): GET {adapter}/portal/usage →
//   { available, sessions, input_tokens, output_tokens, total_tokens, cost_usd,
//     period: "30d",
//     daily: [{ date: "2026-08-03", input_tokens, output_tokens, cost_usd }],
//     by_channel: [{ name, sessions, cost_usd }],
//     by_model:   [{ name, sessions, cost_usd }] }
//   o { available: false } si el agente no reporta métricas.
// Todo campo es opcional a propósito: "daily" puede traer menos días que el
// período (un agente nuevo trae dos) y los desgloses pueden no venir. Nada de
// eso rompe la pantalla: la sección sin datos no se dibuja.

import { useCallback, useEffect, useState } from "react";
import { BarChart3, RefreshCw } from "lucide-react";
import { loadConfig, getUsage, type HttpError, type PortalConfig } from "../lib/agent";
import { Btn, Card, Chip, EmptyState, ErrorState, IconBtn, PageHeader, Spinner } from "../lib/ui";

type DailyUsage = {
  date?: string;
  input_tokens?: number;
  output_tokens?: number;
  cost_usd?: number;
};

type Desglose = { name?: string; sessions?: number; cost_usd?: number };

type Usage = {
  available?: boolean;
  sessions?: number;
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  cost_usd?: number;
  period?: string;
  daily?: DailyUsage[];
  by_channel?: Desglose[];
  by_model?: Desglose[];
};

type Falla = { status?: number; message: string };

const CHART_DAYS = 14;
const REFRESH_MS = 60_000;

const nf = new Intl.NumberFormat("es-UY");
const cf = new Intl.NumberFormat("es-UY", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

// Un consumo real que redondea a cero se marca; "US$ 0,00" sería mentira.
const usd = (v: number): string => (v > 0 && v < 0.005 ? `< ${cf.format(0.01)}` : cf.format(v));

const es404 = (f: Falla) => f.status === 404 || /^404\b/.test(f.message);

const sesiones = (n: number) => `${nf.format(n)} ${n === 1 ? "sesión" : "sesiones"}`;

// "30d" → "últimos 30 días"; cualquier otro formato se muestra crudo.
function periodLabel(period?: string): string | null {
  if (!period || typeof period !== "string") return null;
  const m = /^(\d+)\s*d$/i.exec(period.trim());
  return m ? `últimos ${m[1]} días` : period;
}

// Canales crudos del motor → cómo los nombra el cliente. Uno desconocido se
// muestra tal cual: mejor eso que esconderlo o inventarle un nombre.
const CANALES: Record<string, string> = {
  telegram: "Telegram",
  api_server: "Portal",
  cron: "Tareas programadas",
  kanban: "Tablero",
  "kanban-research": "Tablero (investigación)",
  tui: "Consola",
};

type Day = {
  key: string;
  label: string;
  title: string;
  input: number;
  output: number;
  cost: number;
};

// Últimos CHART_DAYS días calendario (terminando hoy), con los datos de
// "daily" mapeados por fecha; días sin datos quedan en cero.
function buildDays(daily: DailyUsage[]): { days: Day[]; hasData: boolean } {
  const byDate = new Map<string, { input: number; output: number; cost: number }>();
  for (const d of daily) {
    if (!d || typeof d.date !== "string") continue;
    byDate.set(d.date, {
      input: num(d.input_tokens) ?? 0,
      output: num(d.output_tokens) ?? 0,
      cost: num(d.cost_usd) ?? 0,
    });
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
      cost: v?.cost ?? 0,
    });
  }
  return { days, hasData: byDate.size > 0 };
}

type Fila = { key: string; label: string; meta: string | null; cost: number };

// Filas de un desglose, de mayor a menor gasto. Las entradas sin nombre se
// descartan: una barra anónima no dice nada.
function filas(items: unknown, label: (name: string) => string, conSesiones: boolean): Fila[] {
  if (!Array.isArray(items)) return [];
  return items
    .filter((r): r is Desglose => Boolean(r) && typeof (r as Desglose).name === "string")
    .map((r, i) => {
      const s = num(r.sessions);
      return {
        key: `${r.name}-${i}`,
        label: label(r.name as string),
        meta: conSesiones && s != null ? sesiones(s) : null,
        cost: num(r.cost_usd) ?? 0,
      };
    })
    .sort((a, b) => b.cost - a.cost);
}

function Desgloses({ title, rows }: { title: string; rows: Fila[] }) {
  const max = Math.max(...rows.map((r) => r.cost), 0);
  return (
    <Card>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{title}</p>
      <ul className="mt-3 space-y-3">
        {rows.map((r) => {
          const pct = max > 0 ? Math.max(Math.round((r.cost / max) * 100), r.cost > 0 ? 2 : 0) : 0;
          return (
            <li key={r.key}>
              <div className="flex items-baseline justify-between gap-3">
                <p className="min-w-0 truncate text-[13px] text-ink">
                  <span className="font-semibold">{r.label}</span>
                  {r.meta && <span className="text-ink-soft"> · {r.meta}</span>}
                </p>
                <span className="shrink-0 text-[13px] font-semibold tabular-nums text-ink">
                  {usd(r.cost)}
                </span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-black/[0.05]">
                <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

export default function UsoPage() {
  const [cfg, setCfg] = useState<PortalConfig | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [err, setErr] = useState<Falla | null>(null);
  const [cargando, setCargando] = useState(false);
  const [ultima, setUltima] = useState<Date | null>(null);

  useEffect(() => { setCfg(loadConfig()); }, []);

  // silent: el refresh automático no vacía la pantalla ni tapa con un error
  // datos que todavía sirven; a lo sumo avisa arriba.
  const load = useCallback((silent = false) => {
    if (!cfg) return;
    if (!silent) { setUsage(null); setErr(null); }
    setCargando(true);
    getUsage(cfg)
      .then((r: Usage) => {
        setUsage(r && typeof r === "object" ? r : {});
        setErr(null);
        setUltima(new Date());
      })
      .catch((e: HttpError) => setErr({ status: e?.status, message: e?.message || "error" }))
      .finally(() => setCargando(false));
  }, [cfg]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!cfg) return;
    const t = setInterval(() => load(true), REFRESH_MS);
    return () => clearInterval(t);
  }, [cfg, load]);

  const period = usage ? periodLabel(usage.period) : null;

  const cuerpo = () => {
    if (err && usage === null) {
      if (es404(err)) {
        return (
          <>
            <EmptyState
              icon={BarChart3}
              title="El uso no está disponible en este agente"
              hint="Tu agente todavía no reporta métricas de uso."
            />
            <div className="flex justify-center">
              <Btn kind="ghost" size="sm" onClick={() => load()}>Reintentar</Btn>
            </div>
          </>
        );
      }
      return <ErrorState message={err.message} onRetry={() => load()} />;
    }
    if (!usage) return <Spinner />;

    const cost = num(usage.cost_usd);
    const sess = num(usage.sessions);
    const input = num(usage.input_tokens);
    const output = num(usage.output_tokens);
    const total =
      num(usage.total_tokens) ??
      (input != null || output != null ? (input ?? 0) + (output ?? 0) : null);

    if (usage.available === false || (cost == null && total == null && sess == null)) {
      return (
        <EmptyState
          icon={BarChart3}
          title="Tu agente todavía no reporta métricas de uso"
          hint="Cuando empiece a reportarlas, vas a ver acá cuánto te está saliendo."
        />
      );
    }

    // El titular es la plata. Si el motor no la reporta, caemos a los tokens
    // antes que dejar la pantalla muda.
    const conCosto = cost != null;
    const tokensHint =
      input != null && output != null
        ? `${nf.format(input)} entrada · ${nf.format(output)} salida`
        : null;

    const minis: { label: string; value: string; hint?: string | null }[] = [];
    if (sess != null) minis.push({ label: "Sesiones", value: nf.format(sess) });
    if (conCosto && total != null) {
      minis.push({ label: "Tokens", value: nf.format(total), hint: tokensHint });
    }
    if (!conCosto) {
      if (input != null) minis.push({ label: "Tokens de entrada", value: nf.format(input) });
      if (output != null) minis.push({ label: "Tokens de salida", value: nf.format(output) });
    }
    if (cost != null && sess != null && sess > 0) {
      minis.push({ label: "Promedio por sesión", value: usd(cost / sess) });
    }

    const { days, hasData } = buildDays(Array.isArray(usage.daily) ? usage.daily : []);
    // Si el motor no manda costo por día, el gráfico sigue sirviendo en tokens.
    const porCosto = days.some((d) => d.cost > 0);
    const valor = (d: Day) => (porCosto ? d.cost : d.input + d.output);
    const max = Math.max(...days.map(valor), 0);

    const canales = filas(usage.by_channel, (n) => CANALES[n] ?? n, true);
    const modelos = filas(usage.by_model, (n) => n, false);
    const ambos = canales.length > 0 && modelos.length > 0;

    return (
      <>
        <Card>
          <div className="flex items-center gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
              {conCosto ? "Costo del período" : "Tokens del período"}
            </p>
            {conCosto && <Chip tone="neutral">estimado</Chip>}
          </div>
          <p className="mt-1.5 text-[38px] font-extrabold leading-none tabular-nums text-ink">
            {cost != null ? usd(cost) : nf.format(total ?? 0)}
          </p>
          {conCosto && (
            <p className="mt-2 text-[11px] leading-snug text-ink-soft">
              Lo estima el motor del agente a partir de lo que consumió cada sesión. Es una
              referencia, no una factura.
            </p>
          )}

          {minis.length > 0 && (
            <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-black/[0.07] pt-3.5 sm:grid-cols-3">
              {minis.map((m) => (
                <div key={m.label} className="min-w-0">
                  <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-ink-soft">
                    {m.label}
                  </p>
                  <p className="mt-1 text-lg font-bold leading-none tabular-nums text-ink">
                    {m.value}
                  </p>
                  {m.hint && (
                    <p className="mt-1 truncate text-[10px] tabular-nums text-ink-soft">{m.hint}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>

        {hasData && (
          <Card className="mt-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
                {porCosto ? "Costo por día" : "Tokens por día"} · últimos {CHART_DAYS} días
              </p>
              {max > 0 && (
                <p className="text-[11px] tabular-nums text-ink-soft">
                  máximo {porCosto ? usd(max) : nf.format(max)}
                </p>
              )}
            </div>
            <div className="mt-4 flex h-40 items-end gap-1.5">
              {days.map((d) => {
                const v = valor(d);
                const pct = max > 0 ? Math.max(Math.round((v / max) * 100), v > 0 ? 2 : 0) : 0;
                const tokens = d.input + d.output;
                return (
                  <div
                    key={d.key}
                    title={
                      tokens > 0 || d.cost > 0
                        ? `${d.title}: ${usd(d.cost)} · ${nf.format(tokens)} tokens ` +
                          `(${nf.format(d.input)} entrada · ${nf.format(d.output)} salida)`
                        : `${d.title}: sin actividad`
                    }
                    className="group flex h-full flex-1 flex-col justify-end"
                  >
                    {v > 0 ? (
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

        {(canales.length > 0 || modelos.length > 0) && (
          <div className={`mt-3 grid gap-3 ${ambos ? "lg:grid-cols-2" : ""}`}>
            {canales.length > 0 && <Desgloses title="Por canal" rows={canales} />}
            {modelos.length > 0 && <Desgloses title="Por modelo" rows={modelos} />}
          </div>
        )}
      </>
    );
  };

  return (
    <div className="mx-auto max-w-5xl px-6 py-6 md:px-8">
      <PageHeader
        title="Uso"
        subtitle={period ? `Cuánto te sale tu agente · ${period}` : "Cuánto te sale tu agente"}
        actions={
          <>
            {ultima && (
              <span className="hidden text-xs tabular-nums text-ink-soft sm:inline">
                Actualizado{" "}
                {ultima.toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit", hour12: false })}
              </span>
            )}
            <IconBtn label="Actualizar" disabled={cargando} onClick={() => load(true)}>
              <RefreshCw className={`h-4 w-4 ${cargando ? "animate-spin" : ""}`} />
            </IconBtn>
          </>
        }
      />

      {err && usage !== null && (
        <p className="mb-4 inline-flex items-center rounded-lg border border-c-coral bg-c-coral/40 px-3 py-1.5 text-[12px] font-medium text-c-coral-ink">
          No pude actualizar recién ({err.message}). Te muestro lo último que tengo.
        </p>
      )}

      {cuerpo()}
    </div>
  );
}
