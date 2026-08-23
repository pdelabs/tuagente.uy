"use client";

// The portal's UI kit -- professional v2: flat surfaces separated by hairline
// borders (no shadows), contained radii, visible focus on inputs. Modules
// import from here; no re-styling per module.

import { ReactNode } from "react";
import { Hand, LifeBuoy, Loader2, type LucideIcon } from "lucide-react";

// tuagente's support (ours, the same for every client -- not client data, so
// it doesn't violate principle zero). Exists because a test client sat twice
// in front of a broken screen with nobody to tell: "I had nobody to ask" was
// one of the first things she wrote down.
export const SUPPORT = {
  whatsapp: "https://wa.me/59899002835",
  mail: "mailto:hola@tuagente.uy",
  phone: "+598 99 002 835",
};

/** Support link. Goes on screens where the client can get stuck (login, no
 *  connection, error) and at the bottom of the menu.
 *
 *  `label` gets reused where writing to us isn't a cry for help -- adding
 *  someone to the team, for instance. The URL still lives in ONE single
 *  place, which is the point: a hand-written mailto on every screen is one
 *  more thing that drifts out of sync the day our number changes. */
export function Support({ className = "", label }: { className?: string; label?: string }) {
  return (
    <a
      href={SUPPORT.whatsapp}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-soft transition hover:text-primary ${className}`}
    >
      <LifeBuoy className="h-3.5 w-3.5 shrink-0" />
      {label ?? "¿Algo no anda? Escribinos"}
    </a>
  );
}

// Shared input classes (text, search, textarea).
export const inputCls =
  "w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm text-ink " +
  "placeholder:text-ink-soft/60 outline-none transition " +
  "focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:opacity-50";

export function Card({ tone = "surface", className = "", children }: {
  tone?: "surface" | "violet" | "green" | "coral" | "amber";
  className?: string;
  children: ReactNode;
}) {
  const tones: Record<string, string> = {
    surface: "bg-white border border-black/[0.07]",
    violet: "bg-c-violet/50 border border-c-violet",
    green: "bg-c-green/50 border border-c-green",
    coral: "bg-c-coral/50 border border-c-coral",
    amber: "bg-c-amber/50 border border-c-amber",
  };
  return (
    <div className={`rounded-xl p-4 ${tones[tone]} ${className}`}>
      {children}
    </div>
  );
}

export function Chip({ tone = "neutral", children }: {
  tone?: "violet" | "green" | "coral" | "amber" | "neutral";
  children: ReactNode;
}) {
  const tones: Record<string, string> = {
    violet: "bg-c-violet text-c-violet-ink",
    green: "bg-c-green text-c-green-ink",
    coral: "bg-c-coral text-c-coral-ink",
    amber: "bg-c-amber text-c-amber-ink",
    neutral: "bg-black/[0.05] text-ink-soft",
  };
  return (
    <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function Btn({ kind = "primary", size = "md", disabled, onClick, children }: {
  kind?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  disabled?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  const kinds: Record<string, string> = {
    primary: "bg-primary text-white hover:bg-primary-dark",
    secondary: "border border-black/10 bg-white text-ink hover:bg-black/[0.03]",
    ghost: "text-ink-soft hover:bg-black/[0.05] hover:text-ink",
    danger: "border border-c-coral bg-white text-c-coral-ink hover:bg-c-coral/40",
  };
  const sizes: Record<string, string> = {
    sm: "h-8 px-2.5 text-[13px]",
    md: "h-9 px-3.5 text-sm",
  };
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold transition disabled:pointer-events-none disabled:opacity-40 ${kinds[kind]} ${sizes[size]}`}
    >
      {children}
    </button>
  );
}

export function IconBtn({ label, onClick, disabled, children }: {
  label: string; // accessibility + native tooltip
  onClick?: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-ink-soft transition hover:bg-black/[0.05] hover:text-ink disabled:pointer-events-none disabled:opacity-40"
    >
      {children}
    </button>
  );
}

export function PageHeader({ title, subtitle, actions }: {
  title: string; subtitle?: string; actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-ink-soft">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Modal({ onClose, children, wide = false }: {
  onClose: () => void; children: ReactNode; wide?: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/25 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className={`flex max-h-[85vh] w-full flex-col overflow-hidden rounded-xl border border-black/10 bg-white ${wide ? "max-w-3xl" : "max-w-xl"}`}
      >
        {children}
      </div>
    </div>
  );
}

/** The link you were sent doesn't lead anywhere anymore.
 *
 *  It happens on its own: an approval gets approved, a task gets archived, a
 *  file gets renamed. A link the agent sent by mail two days ago goes stale
 *  without anyone doing anything wrong. Every screen used to react
 *  differently -- one silently, another stuck on "Abriendo…" forever, another
 *  with "No pude hablar con tu agente", which was also a lie. Now it's always
 *  the same: it's said plainly and the list is shown, which is where the
 *  client can carry on. */
export function StaleLinkNotice({ children }: { children: ReactNode }) {
  return (
    <p className="mb-4 rounded-lg border border-c-amber bg-c-amber/25 px-3 py-2 text-[13px] leading-snug text-c-amber-ink">
      {children}
    </p>
  );
}

export function EmptyState({ icon: Icon = Hand, title, hint }: {
  icon?: LucideIcon; title: string; hint?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-black/[0.04]">
        <Icon className="h-5 w-5 text-ink-soft" />
      </div>
      <p className="text-sm font-semibold text-ink">{title}</p>
      {hint && <p className="mt-1 max-w-sm text-sm text-ink-soft">{hint}</p>}
    </div>
  );
}

export function Spinner() {
  return (
    <div className="flex justify-center py-12">
      <Loader2 className="h-5 w-5 animate-spin text-ink-soft" />
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <p className="text-sm font-semibold text-ink">No pude hablar con tu agente</p>
      <p className="mt-1 text-sm text-ink-soft">{message}</p>
      {onRetry && <div className="mt-4"><Btn kind="secondary" size="sm" onClick={onRetry}>Reintentar</Btn></div>}
    </div>
  );
}
