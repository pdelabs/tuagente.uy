"use client";

// Habilidades: qué sabe hacer el agente, con las hechas para el cliente al
// frente — y editables. Reescrita el 6/8 a pedido de Luis: sin buscador, sin
// filtros, sin ícono decorativo, y SIN la sección de plugins/MCP — eso contaba
// la misma historia que la pestaña Conexiones con vocabulario de motor, y
// tener dos versiones de "a qué está conectado" confundía más de lo que sumaba.
//
// Contrato (adapter ≥0.21): GET {adapter}/portal/capabilities →
//   { skills: [{ name, summary, origen, categoria?, editable? }] }
//   GET  /portal/skills/{name} → { name, content }   (solo las nuestras)
//   POST /portal/skills/{name} { content }           (idem)
//
// DECISIÓN DE PRODUCTO: editar una habilidad propia es editar cómo trabaja el
// agente — el archivo es la especificación viva que el agente relee solo. Por
// eso acá SÍ hay edición (a diferencia de conexiones, que se instalan y
// auditan del lado nuestro): el texto es del cliente, la mecánica es nuestra.

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, Pencil, Puzzle, RefreshCw } from "lucide-react";
import {
  getCapabilities, getSkillContent, loadConfig, saveSkill,
  type Capabilities, type Capability, type HttpError, type PortalConfig,
} from "../lib/agent";
import {
  Btn, Card, Chip, EmptyState, ErrorState, IconBtn, PageHeader, Spinner,
} from "../lib/ui";

type Falla = { status?: number; message: string };

const WRAP = "mx-auto max-w-5xl px-6 py-6 md:px-8";
const REFRESH_MS = 60_000;
const GENERAL = "General";

// Las categorías vienen del motor y están en inglés ("productivity",
// "autonomous-ai-agents", "email"): en una pantalla que por lo demás habla en
// uruguayo, quedaban como títulos gritados en otro idioma. Lo que no está acá
// se muestra como viene: preferimos una palabra rara a esconder un grupo nuevo.
const CATEGORIA_ES: Record<string, string> = {
  productivity: "Documentos y planillas",
  "autonomous-ai-agents": "Programación",
  email: "Correo",
  research: "Investigación",
  "sales-ops": "Ventas",
  data: "Datos",
  media: "Audio, video e imágenes",
  web: "Web",
};
const categoriaEs = (c: string) => CATEGORIA_ES[(c || "").toLowerCase()] ?? legible(c);

const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

const es404 = (f: Falla) => f.status === 404 || /^404\b/.test(f.message);

// Siglas y extensiones que en minúscula se leen como un error de tipeo.
const SIGLAS = new Set([
  "pdf", "xlsx", "docx", "pptx", "csv", "tsv", "ocr", "api", "url", "sql", "html",
  "css", "json", "yaml", "xml", "cli", "sdk", "ui", "ux", "ai", "ia", "crm", "erp",
  "imap", "smtp", "sms", "mcp", "id", "qr", "http", "https", "rss", "vpn", "gpt",
]);

/** `armado-de-reportes` → "Armado de reportes". Lo ya legible no se toca. */
function legible(raw: string): string {
  const name = (raw || "").trim();
  if (!name || /[A-Z\s]/.test(name)) return name;
  const partes = name.split(/[-_]+/).filter(Boolean);
  if (partes.length === 0) return name;
  const palabras = partes.map((p) => (SIGLAS.has(p) ? p.toUpperCase() : p));
  palabras[0] = palabras[0].charAt(0).toUpperCase() + palabras[0].slice(1);
  return palabras.join(" ");
}

/** Summaries rotos o cortados por el motor: sin texto útil no se muestra nada. */
function resumir(raw?: string): string | null {
  const s = (raw || "").replace(/\s+/g, " ").trim();
  if (!s || !/[a-z0-9]/.test(norm(s))) return null;
  const cortado = s.length > 50 && !/[.!?…:;)\]"']$/.test(s);
  return cortado ? `${s}…` : s;
}

type Skill = {
  name: string;       // crudo: es la clave del endpoint de edición
  nombre: string;     // legible
  resumen: string | null;
  editable: boolean;
  /** "tuagente" = del producto (sostienen pantallas del portal, comunes a
   *  todos los clientes); van al grupo del sistema, sin edición. */
  origen: string;
  cat: string;
};

/** El archivo tiene dos partes: el encabezado YAML (ficha técnica — la
 *  mantenemos nosotros) y el cuerpo (la especificación — del cliente). El
 *  editor muestra SOLO el cuerpo: el encabezado se guarda aparte y se vuelve a
 *  pegar al guardar, así el cliente nunca ve maquinaria ni puede romperla. */
