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
// LA SEGUNDA AUDITORÍA (13/8) ENCONTRÓ QUE SEGUÍA MINTIENDO, EN LAS DOS
// DIRECCIONES, y de ahí salen las tres reglas que ordenan este archivo:
//
// 1. SE SEPARA LO QUE EL MOTOR AFIRMA DE LO QUE EL PORTAL DEDUCE. `Resultado`
//    solo vale "bien" cuando el motor escribió un estado que significa "salió
//    bien"; cualquier otra cosa —incluido el `unknown` que el motor escribe
//    cuando el scheduler reinicia con una corrida a mitad, textual "whether
//    side effects ran is unknown"— es "dudoso", que no se pinta de verde.
// 2. NO ENCONTRAR LA TAREA Y NO PODER PREGUNTAR SON COSAS DISTINTAS. Antes las
//    dos eran el mismo `null` y las dos terminaban en verde. Ahora entran por
//    `Cruce`, que las nombra: `sin-tarea` (el gateway contestó y este flujo no
//    tiene cron) y `sin-datos` (el gateway no contestó, no se puede afirmar
//    nada).
// 3. UNA CONEXIÓN QUE FALTA NO ES UNA CAUSA. En Faro, un flujo que fallaba por
//    `No LLM provider configured` mostraba "Le falta correo · Conectar correo":
//    la clienta conecta el correo y vuelve a fallar. El motivo real viaja
//    siempre en `nota`; las conexiones que faltan viajan aparte, en `faltan`.
//
// ATAR EL FLUJO A SU TAREA: cuando el adapter publique `gatillo_job` (lo tiene:
// lo lee del frontmatter para calcular `ultima_corrida`) se ata por id. Hasta
// entonces, por el nombre `flujo-<slug>`, que es el que le pone el kit al crear
// el cron. Ver `docs/PENDIENTES.md`.

import { useSyncExternalStore } from "react";
import { cuandoPaso, cuandoVa, leerFalla, momento } from "../lib/palabras";
import {
  getJobs, jobAction, type CronJob, type Flujo, type PortalConfig,
} from "../lib/agent";

export type ClaveEstado =
  | "sin-confirmar" | "pausado" | "corriendo" | "sin-tarea" | "atrasado"
  | "fallo" | "dudoso" | "incompleto" | "bien" | "sin-correr";

export type Tono = "violet" | "green" | "coral" | "amber" | "neutral";

/** Lo que hay que contarle al cliente sobre este flujo, y qué puede hacer.
 *  Contesta las dos preguntas de la tarjeta: qué pasó y si tiene que hacer algo. */
export type Nota = {
  tono: "coral" | "amber";
  /** Qué pasó, en una línea, sin nombres de máquina. */
  que: string;
  /** Qué implica y qué va a pasar solo. */
  detalle: string;
  /** Ofrecer "Probarlo ahora" como PRIMERA acción: la falla puede ser pasajera
   *  y el reintento es lo que la destrabó en el laboratorio. */
  reintento: boolean;
  /** Ofrecer pedirle por chat que lo vuelva a programar. */
  reprogramar: boolean;
  /** Ofrecer escribirnos. Siempre DESPUÉS del reintento, nunca en su lugar. */
  avisanos: boolean;
  /** Qué puede hacer él, si hay algo. "" = no hay nada. */
  hace: string;
  /** El texto del motor, tal cual vino. No se esconde: se pliega. */
  crudo: string;
};

export type EstadoReal = {
  clave: ClaveEstado;
  tono: Tono;
  /** El cartel. Nunca dice "Activo" sobre algo que falló, que quedó sin
   *  confirmar, o que no pudimos cruzar con el motor. */
  cartel: string;
  /** "Última vez: ayer a las 8:30 — salió bien". "" si no hay nada que contar. */
  ultima: string;
  /** "Próxima vez: el lunes 17/08 a las 8:30". "" si no hay horario que afirmar. */
  proxima: string;
  /** Qué pasó y qué hacer. null cuando no hay nada que explicar. */
  nota: Nota | null;
  /** Conexiones que le faltan. SECUNDARIO: nunca reemplaza a `nota`. */
  faltan: string[];
  /** ¿Se puede pausar / probar ahora? Solo si encontramos su tarea. */
  jobId: string | null;
  pausado: boolean;
  /** Está corriendo AHORA. */
  corriendo: boolean;
  /** No pudimos leer `/api/jobs`: la pantalla corre con datos parciales. */
  sinConfirmar: boolean;
  /** Cambia cuando arranca o termina una corrida. Lo usa el guardián del
   *  re-pausado para saber que el motor ya tomó la corrida. */
  huella: string;
};

