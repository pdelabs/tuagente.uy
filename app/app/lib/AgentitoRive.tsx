"use client";

// El agentito de verdad: personaje Rive (public/agentito.riv, hecho con
// rivemcp — sesión "Onboarding" del 6/8). El state machine "Agentito" expone:
//   miradaX / miradaY (number 0-100): hacia dónde miran las pupilas
//   festejar (trigger): rebote de festejo cuando el cliente lo bautiza
// Encima trae flote y parpadeo como loops propios. El runtime es el "lite"
// (solo vectores) y el wasm se sirve desde /public — nada sale a un CDN.
// Mientras carga (o si algo falla) se ve la cara estática, que es el mismo
// dibujo: el reemplazo no salta.

import { useEffect, useRef, useState } from "react";
import { useRive, useStateMachineInput, RuntimeLoader } from "@rive-app/react-canvas-lite";
import { AgentitoAvatar, type AgentitoLook } from "./agentito";

RuntimeLoader.setWasmUrl("/rive.wasm");

/** Qué está haciendo el agente. Lo decide quien lo muestra, no el personaje. */
export type EstadoAgentito =
  | "normal"     // sigue el cursor y nada más
  | "tranquilo"  // no hay nada esperándote: se ceba unos mates
  | "esperando"; // hay algo para tu ok: cada tanto mira hacia la barra lateral

export default function AgentitoRive({ festejos, look, estado = "normal", className }: {
  /** Contador: cada incremento dispara el trigger de festejo. */
  festejos: number;
  look: AgentitoLook;
  estado?: EstadoAgentito;
  className?: string;
}) {
  const [quieto, setQuieto] = useState(false);
  // Mientras mira el badge, el cursor no manda: si no, se pisan.
  const mirandoBadge = useRef(false);
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
  const inPiel = useStateMachineInput(rive, "Agentito", "piel");
  const inTraje = useStateMachineInput(rive, "Agentito", "traje");
  const inCejas = useStateMachineInput(rive, "Agentito", "cejas");
  const matear = useStateMachineInput(rive, "Agentito", "matear");

  useEffect(() => {
    if (inTono) inTono.value = look.tono;
    if (inAntena) inAntena.value = look.antena;
    if (inAccesorio) inAccesorio.value = look.accesorio;
    if (inPupila) inPupila.value = look.pupila;
    if (inBoca) inBoca.value = look.boca;
    if (inPiel) inPiel.value = look.piel;
    if (inTraje) inTraje.value = look.traje;
    if (inCejas) inCejas.value = look.cejas;
  }, [look, inTono, inAntena, inAccesorio, inPupila, inBoca, inPiel, inTraje, inCejas]);

  // Con reduced-motion el personaje queda en su primer frame, sin loops.
  useEffect(() => {
    if (quieto && rive) rive.pause();
  }, [quieto, rive]);

  useEffect(() => {
    if (festejos > 0) festejar?.fire();
  }, [festejos, festejar]);

  // Cuando no hay nada esperando tu ok, se ceba unos mates. El primero a los
  // ~20s de estar en pantalla; después cuando pinta (45s-2min).
  useEffect(() => {
    if (!matear || quieto || estado !== "tranquilo") return;
    let t: ReturnType<typeof setTimeout>;
    const programar = (ms: number) => {
      t = setTimeout(() => {
        matear.fire();
        programar(45_000 + Math.random() * 75_000);
      }, ms);
    };
    programar(20_000 + Math.random() * 15_000);
    return () => clearTimeout(t);
  }, [matear, quieto, estado]);

  // Si algo espera tu visto bueno, cada tanto pega una mirada a la barra
  // lateral —donde está el badge de aprobaciones— y vuelve.
  useEffect(() => {
    if (!miradaX || !miradaY || quieto || estado !== "esperando") return;
    let ida: ReturnType<typeof setTimeout>;
    let vuelta: ReturnType<typeof setTimeout>;
    const ciclo = () => {
      ida = setTimeout(() => {
        mirandoBadge.current = true;
        miradaX.value = 5;
        miradaY.value = 28;
        vuelta = setTimeout(() => {
          mirandoBadge.current = false;
          miradaX.value = 50;
          miradaY.value = 50;
          ciclo();
        }, 1300);
      }, 6000 + Math.random() * 5000);
    };
    ciclo();
    return () => {
      clearTimeout(ida);
      clearTimeout(vuelta);
      mirandoBadge.current = false;
    };
  }, [miradaX, miradaY, quieto, estado]);

  useEffect(() => {
    if (!miradaX || !miradaY || quieto) return;
    if (window.matchMedia("(pointer: coarse)").matches) return;
    const onMove = (e: MouseEvent) => {
      if (mirandoBadge.current) return;
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
      if (!mirandoBadge.current) {
        miradaX.value = 50 + 26 * Math.sin(t / 1700);
        miradaY.value = 50 + 16 * Math.sin(t / 2600);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [miradaX, miradaY, quieto]);

  return (
    <div className={`relative ${className ?? ""}`}>
      {!rive && <AgentitoAvatar look={look} vivo className="absolute inset-0 h-full w-full" />}
      <RiveComponent className={`h-full w-full ${rive ? "" : "opacity-0"}`} />
    </div>
  );
}
