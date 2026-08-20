"use client";

// Equipo — who works for you (GET {adapter}/portal/roles).
//
// A role is a Hermes profile with its own SOUL, skills and memory. The client
// hires one at a time and each arrives with a name and a face.
//
// THIS IS THE ONLY PER-ROLE VIEW IN THE PORTAL, and on purpose. Everything else
// -- board, files, deliveries, activity, chat -- stays global with the role as a
// chip or a signature. A top-level role switcher would multiply navigation by N
// and hand the client an org chart to learn, which is exactly the work they pay
// not to do. This tab answers "who is on my team", not "show me only their
// stuff".
//
// It only exists on an agent that has a team: the `roles` module is false on
// every single-role agent, so the tab is not in the nav and this page is never
// reached.
//
// ACÁ TAMBIÉN SE SUMA GENTE, y no es un botón de más: es la misma acción del
// alta (`lib/altaEquipo.tsx`) para el segundo compañero en adelante. El portal
// no INSTALA nada —eso lo hacemos nosotros a mano: el perfil, los permisos, el
// reinicio del gateway— pero sí puede dejar el pedido anotado con el nombre y
// la cara que el cliente eligió. Acá decía "escribinos y lo sumamos a tu
// equipo", que desde que el pedido existe es mandarlo a escribir un mail por
// algo que la pantalla hace sola.

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ChevronLeft, RefreshCw, UserPlus, Users } from "lucide-react";
import { AgentitoAvatar, LOOK_DEFAULT, type AgentitoLook } from "../lib/agentito";
import { getRoles, loadConfig, type HttpError, type PortalConfig, type Role } from "../lib/agent";
import {
  BautizoDeRol, QueNecesita, SIN_CONTAR, listo, seArmaAMedida, yaEsta,
  type AltaDelRol, type LoQueNecesita,
} from "../lib/altaEquipo";
import { loadAgentName } from "../lib/onboarding";
import { horaDe, rotuloCanal } from "../lib/palabras";
import { Btn, Card, Chip, EmptyState, ErrorState, IconBtn, PageHeader, Soporte, Spinner } from "../lib/ui";
import { PARAM, abrirEnRuta, cerrarEnRuta, useParamRuta } from "../lib/rutas";
import FichaDelRol from "./ficha";
import { LoQueLeFalta, useConexionesDelEquipo, type ConexionesDelEquipo } from "./necesita";

const WRAP = "mx-auto max-w-5xl px-6 py-6 md:px-8";
const REFRESH_MS = 60_000;

/** Pedido y todavía no instalado: ni está en el equipo ni se puede volver a
 *  pedir. Sin esta distinción, el cliente que ya esperó ve el rol ofrecido de
 *  nuevo y lo pide dos veces. */
// An open pedido means "on its way" even mid-install: until the baptism
// persists, the roster carries the CATALOG name and face, and this tab is
// exactly where the client checks that their hire arrived.
const enCamino = (role: Role) => Boolean(role.pedido);

/** El nombre con el que el cliente lo ve. Si lo bautizó al pedirlo, ESE gana
 *  aunque el roster siga sirviendo el del catálogo: el perfil recién pasa a ser
 *  suyo cuando se lo instalamos, así que hasta entonces lo que eligió viaja
 *  adentro del pedido. */
function nombreDeRol(role: Role): string {
  return (enCamino(role) ? role.pedido?.nombre : "") || role.name || role.label;
}

function faceOf(role: Role): AgentitoLook {
  return { ...LOOK_DEFAULT, ...((enCamino(role) ? role.pedido?.pinta : null) ?? role.look ?? {}) } as AgentitoLook;
}

