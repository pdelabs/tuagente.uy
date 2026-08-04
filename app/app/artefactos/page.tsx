"use client";

// Artefactos — lo que el agente dibujó: páginas HTML autocontenidas (gráficos,
// tablas ricas, informes) guardadas en su workspace.
//
// GENÉRICO (principio cero): el `kind` se traduce si lo conocemos y se muestra
// crudo si no; nada del dominio del cliente vive acá.
//
// La grilla muestra MINIATURAS REALES: un iframe chico con el HTML del
// artefacto, sin permisos (sandbox="") y sin eventos (pointer-events-none),
// escalado a 0.4. El HTML se pide recién cuando la tarjeta entra en viewport
// (IntersectionObserver) para no bajar 30 artefactos de una; queda cacheado por
// id, así la vista grande no lo vuelve a pedir.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Download, ImageOff, LayoutDashboard, RefreshCw, Search, SearchX, Trash2, X,
} from "lucide-react";
import { loadConfig, type PortalConfig } from "../lib/agent";
import ArtifactView from "../lib/Artifact";
import {
  Btn, Chip, EmptyState, ErrorState, IconBtn, Modal, PageHeader, Spinner, inputCls,
} from "../lib/ui";
import {
  deleteArtifact, getArtifact, listArtifacts, messageOf, statusOf,
  type ArtifactDetail, type ArtifactMeta,
} from "./api";

const REFRESH_MS = 60_000;

type Tono = "violet" | "green" | "coral" | "amber" | "neutral";

// Kinds que el portal entiende. Uno desconocido no se oculta ni se renombra:
// se muestra tal cual lo mandó el agente.
const KINDS: Record<string, { label: string; tone: Tono }> = {
  chart: { label: "Gráfico", tone: "violet" },
  table: { label: "Tabla", tone: "green" },
  report: { label: "Informe", tone: "amber" },
  dashboard: { label: "Panel", tone: "coral" },
  diagram: { label: "Diagrama", tone: "violet" },
  other: { label: "Otro", tone: "neutral" },
};

const kindLabel = (k: string) => KINDS[k]?.label ?? k;
const kindTone = (k: string): Tono => KINDS[k]?.tone ?? "neutral";

