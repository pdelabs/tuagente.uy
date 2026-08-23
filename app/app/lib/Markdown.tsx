"use client";

// Renders markdown from the agent's replies -- sober, typography-first. GFM
// (tables, strikethrough, task lists) + math (KaTeX) + code with highlighting
// + mermaid diagrams.
//
// All of this gets drawn while the message is streaming, so the markdown
// arrives broken most of the time: half-open fences, tables with no body,
// unclosed `$$`. The rule is that none of that can explode or flicker ugly.

import { Children, memo, useMemo, type ReactNode } from "react";
import type { Element, ElementContent } from "hast";
import ReactMarkdown, { type Components, type Options } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import {
  FileText, Image as ImageIcon, LayoutDashboard, Sheet, Ticket as TicketIcon,
} from "lucide-react";
import {
  detectEntity, EntityChip, isImage, isSpreadsheet, useOpenEntity, FILE_EXTENSIONS, type Entity,
} from "./entities";
import { readableFileName } from "./names";
import { PARAM } from "./routes";
import Artifact from "./Artifact";
import CodeBlock from "./CodeBlock";
import Mermaid from "./Mermaid";
import "katex/dist/katex.min.css";

/* ── Parsing ──────────────────────────────────────────────────────────────── */

function nodeText(node: ElementContent): string {
  if (node.type === "text") return node.value;
  if (node.type === "element") return node.children.map(nodeText).join("");
  return "";
}

/** Pulls `{ code, lang }` out of the <pre><code class="language-x"> remark builds. */
function fenceOf(node: Element | undefined): { code: string; lang: string | null } | null {
  const child = node?.children.find((c) => c.type === "element");
  if (!child || child.type !== "element" || child.tagName !== "code") return null;

  // `unknown` on purpose: hast types it as string[], but depending on the
  // plugin it can arrive as a bare string.
  const raw: unknown = child.properties?.className;
  const classes = Array.isArray(raw)
    ? raw.map(String)
    : typeof raw === "string"
      ? raw.split(/\s+/)
      : [];

  let lang: string | null = null;
  for (const c of classes) {
    const m = /^language-(.+)$/.exec(c);
    if (m) {
      lang = m[1];
      break;
    }
  }
  return { code: nodeText(child), lang };
}

/**
 * Closes a fence left open at the end of the text. Without this, while the
 * agent is writing a code block the markdown has an odd number of ``` and
 * remark demotes it to a bare paragraph: the block appears, disappears and
 * comes back. Closing it draws it from the first token onward and it only
 * ever grows.
 */
export function closeOpenFence(md: string): string {
  const lines = md.split("\n");
  let openChar = "";
  let openLen = 0;

  for (const line of lines) {
    const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (!m) continue;
    const fence = m[1];
    const rest = m[2];
    const ch = fence[0];

    if (!openChar) {
      // A backtick fence's info string can't contain backticks.
      if (ch === "`" && rest.includes("`")) continue;
      openChar = ch;
      openLen = fence.length;
    } else if (ch === openChar && fence.length >= openLen && rest.trim() === "") {
      openChar = "";
      openLen = 0;
    }
  }

  if (!openChar) return md;
  return `${md}${md.endsWith("\n") ? "" : "\n"}${openChar.repeat(openLen)}`;
}

/** Can the URL actually be fetched, or is it a path in the agent's own workspace? */
function isFetchable(src: string): boolean {
  return /^(https?:)?\/\//i.test(src) || /^(data|blob):/i.test(src);
}

/* ── What the agent named, turned into something you can touch ──────────── */

/** Does the portal know how to open this?
 *
 *  The adapter only serves what's INSIDE the agent's workspace
 *  (`GET /portal/files/{path}`, relative to it). Measured against the lab's
 *  adapter (0.36):
 *    /portal/files/entregables%2F…-2026.md          -> 200
 *    /portal/files/workspace%2Fentregables%2F…      -> 404  (the prefix gets stripped here)
 *    /portal/files/..%2FSOUL.md                     -> 404
 *  `detectEntity` accepts any path with a known extension, so an absolute one
 *  that never leaves the workspace (`/opt/data/skills/x.md`, a file on the
 *  agent's own machine) still comes in as an entity and ends up as a chip that
 *  promises to open something and answers "couldn't find that file". A link
 *  that leads nowhere is worse than plain text: that one stays as text. */
function isOpenable(entity: Entity): boolean {
  if (entity.kind !== "file") return true;
  return !entity.path.startsWith("/") && !entity.path.split("/").includes("..");
}

