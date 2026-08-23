"use client";

// The chat's mermaid diagrams.
//
// mermaid weighs ~500 KB, so it's loaded via dynamic import() inside the
// effect: the portal's initial bundle never touches it until the agent sends
// a ```mermaid fence. The render is debounced because during streaming the
// diagram arrives half-written and fails to parse -- meanwhile the raw code
// is shown.

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
          securityLevel: "strict", // sanitizes the SVG: that's why we can inject it
          fontFamily: "inherit",
        });
        return mod.default;
      })
      .catch((err) => {
        mermaidPromise = null; // so a network failure doesn't leave the module dead
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
  // useId returns ":r3:" -- the colons break mermaid's selectors.
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
    // If there was already a good diagram, we leave it on screen while we redraw.
    setStatus((s) => (s === "ok" ? s : "loading"));

    const timer = setTimeout(() => {
      void (async () => {
        try {
          const mermaid = await getMermaid();
          if (cancelled) return;
          // parse() with suppressErrors keeps mermaid from injecting its own
          // error banner into the <body> while the diagram is still incomplete.
          const parsed = await mermaid.parse(src, { suppressErrors: true });
          if (cancelled) return;
          if (!parsed) throw new Error("invalid diagram");
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

  // mermaid uses a temporary `d<id>` div in the body; if something blew up, we sweep it.
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
        // Sanitized by mermaid (securityLevel: "strict").
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    );
  }

  // While streaming we never say "couldn't draw it": the diagram is still
  // being written. The fallback is always the raw code, never a throw.
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
