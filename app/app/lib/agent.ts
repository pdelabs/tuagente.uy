"use client";

// Único punto de red del portal. Config del magic link:
//   /app#endpoint=https://...&adapter=https://...&key=...
// Defaults locales para desarrollo contra el agente fixture.

import { fijarHuso, hayHusoAprendido, husoDe, husoDeZona } from "./palabras";

export type PortalConfig = {
  endpoint: string; // api server del agente (:8642)
  adapter: string;  // adapter sidecar (:8643)
  key: string;
};

export type Manifest = {
  agent: string;
  portal_plugin: string;
  modules: Record<string, boolean>;
  /** Conexiones que el flujo del cliente necesita y faltan (adapter ≥0.24).
   *  Alimenta el aviso del inicio y el puntito del sidebar. */
  conexiones_pendientes?: number;
  /** Pinta que el cliente le eligió, guardada en el agente (adapter 0.26+).
   *  Ausente con adapters viejos: el portal cae a lo que tenga el browser. */
  look?: Record<string, number> | null;
  /** true si el cliente ya lo bautizó desde el portal alguna vez. */
  bautizado?: boolean;
  /** Por dónde le avisa el agente: `telegram`, `correo` o `ninguno` — lo que
   *  el cliente contestó en el alta. Ausente con adapters viejos y con quien
   *  nunca llegó a contestar; `"ninguno"` es una respuesta explícita ("ahora
   *  no") y es la que hace que el portal se lo vuelva a ofrecer. */
  aviso?: string | null;
  /** Handle del bot de Telegram, sin @ (adapter 0.35+). El onboarding decía
   *  "mandame un hola" y nunca a dónde: sin esto el paso es imposible de
   *  completar salvo que el cliente ya sepa el handle. null si no tiene bot. */
  telegram_bot?: string | null;
  /** EN QUÉ RELOJ VIVE EL NEGOCIO. TODAVÍA NO EXISTE: es el punto 4 de
   *  `docs/PENDIENTES.md` («El huso horario del agente, declarado»), y está
   *  declarado acá para que el día que el adapter lo publique el portal lo use
   *  sin tocar nada más. Se aceptan los dos nombres que se barajaron y las dos
   *  formas: la zona IANA (`"America/Montevideo"` — el dato bueno, sabe de
   *  horario de verano) o el offset en minutos. Mientras no venga, el portal lo
   *  deduce de las fechas que sí traen huso — ver `aprenderHusoDelAgente`. */
  zona?: string | null;
  timezone?: string | null;
  huso?: number | null;
  utc_offset?: number | null;
};

/** El huso que declara el manifiesto, si lo declara. Le gana a lo deducido:
 *  es el agente diciendo dónde vive, no nosotros adivinándolo. */
export function husoDelManifiesto(m: Manifest | null | undefined): number | null {
  if (!m) return null;
  const porZona = husoDeZona(m.zona ?? m.timezone);
  if (porZona !== null) return porZona;
  const crudo = m.huso ?? m.utc_offset;
  const n = typeof crudo === "number" ? crudo : Number(crudo);
  return Number.isFinite(n) && Math.abs(n) <= 900 ? n : null;
}

export type Ticket = {
  id: string;
  title: string;
  body: string | null;
  status: string;
  tenant: string | null;
  /** Which role holds this task. The kanban is one board shared across every
   *  Hermes profile, and this is where it records the owner. `null` on an agent
   *  that never had a team: the ticket is simply drawn without a chip. */
  assignee: string | null;
  created_at: string | number; // Hermes lo emite como epoch en segundos
};

const DEFAULTS = { endpoint: "http://localhost:8642", adapter: "http://localhost:8643" };
export const CLAVE_CONFIG = "tuagente_portal_config";
const KEY = CLAVE_CONFIG;
// Todo lo que el portal guarda de UN agente va bajo este prefijo: la
// credencial, el nombre que el cliente le puso, su pinta, las bienvenidas
// vistas, los pines del chat, las capacidades pedidas. NADA de lo que hay acá
// adentro puede sobrevivir a un cambio de agente.
const PREFIJO = "tuagente_";

/** ¿Son el mismo agente con la misma clave? La credencial ENTERA es la
 *  identidad: dos clientes distintos no comparten nada del browser, y el mismo
 *  cliente con la clave rotada tampoco arrastra caché (el nombre y la pinta
 *  vuelven del manifiesto, que es donde viven de verdad). */
export function mismaSesion(
  a: Partial<PortalConfig> | null | undefined,
  b: Partial<PortalConfig> | null | undefined,
): boolean {
  return Boolean(a && b && a.endpoint === b.endpoint && a.adapter === b.adapter && a.key === b.key);
}

/** La credencial que tiene guardada este browser. Solo LEE: no la escribe, no
 *  mira el hash y no borra nada. */
export function configGuardada(): PortalConfig | null {
  if (typeof window === "undefined") return null;
  try {
    const c = JSON.parse(localStorage.getItem(KEY) || "null");
    return c?.key ? (c as PortalConfig) : null;
  } catch {
    return null;
  }
}

/** Borra TODO lo que este browser sabe del agente. Se usa al salir y al entrar
 *  con el link de otro.
 *
 *  Va por prefijo y no por una lista de claves a propósito: una lista se
 *  desactualiza sola —el módulo que empieza a cachear algo se olvida de
 *  agregarse— y el precio de olvidarse es mostrarle a un cliente cosas de
 *  otro. Fue exactamente el bug del 12/8: `clearConfig` borraba la credencial
 *  y dejaba el nombre, la pinta y las bienvenidas del agente anterior, así que
 *  el portal de un estudio contable decía llamarse como el de una veterinaria
 *  —y, como la bienvenida figuraba vista, nunca le preguntó su nombre. */
export function olvidarAgente() {
  if (typeof window === "undefined") return;
  try {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith(PREFIJO)) localStorage.removeItem(k);
    }
  } catch {
    /* modo privado */
  }
}

/** La credencial que trae la URL en el hash, LEÍDA y nada más: no guarda, no
 *  borra, no olvida al agente anterior. Eso es trabajo de `loadConfig`.
 *
 *  Existe aparte porque el layout necesita darse cuenta de que pegaron un magic
 *  link nuevo sin recargar la página, y para eso tiene que poder mirar el hash
 *  sin efectos. Es la MISMA lectura que hace `loadConfig` —una sola— para que
 *  las dos no se separen. */
export function credencialEnLaURL(): Partial<PortalConfig> | null {
  if (typeof window === "undefined") return null;
  const h = window.location.hash;
  const get = (k: string) => h.match(new RegExp(`${k}=([^&]+)`))?.[1];
  if (!get("key")) return null;
  return {
    endpoint: get("endpoint") ? decodeURIComponent(get("endpoint")!) : undefined,
    adapter: get("adapter") ? decodeURIComponent(get("adapter")!) : undefined,
    key: get("key"),
  };
}

export function loadConfig(): PortalConfig | null {
  if (typeof window === "undefined") return null;
  const fromHash = credencialEnLaURL() ?? {};
  const stored = configGuardada();
  const cfg = {
    endpoint: fromHash.endpoint || stored?.endpoint || DEFAULTS.endpoint,
    adapter: fromHash.adapter || stored?.adapter || DEFAULTS.adapter,
    key: fromHash.key || stored?.key,
  };
  if (!cfg.key) return null;
  // Cambió el agente: lo del anterior se va entero ANTES de guardar el nuevo.
  if (stored && !mismaSesion(stored, cfg)) olvidarAgente();
  localStorage.setItem(KEY, JSON.stringify(cfg));
  return cfg as PortalConfig;
}

/** Salir: no alcanza con soltar la credencial. El nombre, la cara y las
 *  bienvenidas son del cliente que se va. */
export function clearConfig() {
  olvidarAgente();
}

// Se corre UNA vez, al cargar el JS del portal, y no en un efecto: el layout
// lee el nombre y la pinta del browser en SUS efectos, que corren antes que el
// primer `loadConfig()`. Sincronizando acá —antes del primer render— cuando el
// cliente entra con otro link, lo del agente anterior ya no está para leerse.
if (typeof window !== "undefined") loadConfig();

function headers(cfg: PortalConfig): HeadersInit {
  return { Authorization: `Bearer ${cfg.key}` };
}

/** Error de red con el status a mano: los módulos distinguen 404 de caída. */
export type HttpError = Error & { status?: number };
function httpError(status: number, path: string, detail?: string): HttpError {
  const e: HttpError = new Error(detail || `${status} en ${path}`);
  e.status = status;
  return e;
}

/** El adapter explica sus 400/409 en `{error}`: ese texto vale más que el número. */
async function failure(res: Response, path: string): Promise<HttpError> {
  let detail = "";
  try {
    const body = await res.json();
    if (typeof body?.error === "string") detail = body.error;
  } catch { /* sin cuerpo JSON */ }
  return httpError(res.status, path, detail);
}

