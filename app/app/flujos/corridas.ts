"use client";

// LA VERDAD SOBRE LA ÚLTIMA CORRIDA DE UN FLUJO.
//
// El QA a ciegas del 12/8 encontró el peor bug del portal: la veterinaria tenía
// dos flujos con el cartel "Activo" EN VERDE, y los dos ya habían corrido y
// fallado. Lo descubrió entrando a Actividad —escondida en "Más"—, y cuando le
// preguntó al agente por chat él le dijo la verdad: «todavía no te podés olvidar
// del tema, la última revisión automática falló». Su conclusión, textual:
// "mientras la pantalla mienta en verde, sigo con la misma carga mental".
//
// El dato existía y no lo mirábamos: `/portal/flujos` ya trae `ultima_corrida`
// con `status: "failed"`. Lo que NO trae —cuándo corre la próxima, por qué
// falló, si está pausada— vive en el gateway nativo, en `/api/jobs`. Este
// módulo junta las dos fuentes y contesta las tres preguntas del cliente:
// ¿corrió?, ¿salió bien?, ¿cuándo es la próxima?
//
// ATAR EL FLUJO A SU TAREA: cuando el adapter publique `gatillo_job` (lo tiene:
// lo lee del frontmatter para calcular `ultima_corrida`) se ata por id. Hasta
// entonces, por el nombre `flujo-<slug>`, que es el que le pone el kit al crear
// el cron. Ver `docs/PENDIENTES.md`.

import { cuandoPaso, cuandoVa, leerFalla, type Falla } from "../lib/palabras";
import type { CronJob, Flujo } from "../lib/agent";

export type ClaveEstado =
  | "incompleto" | "pausado" | "corriendo" | "fallo" | "bien" | "sin-correr";

export type Tono = "violet" | "green" | "coral" | "amber" | "neutral";

export type EstadoReal = {
  clave: ClaveEstado;
  tono: Tono;
  /** El cartel. Nunca dice "Activo" sobre algo que falló. */
  cartel: string;
  /** "Última vez: ayer a las 8:30 — no pudo terminar". "" si nunca corrió. */
  ultima: string;
  /** "Próxima vez: el lunes 17/08 a las 8:30". "" si no hay horario. */
  proxima: string;
  /** Por qué no pudo, en criollo. Solo cuando la última falló. */
  falla: Falla | null;
  /** ¿Se puede pausar / probar ahora? Solo si encontramos su tarea. */
  jobId: string | null;
  pausado: boolean;
};

const ms = (v: string | null | undefined): number => {
  if (!v) return 0;
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? 0 : t;
};

const FALLO_RE = /(fail|error|timeout|cancel)/i;
const BIEN_RE = /(^ok$|complet|success|done)/i;

/** La tarea programada de este flujo, o null si no la encontramos. */
export function jobDeFlujo(f: Flujo, jobs: CronJob[] | null | undefined): CronJob | null {
  if (!jobs?.length) return null;
  if (f.gatillo_job) return jobs.find((j) => j.id === f.gatillo_job) ?? null;
  const nombre = `flujo-${f.slug}`;
  const iguales = jobs.filter((j) => (j.name || "").trim() === nombre);
  if (iguales.length === 0) return null;
  // Con duplicados (el kit avisa que pueden existir) gana la que está viva, y
  // entre esas la que corrió más recién: es la que el cliente está mirando.
  return iguales.slice().sort((a, b) => {
    if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
    return ms(b.last_run_at) - ms(a.last_run_at);
  })[0];
}

/** ¿La última corrida salió bien, mal, o todavía no hubo ninguna? */
function comoSalio(f: Flujo, job: CronJob | null): "bien" | "mal" | null {
  // El estado del job manda: es el que el motor acaba de escribir. El del
  // adapter es el respaldo (y el único que hay si no encontramos la tarea).
  const delJob = job?.last_status ?? "";
  if (job?.last_run_at || delJob) {
    if (FALLO_RE.test(delJob)) return "mal";
    if (BIEN_RE.test(delJob)) return "bien";
  }
  const delAdapter = f.ultima_corrida?.status ?? "";
  if (!f.ultima_corrida?.cuando && !delAdapter) return null;
  if (FALLO_RE.test(delAdapter)) return "mal";
  return "bien";
}

const CUANDO_ULTIMA = (f: Flujo, job: CronJob | null) =>
  cuandoPaso(job?.last_run_at || f.ultima_corrida?.cuando);

/** El estado de un flujo, dicho como es. */
export function estadoReal(f: Flujo, job: CronJob | null): EstadoReal {
  const jobId = job?.id ?? null;
  const pausado = Boolean(job && (job.enabled === false || job.state === "paused"))
    || f.estado === "pausado";
  const proxima = !pausado && job?.next_run_at ? `Próxima vez: ${cuandoVa(job.next_run_at)}` : "";
  const salio = comoSalio(f, job);
  const cuando = CUANDO_ULTIMA(f, job);
  const falla = salio === "mal" ? leerFalla(job?.last_error) : null;
  const base = { proxima, falla, jobId, pausado };

  // Le falta una conexión: eso va antes que todo, porque es lo único que el
  // cliente puede destrabar solo.
  if (f.estado === "incompleto") {
    return {
      ...base, clave: "incompleto", tono: "amber", cartel: "Le falta una conexión",
      ultima: salio === "mal" ? `La última vez, ${cuando}, no pudo` : "",
    };
  }
  // Pausado NO borra lo que pasó: si la última falló, sigue diciéndolo. Un
  // flujo pausado sobre una corrida rota es justo el que hay que mirar antes de
  // reanudarlo.
  if (pausado) {
    return {
      ...base, clave: "pausado", tono: "neutral", cartel: "En pausa", proxima: "",
      ultima: !cuando ? ""
        : salio === "mal" ? `Última vez: ${cuando} — no pudo terminar`
        : `Última vez: ${cuando}`,
    };
  }
  if (job?.state === "running") {
    return { ...base, clave: "corriendo", tono: "violet", cartel: "Trabajando ahora", ultima: "" };
  }
  if (salio === "mal") {
    return {
      ...base, clave: "fallo", tono: "coral", cartel: "La última vez falló",
      ultima: `Corrió ${cuando} y no pudo terminar`,
    };
  }
  if (salio === "bien") {
    return {
      ...base, clave: "bien", tono: "green", cartel: "Activo",
      ultima: `Última vez: ${cuando} — salió bien`,
    };
  }
  // Nunca corrió. Con horario eso es un dato (está programado y todavía no le
  // tocó); sin horario —"cuando me lo pidas"— no hay nada que informar.
  if (f.gatillo_tipo === "horario") {
    return { ...base, clave: "sin-correr", tono: "neutral", cartel: "Todavía no corrió", ultima: "" };
  }
  return { ...base, clave: "sin-correr", tono: "green", cartel: "Activo", ultima: "" };
}

// EL ORDEN TAMBIÉN DICE ALGO. El adapter ordena por estado guardado, que no
// sabe nada de corridas: los dos flujos rotos de la veterinaria quedaban abajo
// de los sanos. Lo que le pide algo al cliente va arriba.
const PESO: Record<ClaveEstado, number> = {
  incompleto: 0, fallo: 1, corriendo: 2, bien: 3, "sin-correr": 4, pausado: 5,
};

export const ordenarPorUrgencia = <T extends { estado: EstadoReal; flujo: Flujo }>(xs: T[]): T[] =>
  xs.slice().sort((a, b) =>
    PESO[a.estado.clave] - PESO[b.estado.clave] ||
    a.flujo.nombre.localeCompare(b.flujo.nombre, "es"));
