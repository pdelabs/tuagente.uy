"use client";

// Rutas del portal — la URL es la memoria del cliente.
//
// POR QUÉ ASÍ Y NO CON SEGMENTOS DE PATH: el portal es estático. En el build,
// TODAS las pestañas salen como `○ (Static)` menos `/app/flujos/[slug]`, que es
// la única `ƒ (Dynamic, server-rendered on demand)`. Un segmento por cada
// detalle (un ticket, un archivo, una conversación) multiplicaría esa excepción
// y ataría el portal a tener servidor. Con parámetros de búsqueda el detalle
// vive en una página que ya está prerenderizada: el mismo HTML sirve para
// `/app/pipeline` y para `/app/pipeline?tarea=t_ab12`, y un link compartido
// funciona igual servido por Vercel que por un directorio de archivos.
//
// EL HASH NO SE TOCA. Ahí llega la credencial del magic link
// (`/app#endpoint=…&adapter=…&key=…`): ninguna URL que armemos acá lo copia, y
// `linkParaCompartir()` lo recorta explícitamente. Por eso tampoco usamos
// hash-routing: chocaría con la única cosa del portal que no se puede romper.
//
// MECÁNICA: `history.pushState` / `replaceState` nativos. Next 14.2 los parchea
// (app-router.js: copyNextJsInternalHistoryState) para copiar su estado interno
// y mantener el router al día, así que empujar desde acá no lo desincroniza.
// El estado de cada pantalla se LEE de la URL —no hay copia local— y por eso
// refrescar restaura exactamente la misma vista.

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { Check, Link2 } from "lucide-react";

/** Los parámetros que abren un detalle. Están todos acá porque son el contrato
 *  que el agente puede citar: ver `docs/rutas-portal.md`. */
export const PARAM = {
  /** /app/chat?conversacion=<id de sesión> */
  conversacion: "conversacion",
  /** /app/pipeline?tarea=<id de ticket> */
  tarea: "tarea",
  /** /app/aprobaciones?pedido=<id de ticket bloqueado> */
  pedido: "pedido",
  /** /app/artefactos?visualizacion=<id de artefacto> */
  visualizacion: "visualizacion",
  /** /app/archivos?carpeta=<ruta> */
  carpeta: "carpeta",
  /** /app/archivos?archivo=<ruta> */
  archivo: "archivo",
  /** /app/habilidades?habilidad=<nombre> */
  habilidad: "habilidad",
  /** /app/conexiones?conexion=<id del catálogo> */
  conexion: "conexion",
  /** /app/tareas?programada=<id de cron> */
  programada: "programada",
} as const;

/** `?p=` (el pedido con el que el chat arranca) también cuenta como llegar con
 *  una intención: no es un detalle, pero tapa la bienvenida igual. */
export const PARAM_PEDIDO_CHAT = "p";

const DETALLES: string[] = [...Object.values(PARAM), PARAM_PEDIDO_CHAT];

/** ¿Esta URL apunta a algo concreto (y no a la portada de una pestaña)?
 *  Lo usa el shell para NO interponer la bienvenida del módulo: quien llega
 *  por un link compartido viene a ver una cosa, no a que le presenten la
 *  pestaña. */
/** Rutas por PATH que también son un detalle. Hoy solo los flujos: un link a
 *  `/app/flujos/reporte-semanal` es tan "vengo a ver esto" como un `?tarea=`,
 *  y si no cuenta, el shell le pone la bienvenida de Flujos adelante. */
const PATHS_DE_DETALLE = [/^\/app\/flujos\/[^/]+$/];

export function urlApuntaADetalle(search?: string, pathname?: string): boolean {
  if (typeof window !== "undefined" || pathname !== undefined) {
    const p = pathname ?? window.location.pathname;
    if (PATHS_DE_DETALLE.some((re) => re.test(p))) return true;
  }
  const s = search ?? (typeof window === "undefined" ? "" : window.location.search);
  if (!s) return false;
  const q = new URLSearchParams(s);
  return DETALLES.some((k) => (q.get(k) ?? "").trim() !== "");
}