/* ── En qué reloj vive el negocio ─────────────────────────────────────────────
   El portal muestra TODAS las fechas en el huso del agente, no en el de quien
   mira (ver la nota larga de `lib/palabras.ts`). Ese huso se deduce de las
   fechas que sí lo traen… y hasta ahora lo aprendían tres pantallas de once:
   Inicio, Actividad y Tareas. Las otras ocho lo CONSUMEN, y sin nada guardado
   caían al reloj del browser sin decir nada. Medido el 13/8 con el browser en
   -06: borrando `tuagente_huso` y entrando derecho a /app/pipeline, el sello
   decía «Actualizado 10:51»; pasando antes por Inicio, «Actualizado 13:52».
   Mismo agente, mismo minuto, dos relojes.

   Se llega ahí por dos caminos reales: el primer día de un cliente y cualquier
   falla del fetch de Inicio. Así que aprenderlo deja de ser tarea de las
   pantallas y pasa a ser de acá, que es por donde pasan TODAS las respuestas
   del agente: cualquier fecha con huso que llegue por cualquier endpoint lo
   enseña, sin importar por qué pestaña entró el cliente.
   ─────────────────────────────────────────────────────────────────────────── */

// SÓLO ESTAS CLAVES. Alcanzaría con barrer el JSON entero buscando algo con
// pinta de fecha, pero entonces el reloj del portal lo podría fijar el TEXTO de
// un ticket (los cuerpos son markdown que escribe el modelo, y una fecha con
// huso adentro de una tabla no dice dónde vive el negocio). Estas son las que
// escriben el motor y el adapter: `ts` en /portal/activity, `next_run_at` y
// `last_run_at` en /api/jobs, `claimed_at`/`started_at`/`finished_at` en las
// corridas de un cron, `cuando` en la última corrida de un flujo.
const CLAVES_CON_HUSO = new Set([
  "ts", "next_run_at", "last_run_at", "paused_at", "claimed_at",
  "started_at", "finished_at", "created_at", "updated_at", "cuando",
]);

/** El primer huso que traiga una respuesta del agente, o null. Con presupuesto:
 *  `/api/sessions` y `/portal/tickets` son listas largas y esto corre en cada
 *  respuesta. */
function husoEnRespuesta(valor: unknown, presupuesto = { nodos: 3000 }): number | null {
  if (presupuesto.nodos-- <= 0 || valor === null || typeof valor !== "object") return null;
  if (Array.isArray(valor)) {
    for (const v of valor) {
      const o = husoEnRespuesta(v, presupuesto);
      if (o !== null) return o;
    }
    return null;
  }
  for (const [k, v] of Object.entries(valor as Record<string, unknown>)) {
    if (typeof v === "string" && CLAVES_CON_HUSO.has(k)) {
      // Una fecha en `Z` NO enseña nada. Dice el instante, no dónde vive el
      // negocio: es lo que sale de serializar en UTC. Hoy ni el motor ni el
      // adapter mandan ninguna así —verificado endpoint por endpoint contra el
      // lab el 13/8: todas vienen `-03:00`—, pero el día que alguna aparezca,
      // aprender "el agente vive en UTC" le correría la hora al portal entero.
      // Sin huso deducible se sigue con el reloj del browser, como antes.
      const o = /[zZ]$/.test(v.trim()) ? null : husoDe(v);
      if (o !== null) return o;
      continue;
    }
    if (v !== null && typeof v === "object") {
      const o = husoEnRespuesta(v, presupuesto);
      if (o !== null) return o;
    }
  }
  return null;
}

function aprenderDeLaRespuesta(data: unknown) {
  const o = husoEnRespuesta(data);
  if (o !== null) fijarHuso(o);
}

/** Que el portal sepa en qué reloj vive el negocio ANTES de pintar la primera
 *  pantalla, entre por donde entre el cliente. Lo llama el arranque del layout.
 *
 *  Orden: lo que el agente declara de sí mismo (el manifiesto, cuando el kit lo
 *  publique) le gana a lo que el portal deduce. Y si ya lo sabe, no pide nada.
 *  Las dos fuentes deducidas son las únicas que traen fechas CON huso; si el
 *  agente no tiene ni actividad ni tareas —el primer día de un cliente— no hay
 *  nada que aprender y se sigue con el reloj del browser, igual que antes. */
export async function aprenderHusoDelAgente(cfg: PortalConfig, manifest?: Manifest | null) {
  const declarado = husoDelManifiesto(manifest);
  if (declarado !== null) { fijarHuso(declarado); return; }
  if (hayHusoAprendido()) return;
  // De a una y en orden: la actividad es la fuente más fresca, las tareas
  // programadas la que existe aunque el agente todavía no haya hecho nada.
  // `get` aprende solo de lo que devuelvan; acá sólo hay que provocarlas.
  await getActivity(cfg).catch(() => null);
  if (hayHusoAprendido()) return;
  await getJobs(cfg).catch(() => null);
}

async function get<T>(base: string, path: string, cfg: PortalConfig): Promise<T> {
  const res = await fetch(base + path, { headers: headers(cfg) });
  if (!res.ok) throw await failure(res, path);
  const data = await res.json();
  aprenderDeLaRespuesta(data);
  return data as T;
}

