"use client";

// Agent entities (tickets and files from its workspace) detected in text and
// shown as clickable chips. LEAF module on purpose: it doesn't import
// Markdown, so the renderer can import this without a cycle. The modal each
// chip opens lives in EntityViewer.tsx.

import { createContext, useContext } from "react";
import Link from "next/link";
import { FileText, Image as ImageIcon, Images, LayoutDashboard, Sheet, Ticket as TicketIcon } from "lucide-react";
import { PARAM } from "./routes";

export type Entity =
  | { kind: "ticket"; id: string }
  | { kind: "file"; path: string }
  | { kind: "artifact"; id: string }
  | { kind: "post"; id: string };

const TICKET_RE = /^t_[0-9a-f]{6,16}$/i;
const ARTIFACT_RE = /^art_\d{10}_[\w-]+$/i;
/** A post's id is its folder in `posteos/`: the date it is FOR and the slug
 *  (`save_post`, `kit/plugins/social/core/posts.py`). It is the one id in the
 *  product that reads like a sentence, which is why the agent quotes it in
 *  prose and why it has to become a link there.
 *
 *  What it must NOT swallow: a bare date (`2026-09-15` — there is no slug), a
 *  timestamp (`2026-09-15T08:16:28-03:00` — the `T` is not a hyphen), and a
 *  file `generate_image` left in `imagenes/` (`2026-09-15-3.png` — the slug
 *  has to carry a letter, and a dot is not part of an id). The source of the
 *  shape is the tool's own `SLUG`: lowercase, digits and hyphens, 40 max. */
const POST_RE = /^\d{4}-\d{2}-\d{2}-(?=[a-z0-9-]*[a-z])[a-z0-9][a-z0-9-]{0,39}$/i;

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

/** What type a picture's BYTES have to be handed to the browser as.
 *
 *  Every image in the portal arrives as an ArrayBuffer fetched with the
 *  bearer (`getAdapterBytes`), and a Blob with no type doesn't render in an
 *  `<img>`: the response's own header is gone by then, so the name is what
 *  answers. Here for the same reason `FILE_EXTENSIONS` is — the Posts tab and
 *  the markdown renderer both need it, and two copies drift. */
const MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  webp: "image/webp", gif: "image/gif", svg: "image/svg+xml",
};
export const imageMime = (path: string) =>
  MIME[(path.split(".").pop() ?? "").toLowerCase()];

/** Is this bare piece of text an agent entity? */
export function detectEntity(raw: string): Entity | null {
  const text = raw.trim();
  if (!text || /\s/.test(text)) return null;
  if (TICKET_RE.test(text)) return { kind: "ticket", id: text };
  if (ARTIFACT_RE.test(text)) return { kind: "artifact", id: text };
  if (POST_RE.test(text)) return { kind: "post", id: text.toLowerCase() };
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
  post: "Ver el posteo",
};

/** The chip for a post: a LINK to the tab, not a modal.
 *
 *  A post is an image at full width plus the text that goes with it, and
 *  `?post=` takes the whole screen for exactly that reason
 *  (`docs/portal-routes.md`); squeezing it into the viewer's modal would show
 *  the client less than the tab they already have. The href is relative and
 *  built with the route helper's own param name: with
 *  `window.location.origin` it would come out one way in the prerender and
 *  another in the browser, which is a hydration mismatch on a static page. */
function PostLink({ id }: { id: string }) {
  return (
    <Link
      href={`/app/posts?${PARAM.post}=${encodeURIComponent(id)}`}
      title={ENTITY_HINT.post}
      className="inline-flex max-w-full items-center gap-1 rounded-md border border-c-violet bg-c-violet/40 px-1.5 py-0.5 align-middle font-mono text-[0.85em] text-primary transition hover:border-primary hover:bg-c-violet"
    >
      <Images className="h-3 w-3 shrink-0" />
      <span className="truncate">{id}</span>
    </Link>
  );
}

export function EntityChip({ entity, label }: { entity: Entity; label: string }) {
  const open = useOpenEntity();
  // A post opens in its own tab, where it is drawn the size it is going out at.
  if (entity.kind === "post") return <PostLink id={entity.id} />;
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
