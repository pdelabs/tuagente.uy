"use client";

// Flujos: los trabajos del cliente, con nombre y resultados. Es la pestaña que
// responde "¿qué hace mi agente por mí?" sin una palabra de máquina — la
// conclusión del artículo de WIRED aplicada al portal (7/8, con Luis): el
// cliente no quiere ver crons ni scripts; quiere ver sus flujos y lo que
// producen. El cron, las skills y las carpetas son el CÓMO y quedan abajo.
//
// Contrato (adapter ≥0.29): GET {adapter}/portal/flujos →
//   { disponible, flujos: [{ slug, nombre, para_cliente, gatillo_tipo,
//     gatillo, estado, conexiones_faltan, ultima_corrida, resultados,
//     resultados_total }] }
//
// Los resultados se muestran como chips de archivo (EntityChip): el mismo
// visor del chat, cero código nuevo de preview.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRight, Clock, FolderOpen, MessageSquare, RefreshCw, Workflow,
  Zap, type LucideIcon,
} from "lucide-react";
import {
  etiquetaConexion, getConnections, getFlujos, loadConfig,
  type Connection, type Flujo, type HttpError, type PortalConfig,
} from "../lib/agent";
import { EntityProvider } from "../lib/EntityViewer";
import { EntityChip } from "../lib/entities";
import { CarruselEjemplos } from "../lib/ejemplosFlujos";
import {
  Btn, Card, Chip, EmptyState, ErrorState, IconBtn, PageHeader, Spinner,
} from "../lib/ui";

type Falla = { status?: number; message: string };

const WRAP = "mx-auto max-w-5xl px-6 py-6 md:px-8";
const REFRESH_MS = 60_000;

const es404 = (f: Falla) => f.status === 404 || /^404\b/.test(f.message);

const GATILLO_ICON: Record<string, LucideIcon> = {
  drive: FolderOpen,
  horario: Clock,
  webhook: Zap,
  pedido: MessageSquare,
};

function hace(mtime: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000 - mtime));
  if (s < 3600) return `hace ${Math.max(1, Math.floor(s / 60))} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  const d = Math.floor(s / 86400);
  return d === 1 ? "ayer" : `hace ${d} días`;
}

function nombreArchivo(path: string): string {
  const base = (path || "").split("/").pop() || path;
  return base.replace(/^\d{4}-\d{2}-\d{2}[-_ ]/, "") || base;
}

function EstadoFlujo({ f }: { f: Flujo }) {
  if (f.estado === "incompleto") {
    return <Chip tone="amber">Le falta una conexión</Chip>;
  }
  if (f.estado === "pausado") return <Chip tone="neutral">Pausado</Chip>;
  return <Chip tone="green">Activo</Chip>;
}

/** Qué le falta a este flujo, cómo se llama y para qué sirve. */
function FaltaConexion({ ids, conexiones }: {
  ids: string[]; conexiones: Connection[] | null;
}) {
  const nombres = ids.map((id) => etiquetaConexion(id, conexiones));
  const porQue = ids
    .map((id) => conexiones?.find((c) => c.id === id)?.para_que)
    .filter(Boolean) as string[];
  return (
    <div className="rounded-lg border border-c-amber bg-c-amber/25 p-3">
      <p className="text-[13px] font-semibold text-c-amber-ink">
        Le falta {nombres.length === 1 ? nombres[0] : nombres.join(" y ")}.
      </p>
      {porQue.length > 0 && (
        <p className="mt-1 text-[12.5px] leading-relaxed text-c-amber-ink/85">
          {porQue.join(" ")}
        </p>
      )}
      <Link
        href={`/app/conexiones#c=${encodeURIComponent(ids[0])}`}
        className="mt-2.5 inline-flex h-9 w-fit items-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-semibold text-white transition hover:bg-primary-dark"
      >
        Conectar {nombres[0]}
        <ArrowRight className="h-4 w-4" />
      </Link>
    </div>
  );
}

