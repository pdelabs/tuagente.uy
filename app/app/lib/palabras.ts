"use client";

// El diccionario del portal: motor → castellano de pyme.
//
// POR QUÉ ESTO ES UN ARCHIVO Y NO TRES TABLAS SUELTAS: un QA de experiencia
// (12/8) anotó las diecisiete frases que le hicieron sentir tonta a la gerenta
// de una distribuidora. Seis eran palabras del motor filtradas a la pantalla,
// cada una en un módulo distinto y cada módulo con su propia tablita a medio
// llenar: "Usando skill view…" en el chat, "commented" en el historial del
// ticket, "dependency_wait / spawned / promoted / heartbeat" en Actividad,
// "cli" en la pantalla de la plata. Nuestro propio SOUL le prohíbe al agente
// hablar así; el portal no puede hacerlo por él.
//
// REGLA: ningún nombre crudo del motor llega a los ojos del cliente. Lo que no
// esté acá se traduce a algo genérico pero en castellano — nunca al identificador.
// El nombre técnico puede seguir viajando en un `title=` para nosotros.

/* ── Lo que el agente está haciendo ──────────────────────────────────────── */

/** Cada herramienta en dos tiempos: mientras pasa y una vez que pasó. */
export type Accion = { curso: string; hecho: string };

const PENSAR: Accion = { curso: "Pensando", hecho: "Pensó un momento" };

// El nombre exacto gana; si no, la familia. Lo importante es el OBJETO ("un
// archivo", "el tablero"): "Leyendo" solo no dice nada, y el nombre de la
// herramienta dice demasiado y en otro idioma.
const POR_NOMBRE: Record<string, Accion> = {
  _thinking: PENSAR,
  clarify: PENSAR,
  todo: PENSAR,
  memory: { curso: "Repasando lo que hablamos", hecho: "Repasó lo que hablaron" },
  session_search: { curso: "Buscando en lo que hablaron", hecho: "Buscó en lo que hablaron" },
  read_file: { curso: "Leyendo un archivo", hecho: "Leyó un archivo" },
  search_files: { curso: "Buscando entre tus archivos", hecho: "Buscó entre tus archivos" },
  write_file: { curso: "Escribiendo un archivo", hecho: "Escribió un archivo" },
  patch: { curso: "Corrigiendo un archivo", hecho: "Corrigió un archivo" },
  skill_view: { curso: "Repasando cómo se hace", hecho: "Repasó cómo se hace" },
  skills_list: { curso: "Repasando cómo se hace", hecho: "Repasó cómo se hace" },
  image_generate: { curso: "Armando una imagen", hecho: "Armó una imagen" },
  video_generate: { curso: "Armando un video", hecho: "Armó un video" },
  vision_analyze: { curso: "Mirando una imagen", hecho: "Miró una imagen" },
  video_analyze: { curso: "Mirando un video", hecho: "Miró un video" },
  send_message: { curso: "Mandando un mensaje", hecho: "Mandó un mensaje" },
  cronjob: { curso: "Programando una tarea", hecho: "Programó una tarea" },
  delegate_task: { curso: "Repartiendo el trabajo", hecho: "Repartió el trabajo" },
};

const POR_FAMILIA: { re: RegExp; accion: Accion }[] = [
  { re: /^kanban_(show|list|get)/, accion: { curso: "Mirando el tablero", hecho: "Miró el tablero" } },
  { re: /^(kanban_|project_)/, accion: { curso: "Anotando en el tablero", hecho: "Anotó en el tablero" } },
  { re: /^(web_|browser_|x_search)/, accion: { curso: "Buscando en internet", hecho: "Buscó en internet" } },
  { re: /^(read_|search_|.*_read$|.*_get$)/, accion: { curso: "Leyendo", hecho: "Leyó lo que necesitaba" } },
  { re: /^(write_|.*_write$|.*_create$)/, accion: { curso: "Escribiendo", hecho: "Escribió lo suyo" } },
];

const TRABAJANDO: Accion = { curso: "Trabajando", hecho: "Trabajó un rato" };

/** Qué está haciendo el agente, en palabras. NUNCA el nombre de la herramienta. */
export function accionDe(tool: string | undefined | null): Accion {
  const t = (tool || "").trim().toLowerCase();
  if (!t) return PENSAR;
  const exacta = POR_NOMBRE[t];
  if (exacta) return exacta;
  for (const f of POR_FAMILIA) if (f.re.test(t)) return f.accion;
  return TRABAJANDO;
}

