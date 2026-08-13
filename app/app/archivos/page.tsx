"use client";

// Archivos: workspace del agente, solo lectura (sin subir, sin borrar).
// Contrato (adapter v0.3):
//   GET {adapter}/portal/files        → { files: [{ path, size, mtime }] }
//   GET {adapter}/portal/files/{path} → text/plain
// Lista navegable por carpetas (derivadas de los paths) + viewer en Modal.
//
// Convenciones del lado del agente que este módulo respeta:
//   entregables/ → lo que el agente produce PARA el cliente (front-matter YAML
//                  puesto por la skill `entregable`). Va primero en la raíz.
//   interno/     → scripts, pruebas, andamiaje. Oculto salvo que se pida verlo.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check, Code2, Download, Eye, File, FileCode, FileJson, FileText, Folder, FolderOpen,
  Search, X, type LucideIcon,
} from "lucide-react";
import { loadConfig, getFiles, getFileText, getFileBytes, type PortalConfig } from "../lib/agent";
import { CopiarLink, PARAM, abrirEnRuta, cerrarEnRuta, useParamRuta } from "../lib/rutas";
import {
  AvisoLinkViejo, Btn, Card, Chip, EmptyState, ErrorState, IconBtn, Modal, PageHeader,
  Spinner, inputCls,
} from "../lib/ui";
import { FileBody, ImagenDelAgente } from "../lib/EntityViewer";
import Spreadsheet, { CsvPreview } from "../lib/Spreadsheet";

type FileEntry = { path: string; size?: number; mtime?: string | number };

// `binario`: no es texto, no se previsualiza — solo se descarga.
type Viewer = {
  path: string; text: string | null; err: string | null;
  binario?: boolean;
  /** Bytes de una planilla, para dibujarla. Solo se piden para .xlsx/.xls. */
  hoja?: ArrayBuffer | null;
};

// Front-matter que escribe la skill `entregable` (titulo/tipo/fecha/tags).
type FrontMatter = { titulo?: string; tipo?: string; fecha?: string; tags: string[] };

// Extensiones que abrimos en el viewer de texto.
const TEXT_EXT =
  /\.(md|markdown|txt|text|json|jsonl|csv|tsv|log|ya?ml|toml|ini|cfg|conf|py|rb|sh|sql|xml|html?|css|js|jsx|ts|tsx|mjs|env|rst|out)$/i;

const INTERNAL = "interno";     // andamiaje del agente: no es para el cliente
const DELIVERABLES = "entregables"; // lo que el agente entrega al cliente

const is404 = (msg: string) => /^404\b/.test(msg);

const clean = (p: string) => (p || "").replace(/^\/+/, "");

// Andamiaje: los scripts que el agente se escribe para trabajar. Viven
// SUELTOS en la raíz del workspace, no en `interno/`, así que la regla vieja
// (solo esa carpeta) los dejaba a la vista: un cliente de prueba abrió
// Archivos y lo primero que vio fueron dieciséis `create_batch_tickets.py`,
// justo debajo de una explicación que le prometía que "el andamiaje queda
// aparte". Se siguen pudiendo ver con el interruptor de abajo.
const SCRIPT_EXT = /\.(py|sh|bash|zsh|rb|pl|js|mjs|cjs|ts|tsx|jsx|ipynb)$/i;

const isInternal = (path: string) =>
  path === INTERNAL ||
  path.startsWith(`${INTERNAL}/`) ||
  SCRIPT_EXT.test(path.split("/").pop() || "");

// Comparación insensible a tildes y mayúsculas (búsqueda y títulos duplicados).
const norm = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

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

// ── Front-matter ───────────────────────────────────────────────────────────
// Parser mínimo: solo las claves que escribe la skill. Cualquier cosa rara
// (bloque sin cerrar, YAML anidado, claves desconocidas) cae en "no hay
// front-matter" y el archivo se muestra crudo. Nunca rompe el visor.

