"use client";

// Archivos: workspace del agente, solo lectura (sin subir, sin borrar).
// Contrato (adapter v0.3):
//   GET {adapter}/portal/files        → { files: [{ path, size, mtime }] }
//   GET {adapter}/portal/files/{path} → text/plain
// Lista navegable por carpetas (derivadas de los paths) + viewer en Modal.

import { useCallback, useEffect, useState } from "react";
import {
  Code2, File, FileCode, FileJson, FileText, Folder, FolderOpen, X, type LucideIcon,
} from "lucide-react";
import { loadConfig, getFiles, getFileText, type PortalConfig } from "../lib/agent";
import {
  Btn, Card, EmptyState, ErrorState, IconBtn, Modal, PageHeader, Spinner,
} from "../lib/ui";
import { FileBody } from "../lib/EntityViewer";

type FileEntry = { path: string; size?: number; mtime?: string | number };

type Viewer = { path: string; text: string | null; err: string | null };

// Extensiones que abrimos en el viewer de texto.
const TEXT_EXT =
  /\.(md|markdown|txt|text|json|jsonl|csv|tsv|log|ya?ml|toml|ini|cfg|conf|py|rb|sh|sql|xml|html?|css|js|jsx|ts|tsx|mjs|env|rst|out)$/i;

const is404 = (msg: string) => /^404\b/.test(msg);

function fileIcon(name: string): LucideIcon {
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  if (/^(md|markdown|txt|text|rst|log|out)$/.test(ext)) return FileText;
  if (/^(json|jsonl)$/.test(ext)) return FileJson;
  if (/^(py|rb|sh|sql|xml|html?|css|js|jsx|ts|tsx|mjs|ya?ml|toml|ini|cfg|conf|env)$/.test(ext)) return FileCode;
  return File;
}

function toMs(mtime?: string | number): number {
  if (mtime == null) return 0;
  if (typeof mtime === "number") return mtime > 1e12 ? mtime : mtime * 1000; // epoch s vs ms
  const t = Date.parse(mtime);
  return Number.isNaN(t) ? 0 : t;
}

function fmtSize(n?: number): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function relTime(ms: number): string {
  if (!ms) return "";
  const min = Math.floor((Date.now() - ms) / 60_000);
  if (min < 1) return "recién";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? "hace 1 día" : `hace ${d} días`;
}