// Same encoding as `lib/routes.tsx`: the slash is left readable in the URL.
const enc = (s: string) => encodeURIComponent(s).replace(/%2F/gi, "/");

/** Where the thing lives, as an ordinary link. RELATIVE on purpose: with
 *  `window.location.origin` the href would come out different in prerender
 *  and in the browser, and that's a hydration mismatch on a static page. */
function urlOfThing(entity: Entity): string {
  if (entity.kind === "ticket") return `/app/pipeline?${PARAM.task}=${enc(entity.id)}`;
  if (entity.kind === "artifact") {
    return `/app/artifacts?${PARAM.artifact}=${enc(entity.id)}`;
  }
  if (entity.kind === "file") return `/app/files?${PARAM.file}=${enc(entity.path)}`;
  return `/app/connections?${PARAM.connection}=${enc(entity.id)}`;
}

const THING_CLASS =
  "inline rounded-md border border-c-violet bg-c-violet/40 px-1.5 py-0.5 align-baseline " +
  "text-[0.95em] font-medium text-primary transition hover:border-primary hover:bg-c-violet";

/** What the agent named (one of its files, a task, a visualization), drawn as
 *  something you can open.
 *
 *  TWO THINGS WERE BROKEN ON THE SAME LINE, and the same test client wrote
 *  both down about the link her agent used to deliver the report she'd just
 *  asked for:
 *
 *  1. IT COULDN'T BE TOUCHED. The chip opens a modal by asking the entity
 *     provider for it, and outside the chat -- hiring, which now has the chat
 *     inside it -- there's no provider: the chip drew as `<code>`, inert. "I
 *     clicked it three times." Now, with no provider, it's a link to the tab
 *     where the thing lives, which is exactly where they wanted to go.
 *  2. IT SAID THE PATH, IN MONOSPACE AND CUT OFF.
 *     `workspace/entregables/control-semanal-contratos/2026-08-13-prueba-del-…`
 *     is an address, not a name. Now it says the name in plain terms
 *     (`lib/names.ts`) with the portal's own type; the path still travels in
 *     the link. */
function Thing({ entity, text }: { entity: Entity; text?: string }) {
  const open = useOpenEntity();

  const label =
    text?.trim() ||
    (entity.kind === "file" ? readableFileName(entity.path) : entity.id);

  const Icon =
    entity.kind === "ticket" ? TicketIcon
      : entity.kind === "artifact" ? LayoutDashboard
        : entity.kind === "file" && isImage(entity.path) ? ImageIcon
          : entity.kind === "file" && isSpreadsheet(entity.path) ? Sheet
            : FileText;

  const title =
    entity.kind === "ticket" ? "Ver la tarea"
      : entity.kind === "artifact" ? "Ver la visualización"
        : "Abrir el archivo";

  const inner = (
    <>
      <Icon className="mr-1 inline h-[1em] w-[1em] -translate-y-[0.1em]" aria-hidden />
      {label}
    </>
  );

  // With a provider it opens right here, without leaving the conversation.
  if (open) {
    return (
      <button onClick={() => open(entity)} title={title} className={`${THING_CLASS} text-left`}>
        {inner}
      </button>
    );
  }
  // With no provider, a new tab. The two screens that draw markdown with no
  // provider are the hiring chat and the approvals queue: on both the client
  // is in the middle of something (answering onboarding, deciding on a
  // request), and taking them to another portal tab would pull them away from
  // it. This way the document opens and they're back to where they were by
  // closing it.
  return (
    <a href={urlOfThing(entity)} target="_blank" rel="noopener noreferrer"
      title={title} className={THING_CLASS}>
      {inner}
    </a>
  );
}

/** The chip for an entity, whatever kind it is. Connections, permissions and
 *  capabilities have their own card (`entities.tsx`); everything else opens. */
function EntityChipFor({ entity, text }: { entity: Entity; text?: string }) {
  if (entity.kind === "connection" || entity.kind === "permissions" || entity.kind === "capability") {
    return <EntityChip entity={entity} label={text?.trim() || entity.id} />;
  }
  return <Thing entity={entity} text={text} />;
}

/* ── Components ───────────────────────────────────────────────────────────── */

