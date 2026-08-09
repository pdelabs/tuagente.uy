"use client";

// Conexiones: a qué sistemas de la empresa está enchufado el agente, qué le
// falta a cada uno y qué implica conectarlo.
//
// Contrato (adapter v0.20): GET {adapter}/portal/connections →
//   { disponible, conexiones: [{ id, label, grupo, para_que, como, esfuerzo,
//                                quien, advertencia, recomendado, estado,
//                                falta[], falta_previo[] }] }
//
// DOS DECISIONES DE PRODUCTO, y conviene no deshacerlas sin pensarlo:
//
// 1. Acá NO se pegan credenciales (contraseñas, tokens, keys). El estado se
//    calcula por presencia y el adapter nunca devuelve un valor. OAuth SÍ:
//    el código de un solo uso que devuelve Google no es un secreto que el
//    cliente conozca — es el flujo estándar, y el canje pasa por el adapter.
// 2. Conectar conecta cuando hay flujo self-service (hoy: Google, con su
//    diálogo de pasos). "Pedir que la conecten" es el fallback para lo que
//    de verdad requiere trámite nuestro (WhatsApp, Slack) — y la salida de
//    emergencia si el cliente prefiere que lo hagamos juntos.
//
// El vocabulario es del cliente: no aparecen las variables de entorno que
// faltan (eso es plomería), sino qué implica y cuánto lleva.

import { useCallback, useEffect, useState } from "react";
import {
  ArrowRight, Check, Clock, ExternalLink, Link2, Plug, RefreshCw, TriangleAlert,
} from "lucide-react";
import {
  etiquetaConexion, getConnections, getTickets, loadConfig, MARCA_PEDIDO, PREFIJO_PEDIDO,
  type Connection, type PortalConfig, type Ticket,
} from "../lib/agent";
import { ConexionLogo } from "../lib/ConexionLogo";
import Permisos from "../lib/Permisos";
import {
  Btn, Card, Chip, EmptyState, ErrorState, Modal, PageHeader, Spinner, inputCls,
} from "../lib/ui";

const WRAP = "mx-auto max-w-5xl px-6 py-6 md:px-8";
const REFRESH_MS = 60_000;

/** Búsqueda insensible a tildes y mayúsculas. */
const norm = (t: string) =>
  t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

const ESFUERZO: Record<string, string> = {
  minutos: "Se conecta en minutos",
  horas: "Lleva unas horas",
  dias: "Lleva varios días",
};

const QUIEN: Record<string, string> = {
  cliente_solo: "Lo podés hacer vos",
  asistido: "Lo hacemos juntos, en una llamada corta",
  nosotros: "Lo tramitamos nosotros",
};


/** Diálogo de conexión Google: pasos explícitos, sin nadie de tuagente en el
 *  medio. El adapter genera la URL y canjea el código; acá solo se guía. */
