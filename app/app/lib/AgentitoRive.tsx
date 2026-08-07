"use client";

// El agentito de verdad: personaje Rive (public/agentito.riv, hecho con
// rivemcp — sesión "Onboarding" del 6/8). El state machine "Agentito" expone:
//   miradaX / miradaY (number 0-100): hacia dónde miran las pupilas
//   festejar (trigger): rebote de festejo cuando el cliente lo bautiza
// Encima trae flote y parpadeo como loops propios. El runtime es el "lite"
// (solo vectores) y el wasm se sirve desde /public — nada sale a un CDN.
// Mientras carga (o si algo falla) se ve la cara estática, que es el mismo
// dibujo: el reemplazo no salta.

import { useEffect, useState } from "react";
import { useRive, useStateMachineInput, RuntimeLoader } from "@rive-app/react-canvas-lite";
import { AgentitoSvg } from "./agentito";

RuntimeLoader.setWasmUrl("/rive.wasm");

/** Rasgos del personaje; cada eje es un input numérico del state machine. */
export type AgentitoLook = {
  tono: number;      // 0-5: color del cuerpo
  antena: number;    // 0-2: clásica / doble / sin antena
  accesorio: number; // 0-2: nada / anteojos / cachetes
  pupila: number;    // 0-2: normal / grande / chica
  boca: number;      // 0-2: sonrisa / sonrisota / media sonrisa
};

export const LOOK_EJES: Record<keyof AgentitoLook, number> = {
  tono: 6, antena: 3, accesorio: 3, pupila: 3, boca: 3,
};

export default function AgentitoRive({ festejos, look, className }: {
  /** Contador: cada incremento dispara el trigger de festejo. */
  festejos: number;
  look: AgentitoLook;
  className?: string;
}) {
  const [quieto, setQuieto] = useState(false);
  useEffect(() => {
    setQuieto(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  const { rive, RiveComponent } = useRive({
    src: "/agentito.riv",
    stateMachines: "Agentito",
    autoplay: true,
  });
  const miradaX = useStateMachineInput(rive, "Agentito", "miradaX");
  const miradaY = useStateMachineInput(rive, "Agentito", "miradaY");
  const festejar = useStateMachineInput(rive, "Agentito", "festejar");
  const inTono = useStateMachineInput(rive, "Agentito", "tono");
  const inAntena = useStateMachineInput(rive, "Agentito", "antena");
  const inAccesorio = useStateMachineInput(rive, "Agentito", "accesorio");
  const inPupila = useStateMachineInput(rive, "Agentito", "pupila");
  const inBoca = useStateMachineInput(rive, "Agentito", "boca");

  useEffect(() => {
    if (inTono) inTono.value = look.tono;
    if (inAntena) inAntena.value = look.antena;
    if (inAccesorio) inAccesorio.value = look.accesorio;
    if (inPupila) inPupila.value = look.pupila;
    if (inBoca) inBoca.value = look.boca;
  }, [look, inTono, inAntena, inAccesorio, inPupila, inBoca]);

  // Con reduced-motion el personaje queda en su primer frame, sin loops.
  useEffect(() => {
    if (quieto && rive) rive.pause();
  }, [quieto, rive]);

  useEffect(() => {
    if (festejos > 0) festejar?.fire();
  }, [festejos, festejar]);

  useEffect(() => {
    if (!miradaX || !miradaY || quieto) return;
    if (window.matchMedia("(pointer: coarse)").matches) return;
    const onMove = (e: MouseEvent) => {
      miradaX.value = Math.max(0, Math.min(100, (e.clientX / window.innerWidth) * 100));
      miradaY.value = Math.max(0, Math.min(100, (e.clientY / window.innerHeight) * 100));
    };
    window.addEventListener("mousemove", onMove, { passive: true });
    return () => window.removeEventListener("mousemove", onMove);
  }, [miradaX, miradaY, quieto]);

  // Sin cursor (táctil) la mirada quedaría clavada al frente: paseo lento.
  useEffect(() => {
    if (!miradaX || !miradaY || quieto) return;
    if (!window.matchMedia("(pointer: coarse)").matches) return;
    let raf = 0;
    const tick = (t: number) => {
      miradaX.value = 50 + 26 * Math.sin(t / 1700);
      miradaY.value = 50 + 16 * Math.sin(t / 2600);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [miradaX, miradaY, quieto]);

  return (
    <div className={`relative ${className ?? ""}`}>
      {!rive && <AgentitoSvg className="absolute inset-0 h-full w-full" />}
      <RiveComponent className={`h-full w-full ${rive ? "" : "opacity-0"}`} />
    </div>
  );
}