const TIPO_LABEL: Record<string, string> = {
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
      const item = /^\s*-\s+(.+)$/.exec(line); // ítem de lista YAML del key anterior
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
      else if (key === "titulo") fm.titulo = val;
      else if (key === "tipo") fm.tipo = val;
      else if (key === "fecha") fm.fecha = val;
    }
    if (!fm.titulo && !fm.tipo && !fm.fecha && fm.tags.length === 0) return plain;
    let body = text.slice(m[0].length).replace(/^\s*\n/, "");
    // La skill repite el título como H1; con el título en el encabezado del
    // modal, mostrarlo de nuevo es ruido.
    const h1 = /^#[ \t]+(.+?)[ \t]*(?:\r?\n|$)/.exec(body);
    if (h1 && fm.titulo && norm(h1[1]) === norm(fm.titulo)) {
      body = body.slice(h1[0].length).replace(/^\s*\n/, "");
    }
    return { fm, body };
  } catch {
    return plain; // ante la duda, el archivo tal cual
  }
}

function fmtFecha(value: string): string {
  const d = new Date(value.trim().replace(" ", "T"));
  return Number.isNaN(d.getTime())
    ? value
    : d.toLocaleString("es-UY", {
      day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false,
    });
}

// ── Listado ────────────────────────────────────────────────────────────────

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
      // En la raíz, lo que es para el cliente va arriba de todo.
      if (!dir) {
        const rank = (n: string) => (n === DELIVERABLES ? 0 : 1);
        if (rank(a.name) !== rank(b.name)) return rank(a.name) - rank(b.name);
      }
      return a.name.localeCompare(b.name, "es");
    });
  inDir.sort((a, b) => toMs(b.mtime) - toMs(a.mtime) || a.path.localeCompare(b.path, "es"));
  return { folderList, inDir };
}

/** La carpeta en la que vive un archivo ("entregables/informe.md" →
 *  "entregables"). Sirve para que un link a un archivo suelto abra igual la
 *  carpeta correcta atrás del visor. */