function DialogoGoogle({ cfg, conexion, onCerrar, onConectada }: {
  cfg: PortalConfig; conexion: Connection; onCerrar: () => void; onConectada: () => void;
}) {
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [pegado, setPegado] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [canjeando, setCanjeando] = useState(false);
  const [listo, setListo] = useState(false);

  useEffect(() => {
    let vivo = true;
    fetch(cfg.adapter + "/portal/connections/google/auth-url", {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.key}` },
    })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d?.error || `Error ${r.status}`);
        if (vivo) setAuthUrl(d.auth_url);
      })
      .catch((e) => { if (vivo) setErr(e instanceof Error ? e.message : String(e)); });
    return () => { vivo = false; };
  }, [cfg]);

  const canjear = async () => {
    setCanjeando(true);
    setErr(null);
    try {
      const r = await fetch(cfg.adapter + "/portal/connections/google/auth-code", {
        method: "POST",
        headers: { Authorization: `Bearer ${cfg.key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ code: pegado }),
      });
      const d = await r.json();
      if (!r.ok || !d.ok) throw new Error(d?.error || `Error ${r.status}`);
      setListo(true);
      onConectada();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setCanjeando(false);
    }
  };

  return (
    <Modal onClose={onCerrar}>
      <div className="p-5">
        <div className="mb-4 flex items-center gap-3">
          <ConexionLogo id={conexion.id} />
          <div>
            <p className="text-sm font-bold text-ink">Conectar {conexion.label}</p>
            <p className="text-[12px] text-ink-soft">Dos minutos, dos pasos.</p>
          </div>
        </div>

        {listo ? (
          <div className="flex flex-col items-start gap-3">
            <p className="flex items-center gap-2 text-sm font-semibold text-c-green-ink">
              <Check className="h-4 w-4" /> ¡Conectado! Tu agente ya puede ver tus carpetas.
            </p>
            <Btn size="sm" onClick={onCerrar}>Listo</Btn>
          </div>
        ) : (
          <ol className="flex flex-col gap-4">
            <li className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-c-violet/60 text-[12px] font-bold text-primary">1</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-ink">
                  Entrá con tu cuenta de Google y aceptá el permiso de lectura.
                </p>
                <p className="mt-0.5 text-[12px] leading-snug text-ink-soft">
                  Si aparece &ldquo;Google no verificó esta app&rdquo;, tocá
                  &ldquo;Avanzado&rdquo; y después &ldquo;Ir a tuagente&rdquo;: somos nosotros.
                </p>
                <a
                  href={authUrl ?? "#"}
                  target="_blank"
                  rel="noreferrer"
                  aria-disabled={!authUrl}
                  className={`mt-2 inline-flex h-9 items-center gap-1.5 rounded-lg px-3.5 text-sm font-semibold text-white transition ${authUrl ? "bg-primary hover:bg-primary-dark" : "pointer-events-none bg-black/20"}`}
                >
                  <ExternalLink className="h-4 w-4" />
                  Abrir Google
                </a>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-c-violet/60 text-[12px] font-bold text-primary">2</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-ink">
                  Al final vas a caer en una página que <strong>no carga</strong> — es lo
                  esperado. Copiá la dirección entera de la barra y pegala acá:
                </p>
                <div className="mt-2 flex gap-2">
                  <input
                    value={pegado}
                    onChange={(e) => setPegado(e.target.value)}
                    placeholder="http://localhost:1/?state=…"
                    className={`${inputCls} flex-1 font-mono text-[12px]`}
                  />
                  <Btn size="sm" onClick={canjear} disabled={!pegado.trim() || canjeando}>
                    {canjeando ? "Conectando…" : "Conectar"}
                  </Btn>
                </div>
              </div>
            </li>
            {err && <p className="text-[13px] font-medium text-c-coral-ink">{err}</p>}
          </ol>
        )}
      </div>
    </Modal>
  );
}

