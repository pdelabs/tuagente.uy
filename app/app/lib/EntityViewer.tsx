"use client";

// Modal que abre un chip de entidad: el ticket con sus comentarios, o el
// archivo del workspace. Renderiza markdown (los agentes escriben markdown en
// descripciones, comentarios y reportes) y código con highlight.

import { useEffect, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import {
  getTicketDetail, getFileText, getArtifact,
  type ArtifactMeta, type PortalConfig, type TicketDetail,
} from "./agent";
import { EntityContext, type Entity } from "./entities";
import { loadAgentName } from "./onboarding";
import { Chip, IconBtn, Modal, Spinner } from "./ui";
import Markdown from "./Markdown";
import CodeBlock from "./CodeBlock";

// Las firmas internas del motor ("default", "worker") son todas la misma
// persona para el cliente: su agente, con el nombre que le puso. "cliente" es
// él; "portal" es la auditoría automática.
function rotuloAutorViewer(author: string): string {
  const a = (author || "").trim().toLowerCase();
  if (a === "cliente") return "Vos";
  if (a === "portal") return "Portal";
  if (["", "default", "worker", "agent", "hermes"].includes(a)) {
    return loadAgentName() || "Tu agente";
  }
  return author;
}
import Artifact from "./Artifact";

export function EntityProvider({ cfg, children }: { cfg: PortalConfig; children: ReactNode }) {
  const [open, setOpen] = useState<Entity | null>(null);
  return (
    <EntityContext.Provider value={setOpen}>
      {children}
      {open && <EntityViewer cfg={cfg} entity={open} onClose={() => setOpen(null)} />}
    </EntityContext.Provider>
  );
}

function fmtDate(value: number | string): string {
  const n = typeof value === "number" ? value : Number(value);
  const d = new Date(Number.isFinite(n) ? (n > 1e12 ? n : n * 1000) : String(value));
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString("es-UY", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
}

const STATUS_TONE: Record<string, "violet" | "amber" | "green" | "neutral"> = {
  blocked: "violet", ready: "amber", running: "amber", done: "green",
};

export const KIND_LABEL: Record<string, string> = {
  chart: "Gráfico", table: "Tabla", report: "Informe",
  dashboard: "Panel", diagram: "Diagrama", other: "Artefacto",
};

const CODE_EXT: Record<string, string> = {
  py: "python", ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx",
  sh: "bash", json: "json", yaml: "yaml", yml: "yaml", sql: "sql",
  html: "html", css: "css", diff: "diff",
};

/** Contenido de un archivo: markdown se dibuja, código se resalta. */
export function FileBody({ path, text }: { path: string; text: string }) {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "md" || ext === "markdown") return <Markdown>{text}</Markdown>;
  if (CODE_EXT[ext]) return <CodeBlock code={text} lang={CODE_EXT[ext]} />;
  return (
    <pre className="whitespace-pre-wrap break-words font-mono text-[12.5px] leading-relaxed text-ink">
      {text}
    </pre>
  );
}

function EntityViewer({ cfg, entity, onClose }: {
  cfg: PortalConfig; entity: Entity; onClose: () => void;
}) {
  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [artifact, setArtifact] = useState<(ArtifactMeta & { html: string }) | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setErr(null);
    // "conexion" nunca llega acá: su chip ES la tarjeta y no abre modal.
    if (entity.kind === "conexion") return;
    const p =
      entity.kind === "ticket"
        ? getTicketDetail(cfg, entity.id).then((d) => { if (alive) setTicket(d); })
        : entity.kind === "artifact"
          ? getArtifact(cfg, entity.id).then((a) => { if (alive) setArtifact(a); })
          : getFileText(cfg, entity.path).then((t) => { if (alive) setText(t); });
    p.catch((e) => {
      if (!alive) return;
      const msg = e instanceof Error ? e.message : "error";
      const faltante = {
        ticket: "Ese ticket ya no existe.",
        artifact: "Ese artefacto ya no está disponible.",
        file: "No encontré ese archivo.",
        conexion: "",
      }[entity.kind];
      setErr(msg.startsWith("404") ? faltante : msg);
    });
    return () => { alive = false; };
  }, [cfg, entity]);

  if (entity.kind === "conexion") return null; // su chip ES la tarjeta

  const title =
    entity.kind === "ticket" ? ticket?.ticket.title ?? entity.id
      : entity.kind === "artifact" ? artifact?.title ?? entity.id
        : entity.path;
  const loading = !err && (
    entity.kind === "ticket" ? !ticket
      : entity.kind === "artifact" ? !artifact
        : text === null
  );

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
            ) : entity.kind === "artifact" ? (
              <>
                <Chip tone="violet">{KIND_LABEL[artifact?.kind ?? ""] ?? "Artefacto"}</Chip>
                {artifact && (
                  <span className="text-[11px] text-ink-soft">
                    {fmtDate(artifact.created_at)}
                  </span>
                )}
              </>
            ) : (
              <Chip>archivo</Chip>
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
        ) : entity.kind === "artifact" ? (
          <>
            {artifact?.summary && (
              <p className="mb-3 text-sm text-ink-soft">{artifact.summary}</p>
            )}
            <Artifact code={artifact?.html ?? ""} lang="html" />
          </>
        ) : entity.kind === "file" ? (
          <FileBody path={entity.path} text={text ?? ""} />
        ) : (
          <>
            <Markdown>{ticket?.ticket.body || "_(sin descripción)_"}</Markdown>
            {!!ticket?.comments.length && (
              <div className="mt-5 border-t border-black/[0.07] pt-4">
                <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
                  Comentarios
                </p>
                <div className="flex flex-col gap-4">
                  {ticket.comments.map((c, i) => (
                    <div key={i}>
                      <p className="mb-0.5 text-[13px] font-semibold text-ink">
                        {rotuloAutorViewer(c.author)}{" "}
                        <span className="font-normal text-ink-soft">{fmtDate(c.created_at)}</span>
                      </p>
                      <Markdown>{c.body}</Markdown>
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
