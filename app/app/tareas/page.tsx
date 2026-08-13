"use client";

// Tareas: consola de operador sobre los crons del agente (GET /api/jobs).
// Lista plana en una Card con filas divididas + pausar/reanudar/correr ahora
// con confirmación inline. Sin crear/editar/borrar: ventana, no jaula.
// getJobs ya pide ?include_disabled=true, así que los pausados vienen en el
// listado y no hace falta retención local.
//
// Cada fila abre un detalle (Modal) con la consigna con la que corre la tarea
// y el historial de corridas: GET {adapter}/portal/crons/{id}.

import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Clock, Eye, Pause, Play, TriangleAlert, X, Zap } from "lucide-react";
import {
  loadConfig, getCronDetail, getFlujos, getJobs, jobAction,
  type CronDetail, type Flujo, type PortalConfig,
} from "../lib/agent";
import { aprenderHuso, estadoDeProgramada, fechaYHora, momento } from "../lib/palabras";
import {
  AvisoLinkViejo, Btn, Card, Chip, EmptyState, ErrorState, IconBtn, Modal, PageHeader, Spinner,
} from "../lib/ui";
import { CopiarLink, PARAM, abrirEnRuta, cerrarEnRuta, useParamRuta } from "../lib/rutas";

// ── Tipos (shape real de /api/jobs, verificado contra el agente) ──

type Schedule = {
  kind?: string; // "cron" | "interval" | "once"
  expr?: string; // cron de 5 campos
  minutes?: number; // para kind "interval"
  run_at?: string; // para kind "once"
  display?: string;
} | null;

type Job = {
  id: string;
  name: string;
  enabled: boolean;
  state?: string | null; // "scheduled" | "paused" | "running" | ...
  schedule?: Schedule;
  schedule_display?: string | null;
  next_run_at?: string | null;
  last_run_at?: string | null;
  last_status?: string | null; // "ok" | "error" | ...
  last_error?: string | null;
};

type Action = "pause" | "resume" | "run";

function describirError(e: unknown): string {
  const status = (e as { status?: number } | null)?.status;
  if (status === 404) return "tu agente no tiene el detalle de esta tarea";
  if (status === 401 || status === 403) return "tu sesión venció: volvé a entrar con tu link";
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes("Failed to fetch") || msg.includes("NetworkError"))
    return "no hay conexión con tu agente";
  return msg;
}

// ── Copy ──

const CONFIRM_Q: Record<Action, (name: string) => string> = {
  pause: (n) => `¿Pausar «${n}»?`,
  resume: (n) => `¿Reanudar «${n}»?`,
  run: (n) => `¿Correr «${n}» ahora?`,
};
const NOTICE_OK: Record<Action, (name: string) => string> = {
  pause: (n) => `Tarea «${n}» pausada.`,
  resume: (n) => `Tarea «${n}» reanudada.`,
  run: (n) => `Corrida de «${n}» disparada.`,
};

// ── Nombres ──

// EL SLUG NO ES UN NOMBRE. La tarea del flujo se llama, del lado del motor,
// `flujo-revision-precios-proveedores`, y así se le mostraba al cliente. Su
// flujo, en cambio, tiene el nombre que él le puso: «Revisión de precios de
// proveedores». Es el mismo trabajo escrito en dos idiomas y solo uno es el
// suyo. Sin la lista de flujos a mano, al menos se le sacan los guiones.
function nombreDeTarea(name: string, flujos: Flujo[] | null): string {
  const n = (name || "").trim();
  const m = /^flujo-(.+)$/.exec(n);
  if (!m) return n;
  const f = flujos?.find((x) => x.slug === m[1]);
  if (f?.nombre) return f.nombre;
  const limpio = m[1].replace(/-+/g, " ").trim();
  return limpio.charAt(0).toUpperCase() + limpio.slice(1);
}

// ── Cadencia legible ──

const DIAS_PLURAL = ["domingos", "lunes", "martes", "miércoles", "jueves", "viernes", "sábados"];

const two = (n: number) => String(n).padStart(2, "0");

function cadaN(n: number, singular: string, plural: string): string {
  return n === 1 ? `Cada ${singular}` : `Cada ${n} ${plural}`;
}

