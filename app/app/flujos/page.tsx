"use client";

// Flujos: los trabajos del cliente, con nombre y resultados. Es la pestaña que
// responde "¿qué hace mi agente por mí?" sin una palabra de máquina — la
// conclusión del artículo de WIRED aplicada al portal (7/8, con Luis): el
// cliente no quiere ver crons ni scripts; quiere ver sus flujos y lo que
// producen. El cron, las skills y las carpetas son el CÓMO y quedan abajo.
//
// Contrato (adapter ≥0.29): GET {adapter}/portal/flujos →
//   { disponible, flujos: [{ slug, nombre, para_cliente, gatillo_tipo,
//     gatillo, estado, conexiones_faltan, ultima_corrida, resultados,
//     resultados_total }] }
//
// Los resultados se muestran como chips de archivo (EntityChip): el mismo
// visor del chat, cero código nuevo de preview.
//
// Y DESDE EL 13/8 DICE LA VERDAD SOBRE LA ÚLTIMA CORRIDA. Esta pantalla existe
// para que el cliente se pueda olvidar del tema; mostrando "Activo" en verde
// sobre dos flujos que ya habían fallado hacía exactamente lo contrario. El
// cruce con las tareas del motor (`/api/jobs`) vive en `corridas.ts`.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle, ArrowRight, Clock, FolderOpen, MessageSquare, RefreshCw,
  WifiOff, Workflow, Zap, type LucideIcon,
} from "lucide-react";
import {
  etiquetaConexion, getConnections, getFlujos, getJobs, loadConfig,
  type Connection, type CronJob, type Flujo, type HttpError, type PortalConfig,
} from "../lib/agent";
import {
  cruzarTarea, enElAire, estadoReal, ordenarPorUrgencia, resumirFlujos,
  retomarRepausas, useVuelos, vueloDe, type EstadoReal,
} from "./corridas";
import { AccionesFlujo, CartelEstado, Corridas, PorQueNoPudo } from "./EstadoFlujo";
import { EntityProvider } from "../lib/EntityViewer";
import { EntityChip } from "../lib/entities";
import { CarruselEjemplos, linkArmar } from "../lib/ejemplosFlujos";
import {
  Card, ErrorState, IconBtn, PageHeader, Spinner,
} from "../lib/ui";

type Falla = { status?: number; message: string };

const WRAP = "mx-auto max-w-5xl px-6 py-6 md:px-8";
const REFRESH_MS = 30_000;
// Tras tocar un botón el motor tarda un instante en escribir el nuevo estado:
// una segunda lectura a los 6 s evita que "Probarlo ahora" se vea sin efecto.
const RELEER_MS = 6_000;

const es404 = (f: Falla) => f.status === 404 || /^404\b/.test(f.message);

const GATILLO_ICON: Record<string, LucideIcon> = {
  drive: FolderOpen,
  horario: Clock,
  webhook: Zap,
  pedido: MessageSquare,
};

