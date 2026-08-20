"use client";

// Lo que le falta a un compañero para poder trabajar — con el botón adentro.
//
// El roster declara `needs` con ids del catálogo de conexiones (`whatsapp`), y
// hasta acá eso era una frase: «Necesita WhatsApp para empezar», en la ficha de
// alguien que el cliente YA sumó y que, sin eso, no puede hacer nada. La frase
// es cierta y no lleva a ningún lado: el pedido vive dos pestañas más allá y el
// que la lee no tiene por qué saber que Conexiones existe.
//
// ES EL MISMO PEDIDO DE CONEXIONES: `crearPedidoDeConexion`, con el mismo
// título (`Conectar {label}`, lo único con lo que la otra pantalla reconoce que
// ya lo pediste) y el mismo ticket bloqueado de entrada. Lo que el portal no
// hace es conectar por su cuenta lo que requiere trámite nuestro: deja el
// pedido anotado y lo dice.
//
// SOLO PARA EL QUE YA ESTÁ EN EL EQUIPO (`listo`). Una conexión que le falta a
// un rol que el cliente todavía no sumó no es un problema suyo: es un dato del
// catálogo, y ahí sigue siendo la frase de antes.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Link2 } from "lucide-react";
import {
  conexionesPedidas, crearPedidoDeConexion, getConnections, getTickets,
  type Connection, type PortalConfig, type Role,
} from "../lib/agent";
import { describirError, listo } from "../lib/altaEquipo";
import { rotuloCanal } from "../lib/palabras";
import { PARAM } from "../lib/rutas";
import { Btn } from "../lib/ui";

/** El catálogo de conexiones y los pedidos abiertos, UNA SOLA VEZ POR PANTALLA.
 *  Son dos llamadas para toda la pestaña —no una por tarjeta— por lo mismo que
 *  el roster: la lista es la misma para todos los compañeros. */
export type ConexionesDelEquipo = {
  /** null solo mientras CARGA (la pantalla no dibuja nada hasta saber). Si el
   *  catálogo no contesta queda [], y cada need cae en la frase pasiva de
   *  siempre: sin catálogo no se ofrece pedir lo que no sabemos describir. */
  lista: Connection[] | null;
  yaPedida: (c: Connection) => boolean;
  pidiendo: (c: Connection) => boolean;
  pedir: (c: Connection, role: Role) => Promise<void>;
  refrescar: () => void;
};

export function useConexionesDelEquipo(cfg: PortalConfig | null): ConexionesDelEquipo {
  const [lista, setLista] = useState<Connection[] | null>(null);
  // Los pedidos ya hechos salen DEL TABLERO, igual que en Conexiones: si
  // vivieran solo en este estado, recargar la página le volvería a ofrecer
  // pedir lo que ya está esperando.
  const [enElTablero, setEnElTablero] = useState<Set<string>>(new Set());
  // Y lo que acabás de pedir en esta pantalla, para que el renglón cambie en el
  // mismo tick: el ticket recién creado tarda en aparecer en la lista.
  const [reciente, setReciente] = useState<string[]>([]);
  // In-flight PER CONNECTION, not per row: two hired roles can need the same
  // connection, and two Pedirla buttons racing each other used to file two
  // identical tickets.
  const [enVuelo, setEnVuelo] = useState<Set<string>>(new Set());

  const refrescar = useCallback(() => {
    if (!cfg) return;
    getConnections(cfg)
      .then((r) => setLista(r?.conexiones ?? []))
      .catch(() => setLista([]));
    // El tablero es un extra: sin él se pierde el «ya lo pediste», no la
    // pestaña.
    getTickets(cfg)
      .then((t) => setEnElTablero(conexionesPedidas(t?.tickets)))
      .catch(() => { /* sin tablero seguimos con lo que haya en memoria */ });
  }, [cfg]);

  useEffect(() => { refrescar(); }, [refrescar]);

  const yaPedida = useCallback(
    (c: Connection) =>
      reciente.indexOf(c.id) >= 0 || enElTablero.has((c.label ?? "").trim().toLowerCase()),
    [reciente, enElTablero],
  );

  const pidiendo = useCallback((c: Connection) => enVuelo.has(c.id), [enVuelo]);

  const pedir = useCallback(async (c: Connection, role: Role) => {
    if (!cfg || enVuelo.has(c.id)) return;
    setEnVuelo((prev) => new Set(prev).add(c.id));
    const quien = role.name || role.label;
    try {
      await crearPedidoDeConexion(cfg, {
      title: `Conectar ${c.label}`,
      cuerpo:
        `Lo pidió desde Equipo: ${quien} (${role.label}) no puede empezar sin esto.\n` +
        `Para qué sirve: ${c.para_que}\n` +
        `Cómo se conecta: ${c.como}\n\n` +
        `No hagas nada por tu cuenta con esto: avisale al equipo de tuagente ` +
        `que hay que conectarlo y dejá el ticket esperando.`,
      });
      setReciente((p) => (p.indexOf(c.id) >= 0 ? p : p.concat(c.id)));
      refrescar();   // que el «Pedida» pase a salir del tablero, no de acá
    } finally {
      setEnVuelo((prev) => { const s = new Set(prev); s.delete(c.id); return s; });
    }
  }, [cfg, enVuelo, refrescar]);

  return { lista, yaPedida, pidiendo, pedir, refrescar };
}

