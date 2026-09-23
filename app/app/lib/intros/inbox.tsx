"use client";

// Bandeja's welcome screen.
//
// The one thing this screen has to land: THE AGENT DOES NOT ANSWER ON ITS OWN.
// It reads what came in, writes the answer, and the answer waits for the
// client's ok. A client who reads "your agent answers your mail" and finds out
// later that nothing went out without her is a client who stopped trusting the
// screen; one who reads it here knows where to look for the ones waiting.
//
// The illustration is the tab itself: two conversations in the list and the
// state chip on each. Inside `Mockup`, like every other one — a drawing can
// never assert a fact about the client, and these names are invented.

import { Hand, Inbox, Instagram, Mail, PenLine } from "lucide-react";
import { Eyebrow, IntroPage, Lead, Mockup, Point, Title, type IntroProps } from "./shell";

/** A "line" of a message. */
function Line({ w }: { w: string }) {
  return <span className={`block h-1.5 rounded-pill bg-black/[0.1] ${w}`} />;
}

function Row({ icon: Icon, who, chip, tone }: {
  icon: typeof Mail; who: string; chip: string; tone: string;
}) {
  return (
    <div className="rounded-lg border border-black/[0.07] bg-white px-2.5 py-2">
      <div className="flex items-center gap-1.5">
        <Icon className="h-3 w-3 shrink-0 text-ink-soft" />
        <span className="flex-1 truncate text-[11px] font-semibold text-ink">{who}</span>
        <span className={`rounded-md px-1.5 py-0.5 text-[9px] font-bold ${tone}`}>{chip}</span>
      </div>
      <div className="mt-1.5 space-y-1">
        <Line w="w-[86%]" />
        <Line w="w-[54%]" />
      </div>
    </div>
  );
}

export default function InboxIntro({ onOk }: IntroProps) {
  return (
    <IntroPage
      onOk={onOk}
      cta="Ver la bandeja"
      note="Si todavía no conectaste la casilla, va a estar vacía."
    >
      <Eyebrow icon={Inbox}>Bandeja</Eyebrow>
      <Title>Todo lo que te escriben, en un solo lugar</Title>
      <Lead>
        Cada mensaje que entra por el mail de la empresa o por Instagram queda acá,
        con la conversación entera. Tu agente escribe la respuesta y la deja esperando
        tu ok: no sale nada sin que lo mires.
      </Lead>

      <div className="mt-6 grid gap-6 md:grid-cols-2 md:items-start">
        <Mockup
          className="min-w-0 bg-gradient-to-br from-c-violet/60 via-surface to-white"
          note="Dos mensajes inventados: no son tuyos."
        >
          <div className="flex flex-col gap-1.5">
            <Row
              icon={Mail}
              who="Laura Méndez"
              chip="Nuevo"
              tone="bg-c-violet text-c-violet-ink"
            />
            <Row
              icon={Instagram}
              who="@tu.cliente"
              chip="Esperando tu ok"
              tone="bg-c-amber text-c-amber-ink"
            />
          </div>
        </Mockup>

        <div className="grid min-w-0 gap-5">
          <Point icon={Mail} title="El mail y los comentarios, juntos">
            No importa por dónde te escribieron: la conversación es una sola y está
            completa, con los archivos que hayan mandado.
          </Point>
          <Point icon={PenLine} title="La respuesta ya está escrita">
            Tu agente la arma con la voz de tu empresa. Vos la leés, la corregís si
            querés y recién ahí sale.
          </Point>
          <Point icon={Hand} title="Vos tenés la última palabra">
            Las que esperan tu ok te llevan a Aprobaciones. Lo que no quieras que
            conteste, se lo decís por el chat.
          </Point>
        </div>
      </div>
    </IntroPage>
  );
}