/** El resumen del rastro cuando el agente ya contestó. */
export function resumenDeAcciones(tools: string[]): string {
  const utiles = tools.filter((t) => t && t !== "_thinking");
  if (utiles.length === 0) return PENSAR.hecho;
  if (utiles.length === 1) return accionDe(utiles[0]).hecho;
  return `Hizo ${utiles.length} cosas antes de responder`;
}

/* ── Lo que le pasó a una tarea ──────────────────────────────────────────── */

/** Eventos que son maquinaria pura: no le dicen NADA al cliente y en fila
 *  parecen un cuelgue. El QA vio doce renglones seguidos de estos en Actividad
 *  y la conclusión fue "se colgó, y encima no entiendo nada". Se esconden
 *  detrás de un interruptor, igual que las cosas técnicas en Archivos.
 *
 *  QUÉ NO ENTRA ACÁ, y es la parte que importa: `block_loop_detected` y
 *  `decomposed`. Los dos SUENAN a maquinaria y los dos significan "tu pedido se
 *  rompió". El primero es el motor diciendo que la tarea se frenó dos veces por
 *  lo mismo; el segundo es el auto-decomposer partiéndola en pedazos —y cuando
 *  parte, parte con el CUERPO VIEJO, así que el cliente termina con una tarea
 *  que pide 8 de algo que él ya corrigió a 20. Esconder justo esos dos detrás
 *  del interruptor es esconder la única señal de que hay que intervenir. El
 *  interruptor está para el ruido (latidos, arranques, esperas), no para las
 *  malas noticias. */
export const EVENTOS_DE_MAQUINA = new Set([
  "heartbeat", "spawned", "dependency_wait", "promoted", "claimed",
  "tip_scratch_workspace", "reclaim_deferred", "assigned",
]);

export const esEventoDeMaquina = (kind: string) =>
  EVENTOS_DE_MAQUINA.has((kind || "").trim().toLowerCase());

// `nombreAgente` entra por parámetro: el cliente le puso un nombre y el portal
// lo usa en vez de "el agente" donde se pueda.
const EVENTOS: Record<string, string | ((n: string) => string)> = {
  created: "Se creó",
  claimed: (n) => `${n} la agarró`,
  running: (n) => `${n} está trabajando`,
  in_progress: (n) => `${n} está trabajando`,
  comment: "Comentario",
  commented: "Comentario",
  blocked: "Frenada — espera tu respuesta",
  // NUNCA "Le diste el visto bueno", que es lo que decía. El evento lo emite
  // el `unblock` del motor y no trae autor: el portal no puede saber quién lo
  // destrabó ni por qué. Cuando rechazar todavía movía el ticket a `ready`,
  // esto le ponía "Le diste el visto bueno" en Actividad y en el historial al
  // pedido que la clienta acababa de RECHAZAR. Un rótulo que describe el hecho
  // (siguió) y no la intención (la aprobaste) no puede volver a mentir por
  // ningún camino, ni por los que todavía no existen.
  unblocked: "Se destrabó y siguió",
  completed: "Terminada",
  done: "Terminada",
  failed: "No pudo",
  error: "No pudo",
  cancelled: "Cancelada",
  canceled: "Cancelada",
  archived: "Archivada",
  skipped: "Se salteó",
  timeout: "Tardó demasiado",
  delivered: "Entregada",
  sent: "Enviada",
  status_changed: "Cambió de estado",
  scheduled: "Quedó programada",
  // El motor la sacó de la cola por trabada: aprobarla desde acá ya no anda y
  // hay que volver a pedírsela al agente. Se dice, no se esconde.
  triage: "Quedó trabada — hay que volver a pedirla",
  // MALAS NOTICIAS, no maquinaria: van a la vista siempre (ver
  // EVENTOS_DE_MAQUINA). Redactadas para que se entiendan solas, sin el resto
  // del historial al lado.
  decomposed: "Se partió sola en tareas más chicas — revisá que digan lo que pediste",
  block_loop_detected: "Se frenó dos veces por lo mismo y quedó trabada",
  // Maquinaria: se muestran solo si el cliente pide ver el detalle técnico,
  // pero igual en castellano.
  heartbeat: "Sigue trabajando",
  spawned: "Arrancó el trabajo",
  dependency_wait: "Esperando otra tarea",
  promoted: "Pasó al frente de la cola",
  assigned: (n) => `Quedó a cargo de ${n}`,
  reclaim_deferred: "Reintento postergado",
  tip_scratch_workspace: "Nota interna del sistema",
};

