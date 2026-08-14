"use client";

/* Vista previa de un artefacto DENTRO de la conversación.
 *
 * Antes, cuando el agente terminaba una visualización, el chat mostraba un chip
 * con el id y el cliente tenía que irse a otra pestaña para ver su propio
 * trabajo. Para algo como el kit de marca eso rompe la conversación justo en el
 * momento en que hay que mirarlo y contestar "sí, está bien".
 *
 * EL HTML DEL AGENTE NUNCA ENTRA AL DOM DEL PORTAL. Va en un iframe con
 * `sandbox=""` —cero permisos: ni scripts, ni forms, ni same-origin— igual que
 * las miniaturas de la pestaña Artefactos. Es la misma regla y por la misma
 * razón: es HTML que escribió un modelo.
 */

import { useEffect, useRef, useState } from "react";
import { ExternalLink, TriangleAlert } from "lucide-react";
import { getArtifact, type PortalConfig } from "./agent";
import { PARAM } from "./rutas";
import { Spinner } from "./ui";

const ARTIFACT_IN_TEXT = /\bart_\d{10}_[\w-]+\b/g;

/** Los artefactos que nombra un mensaje, sin repetir y en orden de aparición. */
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

  // Perezoso: una conversación larga puede nombrar muchos artefactos y cada uno
  // es una llamada al adapter. Se traen cuando el cliente llega a ellos.
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

  const href = `/app/artefactos?${PARAM.visualizacion}=${encodeURIComponent(id)}`;

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
          // sandbox="" = cero permisos. Ver la nota de arriba.
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
