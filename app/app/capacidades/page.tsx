"use client";

// Capacidades: qué sabe hacer el agente y a qué está conectado. Es la primera
// pregunta del cliente cuando quiere pedirle algo nuevo, y hasta ahora no
// tenía dónde contestarla.
//
// Contrato (adapter v0.11): GET {adapter}/portal/capabilities →
//   { skills:  [{ name, summary, origen: "propia" | "de fábrica", categoria? }],
//     plugins: [{ name, summary }],
//     mcp:     [{ name, detalle }] }
// Verificado contra un agente real: 23 skills (9 propias), 2 plugins, 0 MCP.
//
// DECISIÓN DE PRODUCTO: desde el portal no se instala ni se conecta nada. Esta
// pantalla es un inventario, no una tienda: cada capacidad nueva la instalamos
// y la auditamos nosotros. Por eso acá no hay un solo botón de acción.
//
// El vocabulario del cliente no es el del motor: "propia" se dice "hecha para
// vos" y "de fábrica" se dice "viene con el motor". Los valores crudos no se
// muestran nunca (salvo un origen desconocido, que se muestra tal cual antes
// que esconderlo).

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Network, Plug, Puzzle, RefreshCw, Search, Sparkles, X, type LucideIcon,
} from "lucide-react";
import {
  getCapabilities, loadConfig,
  type Capabilities, type Capability, type HttpError, type PortalConfig,
} from "../lib/agent";
import {
  Btn, Card, Chip, EmptyState, ErrorState, IconBtn, PageHeader, Spinner, inputCls,
} from "../lib/ui";

type Falla = { status?: number; message: string };

const WRAP = "mx-auto max-w-5xl px-6 py-6 md:px-8";
const REFRESH_MS = 60_000;
const SUBTITULO = "Lo que tu agente sabe hacer y los sistemas a los que está conectado";

/** Comparación insensible a tildes, mayúsculas y espacios de más. */
const norm = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

// El adapter contesta 404 con {"error":"not found"}: el número solo está en
// e.status, así que el mensaje no alcanza para reconocerlo.
const es404 = (f: Falla) => f.status === 404 || /^404\b/.test(f.message);

// Siglas y extensiones que en minúscula se leen como un error de tipeo.
// Nada de esto es específico de un cliente: son formatos y protocolos.
const SIGLAS = new Set([
  "pdf", "xlsx", "docx", "pptx", "csv", "tsv", "ocr", "api", "url", "sql", "html",
  "css", "json", "yaml", "xml", "cli", "sdk", "ui", "ux", "ai", "ia", "crm", "erp",
  "imap", "smtp", "sms", "mcp", "id", "qr", "http", "https", "rss", "vpn", "gpt",
]);

/**
 * `armado-de-reportes` → "Armado de reportes".
 * Un nombre que ya viene escrito para humanos (con mayúsculas o espacios) no se
 * toca: el dato manda.
 */
function legible(raw: string): string {
  const name = (raw || "").trim();
  if (!name || /[A-Z\s]/.test(name)) return name;
  const partes = name.split(/[-_]+/).filter(Boolean);
  if (partes.length === 0) return name;
  const palabras = partes.map((p) => (SIGLAS.has(p) ? p.toUpperCase() : p));
  palabras[0] = palabras[0].charAt(0).toUpperCase() + palabras[0].slice(1);
  return palabras.join(" ");
}

/**
 * Los summaries vienen del front-matter de cada skill: algunos llegan rotos
 * (restos de YAML como "|") y otros cortados a mitad de frase por el motor.
 * Sin texto útil no mostramos nada, y el corte se marca con puntos suspensivos
 * en vez de fingir que la frase termina ahí.
 */
function resumir(raw?: string): string | null {
  const s = (raw || "").replace(/\s+/g, " ").trim();
  if (!s || !/[a-z0-9]/.test(norm(s))) return null;
  const cortado = s.length > 50 && !/[.!?…:;)\]"']$/.test(s);
  return cortado ? `${s}…` : s;
}

/**
 * Primera frase de un texto largo (los summaries de los plugins son párrafos
 * enteros). `hayMas` dice si vale la pena ofrecer "ver más".
 */