const quitarPrefijo = (p: string | null) =>
  p ? p.replace(/^\/?(?:opt\/data\/)?workspace\//, "").replace(/^\.\//, "") : null;

const carpetaDe = (path: string) => {
  const i = clean(path).lastIndexOf("/");
  return i === -1 ? "" : clean(path).slice(0, i);
};

export default function ArchivosPage() {
  const [cfg, setCfg] = useState<PortalConfig | null>(null);
  const [files, setFiles] = useState<FileEntry[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Dónde está parado el cliente lo dice la URL: `?carpeta=entregables` y
  // `?archivo=entregables/informe.md`. Así el agente puede mandar el link de un
  // entregable concreto, y refrescar no lo devuelve a la raíz.
  const carpetaURL = useParamRuta(PARAM.carpeta);
  // El agente escribe sus rutas con el prefijo del workspace
  // (`workspace/entregables/informe.md`) y así las va a citar en un link. El
  // portal ya sabe sacarlo al detectar entidades; acá también, o el link más
  // natural que puede armar el agente termina en "no encontré ese archivo".
  const abiertoPath = quitarPrefijo(useParamRuta(PARAM.archivo));
  const dir = carpetaURL ?? (abiertoPath ? carpetaDe(abiertoPath) : "");
  const [q, setQ] = useState("");
  const [showInternal, setShowInternal] = useState(false);
  const [viewer, setViewer] = useState<Viewer | null>(null);
  // El visor formatea por defecto; "original" muestra el texto crudo (para copiar).
  const [raw, setRaw] = useState(false);

  useEffect(() => { setCfg(loadConfig()); }, []);

  // UN LINK A LO INTERNO PRENDE EL INTERRUPTOR DE LO INTERNO. Sin esto,
  // `?carpeta=interno` abría una carpeta con ocho archivos adentro y decía
  // "Esta carpeta está vacía": el filtro de andamiaje se comía todo lo que el
  // link venía a mostrar, y el cliente veía al portal contradecirse solo. Vale
  // igual para `?archivo=` de un script suelto, que también es "interno".
  useEffect(() => {
    if (isInternal(dir) || (abiertoPath && isInternal(abiertoPath))) setShowInternal(true);
  }, [dir, abiertoPath]);

  const load = useCallback(() => {
    if (!cfg) return;
    setFiles(null);
    setErr(null);
    getFiles(cfg)
      .then((r) => setFiles(Array.isArray(r.files) ? r.files : []))
      .catch((e: Error) => setErr(e.message || "error"));
  }, [cfg]);

  useEffect(() => { load(); }, [load]);

  // Entrar a una carpeta es navegar: cada una tiene su link y "atrás" sube.
  const goTo = (next: string) => {
    setQ("");
    abrirEnRuta({ [PARAM.carpeta]: next || null, [PARAM.archivo]: null });
  };

  const toggleInternal = () => {
    const next = !showInternal;
    // Si estábamos dentro de interno/, esa carpeta deja de existir: volvemos a la raíz.
    if (!next && isInternal(dir)) goTo("");
    setShowInternal(next);
  };

  // Lo que no es texto no se previsualiza: se descarga. Intentar dibujarlo
  // muestra basura y, peor, la descarga salia del texto ya corrompido.
  const NO_TEXTO = new Set([
    "xlsx", "xls", "ods", "docx", "doc", "odt", "pptx", "ppt", "pdf",
    "png", "jpg", "jpeg", "gif", "webp", "svgz", "ico", "bmp",
    "zip", "gz", "tar", "7z", "rar", "mp3", "mp4", "mov", "wav", "ogg",
  ]);
  const esBinario = (p: string) => NO_TEXTO.has((p.split(".").pop() ?? "").toLowerCase());

  const esPlanilla = (p: string) => ["xlsx", "xls"].includes((p.split(".").pop() ?? "").toLowerCase());

  // Una imagen SE MIRA. Decirle "sin vista previa" al cartel que el agente
  // acaba de hacer para WhatsApp —y obligarla a bajarlo para saber si está
  // bien— fue una de las cosas que el QA anotó: "es una imagen, ¿por qué no me
  // la puede mostrar?".
  const esFoto = (p: string) =>
    /\.(jpe?g|png|gif|webp|bmp|svg|ico|heic|avif)$/i.test(p);

  /** Abrir un archivo es navegar: se lleva también la carpeta en la que estás,
   *  para que el link compartido muestre el mismo fondo que vos. */
  const openFile = (path: string) =>
    abrirEnRuta({ [PARAM.archivo]: path, [PARAM.carpeta]: dir || null });
  const cerrarVisor = useCallback(() => cerrarEnRuta(PARAM.archivo), []);

  const cargarArchivo = useCallback((path: string) => {
    if (!cfg) return;
    setRaw(false);
    // Las planillas SÍ se muestran: el agente entrega pedidos y controles en
    // xlsx, y bajarlos para ver tres números no es una vista previa.
    if (esPlanilla(path)) {
      setViewer({ path, text: null, err: null, binario: true, hoja: null });
      getFileBytes(cfg, path)
        .then((b) => setViewer({ path, text: null, err: null, binario: true, hoja: b }))
        .catch((e: Error) => setViewer({ path, text: null, err: e.message || "error", binario: true }));
      return;
    }
    if (esFoto(path) || esBinario(path)) {
      setViewer({ path, text: null, err: null, binario: true });
      return;
    }
    setViewer({ path, text: null, err: null });
    getFileText(cfg, path)
      .then((t) => setViewer({ path, text: t, err: null }))
      .catch((e: Error) => setViewer({ path, text: null, err: e.message || "error" }));
  }, [cfg]);

  // El visor sigue a la URL, no al revés: por eso un link pegado en otra
  // pestaña abre el mismo archivo, y "atrás" lo cierra.
  useEffect(() => {
    if (!abiertoPath) { setViewer(null); return; }
    cargarArchivo(abiertoPath);
  }, [abiertoPath, cargarArchivo]);

  const viewerName = viewer ? viewer.path.split("/").pop() || viewer.path : "";

  // El archivo baja tal cual está en el workspace, byte por byte: se piden los
  // bytes de nuevo en vez de reusar el texto ya cargado, porque un binario que
  // pasó por texto vuelve roto. También sirve para lo que ni se previsualiza.
  const [bajando, setBajando] = useState(false);
  const [bajandoPath, setBajandoPath] = useState<string | null>(null);
  const [errBajada, setErrBajada] = useState<string | null>(null);

  /** Baja cualquier archivo por su ruta, sin necesidad de abrirlo antes.
   *  Se usa desde la lista y desde el visor: descargar no deberia obligar a
   *  entrar a ningun lado, y menos con los que ni siquiera se pueden mostrar. */
  const descargarRuta = async (path: string) => {
    if (!cfg) return;
    setBajandoPath(path);
    setErrBajada(null);
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
      setErrBajada(e instanceof Error ? e.message : String(e));
    } finally {
      setBajandoPath(null);
    }
  };

  const downloadFile = async () => {
    if (!viewer) return;
    setBajando(true);
    try {
      await descargarRuta(viewer.path);
    } finally {
      setBajando(false);
    }
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
        <EmptyState
          icon={FolderOpen}
          title="Todavía no hay archivos"
          hint="Cuando tu agente genere reportes o documentos, van a aparecer acá."
        />
      );
    }

    // Lo interno queda afuera salvo que se pida verlo explícitamente.
    const listed = showInternal ? files : files.filter((f) => !isInternal(clean(f.path)));
    // Solo ofrecemos el toggle si acá adentro hay algo interno que mostrar.
    const prefix = dir ? `${dir}/` : "";
    const hiddenCount = files.filter((f) => {
      const p = clean(f.path);
      return isInternal(p) && p.startsWith(prefix);
    }).length;

    const all = entriesFor(listed, dir);
    const needle = norm(q.trim());
    const folderList = needle ? all.folderList.filter((f) => norm(f.name).includes(needle)) : all.folderList;
    const inDir = needle
      ? all.inDir.filter((f) => norm(f.path.split("/").pop() || f.path).includes(needle))
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
                  <Folder className="h-4 w-4 shrink-0 text-ink-soft" />
                  <span className="min-w-0 truncate text-sm font-medium text-ink">{f.name}</span>
                  {!dir && f.name === DELIVERABLES && <Chip tone="violet">para vos</Chip>}
                  <span className="flex-1" />
                  <span className="shrink-0 text-[12px] tabular-nums text-ink-soft">
                    {f.count === 1 ? "1 archivo" : `${f.count} archivos`}
                  </span>
                </button>
              </li>
            ))}
            {inDir.map((f) => {
              const name = f.path.split("/").pop() || f.path;
              const texty = TEXT_EXT.test(name);
              // Se puede ver ADENTRO del portal: texto plano o planilla.
              const verEnPortal = texty || esPlanilla(name) || esFoto(name);
              const Icon = fileIcon(name);
              const meta = [fmtSize(f.size), relTime(toMs(f.mtime))].filter(Boolean).join(" · ");
              return (
                <li key={`f-${f.path}`} className="group relative">
                  <div className="flex w-full items-center gap-3 px-4 py-2.5 transition hover:bg-black/[0.02]">
                    <Icon className="h-4 w-4 shrink-0 text-ink-soft" />
                    {/* El nombre abre lo que se puede ver —incluidas las
                        planillas— y baja lo que no. */}
                    <button
                      onClick={() => (verEnPortal ? openFile(f.path) : descargarRuta(f.path))}
                      className="min-w-0 flex-1 truncate text-left text-sm text-ink hover:underline"
                      title={verEnPortal ? "Ver" : "Descargar"}
                    >
                      {name}
                    </button>
                    <span className="shrink-0 text-[12px] tabular-nums text-ink-soft group-hover:opacity-0 group-focus-within:opacity-0">
                      {meta}
                      {!verEnPortal && (meta ? " · sin vista previa" : "sin vista previa")}
                    </span>
                  </div>
                  {/* Las acciones van ABSOLUTAS a propósito: si ocupan lugar en
                      el flujo, la fila crece al pasar el mouse y la lista salta.
                      Así aparecen encima del tamaño, sin mover nada. */}
                  <span className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 items-center gap-1 group-hover:flex group-focus-within:flex">
                    <span className="pointer-events-auto flex items-center gap-1">
                      {verEnPortal && (
                        <button
                          onClick={() => openFile(f.path)}
                          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-semibold text-ink-soft transition hover:bg-black/[0.06] hover:text-ink"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          Ver
                        </button>
                      )}
                      <button
                        disabled={bajandoPath === f.path}
                        onClick={() => descargarRuta(f.path)}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-semibold text-ink-soft transition hover:bg-black/[0.06] hover:text-ink disabled:opacity-50"
                      >
                        <Download className="h-3.5 w-3.5" />
                        {bajandoPath === f.path ? "Bajando…" : "Descargar"}
                      </button>
                    </span>
                  </span>
                </li>
              );
            })}
            {folderList.length === 0 && inDir.length === 0 && (
              <li className="px-4 py-6 text-center text-sm text-ink-soft">
                {q ? "Ningún archivo coincide." : "Esta carpeta está vacía."}
              </li>
            )}
          </ul>
        </Card>

        {/* Una descarga que falla no puede ser silenciosa: el usuario aprieta,
            no pasa nada, y no tiene forma de saber por que. */}
        {errBajada && (
          <p className="mt-3 inline-flex rounded-lg border border-c-coral bg-c-coral/40 px-3 py-1.5 text-[12px] font-medium text-c-coral-ink">
            No pude descargar el archivo ({errBajada}).
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
  const hasMeta = !!fm && (!!fm.tipo || !!fm.fecha || fm.tags.length > 0);

  return (
    <div className="mx-auto max-w-4xl px-6 py-6 md:px-8">
      <PageHeader
        title="Archivos"
        subtitle="Todos los archivos que tu agente fue escribiendo"
        actions={(dir || abiertoPath) ? <CopiarLink titulo="Copiar el link de esta carpeta" /> : undefined}
      />
      {/* El link apunta a un archivo que ya no está: se dice y queda la lista. */}
      {abiertoPath && files !== null
        && !files.some((f) => clean(f.path) === abiertoPath) && (
        <AvisoLinkViejo>
          No encontré ese archivo — puede que tu agente lo haya renombrado o movido.
          Abajo está todo lo que tenés hoy.
        </AvisoLinkViejo>
      )}
      {body()}
      {viewer && !(viewer.err && /^404/.test(viewer.err)) && (
        <Modal wide onClose={cerrarVisor}>
          <div className="flex items-start justify-between gap-3 border-b border-black/[0.07] px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-ink">{fm?.titulo || viewerName}</p>
              <p className="truncate text-[11px] text-ink-soft">
                {viewer.path}
                {viewerMeta?.size != null ? ` · ${fmtSize(viewerMeta.size)}` : ""}
                {toMs(viewerMeta?.mtime) ? ` · ${relTime(toMs(viewerMeta?.mtime))}` : ""}
              </p>
              {hasMeta && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {fm?.tipo && (
                    <Chip tone="violet">{TIPO_LABEL[fm.tipo.toLowerCase()] ?? fm.tipo}</Chip>
                  )}
                  {fm?.tags.map((t) => <Chip key={t}>{t}</Chip>)}
                  {fm?.fecha && <span className="text-[11px] text-ink-soft">{fmtFecha(fm.fecha)}</span>}
                </div>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              <CopiarLink titulo="Copiar el link de este archivo" />
              <IconBtn label="Descargar" disabled={bajando} onClick={downloadFile}>
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
              <IconBtn label="Cerrar" onClick={cerrarVisor}>
                <X className="h-4 w-4" />
              </IconBtn>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            {viewer.binario && esFoto(viewer.path) ? (
              <ImagenDelAgente cfg={cfg!} path={viewer.path} />
            ) : viewer.binario && esPlanilla(viewer.path) ? (
              viewer.err ? (
                <ErrorState message={viewer.err} onRetry={() => cargarArchivo(viewer.path)} />
              ) : viewer.hoja ? (
                <Spreadsheet bytes={viewer.hoja} />
              ) : (
                <Spinner />
              )
            ) : viewer.binario ? (
              <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
                <File className="h-8 w-8 text-ink-soft" />
                <p className="text-sm font-medium text-ink">Este archivo se abre con otro programa</p>
                <p className="max-w-sm text-[13px] text-ink-soft">
                  No se puede mostrar acá, pero lo podés descargar y abrirlo como siempre.
                </p>
                <Btn onClick={downloadFile} disabled={bajando}>
                  <Download className="h-4 w-4" />
                  {bajando ? "Bajando…" : "Descargar"}
                </Btn>
              </div>
            ) : null}
            {!viewer.binario && viewer.text === null && viewer.err === null && <Spinner />}
            {viewer.err && (
              <ErrorState
                message={`No pude abrir el archivo (${viewer.err}).`}
                onRetry={() => cargarArchivo(viewer.path)}
              />
            )}
            {viewer.text !== null && (
              viewer.text.trim() === "" ? (
                <p className="text-sm text-ink-soft">El archivo está vacío.</p>
              ) : raw ? (
                // "Original" es el archivo completo, front-matter incluido.
                <pre className="whitespace-pre-wrap break-words font-mono text-[12.5px] leading-relaxed text-ink">
                  {viewer.text}
                </pre>
              ) : viewer.path.toLowerCase().endsWith(".csv") ? (
                // Los CSV son lo que el cliente exporta de su sistema: leerlos
                // como texto crudo es leer comas. Se dibujan como tabla, y el
                // botón "Original" sigue mostrando el archivo tal cual.
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
