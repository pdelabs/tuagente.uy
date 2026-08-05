"use client";

// Conexiones: a qué sistemas de la empresa está enchufado el agente, qué le
// falta a cada uno y qué implica conectarlo.
//
// Contrato (adapter v0.20): GET {adapter}/portal/connections →
//   { disponible, conexiones: [{ id, label, grupo, para_que, como, esfuerzo,
//                                quien, advertencia, recomendado, estado,
//                                falta[], falta_previo[] }] }
//
// DOS DECISIONES DE PRODUCTO, y conviene no deshacerlas sin pensarlo:
//
// 1. Acá NO se pegan credenciales. El estado se calcula por presencia y el
//    adapter nunca devuelve un valor. Pedirle a un cliente no técnico que
//    pegue un token en una pantalla es enseñarle a repartir secretos.
// 2. El botón no conecta: PIDE. Crea un ticket, que es el mismo camino que
//    usa el cliente para cualquier otra cosa. Nosotros conectamos y auditamos.
//
// El vocabulario es del cliente: no aparecen las variables de entorno que
// faltan (eso es plomería), sino qué implica y cuánto lleva.

import { useCallback, useEffect, useState } from "react";
import {
  Check, Clock, Link2, Plug, RefreshCw, TriangleAlert,
} from "lucide-react";
import {
  getConnections, loadConfig,
  type Connection, type PortalConfig,
} from "../lib/agent";
import {
  Btn, Card, Chip, EmptyState, ErrorState, PageHeader, Spinner,
} from "../lib/ui";

const WRAP = "mx-auto max-w-5xl px-6 py-6 md:px-8";
const REFRESH_MS = 60_000;

const ESFUERZO: Record<string, string> = {
  minutos: "Se conecta en minutos",
  horas: "Lleva unas horas",
  dias: "Lleva varios días",
};

const QUIEN: Record<string, string> = {
  cliente_solo: "Lo podés hacer vos",
  asistido: "Lo hacemos juntos, en una llamada corta",
  nosotros: "Lo tramitamos nosotros",
};

function Estado({ estado }: { estado: string }) {
  if (estado === "conectado")
    return (
      <Chip tone="green">
        <Check className="h-3 w-3" /> Conectado
      </Chip>
    );
  if (estado === "bloqueado")
    return (
      <Chip tone="amber">
        <Clock className="h-3 w-3" /> Falta un paso nuestro
      </Chip>
    );
  return <Chip tone="neutral">Sin conectar</Chip>;
}

export default function ConexionesPage() {
  const [cfg, setCfg] = useState<PortalConfig | null>(null);
  const [conexiones, setConexiones] = useState<Connection[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pidiendo, setPidiendo] = useState<string | null>(null);
  const [pedidas, setPedidas] = useState<Record<string, string>>({});

  useEffect(() => setCfg(loadConfig()), []);

  const cargar = useCallback(async () => {
    if (!cfg) return;
    try {
      const r = await getConnections(cfg);
      setConexiones(r.conexiones ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [cfg]);

  useEffect(() => {
    if (!cfg) return;
    cargar();
    const t = setInterval(cargar, REFRESH_MS);
    return () => clearInterval(t);
  }, [cfg, cargar]);

  /** Pedir una conexión = crear un ticket. Mismo camino que todo lo demás. */
  const pedir = async (c: Connection) => {
    if (!cfg) return;
    setPidiendo(c.id);
    try {
      const res = await fetch(cfg.adapter + "/portal/tickets", {
        method: "POST",
        headers: { Authorization: `Bearer ${cfg.key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `Conectar ${c.label}`,
          body:
            `Pedido desde el portal.\n\n` +
            `Para qué sirve: ${c.para_que}\n` +
            `Cómo se conecta: ${c.como}\n\n` +
            `No hagas nada por tu cuenta con esto: avisale al equipo de tuagente ` +
            `que hay que conectarlo y dejá el ticket esperando.`,
        }),
      });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const data = await res.json();
      setPedidas((p) => ({ ...p, [c.id]: data.id ?? "ok" }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPidiendo(null);
    }
  };

  if (!cfg) return <div className={WRAP}><Spinner /></div>;
  if (conexiones === null && error)
    return <div className={WRAP}><ErrorState message={error} onRetry={cargar} /></div>;
  if (conexiones === null) return <div className={WRAP}><Spinner /></div>;

  const canales = conexiones.filter((c) => c.grupo === "canal");
  const sistemas = conexiones.filter((c) => c.grupo !== "canal");

  const tarjeta = (c: Connection) => (
    <Card key={c.id} className="flex flex-col gap-2 p-4">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-[15px] font-semibold text-ink">{c.label}</h3>
        <Estado estado={c.estado} />
      </div>
      <p className="text-sm text-ink-soft">{c.para_que}</p>
      <p className="text-[13px] text-ink-soft">{c.como}</p>

      {c.advertencia && (
        <p className="flex items-start gap-1.5 rounded-lg border border-c-amber bg-c-amber/30 px-2.5 py-1.5 text-[12px] text-c-amber-ink">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {c.advertencia}
        </p>
      )}

      <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-ink-soft">
        {c.esfuerzo && ESFUERZO[c.esfuerzo] && <span>{ESFUERZO[c.esfuerzo]}</span>}
        {c.quien && QUIEN[c.quien] && (
          <>
            <span aria-hidden>·</span>
            <span>{QUIEN[c.quien]}</span>
          </>
        )}
      </div>

      {c.estado !== "conectado" && (
        <div className="mt-1">
          {pedidas[c.id] ? (
            <p className="text-[13px] font-medium text-c-green-ink">
              Pedido. Lo dejamos anotado y te escribimos.
            </p>
          ) : (
            <Btn onClick={() => pedir(c)} disabled={pidiendo === c.id}>
              <Link2 className="h-4 w-4" />
              {pidiendo === c.id ? "Pidiendo…" : "Pedir que la conecten"}
            </Btn>
          )}
        </div>
      )}
    </Card>
  );

  return (
    <div className={WRAP}>
      <PageHeader
        title="Conexiones"
        subtitle="Los sistemas de tu empresa a los que tu agente está enchufado."
        actions={
          <Btn kind="ghost" onClick={cargar}>
            <RefreshCw className="h-4 w-4" />
            Actualizar
          </Btn>
        }
      />

      {error && (
        <p className="mb-4 inline-flex rounded-lg border border-c-coral bg-c-coral/40 px-3 py-1.5 text-[12px] font-medium text-c-coral-ink">
          No pude actualizar recién ({error}).
        </p>
      )}

      {conexiones.length === 0 ? (
        <EmptyState
          icon={Plug}
          title="Todavía no hay conexiones disponibles"
          hint="Cuando agreguemos integraciones para tu agente, van a aparecer acá."
        />
      ) : (
        <div className="flex flex-col gap-6">
          {canales.length > 0 && (
            <section>
              <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-soft">
                Por dónde le hablás
              </h2>
              <div className="grid gap-3 md:grid-cols-2">{canales.map(tarjeta)}</div>
            </section>
          )}
          {sistemas.length > 0 && (
            <section>
              <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-soft">
                Sistemas de tu empresa
              </h2>
              <div className="grid gap-3 md:grid-cols-2">{sistemas.map(tarjeta)}</div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
