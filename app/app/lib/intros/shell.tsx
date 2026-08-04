"use client";

// Piezas compartidas de las pantallas de bienvenida por módulo.
// A propósito son MÍNIMAS: cada módulo arma su propia composición y su propia
// ilustración — no queremos ocho pantallas iguales con distinto texto.
// Marca tuagente: violeta #5B4BE8, tonales, Jakarta (global), radios generosos.

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Btn } from "../ui";

export type IntroProps = { onOk: () => void };

/** Contenedor de la pantalla: centra, limita el ancho y pone el CTA al final. */
export function IntroPage({ children, onOk, cta = "Empezar", note }: {
  children: ReactNode;
  onOk: () => void;
  cta?: string;
  note?: string;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center px-6 py-12">
      <div className="w-full max-w-3xl">
        {children}
        {/* flex-wrap: en pantallas muy angostas la nota baja en vez de
            aplastar el botón (el Btn tiene ancho mínimo propio). */}
        <div className="mt-8 flex flex-wrap items-center gap-x-3 gap-y-2">
          <Btn onClick={onOk}>{cta}</Btn>
          {note && <span className="text-[12px] text-ink-soft">{note}</span>}
        </div>
      </div>
    </div>
  );
}

export function Eyebrow({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <p className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-c-violet px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-primary">
      <Icon className="h-3 w-3" />
      {children}
    </p>
  );
}

export function Title({ children }: { children: ReactNode }) {
  return (
    <h1 className="text-[28px] font-extrabold leading-tight tracking-tight text-ink">
      {children}
    </h1>
  );
}

export function Lead({ children }: { children: ReactNode }) {
  return <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-ink-soft">{children}</p>;
}

/** Fila de "qué podés hacer acá": ícono + texto, sin viñetas genéricas. */
export function Point({ icon: Icon, title, children }: {
  icon: LucideIcon; title: string; children?: ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-black/[0.04]">
        <Icon className="h-3.5 w-3.5 text-ink-soft" />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-ink">{title}</p>
        {children && <p className="mt-0.5 text-[13px] leading-relaxed text-ink-soft">{children}</p>}
      </div>
    </div>
  );
}
