"use client";

// Archivos: los papeles del agente y los del cliente, en el mismo lugar.
// Contrato (adapter v0.3, subida ≥0.14):
//   GET  {adapter}/portal/files        → { files: [{ path, size, mtime }] }
//   GET  {adapter}/portal/files/{path} → text/plain
//   POST {adapter}/portal/upload       → { ok, path: "workspace/entrada/…", bytes }
// Lista navegable por carpetas (derivadas de los paths) + viewer en Modal.
//
// Convenciones del lado del agente que este módulo respeta:
//   entregables/ → lo que el agente produce PARA el cliente (front-matter YAML
//                  puesto por la skill `entregable`). Va primero en la raíz.
//   entrada/     → el buzón: ahí caen los archivos que sube el cliente.
//   interno/     → scripts, pruebas, andamiaje. Oculto salvo que se pida verlo.
//
// ESTA PANTALLA ERA DE SOLO LECTURA, y esa decisión no sobrevivió al primer
// cliente. Una dueña de inmobiliaria, sin ninguna pista de qué es esto, lo
// escribió así: "falta una pantalla que no existe: dónde meto YO mis papeles.
// Si quiero darle mi planilla tengo que encontrar el clipcito del chat. Eso
// debería ser lo primero que me pida". La subida ya existía —el adapter la
// expone y el chat la usa— y estaba escondida en un ícono adentro de una
// conversación. Ahora está donde la fue a buscar.
//
// PERO SÓLO SI EL AGENTE LA DECLARA. El portal sirve a cualquier agente Hermes:
// si su manifiesto no trae `modules.upload`, acá no hay subida y la pantalla
// vuelve a ser de lectura. Ofrecer un botón que el otro lado no tiene es la
// forma más rápida de que el cliente crea que se rompió algo suyo.

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
  fechaHora, husoDe, husoDelNegocio, isoConHuso, momento, momentoDe, type Momento,
} from "../lib/palabras";
import { CopiarLink, PARAM, abrirEnRuta, cerrarEnRuta, useParamRuta } from "../lib/rutas";
import {
  AvisoLinkViejo, Btn, Card, Chip, EmptyState, ErrorState, IconBtn, Modal, PageHeader,
  Spinner, inputCls,
} from "../lib/ui";
import { FileBody, ImagenDelAgente } from "../lib/EntityViewer";
import { nombreLegibleDeArchivo, tipoDeArchivo } from "../lib/nombres";
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
const INBOX = "entrada";        // el buzón: lo que el cliente le deja al agente

const is404 = (msg: string) => /^404\b/.test(msg);

const clean = (p: string) => (p || "").replace(/^\/+/, "");

// Andamiaje: los scripts que el agente se escribe para trabajar. Viven
// SUELTOS en la raíz del workspace, no en `interno/`, así que la regla vieja
// (solo esa carpeta) los dejaba a la vista: un cliente de prueba abrió
// Archivos y lo primero que vio fueron dieciséis `create_batch_tickets.py`,
// justo debajo de una explicación que le prometía que "el andamiaje queda
// aparte". Se siguen pudiendo ver con el interruptor de abajo.
const SCRIPT_EXT = /\.(py|sh|bash|zsh|rb|pl|js|mjs|cjs|ts|tsx|jsx|ipynb)$/i;

// LO QUE SUBE EL CLIENTE NUNCA ES ANDAMIAJE. La regla del script mira la
// extensión venga de donde venga, así que un `.py` o un `.js` subido por el
// cliente al buzón desaparecía de la lista — con el "listo, se lo dejaste a tu
// agente" todavía arriba y la carpeta diciendo "todavía no le dejaste nada".
const isInternal = (path: string) =>
  path === INTERNAL ||
  path.startsWith(`${INTERNAL}/`) ||
  (!path.startsWith(`${INBOX}/`) && SCRIPT_EXT.test(path.split("/").pop() || ""));

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

// El `mtime` llega como epoch en segundos y sin huso. Quien lo lee es
// `momentoDe`, la puerta única del portal: devuelve el instante (para ordenar)
// ya leído en el reloj del negocio (para mostrar).
const msDe = (mtime?: string | number): number => momentoDe(mtime)?.ms ?? 0;

function fmtSize(n?: number): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
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

/** Una fecha SIN huso leída como hora de pared del negocio: los dígitos que
 *  escribió el agente son los suyos, y son los que se muestran mire quien mire.
 *  (Se leen como si fueran UTC y se corren al huso del negocio: es la única
 *  forma de pintar un huso ajeno con lo que exporta `palabras.ts`.) */