/** Un renglón por conexión que le falta. */
function Falta({ id, conexion, role, conexiones }: {
  id: string;
  conexion: Connection | null;
  role: Role;
  conexiones: ConexionesDelEquipo;
}) {
  const [pidiendo, setPidiendo] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // El catálogo no la tiene (id viejo, o no contestó): queda la frase de
  // siempre. No se ofrece pedir algo que no sabemos nombrar ni describir.
  if (!conexion) {
    return (
      <p className="text-[13px] text-ink-soft">Necesita {rotuloCanal(id)} para empezar.</p>
    );
  }

  const label = conexion.label;
  const aConexiones = `/app/conexiones?${PARAM.conexion}=${encodeURIComponent(conexion.id)}`;
  const linkCls =
    "inline-flex items-center gap-1 text-[13px] font-semibold text-primary underline-offset-2 hover:underline";

  // «Lista»: nuestra mitad ya está y falta la suya —un mensaje al bot—, así que
  // el pedido no destraba nada. Se lo manda a donde sí puede terminarlo.
  if (conexion.estado === "lista") {
    return (
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink-soft">
        <span>Necesita {label} para empezar: falta tu primer mensaje.</span>
        <Link href={aConexiones} className={linkCls}>
          Terminar en Conexiones <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </p>
    );
  }


  if (conexiones.yaPedida(conexion)) {
    // Ya está anotado y del otro lado hay alguien haciéndolo: un botón acá
    // sería pedir dos veces lo mismo.
    return (
      <p className="text-[13px] text-ink-soft">
        Necesita {label} para empezar.{" "}
        <span className="font-medium text-ink">Pedida: la estamos conectando.</span>{" "}
        Te escribimos cuando esté.
      </p>
    );
  }

  // Con flujo self-service la conecta el cliente solo (hoy, Google y su diálogo
  // de pasos). Los pasos son de Conexiones y ahí se quedan: duplicarlos acá
  // sería un segundo lugar para mantener bien.
  //
  // LA MISMA PUERTA QUE CONEXIONES, no una regla propia: tener `flujo` no
  // alcanza. WhatsApp tiene flujo (el QR) y una advertencia que lo prohíbe en
  // la línea comercial; Google con el secreto sin poner está `bloqueado` y su
  // flujo no destraba nada. Decirle «la conectás vos» a cualquiera de esos es
  // mandarlo a una pared con una sonrisa.
  if (conexion.flujo && conexion.estado === "sin_conectar"
      && conexion.quien === "cliente_solo" && !conexion.advertencia) {
    return (
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink-soft">
        <span>Necesita {label} para empezar. La conectás vos, en un par de minutos.</span>
        <Link href={aConexiones} className={linkCls}>
          Conectala <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </p>
    );
  }

  const ocupado = pidiendo || conexiones.pidiendo(conexion);
  const pedir = async () => {
    setPidiendo(true);
    setErr(null);
    try {
      await conexiones.pedir(conexion, role);
    } catch (e) {
      setErr(describirError(e));
    } finally {
      setPidiendo(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <p className="text-[13px] text-ink-soft">
        Necesita {label} para empezar. La conectamos nosotros.
      </p>
      <Btn size="sm" kind="secondary" onClick={pedir} disabled={ocupado}>
        <Link2 className="h-3.5 w-3.5" />
        {ocupado ? "Pidiendo…" : "Pedirla"}
      </Btn>
      {err && <p className="w-full text-[12px] font-medium text-c-coral-ink">{err}</p>}
    </div>
  );
}

export function LoQueLeFalta({ role, conexiones, className = "" }: {
  role: Role;
  conexiones: ConexionesDelEquipo;
  className?: string;
}) {
  // La regla vive acá y no en cada pantalla: al que todavía no está en el
  // equipo se le cuenta lo que va a necesitar, sin botón.
  if (!listo(role)) return null;
  // Hasta que el catálogo conteste no se afirma que falte nada: el parpadeo de
  // «Necesita X» en un rol que lo tiene todo conectado es una alarma falsa.
  if (conexiones.lista === null) return null;
  const necesita = (role.needs ?? [])
    .map((id) => ({ id, conexion: conexiones.lista?.find((c) => c.id === id) ?? null }))
    .filter(({ conexion }) => !conexion || conexion.estado !== "conectado");
  // Todo conectado: nada que decir. Que no falte nada no es una novedad.
  if (necesita.length === 0) return null;

  return (
    <div className={`mt-2 flex flex-col gap-1.5 ${className}`}>
      {necesita.map(({ id, conexion }) => (
        <Falta key={id} id={id} conexion={conexion} role={role} conexiones={conexiones} />
      ))}
    </div>
  );
}