// created_at llega como epoch en SEGUNDOS; tolero ms, string numérico y fechas.
function toDate(v: string | number): Date | null {
  const n = typeof v === "number" ? v : Number(v);
  if (Number.isFinite(n) && String(v).trim() !== "" && n > 0)
    return new Date(n > 1e12 ? n : n * 1000);
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function fmtRelativa(v: string | number): string {
  const d = toDate(v);
  if (!d) return "";
  const min = Math.round((Date.now() - d.getTime()) / 60_000);
  if (min < 1) return "recién";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const dias = Math.round(h / 24);
  if (dias < 7) return dias === 1 ? "hace 1 día" : `hace ${dias} días`;
  const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = "numeric";
  return d.toLocaleDateString("es-UY", opts);
}

function fmtBytes(n: number | null): string {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// Búsqueda insensible a mayúsculas y tildes.
const normalizar = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

// Nombre de archivo para la descarga, a partir del título.
function slug(s: string): string {
  const base = normalizar(s).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return base || "artefacto";
}

function FiltroChip({ activo, onClick, children }: {
  activo: boolean; onClick: () => void; children: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={activo}
      className={`rounded-md px-2 py-0.5 text-[11px] font-semibold transition ${
        activo
          ? "bg-ink text-white"
          : "bg-black/[0.05] text-ink-soft hover:bg-black/[0.08] hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

// ── Miniatura: iframe real, perezoso, congelado ──────────────────────────────
function Miniatura({ cfg, id }: { cfg: PortalConfig; id: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [fallo, setFallo] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let vivo = true;
    const traer = () => {
      getArtifact(cfg, id)
        .then((d) => { if (vivo) setHtml(d.html); })
        .catch(() => { if (vivo) setFallo(true); });
    };
    if (typeof IntersectionObserver === "undefined") { traer(); return () => { vivo = false; }; }
    const io = new IntersectionObserver(
      (entradas) => {
        if (entradas.some((e) => e.isIntersecting)) { io.disconnect(); traer(); }
      },
      { rootMargin: "300px" }, // un poco antes de que se vea, para que no aparezca vacía
    );
    io.observe(el);
    return () => { vivo = false; io.disconnect(); };
  }, [cfg, id]);

  return (
    <div
      ref={ref}
      className="relative h-40 w-full overflow-hidden border-b border-black/[0.07] bg-white"
    >
      {html !== null ? (
        <iframe
          // sandbox="" = cero permisos: ni scripts, ni forms, ni same-origin.
          // Es una foto, no una app: nada de lo que traiga el artefacto corre acá.
          sandbox=""
          srcDoc={html}
          title="Miniatura del artefacto"
          aria-hidden
          tabIndex={-1}
          scrolling="no"
          className="pointer-events-none absolute left-0 top-0 origin-top-left border-0"
          // 250% × scale(0.4) = una página de ancho normal, entera, en 40%.
          style={{ width: "250%", height: "250%", transform: "scale(0.4)" }}
        />
      ) : fallo ? (
        <div className="flex h-full items-center justify-center">
          <ImageOff className="h-5 w-5 text-ink-soft/40" />
        </div>
      ) : (
        <div className="h-full w-full animate-pulse bg-black/[0.03]" />
      )}
      {/* Velo inferior: el corte de la miniatura se ve intencional. */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-white/80" />
    </div>
  );
}

// ── Tarjeta ──────────────────────────────────────────────────────────────────
// div con role=button (y no <button>) porque un <button> no puede contener un
// iframe: contenido interactivo anidado, HTML inválido.
function Tarjeta({ cfg, a, onOpen }: {
  cfg: PortalConfig; a: ArtifactMeta; onOpen: () => void;
}) {
  const meta = [fmtRelativa(a.created_at), fmtBytes(a.bytes)].filter(Boolean).join(" · ");
  return (
    <div
      role="button"
      tabIndex={0}
      aria-haspopup="dialog"
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); }
      }}
      className="flex cursor-pointer flex-col overflow-hidden rounded-xl border border-black/[0.07] bg-white text-left transition hover:border-primary/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      <Miniatura cfg={cfg} id={a.id} />
      <div className="flex flex-1 flex-col p-3.5">
        <p className="line-clamp-2 text-[13px] font-semibold leading-snug text-ink">{a.title}</p>
        {a.summary?.trim() && (
          <p className="mt-1 line-clamp-2 text-[12px] leading-snug text-ink-soft">{a.summary}</p>
        )}
        <div className="mt-3 flex items-center gap-1.5">
          <Chip tone={kindTone(a.kind)}>{kindLabel(a.kind)}</Chip>
          {meta && <span className="ml-auto text-[11px] text-ink-soft">{meta}</span>}
        </div>
      </div>
    </div>
  );
}

// ── Página ───────────────────────────────────────────────────────────────────
export default function ArtefactosPage() {
  const [cfg, setCfg] = useState<PortalConfig | null>(null);
  const [items, setItems] = useState<ArtifactMeta[] | null>(null);
  const [err, setErr] = useState<{ status?: number; message: string } | null>(null);
  const [cargando, setCargando] = useState(false);
  const [ultima, setUltima] = useState<Date | null>(null);
  const [kind, setKind] = useState<string | null>(null); // null = todos
  const [busqueda, setBusqueda] = useState("");

  const [abierto, setAbierto] = useState<ArtifactMeta | null>(null);
  const [detalle, setDetalle] = useState<ArtifactDetail | null>(null);
  const [detalleErr, setDetalleErr] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [borrando, setBorrando] = useState(false);
  const [borrarErr, setBorrarErr] = useState<string | null>(null);

  const enVuelo = useRef(false);

  useEffect(() => { setCfg(loadConfig()); }, []);

  // silencioso: refresco de fondo, sin spinner ni parpadeo de la grilla.
  const cargar = useCallback(async (silencioso = false) => {
    if (!cfg || enVuelo.current) return;
    enVuelo.current = true;
    if (!silencioso) setCargando(true);
    try {
      const lista = await listArtifacts(cfg);
      lista.sort((a, b) =>
        (toDate(b.created_at)?.getTime() ?? 0) - (toDate(a.created_at)?.getTime() ?? 0));
      setItems(lista);
      setErr(null);
      setUltima(new Date());
    } catch (e) {
      setErr({ status: statusOf(e), message: messageOf(e) });
    } finally {
      enVuelo.current = false;
      setCargando(false);
    }
  }, [cfg]);

  useEffect(() => {
    if (!cfg) return;
    cargar();
    const id = setInterval(() => cargar(true), REFRESH_MS);
    return () => clearInterval(id);
  }, [cfg, cargar]);

  // HTML del artefacto abierto (normalmente ya cacheado por la miniatura).
  // El contador descarta la respuesta de un artefacto que ya se cerró.
  const pedido = useRef(0);
  const cargarDetalle = useCallback((a: ArtifactMeta) => {
    if (!cfg) return;
    const n = ++pedido.current;
    setDetalle(null);
    setDetalleErr(null);
    getArtifact(cfg, a.id)
      .then((d) => { if (pedido.current === n) setDetalle(d); })
      .catch((e) => { if (pedido.current === n) setDetalleErr(messageOf(e)); });
  }, [cfg]);

  useEffect(() => {
    if (!abierto) return;
    setConfirmando(false);
    setBorrarErr(null);
    cargarDetalle(abierto);
  }, [abierto, cargarDetalle]);

  // Modal: Escape cierra, el fondo no scrollea.
  useEffect(() => {
    if (!abierto) return;
    const fn = (e: KeyboardEvent) => e.key === "Escape" && setAbierto(null);
    window.addEventListener("keydown", fn);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", fn);
      document.body.style.overflow = "";
    };
  }, [abierto]);

  // Kinds presentes en los datos (nunca hardcodeados), ordenados por rótulo.
  const kinds = useMemo(() => {
    const set = new Set<string>();
    for (const a of items ?? []) set.add(a.kind);
    return Array.from(set).sort((a, b) => kindLabel(a).localeCompare(kindLabel(b), "es"));
  }, [items]);

  const visibles = useMemo(() => {
    const q = normalizar(busqueda.trim());
    return (items ?? []).filter((a) => {
      if (kind && a.kind !== kind) return false;
      if (q && !normalizar(`${a.title} ${a.summary ?? ""}`).includes(q)) return false;
      return true;
    });
  }, [items, kind, busqueda]);

  const descargar = () => {
    if (!detalle || !abierto) return;
    const url = URL.createObjectURL(new Blob([detalle.html], { type: "text/html" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slug(abierto.title)}.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  const borrar = async () => {
    if (!cfg || !abierto) return;
    setBorrando(true);
    setBorrarErr(null);
    try {
      await deleteArtifact(cfg, abierto.id);
      setItems((prev) => (prev ?? []).filter((x) => x.id !== abierto.id));
      setAbierto(null);
    } catch (e) {
      setBorrarErr(messageOf(e));
    } finally {
      setBorrando(false);
    }
  };

  const wrap = "mx-auto max-w-6xl px-6 py-6 md:px-8";

  const cuerpo = () => {
    // El adapter viejo no conoce /portal/artifacts: no es una caída, es una
    // capacidad que este agente todavía no tiene.
    if (items === null && err?.status === 404) {
      return (
        <>
          <EmptyState
            icon={LayoutDashboard}
            title="Este agente todavía no expone artefactos"
            hint="Su portal corre una versión anterior. Cuando se actualice, las visualizaciones que genere van a aparecer acá."
          />
          <div className="flex justify-center">
            <Btn kind="ghost" size="sm" onClick={() => cargar()}>Reintentar</Btn>
          </div>
        </>
      );
    }
    if (items === null && err) return <ErrorState message={err.message} onRetry={() => cargar()} />;
    if (items === null || !cfg) return <Spinner />;
    if (items.length === 0) {
      return (
        <EmptyState
          icon={LayoutDashboard}
          title="Tu agente todavía no creó ningún artefacto"
          hint="Los crea cuando conviene ver los datos en vez de leerlos: un gráfico, una tabla grande, un informe para abrir y mirar."
        />
      );
    }
    return (
      <>
        {kinds.length > 1 && (
          <div className="mb-5 flex flex-wrap items-center gap-1.5">
            <FiltroChip activo={kind === null} onClick={() => setKind(null)}>Todos</FiltroChip>
            {kinds.map((k) => (
              <FiltroChip key={k} activo={kind === k} onClick={() => setKind(kind === k ? null : k)}>
                {kindLabel(k)}
              </FiltroChip>
            ))}
          </div>
        )}
        {visibles.length === 0 ? (
          <EmptyState
            icon={SearchX}
            title="Ningún artefacto coincide"
            hint="Probá con otra búsqueda o sacá el filtro."
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visibles.map((a) => (
              <Tarjeta key={a.id} cfg={cfg} a={a} onOpen={() => setAbierto(a)} />
            ))}
          </div>
        )}
      </>
    );
  };

  return (
    <div className={wrap}>
      <PageHeader
        title="Artefactos"
        subtitle="Lo que tu agente dibujó para que veas los datos"
        actions={
          <>
            {ultima && (
              <span className="hidden text-xs text-ink-soft sm:inline">
                Actualizado{" "}
                {ultima.toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit", hour12: false })}
              </span>
            )}
            <div className="relative w-56">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft/60" />
              <input
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Buscar artefacto…"
                className={`${inputCls} pl-8`}
              />
            </div>
            <IconBtn label="Actualizar" disabled={cargando} onClick={() => cargar()}>
              <RefreshCw className={`h-4 w-4 ${cargando ? "animate-spin" : ""}`} />
            </IconBtn>
          </>
        }
      />

      {err && items !== null && (
        <p className="mb-4 inline-flex items-center rounded-lg border border-c-coral bg-c-coral/40 px-3 py-1.5 text-[12px] font-medium text-c-coral-ink">
          No pude actualizar recién ({err.message}). Te muestro lo último que tengo.
        </p>
      )}

      {cuerpo()}

      {abierto && (
        <Modal wide onClose={() => setAbierto(null)}>
          <div className="flex items-start justify-between gap-4 border-b border-black/[0.07] px-5 py-4">
            <div className="min-w-0">
              <h2 className="text-base font-bold leading-snug text-ink">{abierto.title}</h2>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <Chip tone={kindTone(abierto.kind)}>{kindLabel(abierto.kind)}</Chip>
                <span className="text-[11px] text-ink-soft">
                  {[fmtRelativa(abierto.created_at), fmtBytes(abierto.bytes)]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </div>
            </div>
            <IconBtn label="Cerrar" onClick={() => setAbierto(null)}>
              <X className="h-4 w-4" />
            </IconBtn>
          </div>

          {/* min-w-0: sin esto un artefacto ancho estira el modal. */}
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-5 py-1">
            {detalleErr ? (
              <div className="py-6">
                <ErrorState
                  message={`No pude abrir el artefacto (${detalleErr}).`}
                  onRetry={() => cargarDetalle(abierto)}
                />
              </div>
            ) : detalle ? (
              // Vista/Código + "Abrir en pestaña nueva" ya vienen en el componente.
              <ArtifactView code={detalle.html} lang="html" />
            ) : (
              <Spinner />
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-black/[0.07] px-5 py-3">
            {borrarErr && (
              <p className="w-full text-[12px] font-medium text-c-coral-ink">
                No pude borrarlo ({borrarErr}).
              </p>
            )}
            <Btn kind="secondary" size="sm" disabled={!detalle} onClick={descargar}>
              <Download className="h-3.5 w-3.5" />
              Descargar .html
            </Btn>
            <div className="ml-auto flex items-center gap-2">
              {confirmando ? (
                <>
                  <span className="text-[12px] text-ink-soft">¿Borrarlo para siempre?</span>
                  <Btn kind="ghost" size="sm" disabled={borrando} onClick={() => setConfirmando(false)}>
                    Cancelar
                  </Btn>
                  <Btn kind="danger" size="sm" disabled={borrando} onClick={borrar}>
                    {borrando ? "Borrando…" : "Sí, borrar"}
                  </Btn>
                </>
              ) : (
                <Btn kind="danger" size="sm" onClick={() => setConfirmando(true)}>
                  <Trash2 className="h-3.5 w-3.5" />
                  Borrar
                </Btn>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
