"use client";

// Uso: cuánto te sale el agente. ACÁ SE HABLA DE PLATA Y NADA MÁS.
//
// El motor mide en tokens y esta pantalla los mostraba: "Tokens 1,24 M" arriba,
// "Tokens de entrada / de salida" en las minis, el gráfico en tokens cuando no
// venía el costo, y los tokens del día en el globito de cada barra. Una clienta
// de prueba —dueña de una inmobiliaria— lo cerró en una línea: "no sé qué es un
// token y no me importa; US$ 0,10 es lo único que quiero saber". Un número que
// no se puede traducir a plata no se muestra crudo: se esconde.
//
// Contrato (adapter v0.7): GET {adapter}/portal/usage →
//   { available, sessions, input_tokens, output_tokens, total_tokens, cost_usd,
//     period: "30d",
//     daily: [{ date: "2026-08-03", input_tokens, output_tokens, cost_usd }],
//     by_channel: [{ name, sessions, cost_usd }],
//     by_model:   [{ name, sessions, cost_usd }] }
//   o { available: false } si el agente no reporta métricas.
// Los `*_tokens` se siguen recibiendo (son el contrato) y no se dibujan.
// Todo campo es opcional a propósito: "daily" puede traer menos días que el
// período (un agente nuevo trae dos) y los desgloses pueden no venir. Nada de
// eso rompe la pantalla: la sección sin datos no se dibuja.

import { useCallback, useEffect, useState } from "react";
import { BarChart3, RefreshCw } from "lucide-react";
import { loadConfig, getUsage, type HttpError, type PortalConfig } from "../lib/agent";
import { Btn, Card, Chip, EmptyState, ErrorState, IconBtn, PageHeader, Spinner } from "../lib/ui";
import { horaDe, husoDelNegocio, isoConHuso, momentoDe, rotuloCanal } from "../lib/palabras";

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

// Los canales salen del diccionario único del portal. Acá faltaba `cli` —el
// dispatcher del kanban trabajando un ticket solo— y la pantalla de la plata le
// mostraba a la clienta "cli · 28 sesiones". Su nota: "es la pantalla de la
// plata y no entiendo la mitad".

type Day = {
  key: string;
  label: string;
  title: string;
  cost: number;
};

// Últimos CHART_DAYS días calendario (terminando hoy), con los datos de
// "daily" mapeados por fecha; días sin datos quedan en cero.
//
// EL DÍA ES EL DEL NEGOCIO, NO EL DEL BROWSER. El agente agrupa su consumo por
// día suyo (`date(started_at,'unixepoch','localtime')` en el adapter: "2026-08-13"
// es un día del agente). Armando la ventana con el calendario de quien mira,
// los dos calendarios se separan todas las noches: con el agente en -03 y el
// portal abierto desde México, a las 22:30 de allá acá ya es el día siguiente
// —el balde de HOY del agente no entra en los catorce que se dibujan y el gasto
// de hoy desaparece del gráfico, en la pantalla de la plata. Y las etiquetas
// ("lun", "martes 12 ago") quedaban corridas un día contra los datos.
function buildDays(daily: DailyUsage[]): { days: Day[]; hasData: boolean } {
  const byDate = new Map<string, number>();
  for (const d of daily) {
    if (!d || typeof d.date !== "string") continue;
    byDate.set(d.date, num(d.cost_usd) ?? 0);
  }
  const days: Day[] = [];
  const huso = husoDelNegocio();
  const ahora = Date.now();
  for (let i = CHART_DAYS - 1; i >= 0; i--) {
    // Restar 24 h corre el día de pared de allá sin tocar la hora: el huso del
    // negocio es un desfasaje fijo, así que cada paso cae en el día anterior.
    const ms = ahora - i * 86_400_000;
    const key = isoConHuso(ms, huso).slice(0, 10); // "2026-08-13", la clave del agente
    const m = momentoDe(ms);
    days.push({
      key,
      // "lun": la primera palabra de `fechaCorta` ("lun 17 ago"), ya en
      // castellano y en el huso del negocio.
      label: m ? m.fechaCorta.split(" ")[0] : "",
      title: m ? `${m.diaSemana} ${m.fecha}` : key,
      cost: byDate.get(key) ?? 0,
    });
  }
  // "Hay días" es "hay días con gasto": una fila de ceros no es un gráfico.
  return { days, hasData: days.some((d) => d.cost > 0) };
}

type Fila = { key: string; label: string; meta: string | null; cost: number | null };

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
        // null NO es cero: es "no lo sabemos". El costo por canal no existe
        // —el canal lo sabe Hermes y el precio lo sabe el proxy, y nadie tiene
        // las dos mitades—, y antes del primer registro tampoco hay dato.
        // Dibujar "US$ 0,00" ahí le diría a la clienta que no gastó nada.
        cost: num(r.cost_usd),
      };
    })
    .sort((a, b) => (b.cost ?? -1) - (a.cost ?? -1));
}