// The agent also names tickets, files and connections in prose, with no
// backticks. The \b sits INSIDE each alternative: if it were before the
// optional /opt/data/ prefix, it would never match (`/` isn't a word
// character) and the prefix would be left dangling as text next to the chip.
// `capability:` goes here too: the SOUL teaches the agent to write it alone on
// its own line, but it writes it in prose about half the time.
//
// The workspace's top-level folders also go with no prefix: the kit teaches it
// to cite `workspace/entregables/…` (the deliverable plugin's SKILL.md), but
// about half the time it writes bare `entregables/…` and that line ended up
// with no chip -- the same file, delivered twice, one clickable and the other
// not.
// These are the convention's three folders (the same ones the Files tab
// separates), not just any relative path: a bare `informe.md` in a sentence
// isn't a promise that the portal can open it.
const INLINE_ENTITY_RE = new RegExp(
  "(\\bt_[0-9a-f]{6,16}\\b" +
  "|\\bconnection:[a-z0-9][a-z0-9-]*\\b" +
  "|\\bcapability:[a-z0-9][a-z0-9-]*\\b" +
  `|(?:/opt/data/)?\\b(?:workspace|entregables|entrada|interno)/[\\w./-]+\\.(?:${FILE_EXTENSIONS})\\b)`,
  "gi");

function linkify(children: ReactNode): ReactNode {
  return Children.map(children, (child) => {
    if (typeof child !== "string") return child;
    const parts: ReactNode[] = [];
    let last = 0;
    for (const m of Array.from(child.matchAll(INLINE_ENTITY_RE))) {
      const entity = detectEntity(m[0]);
      if (!entity || !isOpenable(entity) || m.index === undefined) continue;
      if (m.index > last) parts.push(child.slice(last, m.index));
      parts.push(<EntityChipFor key={m.index} entity={entity} />);
      last = m.index + m[0].length;
    }
    if (!parts.length) return child;
    if (last < child.length) parts.push(child.slice(last));
    return parts;
  });
}

