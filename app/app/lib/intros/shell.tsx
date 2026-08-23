"use client";

// Shared pieces for the per-module welcome screens.
// Deliberately MINIMAL: each module builds its own composition and its own
// illustration -- we don't want eight identical screens with different text.
// tuagente brand: violet #5B4BE8, tonal colors, Jakarta (global), generous radii.

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Btn } from "../ui";

export type IntroProps = { onOk: () => void };

/** The screen's container: centers, caps the width and puts the CTA at the end. */
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
        {/* flex-wrap: on very narrow screens the note wraps below instead of
            squeezing the button (Btn has its own minimum width). */}
        <div className="mt-8 flex flex-wrap items-center gap-x-3 gap-y-2">
          <Btn onClick={onOk}>{cta}</Btn>
          {note && <span className="text-[12px] text-ink-soft">{note}</span>}
        </div>
      </div>
    </div>
  );
}

/** THE FRAME AROUND ILLUSTRATIONS. Every mockup goes inside this.
 *
 *  WHY IT EXISTS. A test client went into Connections, saw the green
 *  checkmarks the welcome screen drew next to Telegram, her company's email
 *  and her spreadsheets, and walked away convinced she already had everything
 *  plugged in. She had nothing. The illustration used the same hairline, the
 *  same white and the same tonal colors as the real screen: there was no way
 *  for her to tell. "It's obviously an example" isn't a defense -- it wasn't one.
 *
 *  This frame says it three ways at once, because any single one gets missed:
 *  the DASHED border (the real portal never uses one), the "Ejemplo" label,
 *  and a short line spelling out what isn't actually hers ("these aren't your
 *  tasks"). The clarifying line isn't optional whenever the drawing shows
 *  something the client could read as their own: tasks, files, numbers,
 *  transactions.
 *
 *  AND THE RULE YOU CAN'T SEE: nothing that looks like a control goes inside a
 *  mockup. No text field, no button, no chip that invites a tap. The same
 *  client typed "hola" into the chat welcome screen's drawn composer and sat
 *  waiting for a reply that was never coming. What's drawn gets looked at;
 *  the only thing you touch on these screens is the button at the bottom,
 *  which is real.
 *
 *  The other way out -- when the portal ALREADY KNOWS the real state -- is to
 *  draw nothing and show the actual data (see Connections' welcome screen). A
 *  drawing can never assert a fact about the client. */
export function Mockup({ note, className = "", children }: {
  note?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <figure className={`rounded-card border border-dashed border-black/[0.18] p-3 sm:p-4 ${className}`}>
      <figcaption className="mb-2.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="rounded-md bg-black/[0.06] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink-soft">
          Ejemplo
        </span>
        {note && <span className="text-[11px] leading-snug text-ink-soft">{note}</span>}
      </figcaption>
      {/* To a screen reader the drawing is noise: what says what's in here is
          the text next to it. */}
      <div aria-hidden>{children}</div>
    </figure>
  );
}

/** One step of a "how it works": icon + text, with NO pill or border.
 *
 *  They used to be white pills with a border -- i.e., buttons. "Pedís la
 *  conexión" and "Correr ahora" also happen to be the names of controls that
 *  really exist on those screens: drawing them shaped like a button promises
 *  a click that does nothing here. */
export function Step({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-ink">
      <Icon className="h-3.5 w-3.5 shrink-0 text-ink-soft" />
      {children}
    </span>
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

/** A "what you can do here" row: icon + text, no generic bullets. */
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