/** Telegram "lista": abrir el chat + pegar el código de activación acá mismo. */
function TelegramLista({ c, cfg, onActivada }: {
  c: Connection; cfg: PortalConfig | null; onActivada: () => void;
}) {
  const [codigo, setCodigo] = useState("");
  const [activando, setActivando] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [listo, setListo] = useState(false);

  const activar = async () => {
    if (!cfg || !codigo.trim()) return;
    setActivando(true);
    setErr(null);
    try {
      const r = await fetch(cfg.adapter + "/portal/connections/telegram/pairing", {
        method: "POST",
        headers: { Authorization: `Bearer ${cfg.key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ code: codigo }),
      });
      const d = await r.json();
      if (!r.ok || !d.ok) throw new Error(d?.error || `Error ${r.status}`);
      setListo(true);
      onActivada();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setActivando(false);
    }
  };

  if (listo) {
    return (
      <p className="mt-1 flex items-center gap-1.5 text-[13px] font-semibold text-c-green-ink">
        <Check className="h-4 w-4" /> ¡Activado! Mandale otro mensaje y ya te contesta.
      </p>
    );
  }

  return (
    <div className="mt-1 flex flex-col gap-2">
      <a
        href={c.link!}
        target="_blank"
        rel="noreferrer"
        className="inline-flex h-9 w-fit items-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-semibold text-white transition hover:bg-primary-dark"
      >
        <ExternalLink className="h-4 w-4" />
        Abrir el chat
      </a>
      <p className="text-[12px] leading-snug text-ink-soft">
        Mandale un hola. ¿Te contestó con un código? Pegalo acá:
      </p>
      <div className="flex gap-2">
        <input
          value={codigo}
          onChange={(e) => { setCodigo(e.target.value); setErr(null); }}
          onKeyDown={(e) => e.key === "Enter" && activar()}
          placeholder="Código"
          maxLength={16}
          className={`${inputCls} w-36 font-mono uppercase`}
        />
        <Btn size="sm" onClick={activar} disabled={!codigo.trim() || activando}>
          {activando ? "Activando…" : "Activar"}
        </Btn>
      </div>
      {err && <p className="text-[12px] font-medium text-c-coral-ink">{err}</p>}
    </div>
  );
}

function Estado({ estado }: { estado: string }) {
  if (estado === "conectado")
    return (
      <Chip tone="green">
        <Check className="h-3 w-3" /> Conectado
      </Chip>
    );
  if (estado === "lista")
    return (
      <Chip tone="violet">
        Lista para vos
      </Chip>
    );
  if (estado === "bloqueado")
    return (
      <Chip tone="amber">
        <Clock className="h-3 w-3" /> Falta un paso nuestro
      </Chip>
    );
  return <Chip tone="neutral">Sin conectar</Chip>;
}

export default function ConexionesPage() {
  const [cfg, setCfg] = useState<PortalConfig | null>(null);
  const [conexiones, setConexiones] = useState<Connection[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pidiendo, setPidiendo] = useState<string | null>(null);
  const [pedidas, setPedidas] = useState<Record<string, string>>({});
  // Los pedidos ya hechos, leídos del tablero. Antes vivían SOLO en este
  // estado de React: al recargar la página el cliente volvía a ver "Sin
  // conectar" y no tenía forma de saber si ya lo había pedido o no.
  const [pedidosAbiertos, setPedidosAbiertos] = useState<Set<string>>(new Set());
  const [dialogo, setDialogo] = useState<Connection | null>(null);
  // El catálogo entero vive detrás de una puerta: se abre solo si el cliente
  // lo pide, o si viene a buscar una conexión que está ahí adentro.
  const [verTodas, setVerTodas] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  // A qué conexión viene el cliente. Llega en el hash desde el flujo que la
  // necesita: sin esto aterriza en una pantalla con seis tarjetas y ninguna
  // le dice cuál era la suya. Va por hash y no por query para no romper el
  // export estático ni pelearse con el magic link.
  const [buscada, setBuscada] = useState<string | null>(null);
  useEffect(() => {
    const leer = () => {
      const m = window.location.hash.match(/(?:^#|&)c=([^&]+)/);
      setBuscada(m ? decodeURIComponent(m[1]) : null);
    };
    leer();
    window.addEventListener("hashchange", leer);
    return () => window.removeEventListener("hashchange", leer);
  }, []);

  // Traerla a la vista cuando ya está pintada. Card no toma ref (React 18),
  // así que se busca por la clase marcadora.
  // Si la que viene a conectar está en el catálogo de abajo, se abre sola:
  // mandarlo a una pantalla donde su tarjeta está escondida seria peor que
  // no mandarlo.
  useEffect(() => {
    if (buscada && conexiones?.some((c) => c.id === buscada
      && c.estado !== "conectado" && !(c.requerida || c.estado === "lista"))) {
      setVerTodas(true);
    }
  }, [buscada, conexiones]);

  useEffect(() => {
    if (!buscada) return;
    const t = setTimeout(() => {
      document.querySelector(".conexion-buscada")
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 150);
    return () => clearTimeout(t);
  }, [buscada, conexiones]);

  useEffect(() => setCfg(loadConfig()), []);

  const cargar = useCallback(async () => {
    if (!cfg) return;
    try {
      const r = await getConnections(cfg);
      setConexiones(r.conexiones ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    // Los pedidos abiertos son un extra: si el tablero no contesta, la
    // pantalla de conexiones tiene que seguir funcionando igual.
    try {
      const t = await getTickets(cfg);
      const abiertos = new Set(
        (t.tickets ?? [])
          .filter((x: Ticket) => {
            const b = x.body ?? "";
            const esPedido = b.includes(MARCA_PEDIDO) || b.trimStart().startsWith(PREFIJO_PEDIDO);
            return esPedido && x.status !== "done" && x.status !== "archived";
          })
          .map((x: Ticket) => (x.title ?? "").replace(/^Conectar\s+/i, "").trim().toLowerCase()),
      );
      setPedidosAbiertos(abiertos);
    } catch { /* sin tablero seguimos con lo que haya en memoria */ }
  }, [cfg]);

  useEffect(() => {
    if (!cfg) return;
    cargar();
    const t = setInterval(cargar, REFRESH_MS);
    return () => clearInterval(t);
  }, [cfg, cargar]);

  /** Pedir una conexión = crear un ticket. Mismo camino que todo lo demás. */
  const pedir = async (c: Connection) => {
    if (!cfg) return;
    setPidiendo(c.id);
    try {
      const res = await fetch(cfg.adapter + "/portal/tickets", {
        method: "POST",
        headers: { Authorization: `Bearer ${cfg.key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `Conectar ${c.label}`,
          body:
            `${PREFIJO_PEDIDO} ${MARCA_PEDIDO}\n\n` +
            `Para qué sirve: ${c.para_que}\n` +
            `Cómo se conecta: ${c.como}\n\n` +
            `No hagas nada por tu cuenta con esto: avisale al equipo de tuagente ` +
            `que hay que conectarlo y dejá el ticket esperando.`,
        }),
      });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const data = await res.json();
      setPedidas((p) => ({ ...p, [c.id]: data.id ?? "ok" }));
      cargar(); // que el estado "Pedido" pase a salir del tablero, no de acá
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPidiendo(null);
    }
  };

  if (!cfg) return <div className={WRAP}><Spinner /></div>;
  if (conexiones === null && error)
    return <div className={WRAP}><ErrorState message={error} onRetry={cargar} /></div>;
  if (conexiones === null) return <div className={WRAP}><Spinner /></div>;

  // Lo que puede resolver EL CLIENTE ahora mismo va arriba y separado: una
  // conexión con flujo self-service sin conectar, un bot esperando su primer
  // mensaje, o algo que su flujo necesita. El resto se agrupa como siempre.
  // TRES ZONAS, y el orden importa. Antes se agrupaba por "¿la podés conectar
  // vos solo?" y por grupo (canal/sistema): salía Google arriba de todo sin
  // que nadie se lo hubiera pedido, y el correo —que un flujo necesitaba— se
  // perdía entre seis tarjetas iguales. Ahora manda una sola pregunta: ¿algo
  // la necesita HOY? Eso lo contestan los flujos, y se actualiza solo.
  const hacenFalta = conexiones.filter(
    (c) => c.estado !== "conectado" && (c.requerida || c.estado === "lista"));
  const andando = conexiones.filter((c) => c.estado === "conectado");
  const otras = conexiones.filter(
    (c) => !hacenFalta.includes(c) && !andando.includes(c));
  const q = norm(busqueda.trim());
  const otrasFiltradas = q
    ? otras.filter((c) => norm(`${c.label} ${c.para_que}`).includes(q))
    : otras;

  /** ¿Ya la pediste? Sale del tablero (sobrevive a recargar) o de lo que
   *  acabás de hacer en esta pantalla. */
  const yaPedida = (c: Connection) =>
    Boolean(pedidas[c.id]) || pedidosAbiertos.has((c.label ?? "").trim().toLowerCase());

  const tarjeta = (c: Connection) => (
    <Card
      key={c.id}
      className={`flex flex-col gap-2 p-4 ${
        c.id === buscada
          ? "conexion-buscada !border-2 !border-primary ring-4 ring-primary/15"
          : c.requerida && c.estado !== "conectado" ? "!border !border-c-amber" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <ConexionLogo id={c.id} />
          <h3 className="text-[15px] font-semibold text-ink">{c.label}</h3>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {/* "Pedida" gana sobre "sin conectar": es la pregunta que el cliente
              se hace al volver ("¿ya lo pedí o no?"), y el estado crudo se la
              contestaba mal. */}
          {c.estado !== "conectado" && yaPedida(c)
            ? <Chip tone="amber"><Clock className="h-3 w-3" /> Pedida</Chip>
            : <Estado estado={c.estado} />}
          {c.requerida && c.estado !== "conectado" && (
            <Chip tone="amber">Tu flujo la necesita</Chip>
          )}
        </div>
      </div>
      <p className="text-sm text-ink-soft">{c.para_que}</p>
      <p className="text-[13px] text-ink-soft">{c.como}</p>

      {c.advertencia && (
        <p className="flex items-start gap-1.5 rounded-lg border border-c-amber bg-c-amber/30 px-2.5 py-1.5 text-[12px] text-c-amber-ink">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {c.advertencia}
        </p>
      )}

      <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-ink-soft">
        {c.esfuerzo && ESFUERZO[c.esfuerzo] && <span>{ESFUERZO[c.esfuerzo]}</span>}
        {c.quien && QUIEN[c.quien] && (
          <>
            <span aria-hidden>·</span>
            <span>{QUIEN[c.quien]}</span>
          </>
        )}
      </div>

      {/* "Lista": el bot existe, falta SU primer mensaje — un click y ya.
          Si el bot le contesta con un código (pairing), lo pega acá mismo:
          estar autenticado en el portal + tener el DM es la doble prueba. */}
      {c.estado === "lista" && c.link && (
        <TelegramLista c={c} cfg={cfg} onActivada={cargar} />
      )}

      {/* Los permisos solo tienen sentido cuando la conexión existe: antes de
          conectarla no hay nada que limitar. */}
      {c.estado === "conectado" && (
        <div className="mt-1"><Permisos conexion={c} /></div>
      )}

      {c.estado !== "conectado" && c.estado !== "lista" && (
        <div className="mt-1 flex flex-wrap items-center gap-3">
          {/* Con flujo self-service, Conectar CONECTA (diálogo de pasos);
              "pedir que la conecten" queda como salida de emergencia. Sin
              flujo, pedir es el único camino — WhatsApp o Slack los
              tramitamos nosotros sí o sí. */}
          {c.flujo === "google-oauth" && c.estado === "sin_conectar" ? (
            <>
              <Btn onClick={() => setDialogo(c)}>
                Conectar
                <ArrowRight className="h-4 w-4" />
              </Btn>
              {yaPedida(c) ? (
                <p className="text-[13px] font-medium text-c-green-ink">
                  Ya nos lo pediste. Te escribimos.
                </p>
              ) : (
                <button
                  onClick={() => pedir(c)}
                  disabled={pidiendo === c.id}
                  className="text-[12px] font-semibold text-ink-soft underline-offset-2 transition hover:text-ink hover:underline"
                >
                  {pidiendo === c.id ? "Pidiendo…" : "¿Preferís que lo hagamos juntos? Pedilo"}
                </button>
              )}
            </>
          ) : yaPedida(c) ? (
            /* Confirmación completa y estable: qué pasó, qué sigue y que no
               hay nada más que hacer. Antes era una línea que aparecía donde
               estaba el botón y se perdía de vista; el cliente volvía a
               apretar por las dudas. */
            <div className="rounded-lg border border-c-green bg-c-green/30 px-3 py-2">
              <p className="text-[13px] font-semibold text-c-green-ink">
                Listo, quedó pedido.
              </p>
              <p className="mt-0.5 text-[12px] text-c-green-ink/85">
                Lo anotamos y lo vas a ver en Aprobaciones, en “Lo que pediste”. Te
                escribimos cuando esté conectada; no tenés que hacer nada más.
              </p>
            </div>
          ) : (
            <Btn onClick={() => pedir(c)} disabled={pidiendo === c.id}>
              <Link2 className="h-4 w-4" />
              {pidiendo === c.id ? "Pidiendo…" : "Pedir que la conecten"}
            </Btn>
          )}
        </div>
      )}
    </Card>
  );

  return (
    <div className={WRAP}>
      <PageHeader
        title="Conexiones"
        subtitle="Los sistemas de tu empresa a los que tu agente está enchufado."
        actions={
          <Btn kind="ghost" onClick={cargar}>
            <RefreshCw className="h-4 w-4" />
            Actualizar
          </Btn>
        }
      />

      {/* De dónde venís. Sin esto el cliente aterriza en seis tarjetas y
          ninguna le dice cuál era la suya: "te perdés en todo lo que hay". */}
      {buscada && (
        <div className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-c-amber bg-c-amber/25 px-3 py-2.5">
          <TriangleAlert className="h-4 w-4 shrink-0 text-c-amber-ink" />
          <p className="text-[13px] font-semibold text-c-amber-ink">
            Venís a conectar {etiquetaConexion(buscada, conexiones)}.
          </p>
          <p className="text-[12.5px] text-c-amber-ink/85">
            Es la que te falta para uno de tus flujos — te la marcamos abajo.
          </p>
        </div>
      )}

      {error && (
        <p className="mb-4 inline-flex rounded-lg border border-c-coral bg-c-coral/40 px-3 py-1.5 text-[12px] font-medium text-c-coral-ink">
          No pude actualizar recién ({error}).
        </p>
      )}

      {dialogo && cfg && (
        <DialogoGoogle
          cfg={cfg}
          conexion={dialogo}
          onCerrar={() => setDialogo(null)}
          onConectada={cargar}
        />
      )}

      {conexiones.length === 0 ? (
        <EmptyState
          icon={Plug}
          title="Todavía no hay conexiones disponibles"
          hint="Cuando agreguemos integraciones para tu agente, van a aparecer acá."
        />
      ) : (
        <div className="flex flex-col gap-6">
          {/* 1 · Lo que hace falta ahora. Sale de los flujos: si el cliente
              pide un trabajo que necesita el correo, el correo aparece acá
              ese mismo día. */}
          {hacenFalta.length > 0 && (
            <section className="mb-6">
              <h2 className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-c-amber-ink">
                Le hacen falta a tu agente
              </h2>
              <p className="mb-2.5 text-[13px] text-ink-soft">
                Sin esto, alguno de tus trabajos queda a medias.
              </p>
              <div className="grid gap-3 md:grid-cols-2">{hacenFalta.map(tarjeta)}</div>
            </section>
          )}

          {/* 2 · Lo que ya anda. Compacto: es una señal de tranquilidad, no
              algo para leer todos los días. */}
          {andando.length > 0 && (
            <section className="mb-6">
              <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-soft">
                Andando
              </h2>
              <Card className="!p-2">
                <div className="flex flex-col">
                  {andando.map((c) => (
                    <details key={c.id} className="group px-2 py-1.5">
                      <summary className="flex cursor-pointer list-none items-center gap-2.5 [&::-webkit-details-marker]:hidden">
                        <ConexionLogo id={c.id} />
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                          {c.label}
                        </span>
                        <span className="text-[12px] font-medium text-ink-soft transition group-open:text-ink">
                          Permisos
                        </span>
                        <Chip tone="green"><Check className="h-3 w-3" /> Conectado</Chip>
                      </summary>
                      <div className="ml-11 mt-2 max-w-sm"><Permisos conexion={c} /></div>
                    </details>
                  ))}
                </div>
              </Card>
            </section>
          )}

          {/* 3 · El catálogo entero, detrás de una puerta. Nadie necesita ver
              WhatsApp y Slack todos los días; el que los busca, los busca. */}
          {otras.length > 0 && (
            <section>
              {!verTodas ? (
                <Btn kind="secondary" onClick={() => setVerTodas(true)}>
                  <Plug className="h-4 w-4" />
                  Ver todo lo que se puede conectar ({otras.length})
                </Btn>
              ) : (
                <>
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-[12px] font-semibold uppercase tracking-wide text-ink-soft">
                      Todo lo que se puede conectar
                    </h2>
                    <div className="flex items-center gap-2">
                      <input
                        autoFocus
                        value={busqueda}
                        onChange={(e) => setBusqueda(e.target.value)}
                        placeholder="Buscar…"
                        className={`${inputCls} w-44 py-1.5 text-[13px]`}
                      />
                      <Btn kind="ghost" size="sm" onClick={() => { setVerTodas(false); setBusqueda(""); }}>
                        Ocultar
                      </Btn>
                    </div>
                  </div>
                  {otrasFiltradas.length === 0 ? (
                    <p className="text-[13px] text-ink-soft">Nada coincide con esa búsqueda.</p>
                  ) : (
                    <div className="grid gap-3 md:grid-cols-2">{otrasFiltradas.map(tarjeta)}</div>
                  )}
                </>
              )}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