/** Qué le pasó a la tarea, en palabras. Lo desconocido se humaniza (guiones
 *  fuera, primera en mayúscula) antes que mostrarse tal cual: un `foo_bar`
 *  nuevo del motor no puede aparecer así en la pantalla del cliente. */
export function rotuloEvento(kind: string, nombreAgente = "Tu agente"): string {
  const k = (kind || "").trim().toLowerCase();
  const v = EVENTOS[k];
  if (typeof v === "function") return v(nombreAgente);
  if (v) return v;
  if (!k) return "Novedad";
  const limpio = k.replace(/[_-]+/g, " ").trim();
  return limpio.charAt(0).toUpperCase() + limpio.slice(1);
}

/* ── En qué anda una tarea ───────────────────────────────────────────────── */

/** Los tonos del kit de UI. Van con la palabra: el color también informa. */
export type Tono = "violet" | "amber" | "green" | "coral" | "neutral";

// EL CHIP DECÍA `done`. En inglés, crudo, en el modal que abre una fila de
// Actividad — literalmente lo que la clienta que probó el portal a ciegas anotó
// en su informe. Y no alcanzaba con traducirlo: la MISMA tarea, en el Tablero,
// ya se llamaba "Completado". Las palabras son las del Tablero, que es donde la
// tarea vive, y el reparto es el mismo que el de sus columnas (`columnOf`):
// blocked y done tienen la suya, ready es la cola, y cualquier estado nuevo cae
// en "En curso" antes que esconderse o salir en inglés.
const ESTADOS_TAREA: Record<string, { label: string; tono: Tono }> = {
  ready: { label: "Por hacer", tono: "neutral" },
  blocked: { label: "Esperando aprobación", tono: "violet" },
  done: { label: "Completado", tono: "green" },
  // Archivada no está en ninguna columna —sale del tablero— pero su link sigue
  // abriendo el detalle, y ahí "En curso" sería mentira.
  archived: { label: "Archivada", tono: "neutral" },
};

const EN_CURSO = { label: "En curso", tono: "amber" as const };

/** En qué anda una tarea, con las palabras del Tablero. */
export function estadoDeTarea(status: string | null | undefined): { label: string; tono: Tono } {
  const s = (status || "").trim().toLowerCase();
  return ESTADOS_TAREA[s] ?? EN_CURSO;
}

/** Cómo está una tarea PROGRAMADA (un cron), en un solo cartel.
 *
 *  "ACTIVA" EN VERDE NO ES LA VERDAD SI LA ÚLTIMA FALLÓ. Es el peor bug que
 *  encontró el QA a ciegas —la veterinaria tenía dos trabajos con el cartel
 *  verde y los dos habían fallado—, y en /app/tareas seguía vivo con las dos
 *  mitades pegadas: el chip verde "Activa" al lado del chip coral "falló",
 *  sobre la misma tarea, contando cada uno una cosa distinta. Mismo criterio
 *  que el cartel de un flujo (`flujos/corridas.ts`): corriendo → pausada →
 *  falló → activa. */
export function estadoDeProgramada(
  { corriendo, pausada, fallo }: { corriendo: boolean; pausada: boolean; fallo: boolean },
): { label: string; tono: Tono; cuentaLaFalla: boolean } {
  // `cuentaLaFalla` es lo que evita las dos mitades: cuando el cartel YA dice
  // que falló, la pantalla no repite el chip coral al lado; cuando dice otra
  // cosa (pausada, corriendo), la falla se sigue mostrando aparte y no se
  // pierde.
  if (corriendo) return { label: "Corriendo", tono: "violet", cuentaLaFalla: false };
  // Pausada gana sobre la falla: es lo primero que explica por qué no está
  // corriendo. Que la última haya fallado se sigue diciendo al lado.
  if (pausada) return { label: "Pausada", tono: "amber", cuentaLaFalla: false };
  if (fallo) return { label: "La última vez falló", tono: "coral", cuentaLaFalla: true };
  return { label: "Activa", tono: "green", cuentaLaFalla: false };
}

/* ── Qué produjo el agente ───────────────────────────────────────────────── */

