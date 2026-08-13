"use client";

// Pipeline — kanban de tickets del agente (GET {adapter}/portal/tickets)
// + detalle con comentarios (GET {adapter}/portal/tickets/{id}).
// Ya no es solo de lectura: el cliente crea tickets, comenta y mueve estados.
// GENÉRICO: títulos, tenants, estados, autores y eventos se muestran tal cual
// llegan; cero parseo de dominio. La prosa larga del agente (descripción y
// comentarios) viene en markdown y se dibuja con <Markdown> — el mismo renderer
// del chat, con HTML sanitizado. Las cards del tablero quedan en texto plano.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  Archive,
  Check,
  CircleCheck,
  CirclePause,
  Inbox,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  SearchX,
  Unlock,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  loadConfig,
  getTickets,
  getTicketDetail,
  esElCliente,
  esElSistema,
  esFrenoPorConexion,
  esPedidoDelCliente,
  leerComentario,
  rotuloAutor,
  type PortalConfig,
  type Ticket,
  type TicketComment,
  type TicketDetail,
  type TicketOutcome,
} from "../lib/agent";
import { loadAgentName } from "../lib/onboarding";
import {
  COLUMNAS_TABLERO, columnaDeTarea, esEventoDeMaquina, estadoDeTarea, horaDe,
  momentoDe, rotuloEvento, type ColumnaTarea, type Tono,
} from "../lib/palabras";
import { AgentitoAvatar, loadAgentLook } from "../lib/agentito";
import { CopiarLink, PARAM, abrirEnRuta, cerrarEnRuta, useParamRuta } from "../lib/rutas";
import {
  Btn,
  Chip,
  EmptyState,
  ErrorState,
  IconBtn,
  Modal,
  PageHeader,
  Spinner,
  inputCls,
} from "../lib/ui";
import Markdown from "../lib/Markdown";
import { EntityProvider } from "../lib/EntityViewer";
import { EntityChip } from "../lib/entities";

const REFRESH_MS = 30_000;
const SIN_TENANT = "__sin_tenant__"; // sentinel para tickets con tenant null

/* ── Autoría ─────────────────────────────────────────────────────────────── */

/** Con qué firma el portal lo que escribe el cliente. */
const AUTOR_PROPIO = "cliente";

// QUIÉN ES EL CLIENTE Y CÓMO SE ROTULA UN AUTOR LO DECIDE `lib/agent.ts`, y
// nadie más. Estaban acá, con su propio conjunto de autores propios y su propio
// `rotuloAutor`, y las dos cosas se desincronizaron con la lib: `user` era el
// cliente allá y no acá (el mismo renglón decía «user · Lo rechazaste»), y el
// rótulo bueno —el que resuelve el nombre de un tercero— existía sólo en esta
// pantalla mientras Aprobaciones, donde se autoriza, mostraba a un tercero como
// si fuera el agente.
const esPropio = esElCliente;
const rotuloDe = (author: string) => rotuloAutor(author, loadAgentName() || "Tu agente");

// Los eventos salen del diccionario único del portal (`lib/palabras.ts`): la
// misma palabra en el historial, en Actividad y en el chat. Acá había una
// tablita a medias y todo lo que no estaba salía crudo y en inglés —
// "commented", "dependency_wait", "tip_scratch_workspace" — en el medio de una
// pantalla en español.
const rotuloEventoTicket = (kind: string) =>
  rotuloEvento(kind, loadAgentName() || "Tu agente");

/* ── Escrituras del portal ───────────────────────────────────────────────────
   TODO: estas tres funciones DEBERÍAN GRADUARSE a ../lib/agent.ts, que es el
   único punto de red del portal. Viven acá porque lib/ la está tocando otro
   agente en paralelo. Al mover: son el mismo `post()` de la lib, con una
   diferencia que vale la pena conservar — leen el `{error}` del cuerpo para
   poder mostrárselo al cliente (la lib hoy tira solo el status). Contrato:
     POST /portal/tickets                {title, body?, tenant?} → {ok, id}
     POST /portal/tickets/{id}/comment   {body, author?}         → {ok}
     POST /portal/tickets/{id}/status    {status}                → {ok}
   ────────────────────────────────────────────────────────────────────────── */

type EstadoDestino = "done" | "blocked" | "ready" | "archived";

class PortalError extends Error {
  status: number; // 0 = ni siquiera salió el request
  constructor(status: number, message: string) {
    super(message);
    this.name = "PortalError";
    this.status = status;
  }
}

async function escribir<T>(cfg: PortalConfig, path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(cfg.adapter + path, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new PortalError(0, "No hay conexión con tu agente.");
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* el adapter puede contestar sin cuerpo JSON */
  }
  if (!res.ok) {
    const detalle =
      data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string"
        ? (data as { error: string }).error
        : `Error ${res.status}`;
    throw new PortalError(res.status, detalle);
  }
  return data as T;
}

const crearTicket = (
  cfg: PortalConfig,
  input: { title: string; body?: string; tenant?: string },
) => escribir<{ ok?: boolean; id?: string }>(cfg, "/portal/tickets", input);

const comentarTicket = (cfg: PortalConfig, id: string, body: string) =>
  escribir<{ ok?: boolean }>(cfg, `/portal/tickets/${encodeURIComponent(id)}/comment`, {
    body,
    author: AUTOR_PROPIO,
  });

const cambiarEstadoTicket = (cfg: PortalConfig, id: string, status: EstadoDestino) =>
  escribir<{ ok?: boolean }>(cfg, `/portal/tickets/${encodeURIComponent(id)}/status`, { status });

