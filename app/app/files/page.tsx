"use client";

// Files: the agent's papers and the client's, in the same place.
// Contract (adapter v0.3, upload ≥0.14):
//   GET  {adapter}/portal/files        → { files: [{ path, size, mtime }] }
//   GET  {adapter}/portal/files/{path} → text/plain
//   POST {adapter}/portal/upload       → { ok, path: "workspace/entrada/…", bytes }
// List navigable by folders (derived from the paths) + a viewer in a Modal.
//
// Agent-side conventions this module respects:
//   entregables/ → what the agent produces FOR the client (YAML front matter
//                  set by the `deliverable` skill). Goes first at the root.
//   entrada/     → the inbox: where files the client uploads land.
//   interno/     → scripts, tests, scaffolding. Hidden unless asked to be shown.
//
// THIS SCREEN USED TO BE READ-ONLY, and that decision didn't survive the
// first client. A real-estate agency owner, with no clue what this even
// was, wrote it plainly: "there's a missing screen: where do I put MY
// papers. If I want to give it my spreadsheet I have to find the little
// paperclip in the chat. That should be the first thing it asks me for."
// Upload already existed —the adapter exposes it and the chat uses it— and
// it was hidden behind an icon inside a conversation. Now it's where she
// went looking for it.
//
// BUT ONLY IF THE AGENT DECLARES IT. The portal serves any Hermes agent: if
// its manifest doesn't carry `modules.upload`, there's no upload here and
// the screen goes back to read-only. Offering a button the other side
// doesn't have is the fastest way for the client to think something of
// theirs broke.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Check, Code2, Download, Eye, File, FileCode, FileJson, FileText, Folder, FolderOpen,
  Inbox, Search, Upload, X, type LucideIcon,
} from "lucide-react";
import {
  loadConfig, getFiles, getFileText, getFileBytes, getManifest, uploadFile,
  type Manifest, type PortalConfig,
} from "../lib/agent";
import {
  dateTime, utcOffsetOf, businessUtcOffset, isoWithOffset, moment, momentOf, type Moment,
} from "../lib/labels";
import { CopyLink, PARAM, openInRoute, closeInRoute, useRouteParam } from "../lib/routes";
import {
  StaleLinkNotice, Btn, Card, Chip, EmptyState, ErrorState, IconBtn, Modal, PageHeader,
  Spinner, inputCls,
} from "../lib/ui";
import { FileBody, AgentImage } from "../lib/EntityViewer";
import { readableFileName, fileType } from "../lib/names";
import Spreadsheet, { CsvPreview } from "../lib/Spreadsheet";

type FileEntry = { path: string; size?: number; mtime?: string | number };

// `binary`: not text, no preview — download only.
type Viewer = {
  path: string; text: string | null; err: string | null;
  binary?: boolean;
  /** Bytes of a spreadsheet, to render it. Only requested for .xlsx/.xls. */
  sheet?: ArrayBuffer | null;
};

// Front matter written by the `deliverable` skill (title/kind/date/tags).
type FrontMatter = { title?: string; kind?: string; date?: string; tags: string[] };

// Extensions we open in the text viewer.
const TEXT_EXT =
  /\.(md|markdown|txt|text|json|jsonl|csv|tsv|log|ya?ml|toml|ini|cfg|conf|py|rb|sh|sql|xml|html?|css|js|jsx|ts|tsx|mjs|env|rst|out)$/i;

const INTERNAL = "interno";     // agent scaffolding: not for the client
const DELIVERABLES = "entregables"; // what the agent delivers to the client
const INBOX = "entrada";        // the inbox: what the client leaves for the agent

const is404 = (msg: string) => /^404\b/.test(msg);

const clean = (p: string) => (p || "").replace(/^\/+/, "");

// Scaffolding: the scripts the agent writes for itself to work. They live
// LOOSE at the workspace root, not inside `interno/`, so the old rule (only
// that folder) left them in view: a test client opened Files and the first
// thing she saw was sixteen `create_batch_tickets.py`, right below an
// explanation that promised her "the scaffolding stays separate". They can
// still be seen with the toggle below.
const SCRIPT_EXT = /\.(py|sh|bash|zsh|rb|pl|js|mjs|cjs|ts|tsx|jsx|ipynb)$/i;

// WHAT THE CLIENT UPLOADS IS NEVER SCAFFOLDING. The script rule looks at the
// extension no matter where it comes from, so a `.py` or a `.js` the client
// uploaded to the inbox would disappear from the list — with the "done,
// you left it for your agent" notice still up top and the folder saying
// "you haven't left it anything yet".
const isInternal = (path: string) =>
  path === INTERNAL ||
  path.startsWith(`${INTERNAL}/`) ||
  (!path.startsWith(`${INBOX}/`) && SCRIPT_EXT.test(path.split("/").pop() || ""));