function separar(content: string): { encabezado: string; cuerpo: string } {
  const m = content.match(/^(---\n[\s\S]*?\n---\n?)([\s\S]*)$/);
  return m ? { encabezado: m[1], cuerpo: m[2] } : { encabezado: "", cuerpo: content };
}

/** Editor inline de una habilidad propia. El contenido se carga al abrir. */
function EditorSkill({ cfg, name, onCerrar, onGuardada }: {
  cfg: PortalConfig; name: string; onCerrar: () => void; onGuardada: () => void;
}) {
  const [encabezado, setEncabezado] = useState("");
  const [contenido, setContenido] = useState<string | null>(null);
  // El texto tal como estaba al abrir: sin esto, editar es un camino de ida.
  const [original, setOriginal] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [listo, setListo] = useState(false);

  useEffect(() => {
    let vivo = true;
    getSkillContent(cfg, name)
      .then((r) => {
        if (!vivo) return;
        const { encabezado: enc, cuerpo } = separar(r.content);
        setEncabezado(enc);
        setContenido(cuerpo);
        setOriginal(cuerpo);
      })
      .catch((e: HttpError) => { if (vivo) setErr(e.message || "No pude abrir la habilidad."); });
    return () => { vivo = false; };
  }, [cfg, name]);

  const guardar = () => {
    if (contenido === null) return;
    setGuardando(true);
    setErr(null);
    saveSkill(cfg, name, encabezado + contenido)
      .then(() => { setListo(true); onGuardada(); })
      .catch((e: HttpError) => setErr(e.message || "No se pudo guardar."))
      .finally(() => setGuardando(false));
  };

  if (err && contenido === null) {
    return <p className="mt-2 text-[13px] text-c-coral-ink">{err}</p>;
  }
  if (contenido === null) return <div className="mt-3"><Spinner /></div>;

  const sucio = original !== null && contenido !== original;

  return (
    <div className="mt-3">
      {/* Esto cambia cómo trabaja el agente. Decirlo antes, no después: un
          cliente de prueba vio el botón "Editar" y no lo tocó por miedo a
          romper algo sin vuelta atrás. Ahora la vuelta atrás existe. */}
      <p className="mb-2 rounded-lg border border-c-amber bg-c-amber/25 px-3 py-2 text-[12px] leading-relaxed text-c-amber-ink">
        Esto es la instrucción que sigue tu agente para esta habilidad. Si lo cambiás,
        cambia cómo trabaja. Podés volver a como estaba mientras no cierres, y si algo
        queda raro, escribinos y lo dejamos como antes.
      </p>
      <textarea
        value={contenido}
        onChange={(e) => { setContenido(e.target.value); setListo(false); }}
        spellCheck={false}
        className="h-80 w-full resize-y rounded-lg border border-black/[0.1] bg-white p-3 font-mono text-[12px] leading-relaxed text-ink outline-none transition focus:border-primary/50"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Btn size="sm" onClick={guardar} disabled={guardando || !contenido.trim()}>
          {guardando ? "Guardando…" : "Guardar"}
        </Btn>
        {sucio && (
          <Btn kind="ghost" size="sm" onClick={() => { setContenido(original); setListo(false); }}>
            Volver a como estaba
          </Btn>
        )}
        <Btn kind="ghost" size="sm" onClick={onCerrar}>Cerrar</Btn>
        {listo && (
          <span className="text-[12px] font-medium text-c-green-ink">
            Guardado — tu agente lo toma solo en unos minutos.
          </span>
        )}
        {err && <span className="text-[12px] text-c-coral-ink">{err}</span>}
      </div>
    </div>
  );
}

