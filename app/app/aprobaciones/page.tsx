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

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, Clock, Hand, PencilLine } from "lucide-react";
import {
  loadConfig, getApprovals, getTicketDetail, approve, reject,
  MARCA_PEDIDO, PREFIJO_PEDIDO,
  type PortalConfig, type TicketDetail,
} from "../lib/agent";
import { Btn, Card, Chip, EmptyState, ErrorState, PageHeader, Spinner, inputCls } from "../lib/ui";
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

/** ¿Esto lo pidió el cliente (y está en trámite nuestro), o es el agente
 *  pidiéndole permiso? Son dos cosas distintas y no pueden verse igual. */
function esPedidoDelCliente(a: Approval): boolean {
  const body = a.body ?? "";
  return body.includes(MARCA_PEDIDO) || body.trimStart().startsWith(PREFIJO_PEDIDO);
}

// Los marcadores que el CLI deja como comentario ("BLOCKED: …") son ruido de
// máquina: el motivo ya se muestra arriba, con sus palabras.
const esMarcador = (s: string) => /^\s*(BLOCKED|UNBLOCKED|BLOQUEADO)\s*:/i.test(s);
const esDelCliente = (autor: string) => /^(cliente|portal|user|usuario)$/i.test(autor.trim());

/** Qué le estamos pidiendo que apruebe. La skill `aprobacion` deja el pedido
 *  formateado COMO COMENTARIO del ticket, no en su descripción — por eso esta
 *  pantalla mostraba el resumen dos veces y el mail no aparecía por ningún
 *  lado. Tomamos el primer comentario del agente que no sea un marcador. */
