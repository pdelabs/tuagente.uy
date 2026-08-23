"use client";

// CAPABILITY card inside the chat. When the agent is missing something it
// needs to do the job right -- generate a real image, search the web -- it
// doesn't improvise a dressed-up workaround: it ASKS, writing
// `capability:<id>` alone on its own line, same as it does with
// `connection:<id>`.

//
// THE CATALOG WRITES THE TEXT, NOT THE AGENT. The skill forbids it from
// explaining what the capability is precisely so it doesn't invent promises
// about price or timeline; that explanation has to come from this card.
// While the portal wasn't drawing it, the agent's turn ended with a machine
// label (`capability:image-editing`) where the explanation should have been:
// QA read it as "looks like a system error; nothing to act on here".
//
// THREE RULES VISIBLE IN THE CODE:
//  1. `active` can be `null` = UNKNOWN (the engine doesn't expose the tool
//     index, so only its absence can be asserted). With `null` the card
//     promises neither that it has it nor that it doesn't: it just offers it.
//  2. "Not now" exists. A card that can only be accepted is a funnel, not an
//     offer.
//  3. One request, one click. It gets marked in this browser so two clicks
//     don't become two requests, and the endpoint ALSO defends itself: it
//     validates the id against the catalog, trims the text and doesn't record
//     the same row twice in a row (verified on 8/12 against the lab -- the
//     request gets written to `policy/capabilities/requests.jsonl`, with
//     date, agent and source). In other words, "Requested" is no longer a
//     promise from the browser: it's a record.

import { useEffect, useState } from "react";
import { Check, Sparkles } from "lucide-react";
import { loadConfig, requestCapability, type Capability } from "./agent";
// The catalog and the memory of what's been requested live in
// `lib/capabilities.ts` ever since each teammate's profile started reading
// them too: they're the same two pieces of state, and two copies would
// answer "does it already have this?" and "did I already ask for it?"
// differently.
import { capabilityCatalog, readRequested, markRequested } from "./capabilities";

function Fact({ label, children }: { label: string; children: string }) {
  return (
    <span className="mt-1 block text-[12.5px] leading-snug text-ink-soft">
      <span className="font-semibold text-ink">{label}</span> {children}
    </span>
  );
}

export function CapabilityInline({ id }: { id: string }) {
  const [c, setC] = useState<Capability | null | undefined>(undefined);
  const [requested, setRequested] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [postponed, setPostponed] = useState(false);

  useEffect(() => {
    let alive = true;
    setRequested(readRequested().includes(id));
    capabilityCatalog().then((cs) => { if (alive) setC(cs.find((x) => x.id === id) ?? null); });
    return () => { alive = false; };
  }, [id]);

  const request = async () => {
    const cfg = loadConfig();
    if (!cfg || !c || requesting) return;
    setRequesting(true);
    setErr(null);
    try {
      await requestCapability(cfg, c.id, `El cliente pidió «${c.label}» desde el chat.`);
      markRequested(c.id);
      setRequested(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "no pude registrar el pedido");
    } finally {
      setRequesting(false);
    }
  };

  if (c === undefined) {
    return <span className="inline-block h-4 w-32 animate-pulse rounded bg-black/[0.06] align-middle" />;
  }
  // Id not in the catalog (or an old adapter): we do NOT show the raw token.
  // The agent naming something the portal doesn't know is our problem, not
  // the client's.
  if (c === null) {
    return (
      <span className="text-ink-soft">
        Para esto le falta una herramienta que todavía no tiene. Pedínosla por el chat de
        soporte y la vemos.
      </span>
    );
  }
  // `active === true` is the only thing that can be asserted: it already has
  // it and naming it would be noise. `false` and `null` (unknown) get offered
  // the same, with no diagnosis attached.
  if (c.active === true) return null;

  // A base capability ships included on every agent: nothing is being SOLD
  // here, it's flagging that something already theirs came out half-done.
  // Same POST, a different conversation.
  const isBase = c.level === "base";

  if (postponed) {
    return (
      <span className="not-prose my-1.5 flex items-center gap-2 text-[12.5px] text-ink-soft">
        Lo dejamos para más adelante.
        <button
          onClick={() => setPostponed(false)}
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
          {isBase ? "Esto viene con tu agente" : "Tu agente pide esto para hacerlo bien"}
        </span>
        <span className="mt-0.5 block text-sm font-semibold text-ink">{c.label}</span>
        {c.purpose && <Fact label="Para qué sirve:">{c.purpose}</Fact>}
        {c.how && <Fact label="Cómo se hace:">{c.how}</Fact>}
        {c.cost && <Fact label="Qué cuesta:">{c.cost}</Fact>}

        {requested ? (
          <span className="mt-2 flex items-center gap-1.5 text-[12.5px] font-medium text-c-green-ink">
            <Check className="h-3.5 w-3.5 shrink-0" />
            Pedida. La estamos viendo y te escribimos cuando esté.
          </span>
        ) : (
          <>
            <span className="mt-2.5 flex flex-wrap items-center gap-2">
              <button
                onClick={request}
                disabled={requesting}
                className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-[13px] font-semibold text-white transition hover:bg-primary-dark disabled:opacity-50"
              >
                {requesting ? "Pidiendo…" : isBase ? "Avisanos" : "Pedirla"}
              </button>
              {!isBase && (
                <button
                  onClick={() => setPostponed(true)}
                  className="inline-flex h-8 items-center rounded-lg px-2.5 text-[13px] font-semibold text-ink-soft transition hover:bg-black/[0.05] hover:text-ink"
                >
                  Ahora no
                </button>
              )}
            </span>
            {/* Honesty: requesting it doesn't turn it on. We turn it on. */}
            <span className="mt-1.5 block text-[12px] leading-snug text-ink-soft/85">
              {isBase
                ? "Ya está incluida en lo tuyo: avisarnos no cuesta nada, lo revisamos y te escribimos."
                : "Pedirla no cambia nada todavía: nos avisa a nosotros, lo miramos y te escribimos. Podés seguir con lo tuyo mientras tanto."}
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
