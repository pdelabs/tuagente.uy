"use client";

// ALTA DE EQUIPO: la primera pantalla de un cliente cuyo agente tiene equipo.
//
// En un agente de UNO, el alta es el bautizo: el cliente le pone nombre y cara
// a lo que ya está prendido (`lib/onboarding.tsx`, intacto). En un agente con
// EQUIPO no hay a quién bautizar todavía: el cliente contrata roles, y hasta
// que no contrate el primero el portal no tiene a nadie que mostrar. Entrar y
// que te pidan bautizar "tu agente" ahí es prometer un empleado que nadie
// eligió.
//
// Así que la primera pantalla es la contratación: elegís UN rol de la oferta,
// lo bautizás igual que se bautizaba al agente —mismo dado, misma cara, mismo
// campo de nombre— y queda pedido. Uno solo y no varios: el primero es el que
// define si esto sirve, y elegir cinco de una es elegir mal cuatro.
//
// CON UNA EXCEPCIÓN, Y ES EL ROL QUE NO VIENE ESCRITO. Los roles de oficio se
// eligen por lo que hacen, así que elegirlos ya lo dice todo. El asistente se
// compone de capacidades: entre elegirlo y bautizarlo hay una pregunta más
// —qué necesitás que haga—, el agente marca del catálogo lo que se le parece y
// el cliente corrige. Lo que quede marcado viaja con el pedido; instalarlo
// sigue siendo trabajo nuestro, igual que el rol.
//
// LO QUE PASA DESPUÉS NO LO HACE EL PORTAL. Instalar un rol es meterle un
// perfil al agente del cliente: su SOUL, sus skills, sus permisos, y reiniciar
// el gateway. Lo hacemos nosotros a mano. Por eso el último paso es una espera
// honesta —sin barra de progreso ni porcentaje inventado— que se resuelve sola
// cuando el rol aparece contratado en el roster.
//
// Y CUANDO EL ROL LLEGA, EL ALTA TODAVÍA NO TERMINÓ. Elegir y bautizar no
// contesta las dos preguntas que el alta de un agente solo hace igual: de qué
// es el negocio (lo que dispara el brief) y por dónde avisarle. Esas dos las
// pregunta `Onboarding` recortado, ya sin bautizo — lo arma `layout.tsx` con el
// estado `contratado` de este mismo hook.

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ArrowRight, ChevronLeft, Dices, Workflow } from "lucide-react";
import {
  crearPedidoDeRol, crearSugerenciaDeCapacidades, getRoles,
  type Capacidad, type HttpError, type Manifest, type PedidoDeRol,
  type PortalConfig, type Role,
} from "./agent";
import {
  AgentitoAvatar, AgentitoCargando, LOOK_DEFAULT, type AgentitoLook,
} from "./agentito";
import { catalogoDeCapacidades, porGrupo } from "./capacidades";
import { sortearLook } from "./onboarding";
import { rotuloCanal } from "./palabras";
import { Btn, Card, Chip, inputCls, Soporte, Spinner } from "./ui";

// El runtime de Rive solo se trae acá, igual que en el onboarding: el resto del
// portal no paga los ~330 KB. Mientras carga, la misma cara estática.
const AgentitoRive = dynamic(() => import("./AgentitoRive"), {
  ssr: false,
  loading: () => <AgentitoCargando />,
});

// Cada cuánto se mira si el rol ya está. Es la espera de alguien que sabe que
// esto lo hace una persona del otro lado: mirar cada dos segundos no lo trae
// antes, y el portal no tiene nada más que hacer mientras tanto. Mismo orden
// de magnitud que el refresco de las otras pestañas (60 s), un poco más corto
// porque acá el cliente está mirando la pantalla.
const ESPERA_MS = 30_000;

/** El look de un rol, completado con el default: el catálogo puede traer solo
 *  algunos ejes. Es el mismo `faceOf` que usan Equipo y los chips. */
function pintaDe(look: Record<string, number> | null | undefined): AgentitoLook {
  return { ...LOOK_DEFAULT, ...(look ?? {}) } as AgentitoLook;
}

/** ¿Este rol ya trabaja para el cliente? `contratado` es el campo del alta;
 *  `hired` es el mismo hecho con el nombre viejo del roster. */
export const yaEsta = (r: Role) => Boolean(r.contratado ?? r.hired);

/** EL PEDIDO QUE EL AGENTE TIENE ANOTADO, que es el único que se muestra: lo
 *  que la pantalla de espera dice —el nombre, la cara— sale de acá y no de lo
 *  que este browser recuerda haber tipeado.
 *
 *  Si hay más de uno (dos pestañas, dos roles pedidos), gana EL MÁS VIEJO: es
 *  el que el cliente dejó primero y el que vamos a instalar primero. Un pedido
 *  sin fecha queda último — no se lo puede ordenar y no puede ganarle a uno que
 *  sí sabe cuándo se hizo. */