function RoleCard({ role, onOpen, conexiones, accion }: {
  role: Role;
  onOpen: () => void;
  /** El catálogo de conexiones de la pantalla: lo que le falta al que YA está
   *  en el equipo se dice con el botón para destrabarlo. */
  conexiones: ConexionesDelEquipo;
  /** Lo único que se toca en la tarjeta además de la tarjeta misma: hoy,
   *  "Sumarlo". */
  accion?: ReactNode;
}) {
  const nombre = nombreDeRol(role);
  return (
    // The button is INSIDE the Card and does not wrap it: `Card` is
    // presentational and shared by half the portal -- teaching it to be
    // clickable for one caller is how a UI kit turns into a pile of props --
    // and a button inside a button (the "Sumarlo" one) is not valid HTML.
    <Card className={`p-4 transition hover:border-primary/40 ${yaEsta(role) ? "" : "opacity-70"}`}>
      <div className="flex items-start gap-3">
        <button onClick={onOpen} className="flex min-w-0 flex-1 gap-4 text-left">
          <AgentitoAvatar
            look={faceOf(role)}
            className="h-14 w-14 shrink-0"
            apagado={!yaEsta(role)}
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[15px] font-semibold text-ink">{nombre}</p>
              {/* The job title stays visible even after a rename: "Vera" on its own
                  does not say what Vera does. */}
              {nombre !== role.label && (
                <span className="text-[13px] text-ink-soft">{role.label}</span>
              )}
              {yaEsta(role)
                ? <Chip tone="green">En tu equipo</Chip>
                : enCamino(role)
                  ? <Chip tone="amber">En camino</Chip>
                  : <Chip tone="neutral">Podés sumarlo</Chip>}
            </div>
            {enCamino(role) && (
              <p className="mt-1.5 text-[14px] leading-snug text-ink">
                «{nombre}» está en camino: lo estamos preparando.
              </p>
            )}
            <p className="mt-1.5 text-[14px] leading-snug text-ink-soft">{role.does}</p>
            {role.never && (
              // The hard limit is a selling point, not fine print: it is the same
              // sentence that lives in this role's SOUL, so what the screen promises
              // and what the agent obeys cannot drift apart.
              <p className="mt-1.5 text-[13px] text-ink-soft">
                <span className="font-medium text-ink">Nunca:</span> {role.never}
              </p>
            )}
            {!!role.needs?.length && !listo(role) && (
              // Connection ids travel raw (`whatsapp`); the portal has one
              // dictionary that turns them into names the client recognises, and it
              // is the same one Actividad and Conexiones use.
              //
              // Al que TODAVÍA NO ESTÁ en el equipo esto le queda como dato: una
              // conexión que le falta a alguien que no trabaja acá no es un
              // problema que el cliente tenga que resolver hoy. Al que ya está lo
              // atiende `LoQueLeFalta`, abajo y con el botón.
              <p className="mt-1.5 text-[13px] text-ink-soft">
                Necesita {role.needs.map(rotuloCanal).join(", ")} para empezar.
              </p>
            )}
          </div>
        </button>
        {accion && <div className="shrink-0">{accion}</div>}
      </div>
      {/* AFUERA del botón que abre la ficha: adentro sería un botón dentro de
          otro —HTML inválido— y apretar "Pedirla" abriría la ficha en vez de
          dejar el pedido. Alineado con el texto, no con el avatar. */}
      <LoQueLeFalta role={role} conexiones={conexiones} className="sm:pl-[72px]" />
    </Card>
  );
}

