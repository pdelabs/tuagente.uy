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
  crearPedidoDeRol, getRoles,
  type HttpError, type Manifest, type PedidoDeRol, type PortalConfig, type Role,
} from "./agent";
import {
  AgentitoAvatar, AgentitoCargando, LOOK_DEFAULT, type AgentitoLook,
} from "./agentito";
import { sortearLook } from "./onboarding";
import { rotuloCanal } from "./palabras";
import { Btn, Card, Chip, Soporte } from "./ui";

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
const yaEsta = (r: Role) => Boolean(r.contratado ?? r.hired);

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

/* ── Las tres pantallas ──────────────────────────────────────────────────── */

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
  const [paso, setPaso] = useState<"eligiendo" | "bautizo" | "en-camino">(
    pendiente ? "en-camino" : "eligiendo");
  const [nombre, setNombre] = useState(pendiente?.pedido?.nombre ?? "");
  const [look, setLook] = useState<AgentitoLook>(
    () => pintaDe(pendiente?.pedido?.pinta ?? pendiente?.look));
  const [pidiendo, setPidiendo] = useState(false);
  const [err, setErr] = useState<string | null>(null);

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
    // El catálogo ya trae un nombre y una cara: el bautizo empieza con los
    // suyos puestos, y cambiarlos es opcional. Una pantalla en blanco convierte
    // "elegí un rol" en "inventá un personaje".
    setNombre(role.name || role.label);
    setLook(pintaDe(role.look));
    setErr(null);
    setPaso("bautizo");
  };

  const pedir = async () => {
    if (!elegido || !nombre.trim() || pidiendo) return;
    setPidiendo(true);
    setErr(null);
    try {
      // Lo que se muestra en la espera sale de la respuesta, no de lo tipeado:
      // el adapter le pasa el nombre por el mismo saneado que el bautizo del
      // agente (va a parar a un bloque del SOUL), así que puede volver
      // recortado.
      const d = await crearPedidoDeRol(cfg, elegido.id, nombre.trim(), look);
      mostrar(elegido, d?.pedido);
      setPaso("en-camino");
    } catch (e) {
      const h = e as HttpError;
      // 409 son dos cosas y ninguna es un error del cliente: o ya lo había
      // pedido (dos pestañas, o volvió a entrar), o se lo instalamos mientras
      // lo bautizaba. La diferencia la contesta el roster, no el texto.
      if (h?.status === 409) {
        const r = await getRoles(cfg).catch(() => null);
        const frescos = r?.roles ?? [];
        if (frescos.some(yaEsta)) { onContratado(frescos); return; }
        // El pedido que ya existía manda: puede ser este rol pedido en otra
        // pestaña, o directamente otro rol. Se muestra el que el agente tiene
        // anotado, no el que este browser acaba de intentar.
        const p = pedidoPendiente(frescos);
        if (p) mostrar(p, p.pedido);
        setPaso("en-camino");
        return;
      }
      setErr(describirError(e));
    } finally {
      setPidiendo(false);
    }
  };

  // SOLO LOS QUE SE PUEDEN PEDIR. `state` viene tal cual del catálogo y el
  // adapter no lo completa: un rol sin `state`, o en borrador, contesta 404 al
  // pedido. Ofrecer algo que no se puede pedir es ofrecerle al cliente un error
  // después de que ya eligió y bautizó.
  const ofrecidos = roles.filter((r) => r.state === "ready" && !yaEsta(r));
  const listoParaPedir = Boolean(elegido) && nombre.trim().length > 0;

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

  /* Paso 2 — bautizarlo. Mismo bautizo que el del agente: el dado cambia SU
     pinta, no la página, y el nombre es lo único que hay que decidir. */
  if (paso === "bautizo" && elegido) {
    return (
      <main className="app-shell flex min-h-screen items-center justify-center bg-surface px-6 py-12">
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
            {/* Sin festejo: el bautizo del agente lo dispara y se queda a
                verlo, pero acá la pantalla siguiente es la espera y el
                personaje se desmonta en el mismo tick. Un contador que nadie
                mira es una promesa de animación que no pasa. */}
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
            placeholder={elegido.label}
            aria-label={`Nombre para tu ${elegido.label}`}
            className="mt-7 w-[8em] max-w-[80vw] border-b-[3px] border-black/15 bg-transparent text-center text-[32px] font-extrabold tracking-tight text-primary outline-none transition placeholder:font-extrabold placeholder:text-ink-soft/35 focus:border-primary sm:text-[38px]"
          />
          {/* El puesto queda a la vista aunque le cambie el nombre: "Vera" sola
              no dice qué hace Vera. */}
          <p className="mt-3 text-[14px] font-medium text-ink-soft">{elegido.label}</p>
          <p className="mx-auto mt-1.5 max-w-md text-[13px] leading-relaxed text-ink-soft">
            {elegido.does}
          </p>

          {err && <p className="mt-4 text-[13px] text-c-coral-ink">{err}</p>}

          <div className="mt-8 flex flex-col items-center gap-3">
            <Btn disabled={!listoParaPedir || pidiendo} onClick={pedir}>
              {pidiendo ? "Pidiéndolo…" : "Sumarlo a mi equipo"}
              {!pidiendo && <ArrowRight className="h-4 w-4" />}
            </Btn>
            <button
              onClick={() => { setPaso("eligiendo"); setErr(null); }}
              className="inline-flex items-center gap-1 text-[13px] font-semibold text-ink-soft underline-offset-4 transition hover:text-ink hover:underline"
            >
              <ChevronLeft className="h-3.5 w-3.5" /> Ver los otros roles
            </button>
          </div>
        </div>
      </main>
    );
  }

  /* Paso 3 — la espera. Sin barra de progreso ni porcentaje: del otro lado hay
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