// Tres pantallas tenían su propia tablita de esto y no decían lo mismo: un
// artefacto `other` era "Otro" en Artefactos, "Artefacto" en el modal y salía
// crudo —"other"— en Inicio.
const ARTEFACTOS: Record<string, { label: string; tono: Tono }> = {
  chart: { label: "Gráfico", tono: "violet" },
  table: { label: "Tabla", tono: "green" },
  report: { label: "Informe", tono: "amber" },
  dashboard: { label: "Panel", tono: "coral" },
  diagram: { label: "Diagrama", tono: "violet" },
  other: { label: "Otro", tono: "neutral" },
};

/** Qué clase de entrega es, en una palabra. Una clase nueva del agente no se
 *  esconde: se muestra humanizada, igual que un evento desconocido. */
export function rotuloArtefacto(kind: string | null | undefined): { label: string; tono: Tono } {
  const k = (kind || "").trim().toLowerCase();
  if (ARTEFACTOS[k]) return ARTEFACTOS[k];
  const limpio = k.replace(/[_-]+/g, " ").trim();
  return { label: limpio ? limpio.charAt(0).toUpperCase() + limpio.slice(1) : "Entrega", tono: "neutral" };
}

/* ── Por qué no pudo ─────────────────────────────────────────────────────── */

/** Una falla contada de forma que el cliente sepa qué pasó y qué hacer.
 *  `crudo` viaja siempre: no se esconde, se pliega. */
export type Falla = {
  /** Qué pasó, en una línea, sin nombres de máquina. */
  que: string;
  /** Qué puede hacer ÉL. Vacío = no hay nada que pueda hacer, lo miramos nosotros. */
  hace: string;
  /** true cuando la pelota es nuestra: la pantalla ofrece escribirnos. */
  nuestro: boolean;
  /** El texto del motor, tal cual vino, para el que quiera abrirlo. */
  crudo: string;
};

// EL MOTOR ESCRIBE EN INGLÉS Y PARA UN OPERADOR: la corrida de los lunes de una
// veterinaria falló con «RuntimeError: No LLM provider configured. Run `hermes
// model` to select a provider». Eso en la pantalla de una veterinaria no es
// información, es un susto — y encima le pide correr un comando que no puede
// correr. Pero borrarlo es peor: la clienta descubrió la falla en Actividad y
// la frase que la salvó fue la del agente diciéndole la verdad. Regla: se
// traduce lo conocido, se dice honestamente lo desconocido, y el crudo queda a
// un click.
//
// `hace` vacío = no hay nada que el cliente pueda hacer. Inventarle un paso
// ("revisá tu conexión") cuando el problema es nuestro le hace perder la tarde.
const FALLAS: { re: RegExp; que: string; hace: string; nuestro: boolean }[] = [
  {
    re: /no llm provider|no model configured|hermes setup|provider not configured/i,
    que: "Tu agente se quedó sin el motor que usa para pensar, así que la corrida ni arrancó.",
    hace: "",
    nuestro: true,
  },
  {
    re: /rate.?limit|429|quota exceeded|insufficient.?(credit|quota|funds)|payment required|402/i,
    que: "El servicio de IA cortó a tu agente por consumo: no lo dejó trabajar esta vez.",
    hace: "",
    nuestro: true,
  },
  {
    re: /401|403|unauthorized|forbidden|invalid.?(api.?)?key|authentication|credential|token expired|invalid_grant/i,
    que: "Una clave de las que usa tu agente dejó de servir, y sin eso no pudo entrar a buscar los datos.",
    hace: "Fijate en Conexiones si alguna quedó desconectada: reconectarla lo destraba.",
    nuestro: true,
  },
  {
    re: /timeout|timed out|deadline exceeded|took too long/i,
    que: "Se hizo muy largo y se cortó por tiempo antes de terminar.",
    hace: "Con «Probarlo ahora» ves si fue algo de ese momento o si se repite.",
    nuestro: false,
  },
  {
    re: /name or service not known|connection refused|network is unreachable|dns|econnrefused|temporary failure in name resolution|urlopen error/i,
    que: "No pudo llegar a un servicio de afuera: estaba caído o sin red en ese momento.",
    hace: "Con «Probarlo ahora» ves si ya volvió.",
    nuestro: false,
  },
  {
    re: /no such file|file not found|filenotfound|directory.*not exist|is a directory/i,
    que: "Le faltó un archivo que esperaba encontrar y no siguió para no inventar nada.",
    hace: "Si es un archivo que subís vos, subilo y probalo de nuevo.",
    nuestro: false,
  },
  {
    re: /permission denied|read-only file system|eacces/i,
    que: "Quiso hacer algo que no tiene permitido y se frenó ahí.",
    hace: "",
    nuestro: true,
  },
  {
    re: /disk|no space left|quota.*disk/i,
    que: "Se quedó sin lugar para guardar y no pudo terminar.",
    hace: "",
    nuestro: true,
  },
];

