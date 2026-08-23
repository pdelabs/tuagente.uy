"use client";

// "Qué sabe hacer": the capability catalog, drawn on the profile of a
// teammate ALREADY on the team.
//
// PAYS OFF A DEBT THE ADAPTER HAD ON THE BOOKS. Every catalog row carries
// `level`: `base` is what ships on every agent and `menu` what can be added.
// While the portal did not read that field, the client saw a button to
// request something they already had. Here `base` is drawn as included and
// with no button, always.
//
// CAPABILITIES BELONG TO THE AGENT, NOT THE ROLE. The adapter serves a single
// catalog per agent, so this is not "what Vera and only Vera knows how to do":
// it is what is available to the whole team. Said up top in one line, because
// without it the screen hints that the same thing has to be added once per
// teammate.
//
// THREE ZONES IN ORDER: what is already there (included and active) reads at
// a glance and does not compete for attention; what can be added is twenty
// rows and stays collapsed, grouped, behind one row -- the profile already
// has the flows and the tasks, and a wall of cards would bury them.

import { useEffect, useState, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";
import { loadConfig, requestCapability, type Capability, type Role } from "../lib/agent";
import { capabilityCatalog, readRequested, markRequested, byGroup } from "../lib/capabilities";
import { Btn, Card, Chip } from "../lib/ui";

/** How long it takes to be set up. It is OUR work -- the whole catalog ships
 *  with `who: "us"` -- so it is said in the first person. */
const EFFORT_LABEL: Record<string, string> = {
  minutes: "La ponemos en minutos",
  hours: "Lleva unas horas",
  days: "Lleva unos días",
};

/** A capability that is already there: included or active. No button, no
 *  ceremony. */
function Installed({ c }: { c: Capability }) {
  return (
    <div className="flex items-start gap-2">
      <Check className="mt-[3px] h-3.5 w-3.5 shrink-0 text-c-green-ink" />
      <div className="min-w-0">
        <p className="text-[14px] font-medium leading-snug text-ink">{c.label}</p>
        {c.purpose && (
          <p className="mt-0.5 text-[13px] leading-snug text-ink-soft">{c.purpose}</p>
        )}
      </div>
    </div>
  );
}

function Block({ title, note, children }: {
  title: string;
  note: string;
  children: ReactNode;
}) {
  return (
    <div className="mt-3">
      <div className="mb-1.5 flex flex-wrap items-baseline gap-x-2 px-1">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
          {title}
        </h3>
        <span className="text-[12px] text-ink-soft/80">{note}</span>
      </div>
      <Card className="flex flex-col gap-2.5 p-3.5">{children}</Card>
    </div>
  );
}

export default function WhatItCanDo({ role }: { role: Role }) {
  const [caps, setCaps] = useState<Capability[] | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [requested, setRequested] = useState<string[]>([]);
  const [requesting, setRequesting] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; message: string } | null>(null);

  useEffect(() => {
    let alive = true;
    setRequested(readRequested());
    capabilityCatalog().then((cs) => { if (alive) setCaps(cs); });
    return () => { alive = false; };
  }, []);

  const handleRequest = async (c: Capability) => {
    const cfg = loadConfig();
    if (!cfg || requesting) return;
    setRequesting(c.id);
    setError(null);
    try {
      // SAME PATH AS THE CHAT CARD: the endpoint validates the id against the
      // catalog, trims the text and does not note the same row twice in a
      // row. Which role the request came from travels inside the text
      // because the endpoint has no field for that -- and the portal does not
      // invent one.
      await requestCapability(
        cfg, c.id,
        `El cliente pidió «${c.label}» desde la ficha de ${role.name || role.label} (${role.id}).`,
      );
      markRequested(c.id);
      setRequested((p) => Array.from(new Set([...p, c.id])));
    } catch (e) {
      setError({ id: c.id, message: e instanceof Error ? e.message : "no pude registrar el pedido" });
    } finally {
      setRequesting(null);
    }
  };

  // No catalog installed (or unable to read it): no section. An empty screen
  // with a title is worse than not being there.
  if (!caps || caps.length === 0) return null;

  const included = caps.filter((c) => c.level === "base");
  // `level` absent = `menu`: an old adapter does not send the field and what
  // could be requested has to remain requestable.
  const fromMenu = caps.filter((c) => c.level !== "base");
  const active = fromMenu.filter((c) => c.active === true);
  // `active === null` means DON'T KNOW, and it is offered the same as
  // `false` -- same as the chat card does: it promises neither that it has it
  // nor that it doesn't.
  const addable = fromMenu.filter((c) => c.active !== true);

  // Grouped the same way the alta groups them, and by the same function: it
  // is the same catalog, and two different ways to split it would be two
  // different screens.
  const groups = byGroup(addable);

  return (
    <section>
      <h2 className="mb-1 text-[15px] font-semibold text-ink">Qué sabe hacer</h2>
      <p className="text-[13px] leading-snug text-ink-soft">
        Estas herramientas son del agente, no de una sola persona del equipo: lo que
        sumes acá lo usan todos.
      </p>

      {included.length > 0 && (
        <Block title="Incluido" note="viene en todos los agentes, no hay que pedirlo">
          {included.map((c) => <Installed key={c.id} c={c} />)}
        </Block>
      )}

      {active.length > 0 && (
        <Block title="Activas" note="ya están puestas en tu agente">
          {active.map((c) => <Installed key={c.id} c={c} />)}
        </Block>
      )}

      {addable.length > 0 && (
        <div className="mt-3">
          <button
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="flex w-full items-center gap-2 rounded-lg px-1 py-1.5 text-left transition hover:bg-black/[0.03]"
          >
            <ChevronDown
              className={`h-4 w-4 shrink-0 text-ink-soft transition-transform ${expanded ? "" : "-rotate-90"}`}
            />
            <span className="text-[13px] font-semibold text-ink">Se puede sumar</span>
            <span className="text-[12px] tabular-nums text-ink-soft">{addable.length}</span>
          </button>

          {expanded && (
            <>
              {/* The same truth the chat card says, once for the whole list:
                  the button does not turn anything on, it gives notice. */}
              <p className="mb-2.5 px-1 text-[12.5px] leading-snug text-ink-soft">
                Pedir una no la prende: nos avisa a nosotros, lo miramos y te escribimos.
              </p>
              <div className="flex flex-col gap-4">
                {groups.map(({ group, label, capabilities }) => (
                  <div key={group}>
                    <h3 className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
                      {label}
                    </h3>
                    <div className="flex flex-col gap-2">
                      {capabilities.map((c) => (
                        <Card key={c.id} className="p-3.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-[14px] font-medium text-ink">{c.label}</p>
                            {/* Only when the agent CONFIRMS it is not there.
                                With `null` nothing is said: asserting an
                                absence without knowing it is exactly what the
                                chat card is careful not to do. */}
                            {c.active === false && <Chip tone="neutral">no está puesta</Chip>}
                          </div>
                          {c.purpose && (
                            <p className="mt-1 text-[13px] leading-snug text-ink-soft">{c.purpose}</p>
                          )}
                          {c.cost && (
                            <p className="mt-1 text-[12.5px] leading-snug text-ink-soft">
                              <span className="font-medium text-ink">Qué cuesta:</span> {c.cost}
                            </p>
                          )}
                          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                            {requested.includes(c.id) ? (
                              <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-c-green-ink">
                                <Check className="h-3.5 w-3.5 shrink-0" />
                                Pedida. Te escribimos cuando esté.
                              </span>
                            ) : (
                              <Btn
                                kind="secondary"
                                size="sm"
                                disabled={requesting === c.id}
                                onClick={() => handleRequest(c)}
                              >
                                {requesting === c.id ? "Pidiendo…" : "Pedirla"}
                              </Btn>
                            )}
                            {c.effort && EFFORT_LABEL[c.effort] && (
                              <span className="text-[12px] text-ink-soft">{EFFORT_LABEL[c.effort]}</span>
                            )}
                          </div>
                          {error?.id === c.id && (
                            <p className="mt-1.5 text-[12px] font-medium text-c-coral-ink">
                              No pude registrar el pedido ({error.message}). Probá de nuevo o escribinos.
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
