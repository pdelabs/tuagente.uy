"use client";

// El agentito de verdad: personaje Rive (public/agentito.riv, hecho con
// rivemcp — sesión "Onboarding" del 6-8/8). El state machine "Agentito" expone:
//   miradaX / miradaY (number 0-100): hacia dónde miran las pupilas
//   gesto (number): qué está haciendo — 0 nada, 1 pensar (cabeza ladeada y
//     una ceja en arco), 2 libro, 3 libreta y lápiz, 4 lupa, 5 llave inglesa
//     girando un tornillo, 10 el celu (no lo pide el portal: es el fondo de la
//     escalera del ocio, más abajo)
//   festejar / matear / bostezar (trigger): el rebote de festejo, la cebada de
//     mate y el bostezo de aburrido
//   tono, antena, accesorio, pupila, boca, piel, traje, cejas: los ejes del look
// Encima trae flote y parpadeo como loops propios. El runtime es el "lite"
// (solo vectores) y el wasm se sirve desde /public — nada sale a un CDN.
// Mientras carga (o si algo falla) se ve la cara estática, que es el mismo
// dibujo: el reemplazo no salta.

import { useEffect, useRef, useState } from "react";
import { useRive, useStateMachineInput, RuntimeLoader } from "@rive-app/react-canvas-lite";
import { AgentitoAvatar, type AgentitoLook } from "./agentito";

RuntimeLoader.setWasmUrl("/rive.wasm");

/** Qué está haciendo el agente. Lo decide quien lo muestra, no el personaje.
 *
 *  Los cinco últimos son los gestos de TRABAJO. Cada uno son DOS cosas a la vez:
 *  la pose (animación del .riv, por el input `gesto`) y el recorrido de la
 *  mirada (código, moviendo miradaX/miradaY). Van juntos a propósito: la pose
 *  dice QUÉ está haciendo y la mirada apunta a donde está la acción. Mientras
 *  hay un gesto puesto, la mirada no sigue al cursor. */
export type EstadoAgentito =
  | "normal"      // sigue el cursor y nada más
  | "tranquilo"   // no hay nada esperándote: se ceba unos mates
  | "esperando"   // hay algo para tu ok: cada tanto mira hacia la barra lateral
  | "pensando"    // ladea la cabeza, arquea una ceja y se le va la mirada arriba
  | "leyendo"     // sostiene un libro y lo lee renglón a renglón; cada tanto pasa página
  | "escribiendo" // libreta y lápiz: el lápiz garabatea y él mira la punta
  | "buscando"    // lupa que barre la cara, con vistazos secos y salteados
  | "haciendo";   // llave inglesa que gira un tornillo, con temblorcito de esfuerzo

const GESTOS_DE_TRABAJO: EstadoAgentito[] = [
  "pensando", "leyendo", "escribiendo", "buscando", "haciendo",
];
const trabajando = (e: EstadoAgentito) => GESTOS_DE_TRABAJO.includes(e);

/** El input `gesto` del .riv. El orden es el del state machine, no alfabético. */
const NUMERO_DE_GESTO: Record<string, number> = {
  pensando: 1, leyendo: 2, escribiendo: 3, buscando: 4, haciendo: 5,
};

/** El celu. No está en NUMERO_DE_GESTO a propósito: no es un estado que el
 *  portal pida, sino el fondo de la escalera del ocio (más abajo). */
const GESTO_CELU = 10;

type Props = {
  /** Contador: cada incremento dispara el trigger de festejo. */
  festejos: number;
  look: AgentitoLook;
  estado?: EstadoAgentito;
  className?: string;
};