async function post<T>(base: string, path: string, cfg: PortalConfig, body?: unknown): Promise<T> {
  const res = await fetch(base + path, {
    method: "POST",
    headers: { ...headers(cfg), "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw await failure(res, path);
  return res.json();
}

async function del<T>(base: string, path: string, cfg: PortalConfig): Promise<T> {
  const res = await fetch(base + path, { method: "DELETE", headers: headers(cfg) });
  if (!res.ok) throw await failure(res, path);
  return res.json();
}

// Marca que el portal le pone al ticket que crea el propio cliente al pedir
// una conexión. Sin ella, ese pedido vuelve por Aprobaciones y el portal lo
// manda a aprobar su propia solicitud — un cliente de prueba lo describió como
// "pedir un presupuesto y que te manden a vos mismo a firmarlo". Va como
// comentario HTML: el sanitizador del markdown no lo muestra.
export const MARCA_PEDIDO = "<!-- portal:pedido -->";
/** Los pedidos anteriores a la marca se reconocen por cómo arranca el cuerpo. */
export const PREFIJO_PEDIDO = "Pedido desde el portal.";

/** ¿Este ticket lo pidió el cliente (y está en trámite nuestro), o es el agente
 *  pidiéndole permiso? Son dos cosas distintas: los suyos no se aprueban ni
 *  cuentan como pendientes en el badge del menú.
 *
 *  Vive acá y no en cada pantalla porque estaba copiado en cuatro lugares y ya
 *  se habían desincronizado: el badge del sidebar aplicaba el filtro nuevo y el
 *  Inicio no, así que el menú decía 2 y la portada decía "3 cosas esperando tu
 *  ok" en la misma pantalla. */
export function esPedidoDelCliente(body: string | null | undefined): boolean {
  const b = body ?? "";
  return b.includes(MARCA_PEDIDO) || b.trimStart().startsWith(PREFIJO_PEDIDO);
}

/** Qué conexiones ya pidió el cliente y siguen en trámite, por el label del
 *  catálogo con el que se armó el título (`Conectar {label}`).
 *
 *  EL TÍTULO ES EL ÚNICO VÍNCULO: el ticket no guarda el id de la conexión, así
 *  que quien quiera contestar "¿esto ya lo pedí?" tiene que leerlo de ahí. Vive
 *  acá —y no en Conexiones— porque desde que Equipo también deja el pedido son
 *  dos pantallas leyendo la misma convención, y si se desincronizan una de las
 *  dos le ofrece al cliente pedir de nuevo lo que ya está esperando. */
export function conexionesPedidas(tickets: Ticket[] | null | undefined): Set<string> {
  return new Set(
    (tickets ?? [])
      .filter((t) => esPedidoDelCliente(t.body) && t.status !== "done" && t.status !== "archived")
      .map((t) => (t.title ?? "").replace(/^Conectar\s+/i, "").trim().toLowerCase()),
  );
}

/* ── Un freno NO es una aprobación ────────────────────────────────────────────
   TERCERA COSA EN LA MISMA COLA, Y ES LA CONTRARIA DE UNA APROBACIÓN. En
   `blocked` no hay dos clases sino tres. Las dos conocidas: el agente pide
   permiso (tuyo) y el cliente pidió algo (nuestro, `esPedidoDelCliente`). La
   tercera la encontró la prueba a ciegas del 13/8: el agente frenó porque le
   FALTA algo que nosotros tenemos que conectar. Textual:

     «Me apareció "Control semanal de contratos — falta acceso a Google" con
      botones Rechazar / Corregir y aprobar / Aprobar. ¿Aprobar qué? No hizo
      nada, se trabó. Eso no es un permiso que yo tengo que dar, es un problema
      que me tienen que resolver.»

   Y "se trabó" es literal, no una impresión: aprobar es `unblock`, y un ticket
   tiene UN solo desbloqueo útil antes de que el motor lo declare un loop
   (BLOCK_RECURRENCE_LIMIT = 2 → `triage`, donde ya no se puede aprobar). Como la
   causa sigue ahí, el agente lo vuelve a bloquear enseguida: apretar Aprobar
   sobre uno de estos no adelanta nada y gasta el único desbloqueo del pedido.

   EL MOTOR NO LOS SEPARA: verificado en los dos labs, los pedidos de permiso y
   este freno tienen el mismo `block_kind = needs_input` (y `/portal/approvals`
   ni siquiera lo publica). Lo que sí los separa es lo que el agente ESCRIBE: el
   SOUL le manda poner `conexion:<id>` sola en una línea cuando le falta una
   conexión (`soul/04-lenguaje.md`), que es la marca que el portal ya convierte
   en tarjeta. Medido sobre los 13 pedidos bloqueados de Tero y Zaguán: la marca
   aparece en 1 —justo ése— y en ninguno de los 10 pedidos de permiso reales.
   ─────────────────────────────────────────────────────────────────────────── */

// Misma expresión que el chip de `lib/entities.tsx`, sin el ancla de línea: acá
// se busca DENTRO del cuerpo.
const CONEXION_EN_TEXTO = /\bconexi[oó]n:([a-z0-9][a-z0-9-]*)/gi;

/** La forma que la skill `aprobacion` le da a un pedido: un cuadro markdown
 *  ("si aprobás / si rechazás / por qué"). Es lo que separa una PROPUESTA de
 *  cualquier otro texto del agente. */
export const pareceUnaPropuesta = (s: string | null | undefined) =>
  /^\s*\|.*\|\s*$/m.test(s || "");

/** Las conexiones que el ticket nombra como faltantes, por id del catálogo. */
export function conexionesQueFaltan(texto: string | null | undefined): string[] {
  const vistas = new Set<string>();
  // `exec` en bucle y no `matchAll`: el target de este proyecto es ES5 y el
  // iterador no compila. La regex es global, así que `lastIndex` avanza sola —
  // y se reinicia acá para que dos llamadas seguidas no se pisen.
  CONEXION_EN_TEXTO.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CONEXION_EN_TEXTO.exec(texto ?? "")) !== null) vistas.add(m[1].toLowerCase());
  return Array.from(vistas);
}

/** ¿Este pedido bloqueado está esperando que se CONECTE algo, en vez de una
 *  decisión del cliente? Ahí no hay nada que aprobar.
 *
 *  ANTE LA DUDA, ES UNA APROBACIÓN. Si el cuerpo trae el cuadro de la skill,
 *  gana la propuesta aunque mencione una conexión: sacarle los botones a un
 *  pedido de permiso real es peor que dejárselos a un freno — el cliente se
 *  queda sin poder autorizar lo que sí quiere. */
export function esFrenoPorConexion(body: string | null | undefined): boolean {
  if (esPedidoDelCliente(body)) return false;
  if (pareceUnaPropuesta(body)) return false;
  return conexionesQueFaltan(body).length > 0;
}

/* ── Lo que el cliente "dijo" según la máquina ────────────────────────────────
   Aprobar-con-corrección y rechazar dejan en el ticket un comentario firmado
   `cliente` que NO escribió el cliente: es una instrucción para el agente, con
   mayúsculas y órdenes ("RECHAZADO POR TU CLIENTE. No hagas lo que pediste
   aprobar, ni una versión parecida…"). La instrucción tiene que existir —es lo
   que impide que el agente lea un "no" como un permiso—, pero mostrársela a la
   clienta firmada "Vos" es ponerle en la boca un prompt que ella nunca
   escribió. Se guarda entera y se muestra sólo su parte: sus palabras.
   ─────────────────────────────────────────────────────────────────────────── */

const RECHAZO_RE = /^\s*RECHAZADO POR (?:TU|EL) CLIENTE\b/i;
/** LA ÚNICA DEFINICIÓN DE "EL CLIENTE" DEL PORTAL.
 *
 *  Los autores con los que el ADAPTER firma lo que escribe en nombre del
 *  cliente: `cliente` (el rechazo, la corrección) y `portal` (el asiento de
 *  auditoría). Todo lo demás —`default`, `worker`, el nombre del profile, el
 *  nombre de una persona— no es el cliente, y nadie habla por su clienta.
 *
 *  HABÍA TRES COPIAS DE ESTA REGLA y no decían lo mismo: acá entraban también
 *  `user` y `usuario`, en el Tablero no, y en el visor de entidades `portal`
 *  salía como "Portal" en vez de "Vos". Con un comentario firmado `user` el
 *  Tablero mostraba «**user** · Lo rechazaste»: el rótulo decía que había
 *  rechazado la clienta y el nombre decía otra cosa, en el mismo renglón.
 *
 *  Y `user`/`usuario` SE FUERON DEL CONJUNTO. El adapter no firma así —solo
 *  `cliente` y `portal`—, así que no reconocían nada real; lo que sí hacían era
 *  regalar superficie justo en la función que decide qué contenido se esconde
 *  (ver `leerComentario`: lo que firma el cliente se filtra). Que hoy el hook
 *  del motor bloquee `--author=` y `HERMES_PROFILE=` es una defensa de la otra
 *  punta, y las defensas de la otra punta se caen solas. */
export const esElCliente = (autor: string | null | undefined) =>
  /^(cliente|portal)$/i.test((autor ?? "").trim());
// El auto-decomposer del motor comenta en inglés y firmado con su propio
// nombre. Justo en el momento en que al cliente se le rompió el pedido, la
// pantalla le contestaba «Decomposed into t_f7052f4d, t_c8a7f149. Root will
// wake when all children complete.» Y lo que hace falta decir ahí no es qué
// pasó sino qué revisar: cuando el motor parte una tarea, la parte con el
// texto ORIGINAL — por eso a la clienta le quedó en la cola una tarea de 8
// bisagras después de haber corregido a 20.
const DECOMPOSED_RE =
  /^\s*Decomposed into (.+?)\.\s*Root will wake when all children complete\.?\s*$/i;
/** El que firma un comentario que no es ni el cliente ni el agente. */
export const esElSistema = (autor: string) =>
  /^(auto-decomposer|system|kanban|engine)$/i.test((autor || "").trim());

// Hermes firma los comentarios del agente con el autor del CLI: "default",
// "worker" o el nombre del profile según el camino que los escribió. Todos son
// LA MISMA persona para el cliente: su agente, con el nombre que le puso.
//
// `user` y `usuario` ESTÁN ACÁ Y NO EN `esElCliente`, y la diferencia es todo:
// `user` es lo que `hermes kanban comment` pone cuando nadie dijo quién escribe
// (el default del CLI, no una identidad), y adentro del agente de un cliente el
// único que corre el CLI es el agente. Como RÓTULO es su nombre —mostrar la
// palabra "user" en la pantalla es un identificador de máquina en la cara del
// cliente—, pero como CONFIANZA no es nadie: por ahí no se esconde contenido ni
// se habla en nombre de la clienta.
const FIRMAS_DEL_AGENTE = new Set([
  "", "default", "worker", "agent", "hermes", "user", "usuario",
]);

/** QUIÉN ESCRIBIÓ ESTE COMENTARIO, con nombre y apellido si lo tiene.
 *
 *  Vive acá, al lado de `esElCliente` y `esElSistema`, porque el rótulo es la
 *  cara visible de esas dos reglas y separarlos ya salió caro: Aprobaciones
 *  —la pantalla donde el cliente AUTORIZA— tenía su propio ternario binario
 *  (`esDelCliente ? "Vos" : "Tu agente"`) y por eso el comentario de un tercero
 *  real, el fundador de la empresa, se leía «**Tu agente** — Ojo que a
 *  Panadería Rivas le prometí el precio viejo hasta fin de mes». El Tablero, con
 *  los mismos datos, lo mostraba bien. Un rótulo de autor que miente en la
 *  pantalla de aprobar es el peor lugar posible para que mienta.
 *
 *  Cuatro casos, y ninguno inventa: el cliente ("Vos"), el motor ("El sistema"),
 *  el agente con cualquiera de sus firmas internas (el nombre que le puso el
 *  cliente), y cualquier otro autor — que se muestra TAL CUAL vino, porque es
 *  una persona de la empresa y su nombre es el dato.
 *
 *  `nombreAgente` entra por parámetro, igual que en `rotuloEvento`: leerlo acá
 *  ataría este módulo al onboarding, que ya depende de éste. */
export function rotuloAutor(autor: string | null | undefined, nombreAgente = "Tu agente"): string {
  if (esElCliente(autor)) return "Vos";
  const a = (autor ?? "").trim();
  if (esElSistema(a)) return "El sistema";
  return FIRMAS_DEL_AGENTE.has(a.toLowerCase()) ? nombreAgente : a;
}
// El adapter escribe «Motivo, con sus palabras: «…»». La variante con "Te dijo"
// es de la versión que armaba el portal: quedó en tickets viejos.
const MOTIVO_ENCABEZADO = /(?:Motivo|Te dijo),? con sus palabras:[ \t]*/i;
/** Las comillas con las que el adapter envuelve el motivo. */
const COMILLAS: [string, string][] = [["«", "»"], ["“", "”"], ['"', '"']];

/** Las palabras del cliente, sacadas del bloque que arma el adapter.
 *
 *  HASTA LA ÚLTIMA COMILLA, no la primera. Con una captura perezosa
 *  (`[\s\S]*?`) el motivo se cortaba en la primera comilla interna, y el
 *  cliente que escribió «no me gusta la palabra «descuento», cambiala por
 *  rebaja» leía en pantalla «no me gusta la palabra «descuento» — sus propias
 *  palabras, a medias y diciendo otra cosa. El cierre que el adapter agrega
 *  después del motivo no lleva comillas, así que la última cerrada es la suya.
 *  Sin comillas (formato viejo), hasta el renglón en blanco. */
function motivoDelRechazo(b: string): string {
  const m = b.match(MOTIVO_ENCABEZADO);
  if (!m || m.index === undefined) return "";
  const resto = b.slice(m.index + m[0].length);
  for (const [abre, cierra] of COMILLAS) {
    if (!resto.startsWith(abre)) continue;
    const fin = resto.lastIndexOf(cierra);
    if (fin > abre.length - 1) return resto.slice(abre.length, fin).trim();
  }
  return resto.split(/\n\s*\n/)[0].trim();
}

// El encabezado de la corrección, con su preámbulo hasta los dos puntos. El
// `\n+` que pedía antes acoplaba el filtro a que el adapter siguiera poniendo
// la versión en un renglón aparte: una corrección de un solo renglón no
// matcheaba y el prompt de máquina entero salía crudo, firmado "Vos".
const CORRECCION_RE = /^\s*Aprobado CON CORRECCIONES\.[ \t]*(?:[^\n:]*:)?\s*/i;
const APROBADO_RE = /^\s*Aprobado desde el portal(\s*\(con correcciones\))?\s*$/i;

export type ComentarioLegible = {
  /** Lo que se muestra. Vacío = no hay texto, sólo el rótulo. */
  texto: string;
  /** Qué fue esto, en una línea. Sólo cuando el texto crudo no se puede mostrar. */
  rotulo?: string;
};

/** Un comentario del ticket, listo para los ojos del cliente.
 *
 *  EL AUTOR NO ES UN ADORNO: SIN ÉL, EL PREFIJO ES UN INTERRUPTOR DE LUZ.
 *  Los formatos de máquina de acá abajo los escribe el ADAPTER firmando
 *  `cliente`, y los rótulos hablan en nombre del cliente ("Lo rechazaste").
 *  Reconocerlos por el texto, venga de quien venga, hacía dos cosas malas a la
 *  vez. La primera es un rótulo que se contradice solo: un comentario del
 *  AGENTE que arrancaba con "RECHAZADO POR TU CLIENTE." salía en pantalla como
 *  «Tu agente · Lo rechazaste». La segunda es peor y es la que manda: como
 *  después se muestra sólo el bloque del motivo —que un comentario del agente
 *  no tiene—, el comentario quedaba ENTERO INVISIBLE. O sea, un canal por el
 *  cual el modelo esconde cualquier cosa que escriba con sólo prefijarla.
 *  Medido contra el agente del lab: el comentario se veía en el ticket y en la
 *  pantalla no quedaba ni una palabra.
 *
 *  La promesa del producto es "ves lo que tu agente hace". Regla: el filtro se
 *  aplica sólo a lo que firma el cliente; todo lo demás se muestra crudo. */
export function leerComentario(body: string, autor?: string): ComentarioLegible {
  const b = (body ?? "").trim();
  const delCliente = esElCliente(autor);
  if (delCliente && RECHAZO_RE.test(b)) {
    const motivo = motivoDelRechazo(b);
    // SIN BLOQUE DE MOTIVO SE MUESTRA EL CRUDO, NUNCA NADA. Hoy el adapter
    // siempre lo escribe, pero atar "escondo el comentario entero" a "el otro
    // lado no cambió el formato" es el acoplamiento que ya nos rompió otras
    // veces: el día que cambie, el cliente deja de ver lo que dijo.
    return motivo ? { rotulo: "Lo rechazaste", texto: motivo } : { rotulo: "Lo rechazaste", texto: b };
  }
  if (delCliente && CORRECCION_RE.test(b)) {
    const texto = b.replace(CORRECCION_RE, "").trim();
    return texto
      ? { rotulo: "Tu versión corregida", texto }
      : { rotulo: "Tu versión corregida", texto: b };
  }
  // El auto-decomposer es el motor, no el cliente: si esto viniera firmado por
  // él sería un comentario suyo que empieza igual, y se muestra tal cual.
  const partida = delCliente ? null : b.match(DECOMPOSED_RE);
  if (partida) {
    const hijas = partida[1].split(/\s*,\s*/).filter(Boolean);
    return {
      rotulo: "Se partió sola",
      texto:
        `Era muy grande y el sistema la partió en ${hijas.length === 1 ? "otra tarea" : `${hijas.length} tareas`} más chicas: `
        + `${hijas.join(", ")}. Conviene abrirlas y revisar que digan lo que pediste: al partirla `
        + "se copia el pedido original, no las correcciones que hayas hecho después. Esta tarea "
        + "sigue abierta y se retoma cuando terminen las otras.",
    };
  }
  if (delCliente && APROBADO_RE.test(b)) {
    return { rotulo: b.toLowerCase().includes("correcciones") ? "Lo aprobaste con tu corrección" : "Le diste el ok", texto: "" };
  }
  return { texto: b };
}

/** ¿Este comentario es un "no" del cliente? Lo mismo que reconoce
 *  `leerComentario`, expuesto para las pantallas que necesitan el ESTADO de la
 *  negociación y no sólo el texto (ver `docs/PENDIENTES.md`: lo que está
 *  abierto se lee de los datos, no de un `useState` que se muere con F5). */
/** El motivo que el cliente escribió al rechazar, o "" si el comentario no
 *  trae el bloque que arma el adapter. Las pantallas lo usan para citarlo entre
 *  comillas: sin bloque no se cita nada (mostrar el prompt de máquina entre
 *  comillas sería ponerle en la boca algo que no dijo). */
export const motivoDeRechazo = (body: string) => motivoDelRechazo((body ?? "").trim());

export function esRechazoDelCliente(c: { author?: string; body?: string } | null | undefined) {
  return Boolean(c && esElCliente(c.author) && RECHAZO_RE.test((c.body ?? "").trim()));
}

export type TicketComment = { author: string; body: string; created_at: number };
export type TicketEvent = {
  kind: string;
  created_at: number;
  summary?: string;
  files?: string[];
  blocked_kind?: string;
};
/** Por qué el ticket quedó como quedó. Lo arma el adapter desde el evento de
 *  cierre (o de bloqueo), no depende de que el agente se acuerde de comentar. */
export type TicketOutcome = {
  kind: string;
  summary?: string;
  files?: string[];
  created_at: number;
};
export type TicketDetail = {
  ticket: Ticket;
  outcome?: TicketOutcome | null;
  comments: TicketComment[];
  events: TicketEvent[];
};

// ── Adapter (:8643) ──
export const getManifest = (c: PortalConfig) => get<Manifest>(c.adapter, "/portal/manifest", c);
export const getTickets = (c: PortalConfig) => get<{ tickets: Ticket[] }>(c.adapter, "/portal/tickets", c);
export const getTicketDetail = (c: PortalConfig, id: string) =>
  get<TicketDetail>(c.adapter, `/portal/tickets/${encodeURIComponent(id)}`, c);
export const getApprovals = (c: PortalConfig) => get<{ approvals: any[] }>(c.adapter, "/portal/approvals", c);
/** `correction` (opcional): tu versión corregida queda asentada como comentario
 *  tuyo antes de desbloquear — el ticket original no se modifica. */
export const approve = (c: PortalConfig, id: string, correction?: string) =>
  post<{ ok: boolean }>(c.adapter, `/portal/approvals/${id}/approve`, c,
     correction ? { correction } : undefined);
export const getGoogleAuthUrl = (c: PortalConfig) =>
  post<{ auth_url: string }>(c.adapter, "/portal/connections/google/auth-url", c);
export const exchangeGoogleAuthCode = (c: PortalConfig, code: string) =>
  post<{ ok: boolean }>(c.adapter, "/portal/connections/google/auth-code", c, { code });
export const activateTelegramPairing = (c: PortalConfig, code: string) =>
  post<{ ok: boolean }>(c.adapter, "/portal/connections/telegram/pairing", c, { code });
export const getWhatsAppPairStatus = (c: PortalConfig) =>
  get<{ paired: boolean; pairing: boolean; has_qr: boolean }>(c.adapter, "/portal/connections/whatsapp/pair", c);
export const startWhatsAppPairing = (c: PortalConfig) =>
  post<{ ok?: boolean }>(c.adapter, "/portal/connections/whatsapp/pair/start", c);
export const getWhatsAppPairQr = async (c: PortalConfig) => {
  const res = await fetch(`${c.adapter}/portal/connections/whatsapp/pair/qr.png?t=${Date.now()}`, {
    headers: headers(c),
  });
  if (!res.ok) throw await failure(res, "QR de WhatsApp");
  return res.blob();
};
export type Rechazo = {
  ok: boolean;
  /** En qué estado quedó el ticket: `blocked` con un "no" común (igual que
   *  antes de rechazar), `done` cuando el cliente lo cerró. */
  estado?: string;
  /** Siempre false: rechazar NO gasta el desbloqueo (ver abajo). */
  desbloqueado?: boolean;
  /** true sólo con `definitivo`: el ticket quedó terminado y el pedido se va
   *  de la pestaña. */
  cerrado?: boolean;
  /** El pedido SIGUE en la pestaña esperando tu ok. */
  en_aprobaciones?: boolean;
  /** El comentario quedó escrito seguro; avisarle al agente es best-effort. */
  avisado?: boolean;
  /** Cuántas veces se re-bloqueó por lo mismo. El motor cuenta desde 1: el
   *  PRIMER bloqueo ya deja 1, y ahí se queda toda la negociación mientras el
   *  ticket no se desbloquee. Lo que importa es que no llegue a 2, que es
   *  donde el motor lo manda a triage y el pedido muere. Medido en el lab con
   *  dos rechazos y una aprobación con corrección: nunca pasó de 1. */
  block_recurrences?: number | null;
};

/** RECHAZAR ES UN COMENTARIO FIRMADO POR EL CLIENTE, Y NADA MÁS.
 *
 *  UNA sola llamada, una sola escritura. El portal hacía tres —comentar,
 *  comentar otra vez y mover el ticket a `ready`— y ninguna era atómica: si la
 *  última fallaba, el comentario ya estaba puesto, la pantalla decía "no se
 *  pudo" y reintentar comentaba dos veces.
 *
 *  Y sobre todo: EL ESTADO DEL TICKET NO SE TOCA. Un ticket tiene un solo
 *  `unblock` útil antes de que el motor lo declare un loop (a las dos
 *  re-bloqueadas por la misma causa se va a `triage`, donde Aprobar contesta
 *  "quedó trabado" y ningún verbo lo trae de vuelta). Si rechazar destrabara,
 *  la secuencia normal de una negociación —pido, me dicen que no, corrijo,
 *  vuelvo a pedir— gastaría ese único desbloqueo en el primer "no", y el
 *  segundo bloqueo mataría el pedido: o triage, o el auto-decomposer partiendo
 *  la tarea con el CUERPO VIEJO (la clienta corrigió a 20 bisagras y le quedó
 *  en la cola una tarjeta que decía 8).
 *
 *  Con el ticket quieto en `blocked`: el comentario despierta al agente igual
 *  (`notify_agent_of_comment`), el agente re-propone sobre el mismo ticket, el
 *  pedido no desaparece de la pestaña mientras se negocia, y el desbloqueo se
 *  gasta UNA vez, al aprobar, que es el final.
 *
 *  `definitivo` ES LA OTRA MITAD, Y LA DECIDE EL CLIENTE. Hay dos "no"
 *  distintos y sólo él sabe cuál está diciendo: "así no, traeme otra versión"
 *  (el de arriba) y "esto no va, no me lo propongas más". El segundo cierra el
 *  ticket (`done`) en la MISMA escritura que el comentario, del lado del
 *  adapter. Sin él, un pedido definitivamente rechazado se quedaba para siempre
 *  en Aprobaciones con un botón Aprobar vivo que ya no aprobaba nada. Y no se
 *  infiere del texto del motivo: que el modelo adivine si un "no" era final es
 *  exactamente la decisión que no le toca. */
export const reject = (c: PortalConfig, id: string, reason: string, definitivo = false) =>
  post<Rechazo>(c.adapter, `/portal/approvals/${id}/reject`, c,
    definitivo ? { reason, definitivo: true } : { reason });

/** Algo cambió en la cola de aprobaciones: que el badge del menú se entere ya
 *  y no dentro de un minuto. */
export const EVENTO_APROBACIONES = "tuagente:aprobaciones";
export function avisarAprobacionesCambiaron() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENTO_APROBACIONES));
}
/** Bautizo y pinta, guardados EN EL AGENTE para que lo sigan a cualquier
 *  máquina. Con un adapter viejo tira 404 y el portal sigue con el browser. */