function elegirPropuesta(d: TicketDetail | undefined, fallback: string): string {
  const c = (d?.comments ?? []).find(
    (x) => !esDelCliente(x.author) && x.body?.trim() && !esMarcador(x.body));
  return (c?.body ?? fallback ?? "").trim();
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

export default function AprobacionesPage() {
  const [cfg, setCfg] = useState<PortalConfig | null>(null);
  const [approvals, setApprovals] = useState<Approval[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  // Corrección en curso: la card cuyo body está editable y el texto tipeado.
  const [correctingId, setCorrectingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  // Optimismo: ids que ya salieron de la lista (POST en vuelo o confirmado).
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [cardErrors, setCardErrors] = useState<Record<string, string>>({});
  // Detalle del ticket por id: es donde vive de verdad lo que hay que aprobar
  // (la skill lo deja como comentario). Se trae al desplegar, una sola vez.
  const [detalles, setDetalles] = useState<Record<string, TicketDetail | "cargando">>({});

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

  const doApprove = (a: Approval) => {
    if (!cfg) return;
    setCardError(a.id, null);
    hide(a.id); // sale de la lista ya; el refresh confirma
    approve(cfg, a.id).catch((e) => {
      unhide(a.id);
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
    approveWithCorrection(cfg, a.id, texto).catch((e) => {
      unhide(a.id);
      setExpandedId(a.id);
      setCorrectingId(a.id);
      setDraft(texto);
      setCardError(a.id, `No se pudo aprobar con correcciones: ${describeError(e)}`);
    });
  };

  const doReject = (a: Approval) => {
    if (!cfg) return;
    const motivo = reason.trim();
    if (!motivo) return;
    setCardError(a.id, null);
    setRejectingId(null);
    setReason("");
    hide(a.id);
    reject(cfg, a.id, motivo).catch((e) => {
      unhide(a.id);
      setCardError(a.id, `No se pudo rechazar: ${describeError(e)}`);
    });
  };

  /** Trae el detalle una vez por ticket. Si falla, la card cae al body de
   *  siempre: nunca dejamos al cliente sin nada que leer. */
  const traerDetalle = useCallback((id: string) => {
    if (!cfg || detalles[id]) return;
    setDetalles((d) => ({ ...d, [id]: "cargando" }));
    getTicketDetail(cfg, id)
      .then((d) => setDetalles((prev) => ({ ...prev, [id]: d })))
      .catch(() => setDetalles((prev) => {
        const next = { ...prev };
        delete next[id]; // sin cache de la falla: al reabrir se reintenta
        return next;
      }));
  }, [cfg, detalles]);

  const toggle = (id: string) => {
    if (expandedId !== id) traerDetalle(id);
    setExpandedId((cur) => (cur === id ? null : id));
    if (rejectingId === id) {
      setRejectingId(null);
      setReason("");
    }
    if (correctingId === id) stopCorrecting(); // plegar descarta la edición
  };

  const visible = approvals ? approvals.filter((a) => !hidden.has(a.id)) : null;
  // Dos listas distintas: lo que el agente te pide permiso para hacer, y lo
  // que vos pediste y está en nuestra cancha. Mezclarlas ponía los mismos
  // botones abajo de "mandá este mail a un desconocido" y de "conectame el
  // correo", que para el cliente son cosas muy distintas.
  const pendientes = visible?.filter((a) => !esPedidoDelCliente(a)) ?? null;
  const pedidos = visible?.filter(esPedidoDelCliente) ?? null;

  return (
    <div className="mx-auto max-w-3xl px-6 py-6 md:px-8">
      <PageHeader
        title="Aprobaciones"
        subtitle="Lo que tu agente frenó para preguntarte. Abrí cada uno: adentro está el texto completo de lo que quiere hacer."
      />

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
        <EmptyState
          icon={Hand}
          title="Nada esperando tu aprobación"
          hint="Cuando tu agente necesite tu ok, lo vas a ver acá."
        />
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
            const det = detalle === "cargando" ? undefined : detalle;
            // Lo que hay que leer para decidir: el comentario del agente con el
            // pedido formateado. Antes se mostraba `a.body`, que es la
            // descripción del ticket — o sea, el mismo resumen de arriba
            // repetido. Desplegar no aportaba nada y el mail no estaba.
            const body = elegirPropuesta(det, a.body?.trim() ?? "");
            const charla = conversacion(det, body);
            const motivo = det?.outcome?.summary?.trim() ?? "";
            const correcting = correctingId === a.id;
            // Sin cambios reales no hay nada que corregir: es una aprobación común.
            const sinCambios = correcting && draft.trim() === body;
            return (
              <Card key={a.id}>
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
                {expanded && body && !correcting && (
                  <div className="mt-3 max-h-96 overflow-auto overscroll-contain rounded-lg bg-black/[0.03] p-3 [&>div]:text-[13px]">
                    <Markdown>{body}</Markdown>
                  </div>
                )}

                {/* Lo que hablaron después del pedido. Iba solo en el Tablero:
                    si le comentaste algo al agente y te contestó, tenés que
                    poder leerlo ACÁ, que es donde decidís. */}
                {expanded && !correcting && charla.length > 0 && (
                  <div className="mt-3">
                    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
                      Lo que hablaron
                    </p>
                    <div className="flex flex-col gap-2">
                      {charla.map((c, i) => (
                        <div key={`${c.created_at}-${i}`} className="rounded-lg border border-black/[0.07] px-3 py-2">
                          <p className="mb-0.5 text-[11px] font-semibold text-ink-soft">
                            {esDelCliente(c.author) ? "Vos" : "Tu agente"}
                            {" · "}{timeAgo(c.created_at)}
                          </p>
                          <div className="[&>div]:text-[13px]"><Markdown>{c.body}</Markdown></div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* En modo corrección el recuadro se vuelve editable: se edita
                    el texto crudo (markdown incluido), que es exactamente lo que
                    va a leer el agente. Cmd/Ctrl+Enter confirma. */}
                {expanded && correcting && (
                  <textarea
                    autoFocus
                    rows={12}
                    aria-label="Versión corregida"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) doApproveWithCorrection(a, body);
                      if (e.key === "Escape") stopCorrecting();
                    }}
                    className={`${inputCls} mt-3 resize-y leading-relaxed`}
                  />
                )}

                {cardErrors[a.id] && (
                  <p className="mt-3 rounded-lg border border-c-coral bg-c-coral/40 px-3 py-2 text-[13px] text-c-coral-ink">
                    {cardErrors[a.id]}
                  </p>
                )}

                {expanded &&
                  (rejecting ? (
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                      <input
                        autoFocus
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && doReject(a)}
                        placeholder="Contale a tu agente por qué lo rechazás"
                        className={inputCls + " flex-1"}
                      />
                      <div className="flex shrink-0 justify-end gap-2">
                        <Btn
                          kind="ghost"
                          size="sm"
                          onClick={() => {
                            setRejectingId(null);
                            setReason("");
                          }}
                        >
                          Cancelar
                        </Btn>
                        <Btn kind="danger" size="sm" disabled={!reason.trim()} onClick={() => doReject(a)}>
                          Confirmar rechazo
                        </Btn>
                      </div>
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
                          onClick={() => doApproveWithCorrection(a, body)}
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
                    <div className="mt-3 flex flex-wrap justify-end gap-2">
                      <Btn
                        kind="danger"
                        size="sm"
                        onClick={() => {
                          setRejectingId(a.id);
                          setReason("");
                        }}
                      >
                        Rechazar
                      </Btn>
                      {body && (
                        <Btn
                          kind="secondary"
                          size="sm"
                          onClick={() => {
                            setRejectingId(null);
                            setReason("");
                            setCorrectingId(a.id);
                            setDraft(body); // arranca del borrador tal cual
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
