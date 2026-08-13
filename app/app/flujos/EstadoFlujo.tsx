"use client";

// El estado de un flujo, contado entero: el cartel, cuándo corrió, cómo salió,
// cuándo es la próxima, por qué no pudo — y los botones para tocarlo.
//
// Vive acá y no en cada página porque la lista y el detalle mostraban el mismo
// chip verde con dos copias del mismo ternario, y las dos mentían igual.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle, CalendarClock, CheckCircle2, HelpCircle, Loader2, Pause, Play, Zap,
} from "lucide-react";
import { jobAction, type PortalConfig } from "../lib/agent";
import { Chip, SOPORTE } from "../lib/ui";
import { linkArmar } from "../lib/ejemplosFlujos";
import {
  correrUnaVez, enElAire, useVuelos, vueloDe, type EstadoReal, type Nota,
} from "./corridas";

export function CartelEstado({ e }: { e: EstadoReal }) {
  return <Chip tone={e.tono}>{e.cartel}</Chip>;
}

/** Las dos líneas que las dos clientas pidieron por separado: qué pasó la
 *  última vez y cuándo es la próxima. Más la tercera, que no estaba: cuándo la
 *  pantalla no pudo confirmar nada. */
export function Corridas({ e, className = "" }: { e: EstadoReal; className?: string }) {
  if (!e.ultima && !e.proxima && !e.sinConfirmar) return null;
  const Icono =
    e.clave === "fallo" ? AlertTriangle
      : e.clave === "dudoso" || e.clave === "atrasado" || e.clave === "sin-tarea" ? HelpCircle
        : e.clave === "bien" ? CheckCircle2
          : e.clave === "corriendo" ? Loader2
            : null;
  return (
    <div className={`flex flex-col gap-0.5 ${className}`}>
      {e.ultima && (
        <p className={`flex items-center gap-1.5 text-[12.5px] ${
          e.clave === "fallo" ? "font-semibold text-c-coral-ink" : "text-ink-soft"
        }`}>
          {Icono && (
            <Icono className={`h-3.5 w-3.5 shrink-0 ${
              e.clave === "bien" ? "text-c-green-ink"
                : e.clave === "corriendo" ? "animate-spin text-primary" : ""
            }`} />
          )}
          {e.ultima}
        </p>
      )}
      {e.proxima && <p className="text-[12.5px] text-ink-soft">{e.proxima}</p>}
      {/* Sin el cruce con el motor la pantalla no puede afirmar en verde, y
          tiene que decir por qué se quedó corta: antes los botones simplemente
          desaparecían y el cartel seguía en "Activo". */}
      {e.sinConfirmar && (
        <p className="text-[12.5px] text-ink-soft/85">
          No pude confirmar con tu agente cómo viene: esto es lo último que sé y
          puede haber cambiado.
        </p>
      )}
    </div>
  );
}

/** Qué pasó y qué se puede hacer. El texto del motor no se esconde: se pliega.
 *
 *  «RuntimeError: No LLM provider configured. Run `hermes model`…» fue el error
 *  real de las dos corridas de la veterinaria. Mostrarlo así es un susto y una
 *  orden que ella no puede cumplir; borrarlo es volver a taparle la verdad.
 *
 *  Y ESTE BLOQUE YA NO SE SUPRIME NUNCA. En Faro, un flujo que fallaba por «no
 *  LLM provider» mostraba «Le falta una conexión · Conectar correo» y el motivo
 *  verdadero desaparecía: la clienta conecta el correo y vuelve a fallar. La
 *  conexión que falta es información secundaria y va abajo, en su propio
 *  bloque; la causa real se cuenta siempre. */
