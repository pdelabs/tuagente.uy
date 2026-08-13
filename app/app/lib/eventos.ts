"use client";

// CÓMO SE LEE LA LÍNEA DE TIEMPO DEL AGENTE, UNA SOLA VEZ.
//
// Tres pantallas miran los mismos datos —Inicio en "Qué estuvo haciendo",
// Actividad entera, el Chat en su lista de conversaciones— y cada una se había
// escrito su propio criterio. El resultado, medido el 13/8:
//
//   · el slug del cron: Actividad decía «Avisos de ayuno para cirugías» e
//     Inicio, sobre el MISMO evento, «flujo-avisos-ayuno-cirugias».
//   · las conversaciones: Actividad listaba 5 (una de ellas el aviso interno
//     del portal, linkeada a una conversación que el Chat esconde) y el Chat
//     mostraba 4. El link caía en "Nueva conversación", vacía.
//
// Acá vive el criterio; las pantallas eligen cómo dibujarlo.

import { leerFalla } from "./palabras";
import type { CronJob, Flujo } from "./agent";

/** Una línea de la historia del agente. `href` y `porQue` los agrega el portal:
 *  el adapter manda `ts/kind/label/status` y nada más. */
export type EventoAgente = {
  ts: string;
  kind: string;
  label: string;
  status: string;
  /** Adónde lleva la fila (un flujo, un archivo). Los tickets van por su id. */
  href?: string;
  /** Por qué no pudo, en criollo. Solo en las corridas que fallaron. */
  porQue?: string;
};

const msDe = (ts: string | null | undefined): number => {
  const t = new Date(ts ?? "").getTime();
  return Number.isNaN(t) ? 0 : t;
};

/** Las corridas de los flujos, con el nombre que les puso el cliente.
 *
 *  «flujo-vacunas-vencidas-semanal · No pudo» era la línea que a la veterinaria
 *  le reveló la falla, y también la única que no podía abrir para ver por qué.
 *  Ahora dice el nombre del flujo, cuenta el motivo en criollo y lleva a la
 *  pantalla donde se puede pausar o volver a probar.
 *
 *  `jobs` es opcional: sin la lista de tareas programadas no se puede saber por
 *  qué falló, pero el nombre y el link salen igual. */
export function humanizarCorridas(
  evs: EventoAgente[], flujos: Flujo[] | null, jobs?: CronJob[] | null,
): EventoAgente[] {
  if (!flujos?.length) return evs;
  const porNombreDeJob = new Map<string, Flujo>();
  for (const f of flujos) porNombreDeJob.set(`flujo-${f.slug}`, f);
  return evs.map((ev) => {
    if (ev.kind !== "job_run") return ev;
    const f = porNombreDeJob.get((ev.label || "").trim());
    if (!f) return ev;
    const job = jobs?.find((j) => (j.name || "").trim() === `flujo-${f.slug}`);
    // El error del motor es el de la ÚLTIMA corrida: solo se le puede atribuir
    // a esta fila si esta fila ES la última. Colgárselo a una vieja sería
    // inventar.
    const esLaUltima = Boolean(
      job?.last_run_at && ev.ts && Math.abs(msDe(job.last_run_at) - msDe(ev.ts)) < 120_000);
    const fallo = /(fail|error|timeout|cancel)/i.test(ev.status || "");
    return {
      ...ev,
      label: f.nombre,
      href: `/app/flujos/${encodeURIComponent(f.slug)}`,
      porQue: fallo && esLaUltima ? leerFalla(job?.last_error).que : undefined,
    };
  });
}

/* ── Qué cuenta como una conversación ────────────────────────────────────── */

/** Lo poco que hace falta saber de una sesión para decidir si es de alguien.
 *  El listado del gateway trae bastante más. */
export type SesionParaFiltrar = {
  source?: string | null;
  title?: string | null;
  preview?: string | null;
};

// UNA CONVERSACIÓN ES ALGUIEN HABLANDO. El motor abre una "sesión" también para
// correr un cron y para que el agente trabaje un ticket solo; esas no son
// conversaciones de nadie y ya tienen su propia fila (la corrida del flujo, el
// evento del tablero). Listarlas ponía «Hablaron por Tareas programadas: "[IMPORTANT:
// You are running as a scheduled cron job…"» en la pantalla de una veterinaria:
// el prompt interno, en inglés, presentado como una charla suya.
const CANALES_HUMANOS = new Set([
  "api_server", "portal", "api", "telegram", "whatsapp", "discord", "signal",
]);

// Y NO ALCANZA CON EL CANAL. Los avisos que el portal le inyecta al agente
// ("cliente comentó en el ticket t_…") viajan por el mismo canal que el chat, en
// una sesión de sistema. El Chat ya la escondía; Actividad la listaba como una
// conversación más, la linkeaba —y el link caía en una pantalla vacía— y de paso
// contaba 5 donde el Chat contaba 4.
const ARRANQUES_DE_MAQUINA = ["### Task", "[Aviso del portal]"];

/** ¿Esta sesión es una conversación que el cliente reconoce como suya? */
export function esConversacionHumana(s: SesionParaFiltrar): boolean {
  if (!CANALES_HUMANOS.has((s.source ?? "").trim().toLowerCase())) return false;
  const t = (s.title ?? s.preview ?? "").trimStart();
  return !ARRANQUES_DE_MAQUINA.some((a) => t.startsWith(a));
}
