"use client";

// The chat's code block.
//
// Highlighting via PrismLight + selective registration: we import ONLY the
// languages the agent actually uses in practice (via a deep path, not the
// `react-syntax-highlighter` barrel, which drags all of highlight.js and
// Prism into the bundle). An unknown language renders as plain text, with no
// warnings.

import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { Check, Copy } from "lucide-react";
import SyntaxHighlighter from "react-syntax-highlighter/dist/esm/prism-light";
import oneLight from "react-syntax-highlighter/dist/esm/styles/prism/one-light";
import bash from "react-syntax-highlighter/dist/esm/languages/prism/bash";
import css from "react-syntax-highlighter/dist/esm/languages/prism/css";
import diff from "react-syntax-highlighter/dist/esm/languages/prism/diff";
import javascript from "react-syntax-highlighter/dist/esm/languages/prism/javascript";
import json from "react-syntax-highlighter/dist/esm/languages/prism/json";
import jsx from "react-syntax-highlighter/dist/esm/languages/prism/jsx";
import markdown from "react-syntax-highlighter/dist/esm/languages/prism/markdown";
import markup from "react-syntax-highlighter/dist/esm/languages/prism/markup";
import python from "react-syntax-highlighter/dist/esm/languages/prism/python";
import sql from "react-syntax-highlighter/dist/esm/languages/prism/sql";
import tsx from "react-syntax-highlighter/dist/esm/languages/prism/tsx";
import typescript from "react-syntax-highlighter/dist/esm/languages/prism/typescript";
import yaml from "react-syntax-highlighter/dist/esm/languages/prism/yaml";

// registerLanguage(name, fn) ignores `name` and registers by the language's
// own displayName, so we resolve the aliases ourselves (see ALIASES).
const REGISTERED: Record<string, unknown> = {
  bash,
  css,
  diff,
  javascript,
  json,
  jsx,
  markdown,
  markup,
  python,
  sql,
  tsx,
  typescript,
  yaml,
};

for (const [name, lang] of Object.entries(REGISTERED)) {
  SyntaxHighlighter.registerLanguage(name, lang);
}

// A Set and not `in`: `"constructor" in REGISTERED` would be true because of
// the prototype chain, and we'd pass garbage to the highlighter.
const SUPPORTED = new Set(Object.keys(REGISTERED));

const ALIASES: Record<string, string> = {
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  node: "javascript",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  py: "python",
  python3: "python",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  console: "bash",
  "shell-session": "bash",
  json5: "json",
  jsonc: "json",
  yml: "yaml",
  html: "markup",
  xml: "markup",
  svg: "markup",
  md: "markdown",
  mdx: "markdown",
  postgres: "sql",
  postgresql: "sql",
  psql: "sql",
  sqlite: "sql",
  mysql: "sql",
  patch: "diff",
};

/** First token of the info string: ```ts title="x" or ```js:app.js -> ts / js. */
function langHead(raw: string | null | undefined): string {
  const trimmed = (raw ?? "").trim();
  return trimmed.split(/[\s:{,]/)[0] || trimmed;
}

/** Canonical supported language, or null if we don't have it registered. */
export function normalizeLang(raw: string | null | undefined): string | null {
  const head = langHead(raw).toLowerCase();
  if (!head) return null;
  const canonical = ALIASES[head] ?? head;
  return SUPPORTED.has(canonical) ? canonical : null;
}

const MONO =
  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

// The container provides background/border/radius; the highlighter's <pre>
// goes bare and only handles horizontal scroll.
const PRE_STYLE: CSSProperties = {
  margin: 0,
  padding: "0.75rem 0.875rem",
  background: "transparent",
  border: 0,
  borderRadius: 0,
  boxShadow: "none",
  textShadow: "none",
  overflowX: "auto",
  fontFamily: MONO,
  fontSize: 13,
  lineHeight: 1.65,
};

const CODE_STYLE: CSSProperties = {
  background: "transparent",
  textShadow: "none",
  fontFamily: MONO,
  fontSize: 13,
  lineHeight: 1.65,
};

function CopyButton({ text, className = "" }: { text: string; className?: string }) {
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const copy = useCallback(() => {
    const mark = () => {
      setDone(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setDone(false), 1500);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(mark, () => {});
    }
  }, [text]);

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={done ? "Copiado" : "Copiar código"}
      title={done ? "Copiado" : "Copiar"}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-soft transition hover:bg-black/[0.06] hover:text-ink focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-black/20 ${className}`}
    >
      {done ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

export type CodeBlockProps = {
  code: string;
  /** The fence's raw tag (```ts). Can be unknown or null. */
  lang?: string | null;
  /** Discreet note at the foot of the block (used by Mermaid when it can't draw). */
  note?: ReactNode;
};

function CodeBlockImpl({ code, lang, note }: CodeBlockProps) {
  const text = code.replace(/\n+$/, "");
  const canonical = normalizeLang(lang);
  const label = langHead(lang);

  return (
    <div className="group relative my-3 overflow-hidden rounded-lg border border-black/[0.07] bg-black/[0.03]">
      {label ? (
        <div className="flex items-center justify-between gap-2 border-b border-black/[0.06] px-3 py-1">
          <span className="select-none text-[11px] uppercase tracking-wide text-ink-soft/80">
            {label}
          </span>
          <CopyButton
            text={text}
            className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
          />
        </div>
      ) : (
        // With no language we skip the bar: the button floats in on hover.
        <CopyButton
          text={text}
          className="absolute right-1.5 top-1.5 z-10 bg-surface/80 opacity-0 backdrop-blur transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
        />
      )}

      {canonical ? (
        <SyntaxHighlighter
          language={canonical}
          style={oneLight}
          customStyle={PRE_STYLE}
          codeTagProps={{ style: CODE_STYLE }}
          wrapLongLines={false}
        >
          {text}
        </SyntaxHighlighter>
      ) : (
        <pre className="m-0 overflow-x-auto px-3.5 py-3 font-mono text-[13px] leading-[1.65] text-ink">
          <code className="bg-transparent p-0 font-normal text-inherit">{text}</code>
        </pre>
      )}

      {note ? (
        <div className="border-t border-black/[0.06] px-3 py-1.5 text-[12px] text-ink-soft">
          {note}
        </div>
      ) : null}
    </div>
  );
}

// During streaming the whole message re-renders per token: we memoize so only
// the block that's growing gets re-tokenized.
const CodeBlock = memo(CodeBlockImpl);
export default CodeBlock;
