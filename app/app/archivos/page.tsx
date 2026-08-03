"use client";

// Archivos: workspace del agente, solo lectura (sin subir, sin borrar).
// Contrato (spec 05):
//   GET {adapter}/portal/files        → { files: [{ path, size, mtime }] }
//   GET {adapter}/portal/files/{path} → text/plain
// Lista navegable por carpetas (derivadas de los paths) + viewer monoespaciado.

import { useCallback, useEffect, useState } from "react";
import { loadConfig, getFiles, getFileText, type PortalConfig } from "../lib/agent";
import { Btn, Card, EmptyState, ErrorState, Spinner } from "../lib/ui";

type FileEntry = { path: string; size?: number; mtime?: string | number };

type Viewer = { path: string; text: string | null; err: string | null };

// Extensiones que abrimos en el viewer de texto.
const TEXT_EXT =
  /\.(md|markdown|txt|text|json|jsonl|csv|tsv|log|ya?ml|toml|ini|cfg|conf|py|rb|sh|sql|xml|html?|css|js|jsx|ts|tsx|mjs|env|rst)$/i;

const is404 = (msg: string) => /^404\b/.test(msg);

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
    setViewer({ path, text: null, err: null });
    getFileText(cfg, path)
      .then((t) => setViewer({ path, text: t, err: null }))
      .catch((e: Error) => setViewer({ path, text: null, err: e.message || "error" }));
  };

  // ── Viewer ──
  if (viewer) {
    const name = viewer.path.split("/").pop() || viewer.path;
    const meta = files?.find((f) => (f.path || "").replace(/^\/+/, "") === viewer.path);
    return (
      <div className="max-w-3xl">
        <header className="mb-6">
          <button
            onClick={() => setViewer(null)}
            className="text-sm font-bold text-primary hover:text-primary-dark"
          >
            ← Volver a archivos
          </button>
          <h1 className="text-2xl font-extrabold text-ink tracking-tight mt-2 break-words">
            {name}
          </h1>
          <p className="text-xs text-ink-soft mt-1 break-words">
            {viewer.path}
            {meta?.size != null && ` · ${fmtSize(meta.size)}`}
            {toMs(meta?.mtime) ? ` · ${relTime(toMs(meta?.mtime))}` : ""}
          </p>
        </header>
        {viewer.text === null && viewer.err === null && <Spinner />}
        {viewer.err && (
          <ErrorState
            message={`No pude abrir el archivo (${viewer.err}).`}
            onRetry={() => openFile(viewer.path)}
          />
        )}
        {viewer.text !== null && (
          <Card>
            {viewer.text.trim() === "" ? (
              <p className="text-sm text-ink-soft">El archivo está vacío.</p>
            ) : (
              <pre className="font-mono text-xs leading-relaxed text-ink whitespace-pre-wrap break-words">
                {viewer.text}
              </pre>
            )}
          </Card>
        )}
      </div>
    );
  }

  // ── Lista ──
  const body = () => {
    if (err && is404(err)) {
      return (
        <>
          <EmptyState
            emoji="📁"
            title="Los archivos no están disponibles en este agente"
            hint="Tu agente todavía no comparte los archivos de su workspace."
          />
          <div className="flex justify-center"><Btn kind="ghost" onClick={load}>Reintentar</Btn></div>
        </>
      );
    }
    if (err) return <ErrorState message={err} onRetry={load} />;
    if (!files) return <Spinner />;
    if (files.length === 0) {
      return (
        <EmptyState
          emoji="🗂️"
          title="Todavía no hay archivos"
          hint="Cuando tu agente genere reportes o documentos, van a aparecer acá."
        />
      );
    }

    const { folderList, inDir } = entriesFor(files, dir);
    const crumbs = dir ? dir.split("/") : [];

    return (
      <>
        <nav className="mb-3 flex flex-wrap items-center gap-1 px-1 text-sm text-ink-soft">
          <button
            onClick={() => setDir("")}
            className={`font-bold ${dir ? "text-primary hover:text-primary-dark" : "text-ink"}`}
          >
            Workspace
          </button>
          {crumbs.map((seg, i) => {
            const isLast = i === crumbs.length - 1;
            return (
              <span key={i} className="flex items-center gap-1">
                <span>/</span>
                <button
                  onClick={() => setDir(crumbs.slice(0, i + 1).join("/"))}
                  className={`font-bold ${isLast ? "text-ink" : "text-primary hover:text-primary-dark"}`}
                >
                  {seg}
                </button>
              </span>
            );
          })}
        </nav>
        <Card className="!p-0">
          <ul className="divide-y divide-surface">
            {folderList.map((f) => (
              <li key={`d-${f.name}`}>
                <button
                  onClick={() => setDir(dir ? `${dir}/${f.name}` : f.name)}
                  className="flex w-full items-center gap-3 px-5 py-3.5 text-left hover:bg-surface transition"
                >
                  <span className="text-lg">📁</span>
                  <span className="min-w-0 flex-1 truncate text-sm font-bold text-ink">{f.name}</span>
                  <span className="shrink-0 text-xs text-ink-soft">
                    {f.count === 1 ? "1 archivo" : `${f.count} archivos`}
                  </span>
                </button>
              </li>
            ))}
            {inDir.map((f) => {
              const name = f.path.split("/").pop() || f.path;
              const texty = TEXT_EXT.test(name);
              const meta = [fmtSize(f.size), relTime(toMs(f.mtime))].filter(Boolean).join(" · ");
              return (
                <li key={`f-${f.path}`}>
                  {texty ? (
                    <button
                      onClick={() => openFile(f.path)}
                      className="flex w-full items-center gap-3 px-5 py-3.5 text-left hover:bg-surface transition"
                    >
                      <span className="text-lg">📄</span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{name}</span>
                      <span className="shrink-0 text-xs text-ink-soft">{meta}</span>
                    </button>
                  ) : (
                    <div className="flex w-full items-center gap-3 px-5 py-3.5 opacity-60">
                      <span className="text-lg">📄</span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{name}</span>
                      <span className="shrink-0 text-xs text-ink-soft">
                        {meta ? `${meta} · ` : ""}sin vista previa
                      </span>
                    </div>
                  )}
                </li>
              );
            })}
            {folderList.length === 0 && inDir.length === 0 && (
              <li className="px-5 py-6 text-center text-sm text-ink-soft">Esta carpeta está vacía.</li>
            )}
          </ul>
        </Card>
      </>
    );
  };

  return (
    <div className="max-w-3xl">
      <header className="mb-6">
        <h1 className="text-2xl font-extrabold text-ink tracking-tight">Archivos</h1>
        <p className="text-sm text-ink-soft mt-1">
          Los documentos del workspace de tu agente. Solo lectura.
        </p>
      </header>
      {body()}
    </div>
  );
}
