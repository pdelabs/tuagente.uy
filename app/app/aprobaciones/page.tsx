"use client";

// Aprobaciones: tareas que el agente frenó esperando el ok del cliente.
// PRINCIPIO CERO: domain-free — el body se muestra tal cual (puede ser un
// mail, un pago, un post...); el portal no asume qué es.
// Contrato adapter (docs/specs/03-aprobaciones.md):
//   GET  /portal/approvals → { approvals: [{ id, title, summary, body, created_at }] }
//   POST /portal/approvals/{id}/approve { correction? } · POST .../reject { reason }
// Semántica honesta: aprobar SOLO comenta y desbloquea el ticket; qué pasa
// después lo deciden las reglas del agente. El copy no promete "se envía ya".
//
// Aprobar con correcciones: el adapter (0.6.0) acepta `{correction}` en approve
// y, antes de desbloquear, deja un comentario firmado por `cliente` con la
// versión textual que el agente tiene que usar. NO edita el body del ticket
// (el CLI de Hermes no lo permite sobre un ticket bloqueado), así que el copy
// dice exactamente eso: tu versión queda asentada como comentario.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowRight, Ban, CheckCircle2, ChevronDown, Clock, Hand, PencilLine, MessageSquareReply,
} from "lucide-react";
import { loadAgentName } from "../lib/onboarding";
import {
  loadConfig, getApprovals, getTicketDetail, approve, reject,
  avisarAprobacionesCambiaron, esElCliente, esPedidoDelCliente, esRechazoDelCliente,
  leerComentario, motivoDeRechazo, rotuloAutor,
  type PortalConfig, type TicketComment, type TicketDetail,
} from "../lib/agent";
import {
  AvisoLinkViejo, Btn, Card, Chip, EmptyState, ErrorState, PageHeader, Spinner, inputCls,
} from "../lib/ui";
import {
  CopiarLink, PARAM, abrirEnRuta, cerrarEnRuta, traerALaVista, useParamRuta,
} from "../lib/rutas";
import Markdown from "../lib/Markdown";

const REFRESH_MS = 30_000;

type Approval = {
  id: string;
  title: string;
  summary: string;
  body: string;
  created_at: string | number; // Hermes puede emitir epoch en segundos
};

