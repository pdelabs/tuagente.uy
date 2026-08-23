"use client";

// Artifacts — what the agent drew: self-contained HTML pages (charts, rich
// tables, reports) saved in its workspace.
//
// GENERIC (principio cero): the `kind` is translated if we know it and shown
// raw if not; nothing about the client's domain lives here.
//
// The grid shows REAL THUMBNAILS: a small iframe with the artifact's HTML, no
// permissions (sandbox="") and no events (pointer-events-none), scaled to
// 0.4. The HTML is only requested once the card enters the viewport
// (IntersectionObserver) so it doesn't fetch 30 artifacts at once; it stays
// cached by id, so the large view doesn't request it again.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Download, ImageOff, LayoutDashboard, RefreshCw, Search, SearchX, Trash2, X,
} from "lucide-react";
import { loadConfig, type PortalConfig } from "../lib/agent";
import { CopyLink, PARAM, openInRoute, closeInRoute, useRouteParam } from "../lib/routes";
import DeliverablesByFlow from "../lib/DeliverablesByFlow";
import ArtifactView from "../lib/Artifact";
import { timeOf, momentOf, artifactLabel } from "../lib/labels";
import {
  StaleLinkNotice, Btn, Chip, EmptyState, ErrorState, IconBtn, Modal, PageHeader, Spinner, inputCls,
} from "../lib/ui";
import {
  deleteArtifact, getArtifact, listArtifacts, messageOf, statusOf,
  type ArtifactDetail, type ArtifactMeta,
} from "./api";

const REFRESH_MS = 60_000;

// What each delivery kind is called comes from `lib/labels.ts`: this little
// table used to live in Home and in the modal too, and all three said
// different things about the same thing.
const kindLabel = (k: string) => artifactLabel(k).label;
const kindTone = (k: string) => artifactLabel(k).tone;

// `created_at` arrives as epoch in SECONDS with no timezone. The relative
// form ("3h ago") can be counted from any clock; the date on old ones can't:
// it's written in the business's, like the rest of the portal.
function fmtRelative(v: string | number): string {
  const m = momentOf(v);
  if (!m) return "";
  const min = Math.round((Date.now() - m.ms) / 60_000);
  if (min < 1) return "recién";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const days = Math.round(h / 24);
  if (days < 7) return days === 1 ? "hace 1 día" : `hace ${days} días`;
  return m.year === new Date().getFullYear() ? m.date : `${m.date} ${m.year}`;
}