function diasLegible(dow: string): string | null {
  if (dow === "1-5") return "Lunes a viernes";
  if (dow === "0,6" || dow === "6,0") return "Sábados y domingos";
  if (/^[0-6]$/.test(dow)) return `Los ${DIAS_PLURAL[Number(dow)]}`;
  // Listas de días. Sin esto, «0 18 * * 1,3» no se reconocía y el cron crudo
  // pasaba a ser el texto principal de la fila: el flujo de la veterinaria que
  // corre lunes y miércoles se presentaba como "0 18 * * 1,3".
  if (/^[0-6](,[0-6])+$/.test(dow)) {
    const dias = Array.from(new Set(dow.split(",").map(Number))).sort()
      .map((d) => DIAS_PLURAL[d]);
    const ultimo = dias.pop()!;
    return `Los ${dias.join(", ")} y ${ultimo}`;
  }
  return null;
}

// Traduce los patrones cron comunes; devuelve null si no lo reconoce.
function cronLegible(expr: string): string | null {
  const p = expr.trim().split(/\s+/);
  if (p.length !== 5) return null;
  const [min, hour, dom, mon, dow] = p;
  if (mon !== "*") return null;
  const minFijo = /^\d+$/.test(min);
  const horaFija = /^\d+$/.test(hour);
  const hora = () => `${two(Number(hour))}:${two(Number(min))}`;

  if (minFijo && horaFija && dom === "*") {
    if (dow === "*") return `Todos los días a las ${hora()}`;
    const dias = diasLegible(dow);
    return dias ? `${dias} a las ${hora()}` : null;
  }
  if (minFijo && horaFija && /^\d+$/.test(dom) && dow === "*") {
    return `El día ${Number(dom)} de cada mes a las ${hora()}`;
  }
  const pasoHora = hour.match(/^\*\/(\d+)$/);
  if (minFijo && pasoHora && dom === "*" && dow === "*") {
    return cadaN(Number(pasoHora[1]), "hora", "horas");
  }
  const pasoMin = min.match(/^\*\/(\d+)$/);
  if (pasoMin && hour === "*" && dom === "*" && dow === "*") {
    return cadaN(Number(pasoMin[1]), "minuto", "minutos");
  }
  if (min === "*" && hour === "*" && dom === "*" && dow === "*") return "Cada minuto";
  return null;
}

// Devuelve la cadencia legible y, si difiere, el cron/schedule crudo como detalle.
function cadencia(job: Job): { legible: string; cruda: string | null } {
  const s = job.schedule;
  if (s?.kind === "interval" && typeof s.minutes === "number") {
    const m = s.minutes;
    const legible =
      m % 1440 === 0 ? cadaN(m / 1440, "día", "días")
      : m % 60 === 0 ? cadaN(m / 60, "hora", "horas")
      : cadaN(m, "minuto", "minutos");
    return { legible, cruda: s.display ?? null };
  }
  if (s?.kind === "cron" && s.expr) {
    const legible = cronLegible(s.expr);
    return legible ? { legible, cruda: s.expr } : { legible: s.expr, cruda: null };
  }
  if (s?.kind === "once") {
    const cuando = proximaLegible(s.run_at ?? job.next_run_at);
    return { legible: cuando ? `Una sola vez, ${cuando}` : "Una sola vez", cruda: s.display ?? null };
  }
  const raw = s?.display ?? job.schedule_display ?? null;
  return { legible: raw ?? "Sin cadencia", cruda: null };
}

// ── Fechas legibles ──

function haceLegible(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const min = Math.round((Date.now() - t) / 60000);
  if (min < 1) return "recién";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? "ayer" : `hace ${d} días`;
}

// LA MISMA FILA DECÍA DOS HORAS DISTINTAS: «Los lunes a las 09:00» y, al lado,
// «Próxima lun 17 ago a las 06:00». Son la misma corrida. La cadencia sale del
// cron —escrito en la hora del agente— y la próxima salía de `next_run_at`
// (que viene con su huso: "2026-08-17T09:00:00-03:00") formateada con el reloj
// del browser; con la máquina en México son tres horas de diferencia. Ahora las
// dos se leen en el reloj del negocio. Ver la nota en `lib/palabras.ts`.
function proximaLegible(iso: string | null | undefined): string | null {
  const m = momento(iso);
  if (!m) return null;
  if (m.dias === 0) return `hoy a las ${m.hora}`;
  if (m.dias === 1) return `mañana a las ${m.hora}`;
  return `${m.fechaCorta} a las ${m.hora}`;
}

