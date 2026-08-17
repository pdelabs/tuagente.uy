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
import { horaDe } from "../lib/palabras";
import {
  CopiarLink, PARAM, abrirEnRuta, cerrarEnRuta, traerALaVista, useParamRuta,
} from "../lib/rutas";

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

// Palabras funcionales inglesas que no existen en castellano rioplatense. Dos
// juntas no salen de un texto escrito en Montevideo.
const PALABRAS_INGLESAS =
  /\b(the|and|or|when|with|from|your|you|use|used|using|create|creates|read|edit|write|writes|extract|convert|merge|split|fill|secure|into|file|files|document|documents|template|templates|spreadsheet|spreadsheets|scan|scans|text|image|images|tool|tools)\b/gi;

/** ¿Este resumen está escrito para el CLIENTE, o es la ficha del motor?
 *
 *  Una skill tiene dos audiencias y un solo archivo: `description` le dice AL
 *  AGENTE cuándo usarla (en inglés, en imperativo, nombrando librerías) y
 *  `para_cliente` le dice AL CLIENTE qué consigue. El adapter arma el `summary`
 *  con el segundo y CAE AL PRIMERO cuando no está
 *  (`hermes-kit/adapter/portal_adapter.py:429`). Así llegaban a esta pantalla
 *  —medido contra el agente del lab, 16 habilidades— cosas como "Create, read,
 *  edit Word .docx documents and templates." o "Extract text from PDFs/scans
 *  (pymupdf, marker-pdf)": la vitrina de lo que el agente sabe hacer, escrita
 *  para el que lo programó.
 *
 *  Se decide con dos señales del propio dato, ninguna inventada acá:
 *
 *  1. `label` es el `titulo` del frontmatter, el nombre en criollo. Se escribe
 *     junto con `para_cliente` —son los dos campos nuestros de la misma ficha—,
 *     así que su ausencia dice que el resumen es el `description` del motor.
 *     Vale sólo si el adapter conoce los títulos (≥0.23): contra uno viejo, que
 *     no manda ninguno, esta señal apagaría TODOS los resúmenes.
 *  2. el inglés, por si alguna skill trae `titulo` y no `para_cliente`.
 *
 *  Traducir acá a mano sería inventar un diccionario que se desincroniza con el
 *  kit en el primer cambio. Lo que falta del lado del agente va como pedido al
 *  kit; mientras tanto, la tarjeta muestra el nombre y se calla. */
