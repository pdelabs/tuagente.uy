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
  getConnections, loadConfig,
  type Connection, type PortalConfig,
} from "../lib/agent";
import { ConexionLogo } from "../lib/ConexionLogo";
import {
  Btn, Card, Chip, EmptyState, ErrorState, Modal, PageHeader, Spinner, inputCls,
} from "../lib/ui";

const WRAP = "mx-auto max-w-5xl px-6 py-6 md:px-8";
const REFRESH_MS = 60_000;

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

function Estado({ estado }: { estado: string }) {
  if (estado === "conectado")
    return (
      <Chip tone="green">
        <Check className="h-3 w-3" /> Conectado
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
  const [dialogo, setDialogo] = useState<Connection | null>(null);

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
            `Pedido desde el portal.\n\n` +
            `Para qué sirve: ${c.para_que}\n` +
            `Cómo se conecta: ${c.como}\n\n` +
            `No hagas nada por tu cuenta con esto: avisale al equipo de tuagente ` +
            `que hay que conectarlo y dejá el ticket esperando.`,
        }),
      });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const data = await res.json();
      setPedidas((p) => ({ ...p, [c.id]: data.id ?? "ok" }));
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

  const canales = conexiones.filter((c) => c.grupo === "canal");
  const sistemas = conexiones.filter((c) => c.grupo !== "canal");

  const tarjeta = (c: Connection) => (
    <Card
      key={c.id}
      className={`flex flex-col gap-2 p-4 ${
        c.requerida && c.estado !== "conectado" ? "!border !border-c-amber" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <ConexionLogo id={c.id} />
          <h3 className="text-[15px] font-semibold text-ink">{c.label}</h3>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Estado estado={c.estado} />
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

      {c.estado !== "conectado" && (
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
              {pedidas[c.id] ? (
                <p className="text-[13px] font-medium text-c-green-ink">
                  Pedido. Te escribimos.
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
          ) : pedidas[c.id] ? (
            <p className="text-[13px] font-medium text-c-green-ink">
              Pedido. Lo dejamos anotado y te escribimos.
            </p>
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
          {canales.length > 0 && (
            <section>
              <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-soft">
                Por dónde le hablás
              </h2>
              <div className="grid gap-3 md:grid-cols-2">{canales.map(tarjeta)}</div>
            </section>
          )}
          {sistemas.length > 0 && (
            <section>
              <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-soft">
                Sistemas de tu empresa
              </h2>
              <div className="grid gap-3 md:grid-cols-2">{sistemas.map(tarjeta)}</div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