function TarjetaFlujo({ f, conexiones }: { f: Flujo; conexiones: Connection[] | null }) {
  const Icono = GATILLO_ICON[f.gatillo_tipo] ?? Workflow;
  return (
    <Card className="flex flex-col gap-2.5">
      <div className="flex items-start justify-between gap-3">
        <Link
          href={`/app/flujos/${f.slug}`}
          className="text-[16px] font-bold leading-snug text-ink underline-offset-4 transition hover:text-primary hover:underline"
        >
          {f.nombre}
        </Link>
        <span className="shrink-0"><EstadoFlujo f={f} /></span>
      </div>

      {f.para_cliente && (
        <p className="text-sm leading-relaxed text-ink-soft">{f.para_cliente}</p>
      )}

      {f.gatillo && (
        <p className="flex items-center gap-1.5 text-[12px] text-ink-soft/90">
          <Icono className="h-3.5 w-3.5 shrink-0" />
          {f.gatillo}
        </p>
      )}

      {/* Incompleto: el paso que lo destraba, no un diagnóstico. Y con NOMBRE
          y MOTIVO: "Conectar lo que falta" no dice qué falta ni para qué, y al
          llegar a Conexiones el cliente se perdía entre seis tarjetas sin
          saber cuál era la suya. El "para qué" sale del catálogo, que ya lo
          tiene escrito en criollo — no lo inventamos acá. */}
      {f.estado === "incompleto" && f.conexiones_faltan.length > 0 && (
        <FaltaConexion ids={f.conexiones_faltan} conexiones={conexiones} />
      )}

      {f.resultados.length > 0 && (
        <div>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
            Resultados
            <span className="ml-1.5 tabular-nums text-ink-soft/70">{f.resultados_total}</span>
          </p>
          <ul className="flex flex-col gap-1">
            {f.resultados.slice(0, 5).map((r) => (
              <li key={r.path} className="flex items-center gap-2">
                <span className="min-w-0 flex-1">
                  <EntityChip
                    entity={{ kind: "file", path: r.path }}
                    label={nombreArchivo(r.path)}
                  />
                </span>
                <span className="shrink-0 whitespace-nowrap text-[11px] text-ink-soft">
                  {hace(r.mtime)}
                </span>
              </li>
            ))}
          </ul>
          {f.resultados_total > 5 && (
            <Link
              href="/app/archivos"
              className="mt-1.5 inline-block text-[12px] font-semibold text-primary transition hover:text-primary-dark"
            >
              Ver todos en Archivos
            </Link>
          )}
        </div>
      )}

      {f.estado === "activo" && f.resultados.length === 0 && (
        <p className="text-[12px] text-ink-soft/80">
          Todavía no produjo resultados: van a aparecer acá solos.
        </p>
      )}
    </Card>
  );
}

function SinFlujos() {
  return (
    <div>
      <div className="mx-auto max-w-xl text-center">
        <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-c-violet">
          <Workflow className="h-5 w-5 text-primary" />
        </div>
        <h2 className="text-[19px] font-bold tracking-tight text-ink">
          Todavía no hay nada corriendo solo
        </h2>
        <p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-ink-soft">
          Un flujo es un trabajo que tu agente hace sin que se lo pidas: se ocupa
          cada vez que corresponde y te deja el resultado acá para que lo revises.
          Estos son ejemplos de lo que le pide otra gente — el tuyo va a salir de
          contarle a qué te dedicás.
        </p>
      </div>

      <div className="mt-7"><CarruselEjemplos /></div>

      <div className="mt-6 flex flex-col items-center gap-2">
        <a
          href="/app/chat"
          className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-white transition hover:bg-primary-dark"
        >
          Armar el primero
        </a>
        <span className="text-[12px] text-ink-soft">
          Contale a qué se dedica tu empresa y te propone por dónde empezar.
        </span>
      </div>
    </div>
  );
}

export default function FlujosPage() {
  const [cfg, setCfg] = useState<PortalConfig | null>(null);
  const [flujos, setFlujos] = useState<Flujo[] | null>(null);
  const [err, setErr] = useState<Falla | null>(null);
  const [cargando, setCargando] = useState(false);
  // Solo para poder nombrar la conexión que falta y decir para qué sirve.
  const [conexiones, setConexiones] = useState<Connection[] | null>(null);

  useEffect(() => setCfg(loadConfig()), []);

  useEffect(() => {
    if (!cfg) return;
    getConnections(cfg)
      .then((r) => setConexiones(r.conexiones ?? []))
      .catch(() => { /* sin catálogo caemos a los rótulos conocidos */ });
  }, [cfg]);

  const cargar = useCallback(() => {
    if (!cfg) return;
    setCargando(true);
    getFlujos(cfg)
      .then((r) => { setFlujos(r?.flujos ?? []); setErr(null); })
      .catch((e: HttpError) => setErr({ status: e?.status, message: e?.message || "error" }))
      .finally(() => setCargando(false));
  }, [cfg]);

  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => {
    if (!cfg) return;
    const t = setInterval(cargar, REFRESH_MS);
    return () => clearInterval(t);
  }, [cfg, cargar]);

  if (!cfg) return <div className={WRAP}><Spinner /></div>;

  const cuerpo = () => {
    if (err && flujos === null) {
      if (es404(err)) {
        return <SinFlujos />;
      }
      return <ErrorState message={err.message} onRetry={cargar} />;
    }
    if (flujos === null) return <Spinner />;
    if (flujos.length === 0) return <SinFlujos />;
    return (
      <div className="grid gap-3 md:grid-cols-2">
        {flujos.map((f) => <TarjetaFlujo key={f.slug} f={f} conexiones={conexiones} />)}
      </div>
    );
  };

  return (
    <EntityProvider cfg={cfg}>
      <div className={WRAP}>
        <PageHeader
          title="Flujos"
          subtitle="Los trabajos que tu agente hace por vos, y lo que producen"
          actions={
            <IconBtn label="Actualizar" disabled={cargando} onClick={cargar}>
              <RefreshCw className={`h-4 w-4 ${cargando ? "animate-spin" : ""}`} />
            </IconBtn>
          }
        />
        {cuerpo()}
      </div>
    </EntityProvider>
  );
}