const FALLA_GENERICA = {
  que: "La corrida se cortó antes de terminar y no dejó resultado.",
  hace: "",
  nuestro: true,
};

/** Por qué no pudo, en criollo. Vale para el `last_error` de una tarea
 *  programada y para el error de una corrida. */
export function leerFalla(crudo: string | null | undefined): Falla {
  const texto = (crudo ?? "").trim();
  const m = FALLAS.find((f) => f.re.test(texto));
  const base = m ?? FALLA_GENERICA;
  return { que: base.que, hace: base.hace, nuestro: base.nuestro, crudo: texto };
}

/* ── Cuándo: el reloj del negocio, no el del que mira ────────────────────── */

// EL MISMO RENGLÓN DECÍA DOS HORAS DISTINTAS. En /app/tareas: «Los lunes a las
// 09:00» y, tres centímetros a la derecha, «Próxima lun 17 ago a las 06:00».
// Las dos son la misma corrida. La cadencia sale del cron, que está escrito en
// la hora del agente; la próxima salía de `next_run_at` —que viene con su huso,
// "2026-08-17T09:00:00-03:00"— formateado con el reloj de quien mira la
// pantalla. Con un browser en México eso son tres horas de diferencia y el
// cliente no tiene forma de saber cuál de las dos es la buena.
//
// La respuesta correcta es UNA: la hora que el cliente eligió. Él dijo "los
// lunes a las nueve" y su agente vive en su ciudad. Que el portal se abra desde
// otro huso —un viaje, un contador que mira desde afuera— no puede mover el
// horario de su empresa. Así que toda fecha del motor se muestra en el huso con
// el que vino, no en el del navegador.

/** Un instante del motor, ya pasado al reloj del negocio. */
export type Momento = {
  /** El instante real (epoch ms). Para ordenar y comparar. */
  ms: number;
  /** "08:30" — hora de pared donde vive el agente. */
  hora: string;
  /** "lunes" */
  diaSemana: string;
  /** "17/08" */
  diaMes: string;
  /** "17 ago" */
  fecha: string;
  /** "lun 17 ago" */
  fechaCorta: string;
  /** El año de allá. Sirve para escribirlo sólo cuando no es el corriente. */
  anio: number;
  /** Días de calendario contra hoy, contados allá: 0 hoy, -1 ayer, 1 mañana. */
  dias: number;
};

// "…-03:00", "…+0000" o "…Z". Sin sufijo devolvemos null y caemos al reloj
// local, que es lo único que se puede suponer de una fecha sin huso.
const OFFSET_RE = /(?:(Z)|([+-])(\d{2}):?(\d{2}))$/;

function offsetDe(iso: string): number | null {
  const m = OFFSET_RE.exec(iso);
  if (!m) return null;
  if (m[1]) return 0;
  const min = Number(m[3]) * 60 + Number(m[4]);
  return m[2] === "-" ? -min : min;
}

/** El huso con el que vino una fecha del motor, en minutos. null si no trae.
 *  Sirve para saber en qué reloj vive el agente y aplicárselo a los datos que
 *  llegan SIN huso (los `mtime` de los archivos son segundos pelados). */
export const husoDe = (iso: string | null | undefined): number | null =>
  iso ? offsetDe(iso.trim()) : null;

/** Un instante (epoch ms) escrito en ISO con el huso que se le indique, para
 *  que después `momento()` lo muestre en el reloj del negocio. */
export function isoConHuso(ms: number, off: number): string {
  const d = new Date(ms + off * 60_000);
  const signo = off < 0 ? "-" : "+";
  const abs = Math.abs(off);
  const dos = (n: number) => String(n).padStart(2, "0");
  return d.toISOString().replace(/\.\d+Z$/, "")
    + `${signo}${dos(Math.floor(abs / 60))}:${dos(abs % 60)}`;
}