// Comparison insensitive to accents and case (search and duplicate titles).
const norm = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

function fileIcon(name: string): LucideIcon {
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  if (/^(md|markdown|txt|text|rst|log|out)$/.test(ext)) return FileText;
  if (/^(json|jsonl)$/.test(ext)) return FileJson;
  if (/^(py|rb|sh|sql|xml|html?|css|js|jsx|ts|tsx|mjs|ya?ml|toml|ini|cfg|conf|env)$/.test(ext)) return FileCode;
  return File;
}

// `mtime` arrives as epoch in seconds with no timezone. `momentOf` is what
// reads it, the portal's single gate: it returns the instant (for sorting)
// already read in the business's clock (for display).
const msOf = (mtime?: string | number): number => momentOf(mtime)?.ms ?? 0;

function fmtSize(n?: number): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Front matter ───────────────────────────────────────────────────────────
// Minimal parser: only the keys the skill writes. Anything odd (an
// unclosed block, nested YAML, unknown keys) falls into "no front matter"
// and the file shows up raw. Never breaks the viewer.

const KIND_LABEL: Record<string, string> = {
  informe: "Informe", lista: "Lista", borrador: "Borrador",
  nota: "Nota", analisis: "Análisis",
};

const FM_RE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

const unquote = (s: string) => s.trim().replace(/^(['"])([\s\S]*)\1$/, "$2").trim();

function splitTags(raw: string): string[] {
  const inline = /^\[([\s\S]*)\]$/.exec(raw); // tags: [a, b]
  return (inline ? inline[1] : raw)
    .split(",")
    .map(unquote)
    .filter(Boolean);
}

function parseFrontMatter(path: string, text: string): { fm: FrontMatter | null; body: string } {
  const plain = { fm: null, body: text };
  if (!/\.(md|markdown)$/i.test(path)) return plain;
  try {
    const m = FM_RE.exec(text);
    if (!m) return plain;
    const fm: FrontMatter = { tags: [] };
    let key = "";
    for (const line of m[1].split(/\r?\n/)) {
      if (!line.trim()) continue;
      const item = /^\s*-\s+(.+)$/.exec(line); // YAML list item for the previous key
      if (item) {
        if (key === "tags") fm.tags.push(unquote(item[1]));
        continue;
      }
      const kv = /^([A-Za-z_][\w-]*)[ \t]*:[ \t]*(.*)$/.exec(line);
      if (!kv) continue;
      key = kv[1].toLowerCase();
      const val = unquote(kv[2]);
      if (!val) continue;
      if (key === "tags") fm.tags.push(...splitTags(val));
      else if (key === "title") fm.title = val;
      else if (key === "kind") fm.kind = val;
      else if (key === "date") fm.date = val;
    }
    if (!fm.title && !fm.kind && !fm.date && fm.tags.length === 0) return plain;
    let body = text.slice(m[0].length).replace(/^\s*\n/, "");
    // The skill repeats the title as an H1; with the title in the modal's
    // header, showing it again is noise.
    const h1 = /^#[ \t]+(.+?)[ \t]*(?:\r?\n|$)/.exec(body);
    if (h1 && fm.title && norm(h1[1]) === norm(fm.title)) {
      body = body.slice(h1[0].length).replace(/^\s*\n/, "");
    }
    return { fm, body };
  } catch {
    return plain; // when in doubt, the file as-is
  }
}

/** A date with NO timezone read as the business's wall clock time: the
 *  digits the agent wrote are its own, and they're what shows no matter who
 *  looks. (They're read as if they were UTC and shifted to the business's
 *  offset: it's the only way to paint another timezone with what
 *  `labels.ts` exports.) */
function businessWallTime(iso: string): Moment | null {
  const ms = Date.parse(`${iso}Z`);
  if (Number.isNaN(ms)) return null;
  const off = businessUtcOffset();
  return moment(isoWithOffset(ms - off * 60_000, off));
}

/** The front matter's `date`, on the business's clock.
 *
 *  Written by the `deliverable` skill and today it arrives with no
 *  timezone ("date: 2026-08-13 07:03"): that's 07:03 OVER THERE. With a
 *  plain `new Date()` the digits used to come back intact by pure
 *  coincidence —the same browser clock parsed and formatted— and that
 *  coincidence breaks on its own in two ways: the day the skill adds a
 *  timezone ("…-03:00"), and already today with a date and no time, which
 *  `new Date()` reads as UTC midnight and in any timezone west of it rolls
 *  back to the previous day. */
function fmtDate(value: string): string {
  const v = value.trim();
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(v);
  const m = utcOffsetOf(v) !== null
    ? momentOf(v)                              // already carries its own offset: respected
    : businessWallTime(dateOnly ? `${v}T12:00:00` : v.replace(" ", "T"));
  if (!m) return value; // what isn't understood shows as-is
  // With no time written, none gets invented: "13 ago" and that's it.
  return dateOnly ? m.date : `${m.date} ${m.time}`;
}

// ── Listing ──────────────────────────────────────────────────────────────

function entriesFor(files: FileEntry[], dir: string) {
  const prefix = dir ? `${dir}/` : "";
  const folders = new Map<string, number>();
  const inDir: FileEntry[] = [];
  for (const f of files) {
    const p = clean(f.path);
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
    .sort((a, b) => {
      // At the root, what's for the client goes above everything: first
      // what the agent delivered to them, then the inbox where they leave
      // their own.
      if (!dir) {
        const rank = (n: string) => (n === DELIVERABLES ? 0 : n === INBOX ? 1 : 2);
        if (rank(a.name) !== rank(b.name)) return rank(a.name) - rank(b.name);
      }
      return a.name.localeCompare(b.name, "es");
    });
  inDir.sort((a, b) => msOf(b.mtime) - msOf(a.mtime) || a.path.localeCompare(b.path, "es"));
  return { folderList, inDir };
}

/** The folder a file lives in ("entregables/informe.md" → "entregables").
 *  Used so a link to a loose file still opens the correct folder behind
 *  the viewer. */
const stripPrefix = (p: string | null) =>
  p ? p.replace(/^\/?(?:opt\/data\/)?workspace\//, "").replace(/^\.\//, "") : null;

const folderOf = (path: string) => {
  const i = clean(path).lastIndexOf("/");
  return i === -1 ? "" : clean(path).slice(0, i);
};

export default function FilesPage() {
  const [cfg, setCfg] = useState<PortalConfig | null>(null);
  const [files, setFiles] = useState<FileEntry[] | null>(null);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Where the client is standing is decided by the URL: `?folder=entregables`
  // and `?file=entregables/informe.md`. That way the agent can send the
  // link to a specific deliverable, and refreshing doesn't send them back
  // to the root.
  const folderFromUrl = useRouteParam(PARAM.folder);
  // The agent writes its paths with the workspace prefix
  // (`workspace/entregables/informe.md`) and that's how it'll cite them in
  // a link. The portal already knows how to strip it when detecting
  // entities; here too, or the most natural link the agent can build ends
  // up as "couldn't find that file".
  const openPath = stripPrefix(useRouteParam(PARAM.file));
  const dir = folderFromUrl ?? (openPath ? folderOf(openPath) : "");
  const [q, setQ] = useState("");
  const [showInternal, setShowInternal] = useState(false);
  const [viewer, setViewer] = useState<Viewer | null>(null);
  // The viewer formats by default; "original" shows the raw text (to copy).
  const [raw, setRaw] = useState(false);

  useEffect(() => { setCfg(loadConfig()); }, []);

  // A LINK TO SOMETHING INTERNAL FLIPS THE INTERNAL TOGGLE. Without this,
  // `?folder=interno` opened a folder with eight files inside and said
  // "This folder is empty": the scaffolding filter ate everything the link
  // came to show, and the client saw the portal contradict itself. Same
  // goes for `?file=` on a loose script, which is also "internal".
  useEffect(() => {
    if (isInternal(dir) || (openPath && isInternal(openPath))) setShowInternal(true);
  }, [dir, openPath]);

  const load = useCallback(() => {
    if (!cfg) return;
    setFiles(null);
    setErr(null);
    getFiles(cfg)
      .then((r) => setFiles(Array.isArray(r.files) ? r.files : []))
      .catch((e: Error) => setErr(e.message || "error"));
  }, [cfg]);

  useEffect(() => { load(); }, [load]);

  // The manifest is what says whether this agent accepts having something
  // uploaded to it. If it doesn't answer, it isn't offered: when in doubt,
  // the screen stays as it was.
  useEffect(() => {
    if (!cfg) return;
    let alive = true;
    getManifest(cfg).then((m) => { if (alive) setManifest(m); }).catch(() => {});
    return () => { alive = false; };
  }, [cfg]);

  const canUpload = manifest?.modules?.upload === true;

  // Entering a folder is navigating: each one has its own link and "back" goes up.
  const goTo = (next: string) => {
    setQ("");
    openInRoute({ [PARAM.folder]: next || null, [PARAM.file]: null });
  };

  const toggleInternal = () => {
    const next = !showInternal;
    // If we were inside interno/, that folder stops existing: back to the root.
    if (!next && isInternal(dir)) goTo("");
    setShowInternal(next);
  };

  // What isn't text doesn't get previewed: it gets downloaded. Trying to
  // render it shows garbage and, worse, the download came out of the
  // already-corrupted text.
  const NOT_TEXT = new Set([
    "xlsx", "xls", "ods", "docx", "doc", "odt", "pptx", "ppt", "pdf",
    "png", "jpg", "jpeg", "gif", "webp", "svgz", "ico", "bmp",
    "zip", "gz", "tar", "7z", "rar", "mp3", "mp4", "mov", "wav", "ogg",
  ]);
  const isBinary = (p: string) => NOT_TEXT.has((p.split(".").pop() ?? "").toLowerCase());

  const isSpreadsheet = (p: string) => ["xlsx", "xls"].includes((p.split(".").pop() ?? "").toLowerCase());

  // An image gets LOOKED AT. Telling the "no preview" line to the flyer the
  // agent just made for WhatsApp —and forcing her to download it just to
  // know whether it looks right— was one of the things QA flagged: "it's
  // an image, why can't it show it to me?".
  const isPhoto = (p: string) =>
    /\.(jpe?g|png|gif|webp|bmp|svg|ico|heic|avif)$/i.test(p);

  /** Opening a file is navigating: it also carries the folder you're in, so
   *  the shared link shows the same background you had. */
  const openFile = (path: string) =>
    openInRoute({ [PARAM.file]: path, [PARAM.folder]: dir || null });
  const closeViewer = useCallback(() => closeInRoute(PARAM.file), []);

  const loadFile = useCallback((path: string) => {
    if (!cfg) return;
    setRaw(false);
    // Spreadsheets DO get shown: the agent delivers quotes and reports in
    // xlsx, and downloading them just to see three numbers isn't a preview.
    if (isSpreadsheet(path)) {
      setViewer({ path, text: null, err: null, binary: true, sheet: null });
      getFileBytes(cfg, path)
        .then((b) => setViewer({ path, text: null, err: null, binary: true, sheet: b }))
        .catch((e: Error) => setViewer({ path, text: null, err: e.message || "error", binary: true }));
      return;
    }
    if (isPhoto(path) || isBinary(path)) {
      setViewer({ path, text: null, err: null, binary: true });
      return;
    }
    setViewer({ path, text: null, err: null });
    getFileText(cfg, path)
      .then((t) => setViewer({ path, text: t, err: null }))
      .catch((e: Error) => setViewer({ path, text: null, err: e.message || "error" }));
  }, [cfg]);

  // The viewer follows the URL, not the other way around: that's why a link
  // pasted in another tab opens the same file, and "back" closes it.
  useEffect(() => {
    if (!openPath) { setViewer(null); return; }
    loadFile(openPath);
  }, [openPath, loadFile]);

  // The viewer's title: whatever the agent put in the front matter if
  // there is one, and if not the plain-language name. The file's actual
  // name still shows below, with the path: it's the piece of data needed
  // to recognize what's being downloaded.
  const viewerName = viewer ? readableFileName(viewer.path) : "";

  // The file downloads exactly as it is in the workspace, byte for byte:
  // the bytes are requested again instead of reusing the already-loaded
  // text, because a binary that went through text comes back broken. Also
  // used for the ones that don't even get a preview.
  const [downloading, setDownloading] = useState(false);
  const [downloadingPath, setDownloadingPath] = useState<string | null>(null);
  const [downloadErr, setDownloadErr] = useState<string | null>(null);

  /** Downloads any file by its path, with no need to open it first. Used
   *  from the list and from the viewer: downloading shouldn't force you to
   *  go into anything, least of all the ones that can't even be shown. */
  const downloadPath = async (path: string) => {
    if (!cfg) return;
    setDownloadingPath(path);
    setDownloadErr(null);
    try {
      const bytes = await getFileBytes(cfg, path);
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = path.split("/").pop() || "archivo";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (e) {
      setDownloadErr(e instanceof Error ? e.message : String(e));
    } finally {
      setDownloadingPath(null);
    }
  };

  const downloadFile = async () => {
    if (!viewer) return;
    setDownloading(true);
    try {
      await downloadPath(viewer.path);
    } finally {
      setDownloading(false);
    }
  };

  /* ── Leaving something for the agent ───────────────────────────────────── */

  const uploadInput = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const [justUploaded, setJustUploaded] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);

  // The receipt notice lives in the folder where what you uploaded landed:
  // as soon as you go to another one, it's no longer saying anything about
  // what you're looking at.
  useEffect(() => { if (dir !== INBOX) setJustUploaded([]); }, [dir]);

  /** Refreshes the list WITHOUT clearing it: after uploading, blanking the
   *  whole screen to add one row loses sight of what you just left. */
  const reload = useCallback(() => {
    if (!cfg) return;
    getFiles(cfg)
      .then((r) => setFiles(Array.isArray(r.files) ? r.files : []))
      .catch(() => { /* the list that's there still works */ });
  }, [cfg]);

  /** Uploads whatever the client chose (or dropped). Everything goes to the
   *  `entrada/` inbox: the adapter decides that, not us, and that's why the
   *  folder opens when it's done — the file showing up somewhere the
   *  client isn't looking is the same as not having uploaded it. */
  const upload = async (list: FileList | File[] | null) => {
    const chosen = Array.from(list ?? []);
    if (!cfg || chosen.length === 0 || uploading) return;
    setUploading(true);
    setUploadErr(null);
    const paths: string[] = [];
    try {
      for (const f of chosen) {
        const r = await uploadFile(cfg, f);
        // The adapter returns "workspace/entrada/x.csv"; inside the portal
        // paths live without that prefix (it's the root of everything served).
        const path = stripPrefix(r.path) ?? `${INBOX}/${f.name}`;
        paths.push(path);
      }
      setJustUploaded(paths);
      reload();
      goTo(INBOX);
    } catch (e) {
      setUploadErr(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
      if (uploadInput.current) uploadInput.current.value = "";
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (canUpload) upload(e.dataTransfer?.files ?? null);
  };

  const { fm, fmBody } = useMemo(() => {
    if (!viewer || viewer.text === null) return { fm: null, fmBody: "" };
    const r = parseFrontMatter(viewer.path, viewer.text);
    return { fm: r.fm, fmBody: r.body };
  }, [viewer]);

  const body = () => {
    if (err && is404(err)) {
      return (
        <>
          <EmptyState
            icon={FolderOpen}
            title="Los archivos no están disponibles en este agente"
            hint="Cuando tu agente escriba algo, lo vas a poder abrir desde acá."
          />
          <div className="flex justify-center"><Btn kind="ghost" size="sm" onClick={load}>Reintentar</Btn></div>
        </>
      );
    }
    if (err) return <ErrorState message={err} onRetry={load} />;
    if (!files) return <Spinner />;
    if (files.length === 0) {
      return (
        <>
          <EmptyState
            icon={FolderOpen}
            title="Todavía no hay archivos"
            hint={canUpload
              ? "Acá van a aparecer los informes y documentos que escriba tu agente. Y si querés que trabaje con algo tuyo —una planilla, un listado, un PDF—, dejáselo acá."
              : "Cuando tu agente genere reportes o documentos, van a aparecer acá."}
          />
          {canUpload && (
            <div className="flex justify-center">
              <Btn onClick={() => uploadInput.current?.click()} disabled={uploading}>
                <Upload className="h-4 w-4" />
                {uploading ? "Subiendo…" : "Subir un archivo"}
              </Btn>
            </div>
          )}
        </>
      );
    }

    // What's internal stays out unless explicitly asked to be shown.
    const listed = showInternal ? files : files.filter((f) => !isInternal(clean(f.path)));
    // We only offer the toggle if there's something internal to show in here.
    const prefix = dir ? `${dir}/` : "";
    const hiddenCount = files.filter((f) => {
      const p = clean(f.path);
      return isInternal(p) && p.startsWith(prefix);
    }).length;

    const all = entriesFor(listed, dir);
    const needle = norm(q.trim());
    const folderList = needle ? all.folderList.filter((f) => norm(f.name).includes(needle)) : all.folderList;
    // Searched by both: the client types "hoja de ruta" (what she sees) and
    // the file is named `2026-08-13-hoja-de-ruta-…` (what's actually there).
    const inDir = needle
      ? all.inDir.filter((f) => {
        const fileName = f.path.split("/").pop() || f.path;
        return norm(fileName).includes(needle)
          || norm(readableFileName(f.path)).includes(needle);
      })
      : all.inDir;
    const hasEntries = all.folderList.length > 0 || all.inDir.length > 0;
    const crumbs = dir ? dir.split("/") : [];

    return (
      <>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <nav className="flex flex-wrap items-center gap-1 px-1 text-sm">
            <button
              onClick={() => goTo("")}
              className={dir ? "font-medium text-ink-soft transition hover:text-ink" : "font-semibold text-ink"}
            >
              Todo
            </button>
            {crumbs.map((seg, i) => {
              const isLast = i === crumbs.length - 1;
              return (
                <span key={i} className="flex items-center gap-1">
                  <span className="text-ink-soft/50">/</span>
                  <button
                    onClick={() => goTo(crumbs.slice(0, i + 1).join("/"))}
                    className={isLast ? "font-semibold text-ink" : "font-medium text-ink-soft transition hover:text-ink"}
                  >
                    {seg}
                  </button>
                </span>
              );
            })}
          </nav>
          {hasEntries && (
            <div className="relative w-full sm:w-56">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-soft/70" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Escape") setQ(""); }}
                placeholder="Buscar en esta carpeta"
                className={`${inputCls} py-1.5 pl-8 pr-7 text-[13px]`}
              />
              {q && (
                <button
                  aria-label="Limpiar búsqueda"
                  onClick={() => setQ("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-ink-soft hover:text-ink"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )}
        </div>

        <Card className="overflow-hidden !p-0">
          <ul className="divide-y divide-black/[0.06]">
            {folderList.map((f) => (
              <li key={`d-${f.name}`}>
                <button
                  onClick={() => goTo(dir ? `${dir}/${f.name}` : f.name)}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-black/[0.02]"
                >
                  {!dir && f.name === INBOX
                    ? <Inbox className="h-4 w-4 shrink-0 text-ink-soft" />
                    : <Folder className="h-4 w-4 shrink-0 text-ink-soft" />}
                  <span className="min-w-0 truncate text-sm font-medium text-ink">{f.name}</span>
                  {!dir && f.name === DELIVERABLES && <Chip tone="violet">para vos</Chip>}
                  {!dir && f.name === INBOX && <Chip tone="green">lo que le dejás</Chip>}
                  <span className="flex-1" />
                  <span className="shrink-0 text-[12px] tabular-nums text-ink-soft">
                    {f.count === 1 ? "1 archivo" : `${f.count} archivos`}
                  </span>
                </button>
              </li>
            ))}
            {inDir.map((f) => {
              const name = f.path.split("/").pop() || f.path;
              // THE FILE NAME IS NOT A NAME. The `deliverable` skill builds
              // it with the date up front, all as a slug, and on top of
              // that cuts it to 56 characters: the test client read
              // `prueba-del-control-semanal-de-contratos-13-de-agosto-de-.md`
              // and noted "cut in half and with those weird letters at the
              // end". Here the title shows; the file, with its real name,
              // is what gets downloaded (and stays visible in the viewer
              // and on hover).
              const title = readableFileName(f.path);
              const isText = TEXT_EXT.test(name);
              // Can be seen INSIDE the portal: plain text or a spreadsheet.
              const viewableInPortal = isText || isSpreadsheet(name) || isPhoto(name);
              const Icon = fileIcon(name);
              // WHEN IT WAS WRITTEN, ON THE AGENT'S CLOCK. This used to say
              // "3h ago" while Activity —which lists EXACTLY these files,
              // with this same `mtime`— says "Today · 00:57": on the same
              // file, two screens answering the same question differently.
              // And "3h ago" doesn't cross-check with anything: the client
              // who wants to know whether the report is this morning's had
              // to do the math herself, with HER clock, which is exactly
              // the one that doesn't call the shots here.
              // With the plain-language name, the kind stops living in the
              // title: "XLSX" is what tells the client that opens with Excel.
              const meta = [fileType(f.path), fmtSize(f.size), dateTime(f.mtime)]
                .filter(Boolean).join(" · ");
              const recentlyUploaded = justUploaded.includes(f.path);
              return (
                <li key={`f-${f.path}`} className={`group relative ${recentlyUploaded ? "bg-c-green/30" : ""}`}>
                  <div className="flex w-full items-center gap-3 px-4 py-2.5 transition hover:bg-black/[0.02]">
                    <Icon className="h-4 w-4 shrink-0 text-ink-soft" />
                    {/* The name opens whatever can be seen —spreadsheets
                        included— and downloads what can't. */}
                    <button
                      onClick={() => (viewableInPortal ? openFile(f.path) : downloadPath(f.path))}
                      className="min-w-0 flex-1 truncate text-left text-sm text-ink hover:underline"
                      title={name}
                    >
                      {title}
                    </button>
                    <span className="shrink-0 text-[12px] tabular-nums text-ink-soft group-hover:opacity-0 group-focus-within:opacity-0">
                      {meta}
                      {!viewableInPortal && (meta ? " · sin vista previa" : "sin vista previa")}
                    </span>
                  </div>
                  {/* Actions go ABSOLUTE on purpose: if they took up space
                      in the flow, the row would grow on hover and the list
                      would jump. This way they appear over the size, without
                      moving anything. */}
                  <span className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 items-center gap-1 group-hover:flex group-focus-within:flex">
                    <span className="pointer-events-auto flex items-center gap-1">
                      {viewableInPortal && (
                        <button
                          onClick={() => openFile(f.path)}
                          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-semibold text-ink-soft transition hover:bg-black/[0.06] hover:text-ink"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          Ver
                        </button>
                      )}
                      <button
                        disabled={downloadingPath === f.path}
                        onClick={() => downloadPath(f.path)}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-semibold text-ink-soft transition hover:bg-black/[0.06] hover:text-ink disabled:opacity-50"
                      >
                        <Download className="h-3.5 w-3.5" />
                        {downloadingPath === f.path ? "Bajando…" : "Descargar"}
                      </button>
                    </span>
                  </span>
                </li>
              );
            })}
            {folderList.length === 0 && inDir.length === 0 && (
              <li className="px-4 py-6 text-center text-sm text-ink-soft">
                {q ? "Ningún archivo coincide."
                  : dir === INBOX && canUpload
                    ? "Todavía no le dejaste nada. Subí una planilla, un listado o un PDF y tu agente lo va a tener acá."
                    : "Esta carpeta está vacía."}
              </li>
            )}
          </ul>
        </Card>

        {/* A download that fails can't be silent: the user clicks, nothing
            happens, and there's no way to know why. */}
        {downloadErr && (
          <p className="mt-3 inline-flex rounded-lg border border-c-coral bg-c-coral/40 px-3 py-1.5 text-[12px] font-medium text-c-coral-ink">
            No pude descargar el archivo ({downloadErr}).
          </p>
        )}

        {hiddenCount > 0 && (
          <div className="mt-2 flex justify-center">
            <button
              onClick={toggleInternal}
              className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12px] text-ink-soft transition hover:bg-black/[0.04] hover:text-ink"
            >
              {showInternal && <Check className="h-3 w-3" />}
              {showInternal
                ? "Ocultar las cosas técnicas"
                : `Ver las cosas técnicas de tu agente (${hiddenCount})`}
            </button>
          </div>
        )}
      </>
    );
  };

  const viewerMeta = viewer
    ? files?.find((f) => clean(f.path) === viewer.path)
    : undefined;
  // The same time as the list's row and as Activity: a single truth.
  const viewerWhen = dateTime(viewerMeta?.mtime);
  const hasMeta = !!fm && (!!fm.kind || !!fm.date || fm.tags.length > 0);

  return (
    <div
      className="relative mx-auto max-w-4xl px-6 py-6 md:px-8"
      onDragOver={(e) => {
        if (!canUpload) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        // Only when the pointer TRULY leaves: entering a child fires the
        // parent's dragleave and the banner used to flicker with the mouse still.
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setDragging(false);
      }}
      onDrop={handleDrop}
    >
      <PageHeader
        title="Archivos"
        subtitle={canUpload
          ? "Lo que tu agente fue escribiendo, y lo que vos le dejás"
          : "Todos los archivos que tu agente fue escribiendo"}
        actions={
          <>
            {(dir || openPath) && <CopyLink label="Copiar el link de esta carpeta" />}
            {canUpload && files !== null && files.length > 0 && (
              <Btn onClick={() => uploadInput.current?.click()} disabled={uploading}>
                <Upload className="h-4 w-4" />
                {uploading ? "Subiendo…" : "Subir un archivo"}
              </Btn>
            )}
          </>
        }
      />
      {/* Just one, hidden, for the button and for the empty state.
          `multiple` because nobody sends "the spreadsheet" without also
          sending the list right next to it. */}
      {canUpload && (
        <input
          ref={uploadInput}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => upload(e.target.files)}
        />
      )}
      {/* The link points to a file that's no longer there: it's said, and the list stays. */}
      {openPath && files !== null
        && !files.some((f) => clean(f.path) === openPath) && (
        <StaleLinkNotice>
          No encontré ese archivo — puede que tu agente lo haya renombrado o movido.
          Abajo está todo lo que tenés hoy.
        </StaleLinkNotice>
      )}
      {uploadErr && (
        <p className="mb-4 rounded-lg border border-c-coral bg-c-coral/40 px-3 py-2 text-[12px] font-medium text-c-coral-ink">
          No pude subir el archivo ({uploadErr}).
        </p>
      )}
      {/* UPLOADING IT IS NOT ASKING IT FOR ANYTHING. The file stays in its
          inbox and the agent will find it there, but nobody told it: promising
          "it's already reading it" would be the kind of promise that later
          doesn't hold. It says what happened and where things stand. */}
      {justUploaded.length > 0 && (
        <div className="mb-4 rounded-lg border border-c-green bg-c-green/30 px-3 py-2 text-[13px] leading-snug text-c-green-ink">
          {justUploaded.length === 1
            ? "Listo, se lo dejaste a tu agente en Entrada."
            : `Listo, le dejaste ${justUploaded.length} archivos en Entrada.`}{" "}
          Para que trabaje con {justUploaded.length === 1 ? "esto" : "esos"},{" "}
          <Link href="/app/chat" className="font-semibold underline underline-offset-2">
            pedíselo por el chat
          </Link>.
        </div>
      )}
      {body()}
      {/* Dropping anywhere on the screen, not on a tiny rectangle: the
          client drags the file toward "Archivos", not toward a target. */}
      {dragging && canUpload && (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-ink/10">
          <div className="flex items-center gap-2 rounded-xl border border-primary bg-white px-4 py-3 text-sm font-semibold text-primary">
            <Upload className="h-4 w-4" />
            Soltalo acá y se lo dejo a tu agente
          </div>
        </div>
      )}
      {viewer && !(viewer.err && /^404/.test(viewer.err)) && (
        <Modal wide onClose={closeViewer}>
          <div className="flex items-start justify-between gap-3 border-b border-black/[0.07] px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-ink">{fm?.title || viewerName}</p>
              <p className="truncate text-[11px] text-ink-soft">
                {viewer.path}
                {viewerMeta?.size != null ? ` · ${fmtSize(viewerMeta.size)}` : ""}
                {viewerWhen ? ` · ${viewerWhen}` : ""}
              </p>
              {hasMeta && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {fm?.kind && (
                    <Chip tone="violet">{KIND_LABEL[fm.kind.toLowerCase()] ?? fm.kind}</Chip>
                  )}
                  {fm?.tags.map((t) => <Chip key={t}>{t}</Chip>)}
                  {fm?.date && <span className="text-[11px] text-ink-soft">{fmtDate(fm.date)}</span>}
                </div>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              <CopyLink label="Copiar el link de este archivo" />
              <IconBtn label="Descargar" disabled={downloading} onClick={downloadFile}>
                <Download className="h-4 w-4" />
              </IconBtn>
              {viewer.text !== null && viewer.text.trim() !== "" && (
                <IconBtn
                  label={raw ? "Ver formateado" : "Ver original"}
                  onClick={() => setRaw((v) => !v)}
                >
                  {raw ? <FileText className="h-4 w-4" /> : <Code2 className="h-4 w-4" />}
                </IconBtn>
              )}
              <IconBtn label="Cerrar" onClick={closeViewer}>
                <X className="h-4 w-4" />
              </IconBtn>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            {viewer.binary && isPhoto(viewer.path) ? (
              <AgentImage cfg={cfg!} path={viewer.path} />
            ) : viewer.binary && isSpreadsheet(viewer.path) ? (
              viewer.err ? (
                <ErrorState message={viewer.err} onRetry={() => loadFile(viewer.path)} />
              ) : viewer.sheet ? (
                <Spreadsheet bytes={viewer.sheet} />
              ) : (
                <Spinner />
              )
            ) : viewer.binary ? (
              <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
                <File className="h-8 w-8 text-ink-soft" />
                <p className="text-sm font-medium text-ink">Este archivo se abre con otro programa</p>
                <p className="max-w-sm text-[13px] text-ink-soft">
                  No se puede mostrar acá, pero lo podés descargar y abrirlo como siempre.
                </p>
                <Btn onClick={downloadFile} disabled={downloading}>
                  <Download className="h-4 w-4" />
                  {downloading ? "Bajando…" : "Descargar"}
                </Btn>
              </div>
            ) : null}
            {!viewer.binary && viewer.text === null && viewer.err === null && <Spinner />}
            {viewer.err && (
              <ErrorState
                message={`No pude abrir el archivo (${viewer.err}).`}
                onRetry={() => loadFile(viewer.path)}
              />
            )}
            {viewer.text !== null && (
              viewer.text.trim() === "" ? (
                <p className="text-sm text-ink-soft">El archivo está vacío.</p>
              ) : raw ? (
                // "Original" is the whole file, front matter included.
                <pre className="whitespace-pre-wrap break-words font-mono text-[12.5px] leading-relaxed text-ink">
                  {viewer.text}
                </pre>
              ) : viewer.path.toLowerCase().endsWith(".csv") ? (
                // CSVs are what the client exports from their system:
                // reading them as raw text is reading commas. They're
                // drawn as a table, and the "Original" button still shows
                // the file as-is.
                <CsvPreview text={viewer.text} />
              ) : (
                <FileBody path={viewer.path} text={fm ? fmBody : viewer.text} />
              )
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
