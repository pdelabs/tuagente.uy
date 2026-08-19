"use client";

// "Qué sabe hacer": el catálogo de capacidades, dibujado en la ficha de un
// compañero que YA está en el equipo.
//
// PAGA UNA DEUDA QUE EL ADAPTER TIENE ANOTADA. Cada fila del catálogo trae
// `nivel`: `base` es lo que viene en todos los agentes y `menu` lo que se puede
// sumar. Mientras el portal no leía ese campo, el cliente veía un botón para
// pedir algo que ya tenía puesto. Acá `base` se dibuja como incluido y sin
// botón, siempre.
//
// LAS CAPACIDADES SON DEL AGENTE, NO DEL ROL. El adapter sirve un solo catálogo
// por agente, así que esto no es "lo que sabe hacer Vera y nadie más": es lo
// que hay disponible para todo el equipo. Se dice arriba de todo con una línea,
// porque sin eso la pantalla insinúa que hay que sumar lo mismo una vez por
// compañero.
//
// TRES ZONAS Y UN ORDEN: lo que ya está (incluido y activo) se lee de un
// vistazo y no compite por atención; lo que se puede sumar son veinte filas y
// va colapsado, agrupado, detrás de un renglón — la ficha ya tiene los flujos y
// las tareas, y una pared de tarjetas se las tapa.