/* ── Lectura ─────────────────────────────────────────────────────────────── */

/** Igual que `urlApuntaADetalle`, pero reactivo (el shell lo usa para decidir
 *  si le toca mostrar la bienvenida del módulo). */
export function useApuntaADetalle(pathname?: string): boolean {
  const q = useBusqueda();
  if (pathname && PATHS_DE_DETALLE.some((re) => re.test(pathname))) return true;
  return DETALLES.some((k) => (q.get(k) ?? "").trim() !== "");
}

const EVENTO = "tuagente:ruta";

function suscribir(avisar: () => void) {
  window.addEventListener("popstate", avisar);
  window.addEventListener(EVENTO, avisar);
  return () => {
    window.removeEventListener("popstate", avisar);
    window.removeEventListener(EVENTO, avisar);
  };
}

const leer = () => window.location.search;
// En el prerender no hay URL: la primera pintura es siempre la lista sin
// detalle, y React vuelve a renderizar con el valor real apenas hidrata. Sin
// esto habría desajuste de hidratación en una página estática.
const leerEnServidor = () => "";

/** Avisa a las pantallas que la URL cambió. Necesario cuando el que la cambia
 *  no es ni el usuario (popstate) ni nosotros (por ejemplo, un `<Link>` de Next
 *  hacia la pestaña en la que ya estás). */
export function avisarRuta() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENTO));
}

export function useBusqueda(): URLSearchParams {
  const search = useSyncExternalStore(suscribir, leer, leerEnServidor);
  return useMemo(() => new URLSearchParams(search), [search]);
}

/** El valor de un parámetro de la URL, o null. ESTA es la fuente de verdad de
 *  qué está abierto: nada de `useState` en paralelo. */
export function useParamRuta(nombre: string): string | null {
  const q = useBusqueda();
  const v = q.get(nombre);
  return v && v.trim() !== "" ? v : null;
}

/* ── Escritura ───────────────────────────────────────────────────────────── */

type Cambios = Record<string, string | null>;

// `encodeURIComponent` escapa las barras y deja `entregables%2Finforme.md`.
// Una barra en el valor de un parámetro es legal y hace la diferencia entre una
// URL que el cliente puede leer y una que parece un error.
const enc = (s: string) => encodeURIComponent(s).replace(/%2F/gi, "/");

function armar(search: string, cambios: Cambios): string {
  const q = new URLSearchParams(search);
  for (const [k, v] of Object.entries(cambios)) {
    if (v == null || v === "") q.delete(k);
    else q.set(k, v);
  }
  const partes: string[] = [];
  q.forEach((v, k) => partes.push(`${enc(k)}=${enc(v)}`));
  return partes.length ? `?${partes.join("&")}` : "";
}

/** La URL que queda al aplicar `cambios`, SIN hash (ahí vive la credencial). */
function destino(cambios: Cambios): string {
  return window.location.pathname + armar(window.location.search, cambios);
}

const MARCA = "tuagenteDetalle";

const aqui = () => window.location.pathname + window.location.search;

/** Abrir algo: entrada nueva en el historial, así "atrás" lo cierra. */
export function abrirEnRuta(cambios: Cambios) {
  if (typeof window === "undefined") return;
  const url = destino(cambios);
  if (url === aqui()) return;
  window.history.pushState({ [MARCA]: true }, "", url);
  avisarRuta();
}

/** Cerrar: si la apertura la empujamos nosotros, deshacerla con "atrás" (y que
 *  "adelante" la vuelva a abrir). Si el cliente ATERRIZÓ acá —pegó el link
 *  compartido— no hay nada que deshacer y sacarlo con `back()` lo echaría del
 *  portal: ahí solo se reescribe la URL. */
export function cerrarEnRuta(...nombres: string[]) {
  if (typeof window === "undefined") return;
  const st = window.history.state as Record<string, unknown> | null;
  if (st && typeof st === "object" && st[MARCA]) {
    window.history.back();
    return;
  }
  const cambios: Cambios = {};
  for (const n of nombres) cambios[n] = null;
  window.history.replaceState(null, "", destino(cambios));
  avisarRuta();
}