export function PorQueNoPudo({ cfg, e, nombre, onCambio }: {
  cfg?: PortalConfig;
  e: EstadoReal;
  nombre?: string;
  onCambio?: () => void;
}) {
  const [verCrudo, setVerCrudo] = useState(false);
  useVuelos();
  const nota: Nota | null = e.nota;
  if (!nota) return null;
  const vuelo = vueloDe(e.jobId);
  const corriendo = enElAire(vuelo);
  const coral = nota.tono === "coral";

  return (
    <div className={`rounded-lg border p-3 ${
      coral ? "border-c-coral bg-c-coral/25" : "border-c-amber bg-c-amber/25"
    }`}>
      <p className={`text-[13px] font-semibold leading-snug ${
        coral ? "text-c-coral-ink" : "text-c-amber-ink"
      }`}>
        {nota.que}
      </p>
      <p className={`mt-1 text-[12.5px] leading-relaxed ${
        coral ? "text-c-coral-ink/85" : "text-c-amber-ink/85"
      }`}>
        {nota.detalle}
      </p>

      {/* EL REINTENTO VA PRIMERO. Para «no llm provider» la pantalla decía
          "esto no lo destrabás vos" y ofrecía solo Avisanos — y la corrida que
          se destrabó en el laboratorio se destrabó justo con este botón. */}
      {nota.reintento && cfg && e.jobId && (
        <div className="mt-2">
          <p className={`mb-1.5 text-[12.5px] leading-relaxed ${
            coral ? "text-c-coral-ink/85" : "text-c-amber-ink/85"
          }`}>
            Puede ser algo pasajero: probalo ahora y fijate.
          </p>
          <button
            onClick={() => correrUnaVez(
              cfg, e.jobId as string,
              { pausado: e.pausado, huella: e.huella },
              onCambio ?? (() => {}),
            )}
            disabled={corriendo}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-[13px] font-semibold text-white transition hover:bg-primary-dark disabled:opacity-50"
          >
            {corriendo
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <Zap className="h-3.5 w-3.5" />}
            Probarlo ahora
          </button>
          {e.pausado && (
            <span className="ml-2 text-[12px] text-c-coral-ink/80">
              Lo corro una vez y sigue en pausa.
            </span>
          )}
        </div>
      )}

      {nota.reprogramar && nombre && (
        <Link
          href={linkArmar(
            `El flujo "${nombre}" no tiene ninguna tarea programada que lo dispare. ` +
            "Volvé a programarlo como estaba y confirmame el día y la hora que le dejaste.")}
          className="mt-2 inline-flex h-8 items-center rounded-lg bg-primary px-3 text-[13px] font-semibold text-white transition hover:bg-primary-dark"
        >
          Pedirle que lo vuelva a programar
        </Link>
      )}

      {nota.hace && (
        <p className={`mt-2 text-[12.5px] leading-relaxed ${
          coral ? "text-c-coral-ink/85" : "text-c-amber-ink/85"
        }`}>
          {nota.hace}
        </p>
      )}

      {nota.avisanos && (
        <div className="mt-2">
          <a
            href={SOPORTE.whatsapp}
            target="_blank"
            rel="noopener noreferrer"
            className={`text-[12.5px] font-semibold underline underline-offset-2 ${
              coral ? "text-c-coral-ink" : "text-c-amber-ink"
            }`}
          >
            {nota.reintento || nota.reprogramar
              ? "Si vuelve a pasar, avisanos y lo miramos"
              : "Avisanos para que lo miremos"}
          </a>
        </div>
      )}

      {nota.crudo && (
        <div className="mt-2">
          <button
            onClick={() => setVerCrudo((v) => !v)}
            className={`text-[11.5px] font-semibold underline underline-offset-2 transition ${
              coral ? "text-c-coral-ink/80 hover:text-c-coral-ink" : "text-c-amber-ink/80 hover:text-c-amber-ink"
            }`}
          >
            {verCrudo ? "Ocultar el detalle técnico" : "Ver el detalle técnico"}
          </button>
          {verCrudo && (
            <p className="mt-1.5 break-words rounded-md bg-white/60 p-2 font-mono text-[11px] leading-relaxed text-ink-soft">
              {nota.crudo}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

type Aviso = { texto: string; ok: boolean } | null;

/** Pausar, reanudar, probarlo ahora — y pedir el cambio de horario.
 *
 *  «No lo puedo pausar, ni cambiarle el día, ni probarlo ahora» — los tres
 *  salieron en los dos informes. Pausar, reanudar y correr son verbos NATIVOS
 *  del motor (`POST /api/jobs/{id}/{pause|resume|run}`), pasan CORS y estaban
 *  ahí desde el principio: son botones de verdad.
 *
 *  PERO "correr" NO ERA "correr": el motor lo implementa despausando el flujo
 *  (ver el guardián en `corridas.ts`), así que el botón le desarmaba en
 *  silencio la única válvula que el cliente había accionado a propósito. Ahora
 *  "Probarlo ahora" sobre un flujo pausado lo corre UNA vez y le devuelve la
 *  pausa, y lo dice antes y después.
 *
 *  Cambiar el día NO se puede todavía —es `PATCH /api/jobs/{id}` y el gateway
 *  no publica PATCH en `Access-Control-Allow-Methods`, verificado contra el
 *  laboratorio; queda anotado en `docs/PENDIENTES.md`—. Mientras tanto el botón
 *  no se calla ni miente: lleva al chat con el pedido ya escrito, que es lo que
 *  las dos clientas terminaron haciendo a mano. */
export function AccionesFlujo({ cfg, e, nombre, gatillo, onCambio }: {
  cfg: PortalConfig;
  e: EstadoReal;
  nombre: string;
  gatillo?: string;
  onCambio: () => void;
}) {
  const [ocupado, setOcupado] = useState<"pause" | "resume" | null>(null);
  const [aviso, setAviso] = useState<Aviso>(null);
  useVuelos();
  const vuelo = vueloDe(e.jobId);
  const volando = enElAire(vuelo);

  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), 12_000);
    return () => clearTimeout(t);
  }, [aviso]);

  const hacer = useCallback(async (accion: "pause" | "resume") => {
    if (!e.jobId) return;
    setOcupado(accion);
    setAviso(null);
    try {
      await jobAction(cfg, e.jobId, accion);
      setAviso({
        ok: true,
        texto: accion === "pause"
          ? "Pausado. No va a correr hasta que lo reanudes."
          : "Listo, vuelve a correr en el horario de siempre.",
      });
      onCambio();
    } catch (err) {
      setAviso({
        ok: false,
        texto: `No pude (${err instanceof Error ? err.message : "error"}). Probá de nuevo en un rato.`,
      });
    } finally {
      setOcupado(null);
    }
  }, [cfg, e.jobId, onCambio]);

  // Sin tarea programada no hay nada que pausar ni disparar. Callarse acá es
  // más honesto que un botón muerto — lo que NO puede pasar es que el silencio
  // sea toda la explicación: de eso se encargan `CartelEstado` y `PorQueNoPudo`.
  if (!e.jobId) return null;

  const pedidoHorario = linkArmar(
    `Quiero cambiarle el día y la hora al flujo "${nombre}"` +
    (gatillo ? ` (hoy corre así: ${gatillo}).` : ".") +
    " Decime cuándo puede correr y dejámelo cambiado.");

  // Cuando la explicación de arriba ya ofrece el reintento como primer paso,
  // el botón no se repite: sería el mismo verbo dos veces en la misma tarjeta.
  const correrArriba = Boolean(e.nota?.reintento);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {!correrArriba && (
          <BotonChico
            onClick={() => correrUnaVez(
              cfg, e.jobId as string, { pausado: e.pausado, huella: e.huella }, onCambio)}
            cargando={volando}
            disabled={volando || ocupado !== null || e.corriendo}
            icon={Zap}
          >
            Probarlo ahora
          </BotonChico>
        )}
        {e.pausado ? (
          <BotonChico
            onClick={() => hacer("resume")}
            cargando={ocupado === "resume"}
            disabled={volando || ocupado !== null}
            icon={Play}
          >
            Reanudar
          </BotonChico>
        ) : (
          <BotonChico
            onClick={() => hacer("pause")}
            cargando={ocupado === "pause"}
            disabled={volando || ocupado !== null}
            icon={Pause}
          >
            Pausar
          </BotonChico>
        )}
        <Link
          href={pedidoHorario}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-black/10 bg-white px-2.5 text-[12.5px] font-semibold text-ink transition hover:bg-black/[0.03]"
        >
          <CalendarClock className="h-3.5 w-3.5" />
          Cambiar día u hora
        </Link>
      </div>

      {/* ANTES de tocarlo: sobre un flujo pausado, "Probarlo ahora" no lo
          reanuda. Se dice acá para que la decisión se tome informada, y de
          nuevo cuando termina. */}
      {e.pausado && !vuelo && !correrArriba && (
        <p className="text-[12.5px] leading-snug text-ink-soft">
          &laquo;Probarlo ahora&raquo; lo corre una sola vez: sigue en pausa.
        </p>
      )}

      {vuelo && (
        <p className={`text-[12.5px] font-medium leading-snug ${
          vuelo.ok ? "text-c-green-ink" : "text-c-coral-ink"
        }`}>
          {vuelo.mensaje}
        </p>
      )}
      {aviso && (
        <p className={`text-[12.5px] font-medium leading-snug ${
          aviso.ok ? "text-c-green-ink" : "text-c-coral-ink"
        }`}>
          {aviso.texto}
        </p>
      )}
    </div>
  );
}

function BotonChico({ onClick, cargando, disabled, icon: Icon, children }: {
  onClick: () => void;
  cargando: boolean;
  disabled?: boolean;
  icon: typeof Zap;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-black/10 bg-white px-2.5 text-[12.5px] font-semibold text-ink transition hover:bg-black/[0.03] disabled:opacity-50"
    >
      {cargando
        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
        : <Icon className="h-3.5 w-3.5" />}
      {children}
    </button>
  );
}