function describirError(e: unknown): string {
  if (e instanceof PortalError) {
    if (e.status === 404) return "Tu agente todavía no expone esta acción (falta actualizarlo).";
    if (e.status === 401 || e.status === 403) return "Tu sesión venció: volvé a entrar con tu link.";
    return e.message; // el adapter explica los 400 / 409 / 502
  }
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes("Failed to fetch") || msg.includes("NetworkError"))
    return "No hay conexión con tu agente.";
  return msg;
}

/* ── Tablero ─────────────────────────────────────────────────────────────── */

type ColKey = ColumnaTarea;

// De qué color es el puntito de cada columna. Esto sí lo decide la pantalla:
// es pintura, no palabra.
const PUNTO: Record<Tono, string> = {
  neutral: "bg-ink-soft/50",
  amber: "bg-c-amber-ink",
  violet: "bg-primary",
  green: "bg-c-green-ink",
  coral: "bg-c-coral-ink",
};

// CÓMO SE LLAMA UN ESTADO —Y CUÁLES SON LAS COLUMNAS— LO DICE `palabras.ts`.
// Acá vivían las cinco palabras y el reparto, y de las cinco una era propia del
// Tablero ("Lo estamos viendo"): Inicio contaba con otro reparto y con otro
// nombre ("Frenadas", las dos clases juntas), y la prueba a ciegas leyó tres
// nombres distintos para el mismo estado en tres pantallas. Ahora las cinco
// salen de `COLUMNAS_TABLERO` y el reparto de `columnaDeTarea`, así que Inicio,
// el Tablero, el chip del detalle y el visor de entidades no se pueden separar.
const COLUMNS: { key: ColKey; label: string; dot: string }[] =
  COLUMNAS_TABLERO.map((c) => ({ key: c.clave, label: c.label, dot: PUNTO[c.tono] }));

// La marca del pedido sólo desvía a los frenados: un pedido en curso o
// terminado ya está en la columna que le corresponde, y ahí ninguna palabra
// miente.
const columnOf = (t: { status: string; body?: string | null }): ColKey =>
  columnaDeTarea(t.status, esPedidoDelCliente(t.body));

/** El cartel de un ticket: el estado, salvo cuando el que espera somos
 *  nosotros. Es lo que muestran la columna y el chip del detalle, para que el
 *  link a la tarea no diga otra cosa que el tablero. */
const estadoDeTicket = (t: { status: string; body?: string | null }) =>
  estadoDeTarea(t.status, esPedidoDelCliente(t.body));

// Transiciones que tienen sentido desde el estado actual. Archivar va aparte:
// se ofrece siempre y con confirmación.
type Transicion = { status: EstadoDestino; label: string; enCurso: string; icon: LucideIcon };

// APROBAR NO ES LA ACCIÓN DE TODO LO QUE ESTÁ FRENADO, y ofrecerla igual no es
// gratis: aprobar es `unblock`, y un ticket tiene UN solo desbloqueo útil antes
// de que el motor lo declare un loop y lo mande a `triage`, donde ya no se puede
// aprobar nada. Sobre un pedido del propio cliente ("Conectar WhatsApp") además
// larga al worker sobre un ticket cuyo cuerpo dice "no hagas nada por tu cuenta
// con esto"; sobre un freno por una conexión que falta, la causa sigue ahí y el
// agente lo vuelve a bloquear enseguida. Los dos casos van sin transición y con
// una línea que dice dónde se resuelven. Ver `esFrenoPorConexion`.
const sinAprobacion = (t: { status: string; body?: string | null }) =>
  t.status === "blocked" && (esPedidoDelCliente(t.body) || esFrenoPorConexion(t.body));

function transicionesDe(t: { status: string; body?: string | null }): Transicion[] {
  if (t.status === "blocked") {
    if (sinAprobacion(t)) return [];
    // "Aprobar", igual que en la pestaña de Aprobaciones. Antes esta misma
    // acción se llamaba "Desbloquear" acá, "Aprobar" allá y "se destraba" en
    // la explicación: tres palabras para lo mismo, y el cliente sin saber si
    // eran tres cosas distintas.
    return [{ status: "ready", label: "Aprobar", enCurso: "Aprobando…", icon: Unlock }];
  }
  if (t.status === "done")
    return [{ status: "ready", label: "Reabrir", enCurso: "Reabriendo…", icon: RotateCcw }];
  return [{ status: "done", label: "Marcar completado", enCurso: "Completando…", icon: Check }];
}

// `created_at` llega del adapter como epoch en SEGUNDOS (int), aunque a veces
// la lib lo tipa string. Quien lo lee es `momentoDe`, la puerta única del
// portal: acepta las dos formas y devuelve el instante (`ms`, para ordenar) ya
// leído en el reloj del negocio.
const msDe = (v: string | number): number => momentoDe(v)?.ms ?? 0;

// Fecha relativa compacta; pasada una semana, fecha corta absoluta.
// Lo relativo ("hace 3 h") se puede contar desde cualquier reloj; la fecha de
// las viejas, no: se escribe en el del negocio, como el resto del portal.
function fmtRelativa(v: string | number): string {
  const m = momentoDe(v);
  if (!m) return "";
  const min = Math.round((Date.now() - m.ms) / 60_000);
  if (min < 1) return "recién";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const dias = Math.round(h / 24);
  if (dias < 7) return dias === 1 ? "hace 1 día" : `hace ${dias} días`;
  // El año también es el de allá: el 31/12 a las 23:30 del agente, mirado desde
  // el norte, no puede quedar fechado en el año que viene.
  const esteAnio = momentoDe(Date.now())?.anio;
  return m.anio === esteAnio ? m.fecha : `${m.fecha} ${m.anio}`;
}

