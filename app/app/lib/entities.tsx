"use client";

// Agent entities (tickets and files from its workspace) detected in text and
// shown as clickable chips. LEAF module on purpose: it doesn't import
// Markdown, so the renderer can import this without a cycle. The modal each
// chip opens lives in EntityViewer.tsx.

import { createContext, useContext } from "react";
import { FileText, Image as ImageIcon, LayoutDashboard, Sheet, Ticket as TicketIcon } from "lucide-react";
import { ConnectionCardInline, PermissionsInline } from "./ConnectionChip";
import { CapabilityInline } from "./CapabilityChip";

export type Entity =
  | { kind: "ticket"; id: string }
  | { kind: "file"; path: string }
  | { kind: "artifact"; id: string }
  | { kind: "connection"; id: string }
  | { kind: "permissions"; id: string }
  | { kind: "capability"; id: string };

const TICKET_RE = /^t_[0-9a-f]{6,16}$/i;
const ARTIFACT_RE = /^art_\d{10}_[\w-]+$/i;
// The agent mentions a catalog connection as `connection:google-workspace`
// (its SOUL teaches it to): the chat draws it as a card with status and a
// button.
const CONNECTION_RE = /^connection:([a-z0-9][a-z0-9-]*)$/i;
// `permissions:whatsapp` -- the agent CAN'T change the policy, but it can
// point at where it gets changed: instead of a flat "I can't send WhatsApps",
// it puts the control right there and the client decides on the spot.
const PERMISSIONS_RE = /^permissions:([a-z0-9][a-z0-9-]*)$/i;
// `capability:image-editing` -- what the agent CAN'T do yet and could be
// turned on. The SOUL teaches it to write this alone on its own line and
// promises "the portal turns it into a card": until now the portal didn't,
// and the token sat raw in the middle of the reply.
const CAPABILITY_RE = /^capability:([a-z0-9][a-z0-9-]*)$/i;

/** Extensions the agent produces that the client has to be able to open.
 *
 *  THIS LIST IS THE MOST EXPENSIVE BUG THE CHAT EVER HAD: it only had text and
 *  code, so the 1080x1080 JPG the agent had just built for WhatsApp didn't
 *  draw as a chip -- it drew as a relative link and ended in "404: This page
 *  could not be found". Same with the `docx`, `xlsx` and `pdf` files the
 *  agent can generate out of the box. The work was done and the client never
 *  reached it.
 *
 *  Exported because the markdown renderer detects the same paths in prose:
 *  one list, not two that drift apart. */
export const FILE_EXTENSIONS =
  "md|markdown|txt|text|csv|tsv|json|jsonl|ya?ml|toml|ini|cfg|conf|log|out|rst|env|" +
  "py|rb|ts|tsx|js|jsx|mjs|sh|bash|sql|xml|html?|css|" +
  "jpe?g|png|gif|webp|bmp|svg|ico|heic|avif|" +
  "pdf|xlsx|xls|ods|docx|doc|odt|pptx|ppt|odp|rtf|" +
  "zip|gz|tar|ics|mp3|wav|ogg|m4a|mp4|mov|webm";

// Workspace paths: the agent writes them with or without a prefix.
const FILE_RE = new RegExp(
  `^(?:/opt/data/workspace/|workspace/|\\./)?([\\w./-]+\\.(?:${FILE_EXTENSIONS}))$`, "i");

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|bmp|svg|ico|heic|avif)$/i;
const SPREADSHEET_EXT = /\.(xlsx|xls|csv|tsv|ods)$/i;

/** Is this path an image? Used by the viewer (to show it) and the chip (for
 *  its icon). */
export const isImage = (path: string) => IMAGE_EXT.test(path);
export const isSpreadsheet = (path: string) => SPREADSHEET_EXT.test(path);

/** Is this bare piece of text an agent entity? */
export function detectEntity(raw: string): Entity | null {
  const text = raw.trim();
  if (!text || /\s/.test(text)) return null;
  if (TICKET_RE.test(text)) return { kind: "ticket", id: text };
  if (ARTIFACT_RE.test(text)) return { kind: "artifact", id: text };
  const cx = CONNECTION_RE.exec(text);
  if (cx) return { kind: "connection", id: cx[1].toLowerCase() };
  const pm = PERMISSIONS_RE.exec(text);
  if (pm) return { kind: "permissions", id: pm[1].toLowerCase() };
  const cap = CAPABILITY_RE.exec(text);
  if (cap) return { kind: "capability", id: cap[1].toLowerCase() };
  const m = FILE_RE.exec(text);
  if (m && m[1].includes(".")) return { kind: "file", path: m[1] };
  return null;
}

const EntityCtx = createContext<((e: Entity) => void) | null>(null);
export const useOpenEntity = () => useContext(EntityCtx);
export const EntityContext = EntityCtx;

const ENTITY_HINT = {
  ticket: "Ver la tarea",
  file: "Abrir el archivo",
  artifact: "Ver la visualización",
};

export function EntityChip({ entity, label }: { entity: Entity; label: string }) {
  const open = useOpenEntity();
  // A connection doesn't open a modal: it IS the card, with status and a button.
  if (entity.kind === "connection") return <ConnectionCardInline id={entity.id} />;
  if (entity.kind === "permissions") return <PermissionsInline id={entity.id} />;
  if (entity.kind === "capability") return <CapabilityInline id={entity.id} />;
  // The icon says what it is before you touch it: a photo opens to look at,
  // a spreadsheet opens to download.
  const Icon =
    entity.kind === "ticket" ? TicketIcon
      : entity.kind === "artifact" ? LayoutDashboard
        : isImage(entity.path) ? ImageIcon
          : isSpreadsheet(entity.path) ? Sheet
            : FileText;
  // With no provider (outside the chat) there's nowhere to open it: it stays
  // as code.
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
      title={ENTITY_HINT[entity.kind]}
      className="inline-flex max-w-full items-center gap-1 rounded-md border border-c-violet bg-c-violet/40 px-1.5 py-0.5 align-middle font-mono text-[0.85em] text-primary transition hover:border-primary hover:bg-c-violet"
    >
      <Icon className="h-3 w-3 shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  );
}