function entriesFor(files: FileEntry[], dir: string) {
  const prefix = dir ? `${dir}/` : "";
  const folders = new Map<string, number>();
  const inDir: FileEntry[] = [];
  for (const f of files) {
    const p = (f.path || "").replace(/^\/+/, "");
    if (!p || !p.startsWith(prefix)) continue;
    const rest = p.slice(prefix.length);
    if (!rest) continue;
    const slash = rest.indexOf("/");
    if (slash === -1) inDir.push({ ...f, path: p });
    else {
      const name = rest.slice(0, slash);
      folders.set(name, (folders.get(name) || 0) + 1);
    }
  }
  const folderList = Array.from(folders.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
  inDir.sort((a, b) => toMs(b.mtime) - toMs(a.mtime) || a.path.localeCompare(b.path, "es"));
  return { folderList, inDir };
}

export default function ArchivosPage() {
  const [cfg, setCfg] = useState<PortalConfig | null>(null);
  const [files, setFiles] = useState<FileEntry[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [dir, setDir] = useState("");
  const [viewer, setViewer] = useState<Viewer | null>(null);
  // El visor formatea por defecto; "original" muestra el texto crudo (para copiar).
  const [raw, setRaw] = useState(false);

  useEffect(() => { setCfg(loadConfig()); }, []);

  const load = useCallback(() => {
    if (!cfg) return;
    setFiles(null);
    setErr(null);
    getFiles(cfg)
      .then((r) => setFiles(Array.isArray(r.files) ? r.files : []))
      .catch((e: Error) => setErr(e.message || "error"));
  }, [cfg]);

  useEffect(() => { load(); }, [load]);

  const openFile = (path: string) => {
    if (!cfg) return;
    setRaw(false);
    setViewer({ path, text: null, err: null });
    getFileText(cfg, path)
      .then((t) => setViewer({ path, text: t, err: null }))
      .catch((e: Error) => setViewer({ path, text: null, err: e.message || "error" }));
  };

  const body = () => {
    if (err && is404(err)) {
      return (
        <>
          <EmptyState
            icon={FolderOpen}
            title="Los archivos no están disponibles en este agente"
            hint="Tu agente todavía no comparte los archivos de su workspace."
          />
          <div className="flex justify-center"><Btn kind="ghost" size="sm" onClick={load}>Reintentar</Btn></div>
        </>
      );
    }
    if (err) return <ErrorState message={err} onRetry={load} />;
    if (!files) return <Spinner />;
    if (files.length === 0) {
      return (
        <EmptyState
          icon={FolderOpen}
          title="Todavía no hay archivos"
          hint="Cuando tu agente genere reportes o documentos, van a aparecer acá."
        />
      );
    }

    const { folderList, inDir } = entriesFor(files, dir);
    const crumbs = dir ? dir.split("/") : [];

    return (
      <>
        <nav className="mb-3 flex flex-wrap items-center gap-1 px-1 text-sm">
          <button
            onClick={() => setDir("")}
            className={dir ? "font-medium text-ink-soft transition hover:text-ink" : "font-semibold text-ink"}
          >
            Workspace
          </button>
          {crumbs.map((seg, i) => {
            const isLast = i === crumbs.length - 1;
            return (
              <span key={i} className="flex items-center gap-1">
                <span className="text-ink-soft/50">/</span>
                <button
                  onClick={() => setDir(crumbs.slice(0, i + 1).join("/"))}
                  className={isLast ? "font-semibold text-ink" : "font-medium text-ink-soft transition hover:text-ink"}
                >
                  {seg}
                </button>
              </span>
            );
          })}
        </nav>
        <Card className="overflow-hidden !p-0">
          <ul className="divide-y divide-black/[0.06]">
            {folderList.map((f) => (
              <li key={`d-${f.name}`}>
                <button
                  onClick={() => setDir(dir ? `${dir}/${f.name}` : f.name)}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-black/[0.02]"
                >
                  <Folder className="h-4 w-4 shrink-0 text-ink-soft" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{f.name}</span>
                  <span className="shrink-0 text-[12px] tabular-nums text-ink-soft">
                    {f.count === 1 ? "1 archivo" : `${f.count} archivos`}
                  </span>
                </button>
              </li>
            ))}
            {inDir.map((f) => {
              const name = f.path.split("/").pop() || f.path;
              const texty = TEXT_EXT.test(name);
              const Icon = fileIcon(name);
              const meta = [fmtSize(f.size), relTime(toMs(f.mtime))].filter(Boolean).join(" · ");
              return (
                <li key={`f-${f.path}`}>
                  {texty ? (
                    <button
                      onClick={() => openFile(f.path)}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-black/[0.02]"
                    >
                      <Icon className="h-4 w-4 shrink-0 text-ink-soft" />
                      <span className="min-w-0 flex-1 truncate text-sm text-ink">{name}</span>
                      <span className="shrink-0 text-[12px] tabular-nums text-ink-soft">{meta}</span>
                    </button>
                  ) : (
                    <div className="flex w-full items-center gap-3 px-4 py-2.5 opacity-55">
                      <Icon className="h-4 w-4 shrink-0 text-ink-soft" />
                      <span className="min-w-0 flex-1 truncate text-sm text-ink">{name}</span>
                      <span className="shrink-0 text-[12px] tabular-nums text-ink-soft">
                        {meta ? `${meta} · ` : ""}sin vista previa
                      </span>
                    </div>
                  )}
                </li>
              );
            })}
            {folderList.length === 0 && inDir.length === 0 && (
              <li className="px-4 py-6 text-center text-sm text-ink-soft">Esta carpeta está vacía.</li>
            )}
          </ul>
        </Card>
      </>
    );
  };

  const viewerName = viewer ? viewer.path.split("/").pop() || viewer.path : "";
  const viewerMeta = viewer
    ? files?.find((f) => (f.path || "").replace(/^\/+/, "") === viewer.path)
    : undefined;

  return (
    <div className="mx-auto max-w-4xl px-6 py-6 md:px-8">
      <PageHeader title="Archivos" subtitle="Lo que tu agente escribió en su workspace" />
      {body()}
      {viewer && (
        <Modal wide onClose={() => setViewer(null)}>
          <div className="flex items-center justify-between gap-3 border-b border-black/[0.07] px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-ink">{viewerName}</p>
              <p className="truncate text-[11px] text-ink-soft">
                {viewer.path}
                {viewerMeta?.size != null ? ` · ${fmtSize(viewerMeta.size)}` : ""}
                {toMs(viewerMeta?.mtime) ? ` · ${relTime(toMs(viewerMeta?.mtime))}` : ""}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              {viewer.text !== null && viewer.text.trim() !== "" && (
                <IconBtn
                  label={raw ? "Ver formateado" : "Ver original"}
                  onClick={() => setRaw((v) => !v)}
                >
                  {raw ? <FileText className="h-4 w-4" /> : <Code2 className="h-4 w-4" />}
                </IconBtn>
              )}
              <IconBtn label="Cerrar" onClick={() => setViewer(null)}>
                <X className="h-4 w-4" />
              </IconBtn>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            {viewer.text === null && viewer.err === null && <Spinner />}
            {viewer.err && (
              <ErrorState
                message={`No pude abrir el archivo (${viewer.err}).`}
                onRetry={() => openFile(viewer.path)}
              />
            )}
            {viewer.text !== null && (
              viewer.text.trim() === "" ? (
                <p className="text-sm text-ink-soft">El archivo está vacío.</p>
              ) : raw ? (
                <pre className="whitespace-pre-wrap break-words font-mono text-[12.5px] leading-relaxed text-ink">
                  {viewer.text}
                </pre>
              ) : (
                <FileBody path={viewer.path} text={viewer.text} />
              )
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