/* ── Lo que el motor afirma ──────────────────────────────────────────────── */

/** `/api/jobs` trae también la última EJECUCIÓN, y es lo único que dice si el
 *  flujo está corriendo AHORA: el motor NUNCA escribe `state: "running"` —
 *  `cron/jobs.py` solo escribe scheduled / paused / error / completed—, lo que
 *  corre es `latest_execution.status`. Todavía no está en el tipo `CronJob`
 *  (`lib/agent.ts` lo toca otro agente), así que se lee por estructura. */
type Ejecucion = {
  id?: string | null;
  /** claimed | running | completed | failed | unknown */
  status?: string | null;
  claimed_at?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  error?: string | null;
};
type JobConCorrida = CronJob & { latest_execution?: Ejecucion | null };

/** Cómo salió una corrida SEGÚN EL MOTOR. `null` = nunca corrió.
 *
 *  "dudoso" no es "más o menos bien": es el motor diciendo que no sabe. El
 *  default tiene que ser este y no "bien" — antes cualquier status que no
 *  matcheara `fail|error|timeout|cancel` se pintaba de verde, y el motor
 *  escribe `status='unknown'` con el texto "whether side effects ran is
 *  unknown" cuando el scheduler reinicia con una corrida a mitad
 *  (`cron/executions.py:199`), camino en el que además NO llama a
 *  `mark_job_run`. Medido: cartel "Activo" y "salió bien" sobre una corrida
 *  cuyo resultado el propio motor declara desconocido. */
export type Resultado = "bien" | "mal" | "dudoso" | null;

// Listas EXACTAS a propósito. Un status nuevo del motor no puede caer en
// "salió bien" por descarte: cae en "dudoso", que es la verdad.
const BIEN = new Set([
  "ok", "completed", "complete", "success", "succeeded", "done", "finished",
]);
const MAL = new Set([
  "error", "failed", "failure", "fail", "timeout", "timed_out", "cancelled",
  "canceled", "aborted", "crashed", "killed",
]);
/** Corriendo: `create_execution` la deja en `claimed` y el motor la pasa a
 *  `running` justo antes de largar el agente. */
const EN_VUELO = new Set(["claimed", "running", "pending", "started"]);

const leerStatus = (s: string | null | undefined): Resultado => {
  const t = (s ?? "").trim().toLowerCase();
  if (!t) return null;
  if (BIEN.has(t)) return "bien";
  if (MAL.has(t)) return "mal";
  return "dudoso";
};

const ms = (v: string | null | undefined): number => {
  const m = momento(v);
  return m ? m.ms : 0;
};

/* ── Cruzar el flujo con su tarea programada ─────────────────────────────── */

/** Lo que sabemos de la tarea programada de un flujo. Tres cosas distintas que
 *  antes eran el mismo `null`, y por eso decían todas lo mismo (verde). */
export type Cruce =
  | { tipo: "sin-datos" }
  | { tipo: "sin-tarea" }
  | { tipo: "tarea"; job: JobConCorrida };

/** La tarea programada de este flujo. `jobs === null` = el gateway no contestó. */
export function cruzarTarea(f: Flujo, jobs: CronJob[] | null | undefined): Cruce {
  if (!jobs) return { tipo: "sin-datos" };
  const elegida = (() => {
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
  })();
  return elegida ? { tipo: "tarea", job: elegida } : { tipo: "sin-tarea" };
}

/** Cambia cuando arranca o termina una corrida. Se compara por identidad y no
 *  por fecha a propósito: el reloj del browser puede estar corrido contra el
 *  del agente, y un `>` entre los dos husos daría falsos negativos para
 *  siempre. */
export const huellaDe = (job: JobConCorrida | null): string =>
  `${job?.latest_execution?.id ?? ""}|${job?.last_run_at ?? ""}`;

/* ── El estado, dicho como es ────────────────────────────────────────────── */

// El motor mira los crons cada 60 s (`gateway/run.py`, `_start_cron_ticker
// (interval=60)`). Una próxima corrida vencida hace menos que eso todavía no
// dice nada: es la ventana normal entre "le tocó" y "arrancó" —y es justo lo
// que se ve al segundo siguiente de tocar "Probarlo ahora", porque el motor
// adelanta `next_run_at` a AHORA para disparar—. Pasados cinco ticks sin
// arrancar, eso ya es el síntoma que el cliente necesita ver nombrado.
const GRACIA_MS = 5 * 60_000;

