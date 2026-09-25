"use client";

// The files the owner hands her agent about the business: price lists,
// catalogs, PDFs. The agent reads them when it needs them; here she sees
// which ones it has, opens any of them in the Files tab's viewer, adds more
// and takes out the ones that went stale.
//
// Deleting asks a second time INLINE, the way «Desvincular» does in the
// Bandeja: no browser confirm(), no modal.

import { useRef, useState, type DragEvent } from "react";
import Link from "next/link";
import { FileText, Loader2, Trash2, Upload } from "lucide-react";
import {
  deleteBusinessFile, uploadBusinessFile,
  type BusinessFile, type PortalConfig,
} from "../lib/agent";
import { Btn } from "../lib/ui";
import { PARAM } from "../lib/routes";
import { dayLabel } from "./SectionCard";

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function FilesBlock({ cfg, files, onChanged }: {
  cfg: PortalConfig;
  files: BusinessFile[];
  onChanged: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [confirmName, setConfirmName] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const upload = async (list: FileList | null) => {
    if (!list || !list.length) return;
    setUploading(true);
    setErr(null);
    try {
      // One at a time: the first that fails says which one and stops.
      for (const f of Array.from(list)) {
        await uploadBusinessFile(cfg, f).catch((e: Error) => {
          throw new Error(`«${f.name}»: ${e.message}`);
        });
      }
    } catch (e) {
      setErr(`No pude subir ${(e as Error).message}`);
    } finally {
      setUploading(false);
      if (input.current) input.current.value = "";
      onChanged();
    }
  };

  const remove = (name: string) => {
    setDeleting(true);
    setErr(null);
    deleteBusinessFile(cfg, name)
      .then(() => { setConfirmName(null); onChanged(); })
      .catch((e: Error) => setErr(`No pude sacarlo: ${e.message}`))
      .finally(() => setDeleting(false));
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    upload(e.dataTransfer.files);
  };

  return (
    <section
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setDragging(false);
      }}
      onDrop={onDrop}
      className={`rounded-xl border bg-white transition ${
        dragging ? "border-primary bg-primary/[0.03]" : "border-black/[0.07]"
      }`}
    >
      <header className="flex flex-wrap items-center gap-2 border-b border-black/[0.07] px-4 py-2.5">
        <h2 className="min-w-0 flex-1 text-sm font-bold text-ink">Archivos</h2>
        <input
          ref={input}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => upload(e.target.files)}
        />
        <Btn kind="secondary" size="sm" disabled={uploading} onClick={() => input.current?.click()}>
          {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          {uploading ? "Subiendo…" : "Subir un archivo"}
        </Btn>
      </header>
      <p className="px-4 pt-3 text-[12px] leading-snug text-ink-soft">
        Listas de precios, catálogos, PDFs: tu agente los lee cuando le hacen falta.
        {" "}También podés arrastrarlos acá.
      </p>

      {files.length === 0 ? (
        <p className="px-4 pb-4 pt-2 text-[13px] text-ink-soft">Todavía no le dejaste ninguno.</p>
      ) : (
        <ul className="mt-2 divide-y divide-black/[0.07] border-t border-black/[0.07]">
          {files.map((f) => (
            <li key={f.name} className="px-4 py-2.5">
              <div className="flex min-w-0 items-center gap-2.5">
                <FileText className="h-4 w-4 shrink-0 text-ink-soft" />
                <Link
                  href={`/app/files?${PARAM.file}=${encodeURIComponent(f.path)}`}
                  className="min-w-0 flex-1 truncate text-sm font-medium text-ink transition hover:text-primary"
                >
                  {f.name}
                </Link>
                <span className="hidden shrink-0 text-[12px] tabular-nums text-ink-soft sm:inline">
                  {fmtSize(f.size)} · {dayLabel(f.uploaded_at)}
                </span>
                {confirmName !== f.name && (
                  <button
                    aria-label={`Sacar ${f.name}`}
                    title="Sacar"
                    onClick={() => setConfirmName(f.name)}
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-soft transition hover:bg-black/[0.05] hover:text-c-coral-ink"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
              <p className="mt-0.5 pl-[26px] text-[12px] tabular-nums text-ink-soft sm:hidden">
                {fmtSize(f.size)} · {dayLabel(f.uploaded_at)}
              </p>
              {confirmName === f.name && (
                <div className="mt-2 flex flex-wrap items-center gap-2 pl-[26px]">
                  <span className="text-[12px] text-ink-soft">Tu agente deja de tenerlo a mano.</span>
                  <Btn kind="danger" size="sm" disabled={deleting} onClick={() => remove(f.name)}>
                    {deleting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    Sí, sacarlo
                  </Btn>
                  <Btn kind="ghost" size="sm" disabled={deleting} onClick={() => setConfirmName(null)}>
                    Cancelar
                  </Btn>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {err && <p className="px-4 pb-3 pt-1 text-[12px] text-c-coral-ink">{err}</p>}
    </section>
  );
}