function Desgloses({ title, rows }: { title: string; rows: Fila[] }) {
  const max = Math.max(...rows.map((r) => r.cost ?? 0), 0);
  return (
    <Card>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{title}</p>
      <ul className="mt-3 space-y-3">
        {rows.map((r) => {
          // Sin dato no hay barra: una barra en cero se lee como "gastó cero".
          const c = r.cost ?? 0;
          const pct = max > 0 ? Math.max(Math.round((c / max) * 100), c > 0 ? 2 : 0) : 0;
          return (
            <li key={r.key}>
              <div className="flex items-baseline justify-between gap-3">
                <p className="min-w-0 truncate text-[13px] text-ink">
                  <span className="font-semibold">{r.label}</span>
                  {r.meta && <span className="text-ink-soft"> · {r.meta}</span>}
                </p>
                <span className="shrink-0 text-[13px] font-semibold tabular-nums text-ink">
                  {r.cost == null ? "—" : usd(r.cost)}
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

    // SIN PLATA NO HAY PANTALLA. Antes, cuando el motor no reportaba costo, el
    // titular caía en los tokens del período: un número gigante que no se puede
    // cruzar con nada ("TOKENS 1,24 M"). Esconderlo es la respuesta honesta —
    // "todavía no sé cuánto te salió" se entiende; 1,24 M no.
    if (usage.available === false || cost == null) {
      return (
        <EmptyState
          icon={BarChart3}
          title="Tu agente todavía no reporta cuánto te sale"
          hint="Cuando el motor empiece a informarlo, vas a ver acá lo que costó cada período."
        />
      );
    }

    const minis: { label: string; value: string; hint?: string | null }[] = [];
    if (sess != null) minis.push({ label: "Sesiones", value: nf.format(sess) });
    if (sess != null && sess > 0) {
      minis.push({ label: "Promedio por sesión", value: usd(cost / sess) });
    }

    const { days, hasData } = buildDays(Array.isArray(usage.daily) ? usage.daily : []);
    const max = Math.max(...days.map((d) => d.cost), 0);

    const canales = filas(usage.by_channel, rotuloCanal, true);
    const modelos = filas(usage.by_model, (n) => n, false);

    return (
      <>
        <Card>
          <div className="flex items-center gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
              Costo del período
            </p>
            <Chip tone="neutral">estimado</Chip>
          </div>
          <p className="mt-1.5 text-[38px] font-extrabold leading-none tabular-nums text-ink">
            {usd(cost)}
          </p>
          <p className="mt-2 text-[11px] leading-snug text-ink-soft">
            Es lo que costó el trabajo de tu agente este período, estimado por el motor.
            No incluye tu abono mensual y no es un cobro: lo mostramos para que veas
            cuánto se usa.
          </p>

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
                Costo por día · últimos {CHART_DAYS} días
              </p>
              {max > 0 && (
                <p className="text-[11px] tabular-nums text-ink-soft">máximo {usd(max)}</p>
              )}
            </div>
            <div className="mt-4 flex h-40 items-end gap-1.5">
              {days.map((d) => {
                const v = d.cost;
                const pct = max > 0 ? Math.max(Math.round((v / max) * 100), v > 0 ? 2 : 0) : 0;
                return (
                  <div
                    key={d.key}
                    // El globito también hablaba en tokens ("1.176 entrada ·
                    // 165.562 salida"): en la pantalla de la plata, la barra
                    // dice cuánto costó ese día y se terminó.
                    title={v > 0 ? `${d.title}: ${usd(d.cost)}` : `${d.title}: sin actividad`}
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

        {canales.length > 0 && (
          <div className="mt-3">
            <Desgloses title="Por dónde se usó" rows={canales} />
          </div>
        )}

        {/* "Por modelo" son nombres de motor (`openai/gpt-5.6-luna`,
            `anthropic/claude-haiku-4.5`): para el cliente son códigos con
            barras, y enterarse ahí de costado por qué proveedores pasa su
            información genera más desconfianza que transparencia. Queda, pero
            plegado y dicho en criollo: el que lo quiera ver, lo abre. */}
        {modelos.length > 0 && (
          <details className="mt-3 group">
            <summary className="cursor-pointer list-none text-[12px] font-semibold text-ink-soft transition hover:text-ink [&::-webkit-details-marker]:hidden">
              Ver con qué motores de IA trabajó
            </summary>
            <div className="mt-2">
              <Desgloses title="Por motor" rows={modelos} />
            </div>
          </details>
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
            {/* La hora del negocio: el sello se lee contra el gráfico de abajo,
                que está en días del agente. En el reloj del que mira sería el
                único número de la pantalla midiendo con otra vara. */}
            {ultima && (
              <span className="hidden text-xs tabular-nums text-ink-soft sm:inline">
                Actualizado {horaDe(ultima.getTime())}
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