const CUERPO_REINTENTA = "Lo que ya te dejó hecho no se pierde, y vuelve a intentarlo en la próxima corrida.";
const CUERPO_SOLO = "Lo que ya te dejó hecho no se pierde.";

export type OpcionesEstado = {
  /** Para poder probar el atraso sin esperar. */
  ahora?: number;
  /** El portal disparó una corrida y el motor todavía no la tomó. */
  enVuelo?: boolean;
};

/** El estado de un flujo, dicho como es. Función pura: todo lo que necesita
 *  entra por parámetro (incluido "ahora"), así se puede probar sin pantalla. */
export function estadoReal(f: Flujo, cruce: Cruce, opts: OpcionesEstado = {}): EstadoReal {
  const ahora = opts.ahora ?? Date.now();
  const job = cruce.tipo === "tarea" ? cruce.job : null;
  const ejec = job?.latest_execution ?? null;
  const sinConfirmar = cruce.tipo === "sin-datos";
  const faltan = f.estado === "incompleto" ? f.conexiones_faltan ?? [] : [];

  const jobId = job?.id ?? null;
  const pausado = Boolean(job && (job.enabled === false || job.state === "paused"))
    || (!job && f.estado === "pausado");

  // ¿Corriendo? Solo si el motor lo dice (una ejecución tomada y sin terminar)
  // o si el propio portal acaba de dispararla y el motor todavía no la anotó.
  // El cartel "Trabajando ahora" colgaba de `job.state === "running"`, un valor
  // que el motor no escribe nunca: era código muerto.
  //
  // LAS DOS COSAS SE GUARDAN SEPARADAS. `ejecEnVuelo` es "el motor tiene ESTA
  // corrida tomada"; `opts.enVuelo` es "el portal la disparó y el motor todavía
  // no la tomó", y en ese rato `ejec` sigue siendo la corrida ANTERIOR. Mezclar
  // las dos es lo que hacía que la tarjeta le pusiera a la corrida nueva la
  // hora de la vieja.
  const ejecEnVuelo = Boolean(
    ejec && EN_VUELO.has((ejec.status ?? "").trim().toLowerCase()) && !ejec.finished_at,
  );
  const corriendo = Boolean(opts.enVuelo || ejecEnVuelo);

  // De las tres fuentes gana la MÁS FRESCA. La ejecución es la que primero se
  // entera —y en el camino del `unknown` es la única que se entera, porque ahí
  // el motor no llama a `mark_job_run` y `last_status` queda con el "ok" de la
  // corrida anterior—.
  const tEjec = ms(ejec?.finished_at) || ms(ejec?.claimed_at);
  const tJob = ms(job?.last_run_at);
  const tAdapter = ms(f.ultima_corrida?.cuando);
  let cuandoISO = "";
  let resultado: Resultado = null;
  let crudo = "";
  if (tEjec && tEjec >= tJob && tEjec >= tAdapter) {
    cuandoISO = ejec?.finished_at || ejec?.claimed_at || "";
    resultado = ejec?.finished_at ? leerStatus(ejec?.status) : null;
    crudo = ejec?.error ?? "";
  } else if (tJob && tJob >= tAdapter) {
    cuandoISO = job?.last_run_at ?? "";
    resultado = leerStatus(job?.last_status) ?? "dudoso";
    crudo = job?.last_error ?? "";
  } else if (tAdapter || f.ultima_corrida?.status) {
    cuandoISO = f.ultima_corrida?.cuando ?? "";
    resultado = leerStatus(f.ultima_corrida?.status) ?? "dudoso";
  }
  const cuando = cuandoPaso(cuandoISO);

  const proximaMs = ms(job?.next_run_at);
  const atrasoMs = proximaMs ? ahora - proximaMs : 0;
  const atrasado = !pausado && !corriendo && atrasoMs > GRACIA_MS;
  const proxima = pausado || !proximaMs || atrasado
    ? ""
    : atrasoMs > 0
      ? "Le toca ahora: arranca en cualquier momento."
      : `Próxima vez: ${cuandoVa(job?.next_run_at)}`;

  // "Probarlo ahora" solo se ofrece como salida cuando existe de verdad.
  const reintentable = Boolean(jobId) && !corriendo;

  const base = {
    proxima, faltan, jobId, pausado, corriendo, sinConfirmar,
    huella: huellaDe(job),
  };

  const notaFalla = (): Nota => {
    const l = leerFalla(crudo);
    return {
      tono: "coral",
      que: l.que,
      detalle: jobId && !pausado ? CUERPO_REINTENTA : CUERPO_SOLO,
      // ANTES ACÁ SE MANDABA A ESPERAR. Para `no llm provider` la pantalla
      // decía "esto no lo destrabás vos: es de nuestro lado" y ofrecía solo
      // "Avisanos" — y el dato del laboratorio es que "Probarlo ahora" arregló
      // esa misma corrida: la falla era pasajera. El reintento va primero;
      // escribirnos queda para cuando se repite.
      reintento: reintentable,
      reprogramar: false,
      avisanos: l.nuestro,
      hace: l.hace,
      crudo: l.crudo,
    };
  };

  const notaDuda = (): Nota => ({
    tono: "amber",
    que: "La corrida se cortó por el medio y tu agente no llegó a anotar cómo salió.",
    detalle:
      "No sé si alcanzó a hacer el trabajo o si quedó a mitad de camino. "
      + "Fijate en Resultados si dejó algo de esa fecha; si no dejó nada, corrélo de nuevo.",
    reintento: reintentable,
    reprogramar: false,
    avisanos: !reintentable,
    hace: "",
    crudo,
  });

  // Sin poder cruzar con el motor no se puede afirmar NADA en verde: ni
  // "Activo", ni "Próxima vez", ni que esté andando. Con el gateway caído un
  // flujo pausado se veía "Activo" y los botones simplemente desaparecían, sin
  // una palabra de que la pantalla estaba corriendo con datos parciales.
  if (sinConfirmar) {
    if (resultado === "mal") {
      return { ...base, clave: "fallo", tono: "coral", cartel: "La última vez falló",
        ultima: `Corrió ${cuando} y no pudo terminar`, nota: notaFalla() };
    }
    return {
      ...base, clave: "sin-confirmar", tono: "neutral", cartel: "Sin confirmar",
      ultima: cuando ? `Última vez que sé que corrió: ${cuando}` : "",
      nota: null,
    };
  }

  if (pausado) {
    // Pausado NO borra lo que pasó: si la última falló, sigue diciéndolo. Un
    // flujo pausado sobre una corrida rota es justo el que hay que mirar antes
    // de reanudarlo.
    return {
      ...base, clave: "pausado", tono: "neutral", cartel: "En pausa",
      // Y TAMPOCO BORRA EL RESULTADO CUANDO SALIÓ BIEN. Activo decía «Última
      // vez: hoy a las 13:06 — salió bien» y el mismo flujo, pausado, decía
      // sólo «Última vez: hoy a las 13:06». Pausar es justo lo que hace el
      // cliente para ir a mirar cómo había salido: era el dato que le sacábamos.
      ultima: !cuando ? ""
        : resultado === "mal" ? `Última vez: ${cuando} — no pudo terminar`
        : resultado === "dudoso" ? `Última vez: ${cuando} — quedó sin confirmar`
        : resultado === "bien" ? `Última vez: ${cuando} — salió bien`
        : `Última vez: ${cuando}`,
      nota: resultado === "mal" ? notaFalla() : resultado === "dudoso" ? notaDuda() : null,
    };
  }

  if (corriendo) {
    // LA HORA DE ARRANQUE SOLO SE AFIRMA SI EL MOTOR TOMÓ ESTA CORRIDA. Mientras
    // no la tomó, `ejec` es la ANTERIOR: leerle `started_at` era ponerle a la
    // corrida nueva la hora de la vieja. Medido: se tocó "Probarlo ahora" a las
    // 13:10 y la tarjeta dijo «Arrancó hoy a las 12:39 y sigue trabajando»,
    // media hora antes. El fallback tampoco alcanzaba: sólo aparecía cuando no
    // había NINGUNA ejecución previa, que es justo el caso raro.
    //
    // Sin arranque confirmado no se afirma ni la hora ni que ya esté
    // trabajando: el cartel dice lo único que se sabe. El "lo mandé a correr"
    // ya lo dice el vuelo, abajo en los botones; acá no se repite.
    if (!ejecEnVuelo) {
      return {
        ...base, clave: "corriendo", tono: "violet", cartel: "Arrancando",
        ultima: "Arranca en cualquier momento.", nota: null,
      };
    }
    const arranco = cuandoPaso(ejec?.started_at || ejec?.claimed_at);
    return {
      ...base, clave: "corriendo", tono: "violet", cartel: "Trabajando ahora",
      ultima: arranco ? `Arrancó ${arranco} y sigue trabajando` : "Está trabajando ahora",
      nota: null,
    };
  }

  // Un flujo que dice "todos los lunes a las 8:30" y no tiene ninguna tarea
  // detrás no es un flujo activo: es un trabajo que hoy no lo hace nadie. Se
  // verificó forzando el caso — cartel verde, la cadencia intacta y ni una
  // palabra de que esa tarea automática ya no existía.
  if (cruce.tipo === "sin-tarea" && f.gatillo_tipo === "horario") {
    return {
      ...base, clave: "sin-tarea", tono: "amber", cartel: "No está programado",
      ultima: cuando ? `Última vez que corrió: ${cuando}` : "",
      nota: {
        tono: "amber",
        que: "No hay ninguna tarea programada que lo dispare.",
        detalle: f.gatillo
          ? `Acá dice que corre así: «${f.gatillo}». Eso hoy no está agendado en tu agente, `
            + "así que no va a correr solo hasta que se vuelva a programar."
          : "Hoy no está agendado en tu agente, así que no va a correr solo.",
        reintento: false, reprogramar: true, avisanos: true, hace: "", crudo: "",
      },
    };
  }

  if (atrasado) {
    return {
      ...base, clave: "atrasado", tono: "amber", cartel: "No arrancó cuando le tocaba",
      ultima: cuando ? `Última vez que corrió: ${cuando}` : "",
      nota: {
        tono: "amber",
        que: `Tenía que haber corrido ${cuandoPaso(job?.next_run_at)} y todavía no arrancó.`,
        detalle: "El horario pasó y la corrida no salió. Mientras tanto, ese trabajo no se está haciendo.",
        reintento: reintentable, reprogramar: false, avisanos: true, hace: "", crudo: "",
      },
    };
  }

  if (resultado === "mal") {
    return {
      ...base, clave: "fallo", tono: "coral", cartel: "La última vez falló",
      ultima: `Corrió ${cuando} y no pudo terminar`, nota: notaFalla(),
    };
  }

  if (resultado === "dudoso") {
    return {
      ...base, clave: "dudoso", tono: "amber", cartel: "Quedó sin confirmar",
      ultima: `Última vez: ${cuando} — no quedó claro si terminó`, nota: notaDuda(),
    };
  }

  // Le falta una conexión: recién ACÁ, cuando no hay una corrida rota ni una
  // duda que contar. Antes iba primero y tapaba el motivo real.
  if (faltan.length > 0) {
    return {
      ...base, clave: "incompleto", tono: "amber", cartel: "Le falta una conexión",
      ultima: cuando ? `Última vez que corrió: ${cuando}` : "", nota: null,
    };
  }

  if (resultado === "bien") {
    return {
      ...base, clave: "bien", tono: "green", cartel: "Activo",
      ultima: `Última vez: ${cuando} — salió bien`, nota: null,
    };
  }

  // Nunca corrió. Con horario eso es un dato (está programado y todavía no le
  // tocó); sin horario —"cuando me lo pidas"— no hay nada que informar.
  if (f.gatillo_tipo === "horario") {
    return { ...base, clave: "sin-correr", tono: "neutral", cartel: "Todavía no corrió", ultima: "", nota: null };
  }
  return { ...base, clave: "sin-correr", tono: "green", cartel: "Activo", ultima: "", nota: null };
}