export default function AgentitoRive(props: Props) {
  // Se puede leer en el render: este módulo entra solo por next/dynamic con
  // ssr:false, así que siempre corre en el browser.
  const [quieto] = useState(
    () => typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  // Con reduced-motion NO montamos Rive: va el dibujo estático, que respeta el
  // look y encima se ahorra el wasm. Pausar el runtime no servía — quedaba
  // pausado antes de que el state machine aplicara los ejes, y salía el
  // agentito violeta por defecto en vez del que eligió el cliente.
  if (quieto) return <AgentitoAvatar look={props.look} className={props.className} />;
  return <AgentitoAnimado {...props} />;
}

// A partir de esta distancia del personaje, la mirada ya está al tope. Más
// corto y satura enseguida (deja de decir hacia dónde); más largo y casi no
// mueve los ojos.
const ALCANCE_MIRADA = 300;

// ── La escalera del ocio ──
// Cuánto hace que el cliente no toca nada. NO habla del agente sino del
// USUARIO, por eso vive acá adentro y no en el prop `estado`: el portal sabe
// si hay pendientes, no si te fuiste a hacer otra cosa. Solo corre con
// `estado === "tranquilo"`: si algo espera tu ok o el agente está laburando,
// no es momento de bostezar.
const OCIO_BOSTEZO = 90_000;   // 1½ min sin actividad: el primer bostezo
const OCIO_CELU = 240_000;     // 4 min: se aburre y saca el celu
const REPETIR_BOSTEZO = 50_000;

// Mover el mouse cuenta como "estás acá" para que no saque el celu mientras
// leés, pero NO se lo guarda: si el mousemove cortara el gesto, la guardada no
// se vería nunca (siempre movés el mouse ANTES de hacer clic). Una vez que
// está enganchado con el celu, solo lo despierta una acción deliberada.
const ACTIVIDAD = ["mousemove", "pointerdown", "keydown", "wheel", "touchstart"] as const;
const DELIBERADAS = ["pointerdown", "keydown", "wheel", "touchstart"] as const;

function AgentitoAnimado({ festejos, look, estado = "normal", className }: Props) {
  // Mientras mira el badge, el cursor no manda: si no, se pisan.
  const mirandoBadge = useRef(false);
  // Enganchado con el celu (el fondo de la escalera del ocio).
  const [distraido, setDistraido] = useState(false);
  // Dónde está el personaje en la pantalla: la mirada se calcula desde ACÁ, no
  // desde el centro de la ventana. Si no, mira torcido en cuanto no está
  // centrado (por ejemplo arriba a la izquierda, en Inicio).
  const caja = useRef<HTMLDivElement>(null);

  const { rive, RiveComponent } = useRive({
    src: "/agentito.riv",
    stateMachines: "Agentito",
    autoplay: true,
  });
  const miradaX = useStateMachineInput(rive, "Agentito", "miradaX");
  const miradaY = useStateMachineInput(rive, "Agentito", "miradaY");
  const inGesto = useStateMachineInput(rive, "Agentito", "gesto");
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
  const bostezar = useStateMachineInput(rive, "Agentito", "bostezar");

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

  useEffect(() => {
    if (festejos > 0) festejar?.fire();
  }, [festejos, festejar]);

  // Cuando no hay nada esperando tu ok, se ceba unos mates. El primero a los
  // ~20s de estar en pantalla; después cuando pinta (45s-2min).
  useEffect(() => {
    if (!matear || estado !== "tranquilo") return;
    let t: ReturnType<typeof setTimeout>;
    const programar = (ms: number) => {
      t = setTimeout(() => {
        matear.fire();
        programar(45_000 + Math.random() * 75_000);
      }, ms);
    };
    programar(20_000 + Math.random() * 15_000);
    return () => clearTimeout(t);
  }, [matear, estado]);

  // ── La escalera del ocio: mates → bostezo → el celu ──
  // Un solo reloj: cada actividad lo pone en cero y reprograma los dos
  // escalones. La guardada del celu no se programa: la dispara el clic.
  useEffect(() => {
    if (estado !== "tranquilo") {
      setDistraido(false);
      return;
    }
    let aBostezo: ReturnType<typeof setTimeout>;
    let aCelu: ReturnType<typeof setTimeout>;

    const programar = () => {
      clearTimeout(aBostezo);
      clearTimeout(aCelu);
      // El bostezo se repite solo mientras siga sin pasar nada; el celu es el
      // final del camino y se queda hasta que lo interrumpan.
      const bostezos = () => {
        try { bostezar?.fire(); } catch { /* el runtime se fue */ }
        aBostezo = setTimeout(bostezos, REPETIR_BOSTEZO + Math.random() * 20_000);
      };
      aBostezo = setTimeout(bostezos, OCIO_BOSTEZO);
      aCelu = setTimeout(() => setDistraido(true), OCIO_CELU);
    };

    const alMoverse = () => {
      // Con el celu afuera el mousemove NO lo interrumpe (está enganchado, no
      // te ve): solo reprograma para cuando vuelva a guardarlo.
      programar();
    };
    const alTocar = () => {
      // Acá está el chiste: te ve, guarda el celu de golpe y vuelve a lo suyo.
      // El `guardarCelu` del .riv sale solo al dejar de ser gesto 10.
      setDistraido(false);
      programar();
    };

    programar();
    for (const ev of ACTIVIDAD) {
      const deliberada = (DELIBERADAS as readonly string[]).includes(ev);
      window.addEventListener(ev, deliberada ? alTocar : alMoverse, { passive: true });
    }
    return () => {
      clearTimeout(aBostezo);
      clearTimeout(aCelu);
      for (const ev of ACTIVIDAD) {
        const deliberada = (DELIBERADAS as readonly string[]).includes(ev);
        window.removeEventListener(ev, deliberada ? alTocar : alMoverse);
      }
    };
  }, [estado, bostezar]);

  // Si algo espera tu visto bueno, cada tanto pega una mirada a la barra
  // lateral —donde está el badge de aprobaciones— y vuelve.
  useEffect(() => {
    if (!miradaX || !miradaY || estado !== "esperando") return;
    let ida: ReturnType<typeof setTimeout>;
    let vuelta: ReturnType<typeof setTimeout>;
    const ciclo = () => {
      ida = setTimeout(() => {
        mirandoBadge.current = true;
        // Abajo a la izquierda: el badge de aprobaciones queda en la barra
        // lateral, más abajo que el saludo donde vive el personaje.
        miradaX.value = 5;
        miradaY.value = 68;
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
  }, [miradaX, miradaY, estado]);

  // ── Los gestos de trabajo, parte 1: el objeto ──
  // El .riv se encarga de sacarlo y guardarlo (el state machine cruza suave
  // entre gestos, 220ms). Acá solo se dice cuál. Se escribe en el cuerpo del
  // efecto, NUNCA en el cleanup: al desmontar, el cleanup de `useRive` ya
  // destruyó la instancia y escribir después revienta la pantalla entera.
  useEffect(() => {
    if (!inGesto) return;
    try {
      // El celu gana sobre el reposo, pero nunca sobre un gesto pedido: si
      // llega laburo mientras estaba distraído, guarda y va a lo suyo.
      inGesto.value = distraido ? GESTO_CELU : (NUMERO_DE_GESTO[estado] ?? 0);
    } catch {
      /* el runtime se fue; el personaje es adorno, no puede tumbar el chat */
    }
  }, [inGesto, estado, distraido]);

  // ── Los gestos de trabajo, parte 2: la mirada ──
  // La gracia es que DICEN LA VERDAD: el chat sabe qué herramienta está
  // corriendo y elige el gesto, no rota al azar. Mientras hay uno puesto, el
  // cursor no manda. Cada recorrido apunta a DONDE ESTÁ SU OBJETO.
  useEffect(() => {
    if (!miradaX || !miradaY || !trabajando(estado)) return;
    let raf = 0;
    let t0 = 0;
    const tick = (t: number) => {
      if (!t0) t0 = t;
      const s = (t - t0) / 1000;
      let x = 50;
      let y = 50;
      // OJO con las amplitudes: el avatar del chat mide 28px, así que el rango
      // ENTERO de la mirada son ~2px en pantalla. Medido: por debajo de ±8 el
      // movimiento queda sub-píxel y no se ve. Por eso los gestos acá van
      // exagerados y se distinguen por AMPLITUD y VELOCIDAD, no por matiz.
      switch (estado) {
        case "leyendo": {
          // Un renglón: barre despacio y pega la vuelta rápido al margen.
          const p = (s % 1.6) / 1.6;
          x = p < 0.8 ? 18 + (p / 0.8) * 64 : 82 - ((p - 0.8) / 0.2) * 64;
          y = 62 + Math.sin(s * 0.7) * 5; // y va bajando por la página
          break;
        }
        case "pensando":
          // Arriba y a la derecha, del lado de la ceja en arco, a la deriva.
          x = 68 + Math.sin(s * 0.5) * 16;
          y = 22 + Math.cos(s * 0.38) * 10;
          break;
        case "escribiendo":
          // Bien abajo, en la punta del lápiz.
          x = 50 + Math.sin(s * 2.4) * 14;
          y = 80 + Math.sin(s * 1.2) * 4;
          break;
        case "buscando": {
          // Acá la lupa la mueve el .riv, no el código: barre de la derecha al
          // centro y vuelve, en 2,8 s. Los ojos la ACOMPAÑAN —al 70%, no
          // clavados— porque si miran para otro lado mientras se la pasan por
          // la cara queda rarísimo. Los tiempos son los keyframes de
          // `gestoBuscando` pasados a segundos (a 60fps: quieta hasta f12,
          // barre hasta f74, espera hasta f94, vuelve en f156, quieta hasta
          // f168). Arrancan juntos porque los dos salen del mismo cambio de
          // estado, y los dos corren contra el reloj real: no se desfasan.
          const p = s % 2.8;
          const suave = (u: number) => u * u * (3 - 2 * u); // ≈ el easeInOut del .riv
          let lupaX: number;
          if (p < 0.2) lupaX = 95;
          else if (p < 1.233) lupaX = 95 - 129 * suave((p - 0.2) / 1.033);
          else if (p < 1.567) lupaX = -34;
          else if (p < 2.6) lupaX = -34 + 129 * suave((p - 1.567) / 1.033);
          else lupaX = 95;
          const lupaY = 25 + 19 * Math.sin((p / 2.8) * Math.PI);
          // 184 y 176 son los semiejes del cuerpo: pasan la posición del
          // objeto a la escala 0-100 de la mirada.
          x = 50 + (lupaX / 184) * 35 + Math.sin(s * 6) * 3; // + un temblorcito
          y = 50 + (lupaY / 176) * 35;
          break;
        }
        case "haciendo":
          // Abajo a la derecha, mirándose la llave: tics cortos y RÁPIDOS. Se
          // distingue de "leyendo" por la velocidad, no por el tamaño: quieto
          // no servía — a 28px, quieto e "inactivo" se ven igual.
          x = 62 + Math.sin(s * 9) * 10;
          y = 62 + Math.sin(s * 7) * 5;
          break;
      }
      // El runtime puede irse entre frames (Rive se reinicia, el componente se
      // desmonta): escribir sobre un input muerto tira "Cannot set properties
      // of null" y se lleva puesta la pantalla ENTERA del cliente. Si pasa,
      // cortamos el loop en silencio — el personaje es adorno, no puede tumbar
      // el chat.
      try {
        miradaX.value = x;
        miradaY.value = y;
      } catch {
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    // Solo cortar el loop. NO escribir en los inputs acá: `useRive` está
    // declarado ANTES que este efecto, así que al desmontar su cleanup corre
    // primero y destruye la instancia — escribir después revienta con
    // "Cannot set properties of null". Y no hace falta: si arranca otro gesto
    // escribe él, y si el que sigue es el cursor, escribe al primer movimiento.
    return () => cancelAnimationFrame(raf);
  }, [miradaX, miradaY, estado]);

  // Con el celu afuera la mirada la manda el .riv (pupilas leyendo la
  // pantalla): la dejamos estacionada mirando el aparato y no seguimos al
  // cursor. Estacionarla no es redundante con los keyframes: los layers de
  // mirada corren después y le ganarían, y ahí los ojos volverían al frente
  // con el celu en la mano.
  useEffect(() => {
    if (!miradaX || !miradaY || !distraido) return;
    try {
      miradaX.value = 58;
      miradaY.value = 82;
    } catch {
      /* el runtime se fue */
    }
  }, [miradaX, miradaY, distraido]);

  useEffect(() => {
    if (!miradaX || !miradaY || trabajando(estado) || distraido) return;
    if (window.matchMedia("(pointer: coarse)").matches) return;
    const onMove = (e: MouseEvent) => {
      if (mirandoBadge.current) return;
      const r = caja.current?.getBoundingClientRect();
      if (!r || r.width === 0) return;
      // Vector desde la cara del personaje hasta el cursor: la dirección la da
      // el ángulo y la intensidad la distancia (con el cursor encima, mira al
      // frente; lejos, al tope).
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      const d = Math.hypot(dx, dy);
      if (d < 1) { miradaX.value = 50; miradaY.value = 50; return; }
      const fuerza = Math.min(1, d / ALCANCE_MIRADA);
      miradaX.value = 50 + (dx / d) * fuerza * 50;
      miradaY.value = 50 + (dy / d) * fuerza * 50;
    };
    window.addEventListener("mousemove", onMove, { passive: true });
    return () => window.removeEventListener("mousemove", onMove);
  }, [miradaX, miradaY, estado, distraido]);

  // Sin cursor (táctil) la mirada quedaría clavada al frente: paseo lento.
  useEffect(() => {
    if (!miradaX || !miradaY || trabajando(estado) || distraido) return;
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
  }, [miradaX, miradaY, estado, distraido]);

  return (
    <div ref={caja} className={`relative ${className ?? ""}`}>
      {!rive && <AgentitoAvatar look={look} vivo className="absolute inset-0 h-full w-full" />}
      <RiveComponent className={`h-full w-full ${rive ? "" : "opacity-0"}`} />
    </div>
  );
}