// Búsqueda insensible a mayúsculas y tildes.
function normalizar(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** Cómo terminó (o por qué se frenó) el ticket, con lo que dejó escrito.
 *
 *  Hermes guarda el resumen y los entregables en el evento de cierre; el
 *  adapter los expone como `outcome`. Mostrarlo acá arriba es lo que evita el
 *  caso feo: un ticket que pasa de "creado" a "listo" sin que el cliente
 *  pueda saber qué se hizo ni dónde quedó. */
function Resultado({ outcome, cfg, status }: {
  outcome: TicketOutcome; cfg: PortalConfig; status: string;
}) {
  const cerrado = outcome.kind === "completed";
  // EL CARTEL NO PUEDE CONTRADECIR LO QUE EL CLIENTE ACABA DE HACER. El evento
  // de bloqueo queda en el historial para siempre, así que un ticket ya
  // aprobado seguía mostrando "POR QUÉ SE FRENÓ: Necesito tu aprobación
  // explícita…" en la columna "Por hacer". El QA lo leyó como "se perdió mi
  // ok". Si ya no está frenado, eso es historia, no estado: se cuenta en
  // pasado y sin el tono de alerta.
  const sigueFrenado = status === "blocked";
  const Icono = cerrado ? CircleCheck : CirclePause;
  const tono = cerrado
    ? "border-c-green bg-c-green/30 text-c-green-ink"
    : sigueFrenado
      ? "border-c-amber bg-c-amber/30 text-c-amber-ink"
      : "border-black/[0.07] bg-black/[0.02] text-ink-soft";
  // El payload del cierre trae `artifacts` sólo a veces (depende de cómo el
  // agente haya completado). Por eso la fuente principal es el propio resumen:
  // <Markdown> ya convierte las rutas del workspace en chips que abren el
  // archivo, y acá abajo agregamos únicamente lo que el texto no nombró.
  const enElTexto = (f: string) => (outcome.summary ?? "").includes(f.split("/").pop() ?? f);
  const extra = (outcome.files ?? []).filter((f) => !enElTexto(f));
  return (
    <EntityProvider cfg={cfg}>
      <section className={`mt-6 rounded-xl border px-4 py-3 ${tono}`}>
        <h3 className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide">
          <Icono className="h-3.5 w-3.5" />
          {cerrado ? "Resultado" : sigueFrenado ? "Por qué se frenó" : "Estuvo frenada por esto"}
        </h3>
        {!cerrado && !sigueFrenado && (
          <p className="mb-1.5 text-[12px] font-medium text-c-green-ink">
            Ya la destrabaste — esto es lo que había pasado antes.
          </p>
        )}
        {outcome.summary ? (
          <div className="text-sm text-ink">
            <Markdown>{outcome.summary}</Markdown>
          </div>
        ) : (
          <p className="text-sm text-ink-soft">Sin detalle.</p>
        )}
        {extra.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {extra.map((f) => (
              <EntityChip key={f} entity={{ kind: "file", path: f }} label={f.split("/").pop() ?? f} />
            ))}
          </div>
        )}
      </section>
    </EntityProvider>
  );
}