export const guardarIdentidad = (
  c: PortalConfig,
  identidad: {
    nombre?: string;
    look?: Record<string, number>;
    /** Quién es el CLIENTE (adapter 0.32+). El nombre del negocio se usa para
     *  hablarle de lo suyo por su nombre; la url dispara el brief (el agente
     *  investiga su propia empresa y entrega un borrador). */
    empresa?: string;
    url?: string;
    /** Por dónde le avisa el agente. El aviso lo manda ÉL, no nosotros. */
    contacto?: { canal: "telegram" | "correo" | "ninguno"; valor?: string };
    /** Captura PNG (base64 pelado) del agentito al bautizarlo: el agente la
     *  guarda y un tool nuestro la sube como foto del bot de Telegram. */
    avatar_png?: string;
  },
) => post<{ ok: boolean }>(c.adapter, "/portal/identity", c, identidad);
/** Cambiar qué puede hacer el agente con una conexión. Solo el cliente. */
export const guardarPermisos = (
  c: PortalConfig, id: string, permisos: { leer?: boolean; actuar?: boolean },
) => post<{ ok: boolean; permisos: { leer: boolean; actuar: boolean } }>(
  c.adapter, `/portal/connections/${encodeURIComponent(id)}/permisos`, c, permisos);
export const getActivity = (c: PortalConfig) => get<{ events: any[] }>(c.adapter, "/portal/activity", c);
export const getFiles = (c: PortalConfig) => get<{ files: any[] }>(c.adapter, "/portal/files", c);
export const getFileText = async (c: PortalConfig, path: string) => {
  const res = await fetch(`${c.adapter}/portal/files/${encodeURIComponent(path)}`, { headers: headers(c) });
  if (!res.ok) throw httpError(res.status, path);
  return res.text();
};
/** Los bytes crudos, sin pasarlos por texto.
 *
 *  Para descargar hay que usar SIEMPRE esto. `res.text()` decodifica como
 *  UTF-8, y sobre un binario (.xlsx, .pdf, una imagen) cada byte inválido se
 *  reemplaza por U+FFFD: el archivo que baja queda roto aunque el adapter lo
 *  haya mandado intacto. Verificado con un .xlsx de 9316 bytes que viajaba
 *  perfecto y se corrompía recién en el browser. */