// Se formatea en UTC a propósito: al instante se le suma el huso del agente,
// así que la hora "UTC" del resultado ES su hora de pared. Es la única forma de
// pintar un huso ajeno sin pedirle a Intl un timeZone que no conocemos (el
// motor manda el offset, no el nombre de la zona).
const enUTC = (o: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("es-UY", { ...o, timeZone: "UTC" });
const F_HORA = enUTC({ hour: "2-digit", minute: "2-digit", hour12: false });
const F_DIA_SEMANA = enUTC({ weekday: "long" });
const F_DIA_MES = enUTC({ day: "2-digit", month: "2-digit" });
const F_FECHA = enUTC({ day: "numeric", month: "short" });
const F_CORTA = enUTC({ weekday: "short", day: "numeric", month: "short" });

export function momento(iso: string | null | undefined): Momento | null {
  const texto = (iso ?? "").trim();
  if (!texto) return null;
  const real = new Date(texto);
  const ms = real.getTime();
  if (Number.isNaN(ms)) return null;
  const off = offsetDe(texto) ?? -real.getTimezoneOffset();
  const d = new Date(ms + off * 60_000);
  // "Hoy" también es el de allá: si en la veterinaria son las 23:40 del lunes y
  // acá ya es martes, la corrida de recién tiene que decir "hoy", no "ayer".
  const hoy = new Date(Date.now() + off * 60_000);
  const cero = (x: Date) => Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate());
  return {
    ms,
    hora: F_HORA.format(d),
    diaSemana: F_DIA_SEMANA.format(d),
    diaMes: F_DIA_MES.format(d),
    fecha: F_FECHA.format(d).replace(/[.,]/g, "").trim(),
    // es-UY devuelve "lun, 17 ago."; la coma y el punto sobran leyéndolo
    // adentro de una frase ("Próxima lun 17 ago a las 08:30").
    fechaCorta: F_CORTA.format(d).replace(/[.,]/g, "").trim(),
    anio: d.getUTCFullYear(),
    dias: Math.round((cero(d) - cero(hoy)) / 86_400_000),
  };
}

/** Cuándo pasó: "ayer a las 08:30", "el 02/08 a las 19:00". */
export function cuandoPaso(iso: string | null | undefined): string {
  const m = momento(iso);
  if (!m) return "";
  if (m.dias === 0) return `hoy a las ${m.hora}`;
  if (m.dias === -1) return `ayer a las ${m.hora}`;
  if (m.dias > -7) return `el ${m.diaSemana} a las ${m.hora}`;
  return `el ${m.diaMes} a las ${m.hora}`;
}

/** Cuándo va a pasar. LLEVA LA FECHA SIEMPRE: "el lunes 17/08 a las 08:30".
 *  Las dos clientas pidieron esto por separado y las dos lo escribieron con el
 *  día Y la fecha — "el lunes", leído un martes, no dice si es en seis días o
 *  en trece. */
export function cuandoVa(iso: string | null | undefined): string {
  const m = momento(iso);
  if (!m) return "";
  if (m.dias === 0) return `hoy a las ${m.hora}`;
  if (m.dias === 1) return `mañana a las ${m.hora}`;
  if (m.dias > 1 && m.dias < 7) return `el ${m.diaSemana} ${m.diaMes} a las ${m.hora}`;
  return `el ${m.diaMes} a las ${m.hora}`;
}

/* ── El mismo reloj en TODAS las pantallas ───────────────────────────────── */

// `momento()` alcanza mientras la fecha traiga su huso ("…-03:00"). El problema
// es todo lo demás: los `created_at` de los tickets y de los artefactos, los
// `mtime` de los archivos y las sesiones son epoch pelado. Formateando eso con
// `new Date().toLocaleString()` —o sea, con el reloj de quien mira— el MISMO
// ticket decía «11:50» en la fila de Actividad y «13 ago, 08:50» en el modal que
// abre esa misma fila: tres horas de diferencia a un click, medido con la
// máquina en -06 y el agente en -03.
//
// Así que el huso del negocio se APRENDE una vez, de cualquier fecha del motor
// que sí lo traiga (la actividad, las corridas, las tareas programadas), y queda
// guardado para las pantallas que sólo reciben epoch. Mientras no haya aprendido
// ninguno se cae al reloj del browser, que es lo único que se puede suponer —y
// es exactamente lo que hacían todas antes.
//
// QUIÉN LO APRENDE NO ES CADA PANTALLA. Lo hace `lib/agent.ts`, que es por donde
// pasan todas las respuestas del agente: cualquier fecha con huso que llegue por
// cualquier endpoint lo enseña, y el arranque del portal lo va a buscar aunque
// el cliente haya entrado por una pantalla que no trae fechas con huso. Que el
// reloj del portal dependiera de por qué pestaña entró el cliente era el bug.
//
// PENDIENTE: lo correcto sería que el manifiesto publique el huso del agente y
// no tener que deducirlo. Está anotado en `docs/PENDIENTES.md`; el portal ya
// lee el campo si aparece (ver `husoDelManifiesto` en `lib/agent.ts`).

