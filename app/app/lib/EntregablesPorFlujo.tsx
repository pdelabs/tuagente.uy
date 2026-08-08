"use client";

// Los entregables de cada flujo, para la pestaña Entregas: la mitad "archivos"
// de lo que el agente produce (la otra mitad son las visualizaciones HTML, que
// viven abajo en la misma página). Los datos salen de /portal/flujos — que ya
// agrupa por flujo y trae nombre humano — así esta vista no inventa nada.

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight, Workflow } from "lucide-react";
import { getFlujos, type Flujo, type PortalConfig } from "./agent";
import { EntityProvider } from "./EntityViewer";
import { EntityChip } from "./entities";
import { Card } from "./ui";

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

export default function EntregablesPorFlujo({ cfg }: { cfg: PortalConfig }) {
  const [flujos, setFlujos] = useState<Flujo[] | null>(null);

  useEffect(() => {
    let vivo = true;
    getFlujos(cfg)
      .then((r) => { if (vivo) setFlujos(r?.flujos ?? []); })
      // Agente sin flujos (o adapter viejo): esta sección simplemente no existe.
      .catch(() => { if (vivo) setFlujos([]); });
    return () => { vivo = false; };
  }, [cfg]);

  const conResultados = (flujos ?? []).filter((f) => f.resultados.length > 0);
  if (conResultados.length === 0) return null;

  return (
    <EntityProvider cfg={cfg}>
      <div className="mb-7 flex flex-col gap-4">
        {conResultados.map((f) => (
          <section key={f.slug}>
            <Link
              href={`/app/flujos/${f.slug}`}
              className="mb-2 flex w-fit items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-ink-soft transition hover:text-ink"
            >
              <Workflow className="h-3.5 w-3.5" />
              {f.nombre}
              <span className="tabular-nums text-ink-soft/70">{f.resultados_total}</span>
              <ChevronRight className="h-3.5 w-3.5" />
            </Link>
            <Card className="!p-3">
              <ul className="flex flex-col gap-1.5">
                {f.resultados.slice(0, 6).map((r) => (
                  <li key={r.path} className="flex items-center gap-2">
                    {/* min-w-0 + flex-1: el chip trunca ADENTRO de la fila. */}
                    <span className="min-w-0 flex-1">
                      <EntityChip entity={{ kind: "file", path: r.path }} label={nombreArchivo(r.path)} />
                    </span>
                    <span className="shrink-0 whitespace-nowrap text-[11px] text-ink-soft">
                      {hace(r.mtime)}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          </section>
        ))}
      </div>
    </EntityProvider>
  );
}
