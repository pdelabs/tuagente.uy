"use client";

// Deliverables on the Artifacts tab, as FOLDERS that open RIGHT THERE (Luis's
// request from 8/8): click the folder -> the list of its files, like on
// Files, with the usual viewer when you click each one. The flow's own page
// stays a secondary link, not the click's destination. Data: /portal/flows
// for the grid; /portal/flows/<slug> when opening one (it brings the full
// results, not the list's 20-item cap).

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, FileText, Folder } from "lucide-react";
import {
  getFlowDetail, getFlows,
  type Flow, type FlowDetail, type PortalConfig,
} from "./agent";
import { EntityProvider } from "./EntityViewer";
import { useOpenEntity } from "./entities";
import { Card, Spinner } from "./ui";

function timeAgo(mtime: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000 - mtime));
  if (s < 3600) return `hace ${Math.max(1, Math.floor(s / 60))} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  const d = Math.floor(s / 86400);
  return d === 1 ? "ayer" : `hace ${d} días`;
}

function fileName(path: string): string {
  const base = (path || "").split("/").pop() || path;
  return base.replace(/^\d{4}-\d{2}-\d{2}[-_ ]/, "") || base;
}

/** A file row: clickable end to end, opens the portal's viewer. */
function FileRow({ path, mtime }: { path: string; mtime: number }) {
  const open = useOpenEntity();
  return (
    <button
      onClick={() => open?.({ kind: "file", path })}
      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition hover:bg-black/[0.03]"
    >
      <FileText className="h-4 w-4 shrink-0 text-ink-soft" />
      <span className="min-w-0 flex-1 truncate text-sm text-ink">{fileName(path)}</span>
      <span className="shrink-0 whitespace-nowrap text-[11px] text-ink-soft">{timeAgo(mtime)}</span>
    </button>
  );
}

export default function DeliverablesByFlow({ cfg }: { cfg: PortalConfig }) {
  const [flows, setFlows] = useState<Flow[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [detail, setDetail] = useState<FlowDetail | null>(null);

  useEffect(() => {
    let alive = true;
    getFlows(cfg)
      .then((r) => { if (alive) setFlows(r?.flows ?? []); })
      // Agent with no flows (or an old adapter): this section simply doesn't exist.
      .catch(() => { if (alive) setFlows([]); });
    return () => { alive = false; };
  }, [cfg]);

  useEffect(() => {
    if (!open) { setDetail(null); return; }
    let alive = true;
    getFlowDetail(cfg, open)
      .then((d) => { if (alive) setDetail(d); })
      .catch(() => { if (alive) setOpen(null); });
    return () => { alive = false; };
  }, [cfg, open]);

  const withResults = (flows ?? []).filter((f) => f.results.length > 0);
  if (withResults.length === 0) return null;

  if (open) {
    return (
      <EntityProvider cfg={cfg}>
        <div className="mb-8">
          <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            <button
              onClick={() => setOpen(null)}
              className="inline-flex items-center gap-1 text-[13px] font-semibold text-ink-soft transition hover:text-ink"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Carpetas
            </button>
            <h2 className="text-sm font-bold text-ink">
              {detail?.name ?? open}
              {detail && (
                <span className="ml-1.5 text-[12px] font-normal tabular-nums text-ink-soft">
                  {detail.results_total}
                </span>
              )}
            </h2>
            <Link
              href={`/app/flows/${open}`}
              className="inline-flex items-center gap-0.5 text-[12px] font-semibold text-primary transition hover:text-primary-dark"
            >
              Ver el flujo <ArrowUpRight className="h-3 w-3" />
            </Link>
          </div>
          <Card className="!p-2">
            {detail === null ? (
              <Spinner />
            ) : detail.results.length === 0 ? (
              <p className="px-2.5 py-2 text-[13px] text-ink-soft">La carpeta está vacía.</p>
            ) : (
              <div className="flex flex-col">
                {detail.results.map((r) => (
                  <FileRow key={r.path} path={r.path} mtime={r.mtime} />
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
        {withResults.map((f) => (
          <button
            key={f.slug}
            onClick={() => setOpen(f.slug)}
            className="group flex items-center gap-3 rounded-xl border border-black/[0.07] bg-white p-4 text-left shadow-soft transition hover:-translate-y-0.5 hover:border-primary/40"
          >
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-c-violet/50 transition group-hover:bg-c-violet/80">
              <Folder className="h-5 w-5 text-c-violet-ink" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-ink group-hover:text-primary">
                {f.name}
              </span>
              <span className="block text-[12px] text-ink-soft">
                {f.results_total} {f.results_total === 1 ? "entrega" : "entregas"}
                {" · "}
                {timeAgo(f.results[0].mtime)}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
