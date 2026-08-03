"use client";

// Kit UI del portal — v2 profesional: superficies planas separadas por
// bordes hairline (sin sombras), radios contenidos, foco visible en inputs.
// Los features importan de acá; no re-estilar por feature.

import { ReactNode } from "react";
import { Hand, Loader2, type LucideIcon } from "lucide-react";

// Clases de input compartidas (texto, búsqueda, textarea).
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
  label: string; // accesibilidad + tooltip nativo
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