// EL ORDEN TAMBIÉN DICE ALGO. El adapter ordena por estado guardado, que no
// sabe nada de corridas: los dos flujos rotos de la veterinaria quedaban abajo
// de los sanos. Lo que le pide algo al cliente va arriba.
const PESO: Record<ClaveEstado, number> = {
  fallo: 0, atrasado: 1, "sin-tarea": 2, dudoso: 3, incompleto: 4,
  corriendo: 5, bien: 6, "sin-correr": 7, "sin-confirmar": 8, pausado: 9,
};

export const ordenarPorUrgencia = <T extends { estado: EstadoReal; flujo: Flujo }>(xs: T[]): T[] =>
  xs.slice().sort((a, b) =>
    PESO[a.estado.clave] - PESO[b.estado.clave] ||
    a.flujo.nombre.localeCompare(b.flujo.nombre, "es"));

/* ── La franja de arriba: cuántos hay DE CADA COSA ───────────────────────── */

// LA MENTIRA SOBREVIVIÓ ACÁ, en la primera línea que se lee. Cada tarjeta ya
// decía la verdad y el resumen seguía metiendo `fallo`, `atrasado` y
// `sin-tarea` en el mismo balde, redactado como "N no pudieron terminar la
// última vez". Medido con un flujo fallado y otro atrasado, la franja decía
//
//   «Tus 2 trabajos automáticos necesitan que los mires: 2 no pudieron
//    terminar la última vez»
//
// mientras la tarjeta de al lado decía "Última vez que corrió: hoy a las 13:06"
// y "No arrancó cuando le tocaba". La misma pantalla contra sí misma. Lo mismo
// con un flujo sin cron cuya última corrida salió bien.
//
// Son TRES cosas distintas y el cliente hace tres cosas distintas con cada una:
// falló al correr / no arrancó cuando le tocaba / ya no está programado. Cada
// una se cuenta y se nombra por separado, CON LAS MISMAS PALABRAS DEL CARTEL de
// la tarjeta, así el número del resumen se verifica contando carteles abajo.
//
// El orden es el de `PESO`, o sea el mismo en que quedan las tarjetas: se lee
// la franja de izquierda a derecha y se baja encontrándolas en ese orden.
//
// `pausado` NO se cuenta a propósito: la pausa la accionó el cliente y la
// tarjeta ya cuenta cómo salió la última corrida. Meterlo acá sería pedirle que
// mire algo que él mismo decidió frenar.
const PROBLEMAS: { clave: ClaveEstado; uno: string; varios: string }[] = [
  { clave: "fallo", uno: "no pudo terminar la última vez", varios: "no pudieron terminar la última vez" },
  { clave: "atrasado", uno: "no arrancó cuando le tocaba", varios: "no arrancaron cuando les tocaba" },
  { clave: "sin-tarea", uno: "ya no está programado", varios: "ya no están programados" },
  { clave: "dudoso", uno: "quedó sin confirmar", varios: "quedaron sin confirmar" },
  { clave: "incompleto", uno: "necesita una conexión", varios: "necesitan una conexión" },
];