function fmtBytes(n: number | null): string {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// Search, case- and accent-insensitive.
const normalize = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

// File name for the download, built from the title.
function slug(s: string): string {
  const base = normalize(s).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return base || "artefacto";
}

function FilterChip({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-md px-2 py-0.5 text-[11px] font-semibold transition ${
        active
          ? "bg-ink text-white"
          : "bg-black/[0.05] text-ink-soft hover:bg-black/[0.08] hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

// ── Thumbnail: real iframe, lazy, frozen ─────────────────────────────────────
function Thumbnail({ cfg, id }: { cfg: PortalConfig; id: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let alive = true;
    const fetchIt = () => {
      getArtifact(cfg, id)
        .then((d) => { if (alive) setHtml(d.html); })
        .catch(() => { if (alive) setFailed(true); });
    };
    if (typeof IntersectionObserver === "undefined") { fetchIt(); return () => { alive = false; }; }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) { io.disconnect(); fetchIt(); }
      },
      { rootMargin: "300px" }, // a bit before it becomes visible, so it doesn't show up empty
    );
    io.observe(el);
    return () => { alive = false; io.disconnect(); };
  }, [cfg, id]);

  return (
    <div
      ref={ref}
      className="relative h-40 w-full overflow-hidden border-b border-black/[0.07] bg-white"
    >
      {html !== null ? (
        <iframe
          // sandbox="" = zero permissions: no scripts, no forms, no same-origin.
          // It's a photo, not an app: nothing the artifact brings runs here.
          sandbox=""
          srcDoc={html}
          title="Vista previa"
          aria-hidden
          tabIndex={-1}
          scrolling="no"
          className="pointer-events-none absolute left-0 top-0 origin-top-left border-0"
          // 250% × scale(0.4) = a normal-width page, whole, at 40%.
          style={{ width: "250%", height: "250%", transform: "scale(0.4)" }}
        />
      ) : failed ? (
        <div className="flex h-full items-center justify-center">
          <ImageOff className="h-5 w-5 text-ink-soft/40" />
        </div>
      ) : (
        // MAKE IT LOOK LIKE IT'S LOADING. It used to be a full-screen
        // `bg-black/[0.03]`: on white, 3% black is indistinguishable from an
        // empty card. The thumbnail is only requested once the card enters
        // the viewport, so there's a while —and in a tab the browser isn't
        // painting, however long it takes— during which the client stares at
        // three blank boxes and concludes it broke. With lines it reads as
        // "on its way", which is what's actually happening.
        <div className="flex h-full flex-col gap-2 p-4" aria-label="Cargando la vista previa">
          <div className="h-3 w-2/5 animate-pulse rounded bg-black/[0.07]" />
          <div className="h-2 w-4/5 animate-pulse rounded bg-black/[0.05]" />
          <div className="h-2 w-3/5 animate-pulse rounded bg-black/[0.05]" />
          <div className="mt-1 flex-1 animate-pulse rounded bg-black/[0.04]" />
        </div>
      )}
      {/* Bottom veil: the thumbnail's cutoff looks intentional. */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-white/80" />
    </div>
  );
}

// ── Card ──────────────────────────────────────────────────────────────────
// div with role=button (not <button>) because a <button> can't contain an
// iframe: nested interactive content, invalid HTML.
function ArtifactCard({ cfg, a, onOpen }: {
  cfg: PortalConfig; a: ArtifactMeta; onOpen: () => void;
}) {
  const meta = [fmtRelative(a.created_at), fmtBytes(a.bytes)].filter(Boolean).join(" · ");
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
      <Thumbnail cfg={cfg} id={a.id} />
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

// ── Page ─────────────────────────────────────────────────────────────────────
export default function ArtifactsPage() {
  const [cfg, setCfg] = useState<PortalConfig | null>(null);
  const [items, setItems] = useState<ArtifactMeta[] | null>(null);
  const [err, setErr] = useState<{ status?: number; message: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [kind, setKind] = useState<string | null>(null); // null = all
  const [search, setSearch] = useState("");

  // Which one is open is decided by the URL (`?artifact=art_…`): that way it
  // can be shared, refreshed, and "back" closes it.
  const openId = useRouteParam(PARAM.artifact);
  const open = useCallback((id: string) => openInRoute({ [PARAM.artifact]: id }), []);
  const close = useCallback(() => closeInRoute(PARAM.artifact), []);
  const [detail, setDetail] = useState<ArtifactDetail | null>(null);
  const [detailErr, setDetailErr] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);

  const inFlight = useRef(false);

  useEffect(() => { setCfg(loadConfig()); }, []);

  // silent: background refresh, no spinner or grid flicker.
  const load = useCallback(async (silent = false) => {
    if (!cfg || inFlight.current) return;
    inFlight.current = true;
    if (!silent) setLoading(true);
    try {
      const list = await listArtifacts(cfg);
      list.sort((a, b) =>
        (momentOf(b.created_at)?.ms ?? 0) - (momentOf(a.created_at)?.ms ?? 0));
      setItems(list);
      setErr(null);
      setLastUpdated(new Date());
    } catch (e) {
      setErr({ status: statusOf(e), message: messageOf(e) });
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [cfg]);

  useEffect(() => {
    if (!cfg) return;
    load();
    const id = setInterval(() => load(true), REFRESH_MS);
    return () => clearInterval(id);
  }, [cfg, load]);

  // HTML of the open artifact (usually already cached by the thumbnail).
  // The counter discards the response for an artifact that's already closed.
  const requestSeq = useRef(0);
  const loadDetail = useCallback((id: string) => {
    if (!cfg) return;
    const n = ++requestSeq.current;
    setDetail(null);
    setDetailErr(null);
    getArtifact(cfg, id)
      .then((d) => { if (requestSeq.current === n) setDetail(d); })
      .catch((e) => { if (requestSeq.current === n) setDetailErr(messageOf(e)); });
  }, [cfg]);

  useEffect(() => {
    if (!openId) return;
    setConfirming(false);
    setDeleteErr(null);
    loadDetail(openId);
  }, [openId, loadDetail]);

  // Modal: Escape closes it, the background doesn't scroll.
  useEffect(() => {
    if (!openId) return;
    const onKeyDown = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = "";
    };
  }, [openId, close]);

  // Kinds present in the data (never hardcoded), sorted by label.
  const kinds = useMemo(() => {
    const set = new Set<string>();
    for (const a of items ?? []) set.add(a.kind);
    return Array.from(set).sort((a, b) => kindLabel(a).localeCompare(kindLabel(b), "es"));
  }, [items]);

  const visible = useMemo(() => {
    const q = normalize(search.trim());
    return (items ?? []).filter((a) => {
      if (kind && a.kind !== kind) return false;
      if (q && !normalize(`${a.title} ${a.summary ?? ""}`).includes(q)) return false;
      return true;
    });
  }, [items, kind, search]);

  // What shows in the modal's header. The detail ALREADY brings the full
  // record, so a shared link opens correctly even if the grid hasn't arrived
  // yet (or even if that artifact is filtered out of the view).
  const openMeta = useMemo<ArtifactMeta | null>(() => {
    if (!openId) return null;
    return detail ?? (items ?? []).find((x) => x.id === openId) ?? null;
  }, [openId, detail, items]);

  const download = () => {
    if (!detail || !openMeta) return;
    const url = URL.createObjectURL(new Blob([detail.html], { type: "text/html" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slug(openMeta.title)}.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  const handleDelete = async () => {
    if (!cfg || !openId) return;
    setDeleting(true);
    setDeleteErr(null);
    try {
      await deleteArtifact(cfg, openId);
      setItems((prev) => (prev ?? []).filter((x) => x.id !== openId));
      close();
    } catch (e) {
      setDeleteErr(messageOf(e));
    } finally {
      setDeleting(false);
    }
  };

  const wrap = "mx-auto max-w-6xl px-6 py-6 md:px-8";

  const body = () => {
    // The old adapter doesn't know /portal/artifacts: that's not a crash,
    // it's a capability this agent doesn't have yet.
    if (items === null && err?.status === 404) {
      return (
        <>
          <EmptyState
            icon={LayoutDashboard}
            title="Este agente todavía no expone visualizaciones"
            hint="Su portal corre una versión anterior. Cuando se actualice, las visualizaciones que genere van a aparecer acá."
          />
          <div className="flex justify-center">
            <Btn kind="ghost" size="sm" onClick={() => load()}>Reintentar</Btn>
          </div>
        </>
      );
    }
    if (items === null && err) return <ErrorState message={err.message} onRetry={() => load()} />;
    if (items === null || !cfg) return <Spinner />;
    if (items.length === 0) {
      return (
        <EmptyState
          icon={LayoutDashboard}
          title="Tu agente todavía no armó ninguna visualización"
          hint="Los crea cuando conviene ver los datos en vez de leerlos: un gráfico, una tabla grande, un informe para abrir y mirar."
        />
      );
    }
    return (
      <>
        {kinds.length > 1 && (
          <div className="mb-5 flex flex-wrap items-center gap-1.5">
            <FilterChip active={kind === null} onClick={() => setKind(null)}>Todos</FilterChip>
            {kinds.map((k) => (
              <FilterChip key={k} active={kind === k} onClick={() => setKind(kind === k ? null : k)}>
                {kindLabel(k)}
              </FilterChip>
            ))}
          </div>
        )}
        {visible.length === 0 ? (
          <EmptyState
            icon={SearchX}
            title="Ninguna visualización coincide"
            hint="Probá con otra búsqueda o sacá el filtro."
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visible.map((a) => (
              <ArtifactCard key={a.id} cfg={cfg} a={a} onOpen={() => open(a.id)} />
            ))}
          </div>
        )}
      </>
    );
  };

  return (
    <div className={wrap}>
      <PageHeader
        title="Entregas"
        subtitle="Todo lo que tu agente produjo: los entregables de tus flujos y sus visualizaciones"
        actions={
          <>
            {lastUpdated && (
              <span className="hidden text-xs text-ink-soft sm:inline">
                Actualizado {timeOf(lastUpdated.getTime())}
              </span>
            )}
            <div className="relative w-56">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft/60" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar…"
                className={`${inputCls} pl-8`}
              />
            </div>
            <IconBtn label="Actualizar" disabled={loading} onClick={() => load()}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </IconBtn>
          </>
        }
      />

      {/* A link to a deleted visualization: it warns, and the grid stays. */}
      {openId && detailErr && (
        <StaleLinkNotice>
          Esa visualización ya no está — tu agente la reemplazó o la borró. Abajo está
          todo lo que produjo.
        </StaleLinkNotice>
      )}

      {err && items !== null && (
        <p className="mb-4 inline-flex items-center rounded-lg border border-c-coral bg-c-coral/40 px-3 py-1.5 text-[12px] font-medium text-c-coral-ink">
          No pude actualizar recién ({err.message}). Te muestro lo último que tengo.
        </p>
      )}

      {/* Each flow's deliverables first: they're the requested work. The
          visualizations (below) are the drawn half of the same story. */}
      {cfg && <DeliverablesByFlow cfg={cfg} />}

      <h2 className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-ink-soft">
        Visualizaciones
      </h2>
      {body()}

      {openId && !detailErr && (
        <Modal wide onClose={close}>
          <div className="flex items-start justify-between gap-4 border-b border-black/[0.07] px-5 py-4">
            <div className="min-w-0">
              {/* The human title wins; the raw URL id never shows. While the
                  record hasn't arrived, it says it's opening. */}
              <h2 className="text-base font-bold leading-snug text-ink">
                {openMeta ? openMeta.title : "Abriendo la visualización…"}
              </h2>
              {openMeta && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <Chip tone={kindTone(openMeta.kind)}>{kindLabel(openMeta.kind)}</Chip>
                  <span className="text-[11px] text-ink-soft">
                    {[fmtRelative(openMeta.created_at), fmtBytes(openMeta.bytes)]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </div>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              <CopyLink label="Copiar el link de esta visualización" />
              <IconBtn label="Cerrar" onClick={close}>
                <X className="h-4 w-4" />
              </IconBtn>
            </div>
          </div>

          {/* min-w-0: without this a wide artifact stretches the modal. */}
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-5 py-1">
            {detailErr ? (
              <div className="py-6">
                <ErrorState
                  message={`No pude abrir la visualización (${detailErr}).`}
                  onRetry={() => loadDetail(openId)}
                />
              </div>
            ) : detail ? (
              // View/Code + "Open in new tab" already come with the component.
              <ArtifactView code={detail.html} lang="html" />
            ) : (
              <Spinner />
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-black/[0.07] px-5 py-3">
            {deleteErr && (
              <p className="w-full text-[12px] font-medium text-c-coral-ink">
                No pude borrarlo ({deleteErr}).
              </p>
            )}
            <Btn kind="secondary" size="sm" disabled={!detail} onClick={download}>
              <Download className="h-3.5 w-3.5" />
              Descargar .html
            </Btn>
            <div className="ml-auto flex items-center gap-2">
              {confirming ? (
                <>
                  <span className="text-[12px] text-ink-soft">¿Borrarlo para siempre?</span>
                  <Btn kind="ghost" size="sm" disabled={deleting} onClick={() => setConfirming(false)}>
                    Cancelar
                  </Btn>
                  <Btn kind="danger" size="sm" disabled={deleting} onClick={handleDelete}>
                    {deleting ? "Borrando…" : "Sí, borrar"}
                  </Btn>
                </>
              ) : (
                /* Delete in red, the same size and right next to Download,
                   was scary: "I'm clumsy with the mouse, I didn't even touch
                   it". The confirmation already existed, but the starting
                   button has no reason to shout. It stays as discreet text;
                   the red only appears once confirming, which is when it
                   matters. */
                <button
                  onClick={() => setConfirming(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12px] font-medium text-ink-soft transition hover:bg-c-coral/40 hover:text-c-coral-ink"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Borrar
                </button>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