export const getFileBytes = async (c: PortalConfig, path: string) => {
  const res = await fetch(`${c.adapter}/portal/files/${encodeURIComponent(path)}`, { headers: headers(c) });
  if (!res.ok) throw httpError(res.status, path);
  return res.arrayBuffer();
};
/** Lo que gastó el agente, según quien le cobra (adapter 0.39+).
 *
 *  Reemplaza a `getUsage` (`/portal/usage`), que sumaba lo que nosotros veíamos
 *  pasar por el proxy y le erraba 9x PARA ABAJO — la generación de imágenes le
 *  pega directo al proveedor y nunca entraba en la cuenta. Ahora el número lo da
 *  OpenRouter para la clave de ESTE agente. La clave no llega nunca al browser:
 *  la llamada la hace el adapter.
 *
 *  `disponible: false` (sin clave, o el proveedor no contesta) viene con 200:
 *  la pantalla lo dice y no se dibuja ningún número. */
export type Uso = {
  disponible?: boolean;
  motivo?: string;
  /** Todos en USD. `null` es "el proveedor no lo informa", que NO es cero. */
  hoy_usd?: number | null;
  mes_usd?: number | null;
  total_usd?: number | null;
  /** Tope de la clave; null = sin tope. */
  limite_usd?: number | null;
  actualizado?: string;
};
export const getUso = (c: PortalConfig) => get<Uso>(c.adapter, "/portal/uso", c);

/** Sube un archivo al buzón del agente (workspace/entrada) y devuelve su ruta. */
export async function uploadFile(c: PortalConfig, file: File) {
  const buf = new Uint8Array(await file.arrayBuffer());
  // De a pedazos: con archivos grandes, un solo apply revienta la pila.
  let bin = "";
  for (let i = 0; i < buf.length; i += 8192) {
    bin += String.fromCharCode.apply(null, Array.from(buf.subarray(i, i + 8192)));
  }
  return post<{ ok: boolean; path: string; bytes: number }>(
    c.adapter, "/portal/upload", c, { name: file.name, content_b64: btoa(bin) },
  );
}

