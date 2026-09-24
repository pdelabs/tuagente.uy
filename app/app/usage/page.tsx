"use client";

// Usage: how much your agent spent. THIS SCREEN TALKS ABOUT MONEY AND NOTHING ELSE.
//
// THIS SCREEN WAS OFF FOR THREE DAYS FOR LYING (8/16 to 8/19/2026). The
// number came from what we saw go through the proxy, and image generation
// hits the provider directly: it said US$ 0.17 the day OpenRouter had
// charged US$ 1.52. Nine times too low, which is the worst direction — the
// client plans around that and finds out the truth when the invoice arrives.
//
// Now the numbers are THIS agent's own: every turn and every call outside one
// records what it cost, priced the way the provider (OpenRouter) charges it.
// That's why the screen is short: three numbers, the key's cap if there is
// one -- a different number, about the key and not the agent -- and where
// they come from. The provider's name stays off the screen: to the owner it
// is a word that means nothing. No tokens (no client knows what one is), no
// sessions, no bars — we don't have a daily series, and drawing one with this
// little data would be making it up.
//
// Contract: GET {adapter}/portal/usage →
//   { available: true, today_usd, month_usd, total_usd, unpriced,
//     key: { limit_usd, usage_usd } | null, updated_at }
//   `unpriced` > 0 makes the amounts a floor («≥»).
// Any amount can come back null: that means "the provider doesn't report it",
// which is NOT zero. A null renders as "—" and never as "US$ 0.00".

import { useCallback, useEffect, useState } from "react";
import { Wallet, RefreshCw } from "lucide-react";
import { loadConfig, getUsage, type HttpError, type PortalConfig, type Usage } from "../lib/agent";
import { Card, EmptyState, ErrorState, IconBtn, PageHeader, SUPPORT, Spinner } from "../lib/ui";
import { timeOf } from "../lib/labels";
import { useChanges } from "../lib/live";

type Failure = { status?: number; message: string };

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

  // Every turn writes what it cost (`turn_usage`): the numbers move when one ends.
  useChanges(["usage"], () => load(true));

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
    const limit = num(usage.key?.limit_usd);
    // Calls the provider left without a price: the amounts are then a floor,
    // and saying «US$ 0,42» flat would call those calls free.
    const floor = (usage.unpriced ?? 0) > 0;
    const shown = (v: number | null) => (floor && v != null ? `≥ ${usd(v)}` : amount(v));

    return (
      <>
        <Card>
          <div className="grid gap-5 sm:grid-cols-3">
            <Stat label="Hoy" value={shown(today)} big />
            <Stat label="Este mes" value={shown(month)} />
            <Stat label="Desde siempre" value={shown(total)} />
          </div>
          {floor && (
            <p className="mt-3 text-[12px] leading-snug text-ink-soft">
              Son al menos estos montos: {usage.unpriced === 1
                ? "una consulta no trajo su precio"
                : `${usage.unpriced} consultas no trajeron su precio`}, así que lo real
              puede ser un poco más.
            </p>
          )}
          <p className="mt-4 border-t border-black/[0.07] pt-3.5 text-[11px] leading-snug text-ink-soft">
            Es lo que gastó este agente, consulta por consulta, con los precios del
            proveedor de IA. Incluye todo lo que hace — responder, generar imágenes,
            buscar. No es tu abono y no es un cobro: está para que veas cuánto se usa.
          </p>
        </Card>

        {/* The cap, if there is one. NO BAR, AND NOT NEXT TO THE SPEND. The
            cap belongs to the provider key, which can serve more than this
            agent, while the three numbers above are this agent's: putting
            «lleva gastados US$ 12» under «tope de US$ 10» told the QA client
            her agent was over a limit it had not reached. What the number
            is, and what happens when it's reached, said once and calmly. */}
        {limit != null && (
          <Card className="mt-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
              Tope de seguridad
            </p>
            <p className="mt-1.5 text-[13px] leading-relaxed text-ink">
              Hay un tope de{" "}
              <span className="font-semibold tabular-nums">{usd(limit)}</span>{" "}
              para el gasto en IA. Es un freno que ponemos nosotros para que un error
              nunca se convierta en un gasto grande, no un límite de tu plan.
            </p>
            <p className="mt-1.5 text-[13px] leading-relaxed text-ink-soft">
              Si algún día se llega, tu agente deja de responder hasta que lo subamos;
              no se pierde nada de lo que hizo. Si pasa,{" "}
              <a
                href={SUPPORT.whatsapp}
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold underline underline-offset-2"
              >
                escribinos
              </a>{" "}
              y lo destrabamos.
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
