"use client";

// Usage: how much your agent spent. THIS SCREEN TALKS ABOUT MONEY AND NOTHING ELSE.
//
// THIS SCREEN WAS OFF FOR THREE DAYS FOR LYING (8/16 to 8/19/2026). The
// number came from what we saw go through the proxy, and image generation
// hits the provider directly: it said US$ 0.17 the day OpenRouter had
// charged US$ 1.52. Nine times too low, which is the worst direction — the
// client plans around that and finds out the truth when the invoice arrives.
//
// Now the number comes from whoever charges: the adapter asks OpenRouter
// about THIS agent's key and serves back whatever it answered. That's why
// the screen is short: three numbers, the cap if there is one, and where
// they come from. No tokens (no client knows what one is), no sessions, no
// bars — we don't have a daily series, and drawing one with this little data
// would be making it up.
//
// Contract (adapter v0.39): GET {adapter}/portal/usage →
//   { available: true, today_usd, month_usd, total_usd, limit_usd, updated_at }
//   or { available: false, reason } if the agent has no provider key or the
//   provider didn't answer.
// Any amount can come back null: that means "the provider doesn't report it",
// which is NOT zero. A null renders as "—" and never as "US$ 0.00".

import { useCallback, useEffect, useState } from "react";
import { Wallet, RefreshCw } from "lucide-react";
import { loadConfig, getUsage, type HttpError, type PortalConfig, type Usage } from "../lib/agent";
import { Card, EmptyState, ErrorState, IconBtn, PageHeader, Spinner } from "../lib/ui";
import { timeOf } from "../lib/labels";

type Failure = { status?: number; message: string };

const REFRESH_MS = 60_000;

const cf = new Intl.NumberFormat("es-UY", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

// A real charge that rounds to zero gets flagged; "US$ 0.00" would be a lie.
const usd = (v: number): string => (v > 0 && v < 0.005 ? `< ${cf.format(0.01)}` : cf.format(v));

const amount = (v: number | null): string => (v == null ? "—" : usd(v));

const is404 = (f: Failure) => f.status === 404 || /^404\b/.test(f.message);

function Stat({ label, value, big = false }: { label: string; value: string; big?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-ink-soft">
        {label}
      </p>
      <p
        className={`mt-1 font-extrabold leading-none tabular-nums text-ink ${
          big ? "text-[38px]" : "text-[22px]"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

export default function UsagePage() {
  const [cfg, setCfg] = useState<PortalConfig | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [err, setErr] = useState<Failure | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { setCfg(loadConfig()); }, []);

  // silent: the automatic refresh doesn't blank the screen or cover data
  // that's still useful with an error; at most it warns up top.
  const load = useCallback((silent = false) => {
    if (!cfg) return;
    if (!silent) { setUsage(null); setErr(null); }
    setLoading(true);
    getUsage(cfg)
      .then((r: Usage) => {
        setUsage(r && typeof r === "object" ? r : {});
        setErr(null);
      })
      .catch((e: HttpError) => setErr({ status: e?.status, message: e?.message || "error" }))
      .finally(() => setLoading(false));
  }, [cfg]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!cfg) return;
    const t = setInterval(() => load(true), REFRESH_MS);
    return () => clearInterval(t);
  }, [cfg, load]);

  const body = () => {
    if (err && usage === null) {
      if (is404(err)) {
        return (
          <EmptyState
            icon={Wallet}
            title="El uso no está disponible en este agente"
            hint="Tu agente todavía no sabe informar cuánto gastó."
          />
        );
      }
      return <ErrorState message={err.message} onRetry={() => load()} />;
    }
    if (!usage) return <Spinner />;

    // With no data from the provider there's no screen, and it says why.
    // "I don't know yet" is understandable; a number we don't know the
    // origin of, isn't.
    if (usage.available === false) {
      return (
        <EmptyState
          icon={Wallet}
          title="Ahora no puedo decirte cuánto gastó"
          // `reason` is diagnostic for us (curl); the client is never shown
          // a Python exception in English.
          hint="No pude preguntarle al proveedor. Probá de nuevo en un rato."
        />
      );
    }

    const today = num(usage.today_usd);
    const month = num(usage.month_usd);
    const total = num(usage.total_usd);
    const limit = num(usage.limit_usd);

    return (
      <>
        <Card>
          <div className="grid gap-5 sm:grid-cols-3">
            <Stat label="Hoy" value={amount(today)} big />
            <Stat label="Este mes" value={amount(month)} />
            <Stat label="Desde siempre" value={amount(total)} />
          </div>
          <p className="mt-4 border-t border-black/[0.07] pt-3.5 text-[11px] leading-snug text-ink-soft">
            Los números vienen de OpenRouter: es lo que tu agente gasta de verdad,
            no una estimación nuestra. Incluye todo lo que hace — responder, generar
            imágenes, buscar. No es tu abono y no es un cobro: está para que veas
            cuánto se usa.
          </p>
        </Card>

        {/* The cap, if the key has one. NO BAR: a bar at 15% says "relax" and
            one at 90% says "stop", and neither of those is ours to say — the
            cap belongs to the key, not to the client's plan. Both numbers,
            side by side, and let them do the math. */}
        {limit != null && (
          <Card className="mt-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
              Tope de la cuenta
            </p>
            <p className="mt-1.5 text-[13px] text-ink">
              La clave de tu agente tiene un tope de{" "}
              <span className="font-semibold tabular-nums">{usd(limit)}</span>
              {total != null && (
                <>
                  {" "}y lleva gastados{" "}
                  <span className="font-semibold tabular-nums">{usd(total)}</span>
                </>
              )}
              .
            </p>
          </Card>
        )}
      </>
    );
  };

  // The timestamp of the data, not of the request: the agent caches the
  // provider's response for five minutes, so the browser's clock would say
  // "just now" about a number that's a while old.
  const stamp = usage?.updated_at ? timeOf(usage.updated_at) : "";

  return (
    <div className="mx-auto max-w-5xl px-6 py-6 md:px-8">
      <PageHeader
        title="Uso"
        subtitle="Cuánto gastó tu agente"
        actions={
          <>
            {stamp && (
              <span className="hidden text-xs tabular-nums text-ink-soft sm:inline">
                Actualizado {stamp}
              </span>
            )}
            <IconBtn label="Actualizar" disabled={loading} onClick={() => load(true)}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </IconBtn>
          </>
        }
      />

      {err && usage !== null && (
        <p className="mb-4 inline-flex items-center rounded-lg border border-c-coral bg-c-coral/40 px-3 py-1.5 text-[12px] font-medium text-c-coral-ink">
          No pude actualizar recién ({err.message}). Te muestro lo último que tengo.
        </p>
      )}

      {body()}
    </div>
  );
}