// Fecha + hora de una corrida: "hoy 09:56", "ayer 04:07", "vie 1 ago 23:10".
// También en el reloj del negocio: el historial y la próxima corrida se leen
// uno debajo del otro y no pueden estar en husos distintos. La partición vive
// en `lib/palabras.ts` porque el modal de una tarea y el de un ticket muestran
// la misma clase de fecha y llegaron a mostrarla distinto.
const fechaHoraCorrida = fechaYHora;

// Cuánto tardó una corrida. null si todavía no terminó (o si las fechas no
// parsean): el chip de estado ya cuenta que sigue en curso.
function duracionLegible(inicio: string | null | undefined, fin: string | null | undefined): string | null {
  if (!inicio || !fin) return null;
  const a = new Date(inicio).getTime();
  const b = new Date(fin).getTime();
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return null;
  const ms = b - a;
  if (ms < 1000) return "<1 s";
  const seg = Math.round(ms / 1000);
  if (seg < 90) return `${seg} s`;
  const min = Math.round(seg / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const resto = min % 60;
  return resto === 0 ? `${h} h` : `${h} h ${resto} min`;
}

// ── Estados de corrida ──

type Tone = "violet" | "green" | "coral" | "amber" | "neutral";

const RUN_ESTADO: Record<string, { label: string; tone: Tone }> = {
  completed: { label: "completada", tone: "green" },
  failed: { label: "falló", tone: "coral" },
  running: { label: "corriendo", tone: "amber" },
  claimed: { label: "arrancando", tone: "amber" },
  unknown: { label: "sin confirmar", tone: "neutral" },
};

function estadoCorrida(status: string | null | undefined): { label: string; tone: Tone } {
  const s = (status ?? "").trim();
  return RUN_ESTADO[s] ?? { label: s || "sin estado", tone: "neutral" };
}

// Cómo entrega el resultado. Cualquier canal nuevo del agente se muestra crudo
// antes que esconderlo.
const CANAL_LABEL: Record<string, string> = {
  telegram: "Telegram",
  whatsapp: "WhatsApp",
  email: "Email",
  local: "Queda en el agente",
  // OJO: `origin` significa "a la sesión desde donde se creó la tarea". Si esa
  // sesión es del portal o de la API, NO puede recibir mensajes: la tarea corre
  // bien y el resultado no le llega a nadie, sin ningún aviso. Verificado el
  // 5/8: un vendedor pidió su hoja de ruta para los lunes a las 7 y la tarea
  // quedó así — habría esperado un mensaje que nunca iba a existir.
  origin: "A donde se pidió",
};

/** ¿Esta tarea corre y no le llega a nadie? */
const CANAL_SIN_DESTINO = new Set(["origin", "local"]);

// ── Página ──

const ordenar = (jobs: Job[]) => [...jobs].sort((a, b) => a.name.localeCompare(b.name));

// El shell no pone padding: cada página envuelve su contenido.
function Shell({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-4xl px-6 py-6 md:px-8">{children}</div>;
}

// Mismo chip de estado en la fila y en el detalle: una sola verdad. Qué dice
// —incluido que "Activa" en verde no puede convivir con "falló"— lo decide
// `estadoDeProgramada` en `lib/palabras.ts`.
const comoEsta = (estado: string | null | undefined, activa: boolean, fallo: boolean) =>
  estadoDeProgramada({ corriendo: estado === "running", pausada: !activa, fallo });

function EstadoChip({ estado, activa, fallo }: {
  estado?: string | null; activa: boolean; fallo?: boolean;
}) {
  const { label, tono } = comoEsta(estado, activa, Boolean(fallo));
  return <Chip tone={tono}>{label}</Chip>;
}

function Rotulo({ children }: { children: ReactNode }) {
  return (
    <p className="text-[11px] font-bold uppercase tracking-wide text-ink-soft/70">{children}</p>
  );
}

function Dato({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <Rotulo>{label}</Rotulo>
      <div className="mt-0.5 text-[13px] text-ink">{children}</div>
    </div>
  );
}

/** Detalle de una tarea: qué hace y cómo le fue las últimas veces. */
function DetalleTarea({ job, flujos, detalle, error, onRetry, onClose }: {
  job: Job; // el de la lista: es el único que trae el objeto `schedule` completo
  flujos: Flujo[] | null; // para titular con el nombre del cliente, no con el slug
  detalle: CronDetail | null;
  error: string | null;
  onRetry: () => void;
  onClose: () => void;
}) {
  const d = detalle?.job;
  const { legible, cruda } = cadencia(job);
  const activa = d?.enabled ?? job.enabled;
  const estado = d?.state ?? job.state;
  const proxima = activa ? proximaLegible(d?.next_run_at ?? job.next_run_at) : null;
  const modelo = (d?.model ?? "").trim();
  const canal = (d?.deliver ?? "").trim();
  const prompt = (d?.prompt ?? "").trim();
  const script = (d?.script ?? "").trim();
  const esScript = !prompt && !!script;
  const ultimoError = d?.last_error ?? job.last_error ?? null;
  const ultimoStatus = d?.last_status ?? job.last_status;
  const fallo = ultimoStatus != null && ultimoStatus !== "ok";
  const runs = detalle?.runs ?? [];

  return (
    <Modal wide onClose={onClose}>
      <div className="flex items-start justify-between gap-4 border-b border-black/[0.07] px-5 py-4">
        <div className="min-w-0">
          {/* El título del detalle mostraba el slug del motor
              («flujo-vacunas-vencidas-semanal») mientras la fila que lo abre ya
              decía el nombre del cliente. Es el mismo nombre en las dos. */}
          <h2 className="text-base font-bold leading-snug text-ink">
            {nombreDeTarea(job.name, flujos)}
          </h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span title={fallo ? ultimoError ?? undefined : undefined}>
              <EstadoChip estado={estado} activa={activa} fallo={fallo} />
            </span>
            {/* Pausada (o corriendo) Y rota: el chip de arriba cuenta lo
                primero, esto lo segundo. Una tarea en pausa sobre una corrida
                rota es justo la que hay que mirar antes de reanudarla. */}
            {fallo && !comoEsta(estado, activa, fallo).cuentaLaFalla && (
              <span title={ultimoError ?? undefined}>
                <Chip tone="coral">la última falló</Chip>
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <CopiarLink titulo="Copiar el link de esta tarea" />
          <IconBtn label="Cerrar" onClick={onClose}>
            <X className="h-4 w-4" />
          </IconBtn>
        </div>
      </div>

      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-5 py-4">
        {error ? (
          <ErrorState message={`No pude abrir el detalle (${error}).`} onRetry={onRetry} />
        ) : !detalle ? (
          <Spinner />
        ) : (
          <>
            <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              <Dato label="Cada cuánto">
                {legible}
                {cruda && cruda !== legible && (
                  <span className="ml-1.5 font-mono text-[11px] tabular-nums text-ink-soft/60">
                    {cruda}
                  </span>
                )}
              </Dato>
              {proxima && <Dato label="Próxima corrida">{proxima}</Dato>}
              {modelo && (
                <Dato label="Modelo">
                  <span className="font-mono text-[12px]">{modelo}</span>
                </Dato>
              )}
              {canal && <Dato label="Te llega por">{CANAL_LABEL[canal] ?? canal}</Dato>}
            </div>

            {/* Un cron sin canal de verdad corre perfecto y no avisa a nadie.
                Es la falla más silenciosa que tiene el sistema: mejor decirlo
                acá que dejar al cliente esperando un mensaje que no existe. */}
            {canal && CANAL_SIN_DESTINO.has(canal) && (
              <p className="mt-3 flex items-start gap-1.5 rounded-lg border border-c-amber bg-c-amber/30 px-3 py-2 text-[12px] text-c-amber-ink">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  Esta tarea corre, pero <strong>el resultado no te llega por ningún lado</strong>:
                  queda guardado en tu agente. Si querés recibirla, pedinos que le pongamos un
                  canal (Telegram, WhatsApp o correo).
                </span>
              </p>
            )}

            {/* Lo más valioso del detalle: la consigna tal cual corre. */}
            <div className="mt-5">
              <Rotulo>{esScript ? "Corre un script" : "Qué hace esta tarea"}</Rotulo>
              <p className="mt-0.5 text-[12px] text-ink-soft">
                {esScript
                  ? "Esta tarea no pasa por el modelo: ejecuta este script en el servidor de tu agente."
                  : "Es la consigna con la que corre, tal cual se la damos al agente. No es una descripción escrita a mano."}
              </p>
              {prompt || script ? (
                <div className="mt-2 max-h-64 overflow-y-auto rounded-lg bg-black/[0.03] p-3">
                  <p
                    className={`whitespace-pre-wrap break-words leading-relaxed text-ink-soft ${
                      esScript ? "font-mono text-[12px]" : "text-[12.5px]"
                    }`}
                  >
                    {esScript ? script : prompt}
                  </p>
                </div>
              ) : (
                <p className="mt-2 text-[13px] text-ink-soft">
                  Tu agente no guarda una consigna para esta tarea.
                </p>
              )}
            </div>

            <div className="mt-5">
              <Rotulo>Últimas corridas</Rotulo>
              {runs.length === 0 ? (
                <p className="mt-1 text-[13px] text-ink-soft">Todavía no corrió ninguna vez.</p>
              ) : (
                <div className="mt-1 divide-y divide-black/[0.06]">
                  {runs.map((r) => {
                    const cuando = fechaHoraCorrida(r.started_at ?? r.claimed_at);
                    const dur = duracionLegible(r.started_at ?? r.claimed_at, r.finished_at);
                    const { label, tone } = estadoCorrida(r.status);
                    return (
                      <div key={r.id} className="py-2">
                        <div className="flex items-center gap-2">
                          <span className="text-[13px] text-ink">
                            {cuando ? (
                              <>
                                {cuando.fecha} <span className="tabular-nums">{cuando.hora}</span>
                              </>
                            ) : (
                              "sin fecha"
                            )}
                          </span>
                          {dur && (
                            <span className="text-[12px] tabular-nums text-ink-soft">· {dur}</span>
                          )}
                          <span className="ml-auto shrink-0">
                            <Chip tone={tone}>{label}</Chip>
                          </span>
                        </div>
                        {r.error && (
                          <p className="mt-0.5 truncate text-[12px] text-c-coral-ink" title={r.error}>
                            {r.error}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

export default function TareasPage() {
  const [cfg, setCfg] = useState<PortalConfig | null>(null);
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ id: string; action: Action } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  // Cuál está abierta lo dice la URL (`?programada=<id>`).
  const abiertoId = useParamRuta(PARAM.programada);
  const [detalle, setDetalle] = useState<CronDetail | null>(null);
  const [detalleErr, setDetalleErr] = useState<string | null>(null);
  // Solo para ponerle a cada tarea el nombre que el cliente le puso a su flujo.
  const [flujos, setFlujos] = useState<Flujo[] | null>(null);
  const pedido = useRef(0); // descarta respuestas de detalles que ya no se ven

  const refresh = useCallback((c: PortalConfig) => {
    getJobs(c)
      .then((d) => {
        const lista = ordenar(d?.jobs ?? []);
        // Las corridas vienen con su huso: de acá sale el reloj del negocio para
        // las pantallas que sólo reciben epoch (ver `lib/palabras.ts`).
        aprenderHuso(...lista.flatMap((j) => [j.next_run_at, j.last_run_at]));
        setJobs(lista);
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "sin detalle"));
  }, []);

  useEffect(() => {
    const c = loadConfig();
    if (!c) return; // el layout muestra el login
    setCfg(c);
    refresh(c);
    getFlujos(c).then((r) => setFlujos(r?.flujos ?? [])).catch(() => { /* caemos al slug */ });
    const t = setInterval(() => refresh(c), 30_000);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice]);

  // silencioso: el refresco de fondo no vacía lo que el cliente está leyendo ni
  // le tira un error encima si justo falla ese pedido.
  const cargarDetalle = useCallback(
    (id: string, silencioso = false) => {
      if (!cfg) return;
      const n = ++pedido.current;
      if (!silencioso) {
        setDetalle(null);
        setDetalleErr(null);
      }
      getCronDetail(cfg, id)
        .then((d) => {
          if (pedido.current !== n) return;
          setDetalle(d);
          setDetalleErr(null);
        })
        .catch((e: unknown) => {
          if (pedido.current !== n || silencioso) return;
          setDetalleErr(describirError(e));
        });
    },
    [cfg],
  );

  useEffect(() => {
    if (abiertoId) cargarDetalle(abiertoId);
  }, [abiertoId, cargarDetalle]);

  // Abrir y cerrar es navegar. `cargarDetalle` ya limpia el detalle anterior,
  // así que el primer frame del modal nuevo no muestra las corridas de la otra.
  const abrir = (id: string) => abrirEnRuta({ [PARAM.programada]: id });
  const cerrar = useCallback(() => cerrarEnRuta(PARAM.programada), []);

  // Mientras el detalle está abierto también se refresca solo (misma cadencia
  // que la lista): una corrida disparada desde acá aparece sin recargar.
  useEffect(() => {
    if (!abiertoId) return;
    const t = setInterval(() => cargarDetalle(abiertoId, true), 30_000);
    return () => clearInterval(t);
  }, [abiertoId, cargarDetalle]);

  // Modal: Escape cierra, el fondo no scrollea.
  useEffect(() => {
    if (!abiertoId) return;
    const fn = (e: KeyboardEvent) => e.key === "Escape" && cerrar();
    window.addEventListener("keydown", fn);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", fn);
      document.body.style.overflow = "";
    };
  }, [abiertoId, cerrar]);

  const ejecutar = async (job: Job, action: Action) => {
    if (!cfg) return;
    setConfirm(null);
    setBusy(job.id);
    try {
      const res = await jobAction(cfg, job.id, action);
      const actualizado: Job | undefined = res?.job;
      if (actualizado) {
        setJobs((prev) => ordenar([...(prev ?? []).filter((j) => j.id !== actualizado.id), actualizado]));
      }
      setNotice({ text: NOTICE_OK[action](nombreDeTarea(job.name, flujos)), ok: true });
      refresh(cfg);
      if (abiertoId === job.id) cargarDetalle(job.id, true);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "error";
      setNotice({ text: `No se pudo (${msg}). Probá de nuevo.`, ok: false });
    } finally {
      setBusy(null);
    }
  };

  if (!cfg || (jobs === null && !error)) {
    return (
      <Shell>
        <Spinner />
      </Shell>
    );
  }

  if (jobs === null && error) {
    return (
      <Shell>
        <ErrorState message={error} onRetry={() => refresh(cfg)} />
      </Shell>
    );
  }

  // El detalle se ancla al id: la lista se refresca sola y reemplaza los objetos.
  const abierto = abiertoId ? (jobs!.find((j) => j.id === abiertoId) ?? null) : null;

  return (
    <Shell>
      <PageHeader title="Tareas" subtitle="Lo que tu agente hace solo, y cuándo" />

      {abiertoId && jobs !== null && !jobs.some((j) => j.id === abiertoId) && (
        <AvisoLinkViejo>
          Esa tarea programada ya no existe — puede que la hayamos sacado o cambiado de
          nombre. Abajo están las que tu agente tiene hoy.
        </AvisoLinkViejo>
      )}

      {notice && (
        <div
          className={`mb-3 rounded-lg border px-3 py-2 text-[13px] font-medium ${
            notice.ok
              ? "border-c-green bg-c-green/40 text-c-green-ink"
              : "border-c-coral bg-c-coral/40 text-c-coral-ink"
          }`}
        >
          {notice.text}
        </div>
      )}

      {error && (
        <div className="mb-3 rounded-lg border border-c-amber bg-c-amber/40 px-3 py-2 text-[13px] font-medium text-c-amber-ink">
          No pude actualizar recién ({error}). Te muestro lo último que vi.
        </div>
      )}

      {jobs!.length === 0 ? (
        <Card>
          <EmptyState
            icon={Clock}
            title="Sin tareas programadas"
            hint="Cuando tu agente tenga tareas automáticas, van a aparecer acá."
          />
        </Card>
      ) : (
        <Card className="divide-y divide-black/[0.06] py-1">
          {jobs!.map((job) => {
            const { legible, cruda } = cadencia(job);
            const ultima = haceLegible(job.last_run_at);
            const proxima = job.enabled ? proximaLegible(job.next_run_at) : null;
            const fallo = job.last_status != null && job.last_status !== "ok";
            const enConfirm = confirm?.id === job.id ? confirm : null;
            const ocupado = busy === job.id;

            return (
              <div
                key={job.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 py-3.5 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto]"
              >
                {/* Izquierda: nombre + cadencia humana + cron crudo. Abre el detalle. */}
                <button
                  type="button"
                  onClick={() => abrir(job.id)}
                  className="min-w-0 rounded-lg text-left outline-none transition hover:opacity-70 focus-visible:ring-2 focus-visible:ring-primary/25"
                  title="Ver detalle"
                >
                  {/* spans, no <p>: adentro de un button el markup tiene que ser inline */}
                  <span className="block truncate text-sm font-semibold text-ink">
                    {nombreDeTarea(job.name, flujos)}
                  </span>
                  {/* El cron crudo («0 9 * * 1») se le mostraba al cliente
                      debajo de la cadencia ya traducida. No agrega nada que él
                      pueda usar y le dice "esto no es para vos". Va al `title`
                      y NO al texto: escondido con `sr-only` seguiría leyéndoselo
                      en voz alta a un cliente ciego, que es peor. */}
                  <span
                    className="block text-[13px] text-ink-soft"
                    title={cruda && cruda !== legible ? cruda : undefined}
                  >
                    {legible}
                  </span>
                </button>

                {/* Centro: estado + última corrida */}
                <div className="order-3 col-span-2 flex flex-wrap items-center gap-2 md:order-none md:col-span-1">
                  {/* El error crudo del motor sigue viajando en el `title`: es
                      para nosotros, no para la pantalla. */}
                  <span title={fallo ? job.last_error ?? undefined : undefined}>
                    <EstadoChip estado={job.state} activa={job.enabled} fallo={fallo} />
                  </span>
                  {ultima ? (
                    fallo ? (
                      <>
                        <span className="text-[12px] text-ink-soft">{ultima}</span>
                        {/* El "falló" suelto sólo hace falta cuando el chip de
                            estado está contando otra cosa (pausada, corriendo):
                            así no hay dos chips discutiendo ni información que
                            se pierda. */}
                        {!comoEsta(job.state, job.enabled, fallo).cuentaLaFalla && (
                          <span title={job.last_error ?? undefined}>
                            <Chip tone="coral">falló</Chip>
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-[12px] text-ink-soft">{ultima} · ok</span>
                    )
                  ) : (
                    <span className="text-[12px] text-ink-soft">todavía no corrió</span>
                  )}
                </div>

                {/* Derecha: próxima corrida + acciones (o confirmación inline) */}
                <div className="flex items-center justify-end justify-self-end">
                  {enConfirm ? (
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <span className="text-[13px] text-ink-soft">
                        {CONFIRM_Q[enConfirm.action](nombreDeTarea(job.name, flujos))}
                      </span>
                      <Btn
                        size="sm"
                        kind={enConfirm.action === "pause" ? "danger" : "primary"}
                        disabled={ocupado}
                        onClick={() => ejecutar(job, enConfirm.action)}
                      >
                        Sí
                      </Btn>
                      <Btn size="sm" kind="ghost" disabled={ocupado} onClick={() => setConfirm(null)}>
                        Cancelar
                      </Btn>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      {proxima && (
                        <span className="mr-1 text-[12px] text-ink-soft">Próxima {proxima}</span>
                      )}
                      <IconBtn label="Ver detalle" onClick={() => abrir(job.id)}>
                        <Eye className="h-4 w-4" />
                      </IconBtn>
                      <IconBtn
                        label="Correr ahora"
                        disabled={ocupado}
                        onClick={() => setConfirm({ id: job.id, action: "run" })}
                      >
                        <Zap className="h-4 w-4" />
                      </IconBtn>
                      {job.enabled ? (
                        <IconBtn
                          label="Pausar"
                          disabled={ocupado}
                          onClick={() => setConfirm({ id: job.id, action: "pause" })}
                        >
                          <Pause className="h-4 w-4" />
                        </IconBtn>
                      ) : (
                        <IconBtn
                          label="Reanudar"
                          disabled={ocupado}
                          onClick={() => setConfirm({ id: job.id, action: "resume" })}
                        >
                          <Play className="h-4 w-4" />
                        </IconBtn>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </Card>
      )}

      {abierto && (
        <DetalleTarea
          job={abierto}
          flujos={flujos}
          detalle={detalle}
          error={detalleErr}
          onRetry={() => cargarDetalle(abierto.id)}
          onClose={cerrar}
        />
      )}
    </Shell>
  );
}