function primeraFrase(raw: string, max = 190): { texto: string; hayMas: boolean } {
  const s = (raw || "").replace(/\s+/g, " ").trim();
  if (s.length <= max) return { texto: s, hayMas: false };
  const punto = s.search(/[.!?](\s|$)/);
  if (punto > 0 && punto + 1 <= max) return { texto: s.slice(0, punto + 1), hayMas: true };
  const espacio = s.lastIndexOf(" ", max);
  return { texto: `${s.slice(0, espacio > 60 ? espacio : max).trimEnd()}…`, hayMas: true };
}

// Origen crudo (normalizado) → cómo lo dice el cliente. Un origen que no esté
// acá se muestra tal como vino.
const ORIGEN: Record<string, { filtro: string; plural: string }> = {
  "propia": { filtro: "Hechas para vos", plural: "hechas para vos" },
  "de fabrica": { filtro: "Vienen con el motor", plural: "vienen con el motor" },
};

type Skill = {
  key: string;
  nombre: string;       // legible, para mostrar
  resumen: string | null;
  origen: string;       // normalizado, para comparar
  origenCrudo: string;
  propia: boolean;
  cat: string;          // "" = sin categoría → "General"
  busca: string;        // todo junto y sin tildes, para el buscador
};

type Conexion = { key: string; nombre: string; detalle: string };

const GENERAL = "General";

function Caption({ children }: { children: ReactNode }) {
  return (
    <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-soft/70">
      {children}
    </span>
  );
}

function FiltroChip({ activo, onClick, count, children }: {
  activo: boolean;
  onClick: () => void;
  count?: number;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={activo}
      className={`inline-flex max-w-full items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold transition ${
        activo
          ? "bg-ink text-white"
          : "bg-black/[0.05] text-ink-soft hover:bg-black/[0.08] hover:text-ink"
      }`}
    >
      <span className="min-w-0 truncate">{children}</span>
      {count !== undefined && (
        <span className={`shrink-0 tabular-nums ${activo ? "text-white/60" : "text-ink-soft/60"}`}>
          {count}
        </span>
      )}
    </button>
  );
}

function SectionTitle({ icon: Icon, title, hint }: {
  icon: LucideIcon; title: string; hint?: string;
}) {
  return (
    <div className="mb-3 flex items-start gap-2.5">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-black/[0.04]">
        <Icon className="h-3.5 w-3.5 text-ink-soft" />
      </div>
      <div className="min-w-0">
        <h2 className="text-sm font-bold tracking-tight text-ink">{title}</h2>
        {hint && <p className="mt-0.5 text-[13px] leading-snug text-ink-soft">{hint}</p>}
      </div>
    </div>
  );
}