/** Volver a la portada de la pestaña en la que ya estás: se usa cuando el
 *  cliente toca en el menú el módulo que está mirando. */
export function volverAlaPestania() {
  const cambios: Cambios = {};
  for (const n of DETALLES) cambios[n] = null;
  abrirEnRuta(cambios);
}

/** Cambiar sin ensuciar el historial (filtros, carpeta actual, limpiezas). */
export function reemplazarEnRuta(cambios: Cambios) {
  if (typeof window === "undefined") return;
  const url = destino(cambios);
  if (url === aqui()) return;
  window.history.replaceState(null, "", url);
  avisarRuta();
}

/* ── Traer a la vista lo que vino por link ───────────────────────────────── */

/** Deja a la vista la cosa que el link vino a mostrar.
 *
 *  DOS COSAS QUE PARECEN DETALLE Y SON EL BUG ENTERO:
 *
 *  1. `behavior: "smooth"` NO LLEGA. Medido en el lab con
 *     `/app/habilidades?habilidad=aprobacion`: la fila resaltada quedaba a
 *     823 px con una ventana de 813, o sea justo abajo del pliegue, y
 *     `scrollY` se quedaba en 0. Con `"instant"`, el mismo elemento y el mismo
 *     `scrollIntoView` mueven la página a 442. El scroll suave se traga la
 *     animación cuando arriba hay un contenedor con `overflow-hidden` (la
 *     tarjeta que agrupa las habilidades del sistema) y cuando la página
 *     todavía se está acomodando. Y aterrizar en un link no tiene por qué ser
 *     una animación: el cliente viene a ver una cosa, tiene que estar ahí.
 *  2. UN `setTimeout` FIJO DE 150 ms ES UNA APUESTA. El elemento aparece cuando
 *     contesta el adapter, que contra el agente de un cliente por internet
 *     tarda más que contra el lab; a los 150 ms puede no existir todavía y el
 *     efecto se perdía en silencio. Acá se espera hasta que esté, con tope.
 *
 *  Y se espera con `setTimeout`, NO con `requestAnimationFrame`: en una pestaña
 *  de fondo el navegador no dibuja cuadros, así que un poll con rAF no corre ni
 *  una vez — medido: `document.hidden` en true y `scrollY` en 0 para siempre.
 *  Un link que el cliente abre en una pestaña nueva es el caso normal, no el
 *  raro. Los timers ahí van a ~1 por segundo, que para esto alcanza.
 *
 *  Devuelve la función para cancelar (va tal cual en el `return` del efecto).
 *  `marca` es una clase marcadora porque `Card` y `li` no toman ref. */
export function traerALaVista(marca: string, intentosMax = 60): () => void {
  if (typeof window === "undefined") return () => {};
  let cancelado = false;
  let intentos = 0;
  const pendientes: number[] = [];
  // LO QUE NO ENTRA EN LA PANTALLA NO SE CENTRA: SE ALINEA ARRIBA. Centrar una
  // cosa más alta que la ventana le corta la cabeza, y la cabeza es lo que hay
  // que leer — el título, el estado, el aviso. Medido con
  // `/app/aprobaciones?pedido=<id>`: la tarjeta del pedido mide 1208 px con una
  // ventana de 806, y `block: "center"` la dejaba arrancando en **-201**, o sea
  // con el "Le dijiste que no a esto" arriba del borde. Lo que entra se sigue
  // centrando, que se lee mejor que pegado al borde.
  const noEntra = (r: DOMRect) => r.height > window.innerHeight * 0.9;
  const acomodar = (el: Element) =>
    el.scrollIntoView({
      block: noEntra(el.getBoundingClientRect()) ? "start" : "center",
      behavior: "instant",
    });
  const enVista = (el: Element) => {
    const r = el.getBoundingClientRect();
    // De lo alto alcanza con que se vea el principio: exigirle que entre entero
    // sería pedir lo imposible y re-scrollear para siempre.
    if (noEntra(r)) return r.top >= 0 && r.top < window.innerHeight / 2;
    return r.top >= 0 && r.bottom <= window.innerHeight;
  };
  const paso = () => {
    if (cancelado) return;
    const el = document.querySelector(marca);
    if (!el) {
      if (++intentos < intentosMax) pendientes.push(window.setTimeout(paso, 40));
      return;
    }
    acomodar(el);
    // Una sola confirmación: lo de al lado puede seguir creciendo un instante
    // (markdown, tablas) y correr de lugar lo que acabamos de centrar.
    pendientes.push(window.setTimeout(() => {
      if (cancelado) return;
      const otra = document.querySelector(marca);
      if (otra && !enVista(otra)) acomodar(otra);
    }, 250));
  };
  paso();
  return () => {
    cancelado = true;
    pendientes.forEach(clearTimeout);
  };
}