function pedidoPendiente(roles: Role[]): Role | null {
  const cuando = (r: Role) => r.pedido?.pedido_en || "9999";
  const pendientes = roles.filter((r) => r.pedido && !yaEsta(r));
  if (pendientes.length === 0) return null;
  return pendientes.slice().sort((a, b) => cuando(a).localeCompare(cuando(b)))[0];
}

/** El error, en el idioma del cliente. Mismo criterio que en las otras
 *  pestañas: "Failed to fetch" es lo que el browser dice cuando el agente no
 *  contesta, y mostrárselo tal cual es mostrarle nuestra consola. */
function describirError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes("Failed to fetch") || msg.includes("NetworkError"))
    return "No hay conexión con tu agente. Probá de nuevo en un rato.";
  return msg || "No pude dejar el pedido. Probá de nuevo.";
}

/** Los flujos vienen por slug (`resumen-diario`), que es el nombre de máquina.
 *  Se le sacan los guiones y nada más: lo que dice sigue siendo lo que declara
 *  el catálogo, no una descripción que nos inventemos acá. */
function rotuloDeFlujo(slug: string): string {
  const t = slug.replace(/[-_]+/g, " ").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/* ── Qué le toca ver a este cliente ──────────────────────────────────────── */

export type EstadoAlta =
  | "cargando"     // agente con equipo: todavía no sabemos si contrató a alguien
  | "no-aplica"    // agente de uno, o el roster no contestó
  | "alta"         // equipo sin nadie contratado ni pedido: a elegir el primero
  | "en-camino"    // ya pidió uno y lo estamos preparando
  | "contratado";  // ya tiene a alguien: sigue lo que el alta de equipo no pregunta

/** La precedencia del alta, en un solo lugar.
 *
 *  El roster es la fuente: el browser no sabe si el cliente contrató a alguien
 *  (puede haberlo hecho desde otra máquina, y cambiar de agente borra todo lo
 *  local).
 *
 *  SI EL ROSTER NO CONTESTA, EL ALTA NO APARECE — y eso es a propósito. Un
 *  cliente que ya contrató entra a su portal normal, que es lo único que le
 *  importa. Un cliente de equipo que todavía no contrató a nadie entra al
 *  portal sin el alta: no ve la pantalla de contratación, pero tampoco se le
 *  pone adelante el bautizo de un agente solo (`layout.tsx` mira `modules.roles`
 *  para eso) y la pestaña Equipo le muestra su propio error con su botón de
 *  reintentar. O sea: el precio de un roster caído es una pantalla que no
 *  aparece, nunca una pantalla equivocada. Por eso acá no hay reintentos. */
export function useAltaDeEquipo(manifest: Manifest | null, cfg: PortalConfig | null) {
  const esEquipo = Boolean(manifest?.modules?.roles);
  const [roles, setRoles] = useState<Role[] | null>(null);
  const [sinRoster, setSinRoster] = useState(false);
  const [contratado, setContratado] = useState(false);

  useEffect(() => {
    if (!esEquipo || !cfg) return;
    let vivo = true;
    getRoles(cfg)
      .then((r) => {
        if (!vivo) return;
        if (r?.available === false) { setSinRoster(true); return; }
        setRoles(r?.roles ?? []);
      })
      .catch(() => { if (vivo) setSinRoster(true); });
    return () => { vivo = false; };
  }, [esEquipo, cfg]);

  const lista = roles ?? [];
  const estado: EstadoAlta = !esEquipo || sinRoster
    ? "no-aplica"
    : contratado
      ? "contratado"
      : roles === null
        ? "cargando"
        : lista.some(yaEsta)
          ? "contratado"
          : pedidoPendiente(lista)
            ? "en-camino"
            : "alta";

  // Con quién le habla el portal apenas contrató: el compañero que acaba de
  // entrar, con el nombre y la cara que el cliente le puso. Es quien hace las
  // preguntas que faltan.
  const primero = lista.find(yaEsta) ?? null;
  const equipo = primero
    ? { nombre: primero.name || primero.label, look: pintaDe(primero.look) }
    : null;

  return {
    estado,
    roles: lista,
    equipo,
    /** El rol llegó: se pasa el roster fresco porque el que tiene este hook es
     *  el de la primera carga, de cuando todavía no había nadie contratado. */
    marcarContratado: (frescos?: Role[]) => {
      if (frescos) setRoles(frescos);
      setContratado(true);
    },
  };
}

/* ── Las pantallas ───────────────────────────────────────────────────────── */

function TarjetaDeRol({ role, onElegir }: { role: Role; onElegir: () => void }) {
  return (
    // El botón va AFUERA de la Card, igual que en Equipo: `Card` es
    // presentacional y la usa medio portal.
    <button onClick={onElegir} className="block w-full text-left">
      <Card className="flex gap-4 p-4 transition hover:border-primary/40">
        <AgentitoAvatar look={pintaDe(role.look)} className="h-14 w-14 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold text-ink">{role.name || role.label}</p>
          <p className="mt-1.5 text-[14px] leading-snug text-ink-soft">{role.does}</p>
          {!!role.flows?.length && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Workflow className="h-3.5 w-3.5 shrink-0 text-ink-soft" />
              {role.flows.map((slug) => (
                <Chip key={slug}>{rotuloDeFlujo(slug)}</Chip>
              ))}
            </div>
          )}
          {role.never && (
            // El límite duro es parte de la oferta y no letra chica: es la
            // misma frase que vive en el SOUL del rol.
            <p className="mt-2 text-[13px] text-ink-soft">
              <span className="font-medium text-ink">Nunca:</span> {role.never}
            </p>
          )}
          {!!role.needs?.length && (
            // LO QUE LE FALTA, ANTES DE ELEGIRLO. En Equipo esto se lee de
            // paso; acá es la decisión: contratar al que necesita el WhatsApp
            // que todavía no tenemos conectado es empezar a esperar dos cosas.
            // Los ids viajan crudos (`whatsapp`) y el portal tiene un solo
            // diccionario que los vuelve nombres — el mismo de Equipo,
            // Actividad y Conexiones.
            <p className="mt-2 text-[13px] text-ink-soft">
              Necesita {role.needs.map(rotuloCanal).join(", ")} para empezar.
            </p>
          )}
        </div>
      </Card>
    </button>
  );
}

