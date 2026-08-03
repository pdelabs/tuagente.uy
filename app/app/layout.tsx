"use client";

// Shell del portal: sidebar por manifest + header con el nombre del agente.
// Los features viven en subcarpetas y NO tocan este archivo.

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  loadConfig, clearConfig, getManifest,
  type PortalConfig, type Manifest,
} from "./lib/agent";
import { Btn, Spinner } from "./lib/ui";

// Orden y rótulos de módulos; se muestran solo los que el manifest habilita.
export const MODULES: { key: string; path: string; label: string; emoji: string }[] = [
  { key: "chat", path: "/app/chat", label: "Chat", emoji: "💬" },
  { key: "kanban", path: "/app/pipeline", label: "Pipeline", emoji: "📋" },
  { key: "approvals", path: "/app/aprobaciones", label: "Aprobaciones", emoji: "✋" },
  { key: "crons", path: "/app/tareas", label: "Tareas", emoji: "⏰" },
  { key: "activity", path: "/app/actividad", label: "Actividad", emoji: "📈" },
  { key: "files", path: "/app/archivos", label: "Archivos", emoji: "📁" },
  { key: "usage", path: "/app/uso", label: "Uso", emoji: "📊" },
];

function Login({ onReady }: { onReady: () => void }) {
  const [link, setLink] = useState("");
  const [err, setErr] = useState("");
  const enter = () => {
    const hash = link.includes("#") ? link.slice(link.indexOf("#")) : `#key=${link.trim()}`;
    if (!/key=[^&]+/.test(hash)) { setErr("Ese link no tiene una clave. Pedile a tu agente el magic link."); return; }
    window.location.hash = hash;
    onReady();
  };
  return (
    <main className="min-h-screen bg-surface flex items-center justify-center p-6">
      <div className="bg-white rounded-card shadow-soft p-8 max-w-md w-full">
        <div className="text-4xl mb-3">✋</div>
        <h1 className="text-2xl font-extrabold text-ink tracking-tight">tuagente</h1>
        <p className="text-ink-soft text-sm mt-1 mb-6">
          Pegá el magic link que te dimos para entrar al portal de tu agente.
        </p>
        <input
          value={link}
          onChange={(e) => { setLink(e.target.value); setErr(""); }}
          onKeyDown={(e) => e.key === "Enter" && enter()}
          placeholder="https://app.tuagente.uy/app#key=…"
          className="w-full rounded-pill border border-c-violet bg-surface px-5 py-3 text-sm text-ink outline-none focus:border-primary"
        />
        {err && <p className="text-sm text-c-coral-ink mt-2">{err}</p>}
        <div className="mt-4"><Btn onClick={enter}>Entrar</Btn></div>
      </div>
    </main>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [cfg, setCfg] = useState<PortalConfig | null>(null);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [state, setState] = useState<"loading" | "login" | "error" | "ok">("loading");

  const boot = () => {
    const c = loadConfig();
    if (!c) { setState("login"); return; }
    setCfg(c);
    getManifest(c)
      .then((m) => { setManifest(m); setState("ok"); })
      .catch(() => setState("error"));
  };
  useEffect(boot, []);

  if (state === "loading") return <main className="min-h-screen bg-surface"><Spinner /></main>;
  if (state === "login") return <Login onReady={boot} />;
  if (state === "error" || !manifest || !cfg) {
    return (
      <main className="min-h-screen bg-surface flex flex-col items-center justify-center p-6 text-center">
        <div className="text-4xl mb-3">😴</div>
        <p className="font-bold text-ink">No pude conectar con tu agente</p>
        <p className="text-sm text-ink-soft mt-1 mb-4">Puede estar apagado, o el link venció.</p>
        <div className="flex gap-3">
          <Btn onClick={boot}>Reintentar</Btn>
          <Btn kind="ghost" onClick={() => { clearConfig(); setState("login"); }}>Cambiar link</Btn>
        </div>
      </main>
    );
  }

  const enabled = MODULES.filter((m) => manifest.modules[m.key]);
  return (
    <div className="min-h-screen bg-surface flex">
      <aside className="w-56 shrink-0 p-4 flex flex-col gap-1 sticky top-0 h-screen">
        <div className="px-3 py-4">
          <p className="font-extrabold text-ink tracking-tight">✋ tuagente</p>
          <p className="text-xs text-ink-soft mt-0.5">{manifest.agent}</p>
        </div>
        {enabled.map((m) => {
          const active = pathname.startsWith(m.path);
          return (
            <Link
              key={m.key}
              href={m.path}
              className={`rounded-pill px-4 py-2.5 text-sm font-bold transition ${
                active ? "bg-primary text-white" : "text-ink hover:bg-c-violet hover:text-c-violet-ink"
              }`}
            >
              <span className="mr-2">{m.emoji}</span>{m.label}
            </Link>
          );
        })}
        <div className="mt-auto px-3 py-2">
          <button
            onClick={() => { clearConfig(); setState("login"); }}
            className="text-xs text-ink-soft hover:text-ink"
          >
            Salir
          </button>
        </div>
      </aside>
      <main className="flex-1 min-w-0 p-6">{children}</main>
    </div>
  );
}