export default function CapacidadesPage() {
  const [cfg, setCfg] = useState<PortalConfig | null>(null);
  const [data, setData] = useState<Capabilities | null>(null);
  const [err, setErr] = useState<Falla | null>(null);
  const [cargando, setCargando] = useState(false);
  const [ultima, setUltima] = useState<Date | null>(null);
  const [editando, setEditando] = useState<string | null>(null);
  const [verSistema, setVerSistema] = useState(false);

  useEffect(() => { setCfg(loadConfig()); }, []);

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
      .map((s) => ({
        name: s.name,
        nombre: (s.label || "").trim() || legible(s.name),
        resumen: resumir(s.summary),
        // Adapter viejo (<0.21) no manda `editable`: caemos a "origen propia",
        // y el editor avisará si el endpoint no está.
        editable: s.editable ?? norm(String(s.origen ?? "")) === "propia",
        origen: norm(String(s.origen ?? "")),
        cat: typeof s.categoria === "string" ? s.categoria.trim() : "",
      }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  }, [data]);

  const propias = useMemo(() => skills.filter((s) => s.editable), [skills]);
  const sistema = useMemo(() => skills.filter((s) => !s.editable), [skills]);

  // Las del sistema agrupadas: primero las del producto tuagente (sostienen
  // pantallas del portal), después las del motor por categoría.
  const gruposSistema = useMemo(() => {
    const grupos: { key: string; label: string; hint?: string; items: Skill[] }[] = [];
    const kit = sistema.filter((s) => s.origen === "tuagente");
    if (kit.length > 0) {
      grupos.push({
        key: "__tuagente",
        label: "De tuagente",
        hint: "Sostienen las pantallas de tu portal (entregas, aprobaciones, visualizaciones). Las mantenemos nosotros.",
        items: kit,
      });
    }
    const porCat = new Map<string, Skill[]>();
    for (const s of sistema) {
      if (s.origen === "tuagente") continue;
      const arr = porCat.get(s.cat);
      if (arr) arr.push(s);
      else porCat.set(s.cat, [s]);
    }
    for (const c of Array.from(porCat.keys()).sort((a, b) => {
      if (!a) return 1;
      if (!b) return -1;
      return legible(a).localeCompare(legible(b), "es");
    })) {
      grupos.push({ key: c || "__general", label: c ? categoriaEs(c) : GENERAL, items: porCat.get(c)! });
    }
    return grupos;
  }, [sistema]);

  const cuerpo = () => {
    if (err && data === null) {
      if (es404(err)) {
        return (
          <>
            <EmptyState
              icon={Puzzle}
              title="Este agente todavía no expone sus habilidades"
              hint="Corre una versión del conector anterior a esta pantalla. Cuando lo actualicemos, vas a ver acá todo lo que sabe hacer."
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
    if (skills.length === 0) {
      return (
        <EmptyState
          icon={Puzzle}
          title="Tu agente todavía no declara habilidades"
          hint="Cuando le sumemos la primera, la vas a ver listada acá."
        />
      );
    }

    return (
      <>
        <section>
          <div className="mb-3">
            <h2 className="text-sm font-bold tracking-tight text-ink">Hechas para vos</h2>
            <p className="mt-0.5 text-[13px] leading-snug text-ink-soft">
              Las armamos para tu operación, y son tuyas: si querés que algo se haga
              distinto, decíselo a tu agente por el chat — o editá el texto directo
              acá. Los cambios los toma solo, en unos minutos.
            </p>
          </div>

          {propias.length === 0 ? (
            <p className="px-1 text-[13px] leading-snug text-ink-soft">
              Todavía no armamos habilidades a medida para tu operación. La primera que
              instalemos va a aparecer acá.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {propias.map((s) => (
                <Card key={s.name}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <p className="break-words text-sm font-semibold text-ink">{s.nombre}</p>
                        {s.cat && <Chip tone="violet">{categoriaEs(s.cat)}</Chip>}
                      </div>
                      {s.resumen && (
                        <p className="mt-0.5 break-words text-[13px] leading-snug text-ink-soft">
                          {s.resumen}
                        </p>
                      )}
                    </div>
                    {cfg && editando !== s.name && (
                      <Btn kind="ghost" size="sm" onClick={() => setEditando(s.name)}>
                        <Pencil className="h-3.5 w-3.5" />
                        Editar
                      </Btn>
                    )}
                  </div>
                  {cfg && editando === s.name && (
                    <EditorSkill
                      cfg={cfg}
                      name={s.name}
                      onCerrar={() => setEditando(null)}
                      onGuardada={() => load(true)}
                    />
                  )}
                </Card>
              ))}
            </div>
          )}
        </section>

        {sistema.length > 0 && (
          <section className="mt-8">
            {/* Las del motor existen pero no compiten por atención: un renglón
                colapsado, no una pared de tarjetas. */}
            <button
              onClick={() => setVerSistema((v) => !v)}
              aria-expanded={verSistema}
              className="flex w-full items-center gap-2 rounded-lg px-1 py-1.5 text-left transition hover:bg-black/[0.03]"
            >
              <ChevronDown
                className={`h-4 w-4 shrink-0 text-ink-soft transition-transform ${verSistema ? "" : "-rotate-90"}`}
              />
              <span className="text-sm font-bold tracking-tight text-ink">
                Comunes del sistema
              </span>
              <span className="text-[12px] tabular-nums text-ink-soft">
                {sistema.length} habilidades
              </span>
              {!verSistema && (
                <span className="min-w-0 truncate text-[12px] text-ink-soft/80">
                  · entregas, aprobaciones, planillas, PDFs y más
                </span>
              )}
            </button>

            {verSistema && (
              <div className="mt-2 flex flex-col gap-5">
                {gruposSistema.map((g) => (
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
                          <li key={s.name} className="px-4 py-3">
                            <p className="break-words text-sm font-semibold text-ink">{s.nombre}</p>
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
          </section>
        )}
      </>
    );
  };

  return (
    <div className={WRAP}>
      <PageHeader
        title="Habilidades"
        subtitle="Lo que tu agente sabe hacer — y cómo lo hace"
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