import { useEffect, useState, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";
import { loadConfig, pedirCapacidad, type Capacidad, type Role } from "../lib/agent";
import { catalogoDeCapacidades, leerPedidas, marcarPedida } from "../lib/capacidades";
import { Btn, Card, Chip } from "../lib/ui";

/** Cuánto tarda en estar puesta. Es trabajo NUESTRO —el catálogo entero viene
 *  con `quien: nosotros`—, así que se dice en primera persona. */
const ESFUERZO: Record<string, string> = {
  minutos: "La ponemos en minutos",
  horas: "Lleva unas horas",
  dias: "Lleva unos días",
};

/** Los grupos del catálogo, en palabras. El catálogo es cerrado pero puede
 *  crecer: un grupo que no esté acá se humaniza (guiones a espacios) en vez de
 *  romper la pantalla o mostrarse crudo. */
const GRUPO: Record<string, string> = {
  administracion: "Administración",
  "documentos-y-datos": "Documentos y datos",
  informacion: "Información",
  contenido: "Contenido",
  atencion: "Atención a clientes",
  audio: "Audio",
};
const rotuloGrupo = (g: string) => {
  const conocido = GRUPO[g];
  if (conocido) return conocido;
  const libre = g.replace(/-/g, " ");
  return libre.charAt(0).toUpperCase() + libre.slice(1);
};

/** Una capacidad que ya está: incluida o activa. Sin botón y sin ceremonia. */
function Puesta({ c }: { c: Capacidad }) {
  return (
    <div className="flex items-start gap-2">
      <Check className="mt-[3px] h-3.5 w-3.5 shrink-0 text-c-green-ink" />
      <div className="min-w-0">
        <p className="text-[14px] font-medium leading-snug text-ink">{c.label}</p>
        {c.para_que && (
          <p className="mt-0.5 text-[13px] leading-snug text-ink-soft">{c.para_que}</p>
        )}
      </div>
    </div>
  );
}

function Bloque({ titulo, aclaracion, children }: {
  titulo: string;
  aclaracion: string;
  children: ReactNode;
}) {
  return (
    <div className="mt-3">
      <div className="mb-1.5 flex flex-wrap items-baseline gap-x-2 px-1">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
          {titulo}
        </h3>
        <span className="text-[12px] text-ink-soft/80">{aclaracion}</span>
      </div>
      <Card className="flex flex-col gap-2.5 p-3.5">{children}</Card>
    </div>
  );
}

export default function QueSabeHacer({ role }: { role: Role }) {
  const [cats, setCats] = useState<Capacidad[] | null>(null);
  const [abierto, setAbierto] = useState(false);
  const [pedidas, setPedidas] = useState<string[]>([]);
  const [pidiendo, setPidiendo] = useState<string | null>(null);
  const [err, setErr] = useState<{ id: string; msg: string } | null>(null);

  useEffect(() => {
    let vivo = true;
    setPedidas(leerPedidas());
    catalogoDeCapacidades().then((cs) => { if (vivo) setCats(cs); });
    return () => { vivo = false; };
  }, []);

  const pedir = async (c: Capacidad) => {
    const cfg = loadConfig();
    if (!cfg || pidiendo) return;
    setPidiendo(c.id);
    setErr(null);
    try {
      // MISMO CAMINO QUE LA TARJETA DEL CHAT: el endpoint valida el id contra el
      // catálogo, recorta el texto y no anota dos veces la misma fila seguida.
      // De qué rol salió el pedido viaja adentro del texto porque el endpoint no
      // tiene campo para eso — y no se lo inventamos del lado del portal.
      await pedirCapacidad(
        cfg, c.id,
        `El cliente pidió «${c.label}» desde la ficha de ${role.name || role.label} (${role.id}).`,
      );
      marcarPedida(c.id);
      setPedidas((p) => Array.from(new Set([...p, c.id])));
    } catch (e) {
      setErr({ id: c.id, msg: e instanceof Error ? e.message : "no pude registrar el pedido" });
    } finally {
      setPidiendo(null);
    }
  };

  // Sin catálogo instalado (o sin poder leerlo) no hay sección: una pantalla
  // vacía con título es peor que no estar.
  if (!cats || cats.length === 0) return null;

  const incluidas = cats.filter((c) => c.nivel === "base");
  // `nivel` ausente = `menu`: un adapter viejo no manda el campo y lo que
  // se podía pedir se tiene que poder seguir pidiendo.
  const delMenu = cats.filter((c) => c.nivel !== "base");
  const activas = delMenu.filter((c) => c.activa === true);
  // `activa === null` es NO SE SABE, y se ofrece igual que `false` — es lo mismo
  // que hace la tarjeta del chat: no se promete ni que la tiene ni que no.
  const sumables = delMenu.filter((c) => c.activa !== true);

  // Los grupos en el orden en que vienen del catálogo: el orden es una decisión
  // del catálogo y reordenarlo acá sería una segunda opinión sobre lo mismo.
  const grupos: string[] = [];
  for (const c of sumables) {
    const g = c.grupo || "otras";
    if (!grupos.includes(g)) grupos.push(g);
  }

  return (
    <section>
      <h2 className="mb-1 text-[15px] font-semibold text-ink">Qué sabe hacer</h2>
      <p className="text-[13px] leading-snug text-ink-soft">
        Estas herramientas son del agente, no de una sola persona del equipo: lo que
        sumes acá lo usan todos.
      </p>

      {incluidas.length > 0 && (
        <Bloque titulo="Incluido" aclaracion="viene en todos los agentes, no hay que pedirlo">
          {incluidas.map((c) => <Puesta key={c.id} c={c} />)}
        </Bloque>
      )}

      {activas.length > 0 && (
        <Bloque titulo="Activas" aclaracion="ya están puestas en tu agente">
          {activas.map((c) => <Puesta key={c.id} c={c} />)}
        </Bloque>
      )}

      {sumables.length > 0 && (
        <div className="mt-3">
          <button
            onClick={() => setAbierto((v) => !v)}
            aria-expanded={abierto}
            className="flex w-full items-center gap-2 rounded-lg px-1 py-1.5 text-left transition hover:bg-black/[0.03]"
          >
            <ChevronDown
              className={`h-4 w-4 shrink-0 text-ink-soft transition-transform ${abierto ? "" : "-rotate-90"}`}
            />
            <span className="text-[13px] font-semibold text-ink">Se puede sumar</span>
            <span className="text-[12px] tabular-nums text-ink-soft">{sumables.length}</span>
          </button>

          {abierto && (
            <>
              {/* La misma verdad que dice la tarjeta del chat, una vez para toda
                  la lista: el botón no prende nada, avisa. */}
              <p className="mb-2.5 px-1 text-[12.5px] leading-snug text-ink-soft">
                Pedir una no la prende: nos avisa a nosotros, lo miramos y te escribimos.
              </p>
              <div className="flex flex-col gap-4">
                {grupos.map((g) => (
                  <div key={g}>
                    <h3 className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
                      {rotuloGrupo(g)}
                    </h3>
                    <div className="flex flex-col gap-2">
                      {sumables.filter((c) => (c.grupo || "otras") === g).map((c) => (
                        <Card key={c.id} className="p-3.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-[14px] font-medium text-ink">{c.label}</p>
                            {/* Solo cuando el agente CONFIRMA que no está. Con
                                `null` no se dice nada: afirmar la ausencia sin
                                saberlo es exactamente lo que la tarjeta del chat
                                se cuida de no hacer. */}
                            {c.activa === false && <Chip tone="neutral">no está puesta</Chip>}
                          </div>
                          {c.para_que && (
                            <p className="mt-1 text-[13px] leading-snug text-ink-soft">{c.para_que}</p>
                          )}
                          {c.costo && (
                            <p className="mt-1 text-[12.5px] leading-snug text-ink-soft">
                              <span className="font-medium text-ink">Qué cuesta:</span> {c.costo}
                            </p>
                          )}
                          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                            {pedidas.includes(c.id) ? (
                              <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-c-green-ink">
                                <Check className="h-3.5 w-3.5 shrink-0" />
                                Pedida. Te escribimos cuando esté.
                              </span>
                            ) : (
                              <Btn
                                kind="secondary"
                                size="sm"
                                disabled={pidiendo === c.id}
                                onClick={() => pedir(c)}
                              >
                                {pidiendo === c.id ? "Pidiendo…" : "Pedirla"}
                              </Btn>
                            )}
                            {c.esfuerzo && ESFUERZO[c.esfuerzo] && (
                              <span className="text-[12px] text-ink-soft">{ESFUERZO[c.esfuerzo]}</span>
                            )}
                          </div>
                          {err?.id === c.id && (
                            <p className="mt-1.5 text-[12px] font-medium text-c-coral-ink">
                              No pude registrar el pedido ({err.msg}). Probá de nuevo o escribinos.
                            </p>
                          )}
                        </Card>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