// Tolerante: epoch en segundos (número o string numérica), epoch en ms, o ISO.
function toMs(v: string | number): number {
  if (typeof v === "number") return v < 1e12 ? v * 1000 : v;
  if (v && /^\d+(\.\d+)?$/.test(v)) {
    const n = Number(v);
    return n < 1e12 ? n * 1000 : n;
  }
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function timeAgo(v: string | number): string {
  const t = toMs(v);
  if (!t) return "";
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return "hace un momento";
  const m = Math.floor(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return h === 1 ? "hace 1 hora" : `hace ${h} horas`;
  const d = Math.floor(h / 24);
  return d === 1 ? "hace 1 día" : `hace ${d} días`;
}

// El summary es una línea suelta: va como texto plano (markdown a medias en una
// línea recortada se ve peor que el crudo). Pero el agente lo escribe con el
// mismo teclado que el body, así que sacamos las marcas obvias que quedarían a
// la vista. Nada de parsear: es cosmética de una línea.
function stripMarks(s: string): string {
  return s
    .replace(/^\s*(?:#{1,6}\s+|>\s+|[-*+]\s+)/, "") // # título · > cita · - ítem
    .replace(/\*\*(.+?)\*\*/g, "$1") // **negrita**
    .replace(/__(.+?)__/g, "$1") // __negrita__
    .replace(/`([^`]+)`/g, "$1") // `código`
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // [texto](url)
    .trim();
}

// `approve()` de lib/agent.ts postea sin cuerpo, así que la variante con
// corrección va con un fetch local (mismo Bearer, mismo shape de error que
// describeError espera: el status en el mensaje). Cuando la lib exponga un
// approve(cfg, id, {correction}) esto se borra y se usa aquél.
async function approveWithCorrection(cfg: PortalConfig, id: string, correction: string): Promise<void> {
  const res = await fetch(`${cfg.adapter}/portal/approvals/${encodeURIComponent(id)}/approve`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ correction }),
  });
  if (!res.ok) {
    // El adapter contesta {error} en 400/409: mostrarlo es más útil que el número.
    let detail = "";
    try {
      const data = await res.json();
      if (data && typeof data.error === "string") detail = ` (${data.error})`;
    } catch { /* sin cuerpo JSON */ }
    throw new Error(`${res.status} al aprobar${detail}`);
  }
}

// Los marcadores que el CLI deja como comentario ("BLOCKED: …") son ruido de
// máquina: el motivo ya se muestra arriba, con sus palabras.
const esMarcador = (s: string) => /^\s*(BLOCKED|UNBLOCKED|BLOQUEADO)\s*:/i.test(s);
// Quién firma como el cliente lo decide `lib/agent.ts` y nadie más: estaba
// copiado acá con su propia expresión, al lado de la función que la usa para
// decidir qué se muestra y qué no. Dos copias de esa regla es una de más.
const esDelCliente = esElCliente;

/** La forma que la skill `aprobacion` le da a un pedido: un cuadro markdown
 *  ("si aprobás / si rechazás / por qué"). Es lo que separa una PROPUESTA de un
 *  comentario cualquiera del agente. */
const pareceUnaPropuesta = (s: string) => /^\s*\|.*\|\s*$/m.test(s || "");

/** Qué le estamos pidiendo que apruebe. La skill `aprobacion` deja el pedido
 *  formateado COMO COMENTARIO del ticket, no en su descripción — por eso esta
 *  pantalla mostraba el resumen dos veces y el mail no aparecía por ningún
 *  lado.
 *
 *  LA ÚLTIMA, no la primera. Con el rechazo que no destraba, la negociación
 *  entera pasa en este mismo ticket: el agente propone, la clienta dice que no,
 *  el agente vuelve a proponer en otro comentario. Quedarse con el primero es
 *  mostrarle para siempre la propuesta que ya rechazó, y hacerle aprobar eso.
 *  Sin propuesta con forma de tal, cae a lo de antes (el primer comentario del
 *  agente) y, si no hay ninguno, al cuerpo del ticket.
 *
 *  SE DEVUELVE CUÁNDO SE ESCRIBIÓ, y no es un detalle: al agente no se le puede
 *  exigir que use el cuadro. Visto en vivo — la clienta rechaza, el agente
 *  contesta la versión nueva EN PROSA, y como acá sólo entran las que traen
 *  cuadro, el recuadro se quedó mostrando "8% / lunes 17" con el botón Aprobar
 *  debajo mientras la conversación dos renglones más abajo decía "12% / lunes
 *  24". Con la fecha, la pantalla puede al menos no afirmar que lo de arriba es
 *  lo vigente. Ver `estadoDeLaNegociacion`. */
type Propuesta = { texto: string; cuando: number };
function elegirPropuesta(d: TicketDetail | undefined, fallback: string): Propuesta {
  const delAgente = (d?.comments ?? []).filter(
    (x) => !esDelCliente(x.author) && x.body?.trim() && !esMarcador(x.body));
  const propuestas = delAgente.filter((x) => pareceUnaPropuesta(x.body));
  const elegida = propuestas[propuestas.length - 1] ?? delAgente[0];
  return {
    texto: (elegida?.body ?? fallback ?? "").trim(),
    // Sin comentario elegido lo que se muestra es el cuerpo del ticket, que es
    // lo más viejo que hay: cualquier "no" posterior lo deja atrás.
    cuando: elegida ? toMs(elegida.created_at) : 0,
  };
}

/** EL ESTADO DE LA NEGOCIACIÓN, LEÍDO DEL HILO.
 *
 *  Vivía sólo en un `useState`: con F5 se evaporaba y la clienta volvía a ver
 *  la propuesta con el botón Aprobar debajo, sin una sola señal de que ya había
 *  dicho que no. Es derivable —el último comentario suyo es un rechazo— y es
 *  exactamente lo que hace el resto del portal: lo que está abierto se LEE, no
 *  se recuerda. */
type Negociacion = {
  cuando: Date;
  /** Sus palabras, o "" si el comentario no trae el bloque del motivo. */
  motivo: string;
  /** El agente ya contestó algo después del "no". */
  contesto: boolean;
  /** Lo que se está mostrando arriba es anterior al "no": NO es lo vigente. */
  propuestaVieja: boolean;
};
function estadoDeLaNegociacion(
  d: TicketDetail | undefined, propuesta: Propuesta,
): Negociacion | null {
  const hilo = (d?.comments ?? []).filter(
    (c) => (c.body ?? "").trim() && !esMarcador(c.body ?? ""));
  let i = -1;
  for (let k = 0; k < hilo.length; k++) if (esRechazoDelCliente(hilo[k])) i = k;
  if (i === -1) return null;
  const rechazo: TicketComment = hilo[i];
  return {
    cuando: new Date(toMs(rechazo.created_at)),
    motivo: motivoDeRechazo(rechazo.body ?? ""),
    contesto: hilo.slice(i + 1).some((c) => !esDelCliente(c.author)),
    propuestaVieja: propuesta.cuando <= toMs(rechazo.created_at),
  };
}

/** El ida y vuelta posterior al pedido: lo que comentaste vos y lo que
 *  contestó el agente. Se muestra aparte de la propuesta. */
function conversacion(d: TicketDetail | undefined, propuesta: string) {
  const vistos = new Set<string>();
  return (d?.comments ?? []).filter((c) => {
    const b = (c.body ?? "").trim();
    if (!b || b === propuesta || esMarcador(b)) return false;
    // El adapter a veces devuelve el mismo comentario dos veces con autores
    // distintos (`worker` y el nombre del agente): al cliente le parece que
    // habló dos veces. Nos quedamos con el primero.
    if (vistos.has(b)) return false;
    vistos.add(b);
    return true;
  });
}

function describeError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes("404")) return "Tu agente todavía no expone aprobaciones (módulo no disponible).";
  if (msg.includes("Failed to fetch") || msg.includes("NetworkError")) return "No hay conexión con tu agente.";
  return msg;
}

/** Separa la FICHA (el resumen y el cuadro "si aprobás / si rechazás / por
 *  qué") del TEXTO QUE SE VA A MANDAR.
 *
 *  La ficha es excelente para decidir y pésima para editar: "Corregir y
 *  aprobar" abría el markdown entero y el cliente se encontraba con
 *  `| Si aprobás | Se envía al proveedor… |` cuando lo único que quería era
 *  cambiar un número. Corta después de la última fila de tabla; si no hay
 *  cuadro, no separa nada y se edita todo (que es lo que había). */
function separarPropuesta(md: string): { ficha: string; texto: string } {
  const lineas = (md || "").split("\n");
  let ultimaFila = -1;
  for (let i = 0; i < lineas.length; i++) {
    if (/^\s*\|.*\|\s*$/.test(lineas[i])) ultimaFila = i;
  }
  if (ultimaFila === -1) return { ficha: "", texto: md };
  // La skill separa la ficha del texto con una línea `---`: es puntuación del
  // formato, no parte de lo que se manda.
  const texto = lineas
    .slice(ultimaFila + 1)
    .join("\n")
    .replace(/^\s*(?:[-*_]\s*){3,}\s*$/m, "")
    .trim();
  // Un cuadro al final, sin texto abajo: no hay nada que separar.
  if (texto.length < 20) return { ficha: "", texto: md };
  return { ficha: lineas.slice(0, ultimaFila + 1).join("\n").trim(), texto };
}

/** Lo que el cliente acaba de resolver, y sigue viéndolo.
 *
 *  Antes la tarjeta se esfumaba y quedaba "Nada esperando tu aprobación": el
 *  botón más importante del producto no confirmaba nada y la clienta no sabía
 *  si el clic se había registrado ni si el mail había salido. */
type Resuelto = {
  id: string;
  titulo: string;
  accion: "aprobado" | "corregido" | "cerrado";
  cuando: Date;
};

/** El "no" que sigue abierto. A diferencia de aprobar, rechazar NO cierra el
 *  pedido: el ticket queda bloqueado, la tarjeta se queda en la lista y el
 *  agente vuelve con otra propuesta sobre el mismo pedido. Esto es lo que
 *  aparece adentro de esa tarjeta mientras tanto.
 *
 *  `avisado` es `null` cuando el "no" no lo acabás de mandar sino que se leyó
 *  del hilo (volviste a la pantalla, o refrescaste): ahí no sabemos si el aviso
 *  salió, y no saberlo se dice callándose, no inventando un "ya lo está
 *  leyendo". */
type Rechazado = {
  cuando: Date;
  motivo: string;
  avisado: boolean | null;
  /** El agente ya contestó después del "no". */
  contesto?: boolean;
};

const hhmm = (d: Date) =>
  d.toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit", hour12: false });

/** La confirmación que faltaba. Queda puesta mientras el cliente siga en la
 *  pantalla: qué hizo, a qué hora, qué está pasando ahora, y el link a la tarea
 *  para ir a mirarla. */
function TarjetaResuelta({ r, nombreAgente }: { r: Resuelto; nombreAgente: string }) {
  const cerrado = r.accion === "cerrado";
  const titulo = cerrado
    ? "Cerraste el pedido"
    : r.accion === "aprobado" ? "Lo aprobaste" : "Lo aprobaste con tu corrección";
  const detalle =
    r.accion === "aprobado"
      ? `${nombreAgente} ya lo sabe y está siguiendo con eso. Lo ves avanzar en el Tablero.`
      : r.accion === "corregido"
      ? `${nombreAgente} tiene que usar tu versión, no la original. Lo ves avanzar en el Tablero.`
      : `${nombreAgente} no lo va a volver a proponer. Quedó anotado por qué, en el Tablero. `
        + "Si algún día cambiás de idea, pediselo por el chat.";
  const Icono = cerrado ? Ban : CheckCircle2;
  const ink = cerrado ? "text-ink" : "text-c-green-ink";
  return (
    <Card tone={cerrado ? "surface" : "green"}>
      <div className="flex items-start gap-2.5">
        <Icono className={`mt-0.5 h-4 w-4 shrink-0 ${ink}`} />
        <div className="min-w-0 flex-1">
          <p className={`text-sm font-semibold ${ink}`}>
            {titulo} · {hhmm(r.cuando)}
          </p>
          <p className="mt-0.5 text-[13px] leading-snug text-ink">{r.titulo}</p>
          <p className="mt-1 text-[12.5px] leading-snug text-ink-soft">{detalle}</p>
          <Link
            href={`/app/pipeline?tarea=${encodeURIComponent(r.id)}`}
            className="mt-1.5 inline-flex items-center gap-1 text-[12.5px] font-semibold text-primary transition hover:text-primary-dark"
          >
            Ver la tarea
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </Card>
  );
}

/** Adentro de la tarjeta del pedido que acabás de rechazar, que SIGUE ahí.
 *
 *  Que no desaparezca es la mitad del arreglo: rechazar no resuelve nada, abre
 *  una conversación. Si la tarjeta se esfumara, la clienta no tendría dónde
 *  leer la respuesta del agente ni dónde aprobar la versión corregida. */
function AvisoRechazado({ r, nombreAgente }: { r: Rechazado; nombreAgente: string }) {
  // Tres situaciones distintas y ninguna afirma de más. El `null` es el "no"
  // que se leyó del hilo al volver a la pantalla: no sabemos si el aviso salió,
  // pero sí que el pedido sigue esperando.
  const detalle = r.contesto
    ? `${nombreAgente} ya te contestó: su respuesta está acá abajo, en "Lo que hablaron". El pedido queda esperando tu ok hasta que la versión que te traiga te sirva.`
    : r.avisado === true
    ? `${nombreAgente} lo está leyendo y te va a contestar acá abajo, en "Lo que hablaron". El pedido queda esperando tu ok hasta que la nueva versión te sirva.`
    : r.avisado === false
    ? `Tu respuesta quedó anotada en el pedido, pero no pude avisarle en el momento: ${nombreAgente} la va a leer la próxima vez que trabaje esta tarea. El pedido queda esperando tu ok.`
    : `${nombreAgente} todavía no contestó. El pedido queda esperando tu ok hasta que la nueva versión te sirva.`;
  return (
    <div className="mt-3 rounded-lg border border-c-amber bg-c-amber/25 px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-[13px] font-semibold text-c-amber-ink">
        <MessageSquareReply className="h-3.5 w-3.5 shrink-0" />
        Le dijiste que no · {hhmm(r.cuando)}
      </p>
      {/* Sin bloque de motivo no se cita nada: entrecomillar el texto de
          máquina sería ponerle en la boca algo que no escribió. */}
      {r.motivo && (
        <p className="mt-1 text-[13px] leading-snug text-ink">Le dijiste: «{r.motivo}»</p>
      )}
      <p className="mt-1 text-[12.5px] leading-snug text-c-amber-ink/85">{detalle}</p>
    </div>
  );
}

export default function AprobacionesPage() {
  const [cfg, setCfg] = useState<PortalConfig | null>(null);
  const [approvals, setApprovals] = useState<Approval[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Cuál está desplegado lo dice la URL (`?pedido=<id>`): el agente puede
  // mandar el link del pedido exacto que está esperando tu ok.
  const expandedId = useParamRuta(PARAM.pedido);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  // "No, y no me lo vuelvas a proponer": cierra el pedido. Lo decide el
  // cliente con una casilla, no el modelo leyéndole el motivo.
  const [cerrarPedido, setCerrarPedido] = useState(false);
  // Corrección en curso: la card cuyo body está editable y el texto tipeado.
  const [correctingId, setCorrectingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  // Optimismo: ids que ya salieron de la lista (POST en vuelo o confirmado).
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  // Lo que el cliente resolvió en esta visita, para que la pantalla se lo
  // confirme en vez de vaciarse.
  const [resueltos, setResueltos] = useState<Resuelto[]>([]);
  // Lo que rechazó: NO sale de la lista (el ticket sigue bloqueado), así que
  // esto es lo que le pone adentro de la tarjeta el estado de la negociación.
  const [rechazados, setRechazados] = useState<Record<string, Rechazado>>({});
  const [rechazando, setRechazando] = useState<string | null>(null);
  const [cardErrors, setCardErrors] = useState<Record<string, string>>({});
  // Detalle del ticket por id: es donde vive de verdad lo que hay que aprobar
  // (la skill lo deja como comentario). Se trae al desplegar, una sola vez.
  const [detalles, setDetalles] = useState<Record<string, TicketDetail | "cargando" | "falla">>({});

  useEffect(() => {
    setCfg(loadConfig()); // si es null, el layout muestra el login
  }, []);

  const load = useCallback(async (c: PortalConfig) => {
    try {
      const data = await getApprovals(c);
      const list = (Array.isArray(data.approvals) ? data.approvals : []) as Approval[];
      // La que más espera, arriba.
      list.sort((a, b) => toMs(a.created_at) - toMs(b.created_at));
      setApprovals(list);
      setLoadError(null);
      // Limpiar ids ocultos que el adapter ya no devuelve (acción confirmada).
      setHidden((h) => {
        const alive = new Set(list.map((a) => a.id));
        const next = new Set(Array.from(h).filter((id) => alive.has(id)));
        return next.size === h.size ? h : next;
      });
    } catch (e) {
      setLoadError(describeError(e));
    }
  }, []);

  useEffect(() => {
    if (!cfg) return;
    load(cfg);
    const t = setInterval(() => load(cfg), REFRESH_MS); // refresh silencioso
    return () => clearInterval(t);
  }, [cfg, load]);

  const setCardError = (id: string, msg: string | null) =>
    setCardErrors((errs) => {
      const next = { ...errs };
      if (msg) next[id] = msg;
      else delete next[id];
      return next;
    });

  const hide = (id: string) => setHidden((h) => new Set(h).add(id));
  const unhide = (id: string) =>
    setHidden((h) => {
      const next = new Set(h);
      next.delete(id);
      return next;
    });

  /** Lo resuelto queda A LA VISTA con qué pasó y cuándo. Y el badge del menú
   *  se entera ya: si no, el sidebar sigue diciendo "1" hasta el próximo
   *  minuto y el cliente cree que su clic no llegó. */
  const marcarResuelto = (r: Resuelto) => {
    setResueltos((prev) => [r, ...prev.filter((x) => x.id !== r.id)]);
    avisarAprobacionesCambiaron();
  };
  const olvidarResuelto = (id: string) =>
    setResueltos((prev) => prev.filter((x) => x.id !== id));

  const doApprove = (a: Approval) => {
    if (!cfg) return;
    setCardError(a.id, null);
    hide(a.id); // sale de la lista ya; el refresh confirma
    marcarResuelto({ id: a.id, titulo: a.title, accion: "aprobado", cuando: new Date() });
    approve(cfg, a.id).catch((e) => {
      unhide(a.id);
      olvidarResuelto(a.id);
      setCardError(a.id, `No se pudo aprobar: ${describeError(e)}`);
    });
  };

  const stopCorrecting = () => {
    setCorrectingId(null);
    setDraft("");
  };

  // Aprobar con la versión editada. Mismo optimismo que el resto: la card sale
  // ya; si el POST falla vuelve, con el texto tipeado intacto para reintentar.
  const doApproveWithCorrection = (a: Approval, original: string) => {
    if (!cfg) return;
    const texto = draft.trim();
    if (!texto || texto === original) return;
    setCardError(a.id, null);
    stopCorrecting();
    hide(a.id);
    marcarResuelto({ id: a.id, titulo: a.title, accion: "corregido", cuando: new Date() });
    approveWithCorrection(cfg, a.id, texto).catch((e) => {
      unhide(a.id);
      olvidarResuelto(a.id);
      abrirEnRuta({ [PARAM.pedido]: a.id });
      setCorrectingId(a.id);
      setDraft(texto);
      setCardError(a.id, `No se pudo aprobar con correcciones: ${describeError(e)}`);
    });
  };

  /** RECHAZAR ES CONTESTAR, NO CERRAR. Una llamada, y el pedido se queda.
   *
   *  Lo que había hacía tres escrituras no atómicas —comentario, comentario,
   *  y mover el ticket a `ready`— y escondía la tarjeta. Las dos cosas estaban
   *  mal, y la segunda era la grave: `ready` GASTA el único desbloqueo que el
   *  ticket tiene antes de que el motor lo declare un loop. El agente
   *  re-proponía, volvía a bloquear, saltaba el límite, y el pedido se moría —
   *  o en `triage` (donde Aprobar contesta "quedó trabado") o partido por el
   *  auto-decomposer con el cuerpo viejo, que fue como a la clienta le quedó en
   *  la cola una tarea de 8 bisagras después de haber corregido a 20.
   *
   *  Ahora: un `POST /reject` y nada más. El adapter escribe UN comentario
   *  firmado `cliente` y despierta al agente; el ticket no se toca y sigue
   *  `blocked`, o sea que sigue en esta lista. La tarjeta se queda con el aviso
   *  adentro y ahí mismo va a aparecer la respuesta del agente. El desbloqueo
   *  se gasta una sola vez en toda la negociación: al aprobar. */
  const doReject = async (a: Approval) => {
    if (!cfg) return;
    const motivo = reason.trim();
    if (!motivo) return;
    const definitivo = cerrarPedido;
    setCardError(a.id, null);
    setRechazando(a.id);
    try {
      const res = await reject(cfg, a.id, motivo, definitivo);
      setRejectingId(null);
      setReason("");
      setCerrarPedido(false);
      // Con `definitivo` el adapter comenta Y cierra el ticket en la misma
      // escritura: el pedido se va de la lista, y como cualquier otra cosa que
      // se resuelve, se confirma en pantalla en vez de esfumarse.
      if (res?.cerrado || res?.en_aprobaciones === false) {
        hide(a.id);
        marcarResuelto({ id: a.id, titulo: a.title, accion: "cerrado", cuando: new Date() });
        load(cfg);
        return;
      }
      // `avisado` puede venir en false: el comentario quedó igual, pero el
      // agente no se enteró en el momento. Se dice, no se maquilla.
      setRechazados((prev) => ({
        ...prev,
        [a.id]: { cuando: new Date(), motivo, avisado: res?.avisado !== false },
      }));
      // Su propia respuesta tiene que aparecer en "Lo que hablaron" ya, no
      // dentro de 30 segundos: es la prueba de que el mensaje llegó.
      traerDetalle(a.id, true);
      // Si el adapter destrabó igual (uno viejo, o uno que cambie de opinión),
      // el pedido va a salir de la lista solo en el próximo refresh. No lo
      // adivinamos acá.
      if (res?.desbloqueado) load(cfg);
    } catch (e) {
      setCardError(a.id, `No se pudo rechazar: ${describeError(e)}`);
    } finally {
      setRechazando(null);
    }
  };

  /** Trae el detalle una vez por ticket. Si falla, la card cae al body de
   *  siempre: nunca dejamos al cliente sin nada que leer.
   *
   *  DOS COSAS QUE PARECEN DETALLE Y NO LO SON, porque juntas hacían un LOOP DE
   *  FETCH INFINITO —~2000 GET en 6 segundos contra el agente del cliente— con
   *  cualquier link viejo a una aprobación ya resuelta:
   *    1. lo ya pedido se recuerda en un REF, no en el estado. Con `detalles`
   *       en las deps, cada respuesta cambiaba la identidad de esta función, y
   *       el efecto que la llama volvía a correr.
   *    2. la falla se GUARDA. Antes se borraba la entrada "para reintentar al
   *       reabrir", y eso cerraba el ciclo: fallaba → borraba → cambiaba
   *       `detalles` → efecto → fallaba…
   *  Reintentar sigue siendo posible, pero a pedido del cliente, no solo. */
  const detallesPedidos = useRef<Set<string>>(new Set());
  const traerDetalle = useCallback((id: string, reintento = false) => {
    if (!cfg) return;
    if (detallesPedidos.current.has(id) && !reintento) return;
    detallesPedidos.current.add(id);
    setDetalles((d) => ({ ...d, [id]: "cargando" }));
    getTicketDetail(cfg, id)
      .then((d) => setDetalles((prev) => ({ ...prev, [id]: d })))
      .catch(() => setDetalles((prev) => ({ ...prev, [id]: "falla" })));
  }, [cfg]);

  // El detalle se trae mirando la URL, no el click: así un link compartido
  // llega con el pedido ya abierto y con su texto adentro.
  useEffect(() => {
    if (expandedId) traerDetalle(expandedId);
  }, [expandedId, traerDetalle]);

  // Desplegar un pedido es NAVEGAR: queda en la URL y "atrás" lo pliega.
  const toggle = (id: string) => {
    if (expandedId === id) cerrarEnRuta(PARAM.pedido);
    else abrirEnRuta({ [PARAM.pedido]: id });
    if (rejectingId === id) {
      setRejectingId(null);
      setReason("");
      setCerrarPedido(false);
    }
    if (correctingId === id) stopCorrecting(); // plegar descarta la edición
  };

  const visible = approvals ? approvals.filter((a) => !hidden.has(a.id)) : null;
  // Dos listas distintas: lo que el agente te pide permiso para hacer, y lo
  // que vos pediste y está en nuestra cancha. Mezclarlas ponía los mismos
  // botones abajo de "mandá este mail a un desconocido" y de "conectame el
  // correo", que para el cliente son cosas muy distintas.
  const pendientes = visible?.filter((a) => !esPedidoDelCliente(a.body)) ?? null;
  const pedidos = visible?.filter((a) => esPedidoDelCliente(a.body)) ?? null;

  const nombreAgente = loadAgentName() || "Tu agente";

  /* EL LINK DEL PEDIDO TIENE QUE DEJAR EL PEDIDO A LA VISTA, y no lo hacía —
     justo el link que el agente más va a mandar ("mirá, esto espera tu ok").
     Medido en el lab con `?pedido=<id>`: `scrollY` en 0 y la tarjeta arrancando
     a 1055 px con una ventana de 862, o sea que la clienta aterrizaba mirando
     el pedido de OTRO, con su par Aprobar/Rechazar delante. El helper ya existía
     y lo usan Habilidades y Conexiones: acá era una llamada.

     Las deps son el id y dos booleanos, nunca la lista: se refresca sola cada
     30 segundos y con `approvals` acá la página saltaría sola mientras el
     cliente lee otra tarjeta. Y se reintenta cuando llega el detalle porque la
     tarjeta CRECE (el texto del pedido, la conversación) y lo que centramos con
     la tarjeta plegada queda corrido. */
  const enLaLista = Boolean(expandedId && visible?.some((x) => x.id === expandedId));
  const detalleAbierto = expandedId ? detalles[expandedId] : undefined;
  const detalleListo = detalleAbierto !== undefined && detalleAbierto !== "cargando";
  useEffect(() => {
    if (!enLaLista) return;
    return traerALaVista(".pedido-abierto");
  }, [expandedId, enLaLista, detalleListo]);

  return (
    <div className="mx-auto max-w-3xl px-6 py-6 md:px-8">
      <PageHeader
        title="Aprobaciones"
        subtitle="Lo que tu agente frenó para preguntarte. Abrí cada uno: adentro está el texto completo de lo que quiere hacer."
      />

      {/* Lo que acabás de resolver, arriba de todo y con su hora. Va antes de
          cualquier otra rama: si aprobaste lo único que había, la pantalla no
          puede quedar en "Nada esperando tu aprobación" como si no hubieras
          hecho nada. */}
      {/* El link apunta a un pedido que ya no está en la cola: se resolvió, se
          archivó o el agente lo retiró. Se dice, y la lista queda abajo. */}
      {expandedId && visible !== null
        && !visible.some((a) => a.id === expandedId)
        && !resueltos.some((r) => r.id === expandedId) && (
        <AvisoLinkViejo>
          Ese pedido ya no está esperando tu ok — puede que ya lo hayas contestado o que
          tu agente lo haya retirado. Abajo está lo que sí espera tu respuesta.
        </AvisoLinkViejo>
      )}

      {resueltos.length > 0 && (
        <div className="mb-4 flex flex-col gap-2">
          {resueltos.map((r) => (
            <TarjetaResuelta key={r.id} r={r} nombreAgente={nombreAgente} />
          ))}
        </div>
      )}

      {!cfg || visible === null ? (
        cfg && loadError ? (
          <ErrorState
            message={loadError}
            onRetry={() => {
              setLoadError(null);
              load(cfg);
            }}
          />
        ) : (
          <Spinner />
        )
      ) : visible.length === 0 ? (
        resueltos.length > 0 ? (
          <p className="px-1 text-sm text-ink-soft">
            No queda nada más esperando tu ok.
          </p>
        ) : (
          <EmptyState
            icon={Hand}
            title="Nada esperando tu aprobación"
            hint="Cuando tu agente necesite tu ok, lo vas a ver acá."
          />
        )
      ) : (
        <div className="flex flex-col gap-3">
          {pendientes !== null && pendientes.length === 0 && (
            <p className="text-sm text-ink-soft">
              Tu agente no te está pidiendo permiso para nada ahora mismo.
            </p>
          )}
          {(pendientes ?? []).map((a) => {
            const waited = timeAgo(a.created_at);
            const expanded = expandedId === a.id;
            const rejecting = rejectingId === a.id;
            const summary = a.summary ? stripMarks(a.summary) : "";
            const detalle = detalles[a.id];
            const det = typeof detalle === "string" ? undefined : detalle;
            // Lo que hay que leer para decidir: el comentario del agente con el
            // pedido formateado. Antes se mostraba `a.body`, que es la
            // descripción del ticket — o sea, el mismo resumen de arriba
            // repetido. Desplegar no aportaba nada y el mail no estaba.
            const propuesta = elegirPropuesta(det, a.body?.trim() ?? "");
            const body = propuesta.texto;
            const charla = conversacion(det, body);
            // El "no" que ya está en el hilo. Lo que acabás de mandar gana (sabe
            // si el aviso salió); si no, se deriva de los comentarios, que es lo
            // que hace que sobreviva a un F5.
            const negociacion = estadoDeLaNegociacion(det, propuesta);
            const rechazoLocal = rechazados[a.id];
            const rechazo: Rechazado | null = rechazoLocal
              ? { ...rechazoLocal, contesto: negociacion?.contesto ?? false }
              : negociacion
              ? {
                  cuando: negociacion.cuando,
                  motivo: negociacion.motivo,
                  avisado: null,
                  contesto: negociacion.contesto,
                }
              : null;
            const motivo = det?.outcome?.summary?.trim() ?? "";
            const correcting = correctingId === a.id;
            // La ficha (resumen + cuadro "si aprobás / si rechazás / por qué")
            // se lee para decidir; lo que se edita es SOLO el texto que se va a
            // mandar. Ver `separarPropuesta`.
            const { ficha, texto: mandable } = separarPropuesta(body);
            /** EL RECUADRO ES LA VERSIÓN QUE ELLA YA RECHAZÓ. Pasa cuando el
             *  agente re-propone en prosa: acá arriba sólo entran las
             *  propuestas con cuadro markdown, así que lo que se sigue
             *  mostrando es lo viejo. Es la condición que gobierna las dos
             *  mitades de "Corregir y aprobar" — el aviso y el texto que
             *  arranca en el editor. */
            const rechazada = Boolean(negociacion?.propuestaVieja);
            // NUNCA SE PRECARGA UN TEXTO QUE ELLA YA RECHAZÓ. Aprobar con
            // corrección manda lo que hay en la caja como "usá exactamente esta
            // versión": precargarla con la propuesta rechazada convierte el
            // botón más cuidadoso de la pantalla en el más peligroso de los
            // tres — peor que Aprobar a secas, porque además lo firma como
            // decisión suya. Sin propuesta nueva parseable, la caja arranca
            // vacía y la pantalla explica por qué.
            const arranqueDelBorrador = rechazada ? "" : mandable;
            // Sin cambios reales no hay nada que corregir: es una aprobación
            // común. No aplica cuando arranca vacía: ahí "no cambiaste nada"
            // sería decirle que apruebe justo lo que rechazó.
            const sinCambios = correcting && !rechazada && draft.trim() === mandable.trim();
            return (
              // La marca es una clase y no un ref porque `Card` no toma ref;
              // es la que busca `traerALaVista`.
              <Card key={a.id} className={expanded ? "pedido-abierto scroll-mt-6" : ""}>
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => toggle(a.id)}
                  className="flex w-full items-start justify-between gap-3 text-left"
                >
                  <div className="min-w-0 flex-1">
                    <h2 className="text-sm font-semibold text-ink">{a.title}</h2>
                    {summary && (
                      <p className="mt-0.5 text-sm text-ink-soft line-clamp-2">{summary}</p>
                    )}
                    {/* Decir qué hay detrás de la flecha. Sin esto el cliente
                        despliega a ciegas, y cuando lo que aparecía era el
                        mismo texto se sentía tonto ("pensé que no se abrió"). */}
                    <span className="mt-1 inline-flex items-center gap-1 text-[12px] font-semibold text-primary">
                      {expanded ? "Ocultar el detalle" : "Ver qué quiere hacer"}
                      <ChevronDown
                        className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`}
                      />
                    </span>
                  </div>
                  {waited && (
                    <span className="shrink-0 whitespace-nowrap pt-0.5 text-[12px] text-ink-soft">
                      espera {waited}
                    </span>
                  )}
                </button>

                {/* Le contestaste que no y el pedido sigue acá: el agente está
                    por volver con otra versión. Va arriba de todo lo del
                    detalle, plegado o no, porque es el estado de la tarjeta. */}
                {rechazo && <AvisoRechazado r={rechazo} nombreAgente={nombreAgente} />}

                {/* Por qué se frenó: sale del evento de bloqueo, no de que el
                    agente se acuerde de explicarlo. */}
                {expanded && motivo && (
                  <p className="mt-3 rounded-lg border border-c-amber bg-c-amber/30 px-3 py-2 text-[13px] text-c-amber-ink">
                    <span className="font-semibold">Por qué se frenó: </span>{motivo}
                  </p>
                )}

                {expanded && detalle === "cargando" && !body && (
                  <div className="mt-3"><Spinner /></div>
                )}

                {/* El pedido viene en markdown (un borrador de mail, un plan...):
                    se renderiza con el mismo componente que el chat. El recuadro
                    se queda con su scroll interno, y lo ancho (código, tablas,
                    KaTeX) ya trae su propio overflow-x, así que la página no se
                    corre. El `[&>div]` es el wrapper de <Markdown>: lo bajamos a
                    13px para no pisar la densidad de la card. */}
                {/* EL RECUADRO PUEDE SER LA VERSIÓN QUE YA RECHAZASTE, y eso
                    se dice. Acá abajo sólo entran las propuestas con cuadro
                    markdown, y al agente no se le puede exigir que lo use: si
                    contesta en prosa, lo de abajo sigue siendo lo viejo. Antes
                    la pantalla no decía nada y quedaba "8% / lunes 17" con
                    Aprobar debajo mientras la conversación decía "12% / lunes
                    24" dos renglones más abajo.

                    Y EL AVISO NO SE APAGA AL CORREGIR. Tenía `!correcting`, así
                    que tocar "Corregir y aprobar" —el botón que hace exactamente
                    lo que el aviso viene a evitar— lo hacía desaparecer. La
                    advertencia se iba justo en el paso en el que hacía falta. */}
                {expanded && body && rechazada && (
                  <p className="mt-3 rounded-lg border border-c-amber bg-c-amber/25 px-3 py-2 text-[12.5px] leading-snug text-c-amber-ink">
                    {correcting ? (
                      <>
                        <span className="font-semibold">Empezás de cero, a propósito.</span>{" "}
                        {negociacion?.contesto
                          ? "No te dejo puesto el texto que rechazaste. Lo que te contestó después está justo acá abajo, en “Lo que hablaron”: copiá de ahí lo que te sirva."
                          : "No te dejo puesto el texto que rechazaste. Escribí vos la versión que sí querés que use."}
                      </>
                    ) : (
                      <>
                        <span className="font-semibold">Le dijiste que no a esto.</span>{" "}
                        {negociacion?.contesto
                          ? "Lo que te contestó después está más abajo, en “Lo que hablaron”: fijate ahí cuál es la versión nueva."
                          : "Esperá la versión nueva; esto es lo que rechazaste."}
                      </>
                    )}
                  </p>
                )}

                {expanded && body && !correcting && (
                  <div className="mt-3 max-h-96 overflow-auto overscroll-contain rounded-lg bg-black/[0.03] p-3 [&>div]:text-[13px]">
                    <Markdown>{body}</Markdown>
                  </div>
                )}

                {/* Lo que hablaron después del pedido. Iba solo en el Tablero:
                    si le comentaste algo al agente y te contestó, tenés que
                    poder leerlo ACÁ, que es donde decidís.

                    Corrigiendo se esconde para no distraer — SALVO cuando lo que
                    estás corrigiendo es una propuesta que rechazaste: ahí la
                    versión nueva vive justamente en esta conversación, y
                    esconderla sería pedirle que escriba de memoria lo que el
                    agente le acaba de contestar. */}
                {expanded && (!correcting || rechazada) && charla.length > 0 && (
                  <div className="mt-3">
                    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
                      Lo que hablaron
                    </p>
                    <div className="flex flex-col gap-2">
                      {charla.map((c, i) => {
                        // Firmado `cliente` no quiere decir que lo haya escrito
                        // ella: aprobar-con-corrección y rechazar dejan ahí una
                        // instrucción para la máquina ("RECHAZADO POR TU
                        // CLIENTE. No hagas lo que pediste aprobar…"). Se
                        // muestra el rótulo de qué fue y SUS palabras, nada más.
                        // EL AUTOR VA SÍ O SÍ: sin él, el mismo filtro se le
                        // aplicaba a los comentarios del AGENTE, y como de un
                        // rechazo sólo se muestra el bloque del motivo —que un
                        // comentario suyo no tiene—, cualquier cosa que él
                        // escribiera arrancando con "RECHAZADO POR TU CLIENTE."
                        // salía como «Tu agente · Lo rechazaste» y NADA MÁS.
                        const { texto, rotulo } = leerComentario(c.body ?? "", c.author);
                        return (
                          <div key={`${c.created_at}-${i}`} className="rounded-lg border border-black/[0.07] px-3 py-2">
                            <p className="mb-0.5 text-[11px] font-semibold text-ink-soft">
                              {/* EL RÓTULO NO ERA BINARIO Y ACÁ SE LEÍA COMO SI
                                  LO FUERA. En la pantalla donde el cliente
                                  AUTORIZA, un comentario del fundador de la
                                  empresa —"Ojo que a Panadería Rivas le prometí
                                  el precio viejo hasta fin de mes"— salía
                                  firmado «Tu agente». El Tablero, con los
                                  mismos datos, lo mostraba bien: el rótulo
                                  bueno estaba en una sola de las dos
                                  pantallas. Ahora es el mismo, y vive en la
                                  lib. */}
                              {rotuloAutor(c.author, nombreAgente)}
                              {rotulo && <span className="font-normal"> · {rotulo}</span>}
                              {" · "}{timeAgo(c.created_at)}
                            </p>
                            {texto && (
                              <div className="[&>div]:text-[13px]"><Markdown>{texto}</Markdown></div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* En modo corrección se edita EL TEXTO QUE SE VA A MANDAR, no
                    la ficha entera. Antes acá aparecía el markdown completo
                    —`**Qué quiero hacer:**`, `| Si aprobás | … |`— y el cliente
                    que solo quería cambiar un número se encontraba con algo de
                    programador. Cmd/Ctrl+Enter confirma. */}
                {expanded && correcting && (
                  <div className="mt-3">
                    <p className="mb-1.5 text-[12.5px] font-semibold text-ink">
                      {rechazada
                        ? "Escribí el texto que sí querés que mande."
                        : "Este es el texto que se va a mandar. Cambiá lo que quieras."}
                    </p>
                    <textarea
                      autoFocus
                      rows={Math.min(16, Math.max(6, draft.split("\n").length + 2))}
                      aria-label="El texto que se va a mandar"
                      placeholder={rechazada ? "Escribí acá la versión que sí va" : undefined}
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                          doApproveWithCorrection(a, arranqueDelBorrador);
                        }
                        if (e.key === "Escape") stopCorrecting();
                      }}
                      className={`${inputCls} resize-y leading-relaxed`}
                    />
                    {/* La ficha que se conserva es la del pedido que ella
                        rechazó: prometerle que "se mantiene tal cual lo leíste
                        arriba" sería tranquilizarla con lo que no quiere. */}
                    {ficha && !rechazada && (
                      <p className="mt-1.5 text-[12px] leading-snug text-ink-soft">
                        El resto del pedido (para qué es y qué pasa si decís que sí) no se
                        toca: se mantiene tal cual lo leíste arriba.
                      </p>
                    )}
                  </div>
                )}

                {cardErrors[a.id] && (
                  <p className="mt-3 rounded-lg border border-c-coral bg-c-coral/40 px-3 py-2 text-[13px] text-c-coral-ink">
                    {cardErrors[a.id]}
                  </p>
                )}

                {expanded &&
                  (rejecting ? (
                    <div className="mt-3">
                      {/* Qué va a pasar, ANTES de escribir. Las dos formas de
                          decir que no terminan distinto, así que el texto
                          cambia con la casilla en vez de describir sólo una. */}
                      <p className="mb-1.5 text-[12.5px] leading-snug text-ink-soft">
                        Esto le llega como un mensaje tuyo en este mismo pedido.{" "}
                        {cerrarPedido
                          ? "Al cerrarlo, el pedido sale de esta lista y no te lo va a volver a proponer."
                          : "El pedido se queda acá, esperando tu ok, hasta que la versión que te traiga te sirva."}
                      </p>
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <input
                        autoFocus
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && doReject(a)}
                        placeholder={cerrarPedido
                          ? "Contale por qué no va"
                          : "Contale a tu agente por qué lo rechazás"}
                        className={inputCls + " flex-1"}
                      />
                      <div className="flex shrink-0 justify-end gap-2">
                        <Btn
                          kind="ghost"
                          size="sm"
                          disabled={rechazando === a.id}
                          onClick={() => {
                            setRejectingId(null);
                            setReason("");
                            setCerrarPedido(false);
                          }}
                        >
                          Cancelar
                        </Btn>
                        <Btn
                          kind="danger"
                          size="sm"
                          disabled={!reason.trim() || rechazando === a.id}
                          onClick={() => doReject(a)}
                        >
                          {rechazando === a.id
                            ? (cerrarPedido ? "Cerrando…" : "Mandando…")
                            : (cerrarPedido ? "Cerrar el pedido" : "Mandarle esto")}
                        </Btn>
                      </div>
                      </div>
                      {/* LA DECISIÓN DE CERRAR ES DEL CLIENTE, NO DEL MODELO
                          LEYENDO EL MOTIVO. Hay dos "no" distintos —"así no,
                          traeme otra" y "esto no va más"— y sin esta casilla
                          sólo existía el primero: un pedido rechazado de verdad
                          se quedaba para siempre en la lista con un botón
                          Aprobar vivo que ya no aprobaba nada. */}
                      <label className="mt-2.5 flex cursor-pointer items-start gap-2">
                        <input
                          type="checkbox"
                          checked={cerrarPedido}
                          onChange={(e) => setCerrarPedido(e.target.checked)}
                          className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-primary"
                        />
                        <span className="min-w-0">
                          <span className="text-[13px] font-semibold text-ink">
                            Cerrar el pedido: esto no va más, no me lo vuelvas a proponer
                          </span>
                          <span className="mt-0.5 block text-[12px] leading-snug text-ink-soft">
                            Dejala sin marcar si lo que querés es otra versión. Marcala si el
                            pedido no va: se cierra, desaparece de esta lista y tu agente no te lo
                            vuelve a proponer. Si más adelante cambiás de idea, pediselo por el chat.
                          </span>
                        </span>
                      </label>
                    </div>
                  ) : correcting ? (
                    <>
                      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                        {sinCambios && (
                          <span className="mr-auto text-[12px] text-ink-soft">
                            No cambiaste nada — usá Aprobar
                          </span>
                        )}
                        <Btn kind="ghost" size="sm" onClick={stopCorrecting}>
                          Cancelar
                        </Btn>
                        <Btn
                          kind="primary"
                          size="sm"
                          disabled={!draft.trim() || sinCambios}
                          onClick={() => doApproveWithCorrection(a, arranqueDelBorrador)}
                        >
                          Aprobar con esta versión
                        </Btn>
                      </div>
                      {/* Honestidad: el pedido original queda como está; lo que
                          manda es tu comentario. Nada de "editamos el ticket". */}
                      <p className="mt-2 text-[12px] leading-snug text-ink-soft">
                        Tu versión queda asentada como comentario y es la que el agente tiene que
                        usar. El texto original del pedido no se modifica.
                      </p>
                    </>
                  ) : (
                    <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                      <span className="mr-auto">
                        <CopiarLink titulo="Copiar el link de este pedido" />
                      </span>
                      <Btn
                        kind="danger"
                        size="sm"
                        onClick={() => {
                          setRejectingId(a.id);
                          setReason("");
                          setCerrarPedido(false);
                        }}
                      >
                        {rechazo ? "Decirle que no otra vez" : "Rechazar"}
                      </Btn>
                      {body && (
                        <Btn
                          kind="secondary"
                          size="sm"
                          onClick={() => {
                            setRejectingId(null);
                            setReason("");
                            setCorrectingId(a.id);
                            // Solo el texto, no la ficha — y vacío si lo único
                            // que hay para copiar es lo que ella ya rechazó.
                            setDraft(arranqueDelBorrador);
                          }}
                        >
                          <PencilLine className="h-3.5 w-3.5" />
                          Corregir y aprobar
                        </Btn>
                      )}
                      <Btn kind="primary" size="sm" onClick={() => doApprove(a)}>
                        Aprobar
                      </Btn>
                    </div>
                  ))}
              </Card>
            );
          })}

          {/* Lo que pediste vos. No lleva Aprobar/Rechazar: no tenés que
              autorizarte a vos misma — está esperándonos a nosotros. */}
          {pedidos !== null && pedidos.length > 0 && (
            <section className="mt-4">
              <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-soft">
                Lo que pediste
              </h2>
              <div className="flex flex-col gap-2">
                {pedidos.map((p) => (
                  <Card key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <span className="min-w-0 flex-1 text-sm font-semibold text-ink">{p.title}</span>
                    <Chip tone="amber">
                      <Clock className="h-3 w-3" /> Lo estamos viendo
                    </Chip>
                    <span className="w-full text-[12px] text-ink-soft">
                      Lo pediste {timeAgo(p.created_at)}. Te escribimos cuando esté; no tenés
                      que hacer nada.
                    </span>
                  </Card>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
