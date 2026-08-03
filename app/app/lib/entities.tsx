"use client";

// Entidades del agente dentro del chat: cuando menciona un ticket o un archivo
// de su workspace, lo mostramos como chip clicable que abre el detalle acá
// mismo. Genérico: solo depende de convenciones de Hermes (ids t_xxx y rutas
// del workspace), nada del dominio de un cliente puntual.

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { FileText, Ticket as TicketIcon, X } from "lucide-react";
import {
  getTicketDetail, getFileText,
  type PortalConfig, type TicketDetail,
} from "./agent";
import { Chip, IconBtn, Modal, Spinner } from "./ui";

export type Entity =
  | { kind: "ticket"; id: string }
  | { kind: "file"; path: string };

const TICKET_RE = /^t_[0-9a-f]{6,16}$/i;
// Rutas del workspace: el agente las escribe con o sin prefijo.
const FILE_RE =
  /^(?:\/opt\/data\/workspace\/|workspace\/|\.\/)?([\w./-]+\.(?:md|txt|csv|json|ya?ml|log|py|ts|tsx|js|sh|sql|html))$/i;

/** ¿Este texto suelto es una entidad del agente? */
export function detectEntity(raw: string): Entity | null {
  const text = raw.trim();
  if (!text || /\s/.test(text)) return null;
  if (TICKET_RE.test(text)) return { kind: "ticket", id: text };
  const m = FILE_RE.exec(text);
  if (m && m[1].includes(".")) return { kind: "file", path: m[1] };
  return null;
}

const EntityCtx = createContext<((e: Entity) => void) | null>(null);
export const useOpenEntity = () => useContext(EntityCtx);

export function EntityProvider({ cfg, children }: { cfg: PortalConfig; children: ReactNode }) {
  const [open, setOpen] = useState<Entity | null>(null);
  return (
    <EntityCtx.Provider value={setOpen}>
      {children}
      {open && <EntityViewer cfg={cfg} entity={open} onClose={() => setOpen(null)} />}
    </EntityCtx.Provider>
  );
}

export function EntityChip({ entity, label }: { entity: Entity; label: string }) {
  const open = useOpenEntity();
  const Icon = entity.kind === "ticket" ? TicketIcon : FileText;
  if (!open) {
    return (
      <code className="rounded bg-black/[0.06] px-1.5 py-0.5 font-mono text-[0.88em] text-ink">
        {label}
      </code>
    );
  }
  return (
    <button
      onClick={() => open(entity)}
      title={entity.kind === "ticket" ? "Ver el ticket" : "Ver el archivo"}
      className="inline-flex max-w-full items-center gap-1 rounded-md border border-c-violet bg-c-violet/40 px-1.5 py-0.5 align-middle font-mono text-[0.85em] text-primary transition hover:border-primary hover:bg-c-violet"
    >
      <Icon className="h-3 w-3 shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  );
}

function fmtDate(epochSeconds: number | string): string {
  const n = typeof epochSeconds === "number" ? epochSeconds : Number(epochSeconds);
  const d = new Date(Number.isFinite(n) ? (n > 1e12 ? n : n * 1000) : String(epochSeconds));
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString("es-UY", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

const STATUS_TONE: Record<string, "violet" | "amber" | "green" | "neutral"> = {
  blocked: "violet", ready: "amber", running: "amber", done: "green",
};

function EntityViewer({ cfg, entity, onClose }: {
  cfg: PortalConfig; entity: Entity; onClose: () => void;
}) {
  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setErr(null);
    const p = entity.kind === "ticket"
      ? getTicketDetail(cfg, entity.id).then((d) => { if (alive) setTicket(d); })
      : getFileText(cfg, entity.path).then((t) => { if (alive) setText(t); });
    p.catch((e) => {
      if (!alive) return;
      const msg = e instanceof Error ? e.message : "error";
      setErr(
        msg.startsWith("404")
          ? entity.kind === "ticket"
            ? "Ese ticket ya no existe."
            : "No encontré ese archivo en el workspace."
          : msg,
      );
    });
    return () => { alive = false; };
  }, [cfg, entity]);

  const title = entity.kind === "ticket" ? ticket?.ticket.title ?? entity.id : entity.path;
  const loading = !err && (entity.kind === "ticket" ? !ticket : text === null);

  return (
    <Modal onClose={onClose} wide>
      <div className="flex items-start gap-3 border-b border-black/[0.07] px-5 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink">{title}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {entity.kind === "ticket" ? (
              <>
                <Chip tone={STATUS_TONE[ticket?.ticket.status ?? ""] ?? "neutral"}>
                  {ticket?.ticket.status ?? "ticket"}
                </Chip>
                {ticket?.ticket.tenant && <Chip>{ticket.ticket.tenant}</Chip>}
                {ticket && (
                  <span className="text-[11px] text-ink-soft">
                    {fmtDate(ticket.ticket.created_at)}
                  </span>
                )}
              </>
            ) : (
              <Chip>archivo del workspace</Chip>
            )}
          </div>
        </div>
        <IconBtn label="Cerrar" onClick={onClose}><X className="h-4 w-4" /></IconBtn>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {err ? (
          <p className="py-6 text-center text-sm text-ink-soft">{err}</p>
        ) : loading ? (
          <Spinner />
        ) : entity.kind === "file" ? (
          <pre className="whitespace-pre-wrap break-words font-mono text-[12.5px] leading-relaxed text-ink">
            {text}
          </pre>
        ) : (
          <>
            <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-ink">
              {ticket?.ticket.body || "(sin descripción)"}
            </pre>
            {!!ticket?.comments.length && (
              <div className="mt-5">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
                  Comentarios
                </p>
                <div className="flex flex-col gap-3">
                  {ticket.comments.map((c, i) => (
                    <div key={i}>
                      <p className="text-[13px] font-semibold text-ink">
                        {c.author}{" "}
                        <span className="font-normal text-ink-soft">{fmtDate(c.created_at)}</span>
                      </p>
                      <pre className="whitespace-pre-wrap break-words font-sans text-[13px] leading-relaxed text-ink-soft">
                        {c.body}
                      </pre>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
