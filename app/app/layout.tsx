"use client";

// Shell del portal: sidebar por manifest + estado de conexión con el agente.
// Los features viven en subcarpetas y NO tocan este archivo.

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity, BarChart3, Clock, Columns3, Folder, Hand, Home, LayoutDashboard,
  LogOut, MessageSquare, Plug, Puzzle, type LucideIcon,
} from "lucide-react";
import {
  loadConfig, clearConfig, getManifest, getApprovals,
  type PortalConfig, type Manifest,
} from "./lib/agent";
import { Btn, Spinner, inputCls } from "./lib/ui";
import { INTROS, useIntroGate } from "./lib/intros";
import Onboarding, { loadAgentName } from "./lib/onboarding";
import {
  AgentitoAvatar, hayLookGuardado, loadAgentLook, lookDesdeAgente, saveAgentLook,
} from "./lib/agentito";

// Orden y rótulos de módulos; se muestran solo los que el manifest habilita
// (salvo "home", que es nuestro y no depende de lo que exponga el agente).
export const MODULES: { key: string; path: string; label: string; icon: LucideIcon }[] = [
  { key: "home", path: "/app/inicio", label: "Inicio", icon: Home },
  { key: "chat", path: "/app/chat", label: "Chat", icon: MessageSquare },
  { key: "kanban", path: "/app/pipeline", label: "Pipeline", icon: Columns3 },
  { key: "approvals", path: "/app/aprobaciones", label: "Aprobaciones", icon: Hand },
  { key: "artifacts", path: "/app/artefactos", label: "Artefactos", icon: LayoutDashboard },
  { key: "crons", path: "/app/tareas", label: "Tareas", icon: Clock },
  { key: "activity", path: "/app/actividad", label: "Actividad", icon: Activity },
  { key: "files", path: "/app/archivos", label: "Archivos", icon: Folder },
  { key: "usage", path: "/app/uso", label: "Uso", icon: BarChart3 },
  { key: "connections", path: "/app/conexiones", label: "Conexiones", icon: Plug },
  { key: "capabilities", path: "/app/capacidades", label: "Capacidades", icon: Puzzle },
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
    <main className="app-shell flex min-h-screen items-center justify-center bg-surface p-6">
      <div className="w-full max-w-md rounded-xl border border-black/[0.07] bg-white p-8">
        <AgentitoAvatar className="mb-3 h-14 w-14" />
        <h1 className="text-xl font-bold tracking-tight text-ink">tuagente</h1>
        <p className="mb-6 mt-1 text-sm text-ink-soft">
          Pegá el magic link que te dimos para entrar al portal de tu agente.
        </p>
        <input
          value={link}
          onChange={(e) => { setLink(e.target.value); setErr(""); }}
          onKeyDown={(e) => e.key === "Enter" && enter()}
          placeholder="https://app.tuagente.uy/app#key=…"
          className={inputCls}
        />
        {err && <p className="mt-2 text-sm text-c-coral-ink">{err}</p>}
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
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  // Nombre y look que el cliente le dio a su agente en el onboarding.
  // El look se lee lazy y no en un efecto: si no, el primer frame pinta el
  // agentito violeta por defecto y se ve el parpadeo.
  const [nombre, setNombre] = useState<string | null>(null);
  const [lookAgente, setLookAgente] = useState(loadAgentLook);
  useEffect(() => { setNombre(loadAgentName()); }, []);
  const { seen, dismiss } = useIntroGate();

  // Si este browser no conoce al agente pero el agente sí se conoce a sí mismo
  // (el cliente lo bautizó desde otra máquina), el portal se lo copia.
  const aprenderDelAgente = (m: Manifest) => {
    if (hayLookGuardado()) return;
    const suyo = lookDesdeAgente(m.look);
    if (suyo) { saveAgentLook(suyo); setLookAgente(suyo); }
  };

  const boot = () => {
    const c = loadConfig();
    if (!c) { setState("login"); return; }
    setCfg(c);
    getManifest(c)
      .then((m) => { setManifest(m); aprenderDelAgente(m); setOnline(true); setState("ok"); })
      .catch(() => setState("error"));
  };
  useEffect(boot, []);

  // El indicador tiene que decir la verdad: si el agente se apaga mientras el
  // portal está abierto, el punto verde mintiendo es peor que no tenerlo.
  // De paso traemos los pendientes, que es lo que el cliente quiere ver al entrar.
  useEffect(() => {
    if (state !== "ok" || !cfg) return;
    const tick = () => {
      getManifest(cfg).then((m) => { setManifest(m); setOnline(true); })
        .catch(() => setOnline(false));
      getApprovals(cfg)
        .then((r) => setPending(r.approvals?.length ?? 0))
        .catch(() => setPending(0));
    };
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [state, cfg]);

  if (state === "loading") return <main className="app-shell min-h-screen bg-surface"><Spinner /></main>;
  if (state === "login") return <Login onReady={boot} />;
  if (state === "error" || !manifest || !cfg) {
    return (
      <main className="app-shell flex min-h-screen flex-col items-center justify-center bg-surface p-6 text-center">
        {/* Apagado: el mismo agentito, dormido y sin color. */}
        <AgentitoAvatar look={lookAgente} apagado className="mb-2 h-20 w-20 opacity-45 grayscale" />
        <p className="text-sm font-semibold text-ink">No pude conectar con tu agente</p>
        <p className="mb-4 mt-1 text-sm text-ink-soft">Puede estar apagado, o el link venció.</p>
        <div className="flex gap-2">
          <Btn size="sm" onClick={boot}>Reintentar</Btn>
          <Btn kind="secondary" size="sm" onClick={() => { clearConfig(); setState("login"); }}>Cambiar link</Btn>
        </div>
      </main>
    );
  }

  // Onboarding: antes que cualquier módulo, el cliente bautiza a su agente y
  // el agente se presenta. Completa la bienvenida general, así que también
  // marca la intro de "home" (si no, hay dos pantallas de bienvenida seguidas).
  if (seen && !seen.onboarding) {
    return (
      <Onboarding
        manifest={manifest}
        cfg={cfg}
        onDone={(n) => {
          setNombre(n);
          setLookAgente(loadAgentLook());
          dismiss("onboarding");
          dismiss("home");
        }}
      />
    );
  }

  const enabled = MODULES.filter(
    (m) => m.key === "home" || m.key === "capabilities" || manifest.modules[m.key]);
  // Bienvenida por módulo: se ve una sola vez, hasta que el cliente da "Ok".
  const current = MODULES.find((m) => pathname.startsWith(m.path));
  const Intro = current ? INTROS[current.key] : undefined;
  const showIntro = Boolean(current && Intro && seen && !seen[current.key]);
  return (
    <div className="app-shell flex min-h-screen bg-surface">
      {/* En pantallas chicas la barra se reduce a un riel de íconos: 224px
          fijos dejaban sin aire al contenido. */}
      <aside className="sticky top-0 flex h-screen w-14 shrink-0 flex-col border-r border-black/[0.07] px-2 py-4 md:w-56 md:px-3">
        <div className="mb-4 flex items-center gap-2.5 px-1 md:px-2">
          {/* El agente con su look, no un logo genérico: este portal es SU casa. */}
          <AgentitoAvatar look={lookAgente} className="h-9 w-9 shrink-0" />
          <div className="hidden min-w-0 md:block">
            <p className="truncate text-sm font-bold tracking-tight text-ink">{nombre || manifest.agent}</p>
            <p className="flex items-center gap-1 text-[11px] text-ink-soft">
              <span className={`h-1.5 w-1.5 rounded-full ${online ? "bg-c-green-ink" : "bg-c-coral-ink"}`} />
              {online ? "conectado" : "sin conexión"}
            </p>
          </div>
        </div>
        <nav className="flex flex-col gap-0.5">
          {enabled.map((m) => {
            const active = pathname.startsWith(m.path);
            const Icon = m.icon;
            return (
              <Link
                key={m.key}
                href={m.path}
                // relative: el badge se posiciona sobre el ícono en el riel.
                title={m.label}
                className={`relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition max-md:justify-center max-md:px-0 ${
                  active
                    ? "bg-c-violet/60 font-semibold text-primary"
                    : "text-ink-soft hover:bg-black/[0.04] hover:text-ink"
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="hidden flex-1 md:inline">{m.label}</span>
                {m.key === "approvals" && pending > 0 && (
                  <span className={`rounded-full text-[10px] font-bold max-md:absolute max-md:right-1 max-md:top-1 max-md:h-4 max-md:w-4 max-md:leading-4 md:px-1.5 md:py-0.5 ${
                    active ? "bg-white/25 text-white" : "bg-c-coral text-c-coral-ink"
                  }`}>
                    {pending}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto px-1">
          <button
            onClick={() => { clearConfig(); setState("login"); }}
            title="Salir"
            className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-[13px] text-ink-soft transition hover:text-ink max-md:justify-center"
          >
            <LogOut className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden md:inline">Salir</span>
          </button>
        </div>
      </aside>
      <main className="min-w-0 flex-1">
        {showIntro && current && Intro ? (
          <Intro onOk={() => dismiss(current.key)} />
        ) : (
          children
        )}
      </main>
    </div>
  );
}
