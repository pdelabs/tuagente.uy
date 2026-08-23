"use client";

// The modal an entity chip opens: the ticket with its comments, or the
// workspace file. Renders markdown (agents write markdown in descriptions,
// comments and reports) and code with highlighting.

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Download, File as FileIcon, X } from "lucide-react";
import {
  isClientRequest, getTicketDetail, getFileBytes, getFileText, getArtifact, authorLabel,
  type ArtifactMeta, type PortalConfig, type TicketDetail,
} from "./agent";
import { EntityContext, isImage, type Entity } from "./entities";
import { taskStatus, dateTime, artifactLabel } from "./labels";
import Spreadsheet, { CsvPreview } from "./Spreadsheet";
import { Btn } from "./ui";
import { loadAgentName } from "./onboarding";
import { Chip, IconBtn, Modal, Spinner } from "./ui";
import { CopyUrl, PARAM, urlFor } from "./routes";
import Markdown from "./Markdown";
import CodeBlock from "./CodeBlock";

// The third copy of "who wrote this" used to live here, and it was the one
// that drifted the most: `portal` -- the audit-trail entry for a client
// action -- showed up as "Portal", a fourth person the client doesn't know,
// and "auto-decomposer" came out raw. Now it's the same label as the Board's
// and Approvals': `authorLabel` from `lib/agent.ts`.
const viewerAuthorLabel = (author: string) =>
  authorLabel(author, loadAgentName() || "Tu agente");

/** The same banner the Board puts on this task, in one line, so the two
 *  screens can't say different things about the same ticket. */
const ticketStatus = (t: { status: string; body?: string | null }) =>
  taskStatus(t.status, isClientRequest(t.body));
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

// THE SAME HOUR, THREE HOURS APART, ONE CLICK AWAY. Activity's row said
// "11:50" and this modal -- which that same row opens -- said "13 ago.,
// 08:50", because here the `created_at` values (bare epoch, no offset) were
// formatted with the viewer's clock. Now they're read on the business's
// clock, like the rest of the portal.
const fmtDate = (value: number | string) => dateTime(value);

const CODE_EXT: Record<string, string> = {
  py: "python", ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx",
  sh: "bash", json: "json", yaml: "yaml", yml: "yaml", sql: "sql",
  html: "html", css: "css", diff: "diff",
};

/** What is NOT text: it gets downloaded, not read. `csv`/`tsv` are left out on
 *  purpose -- they're text and get drawn as a table. */
const NOT_TEXT =
  /\.(xlsx|xls|ods|docx|doc|odt|pptx|ppt|odp|pdf|rtf|zip|gz|tar|7z|rar|mp3|wav|ogg|m4a|mp4|mov|webm|ics)$/i;
const IS_SPREADSHEET = /\.(xlsx|xls)$/i;
const IS_TEXT_TABLE = /\.(csv|tsv)$/i;

/** Download a workspace file exactly as it is, byte for byte.
 *
 *  Goes through `getFileBytes` and NOT through the already-loaded text:
 *  `res.text()` decodes as UTF-8 and on a binary every invalid byte turns
 *  into U+FFFD -- the file comes down broken even though the adapter sent it
 *  intact. */
async function downloadFile(cfg: PortalConfig, path: string) {
  const bytes = await getFileBytes(cfg, path);
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = path.split("/").pop() || "archivo";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** The image the agent just made, shown here.
 *
 *  The bytes come with a bearer token, so `src` can't point straight at the
 *  adapter: they're fetched and turned into a blob. Before, this said "no
 *  preview" and the client had to download their own banner just to see it. */
export function AgentImage({ cfg, path }: { cfg: PortalConfig; path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let alive = true;
    let created = "";
    getFileBytes(cfg, path)
      .then((b) => {
        if (!alive) return;
        created = URL.createObjectURL(new Blob([b]));
        setUrl(created);
      })
      .catch(() => { if (alive) setErr(true); });
    return () => { alive = false; if (created) URL.revokeObjectURL(created); };
  }, [cfg, path]);

  if (err) return <p className="py-6 text-center text-sm text-ink-soft">No pude mostrar la imagen.</p>;
  if (!url) return <div className="h-48 w-full animate-pulse rounded-lg bg-black/[0.04]" />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={path.split("/").pop() || ""}
      className="mx-auto block h-auto max-w-full rounded-lg border border-black/[0.07]"
    />
  );
}

