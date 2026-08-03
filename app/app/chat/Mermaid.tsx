"use client";

// Diagramas mermaid del chat.
//
// mermaid pesa ~500 KB, así que entra por import() dinámico dentro del efecto:
// el bundle inicial del portal no lo toca hasta que el agente manda un ```mermaid.
// El render está debounceado porque durante el streaming el diagrama llega a
// medio escribir y no parsea — mientras tanto se muestra el código crudo.

import { useEffect, useId, useState } from "react";
import CodeBlock from "./CodeBlock";

type MermaidApi = (typeof import("mermaid"))["default"];

let mermaidPromise: Promise<MermaidApi> | null = null;

function getMermaid(): Promise<MermaidApi> {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid")
      .then((mod) => {
        mod.default.initialize({
          startOnLoad: false,
          theme: "neutral",
          securityLevel: "strict", // sanitiza el SVG: por eso podemos inyectarlo
          fontFamily: "inherit",
        });
        return mod.default;
      })
      .catch((err) => {
        mermaidPromise = null; // que un fallo de red no deje el módulo muerto
        throw err;
      });
  }
  return mermaidPromise;
}

export default function Mermaid({
  chart,
  streaming = false,
}: {
  chart: string;
  streaming?: boolean;
}) {
  // useId devuelve ":r3:" — los dos puntos rompen los selectores de mermaid.
  const id = `mermaid-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const [svg, setSvg] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");

  useEffect(() => {
    const src = chart.trim();
    if (!src) {
      setStatus("error");
      return;
    }

    let cancelled = false;
    // Si ya había un diagrama bueno lo dejamos en pantalla mientras redibujamos.
    setStatus((s) => (s === "ok" ? s : "loading"));

    const timer = setTimeout(() => {
      void (async () => {
        try {
          const mermaid = await getMermaid();
          if (cancelled) return;
          // parse() con suppressErrors evita que mermaid inyecte su cartel de
          // error en el <body> cuando el diagrama todavía está incompleto.
          const parsed = await mermaid.parse(src, { suppressErrors: true });
          if (cancelled) return;
          if (!parsed) throw new Error("diagrama inválido");
          const { svg: out } = await mermaid.render(id, src);
          if (cancelled) return;
          setSvg(out);
          setStatus("ok");
        } catch {
          if (cancelled) return;
          setSvg(null);
          setStatus("error");
        }
      })();
    }, 180);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [chart, id]);

  // mermaid usa un div temporal `d<id>` en el body; si algo explotó, lo barremos.
  useEffect(
    () => () => {
      if (typeof document !== "undefined") document.getElementById(`d${id}`)?.remove();
    },
    [id],
  );

  if (status === "ok" && svg) {
    return (
      <div
        className="my-3 overflow-x-auto rounded-lg border border-black/[0.07] bg-white p-3 [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
        // Sanitizado por mermaid (securityLevel: "strict").
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    );
  }

  // Mientras streamea nunca decimos "no pude": el diagrama todavía se está
  // escribiendo. El fallback es siempre el código crudo, nunca un throw.
  const failed = status === "error" && !streaming;

  return (
    <CodeBlock
      code={chart}
      lang="mermaid"
      note={
        failed ? (
          <span>No pude dibujar este diagrama</span>
        ) : (
          <span className="animate-pulse">Dibujando diagrama…</span>
        )
      }
    />
  );
}