/** Tarjeta de conexión: extensión del motor o servidor MCP. */
function ConexionCard({ c, icon: Icon }: { c: Conexion; icon: LucideIcon }) {
  const [abierto, setAbierto] = useState(false);
  const { texto, hayMas } = useMemo(() => primeraFrase(c.detalle), [c.detalle]);
  return (
    <Card>
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-c-violet">
          <Icon className="h-3.5 w-3.5 text-c-violet-ink" />
        </div>
        <div className="min-w-0">
          <p className="break-words text-sm font-semibold text-ink">{c.nombre}</p>
          {texto && (
            <p className="mt-0.5 break-words text-[13px] leading-snug text-ink-soft">
              {abierto ? c.detalle : texto}
            </p>
          )}
          {hayMas && (
            <button
              onClick={() => setAbierto((v) => !v)}
              className="mt-1 text-[12px] font-semibold text-primary transition hover:text-primary-dark"
            >
              {abierto ? "Ver menos" : "Ver más"}
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}

export default function CapacidadesPage() {
  const [cfg, setCfg] = useState<PortalConfig | null>(null);
  const [data, setData] = useState<Capabilities | null>(null);
  const [err, setErr] = useState<Falla | null>(null);
  const [cargando, setCargando] = useState(false);
  const [ultima, setUltima] = useState<Date | null>(null);

  const [q, setQ] = useState("");
  const [origen, setOrigen] = useState<string | null>(null); // origen normalizado
  const [cat, setCat] = useState<string | null>(null);       // null = todas, "" = General

  useEffect(() => { setCfg(loadConfig()); }, []);

  // silent: el refresh automático no vacía la pantalla ni tapa con un error
  // datos que todavía sirven; a lo sumo avisa arriba.
  const load = useCallback((silent = false) => {
    if (!cfg) return;
    if (!silent) { setData(null); setErr(null); }
    setCargando(true);
    getCapabilities(cfg)
      .then((r) => {
        setData(r && typeof r === "object" ? r : { skills: [], plugins: [], mcp: [] });
        setErr(null);
        setUltima(new Date());
      })
      .catch((e: HttpError) => setErr({ status: e?.status, message: e?.message || "error" }))
      .finally(() => setCargando(false));
  }, [cfg]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!cfg) return;
    const t = setInterval(() => load(true), REFRESH_MS);
    return () => clearInterval(t);
  }, [cfg, load]);

  const skills = useMemo<Skill[]>(() => {
    const crudas = Array.isArray(data?.skills) ? data!.skills : [];
    return crudas
      .filter((s): s is Capability => Boolean(s) && typeof s?.name === "string" && s.name.trim() !== "")
      .map((s, i) => {
        const o = norm(String(s.origen ?? ""));
        const nombre = legible(s.name);
        const cat = typeof s.categoria === "string" ? s.categoria.trim() : "";
        return {
          key: `${s.name}-${i}`,
          nombre,
          resumen: resumir(s.summary),
          origen: o,
          origenCrudo: String(s.origen ?? "").trim(),
          propia: o === "propia",
          cat,
          busca: norm([s.name, nombre, s.summary ?? "", cat, legible(cat)].join(" ")),
        };
      })
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  }, [data]);

  // Orígenes que realmente vinieron, con las propias adelante.
  const origenes = useMemo(() => {
    const vistos = new Map<string, { key: string; filtro: string; plural: string }>();
    for (const s of skills) {
      if (vistos.has(s.origen)) continue;
      const meta = ORIGEN[s.origen];
      const crudo = s.origenCrudo || "sin clasificar";
      vistos.set(s.origen, {
        key: s.origen,
        filtro: meta?.filtro ?? legible(crudo),
        plural: meta?.plural ?? crudo,
      });
    }
    return Array.from(vistos.values()).sort((a, b) =>
      a.key === "propia" ? -1 : b.key === "propia" ? 1 : a.filtro.localeCompare(b.filtro, "es"));
  }, [skills]);

  // Categorías presentes; la bolsa sin categoría ("General") va al final.
  const categorias = useMemo(() => {
    const vistas = new Set(skills.map((s) => s.cat));
    return Array.from(vistas).sort((a, b) => {
      if (!a) return 1;
      if (!b) return -1;
      return legible(a).localeCompare(legible(b), "es");
    });
  }, [skills]);

  // Búsqueda primero: sobre esa base se cuentan los chips.
  const base = useMemo(() => {
    const needle = norm(q);
    return needle ? skills.filter((s) => s.busca.includes(needle)) : skills;
  }, [skills, q]);

  const porCat = useMemo(
    () => (cat === null ? base : base.filter((s) => s.cat === cat)),
    [base, cat],
  );
  const porOrigen = useMemo(
    () => (origen === null ? base : base.filter((s) => s.origen === origen)),
    [base, origen],
  );
  const visibles = useMemo(
    () => base.filter((s) =>
      (origen === null || s.origen === origen) && (cat === null || s.cat === cat)),
    [base, origen, cat],
  );

  // Las hechas para vos adelante; el resto agrupado por categoría.
  const grupos = useMemo(() => {
    const out: { key: string; label: string; hint?: string; items: Skill[] }[] = [];
    const propias = visibles.filter((s) => s.propia);
    if (propias.length > 0) {
      out.push({
        key: "__propias",
        label: "Hechas para vos",
        hint: "Las armamos para tu operación",
        items: propias,
      });
    }
    const resto = new Map<string, Skill[]>();
    for (const s of visibles) {
      if (s.propia) continue;
      const arr = resto.get(s.cat);
      if (arr) arr.push(s);
      else resto.set(s.cat, [s]);
    }
    const claves = Array.from(resto.keys()).sort((a, b) => {
      if (!a) return 1;
      if (!b) return -1;
      return legible(a).localeCompare(legible(b), "es");
    });
    for (const c of claves) {
      out.push({ key: c || "__general", label: c ? legible(c) : GENERAL, items: resto.get(c)! });
    }
    return out;
  }, [visibles]);

  const plugins = useMemo<Conexion[]>(() => {
    const crudos = Array.isArray(data?.plugins) ? data!.plugins : [];
    return crudos
      .filter((p) => Boolean(p) && typeof p?.name === "string" && p.name.trim() !== "")
      .map((p, i) => ({
        key: `${p.name}-${i}`,
        nombre: legible(p.name),
        detalle: resumir(p.summary) ?? "",
      }));
  }, [data]);

  const mcp = useMemo<Conexion[]>(() => {
    const crudos = Array.isArray(data?.mcp) ? data!.mcp : [];
    return crudos
      .filter((m) => Boolean(m) && typeof m?.name === "string" && m.name.trim() !== "")
      .map((m, i) => ({
        key: `${m.name}-${i}`,
        nombre: legible(m.name),
        detalle: resumir(m.detalle) ?? "",
      }));
  }, [data]);

  const filtrando = q.trim() !== "" || origen !== null || cat !== null;
  const limpiar = () => { setQ(""); setOrigen(null); setCat(null); };

  // "23 habilidades · 9 hechas para vos · 14 vienen con el motor"
  const resumenSkills = useMemo(() => {
    if (skills.length === 0) return null;
    const partes = [`${skills.length} ${skills.length === 1 ? "habilidad" : "habilidades"}`];
    for (const o of origenes) {
      const n = skills.filter((s) => s.origen === o.key).length;
      if (n > 0) partes.push(`${n} ${o.plural}`);
    }
    return partes.join(" · ");
  }, [skills, origenes]);

  const cuerpo = () => {
    if (err && data === null) {
      // Agente con adapter viejo: el portal está bien, la pantalla todavía no
      // tiene de dónde leer.
      if (es404(err)) {
        return (
          <>
            <EmptyState
              icon={Puzzle}
              title="Este agente todavía no expone sus capacidades"
              hint="Corre una versión del conector anterior a esta pantalla. Cuando lo actualicemos, vas a ver acá todo lo que sabe hacer y a qué está conectado."
            />
            <div className="flex justify-center">
              <Btn kind="ghost" size="sm" onClick={() => load()}>Reintentar</Btn>
            </div>
          </>
        );
      }
      return <ErrorState message={err.message} onRetry={() => load()} />;
    }
    if (!data) return <Spinner />;

    return (
      <>
        <section>
          <SectionTitle
            icon={Sparkles}
            title="Qué sabe hacer"
            hint={resumenSkills ?? undefined}
          />

          {skills.length === 0 ? (
            <EmptyState
              icon={Sparkles}
              title="Tu agente todavía no declara habilidades"
              hint="Cuando le sumemos la primera, la vas a ver listada acá."
            />
          ) : (
            <>
              <div className="mb-4 flex flex-col gap-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative w-full sm:w-72">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft/60" />
                    <input
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Escape") setQ(""); }}
                      placeholder="Buscar una habilidad…"
                      className={`${inputCls} pl-8 pr-8`}
                    />
                    {q && (
                      <button
                        aria-label="Limpiar búsqueda"
                        onClick={() => setQ("")}
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-ink-soft transition hover:text-ink"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  {filtrando && (
                    <Btn kind="ghost" size="sm" onClick={limpiar}>Limpiar filtros</Btn>
                  )}
                </div>

                {origenes.length > 1 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Caption>Origen</Caption>
                    <FiltroChip activo={origen === null} onClick={() => setOrigen(null)} count={porCat.length}>
                      Todas
                    </FiltroChip>
                    {origenes.map((o) => (
                      <FiltroChip
                        key={o.key}
                        activo={origen === o.key}
                        onClick={() => setOrigen(origen === o.key ? null : o.key)}
                        count={porCat.filter((s) => s.origen === o.key).length}
                      >
                        {o.filtro}
                      </FiltroChip>
                    ))}
                  </div>
                )}

                {categorias.length > 1 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Caption>Categoría</Caption>
                    <FiltroChip activo={cat === null} onClick={() => setCat(null)} count={porOrigen.length}>
                      Todas
                    </FiltroChip>
                    {categorias.map((c) => (
                      <FiltroChip
                        key={c || "__general"}
                        activo={cat === c}
                        onClick={() => setCat(cat === c ? null : c)}
                        count={porOrigen.filter((s) => s.cat === c).length}
                      >
                        {c ? legible(c) : GENERAL}
                      </FiltroChip>
                    ))}
                  </div>
                )}
              </div>

              {visibles.length === 0 ? (
                <>
                  <EmptyState
                    icon={Search}
                    title="Ninguna habilidad coincide"
                    hint="Probá con otra palabra o sacá los filtros."
                  />
                  <div className="flex justify-center">
                    <Btn kind="ghost" size="sm" onClick={limpiar}>Limpiar filtros</Btn>
                  </div>
                </>
              ) : (
                <div className="flex flex-col gap-5">
                  {grupos.map((g) => (
                    <div key={g.key}>
                      <div className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-1">
                        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
                          {g.label}
                        </h3>
                        <span className="text-[11px] tabular-nums text-ink-soft/70">
                          {g.items.length}
                        </span>
                        {g.hint && (
                          <span className="text-[11px] text-ink-soft/70">· {g.hint}</span>
                        )}
                      </div>
                      <Card className="overflow-hidden !p-0">
                        <ul className="divide-y divide-black/[0.06]">
                          {g.items.map((s) => (
                            <li key={s.key} className="px-4 py-3">
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                <p className="break-words text-sm font-semibold text-ink">
                                  {s.nombre}
                                </p>
                                {/* En el grupo de las propias el rótulo útil es la
                                    categoría; en los de categoría, un origen que no
                                    sea "de fábrica" (nunca se repite lo obvio). */}
                                {s.propia
                                  ? s.cat && <Chip tone="violet">{legible(s.cat)}</Chip>
                                  : s.origen !== "de fabrica" && s.origenCrudo !== "" && (
                                    <Chip>{legible(s.origenCrudo)}</Chip>
                                  )}
                              </div>
                              {s.resumen && (
                                <p className="mt-0.5 break-words text-[13px] leading-snug text-ink-soft">
                                  {s.resumen}
                                </p>
                              )}
                            </li>
                          ))}
                        </ul>
                      </Card>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </section>

        <section className="mt-8">
          <SectionTitle
            icon={Network}
            title="Conexiones"
            hint="Las extensiones y los sistemas externos que tu agente tiene habilitados. Desde el portal no se instala ni se conecta nada: cada conexión la configuramos y la auditamos nosotros."
          />

          {/* Sin nada conectado no dibujamos cajas vacías: una línea honesta
              dice más que dos secciones en blanco. */}
          {plugins.length === 0 && mcp.length === 0 ? (
            <p className="px-1 text-[13px] leading-snug text-ink-soft">
              Todavía no hay extensiones ni sistemas externos conectados: hoy tu agente trabaja
              con lo suyo. Cuando necesites que entre a una herramienta tuya, la conexión la
              configuramos nosotros.
            </p>
          ) : (
            <>
              {plugins.length > 0 && (
                <div className="mb-5">
                  <div className="mb-2 flex flex-wrap items-baseline gap-x-2 px-1">
                    <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
                      Extensiones del motor
                    </h3>
                    <span className="text-[11px] tabular-nums text-ink-soft/70">{plugins.length}</span>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {plugins.map((p) => <ConexionCard key={p.key} c={p} icon={Plug} />)}
                  </div>
                </div>
              )}

              <div>
                <div className="mb-2 flex flex-wrap items-baseline gap-x-2 px-1">
                  <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
                    Sistemas externos
                  </h3>
                  {mcp.length > 0 && (
                    <span className="text-[11px] tabular-nums text-ink-soft/70">{mcp.length}</span>
                  )}
                </div>
                {mcp.length > 0 ? (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {mcp.map((m) => <ConexionCard key={m.key} c={m} icon={Network} />)}
                  </div>
                ) : (
                  <p className="px-1 text-[13px] leading-snug text-ink-soft">
                    Todavía no hay sistemas externos conectados: hoy tu agente trabaja con lo suyo.
                    Cuando necesites que entre a una herramienta tuya, la conexión la configuramos
                    nosotros.
                  </p>
                )}
              </div>
            </>
          )}
        </section>
      </>
    );
  };

  return (
    <div className={WRAP}>
      <PageHeader
        title="Capacidades"
        subtitle={SUBTITULO}
        actions={
          <>
            {ultima && (
              <span className="hidden text-xs tabular-nums text-ink-soft sm:inline">
                Actualizado{" "}
                {ultima.toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit", hour12: false })}
              </span>
            )}
            <IconBtn label="Actualizar" disabled={cargando} onClick={() => load(true)}>
              <RefreshCw className={`h-4 w-4 ${cargando ? "animate-spin" : ""}`} />
            </IconBtn>
          </>
        }
      />

      {err && data !== null && (
        <p className="mb-4 inline-flex items-center rounded-lg border border-c-coral bg-c-coral/40 px-3 py-1.5 text-[12px] font-medium text-c-coral-ink">
          No pude actualizar recién ({err.message}). Te muestro lo último que tengo.
        </p>
      )}

      {cuerpo()}
    </div>
  );
}