export default function EquipoPage() {
  // Which teammate is open is READ FROM THE URL, never from a useState in
  // parallel: that is what makes a reload land on the same one and the link
  // shareable. Lo mismo con el bautizo del que se está sumando (`?sumar=`):
  // refrescar en el medio vuelve al mismo lugar, y "atrás" lo cierra.
  const abierto = useParamRuta(PARAM.rol);
  const bautizando = useParamRuta(PARAM.sumar);
  const [cfg, setCfg] = useState<PortalConfig | null>(null);
  const [roles, setRoles] = useState<Role[] | null>(null);
  const [err, setErr] = useState<{ status?: number; message: string } | null>(null);
  const [cargando, setCargando] = useState(false);
  const [ultima, setUltima] = useState<Date | null>(null);
  const [nombreAgente, setNombreAgente] = useState("");
  // The made-to-measure role (asistente) asks what the client needs BEFORE the
  // baptism, exactly like the first-run alta does. The answer lives here so
  // going back from the baptism keeps the text and the checks.
  const [necesita, setNecesita] = useState<LoQueNecesita>(SIN_CONTAR);
  const [contado, setContado] = useState(false);
  // Las conexiones se traen UNA VEZ POR PANTALLA, al lado del roster: son las
  // mismas para todos los compañeros, y una llamada por tarjeta sería la misma
  // lista pedida seis veces.
  const conexiones = useConexionesDelEquipo(cfg);

  useEffect(() => {
    setCfg(loadConfig());
    setNombreAgente(loadAgentName() || "");
  }, []);

  // silent: the periodic refresh must not blank the screen, and must not
  // replace data that is still good with an error.
  const load = useCallback((silent = false) => {
    if (!cfg) return;
    if (!silent) { setRoles(null); setErr(null); }
    setCargando(true);
    getRoles(cfg)
      .then((r) => {
        setRoles(r?.roles ?? []);
        setErr(null);
        setUltima(new Date());
      })
      .catch((e: HttpError) => setErr({ status: e?.status, message: e?.message || "error" }))
      .finally(() => setCargando(false));
  }, [cfg]);

  useEffect(() => { load(); }, [load]);
  const refrescarConexiones = conexiones.refrescar;
  useEffect(() => {
    if (!cfg) return;
    // El mismo tick refresca las dos cosas: una conexión que alguien conectó
    // mientras el cliente mira la pantalla tiene que sacar el renglón sola.
    const t = setInterval(() => { load(true); refrescarConexiones(); }, REFRESH_MS);
    return () => clearInterval(t);
  }, [cfg, load, refrescarConexiones]);

  // El bautizo se hace cargo del pedido y del 409; lo que queda acá es dejar el
  // roster al día. Si el 409 contestó que el rol YA está instalado, viene el
  // roster fresco y ese manda. Si no, se anota el pedido tal como lo devolvió
  // el agente —para que la tarjeta diga "en camino" en el mismo tick— y se
  // vuelve a preguntar, que es lo que lo confirma.
  const alQuedarPedido = (r: AltaDelRol) => {
    // Only close what is still open: if the client already navigated away, a
    // late resolve must not pop an unrelated history entry.
    if (bautizando) cerrarEnRuta(PARAM.sumar);
    if (r.tipo === "contratado") { setRoles(r.roles); return; }
    setRoles((prev) => (prev ?? []).map((x) => (
      x.id === r.role.id
        ? { ...x, pedido: r.pedido ?? { nombre: r.nombre, pinta: r.look, pedido_en: "" } }
        : x
    )));
    load(true);
  };

  const cuerpo = () => {
    if (abierto && roles) {
      const role = roles.find((r) => r.id === abierto);
      // A link to a teammate this agent does not have is a stale link, not a
      // crash: the roster is shown instead of an error about an id.
      if (role) return <FichaDelRol role={role} conexiones={conexiones} />;
    }
    if (err && roles === null) {
      return <ErrorState message={err.message} onRetry={() => load()} />;
    }
    if (roles === null) return <Spinner />;
    if (roles.length === 0) {
      return (
        <EmptyState
          icon={Users}
          title="Todavía sos vos y tu agente"
          hint="Cuando sumes a alguien más al equipo, va a aparecer acá."
        />
      );
    }

    const hired = roles.filter(listo);
    const pedidos = roles.filter(enCamino);
    // SOLO LOS QUE SE PUEDEN PEDIR llevan botón. `state` viene tal cual del
    // catálogo y el adapter no lo completa: un rol sin `state`, o en borrador,
    // contesta 404 al pedido. Ofrecer "Sumarlo" ahí es ofrecerle al cliente un
    // error después de que ya eligió y bautizó. Es el mismo filtro del alta.
    const offered = roles.filter((r) => !yaEsta(r) && !r.pedido && r.state === "ready");
    const enPreparacion = roles.filter((r) => !yaEsta(r) && !r.pedido && r.state !== "ready");

    const abrirFicha = (role: Role) => () => abrirEnRuta({ [PARAM.rol]: role.id });

    return (
      <>
        <div className="flex flex-col gap-2">
          {hired.map((role) => (
            <RoleCard key={role.id} role={role} onOpen={abrirFicha(role)} conexiones={conexiones} />
          ))}
        </div>

        {pedidos.length > 0 && (
          <>
            <h2 className="mb-2 mt-7 text-[15px] font-semibold text-ink">En camino</h2>
            <div className="flex flex-col gap-2">
              {pedidos.map((role) => (
                <RoleCard key={role.id} role={role} onOpen={abrirFicha(role)} conexiones={conexiones} />
              ))}
            </div>
            {/* La misma verdad que la pantalla de espera del alta, y por el
                mismo motivo: del otro lado hay una persona preparándolo. Sin
                esto, un rol pedido hace tres días parece una pantalla colgada. */}
            <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">
              Lo prepara alguien de tuagente: hay que darle su lugar en tu
              agente, sus permisos y lo que necesita para arrancar. No es
              automático y no lo podés apurar desde acá. Cuando esté, aparece
              acá arriba trabajando.
            </p>
          </>
        )}

        {offered.length > 0 && (
          <>
            <h2 className="mb-2 mt-7 text-[15px] font-semibold text-ink">Podés sumar</h2>
            <div className="flex flex-col gap-2">
              {offered.map((role) => (
                <RoleCard key={role.id} role={role} onOpen={abrirFicha(role)} conexiones={conexiones}
                  accion={
                    <Btn size="sm" kind="secondary"
                      onClick={() => abrirEnRuta({ [PARAM.sumar]: role.id })}>
                      <UserPlus className="h-4 w-4" /> Sumarlo
                    </Btn>
                  } />
              ))}
            </div>
            <div className="mt-3">
              <Soporte label="¿No sabés cuál te sirve? Escribinos" />
            </div>
          </>
        )}

        {enPreparacion.length > 0 && (
          <>
            {/* Los que el catálogo todavía no da por listos. Se muestran igual
                —lo que viene también es parte de la oferta— pero sin botón,
                porque el pedido de uno de estos contesta 404. */}
            <h2 className="mb-2 mt-7 text-[15px] font-semibold text-ink">
              Todavía los estamos armando
            </h2>
            <div className="flex flex-col gap-2">
              {enPreparacion.map((role) => (
                <RoleCard key={role.id} role={role} onOpen={abrirFicha(role)} conexiones={conexiones} />
              ))}
            </div>
            <div className="mt-3">
              <Soporte label="¿Te sirve alguno de estos? Escribinos" />
            </div>
          </>
        )}
      </>
    );
  };

  const abiertoRole = abierto ? (roles ?? []).find((r) => r.id === abierto) : undefined;
  // A quién se está bautizando sale del ROSTER y no de la URL a secas: un
  // `?sumar=` con un id que no existe, con alguien que ya está en el equipo o
  // con uno que ya se pidió es un link viejo, y un link viejo muestra la lista
  // —nunca un formulario para pedir dos veces lo mismo—.
  useEffect(() => { setNecesita(SIN_CONTAR); setContado(false); }, [bautizando]);

  const sumando = cfg && bautizando
    ? (roles ?? []).find((r) => r.id === bautizando && !yaEsta(r) && !r.pedido && r.state === "ready")
    : undefined;

  // El bautizo se lleva la pestaña entera: es una decisión —cómo se va a llamar
  // y qué cara tiene— y no un detalle al costado de la lista.
  if (sumando && cfg) {
    return (
      <div className={WRAP}>
        <button
          onClick={() => cerrarEnRuta(PARAM.sumar)}
          className="mb-2 inline-flex items-center gap-1 text-[13px] text-ink-soft transition hover:text-ink"
        >
          <ChevronLeft className="h-3.5 w-3.5" /> Tu equipo
        </button>
        <div className="flex justify-center py-6">
          {seArmaAMedida(sumando) && !contado ? (
            <QueNecesita
              key={sumando.id}
              cfg={cfg}
              valor={necesita}
              onCambio={setNecesita}
              onListo={() => setContado(true)}
            />
          ) : (
            <BautizoDeRol
              key={sumando.id}
              cfg={cfg}
              role={sumando}
              capacidades={seArmaAMedida(sumando) ? necesita.marcadas ?? [] : undefined}
              volverLabel={seArmaAMedida(sumando) ? "Cambiar lo que va a hacer" : undefined}
              onVolver={seArmaAMedida(sumando) ? () => setContado(false) : undefined}
              onListo={alQuedarPedido}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={WRAP}>
      {abierto && (
        <button
          onClick={() => cerrarEnRuta(PARAM.rol)}
          className="mb-2 inline-flex items-center gap-1 text-[13px] text-ink-soft transition hover:text-ink"
        >
          <ChevronLeft className="h-3.5 w-3.5" /> Tu equipo
        </button>
      )}
      <PageHeader
        title={abiertoRole ? nombreDeRol(abiertoRole) : "Tu equipo"}
        subtitle={
          abiertoRole ? undefined
            : nombreAgente
              ? `${nombreAgente} no trabaja solo: cada uno se ocupa de lo suyo y comparten lo que saben de tu empresa.`
              : "Cada uno se ocupa de lo suyo y comparten lo que saben de tu empresa."
        }
        actions={
          <>
            {/* One clock in the whole portal: the business's. Same stamp as
                Inicio, Actividad and Entregas. */}
            {ultima && (
              <span className="hidden text-xs tabular-nums text-ink-soft sm:inline">
                Actualizado {horaDe(ultima.getTime())}
              </span>
            )}
            <IconBtn label="Actualizar" disabled={cargando} onClick={() => { load(true); refrescarConexiones(); }}>
              <RefreshCw className={`h-4 w-4 ${cargando ? "animate-spin" : ""}`} />
            </IconBtn>
          </>
        }
      />

      {err && roles !== null && (
        <p className="mb-4 inline-flex items-center rounded-lg border border-c-coral bg-c-coral/40 px-3 py-1.5 text-[12px] font-medium text-c-coral-ink">
          No pude actualizar recién ({err.message}). Te muestro lo último que tengo.
        </p>
      )}

      {cuerpo()}
    </div>
  );
}
