"use client";

// Tarjeta de CAPACIDAD dentro del chat. Cuando al agente le falta algo para
// hacer bien el trabajo —generar una imagen de verdad, buscar en la web— no
// improvisa un apaño maquillado: lo PIDE, escribiendo `capacidad:<id>` sola en
// su línea, igual que hace con `conexion:<id>`.
//
// EL TEXTO LO PONE EL CATÁLOGO, NO EL AGENTE. La skill le prohíbe explicar qué
// es la capacidad justamente para que no invente promesas de precio o de plazo;
// esa explicación tiene que ponerla esta tarjeta. Mientras el portal no la
// dibujaba, el turno del agente terminaba con una etiqueta de máquina
// (`capacidad:imagenes`) donde iba la explicación: el QA lo leyó como "parece
// un error del sistema; no hay nada que tocar".
//
// TRES REGLAS QUE SE VEN EN EL CÓDIGO:
//  1. `activa` puede ser `null` = NO SE SABE (el motor no expone el índice de
//     tools, así que solo se puede afirmar la ausencia). Con `null` la tarjeta
//     no promete ni que la tiene ni que no la tiene: ofrece, y listo.
//  2. "Ahora no" existe. Una tarjeta que solo se puede aceptar es un embudo,
//     no una oferta.
//  3. Un pedido, un clic. Queda marcado en este browser para que dos clics no
//     sean dos pedidos, y el endpoint TAMBIÉN se defiende: valida el id contra
//     el catálogo, recorta el texto y no anota dos veces la misma fila seguida
//     (verificado el 12/8 contra el lab — el pedido queda escrito en
//     `politica/capacidades/pedidos.jsonl`, con fecha, agente y origen). O sea
//     que "Pedida" ya no es una promesa del browser: es un registro.

import { useEffect, useState } from "react";
import { Check, Sparkles } from "lucide-react";
import { getCapacidades, loadConfig, pedirCapacidad, type Capacidad } from "./agent";

let cache: Promise<Capacidad[]> | null = null;
function capacidades(): Promise<Capacidad[]> {
  if (!cache) {
    const cfg = loadConfig();
    cache = cfg
      ? getCapacidades(cfg)
          .then((r) => r?.capacidades ?? [])
          .catch(() => { cache = null; return []; })
      : Promise.resolve([]);
  }
  return cache;
}

// Lo que este browser ya pidió. El adapter anota los pedidos en un archivo pero
// no los devuelve, así que no hay forma de preguntárselo: se recuerda acá para
// no invitar al doble clic ni al "¿lo habré pedido?".
const PEDIDAS_KEY = "tuagente_capacidades_pedidas";
function leerPedidas(): string[] {
  try { return JSON.parse(localStorage.getItem(PEDIDAS_KEY) || "[]"); } catch { return []; }
}
function marcarPedida(id: string) {
  try {
    const todas = Array.from(new Set([...leerPedidas(), id]));
    localStorage.setItem(PEDIDAS_KEY, JSON.stringify(todas));
  } catch { /* modo privado: al menos vale para esta pantalla */ }
}

function Dato({ rotulo, children }: { rotulo: string; children: string }) {
  return (
    <span className="mt-1 block text-[12.5px] leading-snug text-ink-soft">
      <span className="font-semibold text-ink">{rotulo}</span> {children}
    </span>
  );
}

export function CapacidadInline({ id }: { id: string }) {
  const [c, setC] = useState<Capacidad | null | undefined>(undefined);
  const [pedida, setPedida] = useState(false);
  const [pidiendo, setPidiendo] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pospuesta, setPospuesta] = useState(false);

  useEffect(() => {
    let vivo = true;
    setPedida(leerPedidas().includes(id));
    capacidades().then((cs) => { if (vivo) setC(cs.find((x) => x.id === id) ?? null); });
    return () => { vivo = false; };
  }, [id]);

  const pedir = async () => {
    const cfg = loadConfig();
    if (!cfg || !c || pidiendo) return;
    setPidiendo(true);
    setErr(null);
    try {
      await pedirCapacidad(cfg, c.id, `El cliente pidió «${c.label}» desde el chat.`);
      marcarPedida(c.id);
      setPedida(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "no pude registrar el pedido");
    } finally {
      setPidiendo(false);
    }
  };

  if (c === undefined) {
    return <span className="inline-block h-4 w-32 animate-pulse rounded bg-black/[0.06] align-middle" />;
  }
  // Id que no está en el catálogo (o adapter viejo): NO mostramos el token
  // crudo. Que el agente nombre algo que el portal no conoce es problema
  // nuestro, no del cliente.
  if (c === null) {
    return (
      <span className="text-ink-soft">
        Para esto le falta una herramienta que todavía no tiene. Pedínosla por el chat de
        soporte y la vemos.
      </span>
    );
  }
  // `activa === true` es lo único que se puede afirmar: ya la tiene y nombrarla
  // sería ruido. `false` y `null` (no se sabe) se ofrecen igual, sin diagnóstico.
  if (c.activa === true) return null;

  if (pospuesta) {
    return (
      <span className="not-prose my-1.5 flex items-center gap-2 text-[12.5px] text-ink-soft">
        Lo dejamos para más adelante.
        <button
          onClick={() => setPospuesta(false)}
          className="font-semibold text-primary transition hover:text-primary-dark"
        >
          Cambié de idea
        </button>
      </span>
    );
  }

  return (
    <span className="not-prose my-2 flex w-full max-w-md items-start gap-3 rounded-xl border border-black/[0.08] bg-white px-3.5 py-3">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-c-violet">
        <Sparkles className="h-4 w-4 text-primary" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
          Tu agente pide esto para hacerlo bien
        </span>
        <span className="mt-0.5 block text-sm font-semibold text-ink">{c.label}</span>
        {c.para_que && <Dato rotulo="Para qué sirve:">{c.para_que}</Dato>}
        {c.como && <Dato rotulo="Cómo se hace:">{c.como}</Dato>}
        {c.costo && <Dato rotulo="Qué cuesta:">{c.costo}</Dato>}

        {pedida ? (
          <span className="mt-2 flex items-center gap-1.5 text-[12.5px] font-medium text-c-green-ink">
            <Check className="h-3.5 w-3.5 shrink-0" />
            Pedida. La estamos viendo y te escribimos cuando esté.
          </span>
        ) : (
          <>
            <span className="mt-2.5 flex flex-wrap items-center gap-2">
              <button
                onClick={pedir}
                disabled={pidiendo}
                className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-[13px] font-semibold text-white transition hover:bg-primary-dark disabled:opacity-50"
              >
                {pidiendo ? "Pidiendo…" : "Pedirla"}
              </button>
              <button
                onClick={() => setPospuesta(true)}
                className="inline-flex h-8 items-center rounded-lg px-2.5 text-[13px] font-semibold text-ink-soft transition hover:bg-black/[0.05] hover:text-ink"
              >
                Ahora no
              </button>
            </span>
            {/* Honestidad: pedirla no la prende. La prendemos nosotros. */}
            <span className="mt-1.5 block text-[12px] leading-snug text-ink-soft/85">
              Pedirla no cambia nada todavía: nos avisa a nosotros, lo miramos y te
              escribimos. Podés seguir con lo tuyo mientras tanto.
            </span>
          </>
        )}
        {err && (
          <span className="mt-1.5 block text-[12px] font-medium text-c-coral-ink">
            No pude registrar el pedido ({err}). Probá de nuevo o escribinos.
          </span>
        )}
      </span>
    </span>
  );
}
