"use client";

// A connection's tile, directory-style: white background, a soft border and
// the brand's REAL logo (like Claude's connectors, which is the pattern the
// client has already seen). A connection with no known logo falls back to a
// generic icon with its own color -- never breaks on a new id.

import {
  CalendarDays, Hash, Mail, Plug, Sparkles, type LucideIcon,
} from "lucide-react";
import { LogoGmail, LogoGoogle, LogoTelegram, LogoWhatsApp } from "./Logos";

const SIZE = { sm: "h-9 w-9", md: "h-10 w-10" };

const BRANDS: Record<string, (p: { className?: string }) => JSX.Element> = {
  "telegram": LogoTelegram,
  "whatsapp": LogoWhatsApp,
  "google-workspace": LogoGoogle,
  "gmail-lectura": LogoGmail,
};

const GENERIC: Record<string, { icon: LucideIcon; fg: string }> = {
  "email": { icon: Mail, fg: "text-c-coral-ink" },
  "slack": { icon: Hash, fg: "text-c-violet-ink" },
  "auxiliary-models": { icon: Sparkles, fg: "text-c-violet-ink" },
  "google-calendar": { icon: CalendarDays, fg: "text-c-amber-ink" },
};

export function ConnectionLogo({ id, size = "md" }: { id: string; size?: "sm" | "md" }) {
  const Brand = BRANDS[id];
  const glyph = size === "sm" ? "h-4 w-4" : "h-5 w-5";
  const generic = GENERIC[id] ?? { icon: Plug, fg: "text-ink-soft" };
  const Icon = generic.icon;
  return (
    <span
      className={`flex ${SIZE[size]} shrink-0 items-center justify-center rounded-lg border border-black/[0.08] bg-white shadow-soft`}
    >
      {Brand ? <Brand className={glyph} /> : <Icon className={`${glyph} ${generic.fg}`} />}
    </span>
  );
}