/** A file's content: markdown gets rendered, code gets highlighted. */
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

/** Where each entity really lives. It's the link that gets shared and the one
 *  the agent quotes (see `docs/portal-routes.md`). */
function canonicalUrlOf(entity: Entity): string {
  if (entity.kind === "ticket") return urlFor("/app/pipeline", { [PARAM.task]: entity.id });
  if (entity.kind === "artifact") {
    return urlFor("/app/artifacts", { [PARAM.artifact]: entity.id });
  }
  if (entity.kind === "file") return urlFor("/app/files", { [PARAM.file]: entity.path });
  return urlFor("/app/connections", { [PARAM.connection]: entity.id });
}

function EntityViewer({ cfg, entity, onClose }: {
  cfg: PortalConfig; entity: Entity; onClose: () => void;
}) {
  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [artifact, setArtifact] = useState<(ArtifactMeta & { html: string }) | null>(null);
  const [sheet, setSheet] = useState<ArrayBuffer | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadErr, setDownloadErr] = useState<string | null>(null);

  const isFile = entity.kind === "file";
  const path = isFile ? entity.path : "";
  const isPhoto = isFile && isImage(path);
  const isBinarySpreadsheet = isFile && IS_SPREADSHEET.test(path);
  // Neither text, image, nor spreadsheet: it only gets downloaded.
  const downloadOnly = isFile && NOT_TEXT.test(path) && !isBinarySpreadsheet;

  useEffect(() => {
    let alive = true;
    setErr(null);
    // "connection" never reaches here: its chip IS the card and opens no modal.
    if (entity.kind === "connection" || entity.kind === "permissions"
        || entity.kind === "capability") return;
    // A photo or a PDF isn't requested as text: it's shown or downloaded.
    if (isPhoto || downloadOnly) return;
    const p =
      entity.kind === "ticket"
        ? getTicketDetail(cfg, entity.id).then((d) => { if (alive) setTicket(d); })
        : entity.kind === "artifact"
          ? getArtifact(cfg, entity.id).then((a) => { if (alive) setArtifact(a); })
          : isBinarySpreadsheet
            ? getFileBytes(cfg, entity.path).then((b) => { if (alive) setSheet(b); })
            : getFileText(cfg, entity.path).then((t) => { if (alive) setText(t); });
    p.catch((e) => {
      if (!alive) return;
      const msg = e instanceof Error ? e.message : "error";
      const missingMessage = {
        ticket: "Esa tarea ya no existe.",
        artifact: "Esa visualización ya no está disponible.",
        file: "No encontré ese archivo.",
        connection: "",
        permissions: "",
        capability: "",
      }[entity.kind];
      setErr(msg.startsWith("404") ? missingMessage : msg);
    });
    return () => { alive = false; };
  }, [cfg, entity, isPhoto, downloadOnly, isBinarySpreadsheet]);

  const download = useCallback(async () => {
    if (!isFile) return;
    setDownloading(true);
    setDownloadErr(null);
    try {
      await downloadFile(cfg, path);
    } catch (e) {
      setDownloadErr(e instanceof Error ? e.message : String(e));
    } finally {
      setDownloading(false);
    }
  }, [cfg, isFile, path]);

  if (entity.kind === "connection" || entity.kind === "permissions"
      || entity.kind === "capability") return null; // its chip IS the card

  const title =
    entity.kind === "ticket" ? ticket?.ticket.title ?? entity.id
      : entity.kind === "artifact" ? artifact?.title ?? entity.id
        : entity.path;
  const loading = !err && (
    entity.kind === "ticket" ? !ticket
      : entity.kind === "artifact" ? !artifact
        : isPhoto || downloadOnly ? false
          : isBinarySpreadsheet ? sheet === null
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
                {/* THE CHIP SAID `done`. In English and raw, one click away from
                    Activity. Now it says the same thing as the Board --
                    "Completado", "Esperando aprobación" -- because it comes
                    from the same dictionary. AND WITH THE BODY: without it,
                    the client's own request (blocked, as it's born) showed up
                    here as "Esperando aprobación" -- its own -- while the
                    Board, on that same ticket, said "Lo estamos viendo". The
                    discriminant is `isClientRequest`. */}
                {ticket && (
                  <Chip tone={ticketStatus(ticket.ticket).tone}>
                    {ticketStatus(ticket.ticket).label}
                  </Chip>
                )}
                {/* The tenant is the board the task lives on, and the client
                    named it ("ventas", "cobranzas"): shown as-is. */}
                {ticket?.ticket.tenant && <Chip>{ticket.ticket.tenant}</Chip>}
                {ticket && (
                  <span className="text-[11px] text-ink-soft">
                    {fmtDate(ticket.ticket.created_at)}
                  </span>
                )}
              </>
            ) : entity.kind === "artifact" ? (
              <>
                {artifact && (
                  <>
                    <Chip tone={artifactLabel(artifact.kind).tone}>
                      {artifactLabel(artifact.kind).label}
                    </Chip>
                    <span className="text-[11px] text-ink-soft">
                      {fmtDate(artifact.created_at)}
                    </span>
                  </>
                )}
              </>
            ) : (
              <Chip>Archivo</Chip>
            )}
          </div>
        </div>
        {/* DOWNLOAD, HERE. The agent says "it opens straight in Excel" and
            sends you the file over chat: if the only button to download it is
            three screens away (More -> Files -> deliverables), the work is
            done right and the client can't take it home. */}
        {isFile && (
          <IconBtn label={downloading ? "Bajando…" : "Descargar"} disabled={downloading} onClick={download}>
            <Download className="h-4 w-4" />
          </IconBtn>
        )}
        {/* This modal is a GLANCE from wherever you were (the chat, a flow), so
            the link isn't this screen's: it's the thing's own, on the tab
            where it lives. Sharing "the chat with a file open" is no use to
            anyone. */}
        <CopyUrl get={() => canonicalUrlOf(entity)} label="Copiar el link de esto" />
        <IconBtn label="Cerrar" onClick={onClose}><X className="h-4 w-4" /></IconBtn>
      </div>
      {downloadErr && (
        <p className="border-b border-black/[0.07] px-5 py-2 text-[12px] font-medium text-c-coral-ink">
          No pude descargar el archivo ({downloadErr}).
        </p>
      )}

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
          isPhoto ? (
            <AgentImage cfg={cfg} path={entity.path} />
          ) : downloadOnly ? (
            <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
              <FileIcon className="h-8 w-8 text-ink-soft" />
              <p className="text-sm font-medium text-ink">Este archivo se abre con otro programa</p>
              <p className="max-w-sm text-[13px] text-ink-soft">
                No se puede mostrar acá, pero lo bajás y lo abrís como siempre.
              </p>
              <Btn onClick={download} disabled={downloading}>
                <Download className="h-4 w-4" />
                {downloading ? "Bajando…" : "Descargar"}
              </Btn>
            </div>
          ) : isBinarySpreadsheet && sheet ? (
            <Spreadsheet bytes={sheet} />
          ) : IS_TEXT_TABLE.test(entity.path) ? (
            // The agent announces it as "it opens in Excel": showing it as
            // comma-separated text would be proving the opposite. The table
            // gets drawn and the download button is up top.
            <CsvPreview text={text ?? ""} />
          ) : (
            <FileBody path={entity.path} text={text ?? ""} />
          )
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
                        {viewerAuthorLabel(c.author)}{" "}
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