/* ── El rol que se arma con lo que el cliente necesita ───────────────────── */

/** EL ÚNICO ROL QUE NO VIENE ESCRITO. Los otros se venden por lo que hacen
 *  —contestar, vender, facturar— y el cliente los elige por eso. Este se compone
 *  de capacidades, así que antes de bautizarlo hay que saber para qué lo quiere:
 *  sin esa pregunta, lo que llega es "un asistente" y nadie sabe qué ponerle.
 *
 *  El id es del catálogo de roles del agente, no una categoría que el portal se
 *  invente: si ese rol no está en la oferta, este paso no existe para nadie. */
const ROL_A_MEDIDA = "asistente";
export const seArmaAMedida = (r: Role) => r.id === ROL_A_MEDIDA;

/** Lo que el cliente contó y lo que le quedó marcado.
 *
 *  Vive AFUERA de la pantalla —lo tiene el alta— para que volver desde el
 *  bautizo no le borre lo que escribió ni gaste otra pregunta al modelo.
 *  `marcadas: null` es "todavía no preguntamos"; una lista, aunque esté vacía,
 *  es "ya eligió". */
export type LoQueNecesita = {
  texto: string;
  marcadas: string[] | null;
  /** No se pudo preguntar: el agente no tiene con qué llamar al modelo. Viaja
   *  con el resto porque son dos frases distintas y la pantalla las dice
   *  distinto — "no pudimos leer lo que escribiste" no es "preguntamos y no
   *  había nada de esto en la lista". */
  sinMatching?: boolean;
};
export const SIN_CONTAR: LoQueNecesita = { texto: "", marcadas: null };

/** Cuánto texto hace falta para que preguntar valga la pena: el mismo mínimo
 *  que valida el adapter. Con "turnos" el modelo contesta cualquier cosa, y una
 *  sugerencia inventada es peor que no sugerir. */
const MIN_TEXTO = 10;

/** "¿Qué necesitás que haga?" — el paso que convierte una frase del cliente en
 *  capacidades del catálogo.
 *
 *  DOS PANTALLAS Y UNA SOLA PREGUNTA AL MODELO: primero cuenta con sus palabras,
 *  y con eso el agente marca lo que se le parece del menú. Lo marcado es
 *  editable siempre — esto sugiere, no decide, y el cliente es el que sabe de
 *  qué vive.
 *
 *  LO QUE QUEDA MARCADO NO PRENDE NADA. Viaja con el pedido para que quien lo
 *  contrata sepa qué ponerle; instalarlo es trabajo nuestro, igual que el rol.
 *  Se dice en la pantalla, no acá: prometer que se prende solo es la clase de
 *  cosa que el cliente descubre el lunes. */