function makeComponents(streaming: boolean): Components {
  return {
    p: ({ children }) => (
      <p className="my-2 leading-relaxed first:mt-0 last:mb-0">{linkify(children)}</p>
    ),
    // An href that can't be fetched CANNOT be a link.
    //
    // The agent writes paths from its own workspace and remark turns them into
    // `<a href="workspace/entregables/cartel.jpg">`. Clicking it navigated to
    // /app/workspace/… and the client got "404: This page could not be found"
    // for a file their agent had just made correctly. If the path is a known
    // entity, the chip that actually opens it gets drawn; if not, it stays as
    // text -- ugly, but it never lies.
    a: ({ href, children }) => {
      const url = typeof href === "string" ? href : "";
      // `/opt/…` comes in here even though it starts with a slash: it's the
      // workspace's absolute path, the one the agent uses to re-read its own
      // files, and as a portal link it gave a 404. The rest of the absolute
      // paths (`/app/…`, `/blog/…`) belong to the site and stay ordinary links.
      const fromAgent = !url.startsWith("/") || url.startsWith("/opt/");
      if (url && !isFetchable(url) && fromAgent && !url.startsWith("#")) {
        const entity = detectEntity(url);
        const text = Children.toArray(children).every((c) => typeof c === "string")
          ? Children.toArray(children).join("")
          : "";
        // The link's text only works as a label if the agent wrote one: when
        // it repeats the path (which is what remark does with an automatic
        // link), it's an address again, and the name takes over there.
        const label = text.trim() === url.trim() ? "" : text.trim();
        if (entity && isOpenable(entity)) {
          return <EntityChipFor entity={entity} text={label} />;
        }
        return <>{children}</>;
      }
      return (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-primary underline underline-offset-2 hover:text-primary-dark"
        >
          {children}
        </a>
      );
    },
    ul: ({ children }) => <ul className="my-2 ml-5 list-disc space-y-1">{children}</ul>,
    ol: ({ children }) => <ol className="my-2 ml-5 list-decimal space-y-1">{children}</ol>,
    li: ({ children, className }) => (
      <li
        className={
          className?.includes("task-list-item")
            ? "-ml-5 list-none leading-relaxed"
            : "leading-relaxed"
        }
      >
        {linkify(children)}
      </li>
    ),
    input: ({ type, checked }) =>
      type === "checkbox" ? (
        <input
          type="checkbox"
          checked={!!checked}
          readOnly
          disabled
          className="mr-2 h-3.5 w-3.5 translate-y-[1px] accent-primary"
        />
      ) : null,
    h1: ({ children }) => (
      <h1 className="mb-2 mt-4 text-lg font-bold tracking-tight text-ink first:mt-0">{children}</h1>
    ),
    h2: ({ children }) => (
      <h2 className="mb-2 mt-4 text-base font-bold tracking-tight text-ink first:mt-0">{children}</h2>
    ),
    h3: ({ children }) => (
      <h3 className="mb-1.5 mt-3 text-[15px] font-semibold text-ink first:mt-0">{children}</h3>
    ),
    h4: ({ children }) => (
      <h4 className="mb-1.5 mt-3 text-[15px] font-semibold text-ink-soft first:mt-0">{children}</h4>
    ),
    h5: ({ children }) => (
      <h5 className="mb-1 mt-2.5 text-[13px] font-semibold uppercase tracking-wide text-ink-soft first:mt-0">
        {children}
      </h5>
    ),
    h6: ({ children }) => (
      <h6 className="mb-1 mt-2.5 text-[13px] font-semibold uppercase tracking-wide text-ink-soft first:mt-0">
        {children}
      </h6>
    ),
    blockquote: ({ children }) => (
      <blockquote className="my-2 border-l-2 border-black/15 pl-3 text-ink-soft">
        {children}
      </blockquote>
    ),

    // The code block is drawn from <pre>, so `code` only ever sees the inline case.
    pre: ({ children, node }) => {
      const fence = fenceOf(node);
      if (!fence) {
        return (
          <pre className="my-3 overflow-x-auto rounded-lg border border-black/[0.07] bg-black/[0.03] p-3.5 text-[13px] leading-relaxed text-ink [&_code]:bg-transparent [&_code]:p-0 [&_code]:font-normal [&_code]:text-inherit">
            {children}
          </pre>
        );
      }
      const lang = fence.lang?.trim().toLowerCase() ?? "";
      if (lang === "mermaid") {
        return <Mermaid chart={fence.code} streaming={streaming} />;
      }
      // A whole HTML/SVG document: showing it as code is no use, so it's drawn.
      if (lang === "html" || lang === "svg") {
        return <Artifact code={fence.code} lang={lang} streaming={streaming} />;
      }
      return <CodeBlock code={fence.code} lang={fence.lang} />;
    },
    // The agent names its tickets and files in inline code: we turn those into
    // chips that open the detail without leaving the chat.
    code: ({ children }) => {
      const raw = Array.isArray(children) ? children.join("") : String(children ?? "");
      const entity = detectEntity(raw);
      if (entity && isOpenable(entity)) return <EntityChipFor entity={entity} />;
      return (
        <code className="rounded bg-black/[0.06] px-1.5 py-0.5 font-mono text-[0.88em] text-ink">
          {children}
        </code>
      );
    },

    hr: () => <hr className="my-4 border-black/[0.08]" />,
    table: ({ children }) => (
      <div className="my-3 overflow-x-auto rounded-lg border border-black/[0.08]">
        <table className="w-full text-sm">{children}</table>
      </div>
    ),
    th: ({ children }) => (
      <th className="border-b border-black/[0.08] bg-black/[0.03] px-3 py-2 text-left font-semibold text-ink">
        {children}
      </th>
    ),
    td: ({ children }) => (
      <td className="border-t border-black/[0.06] px-3 py-2 align-top">{children}</td>
    ),

    img: ({ src, alt, title }) => {
      const url = typeof src === "string" ? src : "";
      if (!url) return null;

      // The agent writes paths from its own workspace (./out/plot.png):
      // requesting that from the portal gives a 404 and a broken-image icon.
      // The image CAN be opened -- the viewer shows it by asking the adapter
      // for the bytes -- so it gets the same chip as everything else: before,
      // it was a dead little box with the path inside, i.e. the banner the
      // agent had just made, in plain sight and with no way to look at it.
      if (!isFetchable(url)) {
        const entity = detectEntity(url);
        if (entity && isOpenable(entity)) {
          return <EntityChipFor entity={entity} text={alt?.trim()} />;
        }
        return (
          <span className="my-1 inline-flex max-w-full items-center gap-1.5 rounded-lg border border-black/[0.07] bg-black/[0.03] px-2 py-1 align-middle text-ink-soft">
            <ImageIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="truncate text-[12px]">{alt?.trim() || url}</span>
          </span>
        );
      }

      return (
        <span className="my-2 block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={alt ?? ""}
            title={title}
            loading="lazy"
            className="block h-auto max-w-full rounded-lg border border-black/[0.07]"
          />
          {alt?.trim() ? (
            <span className="mt-1 block text-[12px] leading-snug text-ink-soft">{alt}</span>
          ) : null}
        </span>
      );
    },
  };
}

