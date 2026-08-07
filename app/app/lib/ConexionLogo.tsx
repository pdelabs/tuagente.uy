"use client";

// El tile de una conexión, estilo directorio: fondo blanco, borde suave y el
// logo REAL de la marca (como los conectores de Claude, que es el patrón que
// el cliente ya vio). Una conexión sin logo conocido cae a un ícono genérico
// con color propio — nunca se rompe por un id nuevo.

import {
  CalendarDays, Hash, Mail, Plug, Sparkles, type LucideIcon,
} from "lucide-react";
import { LogoGmail, LogoGoogle, LogoTelegram, LogoWhatsApp } from "./Logos";

const TAM = { sm: "h-9 w-9", md: "h-10 w-10" };

const MARCAS: Record<string, (p: { className?: string }) => JSX.Element> = {
  "telegram": LogoTelegram,
  "whatsapp": LogoWhatsApp,
  "google-workspace": LogoGoogle,
  "gmail-lectura": LogoGmail,
};

const GENERICOS: Record<string, { icon: LucideIcon; fg: string }> = {
  "correo": { icon: Mail, fg: "text-c-coral-ink" },
  "slack": { icon: Hash, fg: "text-c-violet-ink" },
  "modelos-auxiliares": { icon: Sparkles, fg: "text-c-violet-ink" },
  "google-calendar": { icon: CalendarDays, fg: "text-c-amber-ink" },
};

export function ConexionLogo({ id, size = "md" }: { id: string; size?: "sm" | "md" }) {
  const Marca = MARCAS[id];
  const glifo = size === "sm" ? "h-4 w-4" : "h-5 w-5";
  const generico = GENERICOS[id] ?? { icon: Plug, fg: "text-ink-soft" };
  const Icon = generico.icon;
  return (
    <span
      className={`flex ${TAM[size]} shrink-0 items-center justify-center rounded-lg border border-black/[0.08] bg-white shadow-soft`}
    >
      {Marca ? <Marca className={glifo} /> : <Icon className={`${glifo} ${generico.fg}`} />}
    </span>
  );
}