function escritoParaElCliente(
  s: { resumen: string | null; label: string }, adapterConTitulos: boolean,
): boolean {
  if (!s.resumen) return false;
  if (adapterConTitulos && !s.label) return false;
  return (s.resumen.match(PALABRAS_INGLESAS) ?? []).length < 2;
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
      // Red de seguridad: si igual llegamos acá con una que el adapter no
      // sirve, el cliente NO lee «esa habilidad no existe o no es editable»
      // sobre algo que la pantalla acaba de decirle que se edita.
      .catch((e: HttpError) => {
        if (!vivo) return;
        setErr(e?.status === 404
          ? "Esta habilidad no se puede editar desde acá. Escribinos y la cambiamos nosotros."
          : e.message || "No pude abrir la habilidad.");
      });
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
  // A qué habilidad apunta la URL (`?habilidad=<nombre>`). El nombre ES legible
  // ("armado-de-reportes"), así que el link se entiende solo.
  //
  // OJO: apuntar no es lo mismo que EDITAR. Las del sistema no tienen texto que
  // mostrar —el adapter solo sirve el contenido de las editables, el resto da
  // 404— así que el link a una de ellas la trae a la vista y la resalta, que es
  // toda la información que existe. Antes el parámetro no hacía absolutamente
  // nada con ellas, que son las únicas que tiene un agente recién instalado: el
  // link caía en la portada sin decir palabra.
  const elegida = useParamRuta(PARAM.habilidad);
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
    const limpias = crudas.filter(
      (s): s is Capability => Boolean(s) && typeof s?.name === "string" && s.name.trim() !== "");
    // ¿El adapter conoce los títulos en criollo? (≥0.23). Si no manda ninguno
    // es viejo, no que las skills no tengan ficha: ver `escritoParaElCliente`.
    const adapterConTitulos = limpias.some((s) => (s.label || "").trim() !== "");
    return limpias
      // LAS `sin-…` NO SON HABILIDADES: SON LA FALTA DE UNA. `sin-busqueda-web`
      // y `sin-imagenes` son el instructivo que lee el agente cuando le piden
      // algo que no puede hacer ("qué entregar, cómo decirlo sin maquillarlo").
      // En la vitrina de lo que sabe hacer salían como "Cuando no podés buscar
      // en internet", que fue textual lo que la clienta de prueba señaló como
      // escrito para el que lo programó. Lo que SÍ le sirve saber —que se puede
      // prender la búsqueda web— es el catálogo de capacidades, que tiene su
      // propia tarjeta y su propio texto.
      .filter((s) => !(norm(String(s.origen ?? "")) === "tuagente" && /^sin-/.test(s.name)))
      .map((s) => {
        const label = (s.label || "").trim();
        const resumen = resumir(s.summary);
        return {
        name: s.name,
        nombre: label || legible(s.name),
        resumen: escritoParaElCliente({ resumen, label }, adapterConTitulos) ? resumen : null,
        // SOLO un `editable: true` explícito. Antes, si el campo faltaba, se
        // deducía de `origen === "propia"` — y hay habilidades propias que el
        // adapter NO puede editar: las que viven adentro de una carpeta de
        // categoría (`skills/contenido/contenido-para-redes/`) se listan como
        // propias pero sin `editable`, y `GET /portal/skills/{name}` sólo
        // resuelve las de primer nivel. Resultado: la pantalla decía "esta la
        // podés editar", el botón Editar aparecía, y al tocarlo contestaba
        // «esa habilidad no existe o no es editable», que es la máquina
        // desdiciéndose a sí misma en la cara del cliente. Deducir de menos
        // (no ofrecer editar algo editable) es un botón que falta; deducir de
        // más es una promesa rota.
        editable: s.editable === true,
        origen: norm(String(s.origen ?? "")),
        cat: typeof s.categoria === "string" ? s.categoria.trim() : "",
        };
      })
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  }, [data]);

  // DE QUIÉN ES una habilidad y SI SE PUEDE EDITAR son dos preguntas, y acá
  // eran la misma (`propias = las editables`). Hay habilidades hechas para este
  // cliente que el adapter no sirve para editar —las que viven adentro de una
  // carpeta de categoría—: metiéndolas en "Comunes del sistema" se arreglaba el
  // botón roto diciendo otra mentira, que no son suyas. Se agrupan por origen y
  // el botón Editar aparece sólo donde de verdad se puede.
  const propias = useMemo(() => skills.filter((s) => s.origen === "propia"), [skills]);
  const sistema = useMemo(() => skills.filter((s) => s.origen !== "propia"), [skills]);

  const habilidadElegida = useMemo(
    () => (elegida ? skills.find((s) => s.name === elegida) ?? null : null), [elegida, skills]);
  // El editor abre solo para las que se pueden editar.
  const editando = habilidadElegida?.editable ? habilidadElegida.name : null;

  // Si la que viene por link vive en el cajón cerrado, el cajón se abre. Va por
  // efecto y no derivado para que el cliente después la pueda volver a plegar.
  useEffect(() => {
    if (habilidadElegida && habilidadElegida.origen !== "propia") setVerSistema(true);
  }, [habilidadElegida]);

  // Y se la trae a la vista — mismo helper que Conexiones. Antes era un
  // `setTimeout` de 150 ms con scroll suave y NO TRAÍA NADA: la fila quedaba a
  // 823 px con la ventana en 813 y `scrollY` en 0, o sea justo abajo del
  // pliegue. El porqué (y por qué ahora va `instant`) está en `traerALaVista`.
  //
  // Las dependencias son el NOMBRE y un booleano, no el objeto: la lista se
  // refresca sola cada minuto y con el objeto en las deps el efecto volvía a
  // correr en cada refresco. Con el scroll suave eso no se notaba (no movía
  // nada); ahora que mueve, sería la página saltando sola cada 60 segundos
  // mientras el cliente lee otra cosa.
  const hayElegida = Boolean(habilidadElegida);
  useEffect(() => {
    if (!hayElegida) return;
    return traerALaVista(".habilidad-elegida");
  }, [elegida, hayElegida, verSistema]);

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
        {/* Un link a una habilidad que ya no está (la renombramos, la sacamos)
            no puede quedar en silencio: el cliente aprieta y no pasa nada. */}
        {elegida && !habilidadElegida && (
          <p className="mb-4 rounded-lg border border-c-amber bg-c-amber/25 px-3 py-2 text-[13px] leading-snug text-c-amber-ink">
            No encontré la habilidad que buscabas. Puede que le hayamos cambiado el nombre
            o que ya no esté; abajo está todo lo que tu agente sabe hacer hoy.
          </p>
        )}

        <section>
          <div className="mb-3">
            <h2 className="text-sm font-bold tracking-tight text-ink">Hechas para vos</h2>
            {/* El texto prometía editar TODAS. Las que tienen Editar se
                cambian acá; las otras se piden igual que cualquier cambio. */}
            <p className="mt-0.5 text-[13px] leading-snug text-ink-soft">
              Las armamos para tu operación, y son tuyas: si querés que algo se haga
              distinto, decíselo a tu agente por el chat. Las que dicen Editar las podés
              cambiar acá mismo, y los cambios los toma solo en unos minutos.
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
                <Card
                  key={s.name}
                  className={elegida === s.name
                    ? "habilidad-elegida ring-2 ring-primary/25" : ""}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <p className="break-words text-sm font-semibold text-ink">{s.nombre}</p>
                        {s.cat && <Chip tone="violet">{categoriaEs(s.cat)}</Chip>}
                        {editando === s.name && (
                          <CopiarLink titulo="Copiar el link de esta habilidad" />
                        )}
                      </div>
                      {s.resumen && (
                        <p className="mt-0.5 break-words text-[13px] leading-snug text-ink-soft">
                          {s.resumen}
                        </p>
                      )}
                    </div>
                    {/* Sólo donde de verdad se puede: un botón que contesta
                        "esa habilidad no existe o no es editable" sobre algo
                        que la pantalla dice que es tuyo es peor que no
                        ofrecerlo. */}
                    {cfg && s.editable && editando !== s.name && (
                      <Btn
                        kind="ghost"
                        size="sm"
                        onClick={() => abrirEnRuta({ [PARAM.habilidad]: s.name })}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Editar
                      </Btn>
                    )}
                  </div>
                  {cfg && editando === s.name && (
                    <EditorSkill
                      cfg={cfg}
                      name={s.name}
                      onCerrar={() => cerrarEnRuta(PARAM.habilidad)}
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
                        {g.items.map((s) => {
                          // La que vino por link: resaltada y con su propio
                          // link a mano. No hay editor porque no hay qué
                          // editar; decirlo es más honesto que un panel vacío.
                          const señalada = elegida === s.name;
                          return (
                            <li
                              key={s.name}
                              className={`px-4 py-3 ${
                                señalada ? "habilidad-elegida bg-c-violet/40" : ""}`}
                            >
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                <p className="break-words text-sm font-semibold text-ink">
                                  {s.nombre}
                                </p>
                                {señalada && (
                                  <CopiarLink titulo="Copiar el link de esta habilidad" />
                                )}
                              </div>
                              {s.resumen && (
                                <p className="mt-0.5 break-words text-[13px] leading-snug text-ink-soft">
                                  {s.resumen}
                                </p>
                              )}
                              {señalada && (
                                <p className="mt-1.5 text-[12px] leading-snug text-ink-soft/80">
                                  Esta viene con el sistema y es igual para todos: la mantenemos
                                  nosotros y no se edita. Si querés que tu agente trabaje distinto,
                                  decíselo por el chat.
                                </p>
                              )}
                            </li>
                          );
                        })}
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
            {/* Un solo reloj en todo el portal: el del negocio. Es la misma
                hora que muestran Inicio, Actividad y Artefactos en este mismo
                sello — que dos pestañas contesten distinto a "¿de cuándo es
                esto?" es exactamente lo que estamos sacando. */}
            {ultima && (
              <span className="hidden text-xs tabular-nums text-ink-soft sm:inline">
                Actualizado {horaDe(ultima.getTime())}
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
