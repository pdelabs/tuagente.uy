"use client";

// Bienvenida de "Uso".
// Composición: los tres números de la pestaña (hoy, este mes, desde siempre) en
// una fila, y abajo tres puntos. Ilustración en divs, sin imágenes externas.
//
// ACÁ NO SE HABLA DE TOKENS. Esta bienvenida mostraba "TOKENS 1,24 M" al lado de
// las sesiones. La clienta de prueba lo citó textual: "no sé qué es un token y
// no me importa; US$ 0,10 es lo único que quiero saber".
//
// Y TAMPOCO SE DIBUJA UN GRÁFICO QUE NO EXISTE. Hasta el 19/8/2026 el panel
// tenía catorce barras de gasto por día: la pestaña las mostraba porque el
// número lo armábamos nosotros sumando llamadas — y esa suma le erraba 9x para
// abajo. Ahora el número lo da el proveedor, que informa tres totales y ninguna
// serie. Una bienvenida que promete un gráfico que la pestaña no tiene manda a
// buscar algo que no está.
//
// EL PANEL ES UN DIBUJO, y acá importa más que en ningún lado: "US$ 7,80" abajo
// de un título que dice cuánto gastaste es la plata de alguien. Va adentro de
// `Maqueta`, que lo rotula como ejemplo.

import { BarChart3, CalendarDays, Receipt, Wallet } from "lucide-react";
import { IntroPage, Eyebrow, Title, Lead, Maqueta, Point, type IntroProps } from "./shell";

function Numero({ label, value, big = false }: { label: string; value: string; big?: boolean }) {
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
    <Maqueta className="min-w-0 bg-white" nota="Números inventados: no es tu consumo.">
      <div className="grid gap-2 sm:grid-cols-3">
        <Numero label="Hoy" value="US$ 0,42" big />
        <Numero label="Este mes" value="US$ 7,80" />
        <Numero label="Desde siempre" value="US$ 23,10" />
      </div>
      <p className="mt-3 text-[11px] leading-snug text-ink-soft">
        Los números vienen de OpenRouter: es lo que tu agente gasta de verdad.
      </p>
    </Maqueta>
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