export function QueNecesita({ cfg, valor, onCambio, onListo, onVolver, volverLabel }: {
  cfg: PortalConfig;
  valor: LoQueNecesita;
  onCambio: (v: LoQueNecesita) => void;
  onListo: () => void;
  onVolver?: () => void;
  volverLabel?: string;
}) {
  const [menu, setMenu] = useState<Capacidad[] | null>(null);
  const [pensando, setPensando] = useState(false);

  const alListo = useRef(onListo);
  useEffect(() => { alListo.current = onListo; });

  useEffect(() => {
    let vivo = true;
    // El catálogo lo cachea `lib/capacidades` por pestaña: volver del bautizo
    // no lo vuelve a pedir.
    catalogoDeCapacidades().then((cs) => {
      if (!vivo) return;
      // `base` no se elige: viene puesta en todos los agentes. Es la misma
      // regla que la ficha de un compañero, y el adapter la aplica de su lado.
      const delMenu = cs.filter((c) => c.nivel !== "base");
      // Sin catálogo no hay nada que preguntar, y una pregunta sin respuestas
      // posibles es una pantalla trabada: el alta sigue derecho al bautizo.
      if (delMenu.length === 0) { alListo.current(); return; }
      setMenu(delMenu);
    });
    return () => { vivo = false; };
  }, []);

  const limpio = valor.texto.replace(/\s+/g, " ").trim();
  const preguntar = async () => {
    if (limpio.length < MIN_TEXTO || pensando) return;
    setPensando(true);
    // UN ERROR ACÁ NO PUEDE CORTAR EL ALTA. La sugerencia es una ayuda: si el
    // agente no puede preguntarle al modelo, o no contesta, el cliente elige de
    // la lista entera — que es lo que iba a poder hacer igual.
    const r = await crearSugerenciaDeCapacidades(cfg, limpio).catch(() => null);
    onCambio({
      texto: limpio,
      marcadas: r?.sugeridas ?? [],
      sinMatching: !r || r.sin_matching === true,
    });
    setPensando(false);
  };

  const marcar = (id: string) => {
    const marcadas = valor.marcadas ?? [];
    onCambio({
      ...valor,
      marcadas: marcadas.includes(id)
        ? marcadas.filter((x) => x !== id)
        : [...marcadas, id],
    });
  };

  /* Primera pantalla — que lo cuente con sus palabras. */
  if (valor.marcadas === null) {
    return (
      <div className="flex w-full max-w-2xl flex-col items-center text-center">
        <div className="mb-7 animate-fadeup">
          <h1 className="text-[30px] font-extrabold leading-tight tracking-tight text-ink sm:text-[38px]">
            ¿Qué necesitás que haga?
          </h1>
          <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-ink-soft">
            Contalo como se lo contarías a alguien que entra a trabajar el lunes.
            Con eso te marcamos lo que sabemos hacer, y vos sacás y agregás.
          </p>
        </div>

        <textarea
          autoFocus
          rows={6}
          maxLength={600}
          value={valor.texto}
          onChange={(e) => onCambio({ ...valor, texto: e.target.value })}
          aria-label="Qué necesitás que haga"
          placeholder={"Por ejemplo:\n\nQue me arme los presupuestos y me lleve la agenda de los turnos.\n\nQue cargue las facturas de los proveedores en una planilla y me avise lo que vence.\n\nQue conteste las preguntas de siempre y me pase lo que no sabe."}
          className={`${inputCls} min-h-[11rem] resize-none text-left text-[15px] leading-relaxed`}
        />

        <div className="mt-7 flex flex-col items-center gap-3">
          <Btn disabled={limpio.length < MIN_TEXTO || pensando} onClick={preguntar}>
            {pensando ? "Leyendo lo que escribiste…" : "Seguir"}
            {!pensando && <ArrowRight className="h-4 w-4" />}
          </Btn>
          {onVolver && (
            <button
              onClick={onVolver}
              className="inline-flex items-center gap-1 text-[13px] font-semibold text-ink-soft underline-offset-4 transition hover:text-ink hover:underline"
            >
              <ChevronLeft className="h-3.5 w-3.5" /> {volverLabel ?? "Volver"}
            </button>
          )}
        </div>
      </div>
    );
  }

  /* Segunda pantalla — el menú, con lo que entendimos marcado. */
  if (!menu) {
    return <Spinner />;
  }

  const marcadas = valor.marcadas;
  const aviso = valor.sinMatching
    ? "No pudimos leer lo que escribiste, así que no marcamos nada: elegilo vos de la lista."
    : marcadas.length === 0
      ? "No encontramos nada de esta lista que sea lo que pediste. Mirala igual, y si lo que necesitás no está, escribinos."
      : "Esto es lo que entendimos. Sacá lo que no va y sumá lo que falte: lo decidís vos.";

  return (
    <div className="flex w-full max-w-2xl flex-col">
      <div className="animate-fadeup text-center">
        <h1 className="text-[30px] font-extrabold leading-tight tracking-tight text-ink sm:text-[38px]">
          Lo que va a hacer
        </h1>
        <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-ink-soft">
          {aviso}
        </p>
      </div>

      {/* LA VERDAD DEL MODELO CURADO, ANTES DE LA LISTA Y NO EN LETRA CHICA:
          marcar no prende. Cada una la ponemos nosotros, y el cliente tiene que
          saberlo antes de elegir diez. */}
      <p className="mx-auto mt-4 max-w-md text-center text-[13px] leading-snug text-ink-soft">
        Marcar no lo prende: queda anotado con el pedido y lo preparamos nosotros
        junto con el resto.
      </p>

      <div className="mt-6 flex flex-col gap-4">
        {porGrupo(menu).map(({ grupo, rotulo, capacidades }) => (
          <div key={grupo}>
            <h3 className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
              {rotulo}
            </h3>
            <div className="flex flex-col gap-2">
              {capacidades.map((c) => (
                <label
                  key={c.id}
                  className={`flex cursor-pointer items-start gap-2.5 rounded-xl border bg-white p-3.5 text-left transition ${
                    marcadas.includes(c.id)
                      ? "border-primary/40 bg-primary/[0.03]"
                      : "border-black/[0.07] hover:border-primary/30"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={marcadas.includes(c.id)}
                    onChange={() => marcar(c.id)}
                    className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-primary"
                  />
                  <span className="min-w-0">
                    <span className="block text-[14px] font-medium text-ink">{c.label}</span>
                    {c.para_que && (
                      <span className="mt-0.5 block text-[13px] leading-snug text-ink-soft">
                        {c.para_que}
                      </span>
                    )}
                  </span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-8 flex flex-col items-center gap-3">
        <Btn onClick={onListo}>
          {marcadas.length === 0
            ? "Seguir sin marcar nada"
            : `Seguir con ${marcadas.length} ${marcadas.length === 1 ? "elegida" : "elegidas"}`}
          <ArrowRight className="h-4 w-4" />
        </Btn>
        <button
          onClick={() => onCambio({ ...valor, marcadas: null })}
          className="inline-flex items-center gap-1 text-[13px] font-semibold text-ink-soft underline-offset-4 transition hover:text-ink hover:underline"
        >
          <ChevronLeft className="h-3.5 w-3.5" /> Contarlo de nuevo
        </button>
      </div>
    </div>
  );
}

/* ── El bautizo de un rol ────────────────────────────────────────────────── */

/** En qué terminó el bautizo. Son los dos finales posibles y ninguno es un
 *  error del cliente: o el agente tiene el pedido anotado —el que se acaba de
 *  crear, o el que ya tenía—, o el rol ya está trabajando y no hay nada que
 *  esperar. */
export type AltaDelRol =
  | {
      tipo: "pedido";
      /** El rol del pedido que quedó, que NO siempre es el que se bautizó: en
       *  un 409 puede ganar otro que el cliente había pedido antes. */
      role: Role;
      pedido: PedidoDeRol | null;
      /** Nombre y pinta ya reconciliados con lo que contestó el agente. */
      nombre: string;
      look: AgentitoLook;
    }
  | { tipo: "contratado"; roles: Role[] };

/** Lo que se muestra sale de la respuesta, no de lo tipeado: el adapter le pasa
 *  el nombre por el mismo saneado que el bautizo del agente (va a parar a un
 *  bloque del SOUL), así que puede volver recortado. Si el pedido no trae
 *  nombre o pinta, queda lo que el cliente eligió. */
function loQueAnotoElAgente(
  role: Role, pedido: PedidoDeRol | null | undefined, nombre: string, look: AgentitoLook,
): AltaDelRol {
  return {
    tipo: "pedido",
    role,
    pedido: pedido ?? null,
    nombre: pedido?.nombre || nombre,
    look: pedido?.pinta ? pintaDe(pedido.pinta) : look,
  };
}

/** EL BAUTIZO DE UN ROL, UNA SOLA VEZ EN EL PORTAL. Lo usan los dos momentos en
 *  que un cliente suma a alguien: el alta (su primer compañero, a pantalla
 *  completa) y la pestaña Equipo (todos los que sume después). Es la misma
 *  pantalla porque es el mismo momento —elegís cómo se va a llamar y qué cara
 *  tiene lo que estás sumando—, y tenerla dos veces era garantizar que un día
 *  digan cosas distintas.
 *
 *  Se hace cargo del pedido entero, incluido el 409: quien la usa sólo recibe
 *  en qué terminó (`AltaDelRol`) y decide qué hacer con eso. El dado cambia SU
 *  pinta, no la página, y el nombre es lo único que hay que decidir. */
export function BautizoDeRol({ cfg, role, capacidades, onListo, onVolver, volverLabel }: {
  cfg: PortalConfig;
  role: Role;
  /** Lo que el cliente marcó en `QueNecesita`, cuando el rol lo pregunta. Viaja
   *  con el pedido y nada más: quien no pasa nada (la pestaña Equipo) pide
   *  exactamente lo que pedía antes. */
  capacidades?: string[];
  onListo: (r: AltaDelRol) => void;
  /** Sin esto no se dibuja la salida de abajo: en Equipo el volver ya está
   *  arriba, y dos "atrás" en la misma pantalla es uno de más. */
  onVolver?: () => void;
  volverLabel?: string;
}) {
  // El catálogo ya trae un nombre y una cara: el bautizo empieza con los suyos
  // puestos, y cambiarlos es opcional. Una pantalla en blanco convierte "elegí
  // un rol" en "inventá un personaje".
  const [nombre, setNombre] = useState(role.name || role.label);
  const [look, setLook] = useState<AgentitoLook>(() => pintaDe(role.look));
  const [pidiendo, setPidiendo] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const pedir = async () => {
    const limpio = nombre.trim();
    if (!limpio || pidiendo) return;
    setPidiendo(true);
    setErr(null);
    try {
      const d = await crearPedidoDeRol(cfg, role.id, limpio, look, capacidades);
      onListo(loQueAnotoElAgente(role, d?.pedido, limpio, look));
    } catch (e) {
      const h = e as HttpError;
      // 409 son dos cosas y ninguna es un error del cliente: o ya lo había
      // pedido (dos pestañas, o volvió a entrar), o se lo instalamos mientras
      // lo bautizaba. La diferencia la contesta el roster, no el texto.
      if (h?.status === 409) {
        const r = await getRoles(cfg).catch(() => null);
        const frescos = r?.roles ?? [];
        if (frescos.some(yaEsta)) { onListo({ tipo: "contratado", roles: frescos }); return; }
        // El pedido que ya existía manda: puede ser este rol pedido en otra
        // pestaña, o directamente otro rol. Se devuelve el que el agente tiene
        // anotado, no el que este browser acaba de intentar.
        const p = pedidoPendiente(frescos);
        onListo(p
          ? loQueAnotoElAgente(p, p.pedido, limpio, look)
          : loQueAnotoElAgente(role, null, limpio, look));
        return;
      }
      setErr(describirError(e));
    } finally {
      setPidiendo(false);
    }
  };

  return (
    <div className="flex w-full max-w-2xl flex-col items-center text-center">
      <div className="mb-8 animate-fadeup">
        <h1 className="text-[30px] font-extrabold leading-tight tracking-tight text-ink sm:text-[38px]">
          Ponele nombre
        </h1>
        <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-ink-soft">
          Así lo vas a ver acá adentro: al lado de cada cosa que haga, y
          cuando te conteste en el chat.
        </p>
      </div>

      <div className="relative h-40 w-40">
        {/* Sin festejo: el bautizo del agente lo dispara y se queda a verlo,
            pero acá la pantalla siguiente es la espera y el personaje se
            desmonta en el mismo tick. Un contador que nadie mira es una
            promesa de animación que no pasa. */}
        <AgentitoRive festejos={0} look={look} estado="normal" className="h-full w-full" />
        <button
          onClick={() => setLook(sortearLook(look))}
          title="Otro look"
          aria-label="Otro look"
          className="absolute -bottom-1 -right-1 flex h-10 w-10 items-center justify-center rounded-full border border-black/10 bg-white transition hover:scale-105 hover:bg-black/[0.03] active:scale-95"
        >
          <Dices className="h-[18px] w-[18px] text-ink" />
        </button>
      </div>

      <input
        autoFocus
        value={nombre}
        maxLength={24}
        onChange={(e) => { setNombre(e.target.value); setErr(null); }}
        onKeyDown={(e) => { if (e.key === "Enter") pedir(); }}
        placeholder={role.label}
        aria-label={`Nombre para tu ${role.label}`}
        className="mt-7 w-[8em] max-w-[80vw] border-b-[3px] border-black/15 bg-transparent text-center text-[32px] font-extrabold tracking-tight text-primary outline-none transition placeholder:font-extrabold placeholder:text-ink-soft/35 focus:border-primary sm:text-[38px]"
      />
      {/* El puesto queda a la vista aunque le cambie el nombre: "Vera" sola no
          dice qué hace Vera. */}
      <p className="mt-3 text-[14px] font-medium text-ink-soft">{role.label}</p>
      <p className="mx-auto mt-1.5 max-w-md text-[13px] leading-relaxed text-ink-soft">
        {role.does}
      </p>

      {err && <p className="mt-4 text-[13px] text-c-coral-ink">{err}</p>}

      <div className="mt-8 flex flex-col items-center gap-3">
        <Btn disabled={!nombre.trim() || pidiendo} onClick={pedir}>
          {pidiendo ? "Pidiéndolo…" : "Sumarlo a mi equipo"}
          {!pidiendo && <ArrowRight className="h-4 w-4" />}
        </Btn>
        {onVolver && (
          <button
            onClick={() => { setErr(null); onVolver(); }}
            className="inline-flex items-center gap-1 text-[13px] font-semibold text-ink-soft underline-offset-4 transition hover:text-ink hover:underline"
          >
            <ChevronLeft className="h-3.5 w-3.5" /> {volverLabel ?? "Volver"}
          </button>
        )}
      </div>
    </div>
  );
}

/* ── Las pantallas del alta ──────────────────────────────────────────────── */

export default function AltaDeEquipo({ cfg, roles, onContratado }: {
  cfg: PortalConfig;
  roles: Role[];
  onContratado: (roles: Role[]) => void;
}) {
  // Si ya hay un pedido dando vueltas, el cliente entra derecho a la espera: no
  // se le vuelve a ofrecer el catálogo de donde eligió, que es como se pide dos
  // veces lo mismo. Y con el nombre y la cara QUE EL AGENTE ANOTÓ, no con las
  // que este browser recuerde: el pedido lo pudo dejar desde otra máquina.
  const pendiente = pedidoPendiente(roles);
  const [elegido, setElegido] = useState<Role | null>(pendiente);
  const [paso, setPaso] = useState<"eligiendo" | "que-necesita" | "bautizo" | "en-camino">(
    pendiente ? "en-camino" : "eligiendo");
  // Lo que el cliente contó y marcó, si el rol que eligió lo pregunta. Vive acá
  // y no adentro de la pantalla para que ir al bautizo y volver no lo borre.
  const [necesita, setNecesita] = useState<LoQueNecesita>(SIN_CONTAR);
  const [nombre, setNombre] = useState(pendiente?.pedido?.nombre ?? "");
  const [look, setLook] = useState<AgentitoLook>(
    () => pintaDe(pendiente?.pedido?.pinta ?? pendiente?.look));

  /** Mostrar lo que el AGENTE tiene anotado. Se llama con el pedido que
   *  contestó el adapter —al crearlo, al reencontrarlo en un 409, o en cada
   *  vuelta de la espera—, y nunca inventa: si el pedido no trae nombre o
   *  pinta, queda lo que ya estaba en pantalla. */
  const mostrar = useCallback((role: Role, pedido?: PedidoDeRol | null) => {
    setElegido(role);
    if (pedido?.nombre) setNombre(pedido.nombre);
    if (pedido?.pinta) setLook(pintaDe(pedido.pinta));
  }, []);

  // El aviso de "ya está" tiene que sobrevivir a los renders: si el efecto
  // dependiera del callback tal como llega (una arrow nueva por render), el
  // intervalo se reiniciaría antes de cumplirse y no miraría nunca.
  const alContratado = useRef(onContratado);
  useEffect(() => { alContratado.current = onContratado; });

  useEffect(() => {
    if (paso !== "en-camino") return;
    let vivo = true;
    const mirar = () => {
      getRoles(cfg)
        .then((r) => {
          if (!vivo) return;
          const frescos = r?.roles ?? [];
          if (frescos.some(yaEsta)) { alContratado.current(frescos); return; }
          // Todavía no está: se sigue mostrando el pedido tal como lo tiene el
          // agente. Si alguien lo canceló o quedó otro más viejo primero, la
          // pantalla se corrige sola.
          const p = pedidoPendiente(frescos);
          if (p) mostrar(p, p.pedido);
        })
        .catch(() => { /* el agente puede estar reiniciando justo por esto */ });
    };
    // La primera mirada es ya, y no a los 30 segundos: el rol puede haber
    // llegado mientras el cliente tenía la pestaña cerrada, y entrar a que te
    // digan "está en camino" cuando hace rato que está es hacerlo esperar por
    // nada.
    mirar();
    const t = setInterval(mirar, ESPERA_MS);
    return () => { vivo = false; clearInterval(t); };
  }, [paso, cfg, mostrar]);

  const elegir = (role: Role) => {
    setElegido(role);
    // El rol que se arma a medida pregunta antes de bautizar: sin eso, lo que
    // llega es "un asistente" y nadie sabe qué ponerle. Los demás van derecho
    // al bautizo, exactamente como hasta hoy.
    if (seArmaAMedida(role)) {
      setNecesita(SIN_CONTAR);
      setPaso("que-necesita");
      return;
    }
    setPaso("bautizo");
  };

  // SOLO LOS QUE SE PUEDEN PEDIR. `state` viene tal cual del catálogo y el
  // adapter no lo completa: un rol sin `state`, o en borrador, contesta 404 al
  // pedido. Ofrecer algo que no se puede pedir es ofrecerle al cliente un error
  // después de que ya eligió y bautizó.
  const ofrecidos = roles.filter((r) => r.state === "ready" && !yaEsta(r));

  /* Paso 1 — elegir. */
  if (paso === "eligiendo") {
    return (
      <main className="app-shell min-h-screen bg-surface px-6 py-12">
        <div className="mx-auto flex w-full max-w-2xl flex-col">
          <div className="animate-fadeup text-center">
            <h1 className="text-[30px] font-extrabold leading-tight tracking-tight text-ink sm:text-[38px]">
              Elegí tu primer rol
            </h1>
            <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-ink-soft">
              Cada uno se ocupa de una sola cosa y la hace todos los días.
              Empezá por el que más te aprieta hoy; los demás los sumás cuando
              quieras.
            </p>
          </div>

          {ofrecidos.length === 0 ? (
            <Card className="mt-8 p-5 text-center">
              <p className="text-[14px] leading-relaxed text-ink-soft">
                Todavía no hay ningún rol para sumar a tu equipo. Escribinos y lo
                vemos con vos.
              </p>
              <div className="mt-3 flex justify-center"><Soporte /></div>
            </Card>
          ) : (
            <div className="mt-8 flex flex-col gap-2">
              {ofrecidos.map((role) => (
                <TarjetaDeRol key={role.id} role={role} onElegir={() => elegir(role)} />
              ))}
            </div>
          )}

          <div className="mt-6 text-center">
            <Soporte label="¿No sabés cuál te sirve? Escribinos" />
          </div>
        </div>
      </main>
    );
  }

  /* Paso 2 (sólo el rol a medida) — qué necesita que haga. */
  if (paso === "que-necesita" && elegido) {
    return (
      <main className="app-shell flex min-h-screen items-center justify-center bg-surface px-6 py-12">
        <QueNecesita
          key={elegido.id}
          cfg={cfg}
          valor={necesita}
          onCambio={setNecesita}
          volverLabel="Ver los otros roles"
          onVolver={() => setPaso("eligiendo")}
          onListo={() => setPaso("bautizo")}
        />
      </main>
    );
  }

  /* Paso 3 — bautizarlo. La pantalla es la misma que la pestaña Equipo le
     pone a cada rol que se suma después: vive en `BautizoDeRol`, acá arriba. */
  if (paso === "bautizo" && elegido) {
    const aMedida = seArmaAMedida(elegido);
    return (
      <main className="app-shell flex min-h-screen items-center justify-center bg-surface px-6 py-12">
        <BautizoDeRol
          key={elegido.id}
          cfg={cfg}
          role={elegido}
          capacidades={aMedida ? necesita.marcadas ?? [] : undefined}
          volverLabel={aMedida ? "Cambiar lo que va a hacer" : "Ver los otros roles"}
          onVolver={() => setPaso(aMedida ? "que-necesita" : "eligiendo")}
          onListo={(r) => {
            // El rol ya estaba instalado (el 409 de "ya lo tenés"): no hay nada
            // que esperar.
            if (r.tipo === "contratado") { onContratado(r.roles); return; }
            // Lo que muestra la espera es lo que el AGENTE anotó —el pedido que
            // acaba de quedar, o el que ya tenía—, nunca lo tipeado acá.
            setElegido(r.role);
            setNombre(r.nombre);
            setLook(r.look);
            setPaso("en-camino");
          }}
        />
      </main>
    );
  }

  /* Paso 4 — la espera. Sin barra de progreso ni porcentaje: del otro lado hay
     una persona preparándolo, y un número inventado solo sirve para que el
     cliente descubra que le mentimos cuando no se mueve. */
  // El nombre de esta pantalla ya pasó por el agente: lo puso `mostrar` con lo
  // que contestó el adapter al crear el pedido, con lo que trae el roster al
  // entrar, o con lo que apareció en la vuelta del 409. Lo de abajo es el
  // último recurso para un adapter que no devuelva el pedido.
  const comoSeLlama = nombre.trim() || elegido?.pedido?.nombre || elegido?.label || "Tu compañero";
  return (
    <main className="app-shell flex min-h-screen items-center justify-center bg-surface px-6 py-12">
      <div className="flex w-full max-w-xl flex-col items-center text-center">
        <AgentitoAvatar look={look} vivo className="h-32 w-32" />
        <h1 className="mt-6 animate-fadeup text-[28px] font-extrabold leading-tight tracking-tight text-ink sm:text-[34px]">
          «{comoSeLlama}» está en camino
        </h1>
        {elegido && (
          <p className="mt-2 text-[14px] font-medium text-ink-soft">{elegido.label}</p>
        )}
        <p className="mx-auto mt-4 max-w-md text-[15px] leading-relaxed text-ink-soft">
          Lo prepara alguien de tuagente: hay que darle su lugar en tu agente,
          sus permisos y lo que necesita para arrancar. No es automático y no lo
          podés apurar desde acá.
        </p>
        <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-ink-soft">
          No tenés que hacer nada. Cuando esté, esta pantalla se abre sola en tu
          portal; y si cerrás, te lo vas a encontrar la próxima vez que entres.
        </p>
        {elegido && (
          <Card className="mt-7 w-full p-4 text-left">
            <p className="text-[13px] font-semibold text-ink">Lo que le pediste</p>
            <p className="mt-1.5 text-[14px] leading-snug text-ink-soft">{elegido.does}</p>
            {!!elegido.flows?.length && (
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                <Workflow className="h-3.5 w-3.5 shrink-0 text-ink-soft" />
                {elegido.flows.map((slug) => (
                  <Chip key={slug}>{rotuloDeFlujo(slug)}</Chip>
                ))}
              </div>
            )}
          </Card>
        )}
        <Soporte className="mt-6" label="¿Alguna duda mientras tanto? Escribinos" />
      </div>
    </main>
  );
}
