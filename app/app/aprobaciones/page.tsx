"use client";

// Aprobaciones: tareas que el agente frenó esperando el ok del cliente.
// PRINCIPIO CERO: domain-free — el body se muestra tal cual (puede ser un
// mail, un pago, un post...); el portal no asume qué es.
// Contrato adapter (docs/specs/03-aprobaciones.md):
//   GET  /portal/approvals → { approvals: [{ id, title, summary, body, created_at }] }
//   POST /portal/approvals/{id}/approve · POST /portal/approvals/{id}/reject { reason }
// Semántica honesta: aprobar SOLO comenta y desbloquea el ticket; qué pasa
// después lo deciden las reglas del agente. El copy no promete "se envía ya".

import { useCallback, useEffect, useState } from "react";
import { loadConfig, getApprovals, approve, reject, type PortalConfig } from "../lib/agent";
import { Btn, Card, EmptyState, ErrorState, Spinner } from "../lib/ui";

const REFRESH_MS = 30_000;

type Approval = {
  id: string;
  title: string;
  summary: string;
  body: string;
  created_at: string;
};

function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return "hace un momento";
  const m = Math.floor(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return h === 1 ? "hace 1 hora" : `hace ${h} horas`;
  const d = Math.floor(h / 24);
  return d === 1 ? "hace 1 día" : `hace ${d} días`;
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
  // Optimismo: ids que ya salieron de la lista (POST en vuelo o confirmado).
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [cardErrors, setCardErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    setCfg(loadConfig()); // si es null, el layout muestra el login
  }, []);

  const load = useCallback(async (c: PortalConfig) => {
    try {
      const data = await getApprovals(c);
      const list = (Array.isArray(data.approvals) ? data.approvals : []) as Approval[];
      // La que más espera, arriba.
      list.sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""));
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
    const t = setInterval(() => load(cfg), REFRESH_MS);
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

  if (!cfg) return <Spinner />;

  const visible = approvals ? approvals.filter((a) => !hidden.has(a.id)) : null;

  return (
    <div className="max-w-3xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-extrabold text-ink tracking-tight">Aprobaciones</h1>
        <p className="text-sm text-ink-soft mt-1">
          Tu agente frenó estas tareas hasta tener tu ok. Aprobar las desbloquea;
          el próximo paso lo deciden sus reglas.
        </p>
      </header>

      {visible === null ? (
        loadError ? (
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
          emoji="✋"
          title="Nada esperando tu aprobación"
          hint="Cuando tu agente necesite tu ok, lo vas a ver acá."
        />
      ) : (
        <div className="flex flex-col gap-4">
          {visible.map((a) => {
            const waited = timeAgo(a.created_at);
            const expanded = expandedId === a.id;
            return (
              <Card key={a.id} tone="surface">
                <button
                  type="button"
                  onClick={() => setExpandedId(expanded ? null : a.id)}
                  className="w-full text-left"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <h2 className="text-lg font-extrabold text-ink leading-snug">{a.title}</h2>
                      {a.summary && <p className="text-sm text-ink-soft mt-1">{a.summary}</p>}
                    </div>
                    {waited && (
                      <span className="shrink-0 whitespace-nowrap text-xs text-ink-soft mt-1.5">
                        espera {waited}
                      </span>
                    )}
                  </div>
                  <p className="text-xs font-bold text-primary mt-3">
                    {expanded ? "Ocultar contenido ▴" : "Ver contenido completo ▾"}
                  </p>
                </button>

                {expanded && (
                  <pre className="mt-3 rounded-2xl bg-surface p-4 font-sans text-[13px] leading-relaxed text-ink whitespace-pre-wrap break-words">
                    {a.body}
                  </pre>
                )}

                {cardErrors[a.id] && (
                  <p className="mt-3 rounded-pill bg-c-coral px-4 py-2 text-sm font-bold text-c-coral-ink">
                    {cardErrors[a.id]}
                  </p>
                )}

                {rejectingId === a.id ? (
                  <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                    <input
                      autoFocus
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && doReject(a)}
                      placeholder="Contale a tu agente por qué lo rechazás"
                      className="flex-1 rounded-pill border border-c-coral bg-surface px-4 py-2 text-sm text-ink outline-none focus:border-primary"
                    />
                    <div className="flex gap-2">
                      <Btn kind="danger" disabled={!reason.trim()} onClick={() => doReject(a)}>
                        Rechazar
                      </Btn>
                      <Btn
                        kind="ghost"
                        onClick={() => {
                          setRejectingId(null);
                          setReason("");
                        }}
                      >
                        Cancelar
                      </Btn>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 flex gap-2">
                    <Btn onClick={() => doApprove(a)}>Aprobar</Btn>
                    <Btn
                      kind="danger"
                      onClick={() => {
                        setRejectingId(a.id);
                        setReason("");
                      }}
                    >
                      Rechazar
                    </Btn>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
