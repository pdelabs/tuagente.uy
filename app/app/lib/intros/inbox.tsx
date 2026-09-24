"use client";

// Bandeja's welcome screen: the messages tab of the base plan.
//
// The one thing this screen has to land: WHO ANSWERS WHAT. On WhatsApp and
// Instagram the agent answers on its own, with the owner's rules, and leaves
// her what is not its to answer; a mail waits for her ok. A client who reads
// "your agent answers" and finds a mail that never went out stops trusting
// the screen — and one who does not know the agent writes to her customers
// by itself finds out the worst way. Said here, both are expected.
//
// The illustration is the tab itself: three conversations, one per channel,
// and the state chip on each. Inside `Mockup`, like every other one — a
// drawing can never assert a fact about the client, and these names are
// invented. The WhatsApp row is drawn even for an agent without the channel:
// the intro presents the tab, not this agent's inventory.

import type { ComponentType } from "react";
import { Hand, Inbox, Instagram, Mail, MessagesSquare, Smartphone } from "lucide-react";
import { Eyebrow, IntroPage, Lead, Mockup, Point, Title, type IntroProps } from "./shell";
import { WhatsAppGlyph } from "../glyphs";

/** A "line" of a message. */
function Line({ w }: { w: string }) {
  return <span className={`block h-1.5 rounded-pill bg-black/[0.1] ${w}`} />;
}

function Row({ icon: Icon, who, initials, chip, tone }: {
  icon: ComponentType<{ className?: string }>;
  who: string; initials: string; chip: string; tone: string;
}) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-black/[0.07] bg-white px-2.5 py-2">
      <span className="relative shrink-0">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-c-violet text-[10px] font-bold text-c-violet-ink">
          {initials}
        </span>
        <span className="absolute -bottom-0.5 -right-0.5 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-black/[0.07] bg-white">
          <Icon className="h-2 w-2 text-ink-soft" />
        </span>
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="flex-1 truncate text-[11px] font-semibold text-ink">{who}</span>
          <span className={`rounded-md px-1.5 py-0.5 text-[9px] font-bold ${tone}`}>{chip}</span>
        </div>
        <div className="mt-1.5 space-y-1">
          <Line w="w-[86%]" />
          <Line w="w-[54%]" />
        </div>
      </div>
    </div>
  );
}

export default function InboxIntro({ onOk }: IntroProps) {
  return (
    <IntroPage
      onOk={onOk}
      cta="Ver la bandeja"
      note="Si todavía no conectaste ningún canal, va a estar vacía."
    >
      <Eyebrow icon={Inbox}>Bandeja</Eyebrow>
      <Title>Todo lo que te escriben, en un solo lugar</Title>
      <Lead>
        Los mensajes de WhatsApp, de Instagram y del mail de la empresa quedan acá, con
        la conversación entera. En WhatsApp e Instagram tu agente contesta solo, con tus
        reglas; los mails los deja escritos esperando tu ok.
      </Lead>

      <div className="mt-6 grid gap-6 md:grid-cols-2 md:items-start">
        <Mockup
          className="min-w-0 bg-gradient-to-br from-c-violet/60 via-surface to-white"
          note="Tres conversaciones inventadas: no son tuyas."
        >
          <div className="flex flex-col gap-1.5">
            <Row
              icon={WhatsAppGlyph}
              who="Martín Suárez"
              initials="MS"
              chip="Respondido"
              tone="bg-c-green text-c-green-ink"
            />
            <Row
              icon={Instagram}
              who="@tu.cliente"
              initials="TC"
              chip="Te la dejó a vos"
              tone="bg-c-amber text-c-amber-ink"
            />
            <Row
              icon={Mail}
              who="Laura Méndez"
              initials="LM"
              chip="Esperando tu ok"
              tone="bg-c-amber text-c-amber-ink"
            />
          </div>
        </Mockup>

        <div className="grid min-w-0 gap-5">
          <Point icon={MessagesSquare} title="Contesta al toque, con tus reglas">
            En WhatsApp e Instagram responde solo lo que sabe. Lo que no está publicado,
            un reclamo o algo que no tiene claro, te lo deja a vos con una nota.
          </Point>
          <Point icon={Mail} title="Los mails esperan tu ok">
            Un mail lo deja escrito y sale cuando le decís que sí, desde Aprobaciones.
          </Point>
          <Point icon={Smartphone} title="Si contestás vos, se corre">
            Cuando le respondés a alguien desde tu celular, tu agente deja de contestarle
            por un rato. Si querés que la retome antes, se lo decís desde acá.
          </Point>
          <Point icon={Hand} title="Vos tenés la última palabra">
            Lo que no quieras que conteste, o cómo querés que lo haga, se lo decís por
            el chat.
          </Point>
        </div>
      </div>
    </IntroPage>
  );
}