export type Capability = {
  name: string; summary: string; origen: string; categoria?: string;
  /** true solo en las nuestras (adapter ≥0.21): las del motor no se editan. */
  editable?: boolean;
  /** Nombre para humanos con tildes (frontmatter `titulo`, adapter ≥0.23);
   *  sin él, el portal humaniza el slug — que no puede inventar tildes. */
  label?: string;
};
export type Capabilities = {
  skills: Capability[];
  plugins: { name: string; summary: string }[];
  mcp: { name: string; detalle: string }[];
};
export const getCapabilities = (c: PortalConfig) =>
  get<Capabilities>(c.adapter, "/portal/capabilities", c);

/** Un flujo: el trabajo del cliente con nombre, gatillo y resultados
 *  (adapter ≥0.29). El estado "incompleto" lo deriva el adapter de las
 *  conexiones que faltan — nunca viene guardado. */
export type Flujo = {
  slug: string;
  nombre: string;
  para_cliente: string;
  gatillo_tipo: "drive" | "horario" | "webhook" | "pedido" | string;
  gatillo: string;
  estado: "activo" | "pausado" | "incompleto" | string;
  conexiones_faltan: string[];
  ultima_corrida?: { cuando?: string | null; status?: string } | null;
  /** Id de la tarea programada que dispara el flujo. El adapter LO TIENE (lo
   *  lee del frontmatter para calcular `ultima_corrida`) pero todavía no lo
   *  publica; ver `docs/PENDIENTES.md`. Mientras tanto el portal ata el flujo a
   *  su tarea por el nombre `flujo-<slug>`, que es el que le pone el kit. */
  gatillo_job?: string | null;
  resultados: { path: string; mtime: number }[];
  resultados_total: number;
};
export const getFlujos = (c: PortalConfig) =>
  get<{ disponible: boolean; flujos: Flujo[] }>(c.adapter, "/portal/flujos", c);
/** Detalle: resultados completos + el "cómo trabajo" del FLUJO.md (≥0.30). */
export type FlujoDetalle = Flujo & { como: string };
export const getFlujoDetalle = (c: PortalConfig, slug: string) =>
  get<FlujoDetalle>(c.adapter, `/portal/flujos/${encodeURIComponent(slug)}`, c);

/** El SKILL.md completo de una habilidad nuestra (adapter ≥0.21). */
export const getSkillContent = (c: PortalConfig, name: string) =>
  get<{ name: string; content: string }>(c.adapter, `/portal/skills/${encodeURIComponent(name)}`, c);
/** Editar la habilidad ES editar cómo trabaja el agente: el motor la reindexa
 *  solo en unos minutos, no hay que reiniciar nada. */
export const saveSkill = (c: PortalConfig, name: string, content: string) =>
  post<{ ok: boolean }>(c.adapter, `/portal/skills/${encodeURIComponent(name)}`, c, { content });

/** A qué sistemas del cliente está enchufado el agente.
 *  El adapter reporta PRESENCIA, nunca valores: acá no viaja ninguna credencial. */
export type Connection = {
  id: string;
  label: string;
  grupo: "canal" | "sistema" | string;
  para_que: string;
  como: string;
  esfuerzo?: "minutos" | "horas" | "dias" | string;
  quien?: "cliente_solo" | "asistido" | "nosotros" | string;
  advertencia?: string | null;
  recomendado?: boolean;
  estado: "conectado" | "sin_conectar" | "bloqueado" | string;
  falta: { tipo: string; nombre: string }[];
  falta_previo: { tipo: string; nombre: string }[];
  /** true si el flujo de ESTE cliente la necesita (adapter ≥0.24). */
  requerida?: boolean;
  /** Qué puede hacer el agente con esta conexión (adapter ≥0.33). Lo decide el
   *  cliente y se aplica en el guardia, no en el prompt: el agente no puede
   *  cambiarlo (el archivo está montado de solo lectura de su lado). */
  permisos?: { leer: boolean; actuar: boolean };
  /** "google-oauth" = el portal la conecta solo con su diálogo (adapter ≥0.25);
   *  sin flujo, el botón cae a "Pedir que la conecten". */
  flujo?: string | null;
  /** Estado "lista" (adapter ≥0.27): nuestra mitad está (el bot existe) pero
   *  el cliente nunca chateó. `link` es el t.me/… para su primer mensaje. */
  link?: string | null;
};
export const getConnections = (c: PortalConfig) =>
  get<{ disponible: boolean; conexiones: Connection[] }>(c.adapter, "/portal/connections", c);

/** Lo que el agente NO puede hacer todavía y se puede prender. El adapter la
 *  calcula por PRESENCIA (`activa`), igual que las conexiones, y esconde lo
 *  nuestro (`instala`, `verifica`): acá solo llega lo que el cliente lee. */
export type Capacidad = {
  id: string;
  label: string;
  grupo?: string;
  para_que: string;
  como?: string;
  costo?: string;
  esfuerzo?: string;
  quien?: string;
  /** `base` viene en TODOS los agentes: se dibuja como incluida y NUNCA con
   *  botón de pedido (pedir algo que ya se tiene es la peor pantalla posible).
   *  `menu` es lo que se puede sumar. Un adapter viejo no lo manda: sin el
   *  campo se asume `menu`, que es como se comportaba el portal hasta ahora. */
  nivel?: "base" | "menu" | string;
  /** null = no se puede afirmar (el motor no expone el índice de tools). */
  activa: boolean | null;
};
export const getCapacidades = (c: PortalConfig) =>
  get<{ disponible: boolean; capacidades: Capacidad[] }>(c.adapter, "/portal/capacidades", c);

/** Lo que el cliente escribió que necesita, traducido a ids del catálogo.
 *
 *  Lo resuelve el agente con UNA llamada corta al modelo —no una corrida
 *  entera— y contesta ids validados contra el catálogo: lo que el modelo se
 *  invente no llega hasta acá.
 *
 *  `sin_matching` es la respuesta honesta a "no se pudo preguntar" (el agente
 *  no tiene con qué llamar al modelo): la pantalla muestra el menú entero sin
 *  marcar en vez de cortar el alta. Una lista vacía SIN ese campo dice otra
 *  cosa: se preguntó, y nada del menú era lo que el cliente pidió. */
export const crearSugerenciaDeCapacidades = (c: PortalConfig, texto: string) =>
  post<{ sugeridas: string[]; sin_matching?: boolean }>(
    c.adapter, "/portal/capacidades/sugerir", c, { texto });

/** Lo que el cliente pidió de un rol que todavía no está andando: con qué
 *  nombre y con qué cara lo bautizó cuando lo eligió. Un rol PEDIDO sigue
 *  sirviendo el nombre y el look DEL CATÁLOGO (recién al instalarlo el perfil
 *  pasa a ser suyo), así que lo que el cliente eligió viaja acá adentro y es lo
 *  único con lo que el portal puede mostrárselo mientras espera. */
export type PedidoDeRol = {
  nombre: string;
  /** El look del agentito, tal cual lo guarda el bautizo. */
  pinta?: Record<string, number> | null;
  /** Cuándo lo pidió, como lo anotó el agente (ISO). */
  pedido_en: string;
  /** Las capacidades que el cliente eligió al pedirlo, si el rol se las
   *  preguntó (hoy sólo el asistente, que no viene armado de fábrica). No
   *  prenden nada solas: son lo que el cliente espera, y quien lo contrata las
   *  lee para saber qué ponerle. */
  capacidades?: string[];
};

/** One member of the team -- hired or on offer.
 *
 *  A role is a Hermes profile with its own SOUL, skills and memory. `name` and
 *  `look` only come back for hired ones: they are read from the profile the
 *  client owns, so a rename survives. */
export type Role = {
  id: string;
  label: string;
  /** What it does, in the client's words. */
  does: string;
  /** Its hard limit, also in their words. The same sentence lives in its SOUL. */
  never?: string;
  hired: boolean;
  name?: string;
  look?: Record<string, number>;
  /** Connections it cannot start without. */
  needs?: string[];
  flows?: string[];
  state?: string;
  /** Ya trabaja para el cliente. Es el mismo hecho que `hired`: el roster lo
   *  publica con los dos nombres mientras el alta usa el nuevo. */
  contratado?: boolean;
  /** Pedido y todavía no instalado. Es lo que separa "podés sumarlo" de "ya lo
   *  pediste y está en camino" — sin esto, un cliente que espera ve el rol
   *  ofrecido de nuevo y lo vuelve a pedir. */
  pedido?: PedidoDeRol | null;
};
export const getRoles = (c: PortalConfig) =>
  get<{ available: boolean; roles: Role[] }>(c.adapter, "/portal/roles", c);