function paredDelNegocio(iso: string): Momento | null {
  const ms = Date.parse(`${iso}Z`);
  if (Number.isNaN(ms)) return null;
  const off = husoDelNegocio();
  return momento(isoConHuso(ms - off * 60_000, off));
}

/** La `fecha` del front-matter, en el reloj del negocio.
 *
 *  La escribe la skill `entregable` y hoy viene sin huso ("fecha: 2026-08-13
 *  07:03"): esas son las 07:03 DE ALLÁ. Con `new Date()` a secas los dígitos
 *  volvían intactos de pura casualidad —el mismo reloj del browser parseaba y
 *  formateaba— y esa casualidad se rompe sola de dos maneras: el día que la
 *  skill le agregue el huso ("…-03:00"), y ya hoy con una fecha sin hora, que
 *  `new Date()` lee a medianoche UTC y en cualquier huso al oeste retrocede al
 *  día anterior. */
function fmtFecha(value: string): string {
  const v = value.trim();
  const soloDia = /^\d{4}-\d{2}-\d{2}$/.test(v);
  const m = husoDe(v) !== null
    ? momentoDe(v)                              // ya trae su huso: se respeta
    : paredDelNegocio(soloDia ? `${v}T12:00:00` : v.replace(" ", "T"));
  if (!m) return value; // lo que no se entiende se muestra tal cual
  // Sin hora escrita no se inventa una: "13 ago" y listo.
  return soloDia ? m.fecha : `${m.fecha} ${m.hora}`;
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
      // En la raíz, lo que es para el cliente va arriba de todo: primero lo que
      // el agente le entregó, después el buzón donde él le deja lo suyo.
      if (!dir) {
        const rank = (n: string) => (n === DELIVERABLES ? 0 : n === INBOX ? 1 : 2);
        if (rank(a.name) !== rank(b.name)) return rank(a.name) - rank(b.name);
      }
      return a.name.localeCompare(b.name, "es");
    });
  inDir.sort((a, b) => msDe(b.mtime) - msDe(a.mtime) || a.path.localeCompare(b.path, "es"));
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
  const [manifest, setManifest] = useState<Manifest | null>(null);
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

  // El manifiesto es el que dice si este agente acepta que le suban algo. Si no
  // contesta, no se ofrece: ante la duda, la pantalla queda como estaba.
  useEffect(() => {
    if (!cfg) return;
    let vivo = true;
    getManifest(cfg).then((m) => { if (vivo) setManifest(m); }).catch(() => {});
    return () => { vivo = false; };
  }, [cfg]);

  const sePuedeSubir = manifest?.modules?.upload === true;

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

  // El título del visor: el que puso el agente en el front-matter si lo hay, y
  // si no el nombre en criollo. El nombre del archivo tal cual sigue abajo, con
  // la ruta: es el dato que hace falta para reconocer lo que se baja.
  const viewerName = viewer ? nombreLegibleDeArchivo(viewer.path) : "";

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

  /* ── Dejarle algo al agente ─────────────────────────────────────────────── */

  const inputSubida = useRef<HTMLInputElement | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [errSubida, setErrSubida] = useState<string | null>(null);
  const [reciensubidos, setRecienSubidos] = useState<string[]>([]);
  const [arrastrando, setArrastrando] = useState(false);

  // El acuse de recibo vive en la carpeta donde cayó lo que subiste: apenas te
  // vas a otra, ya no está diciendo nada de lo que estás mirando.
  useEffect(() => { if (dir !== INBOX) setRecienSubidos([]); }, [dir]);

  /** Refresca la lista SIN vaciarla: después de subir, parpadear la pantalla
   *  entera para agregar un renglón es perder de vista lo que acabás de dejar. */
  const recargar = useCallback(() => {
    if (!cfg) return;
    getFiles(cfg)
      .then((r) => setFiles(Array.isArray(r.files) ? r.files : []))
      .catch(() => { /* la lista que hay sigue sirviendo */ });
  }, [cfg]);

  /** Sube lo que el cliente eligió (o soltó). Va todo al buzón `entrada/`: lo
   *  decide el adapter, no nosotros, y por eso al terminar se abre esa carpeta
   *  — que el archivo aparezca en algún lado que el cliente no está mirando es
   *  lo mismo que no haberlo subido. */
  const subir = async (lista: FileList | File[] | null) => {
    const elegidos = Array.from(lista ?? []);
    if (!cfg || elegidos.length === 0 || subiendo) return;
    setSubiendo(true);
    setErrSubida(null);
    const nombres: string[] = [];
    try {
      for (const f of elegidos) {
        const r = await uploadFile(cfg, f);
        // El adapter devuelve "workspace/entrada/x.csv"; adentro del portal las
        // rutas viven sin ese prefijo (es la raíz de todo lo que sirve).
        const ruta = quitarPrefijo(r.path) ?? `${INBOX}/${f.name}`;
        nombres.push(ruta);
      }
      setRecienSubidos(nombres);
      recargar();
      goTo(INBOX);
    } catch (e) {
      setErrSubida(e instanceof Error ? e.message : String(e));
    } finally {
      setSubiendo(false);
      if (inputSubida.current) inputSubida.current.value = "";
    }
  };

  const soltar = (e: React.DragEvent) => {
    e.preventDefault();
    setArrastrando(false);
    if (sePuedeSubir) subir(e.dataTransfer?.files ?? null);
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
            hint={sePuedeSubir
              ? "Acá van a aparecer los informes y documentos que escriba tu agente. Y si querés que trabaje con algo tuyo —una planilla, un listado, un PDF—, dejáselo acá."
              : "Cuando tu agente genere reportes o documentos, van a aparecer acá."}
          />
          {sePuedeSubir && (
            <div className="flex justify-center">
              <Btn onClick={() => inputSubida.current?.click()} disabled={subiendo}>
                <Upload className="h-4 w-4" />
                {subiendo ? "Subiendo…" : "Subir un archivo"}
              </Btn>
            </div>
          )}
        </>
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
    // Se busca por las dos: el cliente escribe "hoja de ruta" (lo que ve) y el
    // archivo se llama `2026-08-13-hoja-de-ruta-…` (lo que hay).
    const inDir = needle
      ? all.inDir.filter((f) => {
        const archivo = f.path.split("/").pop() || f.path;
        return norm(archivo).includes(needle)
          || norm(nombreLegibleDeArchivo(f.path)).includes(needle);
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
              // EL NOMBRE DEL ARCHIVO NO ES UN NOMBRE. La skill `entregable` lo
              // arma con la fecha adelante, todo en slug, y encima lo corta a
              // los 56 caracteres: la clienta de prueba leyó
              // `prueba-del-control-semanal-de-contratos-13-de-agosto-de-.md` y
              // anotó "cortado a la mitad y con esas letras raras al final".
              // Acá se muestra el nombre; el archivo, con su nombre real, es lo
              // que se baja (y sigue a la vista en el visor y en el hover).
              const titulo = nombreLegibleDeArchivo(f.path);
              const texty = TEXT_EXT.test(name);
              // Se puede ver ADENTRO del portal: texto plano o planilla.
              const verEnPortal = texty || esPlanilla(name) || esFoto(name);
              const Icon = fileIcon(name);
              // CUÁNDO LO ESCRIBIÓ, EN LA HORA DEL AGENTE. Acá decía "hace 3 h"
              // mientras Actividad —que lista EXACTAMENTE estos archivos, con
              // este mismo `mtime`— dice "Hoy · 00:57": sobre el mismo archivo,
              // dos pantallas contestando distinto a la misma pregunta. Y "hace
              // 3 h" no se cruza con nada: el cliente que quiere saber si el
              // informe es el de la mañana tenía que hacer la cuenta él, con SU
              // reloj, que es justamente el que acá no manda.
              // Con el nombre en criollo, el tipo deja de estar en el título:
              // "XLSX" es lo que le dice al cliente que eso se abre con Excel.
              const meta = [tipoDeArchivo(f.path), fmtSize(f.size), fechaHora(f.mtime)]
                .filter(Boolean).join(" · ");
              const recien = reciensubidos.includes(f.path);
              return (
                <li key={`f-${f.path}`} className={`group relative ${recien ? "bg-c-green/30" : ""}`}>
                  <div className="flex w-full items-center gap-3 px-4 py-2.5 transition hover:bg-black/[0.02]">
                    <Icon className="h-4 w-4 shrink-0 text-ink-soft" />
                    {/* El nombre abre lo que se puede ver —incluidas las
                        planillas— y baja lo que no. */}
                    <button
                      onClick={() => (verEnPortal ? openFile(f.path) : descargarRuta(f.path))}
                      className="min-w-0 flex-1 truncate text-left text-sm text-ink hover:underline"
                      title={name}
                    >
                      {titulo}
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
                {q ? "Ningún archivo coincide."
                  : dir === INBOX && sePuedeSubir
                    ? "Todavía no le dejaste nada. Subí una planilla, un listado o un PDF y tu agente lo va a tener acá."
                    : "Esta carpeta está vacía."}
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
  // La misma hora que la fila de la lista y que Actividad: una sola verdad.
  const viewerCuando = fechaHora(viewerMeta?.mtime);
  const hasMeta = !!fm && (!!fm.tipo || !!fm.fecha || fm.tags.length > 0);

  return (
    <div
      className="relative mx-auto max-w-4xl px-6 py-6 md:px-8"
      onDragOver={(e) => {
        if (!sePuedeSubir) return;
        e.preventDefault();
        setArrastrando(true);
      }}
      onDragLeave={(e) => {
        // Sólo cuando el puntero se va DE VERDAD: entrar a un hijo dispara
        // dragleave del padre y el cartel titilaba con el mouse quieto.
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setArrastrando(false);
      }}
      onDrop={soltar}
    >
      <PageHeader
        title="Archivos"
        subtitle={sePuedeSubir
          ? "Lo que tu agente fue escribiendo, y lo que vos le dejás"
          : "Todos los archivos que tu agente fue escribiendo"}
        actions={
          <>
            {(dir || abiertoPath) && <CopiarLink titulo="Copiar el link de esta carpeta" />}
            {sePuedeSubir && files !== null && files.length > 0 && (
              <Btn onClick={() => inputSubida.current?.click()} disabled={subiendo}>
                <Upload className="h-4 w-4" />
                {subiendo ? "Subiendo…" : "Subir un archivo"}
              </Btn>
            )}
          </>
        }
      />
      {/* Uno solo, escondido, para el botón y para el vacío. `multiple` porque
          nadie manda "la planilla" sin mandar también el listado de al lado. */}
      {sePuedeSubir && (
        <input
          ref={inputSubida}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => subir(e.target.files)}
        />
      )}
      {/* El link apunta a un archivo que ya no está: se dice y queda la lista. */}
      {abiertoPath && files !== null
        && !files.some((f) => clean(f.path) === abiertoPath) && (
        <AvisoLinkViejo>
          No encontré ese archivo — puede que tu agente lo haya renombrado o movido.
          Abajo está todo lo que tenés hoy.
        </AvisoLinkViejo>
      )}
      {errSubida && (
        <p className="mb-4 rounded-lg border border-c-coral bg-c-coral/40 px-3 py-2 text-[12px] font-medium text-c-coral-ink">
          No pude subir el archivo ({errSubida}).
        </p>
      )}
      {/* SUBIRLO NO ES PEDIRLE NADA. El archivo queda en su buzón y el agente lo
          va a encontrar ahí, pero nadie le avisó: prometer que "ya lo está
          mirando" sería la clase de promesa que después no se cumple. Se dice
          qué pasó y dónde se sigue. */}
      {reciensubidos.length > 0 && (
        <div className="mb-4 rounded-lg border border-c-green bg-c-green/30 px-3 py-2 text-[13px] leading-snug text-c-green-ink">
          {reciensubidos.length === 1
            ? "Listo, se lo dejaste a tu agente en Entrada."
            : `Listo, le dejaste ${reciensubidos.length} archivos en Entrada.`}{" "}
          Para que trabaje con {reciensubidos.length === 1 ? "esto" : "esos"},{" "}
          <Link href="/app/chat" className="font-semibold underline underline-offset-2">
            pedíselo por el chat
          </Link>.
        </div>
      )}
      {body()}
      {/* Soltar en cualquier parte de la pantalla, no en un rectángulo chiquito:
          el cliente arrastra el archivo hacia "Archivos", no hacia un target. */}
      {arrastrando && sePuedeSubir && (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-ink/10">
          <div className="flex items-center gap-2 rounded-xl border border-primary bg-white px-4 py-3 text-sm font-semibold text-primary">
            <Upload className="h-4 w-4" />
            Soltalo acá y se lo dejo a tu agente
          </div>
        </div>
      )}
      {viewer && !(viewer.err && /^404/.test(viewer.err)) && (
        <Modal wide onClose={cerrarVisor}>
          <div className="flex items-start justify-between gap-3 border-b border-black/[0.07] px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-ink">{fm?.titulo || viewerName}</p>
              <p className="truncate text-[11px] text-ink-soft">
                {viewer.path}
                {viewerMeta?.size != null ? ` · ${fmtSize(viewerMeta.size)}` : ""}
                {viewerCuando ? ` · ${viewerCuando}` : ""}
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