const enumerar = (xs: string[]): string =>
  xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`;

/** Qué decir arriba de todo. `""` = no hay nada que decir y la pantalla se
 *  calla, que es la respuesta a "¿me puedo olvidar del tema?".
 *
 *  Vive acá y no en la página porque es la misma cuenta que hace `estadoReal`,
 *  y porque siendo pura se puede probar contra una lista de flujos donde
 *  convivan los tres casos. */
export function resumirFlujos(estados: EstadoReal[]): string {
  const cuentas = PROBLEMAS
    .map((p) => ({ ...p, n: estados.filter((e) => e.clave === p.clave).length }))
    .filter((p) => p.n > 0);
  const conProblema = cuentas.reduce((s, p) => s + p.n, 0);
  if (conProblema === 0) return "";

  const total = estados.length;
  const sujeto =
    total === 1 ? "Tu trabajo automático"
      : conProblema === total ? `Tus ${total} trabajos automáticos`
        : `${conProblema} de tus ${total} trabajos automáticos`;
  const plural = conProblema > 1;
  // Con un solo tipo de problema el número ya lo dijo el sujeto y repetirlo
  // ("1 de tus 3 trabajos… : 1 no pudo terminar") es ruido. Con dos o más, el
  // número de cada uno es justo el dato que faltaba.
  const detalle = enumerar(cuentas.map(({ n, uno, varios }) =>
    (cuentas.length === 1 ? "" : `${n} `) + (n === 1 ? uno : varios)));

  return `${sujeto} ${plural ? "necesitan" : "necesita"} que ${plural ? "los" : "lo"} mires: `
    + `${detalle}. ${plural ? "Abajo dice qué pasó en cada uno." : "Abajo dice qué pasó."}`;
}

/* ── Correr una vez sin desarmar la pausa ────────────────────────────────── */

// EL BOTÓN DE AL LADO LE DESARMABA LA VÁLVULA DE SEGURIDAD. `POST
// /api/jobs/{id}/run` no significa "corré esto una vez": el motor lo implementa
// como `enabled:true, state:scheduled, paused_at:null, next_run_at:ahora`
// (`cron/jobs.py::trigger_job`), o sea que DESPAUSA el flujo y lo deja
// despausado, en silencio. La pausa es lo único que el cliente accionó a
// propósito. Se respeta: se corre una vez y se vuelve a pausar.
//
// EL ORDEN NO ES NEGOCIABLE. No se puede pausar antes ni enseguida: el ticker
// mira los crons cada 60 s (`gateway/run.py::_start_cron_ticker(interval=60)`)
// y saltea los que están pausados, así que un re-pausado inmediato se comería
// la corrida sin decir nada. Sí se puede pausar apenas la corrida arrancó: el
// tick llama a `create_execution` ANTES de mandarla al pool, `_fire_job_body`
// trabaja sobre una copia del job y no vuelve a mirar `enabled`, y al terminar
// `mark_job_run` respeta `state == "paused"` (todo en `cron/`). Por eso el
// guardián espera a que cambie la huella —una ejecución nueva— y recién ahí
// pausa: la ventana despausada dura lo que tarda un tick, no lo que tarda la
// corrida.
//
// Y VIVE FUERA DE REACT, en el módulo y no en un efecto, porque el re-pausado
// no puede depender de que la tarjeta siga montada: el cliente toca el botón y
// se va a otra pestaña. Además queda anotado en localStorage, así un F5 en el
// medio lo retoma.