/* ── Links canónicos ─────────────────────────────────────────────────────── */

/** El link de una cosa concreta, tal como se comparte y tal como el agente lo
 *  cita. Absoluto y sin hash. */
export function urlDe(path: string, cambios: Cambios = {}): string {
  const search = armar("", cambios);
  const base = typeof window === "undefined" ? "" : window.location.origin;
  return `${base}${path}${search}`;
}

/** El link de lo que el cliente está mirando ahora. NUNCA el hash: si el
 *  cliente entró recién por el magic link, ahí está su clave. */
export function linkParaCompartir(): string {
  return `${window.location.origin}${window.location.pathname}${window.location.search}`;
}

/** Saca la credencial del magic link de la barra de direcciones.
 *
 *  Llega en el hash y se queda ahí para siempre: el cliente que copia la URL
 *  para pasarle a alguien de su equipo le está pasando también su clave. Ya
 *  está guardada en localStorage cuando esto corre, así que borrarla no le
 *  saca nada. Va con `replaceState` para no dejar la entrada con la clave en
 *  el historial. */
export function limpiarCredencialDeLaURL() {
  if (typeof window === "undefined") return;
  const h = window.location.hash.replace(/^#/, "");
  if (!h) return;
  const resto = h.split("&").filter((p) => !/^(endpoint|adapter|key)=/i.test(p)).join("&");
  if (resto === h) return;
  window.history.replaceState(
    null, "", window.location.pathname + window.location.search + (resto ? `#${resto}` : ""));
}

/* ── Copiar el link ──────────────────────────────────────────────────────── */

/** Botón discreto para llevarse un link. Del kit: sin sombras, ícono lucide,
 *  mismo tamaño que el resto de los IconBtn. La URL se calcula al tocarlo (en
 *  el render no hay `window`).
 *
 *  `navigator.clipboard` no existe fuera de un contexto seguro (http a secas):
 *  ahí cae al prompt del navegador, que es feo pero deja copiar igual. Un botón
 *  que no hace nada es peor. */
export function CopiarUrl({ obtener, titulo }: { obtener: () => string; titulo: string }) {
  const [listo, setListo] = useState(false);
  const copiar = useCallback(() => {
    const url = obtener();
    const ok = () => { setListo(true); setTimeout(() => setListo(false), 1800); };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).then(ok).catch(() => window.prompt("Copiá el link:", url));
      return;
    }
    window.prompt("Copiá el link:", url);
  }, [obtener]);
  return (
    <button
      aria-label={listo ? "Link copiado" : titulo}
      title={listo ? "Link copiado" : titulo}
      onClick={copiar}
      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-ink-soft transition hover:bg-black/[0.05] hover:text-ink"
    >
      {listo ? <Check className="h-4 w-4 text-c-green-ink" /> : <Link2 className="h-4 w-4" />}
    </button>
  );
}

/** El link de lo que el cliente está mirando ahora mismo. */
export function CopiarLink({ titulo = "Copiar el link de esto" }: { titulo?: string }) {
  return <CopiarUrl obtener={linkParaCompartir} titulo={titulo} />;
}
