"use client";

// Render markdown de las respuestas del agente, con la estética tonal del
// portal (colores de tailwind.config.ts).

import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const components: Components = {
  p: ({ children }) => (
    <p className="my-2 leading-relaxed first:mt-0 last:mb-0">{children}</p>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="font-semibold text-primary underline underline-offset-2 hover:text-primary-dark"
    >
      {children}
    </a>
  ),
  ul: ({ children }) => <ul className="my-2 ml-5 list-disc space-y-1">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 ml-5 list-decimal space-y-1">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  h1: ({ children }) => (
    <h1 className="mb-2 mt-4 text-lg font-extrabold tracking-tight text-ink first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-2 mt-4 text-base font-extrabold tracking-tight text-ink first:mt-0">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-1.5 mt-3 text-[15px] font-bold text-ink first:mt-0">{children}</h3>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-4 border-c-violet pl-3 text-ink-soft">{children}</blockquote>
  ),
  pre: ({ children }) => (
    <pre className="my-3 overflow-x-auto rounded-2xl bg-c-ink p-4 text-[13px] leading-relaxed text-white [&_code]:bg-transparent [&_code]:p-0 [&_code]:font-normal [&_code]:text-inherit">
      {children}
    </pre>
  ),
  code: ({ children }) => (
    <code className="rounded-md bg-c-violet px-1.5 py-0.5 text-[0.9em] font-semibold text-c-violet-ink">
      {children}
    </code>
  ),
  hr: () => <hr className="my-4 border-c-violet" />,
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto rounded-2xl border border-c-violet">
      <table className="w-full text-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="bg-c-violet px-3 py-2 text-left font-bold text-c-violet-ink">{children}</th>
  ),
  td: ({ children }) => (
    <td className="border-t border-c-violet px-3 py-2 align-top">{children}</td>
  ),
};

export default function Markdown({ children }: { children: string }) {
  return (
    <div className="text-[15px] text-ink break-words">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{children}</ReactMarkdown>
    </div>
  );
}
