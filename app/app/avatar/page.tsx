"use client";

// Página utilitaria (no linkeada): el agentito del agente, solo, en 640×640.
// Existe para fotografiarla con Chrome headless y generar el PNG del avatar
// del bot cuando el bautizo fue anterior a la captura automática.
//
// RIVE, no el SVG estático: el estático es una versión simplificada (sin
// anteojos ni accesorios) y la foto salía "parecida pero no él" — verificado
// el 7/8 con Selastian. El costo es esperar a que el canvas cargue; el
// headless usa un virtual-time-budget generoso para eso.
// Se entra con el magic link normal (#key=...): sin key no muestra nada.

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { getManifest, loadConfig } from "../lib/agent";
import {
  AgentitoCargando, LOOK_DEFAULT, hayLookGuardado, loadAgentLook,
  lookDesdeAgente, type AgentitoLook,
} from "../lib/agentito";

const AgentitoRive = dynamic(() => import("../lib/AgentitoRive"), {
  ssr: false,
  loading: () => <AgentitoCargando />,
});

// Orden CANONICO de los ejes para el parámetro #look= (coma-separado).
const EJES_ORDEN = ["tono", "antena", "accesorio", "pupila", "boca", "piel", "traje", "cejas"] as const;

export default function AvatarPage() {
  const [look, setLook] = useState<AgentitoLook | null>(null);

  useEffect(() => {
    // Camino determinista (headless): #look=4,1,1,0,2,0,0,1 — sin red, sin
    // adapter. Fue la cura al bug del 7/8: el fetch del manifest fallaba en
    // headless y la foto salía con el look default (violeta, sin anteojos).
    const m = window.location.hash.match(/look=([\d,]+)/);
    if (m) {
      const vals = m[1].split(",").map(Number);
      const parsed = { ...LOOK_DEFAULT } as AgentitoLook;
      EJES_ORDEN.forEach((eje, i) => {
        if (Number.isInteger(vals[i])) (parsed as Record<string, number>)[eje] = vals[i];
      });
      setLook(parsed);
      return;
    }
    const cfg = loadConfig();
    if (!cfg) return;
    getManifest(cfg)
      .then((mf) => setLook(lookDesdeAgente(mf.look) ?? (hayLookGuardado() ? loadAgentLook() : LOOK_DEFAULT)))
      .catch(() => setLook(hayLookGuardado() ? loadAgentLook() : LOOK_DEFAULT));
  }, []);

  if (!look) return null;
  return (
    <div
      id="avatar-listo"
      style={{ width: 640, height: 640, display: "grid", placeItems: "center" }}
    >
      <div style={{ width: 560, height: 560 }}>
        <AgentitoRive festejos={0} look={look} estado="normal" className="h-full w-full" />
      </div>
    </div>
  );
}