/** El cliente elige un rol del catálogo, lo bautiza y lo deja pedido.
 *
 *  NO PRENDE NADA SOLO: instalar un perfil es trabajo nuestro (SOUL, skills,
 *  permisos, reinicio del gateway). Esto lo anota del lado del agente y el
 *  portal se queda esperando a que el rol aparezca contratado en el roster.
 *
 *  El adapter contesta 409 con dos motivos distintos —ya lo pediste, o ya lo
 *  tenés— y 400 si el nombre viene vacío. El texto viaja en `{error}`, que es
 *  lo que `failure` deja en el mensaje del error. */
export const crearPedidoDeRol = (
  c: PortalConfig, rol: string, nombre: string, pinta: Record<string, number> | null,
  /** Sólo para el rol que se compone de capacidades: los ids que el cliente
   *  dejó marcados. El adapter los valida contra el catálogo y contesta 400 si
   *  hay alguno que no se pueda pedir. */
  capacidades?: string[],
) => post<{ pedido: PedidoDeRol & { rol: string } }>(
  c.adapter, "/portal/roles/pedido", c,
  capacidades?.length ? { rol, nombre, pinta, capacidades } : { rol, nombre, pinta });

/** One turn of a room, as the adapter stored it. */
export type RoomTurn = {
  ts: number;
  role: "user" | "assistant";
  content: string;
  /** Which teammate answered. Absent = the agent the client named. */
  by?: string;
};
export type RoomSummary = { id: string; title: string; updated_at: number; turns: number };

/** The rooms this client has.
 *
 *  A room is ONE conversation the whole team shares, and it is stored by the
 *  adapter rather than the engine: its turns are answered by different profiles,
 *  each of which persists into its own store, so an engine-side conversation
 *  would end up scattered with no way to reassemble it. Measured 2026-08-17 --
 *  pinning every turn to one `session_id` does not work either, the engine mints
 *  its own per turn. */
export const getRooms = (c: PortalConfig) =>
  get<{ salas: RoomSummary[] }>(c.adapter, "/portal/salas", c);
export const getRoom = (c: PortalConfig, id: string) =>
  get<{ turnos: RoomTurn[] }>(c.adapter, `/portal/salas/${encodeURIComponent(id)}`, c);

/** El cliente pide una capacidad. Queda anotado del lado del agente (una línea
 *  por pedido) y lo miramos nosotros: no prende nada solo. */
export const pedirCapacidad = async (c: PortalConfig, id: string | null, texto: string) => {
  const r = await post<{ ok?: boolean; error?: string; repetido?: boolean }>(
    c.adapter, "/portal/capacidades/pedido", c, { id, texto });
  // El adapter puede contestar 200 con `{ok:false}`: sin este chequeo el portal
  // le dice al cliente "pedida" por algo que no se anotó en ningún lado, que es
  // la peor variante posible de este botón.
  if (r?.ok === false) throw new Error(r.error || "el pedido no quedó registrado");
  return r;
};

export type ArtifactMeta = {
  id: string; title: string; kind: string; summary: string;
  created_at: number; bytes: number;
};
export const getArtifacts = (c: PortalConfig) =>
  get<{ artifacts: ArtifactMeta[] }>(c.adapter, "/portal/artifacts", c);
export const getArtifact = (c: PortalConfig, id: string) =>
  get<ArtifactMeta & { html: string }>(c.adapter, `/portal/artifacts/${encodeURIComponent(id)}`, c);
export const deleteArtifact = (c: PortalConfig, id: string) =>
  del<{ ok: boolean }>(c.adapter, `/portal/artifacts/${encodeURIComponent(id)}`, c);

// ── Escritura en el tablero (el adapter la hace por CLI, nunca por SQL) ──
export const createTicket = (c: PortalConfig, t: { title: string; body?: string; tenant?: string }) =>
  post<{ ok: boolean; id: string | null }>(c.adapter, "/portal/tickets", c, t);
export const commentTicket = (c: PortalConfig, id: string, body: string, author?: string) =>
  post<{ ok: boolean }>(c.adapter, `/portal/tickets/${encodeURIComponent(id)}/comment`, c,
    author ? { body, author } : { body });
export type TicketStatus = "done" | "blocked" | "ready" | "archived";
export const setTicketStatus = (c: PortalConfig, id: string, status: TicketStatus) =>
  post<{ ok: boolean }>(c.adapter, `/portal/tickets/${encodeURIComponent(id)}/status`, c, { status });

/** UN SOLO LUGAR CREA LOS PEDIDOS DE CONEXIÓN. Los armaban Conexiones y el alta
 *  por separado, con cuerpos distintos y con un fetch suelto de un lado.
 *
 *  Y NACEN BLOQUEADOS, que es la parte que importa. `POST /portal/tickets` los
 *  crea `ready` y ya asignados, así que el dispatcher los levanta a los pocos
 *  segundos aunque el cuerpo diga "no hagas nada por tu cuenta": el agente
 *  termina su corrida diciendo que espera algo, el motor lee eso como
 *  `dependency_wait` —que no es un bloqueo pegajoso—, lo devuelve a `ready` y lo
 *  vuelve a levantar. Medido el 13/8 contra un agente del lab: 8 corridas en
 *  t_dd0c0fa1 y 10 en otro, ~US$0,007 cada una, hasta que el modelo por
 *  casualidad usó el bloqueo tipado. Con el ticket bloqueado de entrada
 *  (`hermes kanban block`, que sí emite el evento pegajoso) el worker no lo
 *  toca: verificado t_276ddb2b, cero `claimed` en 4 minutos contra un control
 *  sin bloquear que salió corriendo a los 6 segundos.
 *
 *  Bloquear es además donde el cliente espera verlo: la cola de aprobaciones
 *  son los tickets bloqueados, y ahí sale bajo "Lo que pediste". */
export async function crearPedidoDeConexion(
  c: PortalConfig, pedido: { title: string; cuerpo: string },
) {
  const r = await createTicket(c, {
    title: pedido.title,
    body: `${PREFIJO_PEDIDO} ${MARCA_PEDIDO}\n\n${pedido.cuerpo}`,
  });
  // Si no se pudo bloquear, el pedido igual quedó anotado: lo peor que pasa es
  // que el agente lo levante, que es exactamente lo de antes.
  if (r?.id) await setTicketStatus(c, r.id, "blocked").catch(() => {});
  return r;
}

export type CronRun = {
  id: string; status: string; claimed_at: string;
  started_at: string | null; finished_at: string | null; error: string | null;
};
export type CronDetail = {
  job: {
    id: string; name: string; prompt: string; script: string;
    schedule_display: string; enabled: boolean; state: string; model: string;
    deliver: string; last_status: string | null; last_error: string | null;
    next_run_at: string | null;
  };
  runs: CronRun[];
};
export const getCronDetail = (c: PortalConfig, id: string) =>
  get<CronDetail>(c.adapter, `/portal/crons/${encodeURIComponent(id)}`, c);

// ── Agente (:8642) ──

/** Una tarea programada, tal cual la publica el gateway en `/api/jobs`.
 *
 *  ES LA ÚNICA FUENTE QUE SABE CUÁNDO VA A CORRER Y POR QUÉ FALLÓ. El adapter
 *  publica en `/portal/flujos` un `ultima_corrida` con la fecha y un
 *  `"failed"`, y nada más: ni el próximo horario, ni el error, ni si está
 *  pausada. Flujos junta las dos cosas. */
export type CronJob = {
  id: string;
  name: string;
  enabled: boolean;
  /** "scheduled" | "paused" | "running" | … */
  state?: string | null;
  schedule?: { kind?: string; expr?: string; minutes?: number; run_at?: string; display?: string } | null;
  schedule_display?: string | null;
  next_run_at?: string | null;
  last_run_at?: string | null;
  /** "ok" | "error" | … */
  last_status?: string | null;
  last_error?: string | null;
  paused_at?: string | null;
};

// include_disabled: el listado pelado excluye los jobs pausados.
export const getJobs = (c: PortalConfig) =>
  get<{ jobs: CronJob[] }>(c.endpoint, "/api/jobs?include_disabled=true", c);
/** Pausar, reanudar y correr ahora. SON NATIVOS DEL MOTOR (`POST
 *  /api/jobs/{id}/{pause|resume|run}`) y el gateway los deja pasar por CORS:
 *  no hace falta nada del adapter para que el cliente pueda tocar su flujo.
 *  Cambiar el día y la hora NO entra por acá: es `PATCH /api/jobs/{id}` y el
 *  gateway no publica PATCH en `Access-Control-Allow-Methods` (ver
 *  `docs/PENDIENTES.md`). */
export const jobAction = (c: PortalConfig, id: string, action: "pause" | "resume" | "run") =>
  post<{ job?: CronJob }>(c.endpoint, `/api/jobs/${encodeURIComponent(id)}/${action}`, c);
export const getSessions = (c: PortalConfig) => get<any>(c.endpoint, "/api/sessions", c);
export const getSessionMessages = (c: PortalConfig, id: string) =>
  get<any>(c.endpoint, `/api/sessions/${id}/messages`, c);