/** Cada cuánto se le pregunta al motor si ya tomó la corrida. */
const ESPERA_MS = 4_000;
/** Seis ticks del motor. Si en ese rato no arrancó, no va a arrancar. */
const LIMITE_MS = 6 * 60_000;
/** Más viejo que esto es de otra sesión: la corrida ya terminó hace rato. */
const VIEJO_MS = 60 * 60_000;
const LLAVE = "tuagente_flujos_repausar";
/** Cuánto queda el mensaje final a la vista antes de limpiarse. */
const AVISO_MS = 14_000;

export type FaseVuelo = "disparando" | "corriendo" | "repausando" | "listo" | "error";

export type Vuelo = {
  jobId: string;
  fase: FaseVuelo;
  /** El flujo estaba en pausa: hay que devolvérsela cuando arranque. */
  repausar: boolean;
  mensaje: string;
  ok: boolean;
};

const vuelos = new Map<string, Vuelo>();
const oyentes = new Set<() => void>();
let version = 0;

const avisar = () => { version += 1; oyentes.forEach((f) => f()); };

const suscribir = (f: () => void) => { oyentes.add(f); return () => { oyentes.delete(f); }; };

/** Re-renderiza la pantalla cuando un vuelo cambia de fase. */
export const useVuelos = (): number =>
  useSyncExternalStore(suscribir, () => version, () => 0);

