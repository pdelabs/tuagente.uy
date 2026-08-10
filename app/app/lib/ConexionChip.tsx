"use client";

// Tarjeta de conexión DENTRO del chat. El agente escribe `conexion:<id>`
// (se lo enseña su SOUL) y acá se convierte en una tarjeta con el estado real
// y el botón — el modelo pone la mención, el código pone la tarjeta. Así
// "conectá tu Google" no es un párrafo de instrucciones: es un botón.
//
// Los datos salen de getConnections con un cache de módulo (una sola pedida
// por sesión de página, aunque el chat mencione cinco conexiones).

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { getConnections, loadConfig, type Connection } from "./agent";
import { ConexionLogo } from "./ConexionLogo";
import Permisos from "./Permisos";

let cache: Promise<Connection[]> | null = null;
function conexiones(): Promise<Connection[]> {
  if (!cache) {
    const cfg = loadConfig();
    cache = cfg
      ? getConnections(cfg)
          .then((r) => r?.conexiones ?? [])
          .catch(() => { cache = null; return []; })
      : Promise.resolve([]);
  }
  return cache;
}

export function ConexionCardInline({ id }: { id: string }) {
  const [c, setC] = useState<Connection | null | undefined>(undefined);
  useEffect(() => {
    let vivo = true;
    conexiones().then((cs) => { if (vivo) setC(cs.find((x) => x.id === id) ?? null); });
    return () => { vivo = false; };
  }, [id]);

  // Id desconocido o catálogo inaccesible: se muestra como código, no rompemos
  // el mensaje del agente por una mención que no pudimos resolver.
  if (c === null) {
    return (
      <code className="rounded bg-black/[0.06] px-1.5 py-0.5 font-mono text-[0.88em] text-ink">
        {id}
      </code>
    );
  }
  if (c === undefined) {
    return <span className="inline-block h-4 w-28 animate-pulse rounded bg-black/[0.06] align-middle" />;
  }

  const conectada = c.estado === "conectado";
  return (
    <span className="not-prose my-1.5 flex w-full max-w-md items-center gap-3 rounded-xl border border-black/[0.08] bg-white px-3.5 py-3 shadow-soft">
      <ConexionLogo id={c.id} size="sm" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-ink">{c.label}</span>
        <span className="block truncate text-[12px] leading-snug text-ink-soft">{c.para_que}</span>
      </span>
      {conectada ? (
        <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-c-green/60 px-2 py-1 text-[11px] font-semibold text-c-green-ink">
          <CheckCircle2 className="h-3 w-3" />
          Conectada
        </span>
      ) : (
        <Link
          href="/app/conexiones"
          className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg bg-primary px-2.5 text-[13px] font-semibold text-white transition hover:bg-primary-dark"
        >
          Conectar
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      )}
    </span>
  );
}

/** Los interruptores de permisos, DENTRO del chat. El agente escribe
 *  `permisos:<id>` cuando choca contra la política: en vez de un "no puedo"
 *  seco, deja el control adelante y el cliente decide sin salir de la
 *  conversación. Él no lo puede cambiar — solo señalarlo. */
export function PermisosInline({ id }: { id: string }) {
  const [c, setC] = useState<Connection | null | undefined>(undefined);
  useEffect(() => {
    let vivo = true;
    conexiones()
      .then((cs) => { if (vivo) setC(cs.find((x) => x.id === id) ?? null); })
      .catch(() => { if (vivo) setC(null); });
    return () => { vivo = false; };
  }, [id]);

  if (c === undefined) return <span className="text-[13px] text-ink-soft">…</span>;
  if (!c) return null;   // conexión que no existe: no inventamos una tarjeta
  return <div className="my-2 max-w-sm"><Permisos conexion={c} /></div>;
}
