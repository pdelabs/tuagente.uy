"use client";
import { useEffect, useRef } from "react";

/**
 * "El agentito": embodied companion, phase 1.
 * - Floats along the right edge, following the section you are reading (spring physics).
 * - Pupils track the mouse; blinks; bobs when idle.
 * - Hovering a big card ([data-agent-card]) makes it fly over and melt into the
 *   card border with a metaball/gooey animation (SVG blur+contrast filter).
 * Desktop pointer only; disabled for touch and prefers-reduced-motion.
 */
export default function AgentCompanion() {
  const rootRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const pupilL = useRef<SVGCircleElement>(null);
  const pupilR = useRef<SVGCircleElement>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(pointer: coarse)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const root = rootRef.current, inner = innerRef.current;
    if (!root || !inner) return;
    root.style.opacity = "1";

    const pos = { x: window.innerWidth - 92, y: window.innerHeight * 0.42 };
    const vel = { x: 0, y: 0 };
    const mouse = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    let merged: HTMLElement | null = null;
    let sitting = false;
    let raf = 0;

    const sections = () =>
      Array.from(document.querySelectorAll<HTMLElement>("section[id], section"));
    const cards = Array.from(document.querySelectorAll<HTMLElement>("[data-agent-card]"));

    const onMove = (e: MouseEvent) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
    };
    window.addEventListener("mousemove", onMove, { passive: true });

    const enter = (card: HTMLElement) => () => {
      merged = card;
      inner.classList.add("agent-melting");
    };
    const leave = (card: HTMLElement) => () => {
      if (merged === card) {
        merged = null;
        sitting = false;
        card.classList.remove("agent-merged");
        inner.classList.remove("agent-melting", "agent-sitting");
      }
    };
    const handlers: [HTMLElement, () => void, () => void][] = cards.map((c) => {
      const en = enter(c), lv = leave(c);
      c.addEventListener("mouseenter", en);
      c.addEventListener("mouseleave", lv);
      return [c, en, lv];
    });

    const tick = () => {
      let tx: number, ty: number;
      if (merged) {
        const r = merged.getBoundingClientRect();
        tx = r.right - 42;
        ty = r.top + 2;
        const arrived = Math.abs(pos.x - tx) < 26 && Math.abs(pos.y - ty) < 26;
        if (arrived && !sitting) {
          sitting = true;
          merged.classList.add("agent-merged");
          inner.classList.add("agent-sitting");
        }
      } else {
        // Float at the right edge, vertically tracking the most visible section.
        let best: HTMLElement | null = null, bestVis = 0;
        for (const s of sections()) {
          const r = s.getBoundingClientRect();
          const vis = Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0);
          if (vis > bestVis) { bestVis = vis; best = s; }
        }
        const r = best?.getBoundingClientRect();
        tx = window.innerWidth - 92;
        ty = r
          ? Math.max(90, Math.min(window.innerHeight - 120, r.top + r.height / 2))
          : window.innerHeight * 0.42;
      }

      vel.x += (tx - pos.x) * 0.016;
      vel.y += (ty - pos.y) * 0.016;
      vel.x *= 0.85;
      vel.y *= 0.85;
      pos.x += vel.x;
      pos.y += vel.y;
      root.style.transform = `translate3d(${pos.x - 36}px, ${pos.y - 36}px, 0)`;

      // Lean into the direction of travel.
      const tilt = Math.max(-14, Math.min(14, vel.x * 0.9));
      inner.style.setProperty("--agent-tilt", `${tilt}deg`);

      // Pupils track the mouse.
      const dx = mouse.x - pos.x, dy = mouse.y - pos.y;
      const d = Math.hypot(dx, dy) || 1;
      const px = (dx / d) * 2.6, py = (dy / d) * 2.6;
      pupilL.current?.setAttribute("transform", `translate(${px} ${py})`);
      pupilR.current?.setAttribute("transform", `translate(${px} ${py})`);

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("mousemove", onMove);
      handlers.forEach(([c, en, lv]) => {
        c.removeEventListener("mouseenter", en);
        c.removeEventListener("mouseleave", lv);
        c.classList.remove("agent-merged");
      });
    };
  }, []);

  return (
    <>
      {/* Gooey filter: blur + hard alpha threshold = liquid merge between blobs. */}
      <svg width="0" height="0" aria-hidden style={{ position: "absolute" }}>
        <defs>
          <filter id="agent-goo">
            <feGaussianBlur in="SourceGraphic" stdDeviation="5" result="blur" />
            <feColorMatrix
              in="blur"
              mode="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -9"
              result="goo"
            />
            <feComposite in="SourceGraphic" in2="goo" operator="atop" />
          </filter>
        </defs>
      </svg>

      <div
        ref={rootRef}
        className="pointer-events-none fixed left-0 top-0 z-[80] h-[72px] w-[72px] opacity-0 transition-opacity duration-700"
        aria-hidden
      >
        <div ref={innerRef} className="agent-inner relative h-full w-full">
          {/* Goo layer: silhouette blobs only (face stays crisp outside the filter). */}
          <div className="agent-goo absolute inset-0">
            <div className="agent-blob agent-body-blob" />
            <div className="agent-blob agent-drop agent-drop-1" />
            <div className="agent-blob agent-drop agent-drop-2" />
            <div className="agent-blob agent-drop agent-drop-3" />
          </div>
          {/* Face layer */}
          <svg className="agent-face absolute inset-0" viewBox="0 0 72 72">
            <line x1="36" y1="14" x2="36" y2="7" stroke="#5B4BE8" strokeWidth="3" strokeLinecap="round" />
            <circle cx="36" cy="5.5" r="3" fill="#5B4BE8" />
            <g className="agent-eyes">
              <circle cx="28" cy="34" r="6.5" fill="#fff" />
              <circle cx="44" cy="34" r="6.5" fill="#fff" />
              <circle ref={pupilL} cx="28" cy="34" r="2.8" fill="#14131F" />
              <circle ref={pupilR} cx="44" cy="34" r="2.8" fill="#14131F" />
            </g>
            <path className="agent-smile" d="M30 45 Q36 50 42 45" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" fill="none" />
          </svg>
        </div>
      </div>
    </>
  );
}
