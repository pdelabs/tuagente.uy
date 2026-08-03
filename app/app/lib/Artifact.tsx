"use client";

// Artefactos: cuando el agente devuelve un HTML o un SVG entero, mostrarlo como
// código es inútil. Lo renderizamos en un iframe AISLADO (sandbox sin
// allow-same-origin: puede correr su JS pero no puede tocar el portal, ni la
// clave del agente, ni el localStorage) con solapas Vista / Código.

import { useMemo, useState } from "react";
import { Code2, Eye, ExternalLink } from "lucide-react";
import CodeBlock from "./CodeBlock";

const SVG_SHELL = (svg: string) =>
  `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;display:grid;place-items:center;background:#fff}svg{max-width:100%;height:auto}</style>${svg}`;

export default function Artifact({ code, lang, streaming }: {
  code: string;
  lang: string;
  streaming?: boolean;
}) {
  const [tab, setTab] = useState<"vista" | "codigo">("vista");
  const doc = useMemo(
    () => (lang === "svg" ? SVG_SHELL(code) : code),
    [code, lang],
  );

  const openInTab = () => {
    const url = URL.createObjectURL(new Blob([doc], { type: "text/html" }));
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  };

  return (
    <div className="my-3 overflow-hidden rounded-lg border border-black/[0.07]">
      <div className="flex items-center gap-1 border-b border-black/[0.07] bg-black/[0.02] px-2 py-1.5">
        <Tab active={tab === "vista"} onClick={() => setTab("vista")} icon={Eye} label="Vista" />
        <Tab active={tab === "codigo"} onClick={() => setTab("codigo")} icon={Code2} label="Código" />
        <span className="ml-1 text-[11px] uppercase tracking-wide text-ink-soft/70">{lang}</span>
        <button
          onClick={openInTab}
          title="Abrir en una pestaña nueva"
          className="ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-ink-soft transition hover:bg-black/[0.05] hover:text-ink"
        >
          <ExternalLink className="h-3 w-3" />
          Abrir
        </button>
      </div>

      {tab === "codigo" ? (
        <div className="[&>div]:my-0 [&>div]:rounded-none [&>div]:border-0">
          <CodeBlock code={code} lang={lang} />
        </div>
      ) : streaming ? (
        <p className="px-3 py-8 text-center text-[13px] text-ink-soft">
          Vista previa cuando termine de escribirlo…
        </p>
      ) : (
        <iframe
          // Sin allow-same-origin a propósito: origen opaco, sin acceso al portal.
          sandbox="allow-scripts allow-popups allow-forms"
          srcDoc={doc}
          title="Vista previa del artefacto"
          className="h-80 w-full bg-white"
        />
      )}
    </div>
  );
}

function Tab({ active, onClick, icon: Icon, label }: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium transition ${
        active ? "bg-white text-ink shadow-none ring-1 ring-black/[0.07]" : "text-ink-soft hover:text-ink"
      }`}
    >
      <Icon className="h-3 w-3" />
      {label}
    </button>
  );
}