export const deleteSession = async (c: PortalConfig, id: string) => {
  const res = await fetch(`${c.endpoint}/api/sessions/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: headers(c),
  });
  if (!res.ok) throw httpError(res.status, "borrar la sesión");
};
export const renameSession = async (c: PortalConfig, id: string, title: string) => {
  const res = await fetch(`${c.endpoint}/api/sessions/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { ...headers(c), "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw httpError(res.status, "renombrar la sesión");
};

export type ChatMessage = { role: "user" | "assistant" | "system"; content: string };

export type RunMessage = { role: string; content: string | null };

export type SessionStreamHandlers = {
  onMessageStart?: () => void;
  /** Delta crudo (NO acumulado, a diferencia de chatStream). */
  onDelta?: (delta: string) => void;
  /** Contenido completo y autoritativo del mensaje que acaba de cerrar. */
  onMessageComplete?: (content: string) => void;
  onToolProgress?: (toolName: string) => void;
  /** OJO: viene la sesión ENTERA (verificado: 327 mensajes), no este turno. */
  onRunComplete?: (messages: RunMessage[]) => void;
};

// Streaming SSE NATIVO de Hermes para continuar una sesión existente.
// Eventos: run.started / message.started / assistant.delta {delta} /
// tool.progress {tool_name} / assistant.completed {content} /
// run.completed {messages} / done. Incompatible con el formato OpenAI de
// chatStream() en request y respuesta (mandar {messages} da 400).
//
// Va por el adapter, NO por el gateway: el gateway responde
// /api/sessions/{id}/chat/stream sin Access-Control-Allow-Origin (solo la
// manda en el preflight), así que el browser descarta la respuesta con
// "Failed to fetch". El sidecar lo proxea agregando CORS.
export async function sessionChatStream(
  cfg: PortalConfig,
  sessionId: string,
  message: string,
  h: SessionStreamHandlers,
  signal?: AbortSignal,
  /** Which member of the team answers. Absent = the agent the client named.
   *  It travels in the body and the client's key never changes: the adapter
   *  holds the per-role credential, because the engine fails a named profile
   *  closed rather than let it inherit the listener's key. */
  role?: string | null,
): Promise<void> {
  const res = await fetch(
    `${cfg.adapter}/portal/sessions/${encodeURIComponent(sessionId)}/chat/stream`,
    {
      method: "POST",
      headers: { ...headers(cfg), "Content-Type": "application/json" },
      body: JSON.stringify(role ? { message, role } : { message }),
      signal,
    },
  );
  if (!res.ok || !res.body) {
    let detail = `${res.status} en chat de sesión`;
    try {
      const err = await res.json();
      if (err?.error?.message) detail = err.error.message;
    } catch { /* sin cuerpo JSON */ }
    throw new Error(detail);
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let event = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      // Igual que en chatStream: la línea en blanco cierra el evento. Acá el
      // gateway nombra todos, pero dejarlo colgado es la misma trampa.
      if (line.trim() === "") { event = ""; continue; }
      if (line.startsWith("event: ")) {
        event = line.slice(7).trim();
        continue;
      }
      if (!line.startsWith("data: ")) continue;
      let data: any;
      try {
        data = JSON.parse(line.slice(6));
      } catch {
        continue; // chunk parcial
      }
      switch (event) {
        case "message.started":
          h.onMessageStart?.();
          break;
        case "assistant.delta":
          if (typeof data.delta === "string" && data.delta) h.onDelta?.(data.delta);
          break;
        // OJO: en el stream de sesión `tool.progress` NO es el aviso de que
        // arranca una herramienta — es el canal del pensamiento
        // (`tool_name: "_thinking"`). El nombre real viene en `tool.started`.
        // Escuchando solo progress, una conversación RETOMADA se quedaba en
        // "Pensando" de punta a punta aunque el agente estuviera navegando y
        // corriendo comandos: 38 herramientas y el cliente viendo un puntito.
        // (En conversación nueva no pasaba: ese camino es el OpenAI, que sí
        // manda `hermes.tool.progress` con el nombre.)
        case "tool.started":
        case "tool.progress":
          if (typeof data.tool_name === "string") h.onToolProgress?.(data.tool_name);
          break;
        case "assistant.completed":
          if (typeof data.content === "string") h.onMessageComplete?.(data.content);
          break;
        case "run.completed":
          if (Array.isArray(data.messages)) h.onRunComplete?.(data.messages);
          break;
        case "done":
          return;
      }
    }
  }
}

// Streaming SSE OpenAI-compatible. onDelta recibe texto incremental.
export async function chatStream(
  cfg: PortalConfig,
  messages: ChatMessage[],
  onDelta: (text: string) => void,
  /** Herramienta que arranca. OJO: acá el evento NO se llama igual que en el
   *  stream de sesión. El gateway manda `event: hermes.tool.progress` con
   *  `{tool, label, status}` (verificado en gateway/platforms/api_server.py),
   *  mientras que el de sesión manda `tool.progress` con `{tool_name}`. Sin
   *  esto, una conversación NUEVA no reporta ninguna herramienta: el rastro
   *  se queda en "Pensando" para siempre y el agentito nunca cambia de gesto.
   *  Los `_internos` (como `_thinking`) el gateway ni los manda por acá. */
  onTool?: (tool: string) => void,
  signal?: AbortSignal,
  /** Which member of the team answers, when the client named someone. */
  role?: string | null,
  /** True when this agent has a team, so the room can route a message nobody
   *  addressed. Without it we would pay the adapter hop on every single-role
   *  agent for a routing decision that has nothing to decide. */
  hasTeam?: boolean,
  /** Who ended up taking the turn. Only the adapter knows when the room routed
   *  it, and it arrives before the first token so the reply is drawn with the
   *  right face from the start. */
  onRole?: (role: string) => void,
  /** Which room to record this turn in. Without it nothing is stored, which is
   *  what the chat did until rooms existed. */
  sala?: string | null,
): Promise<string> {
  // The ADAPTER, not the gateway, whenever a role could be involved: addressing
  // one needs that profile's own key and the browser only ever holds one.
  const url = role || hasTeam
    ? cfg.adapter + "/portal/chat/stream"
    : cfg.endpoint + "/v1/chat/completions";
  const res = await fetch(url, {
    method: "POST",
    headers: { ...headers(cfg), "Content-Type": "application/json" },
    body: JSON.stringify({
      messages,
      stream: true,
      ...(role ? { role } : {}),
      ...(sala ? { sala } : {}),
    }),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`${res.status} en chat`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let acc = "", buf = "", evento = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      // La línea en blanco CIERRA el evento SSE y vuelve el tipo al default.
      // Sin esto, el `event: hermes.tool.progress` de la primera herramienta
      // quedaba pegado para siempre y TODOS los chunks de texto que venían
      // después (que son eventos sin nombre) se descartaban en el `continue`
      // de abajo: en una conversación NUEVA, apenas el agente usaba una
      // herramienta, la respuesta entera desaparecía y el cliente veía
      // silencio. Verificado el 8/8 contra el stream crudo del gateway.
      if (line.trim() === "") { evento = ""; continue; }
      if (line.startsWith("event: ")) { evento = line.slice(7).trim(); continue; }
      if (!line.startsWith("data: ") || line.includes("[DONE]")) continue;
      let payload: any;
      try {
        payload = JSON.parse(line.slice(6));
      } catch { continue; /* chunk parcial */ }
      if (evento === "portal.role") {
        if (typeof payload?.role === "string") onRole?.(payload.role);
        continue;
      }
      if (evento === "hermes.tool.progress") {
        // Solo el arranque: el `completed` que viene después duplicaría.
        if (payload?.status !== "completed" && typeof payload?.tool === "string") {
          onTool?.(payload.tool);
        }
        continue;
      }
      const delta = payload?.choices?.[0]?.delta?.content;
      if (delta) { acc += delta; onDelta(acc); }
    }
  }
  return acc;
}

/** Rótulo de una conexión por su id, para nombrarla donde el cliente la
 *  necesita. Los ids del catálogo (`correo`, `google-workspace`) son nuestros;
 *  el cliente nunca los tiene que leer. Si el catálogo no está a mano, cae a
 *  algo legible en vez de escupir el id. */
export function etiquetaConexion(id: string, conexiones?: Connection[] | null): string {
  const c = conexiones?.find((x) => x.id === id);
  if (c?.label) return c.label;
  const CONOCIDAS: Record<string, string> = {
    correo: "el correo de la empresa",
    telegram: "Telegram",
    whatsapp: "WhatsApp",
    slack: "Slack",
    "google-workspace": "Google Planillas y Drive",
    "gmail-lectura": "Gmail",
    "modelos-auxiliares": "los modelos de IA auxiliares",
  };
  return CONOCIDAS[id] ?? id.replace(/-/g, " ");
}