const HUSO_KEY = "tuagente_huso";
/** undefined = todavía no lo buscamos; null = no hay ninguno aprendido. */
let husoAprendido: number | null | undefined;

function leerHusoGuardado(): number | null {
  if (typeof window === "undefined") return null;
  try {
    // OJO con el atajo: `Number(null)` es 0, o sea que "todavía no aprendí
    // ninguno" se leería como "el agente vive en UTC" y le correría la hora a
    // todo el portal. Sin guardar, null.
    const crudo = localStorage.getItem(HUSO_KEY);
    if (crudo === null || crudo.trim() === "") return null;
    const v = Number(crudo);
    return Number.isFinite(v) && Math.abs(v) <= 900 ? v : null;
  } catch {
    return null;
  }
}

/** En qué reloj vive el negocio, en minutos de offset. */
export function husoDelNegocio(): number {
  if (husoAprendido === undefined) husoAprendido = leerHusoGuardado();
  return husoAprendido ?? -new Date().getTimezoneOffset();
}

/** ¿Ya sabemos en qué reloj vive el negocio, o estamos cayendo al del browser?
 *
 *  LO PREGUNTA `lib/agent.ts` PARA NO ENTRAR A NINGUNA PANTALLA SIN SABERLO.
 *  Sólo tres pantallas llamaban a `aprenderHuso` (Inicio, Actividad y Tareas) y
 *  las otras ocho lo consumían: entrando derecho a /app/pipeline con el browser
 *  en -06 y sin nada guardado, el sello decía «Actualizado 10:51» donde un
 *  minuto después —pasando por Inicio— decía 13:52. Medido el 13/8 contra el
 *  agente del lab. */
export function hayHusoAprendido(): boolean {
  if (husoAprendido === undefined) husoAprendido = leerHusoGuardado();
  return husoAprendido !== null;
}

/** El offset de HOY de una zona IANA ("America/Montevideo" → -180).
 *
 *  Es para el día que el manifiesto publique la zona del agente en vez de que
 *  el portal la deduzca de las fechas (ver `docs/PENDIENTES.md`). El nombre de
 *  la zona es mejor dato que el offset porque sabe de horario de verano; el
 *  portal, que trabaja con offsets, se queda con el de hoy. */
export function husoDeZona(zona: string | null | undefined): number | null {
  const z = (zona ?? "").trim();
  if (!z) return null;
  try {
    // Una zona inventada tira RangeError acá mismo: no hace falta validarla
    // antes, y validarla con un `includes("/")` dejaba afuera "UTC".
    const partes = new Intl.DateTimeFormat("en-US", { timeZone: z, timeZoneName: "longOffset" })
      .formatToParts(new Date());
    const texto = partes.find((p) => p.type === "timeZoneName")?.value ?? "";
    // "GMT-03:00", "GMT+5:30" y "GMT" (que es UTC, o sea 0).
    if (/^GMT$/i.test(texto.trim())) return 0;
    const m = /GMT([+-])(\d{1,2}):?(\d{2})?/.exec(texto);
    if (!m) return null;
    const min = Number(m[2]) * 60 + Number(m[3] ?? 0);
    return m[1] === "-" ? -min : min;
  } catch {
    return null; // zona inventada: no se supone nada
  }
}

/** Aprende el huso de la primera fecha que lo traiga. Lo llaman las pantallas
 *  que piden datos con huso (Inicio, Actividad, Tareas); las demás lo usan. */
export function aprenderHuso(...fechas: (string | null | undefined)[]): number {
  for (const f of fechas) {
    const o = husoDe(f);
    if (o === null) continue;
    fijarHuso(o);
    break;
  }
  return husoDelNegocio();
}

/** El mismo dato, ya en minutos. Lo usa `lib/agent.ts`, que extrae el offset de
 *  la respuesta (o del manifiesto) y no tiene una fecha para pasar: armar un
 *  ISO de mentira sólo para que se vuelva a parsear acá era dar dos vueltas. */
