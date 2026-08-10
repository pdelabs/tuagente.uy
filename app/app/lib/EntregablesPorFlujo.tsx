"use client";

// Los entregables en la pestaña Entregas, como CARPETAS que se abren AHÍ
// MISMO (pedido de Luis del 8/8): click en la carpeta → la lista de sus
// archivos, como en Archivos, con el visor de siempre al clickear cada uno.
// La página del flujo queda como link secundario, no como destino del click.
// Datos: /portal/flujos para la grilla; /portal/flujos/<slug> al abrir una
// (trae los resultados completos, no el tope de 20 de la lista).

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, FileText, Folder } from "lucide-react";
import {
  getFlujoDetalle, getFlujos,
  type Flujo, type FlujoDetalle, type PortalConfig,
} from "./agent";
import { EntityProvider } from "./EntityViewer";
import { useOpenEntity } from "./entities";
import { Card, Spinner } from "./ui";

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

/** Una fila-archivo: clickeable entera, abre el visor del portal. */
function FilaArchivo({ path, mtime }: { path: string; mtime: number }) {
  const open = useOpenEntity();
  return (
    <button
      onClick={() => open?.({ kind: "file", path })}
      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition hover:bg-black/[0.03]"
    >
      <FileText className="h-4 w-4 shrink-0 text-ink-soft" />
      <span className="min-w-0 flex-1 truncate text-sm text-ink">{nombreArchivo(path)}</span>
      <span className="shrink-0 whitespace-nowrap text-[11px] text-ink-soft">{hace(mtime)}</span>
    </button>
  );
}

export default function EntregablesPorFlujo({ cfg }: { cfg: PortalConfig }) {
  const [flujos, setFlujos] = useState<Flujo[] | null>(null);
  const [abierta, setAbierta] = useState<string | null>(null);
  const [detalle, setDetalle] = useState<FlujoDetalle | null>(null);

  useEffect(() => {
    let vivo = true;
    getFlujos(cfg)
      .then((r) => { if (vivo) setFlujos(r?.flujos ?? []); })
      // Agente sin flujos (o adapter viejo): esta sección simplemente no existe.
      .catch(() => { if (vivo) setFlujos([]); });
    return () => { vivo = false; };
  }, [cfg]);

  useEffect(() => {
    if (!abierta) { setDetalle(null); return; }
    let vivo = true;
    getFlujoDetalle(cfg, abierta)
      .then((d) => { if (vivo) setDetalle(d); })
      .catch(() => { if (vivo) setAbierta(null); });
    return () => { vivo = false; };
  }, [cfg, abierta]);

  const conResultados = (flujos ?? []).filter((f) => f.resultados.length > 0);
  if (conResultados.length === 0) return null;

  if (abierta) {
    return (
      <EntityProvider cfg={cfg}>
        <div className="mb-8">
          <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            <button
              onClick={() => setAbierta(null)}
              className="inline-flex items-center gap-1 text-[13px] font-semibold text-ink-soft transition hover:text-ink"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Carpetas
            </button>
            <h2 className="text-sm font-bold text-ink">
              {detalle?.nombre ?? abierta}
              {detalle && (
                <span className="ml-1.5 text-[12px] font-normal tabular-nums text-ink-soft">
                  {detalle.resultados_total}
                </span>
              )}
            </h2>
            <Link
              href={`/app/flujos/${abierta}`}
              className="inline-flex items-center gap-0.5 text-[12px] font-semibold text-primary transition hover:text-primary-dark"
            >
              Ver el flujo <ArrowUpRight className="h-3 w-3" />
            </Link>
          </div>
          <Card className="!p-2">
            {detalle === null ? (
              <Spinner />
            ) : detalle.resultados.length === 0 ? (
              <p className="px-2.5 py-2 text-[13px] text-ink-soft">La carpeta está vacía.</p>
            ) : (
              <div className="flex flex-col">
                {detalle.resultados.map((r) => (
                  <FilaArchivo key={r.path} path={r.path} mtime={r.mtime} />
                ))}
              </div>
            )}
          </Card>
        </div>
      </EntityProvider>
    );
  }

  return (
    <div className="mb-8">
      <h2 className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-ink-soft">
        Por flujo
      </h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {conResultados.map((f) => (
          <button
            key={f.slug}
            onClick={() => setAbierta(f.slug)}
            className="group flex items-center gap-3 rounded-xl border border-black/[0.07] bg-white p-4 text-left shadow-soft transition hover:-translate-y-0.5 hover:border-primary/40"
          >
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-c-violet/50 transition group-hover:bg-c-violet/80">
              <Folder className="h-5 w-5 text-c-violet-ink" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-ink group-hover:text-primary">
                {f.nombre}
              </span>
              <span className="block text-[12px] text-ink-soft">
                {f.resultados_total} {f.resultados_total === 1 ? "entrega" : "entregas"}
                {" · "}
                {hace(f.resultados[0].mtime)}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
