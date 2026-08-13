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
