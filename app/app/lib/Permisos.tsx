"use client";

// Qué puede hacer el agente con una conexión. El mismo componente en dos
// lados: la tarjeta de Conexiones y el chat, cuando el agente escribe
// `permisos:<id>` — así el cliente aprende UN solo control.
//
// Dos interruptores y no doce, a propósito. La clasificación de cada
// herramienta ("search_contacts lee, send_message actúa") la hacemos nosotros
// al curar el MCP; eso ES la curaduría. Pedirle a un cliente no técnico que
// evalúe `get_message_context` sería disfrazar una decisión nuestra de
// decisión suya, que es lo que venimos sacando del producto.
//
// El agente NO puede tocar esto: el archivo de política está montado de solo
// lectura de su lado. Solo puede señalarlo.

import { useState } from "react";
import { Eye, Loader2, Send } from "lucide-react";
import { guardarPermisos, loadConfig, type Connection } from "./agent";

type Estado = { leer: boolean; actuar: boolean };

function Interruptor({ on, label, hint, icon: Icon, guardando, onToggle }: {
  on: boolean; label: string; hint: string;
  icon: typeof Eye; guardando: boolean; onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      disabled={guardando}
      aria-pressed={on}
      className="flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left transition hover:bg-black/[0.03] disabled:opacity-60"
    >
      <span
        className={`mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition ${
          on ? "bg-primary" : "bg-black/15"
        }`}
      >
        <span className={`h-4 w-4 rounded-full bg-white transition ${on ? "translate-x-4" : ""}`} />
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
          <Icon className="h-3.5 w-3.5 text-ink-soft" />
          {label}
        </span>
        <span className="mt-0.5 block text-[12px] leading-snug text-ink-soft">{hint}</span>
      </span>
      {guardando && <Loader2 className="ml-auto h-3.5 w-3.5 shrink-0 animate-spin text-ink-soft" />}
    </button>
  );
}

export default function Permisos({ conexion, onCambio }: {
  conexion: Connection; onCambio?: (p: Estado) => void;
}) {
  const [estado, setEstado] = useState<Estado>(
    conexion.permisos ?? { leer: true, actuar: false });
  const [guardando, setGuardando] = useState<"leer" | "actuar" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const cambiar = (k: keyof Estado) => {
    const cfg = loadConfig();
    if (!cfg || guardando) return;
    const previo = estado;
    const nuevo = { ...estado, [k]: !estado[k] };
    setEstado(nuevo);          // optimista: el interruptor no puede titubear
    setGuardando(k);
    setErr(null);
    guardarPermisos(cfg, conexion.id, { [k]: nuevo[k] })
      .then((r) => { setEstado(r.permisos); onCambio?.(r.permisos); })
      .catch((e) => {
        setEstado(previo);     // si no se guardó, no se muestra como guardado
        setErr(e instanceof Error ? e.message : "no se pudo guardar");
      })
      .finally(() => setGuardando(null));
  };

  return (
    <div className="rounded-lg border border-black/[0.07] bg-white p-1.5">
      <p className="px-2 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
        Qué puede hacer con {conexion.label}
      </p>
      <Interruptor
        on={estado.leer}
        icon={Eye}
        label="Puede leer"
        hint="Mirar y buscar. No cambia nada."
        guardando={guardando === "leer"}
        onToggle={() => cambiar("leer")}
      />
      <Interruptor
        on={estado.actuar}
        icon={Send}
        label="Puede escribir y mandar"
        hint="Mandar mensajes o archivos, y cualquier cosa que salga hacia afuera."
        guardando={guardando === "actuar"}
        onToggle={() => cambiar("actuar")}
      />
      {err && <p className="px-2 pb-1.5 text-[12px] text-c-coral-ink">{err}</p>}
    </div>
  );
}