function hace(mtime: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000 - mtime));
  if (s < 3600) return `hace ${Math.max(1, Math.floor(s / 60))} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  const d = Math.floor(s / 86400);
  return d === 1 ? "ayer" : `hace ${d} días`;
}

function nombreArchivo(path: string): string {
  const base = (path || "").split("/").pop() || path;
  return base.replace(/^\d{4}-\d{2}-\d{2}[-_ ]/, "") || base;
}

/** Qué le falta a este flujo, cómo se llama y para qué sirve. */
function FaltaConexion({ ids, conexiones }: {
  ids: string[]; conexiones: Connection[] | null;
}) {
  const nombres = ids.map((id) => etiquetaConexion(id, conexiones));
  const porQue = ids
    .map((id) => conexiones?.find((c) => c.id === id)?.para_que)
    .filter(Boolean) as string[];
  return (
    <div className="rounded-lg border border-c-amber bg-c-amber/25 p-3">
      <p className="text-[13px] font-semibold text-c-amber-ink">
        Le falta {nombres.length === 1 ? nombres[0] : nombres.join(" y ")}.
      </p>
      {porQue.length > 0 && (
        <p className="mt-1 text-[12.5px] leading-relaxed text-c-amber-ink/85">
          {porQue.join(" ")}
        </p>
      )}
      <Link
        href={`/app/conexiones?conexion=${encodeURIComponent(ids[0])}`}
        className="mt-2.5 inline-flex h-9 w-fit items-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-semibold text-white transition hover:bg-primary-dark"
      >
        Conectar {nombres[0]}
        <ArrowRight className="h-4 w-4" />
      </Link>
    </div>
  );
}

function TarjetaFlujo({ f, e, cfg, conexiones, onCambio }: {
  f: Flujo;
  e: EstadoReal;
  cfg: PortalConfig;
  conexiones: Connection[] | null;
  onCambio: () => void;
}) {
  const Icono = GATILLO_ICON[f.gatillo_tipo] ?? Workflow;
  return (
    <Card className="flex flex-col gap-2.5">
      <div className="flex items-start justify-between gap-3">
        <Link
          href={`/app/flujos/${f.slug}`}
          className="text-[16px] font-bold leading-snug text-ink underline-offset-4 transition hover:text-primary hover:underline"
        >
          {f.nombre}
        </Link>
        <span className="shrink-0"><CartelEstado e={e} /></span>
      </div>

      {f.para_cliente && (
        <p className="text-sm leading-relaxed text-ink-soft">{f.para_cliente}</p>
      )}

      {f.gatillo && (
        <p className="flex items-center gap-1.5 text-[12px] text-ink-soft/90">
          <Icono className="h-3.5 w-3.5 shrink-0" />
          {f.gatillo}
        </p>
      )}

      {/* Corrió / no corrió / cuándo es la próxima. Las tres preguntas que la
          tarjeta no contestaba mientras decía "Activo" en verde. */}
      <Corridas e={e} />

      {/* PRIMERO EL MOTIVO REAL, SIEMPRE. Esto era un ternario: si faltaba una
          conexión, `PorQueNoPudo` no se dibujaba y la causa verdadera
          desaparecía. En Faro eso se veía como "Le falta correo · Conectar
          correo" sobre una corrida que había fallado por otra cosa: la clienta
          conecta el correo y vuelve a fallar. */}
      <PorQueNoPudo cfg={cfg} e={e} nombre={f.nombre} onCambio={onCambio} />

      {/* La conexión que falta, SEGUNDA y por separado: es lo único que el
          cliente puede destrabar solo, pero no es un diagnóstico. Y con NOMBRE
          y MOTIVO: "Conectar lo que falta" no dice qué falta ni para qué, y al
          llegar a Conexiones el cliente se perdía entre seis tarjetas sin
          saber cuál era la suya. El "para qué" sale del catálogo, que ya lo
          tiene escrito en criollo — no lo inventamos acá. */}
      {e.faltan.length > 0 && (
        <FaltaConexion ids={e.faltan} conexiones={conexiones} />
      )}

      {f.resultados.length > 0 && (
        <div>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
            Resultados
            <span className="ml-1.5 tabular-nums text-ink-soft/70">{f.resultados_total}</span>
          </p>
          <ul className="flex flex-col gap-1">
            {f.resultados.slice(0, 5).map((r) => (
              <li key={r.path} className="flex items-center gap-2">
                <span className="min-w-0 flex-1">
                  <EntityChip
                    entity={{ kind: "file", path: r.path }}
                    label={nombreArchivo(r.path)}
                  />
                </span>
                <span className="shrink-0 whitespace-nowrap text-[11px] text-ink-soft">
                  {hace(r.mtime)}
                </span>
              </li>
            ))}
          </ul>
          {f.resultados_total > 5 && (
            <Link
              href="/app/archivos"
              className="mt-1.5 inline-block text-[12px] font-semibold text-primary transition hover:text-primary-dark"
            >
              Ver todos en Archivos
            </Link>
          )}
        </div>
      )}

      {/* "Todavía no produjo resultados" sobre un flujo que corrió y falló era
          la misma mentira en voz baja: ahí no es que todavía no produjo, es que
          no pudo. Se calla siempre que haya algo que contar —incluso pausado,
          que es como queda un flujo roto que el cliente frenó. */}
      {!e.nota && e.faltan.length === 0 && !e.sinConfirmar && f.resultados.length === 0 && (
        <p className="text-[12px] text-ink-soft/80">
          Todavía no produjo resultados: van a aparecer acá solos.
        </p>
      )}

      <AccionesFlujo cfg={cfg} e={e} nombre={f.nombre} gatillo={f.gatillo} onCambio={onCambio} />
    </Card>
  );
}

/** ¿Me puedo olvidar del tema? La pregunta con la que la veterinaria entró y
 *  salió sin respuesta. Una línea arriba de todo, y solo cuando hay algo que
 *  decir: cuando está todo bien la pantalla se calla y las tarjetas hablan.
 *
 *  EL TEXTO SE ARMA EN `corridas.ts`, al lado de los estados que cuenta. Acá
 *  vivía la última mentira que quedaba en esta pantalla —"N no pudieron
 *  terminar la última vez" sobre flujos atrasados o sin cron que habían corrido
 *  bien—, y la cuenta no se podía probar sin montar React. */
function Resumen({ estados }: { estados: EstadoReal[] }) {
  const texto = resumirFlujos(estados);
  if (!texto) return null;
  return (
    <div className="mb-4 flex items-start gap-2 rounded-lg border border-c-coral bg-c-coral/25 px-3 py-2.5">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-c-coral-ink" />
      <p className="text-[13px] font-medium leading-snug text-c-coral-ink">{texto}</p>
    </div>
  );
}

/** Sin el cruce con `/api/jobs` la pantalla corre con datos parciales, y eso
 *  se dice. Verificado con el gateway caído: un flujo pausado se veía "Activo"
 *  en verde, los botones desaparecían sin explicación y no había una sola
 *  palabra sobre que faltaba media pantalla. */
function SinCruce() {
  return (
    <div className="mb-4 flex items-start gap-2 rounded-lg border border-c-amber bg-c-amber/25 px-3 py-2.5">
      <WifiOff className="mt-0.5 h-4 w-4 shrink-0 text-c-amber-ink" />
      <p className="text-[13px] font-medium leading-snug text-c-amber-ink">
        No pude confirmar el estado con tu agente. Abajo está lo último que sé —
        puede haber cambiado, y no puedo decirte si alguno quedó en pausa.
      </p>
    </div>
  );
}

function SinFlujos() {
  return (
    <div>
      <div className="mx-auto max-w-xl text-center">
        <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-c-violet">
          <Workflow className="h-5 w-5 text-primary" />
        </div>
        <h2 className="text-[19px] font-bold tracking-tight text-ink">
          Todavía no hay nada corriendo solo
        </h2>
        <p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-ink-soft">
          Un flujo es un trabajo que tu agente hace sin que se lo pidas: se ocupa
          cada vez que corresponde y te deja el resultado acá para que lo revises.
          Estos son ejemplos de lo que le pide otra gente — el tuyo va a salir de
          contarle a qué te dedicás.
        </p>
      </div>

      <div className="mt-7"><CarruselEjemplos /></div>

      <div className="mt-6 flex flex-col items-center gap-2">
        <Link
          href={linkArmar(
            "Quiero que te encargues de algo que se repite en mi empresa. " +
            "Proponeme dos o tres cosas que podrías hacer solo, de a una por " +
            "vez, y armamos la que más me sirva.")}
          className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-white transition hover:bg-primary-dark"
        >
          Contarle lo mío
        </Link>
        <span className="text-[12px] text-ink-soft">
          O tocá uno de arriba y lo armamos a partir de ahí.
        </span>
      </div>
    </div>
  );
}

export default function FlujosPage() {
  const [cfg, setCfg] = useState<PortalConfig | null>(null);
  const [flujos, setFlujos] = useState<Flujo[] | null>(null);
  // Las tareas programadas del motor: son las que saben cuándo corre la
  // próxima, por qué falló la última y si está pausada. Si el gateway no
  // contesta, `jobs` queda en null y la tarjeta cae al `ultima_corrida` del
  // adapter: dice menos, pero sigue sin mentir.
  const [jobs, setJobs] = useState<CronJob[] | null>(null);
  const [err, setErr] = useState<Falla | null>(null);
  const [cargando, setCargando] = useState(false);
  // Solo para poder nombrar la conexión que falta y decir para qué sirve.
  const [conexiones, setConexiones] = useState<Connection[] | null>(null);

  useEffect(() => setCfg(loadConfig()), []);

  useEffect(() => {
    if (!cfg) return;
    getConnections(cfg)
      .then((r) => setConexiones(r.conexiones ?? []))
      .catch(() => { /* sin catálogo caemos a los rótulos conocidos */ });
  }, [cfg]);

  const cargar = useCallback(() => {
    if (!cfg) return;
    setCargando(true);
    getJobs(cfg)
      .then((r) => setJobs(Array.isArray(r?.jobs) ? r.jobs : []))
      .catch(() => setJobs(null));
    getFlujos(cfg)
      .then((r) => { setFlujos(r?.flujos ?? []); setErr(null); })
      .catch((e: HttpError) => setErr({ status: e?.status, message: e?.message || "error" }))
      .finally(() => setCargando(false));
  }, [cfg]);

  // Después de pausar, reanudar o disparar: ahora y de nuevo en un rato.
  const releer = useCallback(() => {
    cargar();
    const t = setTimeout(cargar, RELEER_MS);
    return () => clearTimeout(t);
  }, [cargar]);

  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => {
    if (!cfg) return;
    const t = setInterval(cargar, REFRESH_MS);
    return () => clearInterval(t);
  }, [cfg, cargar]);

  // Un re-pausado que quedó a medias (un F5 justo entre el "run" y el "pause")
  // se retoma al entrar: la pausa no puede depender de que la pestaña siguiera
  // abierta. Ver el guardián en `corridas.ts`.
  useEffect(() => { if (cfg) retomarRepausas(cfg, cargar); }, [cfg, cargar]);

  // Las corridas que disparó el propio portal y el motor todavía no anotó:
  // mientras están en vuelo la tarjeta tiene que decir que está trabajando, no
  // mostrar la corrida anterior con el botón habilitado.
  const v = useVuelos();
  const conEstado = useMemo(
    () => ordenarPorUrgencia(
      (flujos ?? []).map((f) => {
        const cruce = cruzarTarea(f, jobs);
        const jobId = cruce.tipo === "tarea" ? cruce.job.id : null;
        return {
          flujo: f,
          estado: estadoReal(f, cruce, { enVuelo: enElAire(vueloDe(jobId)) }),
        };
      })),
    // `v` es la versión del registro de vuelos: cambia con cada transición.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [flujos, jobs, v],
  );

  if (!cfg) return <div className={WRAP}><Spinner /></div>;

  const cuerpo = () => {
    if (err && flujos === null) {
      if (es404(err)) {
        return <SinFlujos />;
      }
      return <ErrorState message={err.message} onRetry={cargar} />;
    }
    if (flujos === null) return <Spinner />;
    if (flujos.length === 0) return <SinFlujos />;
    return (
      <>
        {jobs === null && <SinCruce />}
        <Resumen estados={conEstado.map((x) => x.estado)} />
        <div className="grid items-start gap-3 md:grid-cols-2">
          {conEstado.map(({ flujo, estado }) => (
            <TarjetaFlujo
              key={flujo.slug}
              f={flujo}
              e={estado}
              cfg={cfg}
              conexiones={conexiones}
              onCambio={releer}
            />
          ))}
        </div>
      </>
    );
  };

  return (
    <EntityProvider cfg={cfg}>
      <div className={WRAP}>
        <PageHeader
          title="Flujos"
          subtitle="Los trabajos que tu agente hace por vos, y lo que producen"
          actions={
            <IconBtn label="Actualizar" disabled={cargando} onClick={cargar}>
              <RefreshCw className={`h-4 w-4 ${cargando ? "animate-spin" : ""}`} />
            </IconBtn>
          }
        />
        {cuerpo()}
      </div>
    </EntityProvider>
  );
}
