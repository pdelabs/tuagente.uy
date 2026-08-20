"use client";

// Uso: cuánto gastó tu agente. ACÁ SE HABLA DE PLATA Y NADA MÁS.
//
// ESTA PANTALLA ESTUVO APAGADA TRES DÍAS POR MENTIROSA (16 al 19/8/2026). El
// número salía de lo que nosotros veíamos pasar por el proxy, y la generación de
// imágenes le pega directo al proveedor: decía US$ 0,17 el día que OpenRouter
// había cobrado US$ 1,52. Nueve veces para abajo, que es la peor dirección — el
// cliente planifica con eso y se entera de la verdad cuando le llega la factura.
//
// Ahora el número lo da el que cobra: el adapter le pregunta a OpenRouter por la
// clave de ESTE agente y sirve lo que le contestaron. Por eso la pantalla es
// corta: tres números, el tope si lo hay, y de dónde salen. Nada de tokens
// (ninguna clienta sabe qué es uno), nada de sesiones, nada de barras — no
// tenemos serie por día, y dibujar una con lo poco que hay sería inventar.
//
// Contrato (adapter v0.39): GET {adapter}/portal/uso →
//   { disponible: true, hoy_usd, mes_usd, total_usd, limite_usd, actualizado }
//   o { disponible: false, motivo } si el agente no tiene clave del proveedor o
//   el proveedor no contestó.
// Cualquier monto puede venir null: es "el proveedor no lo informa", que NO es
// cero. Un null se dibuja "—" y nunca "US$ 0,00".

import { useCallback, useEffect, useState } from "react";
import { Wallet, RefreshCw } from "lucide-react";
import { loadConfig, getUso, type HttpError, type PortalConfig, type Uso } from "../lib/agent";
import { Card, EmptyState, ErrorState, IconBtn, PageHeader, Spinner } from "../lib/ui";
import { horaDe } from "../lib/palabras";

type Falla = { status?: number; message: string };

const REFRESH_MS = 60_000;

const cf = new Intl.NumberFormat("es-UY", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

// Un gasto real que redondea a cero se marca; "US$ 0,00" sería mentira.
const usd = (v: number): string => (v > 0 && v < 0.005 ? `< ${cf.format(0.01)}` : cf.format(v));

const monto = (v: number | null): string => (v == null ? "—" : usd(v));

const es404 = (f: Falla) => f.status === 404 || /^404\b/.test(f.message);

function Numero({ label, value, big = false }: { label: string; value: string; big?: boolean }) {
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

export default function UsoPage() {
  const [cfg, setCfg] = useState<PortalConfig | null>(null);
  const [uso, setUso] = useState<Uso | null>(null);
  const [err, setErr] = useState<Falla | null>(null);
  const [cargando, setCargando] = useState(false);

  useEffect(() => { setCfg(loadConfig()); }, []);

  // silent: el refresh automático no vacía la pantalla ni tapa con un error
  // datos que todavía sirven; a lo sumo avisa arriba.
  const load = useCallback((silent = false) => {
    if (!cfg) return;
    if (!silent) { setUso(null); setErr(null); }
    setCargando(true);
    getUso(cfg)
      .then((r: Uso) => {
        setUso(r && typeof r === "object" ? r : {});
        setErr(null);
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

  const cuerpo = () => {
    if (err && uso === null) {
      if (es404(err)) {
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
    if (!uso) return <Spinner />;

    // Sin dato del proveedor no hay pantalla, y se dice por qué. "Todavía no lo
    // sé" se entiende; un número que no sabemos de dónde salió, no.
    if (uso.disponible === false) {
      return (
        <EmptyState
          icon={Wallet}
          title="Ahora no puedo decirte cuánto gastó"
          // `motivo` es diagnostico para nosotros (curl); al cliente no se le muestra
          // una excepcion de Python en ingles.
          hint="No pude preguntarle al proveedor. Probá de nuevo en un rato."
        />
      );
    }

    const hoy = num(uso.hoy_usd);
    const mes = num(uso.mes_usd);
    const total = num(uso.total_usd);
    const limite = num(uso.limite_usd);

    return (
      <>
        <Card>
          <div className="grid gap-5 sm:grid-cols-3">
            <Numero label="Hoy" value={monto(hoy)} big />
            <Numero label="Este mes" value={monto(mes)} />
            <Numero label="Desde siempre" value={monto(total)} />
          </div>
          <p className="mt-4 border-t border-black/[0.07] pt-3.5 text-[11px] leading-snug text-ink-soft">
            Los números vienen de OpenRouter: es lo que tu agente gasta de verdad,
            no una estimación nuestra. Incluye todo lo que hace — responder, generar
            imágenes, buscar. No es tu abono y no es un cobro: está para que veas
            cuánto se usa.
          </p>
        </Card>

        {/* El tope, si la clave tiene uno. SIN BARRA: una barra al 15% le dice
            "andá tranquila" y una al 90% le dice "frená", y ninguna de las dos
            cosas es nuestra para decir — el tope es de la clave, no del plan del
            cliente. Los dos números, uno al lado del otro, y que saque su cuenta. */}
        {limite != null && (
          <Card className="mt-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
              Tope de la cuenta
            </p>
            <p className="mt-1.5 text-[13px] text-ink">
              La clave de tu agente tiene un tope de{" "}
              <span className="font-semibold tabular-nums">{usd(limite)}</span>
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

  // La hora del dato, no la del pedido: el agente cachea la respuesta del
  // proveedor cinco minutos, así que el reloj del browser diría "recién" sobre
  // un número de hace un rato.
  const sello = uso?.actualizado ? horaDe(uso.actualizado) : "";

  return (
    <div className="mx-auto max-w-5xl px-6 py-6 md:px-8">
      <PageHeader
        title="Uso"
        subtitle="Cuánto gastó tu agente"
        actions={
          <>
            {sello && (
              <span className="hidden text-xs tabular-nums text-ink-soft sm:inline">
                Actualizado {sello}
              </span>
            )}
            <IconBtn label="Actualizar" disabled={cargando} onClick={() => load(true)}>
              <RefreshCw className={`h-4 w-4 ${cargando ? "animate-spin" : ""}`} />
            </IconBtn>
          </>
        }
      />

      {err && uso !== null && (
        <p className="mb-4 inline-flex items-center rounded-lg border border-c-coral bg-c-coral/40 px-3 py-1.5 text-[12px] font-medium text-c-coral-ink">
          No pude actualizar recién ({err.message}). Te muestro lo último que tengo.
        </p>
      )}

      {cuerpo()}
    </div>
  );
}
