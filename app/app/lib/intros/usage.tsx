"use client";

// "Usage" welcome screen.
// Composition: the tab's three numbers (today, this month, all-time) in a
// row, and three points below. Illustration in divs, no external images.
//
// TOKENS AREN'T MENTIONED HERE. This welcome screen used to show "TOKENS 1.24
// M" next to the sessions. The test client quoted it verbatim: "I don't know
// what a token is and I don't care; US$0.10 is the only thing I want to know."
//
// AND NO CHART THAT DOESN'T EXIST GETS DRAWN EITHER. Until 8/19/2026 the panel
// had fourteen bars of daily spend: the tab showed them because we built the
// number ourselves by summing calls -- and that sum missed by 9x LOW. Now the
// number comes from the provider, which reports three totals and no series. A
// welcome screen promising a chart the tab doesn't have sends people looking
// for something that isn't there.
//
// THE PANEL IS A DRAWING, and here that matters more than anywhere else: "US$
// 7.80" under a title that says how much you spent is someone's real money.
// It sits inside `Mockup`, which labels it as an example.

import { BarChart3, CalendarDays, Receipt, Wallet } from "lucide-react";
import { IntroPage, Eyebrow, Title, Lead, Mockup, Point, type IntroProps } from "./shell";

function Stat({ label, value, big = false }: { label: string; value: string; big?: boolean }) {
  return (
    <div className="min-w-0 rounded-xl border border-black/[0.06] bg-surface px-3 py-2.5">
      <p className="truncate text-[10px] font-bold uppercase tracking-wide text-ink-soft">{label}</p>
      <p
        className={`mt-1 font-extrabold leading-none tabular-nums text-ink ${
          big ? "text-[26px]" : "text-[20px]"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function Panel() {
  return (
    <Mockup className="min-w-0 bg-white" note="Números inventados: no es tu consumo.">
      <div className="grid gap-2 sm:grid-cols-3">
        <Stat label="Hoy" value="US$ 0,42" big />
        <Stat label="Este mes" value="US$ 7,80" />
        <Stat label="Desde siempre" value="US$ 23,10" />
      </div>
      <p className="mt-3 text-[11px] leading-snug text-ink-soft">
        Los números vienen de OpenRouter: es lo que tu agente gasta de verdad.
      </p>
    </Mockup>
  );
}

export default function UsageIntro({ onOk }: IntroProps) {
  return (
    <IntroPage
      onOk={onOk}
      cta="Ver el uso"
      note="Si tu agente todavía no puede informarlo, ahí te lo decimos."
    >
      <Eyebrow icon={BarChart3}>Uso</Eyebrow>
      <Title>Cuánto gastó tu agente</Title>
      <Lead>
        Lo que costó su trabajo, en dólares: hoy, este mes y desde que arrancó. No incluye tu abono
        mensual y no es un cobro — está para que veas cuánto se está usando y no te agarre de
        sorpresa.
      </Lead>

      <div className="mt-6">
        <Panel />
      </div>

      <div className="mt-6 grid gap-5 md:grid-cols-3">
        <Point icon={Receipt} title="El número lo da quien cobra">
          No es una cuenta nuestra: se lo preguntamos a OpenRouter, el proveedor de los motores de
          IA con los que trabaja tu agente. Es lo que efectivamente se gastó.
        </Point>
        <Point icon={CalendarDays} title="Hoy, este mes y desde siempre">
          Tres números y nada más. Con el del día ves si algo se disparó; con el del mes, cómo viene
          cerrando.
        </Point>
        <Point icon={Wallet} title="Entra todo">
          Responderte, generar una imagen, buscar en internet: todo lo que hace tu agente pasa por
          la misma cuenta y está acá adentro.
        </Point>
      </div>
    </IntroPage>
  );
}