export function fijarHuso(minutos: number): number {
  if (!Number.isFinite(minutos) || Math.abs(minutos) > 900) return husoDelNegocio();
  if (minutos !== husoAprendido) {
    husoAprendido = minutos;
    try { localStorage.setItem(HUSO_KEY, String(minutos)); } catch { /* modo privado */ }
  }
  return minutos;
}

/** Cualquier fecha del agente —epoch en segundos o en ms, string numérica, o
 *  ISO con o sin huso— leída en el reloj del negocio. Es la puerta única: lo
 *  que ya trae huso lo conserva (y de paso nos lo enseña). */
export function momentoDe(valor: string | number | null | undefined): Momento | null {
  if (valor === null || valor === undefined || valor === "") return null;
  if (typeof valor === "string") {
    const texto = valor.trim();
    if (texto && !/^\d+(\.\d+)?$/.test(texto)) {
      if (husoDe(texto) !== null) { aprenderHuso(texto); return momento(texto); }
      // Sin huso no hay nada que deducir del texto: se lee como instante y se
      // pinta en el reloj del negocio.
      const t = new Date(texto).getTime();
      return Number.isNaN(t) ? null : momento(isoConHuso(t, husoDelNegocio()));
    }
  }
  const n = typeof valor === "number" ? valor : Number(valor);
  if (!Number.isFinite(n) || n <= 0) return null;
  return momento(isoConHuso(n > 1e12 ? n : n * 1000, husoDelNegocio()));
}

/** "hoy" + "11:50", "ayer" + "09:12", "jue 13 ago" + "11:50". Partido en dos
 *  porque la hora se alinea aparte (tabular-nums) en varias pantallas. */
export function fechaYHora(valor: string | number | null | undefined):
{ fecha: string; hora: string } | null {
  const m = momentoDe(valor);
  if (!m) return null;
  return {
    fecha: m.dias === 0 ? "hoy" : m.dias === -1 ? "ayer" : m.fechaCorta,
    hora: m.hora,
  };
}

/** Lo mismo, en una línea: "hoy 11:50". "" si no hay fecha. */
export function fechaHora(valor: string | number | null | undefined): string {
  const p = fechaYHora(valor);
  return p ? `${p.fecha} ${p.hora}` : "";
}

/** Sólo la hora de pared del negocio: "11:50". */
export const horaDe = (valor: string | number | null | undefined): string =>
  momentoDe(valor)?.hora ?? "";

/** ¿Entra en los últimos N días CONTANDO COMO CUENTA EL NEGOCIO? (1 = hoy.)
 *
 *  El filtro "Hoy" de Actividad calculaba la medianoche con `new Date()` del
 *  browser mientras los títulos de las secciones contaban los días allá: desde
 *  México, apretar "Hoy" cortaba la lista a las 03:00 hora del agente, dejaba el
 *  contador "Con error" en 0 y hacía desaparecer la corrida que había fallado a
 *  las 02:58 — con la sección todavía titulada "HOY". El día es uno solo: el del
 *  negocio. */
export function esDeLosUltimosDias(
  valor: string | number | null | undefined, dias: number,
): boolean {
  const m = momentoDe(valor);
  if (!m) return true; // sin fecha no se esconde nada
  return m.dias > -dias;
}

/* ── Por dónde le hablaron al agente ─────────────────────────────────────── */

// Va en Uso ("cli · 28 sesiones" era la pantalla de la plata hablando en
// jerga) y en cualquier lado que muestre el origen de una sesión.
const CANALES: Record<string, string> = {
  api_server: "Portal",
  portal: "Portal",
  telegram: "Telegram",
  whatsapp: "WhatsApp",
  discord: "Discord",
  signal: "Signal",
  cron: "Tareas programadas",
  // `cli` es el dispatcher del kanban trabajando un ticket solo: para el
  // cliente eso es "el agente laburando sus tareas", no una consola.
  cli: "Tareas del tablero",
  kanban: "Tablero",
  "kanban-research": "Tablero (investigación)",
  tui: "Consola",
  api: "Portal",
};

export function rotuloCanal(source: string): string {
  const s = (source || "").trim().toLowerCase();
  if (CANALES[s]) return CANALES[s];
  if (!s) return "Otro";
  const limpio = s.replace(/[_-]+/g, " ").trim();
  return limpio.charAt(0).toUpperCase() + limpio.slice(1);
}