const STATIC_COMPONENTS = makeComponents(false);
const STREAMING_COMPONENTS = makeComponents(true);

// `singleDollarTextMath: false` is NOT a minor detail: this is where money
// gets talked about, in pesos and dollars, and with remark-math's default a
// "$ 5.100 … $ 31.500" reads as a formula -- KaTeX eats the text in between,
// runs the words together and italicizes them as math. A client list with
// amounts turned unreadable in the chat even though the file itself was
// perfect. Real math still works with `$$…$$`.
const remarkPlugins: Options["remarkPlugins"] = [
  remarkGfm,
  [remarkMath, { singleDollarTextMath: false }],
];

// The agent sometimes writes HTML inside the markdown (a table, a <details>).
// Without rehype-raw it shows up escaped as text; with raw alone it would be
// XSS. So it's raw + sanitize with an allowlist: content markup is allowed,
// never script, iframe, style, event handlers, or javascript: in an href.
// "Real" HTML (a whole page) arrives as a ```html block and gets drawn
// isolated in Artifact.
const schema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), "details", "summary", "figure", "figcaption", "mark"],
  attributes: {
    ...defaultSchema.attributes,
    "*": [...(defaultSchema.attributes?.["*"] ?? []), "align"],
    details: ["open"],
  },
};

// rehype-katex already forces throwOnError:false; the muted errorColor avoids
// a jarring red while a formula is still half-written.
const rehypePlugins: Options["rehypePlugins"] = [
  rehypeRaw,
  [rehypeSanitize, schema],
  [rehypeKatex, { errorColor: "#4B4A5C", strict: "ignore" }],
];

/* ── What the portal writes TO THE AGENT ──────────────────────────────────── */

/** The order the portal puts inside a ticket's body when the client requests a
 *  connection. IT CANNOT BE DELETED: it's the only thing keeping the agent
 *  from going off and connecting WhatsApp on its own (the ticket is born
 *  blocked, but the body is what gets read when someone unblocks it). And the
 *  client can't read it: it's written as an imperative in the second person,
 *  so the test client read it as an order AIMED AT HER -- "I was left not
 *  knowing if I was allowed to touch anything".
 *
 *  Exported so only one side writes it. Today `connections/page.tsx` and
 *  hiring each build it on their own; the real fix is having
 *  `createConnectionRequest` put it inside an HTML comment -- the same
 *  mechanism `REQUEST_MARKER` already uses, which the sanitizer hides -- and
 *  then this whole block goes away. Until then it's recognized by its first
 *  sentence, which is ugly and tied to a literal string: that's why it lives
 *  here instead of being spread around. */
export const AGENT_INSTRUCTION =
  "No hagas nada por tu cuenta con esto: avisale al equipo de tuagente " +
  "que hay que conectarlo y dejá el ticket esperando.";

/** Convention going forward: whatever sits between these marks is for the
 *  agent and the client never sees it. They go as an HTML comment so the
 *  agent -- which reads the raw body -- still gets them. */
const AGENT_ONLY_BLOCK_RE = /<!--\s*para-el-agente\s*-->[\s\S]*?<!--\s*\/para-el-agente\s*-->/gi;

// The whole paragraph, from the sentence that opens it to the blank line.
const INSTRUCTION_PARAGRAPH_RE = /(?:^|\n)[ \t]*No hagas nada por tu cuenta con esto:[\s\S]*?(?=\n[ \t]*\n|$)/gi;

function stripAgentOnlyContent(md: string): string {
  if (!md.includes("<!--") && !md.includes("No hagas nada por tu cuenta")) return md;
  return md
    .replace(AGENT_ONLY_BLOCK_RE, "")
    .replace(INSTRUCTION_PARAGRAPH_RE, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function MarkdownImpl({ children, streaming = false }: { children: string; streaming?: boolean }) {
  const source = useMemo(
    () => closeOpenFence(stripAgentOnlyContent(children ?? "")), [children]);

  return (
    <div className="break-words text-[15px] text-ink [&_.katex-display]:overflow-x-auto [&_.katex-display]:overflow-y-hidden [&_.katex-display]:py-1 [&_.katex-error]:font-mono [&_.katex-error]:text-[0.9em]">
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={streaming ? STREAMING_COMPONENTS : STATIC_COMPONENTS}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}

export default memo(MarkdownImpl);