export const vueloDe = (jobId: string | null): Vuelo | null =>
  jobId ? vuelos.get(jobId) ?? null : null;

/** Un vuelo está "en el aire" mientras no terminó de re-pausar. */
export const enElAire = (v: Vuelo | null): boolean =>
  Boolean(v && (v.fase === "disparando" || v.fase === "corriendo" || v.fase === "repausando"));

const dormir = (t: number) => new Promise((r) => setTimeout(r, t));
const texto = (e: unknown) => (e instanceof Error ? e.message : "error");

type Pendiente = { desde: number; huella: string };

function leerPendientes(): Record<string, Pendiente> {
  try {
    const v = JSON.parse(localStorage.getItem(LLAVE) || "{}");
    return v && typeof v === "object" ? v : {};
  } catch { return {}; }
}

function anotarPendiente(jobId: string, p: Pendiente | null) {
  try {
    const todos = leerPendientes();
    if (p) todos[jobId] = p; else delete todos[jobId];
    localStorage.setItem(LLAVE, JSON.stringify(todos));
  } catch { /* sin localStorage el guardián sigue andando en memoria */ }
}

/** Espera a que el motor tome la corrida. `true` si arrancó.
 *
 *  Mira ANTES de dormir a propósito: al retomar un re-pausado viejo, la
 *  corrida ya pasó y la huella ya cambió — sin esa primera lectura el guardián
 *  reportaría "no llegó a arrancar" sobre algo que corrió hace una hora. */
async function esperarArranque(
  cfg: PortalConfig, jobId: string, huella: string, hasta: number,
): Promise<boolean> {
  for (;;) {
    let jobs: CronJob[] | null = null;
    try { jobs = (await getJobs(cfg))?.jobs ?? []; } catch { /* reintenta */ }
    if (jobs) {
      const j = (jobs as JobConCorrida[]).find((x) => x.id === jobId);
      if (!j) return false; // la tarea ya no existe: no hay nada que pausar
      if (huellaDe(j) !== huella) return true;
    }
    if (Date.now() >= hasta) return false;
    await dormir(ESPERA_MS);
  }
}

