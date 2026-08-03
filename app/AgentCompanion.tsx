"use client";
import { useEffect, useRef } from "react";

/**
 * "El agentito", phase 1.5 — true metaball merge.
 * The body blob AND a violet "border strip" of the hovered card live inside the
 * same gooey-filtered layer, so approaching the card forms a real liquid bridge
 * (blur + alpha threshold), then the body pours into the strip which stretches
 * along the card border. Face (eyes/antenna) stays on a crisp layer above.
 * Desktop pointer only; disabled for touch and prefers-reduced-motion.
 */
export default function AgentCompanion() {
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const faceRef = useRef<SVGSVGElement>(null);
  const pupilL = useRef<SVGCircleElement>(null);
  const pupilR = useRef<SVGCircleElement>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(pointer: coarse)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const root = rootRef.current, stage = stageRef.current, body = bodyRef.current,
      strip = stripRef.current, face = faceRef.current;
    if (!root || !stage || !body || !strip || !face) return;
    root.style.opacity = "1";

    const pos = { x: window.innerWidth - 92, y: window.innerHeight * 0.42 };
    const vel = { x: 0, y: 0 };
    const mouse = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    let merged: HTMLElement | null = null;
    let sitting = false;
    let stripW = 0;
    let sitOff = 0; // face settle offset, lerped
    let raf = 0;

    const cards = Array.from(document.querySelectorAll<HTMLElement>("[data-agent-card]"));

    const onMove = (e: MouseEvent) => { mouse.x = e.clientX; mouse.y = e.clientY; };
    window.addEventListener("mousemove", onMove, { passive: true });

    const clearMerge = (card: HTMLElement) => {
      if (merged === card) {
        merged = null;
        sitting = false;
        card.classList.remove("agent-merged");
        stage.classList.remove("agent-melting");
      }
    };
    const handlers: [HTMLElement, () => void, () => void][] = cards.map((c) => {
      const en = () => { merged = c; sitting = false; stage.classList.add("agent-melting"); };
      const lv = () => clearMerge(c);
      c.addEventListener("mouseenter", en);
      c.addEventListener("mouseleave", lv);
      return [c, en, lv];
    });

    const activeSectionY = () => {
      let best: DOMRect | null = null, bestVis = 0;
      for (const s of Array.from(document.querySelectorAll<HTMLElement>("section"))) {
        const r = s.getBoundingClientRect();
        const vis = Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0);
        if (vis > bestVis) { bestVis = vis; best = r; }
      }
      return best
        ? Math.max(90, Math.min(window.innerHeight - 120, best.top + best.height / 2))
        : window.innerHeight * 0.42;
    };

    const tick = (now: number) => {
      let tx: number, ty: number;
      const rect = merged?.getBoundingClientRect() ?? null;

      if (rect) {
        tx = rect.right - 64;
        ty = rect.top + 1;
        const near = Math.abs(pos.x - tx) < 24 && Math.abs(pos.y - ty) < 24;
        if (near && !sitting && merged) {
          sitting = true;
          merged.classList.add("agent-merged");
          stage.classList.remove("agent-melting");
        }
      } else {
        tx = window.innerWidth - 92;
        ty = activeSectionY();
      }

      vel.x += (tx - pos.x) * 0.016;
      vel.y += (ty - pos.y) * 0.016;
      vel.x *= 0.85;
      vel.y *= 0.85;
      pos.x += vel.x;
      pos.y += vel.y;

      const bob = merged ? 0 : Math.sin(now / 620) * 3;
      sitOff += ((sitting ? 9 : 0) - sitOff) * 0.12;

      // Stage: covers bot + card strip so the goo filter can bridge them.
      let sx: number, sy: number, sw: number, sh: number;
      if (rect) {
        const minX = Math.min(pos.x - 60, rect.left - 20);
        const maxX = Math.max(pos.x + 60, rect.right + 20);
        const minY = Math.min(pos.y - 60, rect.top - 26);
        const maxY = Math.max(pos.y + 60, rect.top + 40);
        sx = minX; sy = minY; sw = maxX - minX; sh = maxY - minY;
      } else {
        sx = pos.x - 80; sy = pos.y - 80; sw = 160; sh = 160;
      }
      stage.style.transform = `translate3d(${sx}px, ${sy}px, 0)`;
      stage.style.width = `${sw}px`;
      stage.style.height = `${sh}px`;

      // Body blob (44px) inside the stage; shrinks as it pours into the strip.
      body.style.transform = `translate3d(${pos.x - 22 - sx}px, ${pos.y - 22 - sy + bob}px, 0) scale(${sitting ? 0.6 : 1})`;

      // Border strip: appears at the landing point, then stretches along the card border.
      if (rect) {
        const targetW = sitting ? rect.width + 6 : 96;
        stripW += (targetW - stripW) * 0.13;
        const cx = sitting ? rect.left - 3 + (rect.width + 6) / 2 : tx;
        strip.style.opacity = "1";
        strip.style.width = `${stripW}px`;
        strip.style.transform = `translate3d(${cx - stripW / 2 - sx}px, ${rect.top - 7 - sy}px, 0)`;
      } else {
        stripW = 0;
        strip.style.opacity = "0";
      }

      // Crisp face rides on top.
      const tilt = Math.max(-13, Math.min(13, vel.x * 0.9));
      face.style.transform = `translate3d(${pos.x - 36}px, ${pos.y - 36 + bob + sitOff}px, 0) rotate(${tilt}deg)`;
      face.classList.toggle("agent-sitting-face", sitting);

      const dx = mouse.x - pos.x, dy = mouse.y - pos.y;
      const d = Math.hypot(dx, dy) || 1;
      pupilL.current?.setAttribute("transform", `translate(${(dx / d) * 2.6} ${(dy / d) * 2.6})`);
      pupilR.current?.setAttribute("transform", `translate(${(dx / d) * 2.6} ${(dy / d) * 2.6})`);

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
      <svg width="0" height="0" aria-hidden style={{ position: "absolute" }}>
        <defs>
          <filter id="agent-goo">
            <feGaussianBlur in="SourceGraphic" stdDeviation="8" result="blur" />
            <feColorMatrix
              in="blur"
              mode="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -10"
              result="goo"
            />
            <feComposite in="SourceGraphic" in2="goo" operator="atop" />
          </filter>
        </defs>
      </svg>

      <div
        ref={rootRef}
        className="pointer-events-none fixed inset-0 z-[80] opacity-0 transition-opacity duration-700"
        aria-hidden
      >
        {/* Liquid layer: everything here melts together. */}
        <div ref={stageRef} className="agent-goo absolute left-0 top-0">
          <div ref={bodyRef} className="agent-body-blob2">
            <span className="agent-drop2 agent-drop2-1" />
            <span className="agent-drop2 agent-drop2-2" />
            <span className="agent-drop2 agent-drop2-3" />
          </div>
          <div ref={stripRef} className="agent-strip" />
        </div>

        {/* Crisp face layer */}
        <svg ref={faceRef} className="agent-face2 absolute left-0 top-0 h-[72px] w-[72px]" viewBox="0 0 72 72">
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
    </>
  );
}
