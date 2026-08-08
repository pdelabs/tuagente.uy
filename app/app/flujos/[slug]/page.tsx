"use client";

// Detalle de un flujo: todos sus resultados, su gatillo, y —transparencia
// barata— el "cómo trabajo" que el agente sigue (el cuerpo del FLUJO.md, que
// ya está escrito sin jerga). Es la página a la que se llega clickeando la
// tarjeta en /app/flujos.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft, ArrowRight, BookOpen, Clock, FolderOpen, MessageSquare,
  RefreshCw, Workflow, Zap, type LucideIcon,
} from "lucide-react";
import {
  getFlujoDetalle, loadConfig,
  type FlujoDetalle, type HttpError, type PortalConfig,
} from "../../lib/agent";
import Markdown from "../../lib/Markdown";
import { EntityProvider } from "../../lib/EntityViewer";
import { EntityChip } from "../../lib/entities";
import { Btn, Card, Chip, ErrorState, IconBtn, PageHeader, Spinner } from "../../lib/ui";

const WRAP = "mx-auto max-w-4xl px-6 py-6 md:px-8";

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

export default function FlujoDetallePage() {
  const params = useParams<{ slug: string }>();
  const slug = String(params?.slug ?? "");
  const [cfg, setCfg] = useState<PortalConfig | null>(null);
  const [flujo, setFlujo] = useState<FlujoDetalle | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  useEffect(() => setCfg(loadConfig()), []);

  const cargar = useCallback(() => {
    if (!cfg || !slug) return;
    setCargando(true);
    getFlujoDetalle(cfg, slug)
      .then((f) => { setFlujo(f); setErr(null); })
      .catch((e: HttpError) => setErr(e?.message || "error"))
      .finally(() => setCargando(false));
  }, [cfg, slug]);

  useEffect(() => { cargar(); }, [cargar]);

  if (!cfg) return <div className={WRAP}><Spinner /></div>;
  if (err && !flujo) return <div className={WRAP}><ErrorState message={err} onRetry={cargar} /></div>;
  if (!flujo) return <div className={WRAP}><Spinner /></div>;

  const Icono = GATILLO_ICON[flujo.gatillo_tipo] ?? Workflow;

  return (
    <EntityProvider cfg={cfg}>
      <div className={WRAP}>
        <Link
          href="/app/flujos"
          className="mb-3 inline-flex items-center gap-1 text-[13px] font-semibold text-ink-soft transition hover:text-ink"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Flujos
        </Link>

        <PageHeader
          title={flujo.nombre}
          subtitle={flujo.para_cliente}
          actions={
            <IconBtn label="Actualizar" disabled={cargando} onClick={cargar}>
              <RefreshCw className={`h-4 w-4 ${cargando ? "animate-spin" : ""}`} />
            </IconBtn>
          }
        />

        <div className="mb-4 flex flex-wrap items-center gap-2">
          {flujo.estado === "incompleto" ? (
            <Chip tone="amber">Le falta una conexión</Chip>
          ) : flujo.estado === "pausado" ? (
            <Chip tone="neutral">Pausado</Chip>
          ) : (
            <Chip tone="green">Activo</Chip>
          )}
          {flujo.gatillo && (
            <span className="flex items-center gap-1.5 text-[13px] text-ink-soft">
              <Icono className="h-3.5 w-3.5 shrink-0" />
              {flujo.gatillo}
            </span>
          )}
        </div>

        {flujo.estado === "incompleto" && (
          <Link
            href="/app/conexiones"
            className="mb-5 inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-semibold text-white transition hover:bg-primary-dark"
          >
            Conectar lo que falta
            <ArrowRight className="h-4 w-4" />
          </Link>
        )}

        <section className="mb-6">
          <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-soft">
            Resultados
            <span className="ml-1.5 tabular-nums text-ink-soft/70">{flujo.resultados_total}</span>
          </h2>
          {flujo.resultados.length === 0 ? (
            <p className="text-[13px] text-ink-soft">
              Todavía no hay resultados: cuando el flujo produzca algo, queda acá.
            </p>
          ) : (
            <Card className="!p-3">
              <ul className="flex flex-col gap-1.5">
                {flujo.resultados.map((r) => (
                  <li key={r.path} className="flex items-center gap-2">
                    {/* min-w-0 + flex-1: el chip trunca ADENTRO de la fila. */}
                    <span className="min-w-0 flex-1">
                      <EntityChip entity={{ kind: "file", path: r.path }} label={nombreArchivo(r.path)} />
                    </span>
                    <span className="shrink-0 whitespace-nowrap text-[11px] text-ink-soft">
                      {hace(r.mtime)}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </section>

        {flujo.como && (
          <section className="mb-6">
            <h2 className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-ink-soft">
              <BookOpen className="h-3.5 w-3.5" /> Cómo lo trabaja tu agente
            </h2>
            <Card>
              <Markdown>{flujo.como}</Markdown>
            </Card>
          </section>
        )}

        <PedirCambio cfg={cfg} flujo={flujo} />
      </div>
    </EntityProvider>
  );
}

/** El cliente pide un cambio en SUS palabras; viaja como ticket y el agente
 *  edita el FLUJO.md (o PREFERENCIAS.md si aplica a todos) como ya sabe.
 *  Sin formularios de configuración: el prompt ES la interfaz. */
function PedirCambio({ cfg, flujo }: { cfg: PortalConfig; flujo: FlujoDetalle }) {
  const [texto, setTexto] = useState("");
  const [mandando, setMandando] = useState(false);
  const [listo, setListo] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const mandar = async () => {
    if (!texto.trim()) return;
    setMandando(true);
    setErr(null);
    try {
      const alcance =
        `Aplica solo a este flujo: actualizá las instrucciones de flujos/${flujo.slug}/FLUJO.md.`;
      const res = await fetch(cfg.adapter + "/portal/tickets", {
        method: "POST",
        headers: { Authorization: `Bearer ${cfg.key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `Ajustar el flujo ${flujo.nombre}`,
          body:
            `Pedido del cliente desde la página del flujo "${flujo.nombre}":\n\n` +
            `"${texto.trim()}"\n\n${alcance}\n` +
            "Anotá al final del archivo qué cambiaste y cuándo, y cerrá este ticket " +
            "contando el cambio en una línea, en palabras del cliente.",
        }),
      });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      setListo(texto.trim());
      setTexto("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setMandando(false);
    }
  };

  return (
    <section>
      <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-soft">
        Pedir un cambio
      </h2>
      <Card className="flex flex-col gap-2.5">
        <p className="text-[13px] leading-snug text-ink-soft">
          Contale en tus palabras qué querés distinto — &ldquo;no uses emojis&rdquo;,
          &ldquo;las frases más cortas&rdquo;, &ldquo;avisame también por Telegram&rdquo;.
          Lo aplica solo y el cambio queda a la vista acá arriba.
        </p>
        <textarea
          value={texto}
          onChange={(e) => { setTexto(e.target.value); setListo(null); }}
          placeholder="Qué querés cambiar…"
          rows={2}
          className="w-full resize-y rounded-lg border border-black/[0.1] bg-white p-3 text-sm text-ink outline-none transition placeholder:text-ink-soft/50 focus:border-primary/50"
        />
        <div>
          <Btn size="sm" onClick={mandar} disabled={!texto.trim() || mandando}>
            {mandando ? "Mandando…" : "Pedírselo"}
          </Btn>
        </div>
        {listo && (
          <p className="text-[13px] font-medium text-c-green-ink">
            Pedido. Lo ves avanzar en el Tablero, y estas instrucciones se actualizan solas.
          </p>
        )}
        {err && <p className="text-[13px] font-medium text-c-coral-ink">{err}</p>}
      </Card>
    </section>
  );
}