function FiltroTenant({ activo, onClick, children }: {
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

function Aviso({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-c-coral bg-c-coral/40 px-3 py-2 text-[13px] text-c-coral-ink">
      {children}
    </p>
  );
}

function Etiqueta({ children, opcional }: { children: string; opcional?: boolean }) {
  return (
    <span className="mb-1.5 block text-[12px] font-semibold text-ink">
      {children}
      {opcional && <span className="ml-1 font-normal text-ink-soft">(opcional)</span>}
    </span>
  );
}

// Comentario todavía sin confirmar por el agente: se pinta igual que los
// propios pero atenuado, y desaparece si el POST falla.
type ComentarioLocal = TicketComment & { local: number };

export default function PipelinePage() {
  // La pinta del agente para el sello de sus comentarios (lazy: sin flash).
  const [lookAgente] = useState(loadAgentLook);
  const [cfg] = useState<PortalConfig | null>(() => loadConfig());
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [ultima, setUltima] = useState<Date | null>(null);
  const [tenant, setTenant] = useState<string | null>(null); // null = todos
  const [busqueda, setBusqueda] = useState("");

  // Detalle abierto: lo dice la URL (`?tarea=t_ab12`), no un estado local. Es
  // un id y no el ticket entero para poder abrir uno recién creado que el
  // tablero todavía no trajo, y para que el header del modal refleje el estado
  // fresco que devuelve el detalle tras cada acción.
  const abiertoId = useParamRuta(PARAM.tarea);
  const [detalle, setDetalle] = useState<TicketDetail | null>(null);
  const [detalleError, setDetalleError] = useState(false);
  const [detalleCargando, setDetalleCargando] = useState(false);
  const abiertoRef = useRef<string | null>(null); // el id vigente, sin esperar al render

  // Alta de ticket.
  const [crearAbierto, setCrearAbierto] = useState(false);
  const [nuevoTitulo, setNuevoTitulo] = useState("");
  const [nuevoBody, setNuevoBody] = useState("");
  const [nuevoTenant, setNuevoTenant] = useState("");
  const [creando, setCreando] = useState(false);
  const [crearError, setCrearError] = useState<string | null>(null);

  // Comentarios.
  const [borrador, setBorrador] = useState("");
  const [comentando, setComentando] = useState(false);
  const [pendientes, setPendientes] = useState<ComentarioLocal[]>([]);
  const [comentarError, setComentarError] = useState<string | null>(null);
  const seqLocal = useRef(0);

  // Cambios de estado.
  const [accionEnCurso, setAccionEnCurso] = useState<EstadoDestino | null>(null);
  const [accionError, setAccionError] = useState<string | null>(null);
  const [confirmarArchivo, setConfirmarArchivo] = useState(false);
  const [verMaquina, setVerMaquina] = useState(false);

  const enVuelo = useRef(false);

  const cargar = useCallback(async () => {
    if (!cfg || enVuelo.current) return;
    enVuelo.current = true;
    setCargando(true);
    try {
      const res = await getTickets(cfg);
      setTickets(res.tickets);
      setError(null);
      setUltima(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      enVuelo.current = false;
      setCargando(false);
    }
  }, [cfg]);

  useEffect(() => {
    cargar();
    const id = setInterval(cargar, REFRESH_MS);
    return () => clearInterval(id);
  }, [cargar]);

  // Detalle: devuelve lo leído para que quien escribe sepa si pudo confirmar.
  // Descarta la respuesta si el cliente ya cerró o cambió de ticket.
  const cargarDetalle = useCallback(
    async (id: string): Promise<TicketDetail | null> => {
      if (!cfg) return null;
      try {
        const d = await getTicketDetail(cfg, id);
        if (abiertoRef.current === id) {
          setDetalle(d);
          setDetalleError(false);
          setDetalleCargando(false);
        }
        return d;
      } catch {
        if (abiertoRef.current === id) {
          setDetalleError(true);
          setDetalleCargando(false);
        }
        return null;
      }
    },
    [cfg],
  );

  // Abrir y cerrar es NAVEGAR: cada tarea tiene su link y "atrás" la cierra.
  const abrir = useCallback((id: string) => abrirEnRuta({ [PARAM.tarea]: id }), []);
  const cerrar = useCallback(() => cerrarEnRuta(PARAM.tarea), []);

  // Todo lo que es "por ticket" se resetea cuando cambia el de la URL — que es
  // el único lugar donde vive cuál está abierto. Va ANTES del efecto que trae
  // el detalle: así `abiertoRef` ya apunta al nuevo id cuando la respuesta
  // vuelve y decide si todavía se la está mirando.
  useEffect(() => {
    abiertoRef.current = abiertoId;
    setDetalle(null);
    setDetalleError(false);
    setDetalleCargando(abiertoId !== null);
    setBorrador("");
    setPendientes([]);
    setComentarError(null);
    setAccionError(null);
    setAccionEnCurso(null);
    setConfirmarArchivo(false);
  }, [abiertoId]);

  // El borrador del alta NO se limpia al cerrar: si el cliente cierra sin
  // querer (click afuera), lo que escribió sigue ahí al volver a abrir.
  const cerrarCrear = useCallback(() => {
    setCrearAbierto(false);
    setCrearError(null);
  }, []);

  useEffect(() => {
    if (abiertoId) cargarDetalle(abiertoId);
  }, [abiertoId, cargarDetalle]);

  // Modales: cerrar con Escape y bloquear el scroll de fondo.
  const hayModal = crearAbierto || abiertoId !== null;
  useEffect(() => {
    if (!hayModal) return;
    const fn = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (crearAbierto) {
        if (!creando) cerrarCrear();
      } else {
        cerrar();
      }
    };
    window.addEventListener("keydown", fn);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", fn);
      document.body.style.overflow = "";
    };
  }, [hayModal, crearAbierto, creando, cerrar, cerrarCrear]);

  // Tenants presentes en los datos (nunca hardcodeados).
  const tenants = useMemo(() => {
    const set = new Set<string>();
    let sinTenant = false;
    for (const t of tickets ?? []) {
      if (t.tenant) set.add(t.tenant);
      else sinTenant = true;
    }
    const lista = Array.from(set).sort((a, b) => a.localeCompare(b));
    if (sinTenant) lista.push(SIN_TENANT);
    return lista;
  }, [tickets]);

  const visibles = useMemo(() => {
    const q = normalizar(busqueda.trim());
    return (tickets ?? []).filter((t) => {
      if (tenant === SIN_TENANT && t.tenant) return false;
      if (tenant && tenant !== SIN_TENANT && t.tenant !== tenant) return false;
      if (q && !normalizar(t.title).includes(q)) return false;
      return true;
    });
  }, [tickets, tenant, busqueda]);

  const porColumna = useMemo(() => {
    const m: Record<ColKey, Ticket[]> = { porHacer: [], curso: [], espera: [], nuestro: [], hechas: [] };
    for (const t of visibles) m[columnOf(t)].push(t);
    for (const k of Object.keys(m) as ColKey[]) {
      m[k].sort((a, b) => msDe(b.created_at) - msDe(a.created_at));
    }
    return m;
  }, [visibles]);

  // La columna de los pedidos existe sólo si el cliente pidió algo alguna vez:
  // en un agente recién instalado sería una quinta columna vacía para siempre.
  // Se mira la lista COMPLETA y no la filtrada — si dependiera de la búsqueda,
  // el tablero cambiaría de forma mientras el cliente escribe.
  const hayPedidos = useMemo(
    () => (tickets ?? []).some((t) => columnOf(t) === "nuestro"),
    [tickets],
  );

  // El detalle manda (trae el estado recién cambiado); si todavía no llegó,
  // uso la card del tablero para pintar el modal sin esperar.
  const abierto = useMemo<Ticket | null>(() => {
    if (!abiertoId) return null;
    return detalle?.ticket ?? (tickets ?? []).find((t) => t.id === abiertoId) ?? null;
  }, [abiertoId, detalle, tickets]);

  /* ── Acciones ──────────────────────────────────────────────────────────── */

  const crear = async () => {
    if (!cfg || creando) return;
    const title = nuevoTitulo.trim();
    if (!title) return;
    const body = nuevoBody.trim();
    const tnt = nuevoTenant.trim();
    setCreando(true);
    setCrearError(null);
    try {
      const res = await crearTicket(cfg, {
        title,
        ...(body ? { body } : {}),
        ...(tnt ? { tenant: tnt } : {}),
      });
      setCrearAbierto(false);
      setNuevoTitulo("");
      setNuevoBody("");
      setNuevoTenant("");
      cargar(); // el tablero se pone al día por atrás
      if (res?.id) abrir(res.id); // y abrimos el recién creado
    } catch (e) {
      setCrearError(describirError(e));
    } finally {
      setCreando(false);
    }
  };

  const comentar = async () => {
    if (!cfg || !abiertoId || comentando) return;
    const body = borrador.trim();
    if (!body) return;
    const id = abiertoId;
    const local = ++seqLocal.current;
    setPendientes((p) => [
      ...p,
      { local, author: AUTOR_PROPIO, body, created_at: Math.floor(Date.now() / 1000) },
    ]);
    setBorrador("");
    setComentarError(null);
    setComentando(true);
    try {
      await comentarTicket(cfg, id, body);
      // Releo el detalle para quedarme con el comentario tal como lo guardó el
      // agente (timestamp y autor reales). Recién si eso vuelve bien saco el
      // optimista; si la relectura falla, el comentario existe igual y lo dejo.
      const d = await cargarDetalle(id);
      if (d) setPendientes((p) => p.filter((c) => c.local !== local));
    } catch (e) {
      setPendientes((p) => p.filter((c) => c.local !== local));
      setBorrador((actual) => actual || body); // le devolvemos lo que escribió
      setComentarError(describirError(e));
    } finally {
      setComentando(false);
    }
  };

  const cambiarEstado = async (status: EstadoDestino) => {
    if (!cfg || !abiertoId || accionEnCurso) return;
    const id = abiertoId;
    setAccionEnCurso(status);
    setAccionError(null);
    try {
      await cambiarEstadoTicket(cfg, id, status);
      cargar();
      if (status === "archived") cerrar(); // ya no está en el tablero
      else await cargarDetalle(id);
      setConfirmarArchivo(false);
    } catch (e) {
      setAccionError(describirError(e));
    } finally {
      setAccionEnCurso(null);
    }
  };

  const wrap = "mx-auto max-w-6xl px-6 py-6 md:px-8";

  if (!cfg) return <div className={wrap}><Spinner /></div>; // el layout muestra el login
  if (tickets === null && error)
    return <div className={wrap}><ErrorState message={error} onRetry={cargar} /></div>;
  if (tickets === null) return <div className={wrap}><Spinner /></div>;

  // Historial más reciente primero, pase como pase del adapter.
  const eventos = detalle
    ? [...detalle.events].sort((a, b) => msDe(b.created_at) - msDe(a.created_at))
    : [];
  const comentarios: (TicketComment & { local?: number })[] = [
    ...(detalle?.comments ?? []),
    ...pendientes,
  ];
  const tenantsLibres = tenants.filter((t) => t !== SIN_TENANT);
  const columnas = COLUMNS.filter((c) => c.key !== "nuestro" || hayPedidos);

  return (
    <div className={wrap}>
      <PageHeader
        title="Tablero"
        subtitle="Lo que tu agente tiene entre manos."
        actions={
          <>
            {/* La hora del negocio, igual que el resto del portal: este sello
                se lee CONTRA los datos de abajo ("actualizado 11:50" / "creada
                hace 5 min"), así que en el reloj del que mira sería el único
                número de la pantalla midiendo con otra vara. */}
            {ultima && (
              <span className="hidden text-xs tabular-nums text-ink-soft sm:inline">
                Actualizado {horaDe(ultima.getTime())}
              </span>
            )}
            <div className="relative w-56">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft/60" />
              <input
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Buscar por título…"
                className={`${inputCls} pl-8`}
              />
            </div>
            <IconBtn label="Actualizar" disabled={cargando} onClick={cargar}>
              <RefreshCw className={`h-4 w-4 ${cargando ? "animate-spin" : ""}`} />
            </IconBtn>
            <Btn onClick={() => setCrearAbierto(true)}>
              <Plus className="h-4 w-4" />
              Nueva tarea
            </Btn>
          </>
        }
      />

      {error && (
        <p className="mb-4 inline-flex items-center rounded-lg border border-c-coral bg-c-coral/40 px-3 py-1.5 text-[12px] font-medium text-c-coral-ink">
          No pude actualizar recién ({error}). Te muestro lo último que tengo.
        </p>
      )}

      {tickets.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="Todavía no hay tareas"
          hint="Creá la primera con “Nueva tarea”, o esperá a que tu agente arranque una."
        />
      ) : (
        <>
          {tenants.length > 0 && (
            <div className="mb-5 flex flex-wrap items-center gap-1.5">
              <FiltroTenant activo={tenant === null} onClick={() => setTenant(null)}>
                Todos
              </FiltroTenant>
              {tenants.map((t) => (
                <FiltroTenant
                  key={t}
                  activo={tenant === t}
                  onClick={() => setTenant(tenant === t ? null : t)}
                >
                  {t === SIN_TENANT ? "Sin etiqueta" : t}
                </FiltroTenant>
              ))}
            </div>
          )}

          {visibles.length === 0 ? (
            <EmptyState
              icon={SearchX}
              title="Ninguna tarea coincide"
              hint="Probá con otra búsqueda o sacá el filtro."
            />
          ) : (
            <div
              className={`grid items-start gap-4 md:grid-cols-2 ${
                columnas.length === 5 ? "xl:grid-cols-5" : "xl:grid-cols-4"
              }`}
            >
              {columnas.map((col) => (
                <section key={col.key} className="rounded-xl bg-black/[0.02] p-2">
                  {/* UNA SOLA LÍNEA, SIEMPRE LA MISMA ALTURA. Con cinco
                      columnas y la ventana entre ~1280 y ~1378 px, "Esperando
                      aprobación" no entraba y se partía en dos renglones: esa
                      cabecera medía 50 px contra 32 de las otras cuatro, la
                      fila de encabezados quedaba desalineada y la primera
                      tarjeta de esa columna arrancaba 18 px más abajo que las
                      demás (medido el 13/8 con las columnas en 186 px). Alto
                      fijo y el título recortado antes que partido; el rótulo
                      entero queda en el `title`. */}
                  <div className="flex h-8 items-center gap-1.5 px-2">
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${col.dot}`} />
                    {/* `min-w-0` y nada de `flex-1`: el título se encoge sólo
                        cuando hace falta y el número se queda pegado a él, como
                        estaba, en vez de irse al borde derecho de la columna. */}
                    <h2
                      title={col.label}
                      className="min-w-0 truncate text-[12px] font-semibold tracking-tight text-ink"
                    >
                      {col.label}
                    </h2>
                    <span className="shrink-0 text-[12px] tabular-nums text-ink-soft">
                      {porColumna[col.key].length}
                    </span>
                  </div>
                  {porColumna[col.key].length === 0 ? (
                    <p className="px-2 py-3 text-center text-[12px] text-ink-soft">Sin tareas</p>
                  ) : (
                    <ul className="flex flex-col gap-1.5">
                      {porColumna[col.key].map((t) => (
                        <li key={t.id}>
                          <button
                            onClick={() => abrir(t.id)}
                            aria-haspopup="dialog"
                            className="block w-full rounded-lg border border-black/[0.07] bg-white p-3 text-left transition hover:border-primary/40"
                          >
                            <p className="line-clamp-3 text-[13px] font-medium leading-snug text-ink">
                              {t.title}
                            </p>
                            <div className="mt-2 flex flex-wrap items-center gap-1.5">
                              {t.tenant && <Chip tone="neutral">{t.tenant}</Chip>}
                              <span className="ml-auto text-[11px] text-ink-soft">
                                {fmtRelativa(t.created_at)}
                              </span>
                            </div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── Alta de ticket ─────────────────────────────────────────────── */}
      {crearAbierto && (
        <Modal onClose={() => !creando && cerrarCrear()}>
          <div className="flex items-start justify-between gap-4 border-b border-black/[0.07] px-5 py-4">
            <div className="min-w-0">
              <h2 className="text-base font-bold leading-snug text-ink">Nueva tarea</h2>
              <p className="mt-0.5 text-sm text-ink-soft">
                Entra al tablero de tu agente como cualquier otro.
              </p>
            </div>
            <IconBtn label="Cerrar" disabled={creando} onClick={cerrarCrear}>
              <X className="h-4 w-4" />
            </IconBtn>
          </div>

          <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
            <label className="block">
              <Etiqueta>Título</Etiqueta>
              <input
                autoFocus
                value={nuevoTitulo}
                onChange={(e) => setNuevoTitulo(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && crear()}
                placeholder="Qué necesitás que haga"
                className={inputCls}
              />
            </label>

            <label className="block">
              <Etiqueta opcional>Descripción</Etiqueta>
              <textarea
                rows={5}
                value={nuevoBody}
                onChange={(e) => setNuevoBody(e.target.value)}
                placeholder="Contexto, links, criterios de listo…"
                className={`${inputCls} resize-y`}
              />
              <span className="mt-1 block text-[11px] text-ink-soft">Podés usar markdown.</span>
            </label>

            <label className="block">
              <Etiqueta opcional>Etiqueta</Etiqueta>
              <input
                list="pipeline-tenants"
                value={nuevoTenant}
                onChange={(e) => setNuevoTenant(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && crear()}
                placeholder="Un cliente, un área, un proyecto…"
                className={inputCls}
              />
              <datalist id="pipeline-tenants">
                {tenantsLibres.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
              <span className="mt-1 block text-[11px] text-ink-soft">
                Sirve para filtrar el tablero. Elegí una de las que ya usás o escribí una nueva.
              </span>
            </label>

            {crearError && <Aviso>No pude crear la tarea: {crearError}</Aviso>}
          </div>

          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-black/[0.07] px-5 py-3">
            <Btn kind="ghost" size="sm" disabled={creando} onClick={cerrarCrear}>
              Cancelar
            </Btn>
            <Btn kind="primary" size="sm" disabled={!nuevoTitulo.trim() || creando} onClick={crear}>
              {creando ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Creando…
                </>
              ) : (
                "Crear tarea"
              )}
            </Btn>
          </div>
        </Modal>
      )}

      {/* ── Detalle ────────────────────────────────────────────────────── */}
      {abiertoId && (
        <Modal wide onClose={cerrar}>
          <div className="flex items-start justify-between gap-4 border-b border-black/[0.07] px-5 py-4">
            <div className="min-w-0">
              {abierto ? (
                <>
                  <h2 className="text-base font-bold leading-snug text-ink">{abierto.title}</h2>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {/* El chip lo pone el mismo criterio que arma las columnas
                        —incluidos los pedidos del cliente—, más lo que
                        `estadoDeTarea` sabe de estados que no tienen columna:
                        una archivada sale del tablero pero el link a su detalle
                        sigue abriendo, y decía "En curso", que era mentira. */}
                    <Chip tone={estadoDeTicket(abierto).tono}>
                      {estadoDeTicket(abierto).label}
                    </Chip>
                    {abierto.tenant && <Chip tone="neutral">{abierto.tenant}</Chip>}
                    <span className="text-[11px] text-ink-soft">
                      {fmtRelativa(abierto.created_at)}
                    </span>
                  </div>
                </>
              ) : detalleError ? (
                <h2 className="text-base font-bold leading-snug text-ink">
                  No encontré esa tarea
                </h2>
              ) : (
                <h2 className="text-base font-bold leading-snug text-ink-soft">Abriendo la tarea…</h2>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              <CopiarLink titulo="Copiar el link de esta tarea" />
              <IconBtn label="Cerrar" onClick={cerrar}>
                <X className="h-4 w-4" />
              </IconBtn>
            </div>
          </div>

          {/* min-w-0: sin esto una tabla o un bloque de código ancho estira el
              modal en vez de scrollear dentro de su propio contenedor. */}
          <div className="min-w-0 flex-1 overflow-y-auto px-5 py-4">
            {/* El link se puso viejo: la tarea se archivó o se borró. Antes el
                modal se quedaba en "Abriendo la tarea…" para siempre. */}
            {!abierto && detalleError && (
              <p className="text-sm leading-relaxed text-ink-soft">
                Esa tarea ya no está en el tablero — puede que la hayan archivado o que el
                link sea viejo. Cerrá esta ventana y vas a ver todo lo que hay hoy.
              </p>
            )}
            {abierto?.body?.trim() ? (
              <Markdown>{abierto.body}</Markdown>
            ) : abierto ? (
              <p className="text-sm text-ink-soft">Esta tarea no tiene descripción.</p>
            ) : null}

            {/* Por qué el ticket quedó así. Sale del evento de cierre, no de
                que el agente se haya acordado de comentar: un ticket cerrado
                sin explicación es un ticket que el cliente no puede auditar. */}
            {detalle?.outcome && abierto && (
              <Resultado outcome={detalle.outcome} cfg={cfg} status={abierto.status} />
            )}

            <h3 className="mb-2 mt-6 text-[12px] font-semibold uppercase tracking-wide text-ink-soft">
              Comentarios
            </h3>
            {detalleCargando && !detalle ? (
              <Spinner />
            ) : detalleError && !detalle ? (
              <p className="text-sm text-ink-soft">No pude cargar los comentarios.</p>
            ) : comentarios.length > 0 ? (
              <ul className="flex flex-col gap-3">
                {comentarios.map((c, i) => {
                  const propio = esPropio(c.author);
                  const pendiente = c.local != null;
                  // Firmado `cliente` no quiere decir que lo haya escrito él.
                  // Rechazar y aprobar-con-corrección dejan en el ticket una
                  // instrucción para la máquina ("RECHAZADO POR TU CLIENTE. No
                  // hagas lo que pediste aprobar…") firmada como suya: acá se
                  // veía en el globo violeta, arriba de "Vos". Se muestra qué
                  // fue y las palabras del cliente, no el prompt.
                  //
                  // EL AUTOR VA SÍ O SÍ: sin él, el mismo filtro se le aplica a
                  // los comentarios del AGENTE, y como de un rechazo sólo se
                  // muestra el bloque del motivo —que un comentario del agente
                  // no tiene—, cualquier cosa que él escriba arrancando con
                  // "RECHAZADO POR TU CLIENTE." desaparecía entera de la
                  // pantalla. Ver `leerComentario`.
                  const { texto, rotulo } = leerComentario(c.body ?? "", c.author);
                  return (
                    <li
                      key={c.local != null ? `l${c.local}` : `s${i}`}
                      className={`flex min-w-0 items-start gap-2 ${propio ? "justify-end" : "justify-start"}`}
                    >
                      {/* La carita del agente junto a SUS comentarios: el
                          mismo sello estático del chat (Rive por comentario
                          sería costo real en hilos largos). */}
                      {!propio && !esElSistema(c.author) && (
                        <AgentitoAvatar look={lookAgente} className="mt-0.5 h-7 w-7 shrink-0" />
                      )}
                      <div
                        className={`min-w-0 max-w-[85%] rounded-lg border px-3 py-2 ${
                          propio
                            ? "border-c-violet bg-c-violet/50"
                            : "border-black/[0.07] bg-black/[0.02]"
                        } ${pendiente ? "opacity-60" : ""}`}
                      >
                        <div className="flex items-baseline gap-2">
                          <span
                            className={`text-[12px] font-semibold ${
                              propio ? "text-c-violet-ink" : "text-ink"
                            }`}
                          >
                            {rotuloDe(c.author)}
                          </span>
                          {rotulo && (
                            <span className="text-[11px] font-medium text-ink-soft">{rotulo}</span>
                          )}
                          <span className="text-[11px] text-ink-soft">
                            {pendiente ? "enviando…" : fmtRelativa(c.created_at)}
                          </span>
                        </div>
                        {texto ? (
                          <div className="mt-1 [&>div]:text-[13px]">
                            <Markdown>{texto}</Markdown>
                          </div>
                        ) : rotulo ? null : (
                          <p className="mt-1 text-sm text-ink-soft">(sin texto)</p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-ink-soft">Sin comentarios todavía.</p>
            )}

            {/* Comentar: el agente lo lee como cualquier otro comentario del ticket. */}
            <div className="mt-3">
              <textarea
                rows={3}
                value={borrador}
                onChange={(e) => setBorrador(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") comentar();
                }}
                placeholder="Escribile algo a tu agente sobre esta tarea…"
                className={`${inputCls} resize-y`}
              />
              {comentarError && <div className="mt-2"><Aviso>{comentarError}</Aviso></div>}
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="text-[11px] text-ink-soft">
                  Podés usar markdown. Ctrl + Enter para enviar.
                </span>
                <Btn
                  kind="primary"
                  size="sm"
                  disabled={!borrador.trim() || comentando}
                  onClick={comentar}
                >
                  {comentando ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Enviando…
                    </>
                  ) : (
                    "Comentar"
                  )}
                </Btn>
              </div>
            </div>

            {eventos.length > 0 && (
              <>
                <h3 className="mb-2 mt-6 text-[12px] font-semibold uppercase tracking-wide text-ink-soft">
                  Historial
                </h3>
                <ul className="flex flex-col gap-1">
                  {(verMaquina ? eventos : eventos.filter((e) => !esEventoDeMaquina(e.kind)))
                    .map((e, i) => (
                      <li key={i} className="flex items-baseline gap-2 text-[12px] text-ink-soft">
                        <span className="font-medium">{rotuloEventoTicket(e.kind)}</span>
                        <span>{fmtRelativa(e.created_at)}</span>
                      </li>
                    ))}
                </ul>
                {/* La maquinaria del motor (latidos, arranques, esperas) no le
                    dice nada al cliente y en fila parece un cuelgue. Queda
                    detrás de un interruptor, igual que en Archivos. */}
                {eventos.some((e) => esEventoDeMaquina(e.kind)) && (
                  <button
                    onClick={() => setVerMaquina((v) => !v)}
                    className="mt-1.5 text-[12px] text-ink-soft transition hover:text-ink"
                  >
                    {verMaquina
                      ? "Ocultar los pasos técnicos"
                      : `Ver los pasos técnicos (${eventos.filter((e) => esEventoDeMaquina(e.kind)).length})`}
                  </button>
                )}
              </>
            )}
          </div>

          {abierto && (
            <div className="shrink-0 border-t border-black/[0.07] px-5 py-3">
              {accionError && <div className="mb-2"><Aviso>{accionError}</Aviso></div>}
              {confirmarArchivo ? (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[13px] text-ink">
                    ¿Archivar la tarea? Sale del tablero.
                  </p>
                  <div className="flex shrink-0 gap-2">
                    <Btn
                      kind="ghost"
                      size="sm"
                      disabled={accionEnCurso !== null}
                      onClick={() => setConfirmarArchivo(false)}
                    >
                      Cancelar
                    </Btn>
                    <Btn
                      kind="danger"
                      size="sm"
                      disabled={accionEnCurso !== null}
                      onClick={() => cambiarEstado("archived")}
                    >
                      {accionEnCurso === "archived" ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Archivando…
                        </>
                      ) : (
                        "Sí, archivar"
                      )}
                    </Btn>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {/* Sin botón de aprobar, la tarea no puede quedar sin salida:
                      se dice quién la destraba y —cuando hay algo que hacer—
                      dónde está el botón que sí sirve. */}
                  {sinAprobacion(abierto) && (
                    <p className="mr-auto max-w-[26rem] text-[12px] leading-snug text-ink-soft">
                      {esPedidoDelCliente(abierto.body)
                        ? "Esto lo pediste vos y lo estamos viendo nosotros: no hay nada que aprobar acá. Te escribimos cuando esté."
                        : "Está frenada hasta que se conecte lo que le falta. "}
                      {!esPedidoDelCliente(abierto.body) && (
                        <Link
                          href={`/app/aprobaciones?pedido=${encodeURIComponent(abierto.id)}`}
                          className="font-semibold text-primary transition hover:text-primary-dark"
                        >
                          Verlo en Aprobaciones
                        </Link>
                      )}
                    </p>
                  )}
                  <Btn
                    kind="ghost"
                    size="sm"
                    disabled={accionEnCurso !== null}
                    onClick={() => setConfirmarArchivo(true)}
                  >
                    <Archive className="h-4 w-4" />
                    Archivar
                  </Btn>
                  {transicionesDe(abierto).map((t) => (
                    <Btn
                      key={t.status}
                      kind={t.status === "done" ? "primary" : "secondary"}
                      size="sm"
                      disabled={accionEnCurso !== null}
                      onClick={() => cambiarEstado(t.status)}
                    >
                      {accionEnCurso === t.status ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          {t.enCurso}
                        </>
                      ) : (
                        <>
                          <t.icon className="h-4 w-4" />
                          {t.label}
                        </>
                      )}
                    </Btn>
                  ))}
                </div>
              )}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
