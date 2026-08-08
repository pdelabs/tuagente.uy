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
  getFlujos, loadConfig,
  type Flujo, type HttpError, type PortalConfig,
} from "../lib/agent";
import { EntityProvider } from "../lib/EntityViewer";
import { EntityChip } from "../lib/entities";
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

function TarjetaFlujo({ f }: { f: Flujo }) {
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

      {/* Incompleto: el paso que lo destraba, no un diagnóstico. */}
      {f.estado === "incompleto" && (
        <Link
          href="/app/conexiones"
          className="inline-flex h-9 w-fit items-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-semibold text-white transition hover:bg-primary-dark"
        >
          Conectar lo que falta
          <ArrowRight className="h-4 w-4" />
        </Link>
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

export default function FlujosPage() {
  const [cfg, setCfg] = useState<PortalConfig | null>(null);
  const [flujos, setFlujos] = useState<Flujo[] | null>(null);
  const [err, setErr] = useState<Falla | null>(null);
  const [cargando, setCargando] = useState(false);

  useEffect(() => setCfg(loadConfig()), []);

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
        return (
          <EmptyState
            icon={Workflow}
            title="Este agente todavía no tiene flujos"
            hint="Cuando armemos el primero — o se lo pidas por el chat — lo vas a ver acá con sus resultados."
          />
        );
      }
      return <ErrorState message={err.message} onRetry={cargar} />;
    }
    if (flujos === null) return <Spinner />;
    if (flujos.length === 0) {
      return (
        <EmptyState
          icon={Workflow}
          title="Todavía no hay flujos armados"
          hint="Pedile uno a tu agente por el chat: contale qué tarea querés sacarte de encima."
        />
      );
    }
    return (
      <div className="grid gap-3 md:grid-cols-2">
        {flujos.map((f) => <TarjetaFlujo key={f.slug} f={f} />)}
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
