"use client";

/* Artifact preview INSIDE the conversation.
 *
 * Before, when the agent finished a visualization, the chat showed a chip
 * with the id and the client had to go to another tab to see their own work.
 * For something like the brand kit that breaks the conversation right at the
 * moment they need to look at it and answer "yes, that's good".
 *
 * THE AGENT'S HTML NEVER ENTERS THE PORTAL'S DOM. It goes in an iframe with
 * `sandbox=""` -- zero permissions: no scripts, no forms, no same-origin --
 * same as the thumbnails on the Artifacts tab. Same rule, same reason: it's
 * HTML a model wrote.
 */

import { useEffect, useRef, useState } from "react";
import { ExternalLink, TriangleAlert } from "lucide-react";
import { getArtifact, type PortalConfig } from "./agent";
import { PARAM } from "./routes";
import { Spinner } from "./ui";

const ARTIFACT_IN_TEXT = /\bart_\d{10}_[\w-]+\b/g;

/** The artifacts a message names, deduplicated and in order of appearance. */
export function artifactIdsIn(text: string): string[] {
  const found: string[] = text.match(ARTIFACT_IN_TEXT) ?? [];
  return found.filter((id, i) => found.indexOf(id) === i);
}

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; html: string; title: string };

export default function ArtifactPreview({ cfg, id }: { cfg: PortalConfig; id: string }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [visible, setVisible] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // Lazy: a long conversation can name a lot of artifacts and each one is a
  // call to the adapter. They're fetched once the client scrolls to them.
  useEffect(() => {
    const node = box.current;
    if (!node || visible) return;
    if (typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const observer = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && setVisible(true)),
      { rootMargin: "200px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    let alive = true;
    getArtifact(cfg, id)
      .then((a) => {
        if (!alive) return;
        setState({ status: "ready", html: a.html, title: a.title || id });
      })
      .catch((e) => {
        if (!alive) return;
        setState({ status: "error", message: e instanceof Error ? e.message : String(e) });
      });
    return () => { alive = false; };
  }, [visible, cfg, id]);

  const href = `/app/artifacts?${PARAM.artifact}=${encodeURIComponent(id)}`;

  return (
    <div ref={box} className="mt-2 overflow-hidden rounded-xl border border-black/[0.07]">
      <div className="flex items-center gap-2 border-b border-black/[0.07] bg-black/[0.015] px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
          {state.status === "ready" ? state.title : "Visualización"}
        </span>
        <a
          href={href}
          className="flex shrink-0 items-center gap-1 text-[12px] text-ink-soft transition hover:text-primary"
          title="Abrirla en Artefactos"
        >
          Abrir <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      {state.status === "loading" && (
        <div className="flex h-24 items-center justify-center"><Spinner /></div>
      )}

      {state.status === "error" && (
        <div className="flex items-start gap-2 px-3 py-4 text-[13px] text-ink-soft">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-c-coral-ink" />
          <span>No se pudo traer la visualización. {state.message}</span>
        </div>
      )}

      {state.status === "ready" && (
        <iframe
          // sandbox="" = zero permissions. See the note above.
          sandbox=""
          srcDoc={state.html}
          title={state.title}
          loading="lazy"
          className="block h-[420px] w-full border-0 bg-white"
        />
      )}
    </div>
  );
}
