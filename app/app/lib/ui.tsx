"use client";

// Componentes compartidos del portal — M3 expressive de tuagente.uy.
// Los features importan de acá; no re-estilar por feature.

import { ReactNode } from "react";

export function Card({ tone = "surface", className = "", children }: {
  tone?: "surface" | "violet" | "green" | "coral" | "amber";
  className?: string;
  children: ReactNode;
}) {
  const tones: Record<string, string> = {
    surface: "bg-white",
    violet: "bg-c-violet text-c-violet-ink",
    green: "bg-c-green text-c-green-ink",
    coral: "bg-c-coral text-c-coral-ink",
    amber: "bg-c-amber text-c-amber-ink",
  };
  return (
    <div className={`rounded-card shadow-soft p-5 ${tones[tone]} ${className}`}>
      {children}
    </div>
  );
}

export function Chip({ tone = "violet", children }: {
  tone?: "violet" | "green" | "coral" | "amber" | "ink";
  children: ReactNode;
}) {
  const tones: Record<string, string> = {
    violet: "bg-c-violet text-c-violet-ink",
    green: "bg-c-green text-c-green-ink",
    coral: "bg-c-coral text-c-coral-ink",
    amber: "bg-c-amber text-c-amber-ink",
    ink: "bg-c-ink text-white",
  };
  return (
    <span className={`inline-block rounded-pill px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function Btn({ kind = "primary", disabled, onClick, children }: {
  kind?: "primary" | "ghost" | "danger";
  disabled?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  const kinds: Record<string, string> = {
    primary: "bg-primary text-white hover:bg-primary-dark",
    ghost: "bg-c-violet text-c-violet-ink hover:bg-primary hover:text-white",
    danger: "bg-c-coral text-c-coral-ink hover:bg-red-600 hover:text-white",
  };
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={`rounded-pill px-5 py-2 font-bold text-sm transition disabled:opacity-40 ${kinds[kind]}`}
    >
      {children}
    </button>
  );
}

export function EmptyState({ emoji = "✋", title, hint }: {
  emoji?: string; title: string; hint?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="text-5xl mb-4">{emoji}</div>
      <p className="font-bold text-ink">{title}</p>
      {hint && <p className="text-sm text-ink-soft mt-1">{hint}</p>}
    </div>
  );
}

export function Spinner() {
  return (
    <div className="flex justify-center py-16">
      <div className="h-8 w-8 rounded-full border-4 border-c-violet border-t-primary animate-spin" />
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <p className="font-bold text-ink">No pude hablar con tu agente</p>
      <p className="text-sm text-ink-soft mt-1">{message}</p>
      {onRetry && <div className="mt-4"><Btn kind="ghost" onClick={onRetry}>Reintentar</Btn></div>}
    </div>
  );
}
