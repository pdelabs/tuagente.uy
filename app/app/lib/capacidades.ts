"use client";

// El catálogo de capacidades y lo que este browser ya pidió, compartido.
//
// Vivía adentro de `CapacidadChip.tsx` mientras el chat era el único que lo
// leía. Ahora también lo lee la ficha de cada compañero ("Qué sabe hacer"), y
// las dos pantallas TIENEN que mirar lo mismo:
//
//   - el catálogo, porque `activa` se calcula del lado del agente y dos copias
//     desincronizadas serían dos respuestas distintas a "¿esto ya lo tiene?";
//   - lo pedido, porque un pedido hecho desde el chat no se puede volver a
//     ofrecer en la ficha como si no hubiera pasado nada.
//
// Acá no hay UI: son los dos estados y nada más.

import { getCapacidades, loadConfig, type Capacidad } from "./agent";

let cache: Promise<Capacidad[]> | null = null;
// De QUÉ agente es lo cacheado: el cache es de la página, y la credencial puede
// cambiar mientras la pestaña sigue viva.
let cacheDe: string | null = null;

/** El catálogo entero, una sola vez por pestaña y por credencial. */
export function catalogoDeCapacidades(): Promise<Capacidad[]> {
  const cfg = loadConfig();
  const de = cfg ? `${cfg.endpoint}|${cfg.key}` : "";
  if (!cache || cacheDe !== de) {
    cacheDe = de;
    cache = cfg
      ? getCapacidades(cfg)
          .then((r) => r?.capacidades ?? [])
          .catch(() => { cache = null; return []; })
      : Promise.resolve([]);
  }
  return cache;
}

// Lo que este browser ya pidió. El adapter anota los pedidos en un archivo pero
// no los devuelve, así que no hay forma de preguntárselo: se recuerda acá para
// no invitar al doble clic ni al "¿lo habré pedido?".
const PEDIDAS_KEY = "tuagente_capacidades_pedidas";

export function leerPedidas(): string[] {
  try { return JSON.parse(localStorage.getItem(PEDIDAS_KEY) || "[]"); } catch { return []; }
}

export function marcarPedida(id: string) {
  try {
    const todas = Array.from(new Set([...leerPedidas(), id]));
    localStorage.setItem(PEDIDAS_KEY, JSON.stringify(todas));
  } catch { /* modo privado: al menos vale para esta pantalla */ }
}