async function repausar(
  cfg: PortalConfig, jobId: string, huella: string, hasta: number,
  poner: (v: Partial<Vuelo>) => void, onCambio: () => void,
): Promise<void> {
  const arranco = await esperarArranque(cfg, jobId, huella, hasta);
  poner({ fase: "repausando" });
  try {
    await jobAction(cfg, jobId, "pause");
    anotarPendiente(jobId, null);
    poner({
      fase: "listo", ok: true,
      mensaje: arranco
        ? "Ya corrió esta vez y quedó de nuevo en pausa."
        : "No llegó a arrancar, así que lo dejé en pausa como estaba. Probá de nuevo más tarde.",
    });
  } catch (e) {
    // El único caso en que la pausa se pierde. Se dice, con el paso a seguir.
    poner({
      fase: "error", ok: false,
      mensaje: `Lo mandé a correr pero no pude volver a pausarlo (${texto(e)}). Pausalo vos acá al lado.`,
    });
  }
  onCambio();
}

function limpiarLuego(jobId: string) {
  setTimeout(() => {
    const v = vuelos.get(jobId);
    if (v && !enElAire(v)) { vuelos.delete(jobId); avisar(); }
  }, AVISO_MS);
}

/** "Probarlo ahora": lo corre UNA vez y, si estaba en pausa, se la devuelve. */
export async function correrUnaVez(
  cfg: PortalConfig, jobId: string, opts: { pausado: boolean; huella: string },
  onCambio: () => void,
): Promise<void> {
  if (enElAire(vuelos.get(jobId) ?? null)) return;
  const poner = (v: Partial<Vuelo>) => {
    const antes = vuelos.get(jobId);
    if (!antes) return;
    vuelos.set(jobId, { ...antes, ...v });
    avisar();
  };
  vuelos.set(jobId, {
    jobId, fase: "disparando", repausar: opts.pausado, ok: true,
    mensaje: opts.pausado ? "Lo corro una vez. Sigue en pausa." : "Lo mando a correr…",
  });
  avisar();

  const hasta = Date.now() + LIMITE_MS;
  if (opts.pausado) anotarPendiente(jobId, { desde: Date.now(), huella: opts.huella });

  try {
    await jobAction(cfg, jobId, "run");
  } catch (e) {
    anotarPendiente(jobId, null);
    poner({ fase: "error", ok: false, mensaje: `No pude (${texto(e)}). Probá de nuevo en un rato.` });
    limpiarLuego(jobId);
    return;
  }
  onCambio();

  poner({
    fase: "corriendo",
    mensaje: opts.pausado
      ? "Lo mandé a correr. Cuando arranque lo vuelvo a dejar en pausa."
      : "Lo mandé a correr ahora. Puede tardar unos minutos; el resultado aparece acá solo.",
  });

  if (opts.pausado) {
    await repausar(cfg, jobId, opts.huella, hasta, poner, onCambio);
  } else {
    // Sin pausa que devolver, el vuelo solo sostiene el cartel "Trabajando
    // ahora" hasta que el motor tome la corrida y lo diga él.
    await esperarArranque(cfg, jobId, opts.huella, hasta);
    poner({ fase: "listo", ok: true, mensaje: "Ya arrancó. El resultado aparece acá solo." });
    onCambio();
  }
  limpiarLuego(jobId);
}

/** Retoma los re-pausados que quedaron a medias (un F5 en el medio). Se llama
 *  al montar la pantalla; sin esto, un refresco entre el "run" y el "pause"
 *  dejaba el flujo despausado para siempre y sin que nadie lo dijera. */
export function retomarRepausas(cfg: PortalConfig, onCambio: () => void): void {
  const todos = leerPendientes();
  for (const [jobId, p] of Object.entries(todos)) {
    if (vuelos.has(jobId)) continue;
    const desde = Number(p?.desde) || 0;
    if (!desde) { anotarPendiente(jobId, null); continue; }
    vuelos.set(jobId, {
      jobId, fase: "repausando", repausar: true, ok: true,
      mensaje: "Estoy terminando de devolverle la pausa a este flujo.",
    });
    avisar();
    const poner = (v: Partial<Vuelo>) => {
      const antes = vuelos.get(jobId);
      if (!antes) return;
      vuelos.set(jobId, { ...antes, ...v });
      avisar();
    };
    // Muy viejo = la corrida terminó hace rato: se pausa y listo, sin esperar.
    const hasta = Date.now() - desde > VIEJO_MS ? 0 : desde + LIMITE_MS;
    void repausar(cfg, jobId, String(p?.huella ?? ""), hasta, poner, onCambio)
      .then(() => limpiarLuego(jobId));
  }
}
