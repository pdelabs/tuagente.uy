"use client";

// El estado de un flujo, contado entero: el cartel, cuándo corrió, cómo salió,
// cuándo es la próxima, por qué no pudo — y los botones para tocarlo.
//
// Vive acá y no en cada página porque la lista y el detalle mostraban el mismo
// chip verde con dos copias del mismo ternario, y las dos mentían igual.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CalendarClock, CheckCircle2, Loader2, Pause, Play, Zap } from "lucide-react";
import { jobAction, type PortalConfig } from "../lib/agent";
import { Chip, SOPORTE } from "../lib/ui";
import { linkArmar } from "../lib/ejemplosFlujos";
import type { EstadoReal } from "./corridas";

export function CartelEstado({ e }: { e: EstadoReal }) {
  return <Chip tone={e.tono}>{e.cartel}</Chip>;
}

/** Las dos líneas que las dos clientas pidieron por separado: qué pasó la
 *  última vez y cuándo es la próxima. */
export function Corridas({ e, className = "" }: { e: EstadoReal; className?: string }) {
  if (!e.ultima && !e.proxima) return null;
  return (
    <div className={`flex flex-col gap-0.5 ${className}`}>
      {e.ultima && (
        <p className={`flex items-center gap-1.5 text-[12.5px] ${
          e.clave === "fallo" ? "font-semibold text-c-coral-ink" : "text-ink-soft"
        }`}>
          {e.clave === "fallo"
            ? <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            : e.clave === "bien"
              ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-c-green-ink" />
              : null}
          {e.ultima}
        </p>
      )}
      {e.proxima && <p className="text-[12.5px] text-ink-soft">{e.proxima}</p>}
    </div>
  );
}

/** Qué pasó y qué se puede hacer. El texto del motor no se esconde: se pliega.
 *
 *  «RuntimeError: No LLM provider configured. Run `hermes model`…» fue el error
 *  real de las dos corridas de la veterinaria. Mostrarlo así es un susto y una
 *  orden que ella no puede cumplir; borrarlo es volver a taparle la verdad. */
export function PorQueNoPudo({ e }: { e: EstadoReal }) {
  const [verCrudo, setVerCrudo] = useState(false);
  if (!e.falla) return null;
  const { que, hace, nuestro, crudo } = e.falla;
  return (
    <div className="rounded-lg border border-c-coral bg-c-coral/25 p-3">
      <p className="text-[13px] font-semibold leading-snug text-c-coral-ink">{que}</p>
      <p className="mt-1 text-[12.5px] leading-relaxed text-c-coral-ink/85">
        Lo que ya te dejó hecho no se pierde, y vuelve a intentarlo en la próxima
        corrida{hace ? `. ${hace}` : nuestro ? ", pero esto no lo destrabás vos: es de nuestro lado." : "."}
      </p>
      {nuestro && (
        <a
          href={SOPORTE.whatsapp}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex h-8 items-center rounded-lg bg-primary px-3 text-[13px] font-semibold text-white transition hover:bg-primary-dark"
        >
          Avisanos para que lo miremos
        </a>
      )}
      {crudo && (
        <div className="mt-2">
          <button
            onClick={() => setVerCrudo((v) => !v)}
            className="text-[11.5px] font-semibold text-c-coral-ink/80 underline underline-offset-2 transition hover:text-c-coral-ink"
          >
            {verCrudo ? "Ocultar el detalle técnico" : "Ver el detalle técnico"}
          </button>
          {verCrudo && (
            <p className="mt-1.5 break-words rounded-md bg-white/60 p-2 font-mono text-[11px] leading-relaxed text-ink-soft">
              {crudo}
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
  const [ocupado, setOcupado] = useState<"pause" | "resume" | "run" | null>(null);
  const [aviso, setAviso] = useState<Aviso>(null);

  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), 12_000);
    return () => clearTimeout(t);
  }, [aviso]);

  const hacer = useCallback(async (accion: "pause" | "resume" | "run") => {
    if (!e.jobId) return;
    setOcupado(accion);
    setAviso(null);
    try {
      await jobAction(cfg, e.jobId, accion);
      setAviso({
        ok: true,
        texto:
          accion === "pause"
            ? "Pausado. No va a correr hasta que lo reanudes."
            : accion === "resume"
              ? "Listo, vuelve a correr en el horario de siempre."
              : "Lo mandé a correr ahora. Puede tardar unos minutos; el resultado aparece acá solo.",
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

  // Sin tarea programada no hay nada que pausar ni disparar: el flujo corre
  // cuando el cliente lo pide. Callarse es más honesto que un botón muerto.
  if (!e.jobId) return null;

  const pedidoHorario = linkArmar(
    `Quiero cambiarle el día y la hora al flujo "${nombre}"` +
    (gatillo ? ` (hoy corre así: ${gatillo}).` : ".") +
    " Decime cuándo puede correr y dejámelo cambiado.");

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <BotonChico
          onClick={() => hacer("run")}
          cargando={ocupado === "run"}
          disabled={ocupado !== null}
          icon={Zap}
        >
          Probarlo ahora
        </BotonChico>
        {e.pausado ? (
          <BotonChico
            onClick={() => hacer("resume")}
            cargando={ocupado === "resume"}
            disabled={ocupado !== null}
            icon={Play}
          >
            Reanudar
          </BotonChico>
        ) : (
          <BotonChico
            onClick={() => hacer("pause")}
            cargando={ocupado === "pause"}
            disabled={ocupado !== null}
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
