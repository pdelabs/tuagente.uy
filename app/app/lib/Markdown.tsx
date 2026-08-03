"use client";

// Render markdown de las respuestas del agente — sobrio, tipografía primero.
// GFM (tablas, tachado, task lists) + matemática (KaTeX) + código con
// highlighting + diagramas mermaid.
//
// Todo esto se dibuja mientras el mensaje streamea, así que el markdown llega
// roto la mayor parte del tiempo: fences a medio abrir, tablas sin cuerpo,
// `$$` sin cerrar. La regla es que nada de eso explote ni parpadee feo.

import { Children, memo, useMemo, type ReactNode } from "react";
import type { Element, ElementContent } from "hast";
import ReactMarkdown, { type Components, type Options } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { Image as ImageIcon } from "lucide-react";
import { detectEntity, EntityChip } from "./entities";
import Artifact from "./Artifact";
import CodeBlock from "./CodeBlock";
import Mermaid from "./Mermaid";
import "katex/dist/katex.min.css";

/* ── Parseo ─────────────────────────────────────────────────────────────── */

function nodeText(node: ElementContent): string {
  if (node.type === "text") return node.value;
  if (node.type === "element") return node.children.map(nodeText).join("");
  return "";
}

/** Saca `{ code, lang }` del <pre><code class="language-x"> que arma remark. */
function fenceOf(node: Element | undefined): { code: string; lang: string | null } | null {
  const child = node?.children.find((c) => c.type === "element");
  if (!child || child.type !== "element" || child.tagName !== "code") return null;

  // `unknown` a propósito: hast lo tipa como string[], pero según el plugin
  // puede llegar como string suelto.
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
 * Cierra el fence que quedó abierto al final del texto. Sin esto, mientras el
 * agente escribe un bloque de código el markdown tiene ``` impares y remark lo
 * degrada a párrafo suelto: el bloque aparece, desaparece y vuelve. Cerrándolo
 * se dibuja desde el primer token y sólo crece.
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
      // El info string de un fence de backticks no puede tener backticks.
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

/** ¿La URL se puede pedir de verdad, o es un path del workspace del agente? */
function isFetchable(src: string): boolean {
  return /^(https?:)?\/\//i.test(src) || /^(data|blob):/i.test(src);
}

/* ── Componentes ────────────────────────────────────────────────────────── */

// El agente también nombra tickets y archivos en prosa, sin backticks.
// El \b va DENTRO de cada alternativa: si estuviera antes del prefijo opcional
// /opt/data/, nunca casaría (el `/` no es carácter de palabra) y el prefijo
// quedaría suelto como texto al lado del chip.
const INLINE_ENTITY_RE =
  /(\bt_[0-9a-f]{6,16}\b|(?:\/opt\/data\/)?\bworkspace\/[\w./-]+\.(?:md|txt|csv|json|ya?ml|log|py|ts|tsx|js|sh|sql|html)\b)/gi;

function linkify(children: ReactNode): ReactNode {
  return Children.map(children, (child) => {
    if (typeof child !== "string") return child;
    const parts: ReactNode[] = [];
    let last = 0;
    for (const m of Array.from(child.matchAll(INLINE_ENTITY_RE))) {
      const entity = detectEntity(m[0]);
      if (!entity || m.index === undefined) continue;
      if (m.index > last) parts.push(child.slice(last, m.index));
      parts.push(<EntityChip key={m.index} entity={entity} label={m[0]} />);
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
    a: ({ href, children }) => (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium text-primary underline underline-offset-2 hover:text-primary-dark"
      >
        {children}
      </a>
    ),
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

    // El bloque de código se dibuja desde <pre>, así `code` sólo ve el inline.
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
      // HTML/SVG completo: mostrarlo como código no sirve de nada, se dibuja.
      if (lang === "html" || lang === "svg") {
        return <Artifact code={fence.code} lang={lang} streaming={streaming} />;
      }
      return <CodeBlock code={fence.code} lang={fence.lang} />;
    },
    // El agente nombra sus tickets y archivos en código inline: los volvemos
    // chips que abren el detalle sin salir del chat.
    code: ({ children }) => {
      const raw = Array.isArray(children) ? children.join("") : String(children ?? "");
      const entity = detectEntity(raw);
      if (entity) return <EntityChip entity={entity} label={raw.trim()} />;
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

      // El agente escribe paths de su propio workspace (./out/plot.png): pedir
      // eso al portal da 404 e ícono roto. Mejor un chip con el archivo.
      if (!isFetchable(url)) {
        return (
          <span className="my-1 inline-flex max-w-full items-center gap-1.5 rounded-lg border border-black/[0.07] bg-black/[0.03] px-2 py-1 align-middle text-ink-soft">
            <ImageIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="truncate font-mono text-[12px]">{alt?.trim() || url}</span>
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

const remarkPlugins: Options["remarkPlugins"] = [remarkGfm, remarkMath];

// El agente a veces escribe HTML dentro del markdown (una tabla, un <details>).
// Sin rehype-raw se ve escapado como texto; con raw a secas sería XSS. Va raw +
// sanitize con allowlist: se permite marcado de contenido, jamás script, iframe,
// style, event handlers ni javascript: en href. El HTML "de verdad" (una página
// entera) llega como bloque ```html y se dibuja aislado en Artifact.
const schema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), "details", "summary", "figure", "figcaption", "mark"],
  attributes: {
    ...defaultSchema.attributes,
    "*": [...(defaultSchema.attributes?.["*"] ?? []), "align"],
    details: ["open"],
  },
};

// rehype-katex ya fuerza throwOnError:false; el errorColor apagado evita el
// rojo chillón mientras una fórmula está a medio escribir.
const rehypePlugins: Options["rehypePlugins"] = [
  rehypeRaw,
  [rehypeSanitize, schema],
  [rehypeKatex, { errorColor: "#4B4A5C", strict: "ignore" }],
];

function MarkdownImpl({ children, streaming = false }: { children: string; streaming?: boolean }) {
  const source = useMemo(() => closeOpenFence(children ?? ""), [children]);

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
