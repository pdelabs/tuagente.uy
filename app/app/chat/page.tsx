"use client";

// Módulo Chat — layout estilo Open WebUI: sidebar de conversaciones agrupadas
// por fecha, hilo centrado (el agente escribe "sobre la página", el usuario en
// burbuja), compositor flotante con enviar/detener.
// Conversación nueva → /v1/chat/completions (chatStream); retomar sesión →
// SSE nativo de Hermes (sessionChatStream). Shapes verificados contra :8642.

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Check, Copy, MessageSquare, Plus, Square } from "lucide-react";
import {
  loadConfig,
  chatStream,
  sessionChatStream,
  getSessions,
  getSessionMessages,
  type PortalConfig,
  type ChatMessage,
} from "../lib/agent";
import { Btn, EmptyState, ErrorState, IconBtn, Spinner } from "../lib/ui";
import Markdown from "./Markdown";

// GET /api/sessions → {object:"list", data:[...]}
type SessionSummary = {
  id: string;
  source: string; // "api_server" | "telegram" | "cron" | "kanban" | ...
  title: string | null;
  preview: string | null;
  message_count: number;
  started_at: number; // epoch en segundos
  last_active: number;
};

type StoredMessage = {
  id: number;
  role: string;
  content: string | null;
  tool_calls: unknown[] | null;
};

type Msg = { role: "user" | "assistant"; content: string };

const HUMAN_SOURCES = new Set(["api_server", "telegram", "whatsapp", "discord"]);

// Sesiones que un cliente reconoce como "conversaciones": las humanas, sin
// las internas de sistema (crons, workers del kanban, generación de títulos).
function isHumanSession(s: SessionSummary): boolean {
  if (!HUMAN_SOURCES.has(s.source)) return false;
  const t = s.title ?? s.preview ?? "";
  return !t.trimStart().startsWith("### Task");
}

function sessionTitle(s: SessionSummary): string {
  return s.title?.trim() || s.preview?.trim() || "Conversación";
}

function dayGroup(epochSeconds: number): string {
  const d = new Date(epochSeconds * 1000);
  const today = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(today) - startOf(d)) / 86400000);
  if (diffDays <= 0) return "Hoy";
  if (diffDays === 1) return "Ayer";
  if (diffDays < 7) return "Últimos 7 días";
  return "Anteriores";
}

function CopyBtn({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <IconBtn
      label={done ? "Copiado" : "Copiar"}
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        });
      }}
    >
      {done ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </IconBtn>
  );
}

export default function ChatPage() {
  const [cfg, setCfg] = useState<PortalConfig | null>(null);

  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [sessionsErr, setSessionsErr] = useState<string | null>(null);
  const [showSystem, setShowSystem] = useState(false);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [loadingThread, setLoadingThread] = useState(false);
  const [threadErr, setThreadErr] = useState<string | null>(null);

  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [toolNote, setToolNote] = useState<string | null>(null);
  const [sendErr, setSendErr] = useState<string | null>(null);
  const [failedText, setFailedText] = useState<string | null>(null);

  const sendingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const openSeq = useRef(0);
  const threadRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { setCfg(loadConfig()); }, []);

  const refreshSessions = (c: PortalConfig) => {
    getSessions(c)
      .then((r: { data?: SessionSummary[] }) => {
        setSessionsErr(null);
        setSessions([...(r.data ?? [])].sort((a, b) => b.last_active - a.last_active));
      })
      .catch((e) => setSessionsErr(e instanceof Error ? e.message : "error de red"));
  };
  useEffect(() => { if (cfg) refreshSessions(cfg); }, [cfg]);

  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs, sending, toolNote, loadingThread]);

  useEffect(() => {
    const el = taRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    }
  }, [input]);

  const visibleSessions = useMemo(() => {
    if (!sessions) return null;
    return showSystem ? sessions : sessions.filter(isHumanSession);
  }, [sessions, showSystem]);

  const systemCount = useMemo(
    () => (sessions ? sessions.length - sessions.filter(isHumanSession).length : 0),
    [sessions],
  );

  const grouped = useMemo(() => {
    if (!visibleSessions) return [];
    const order = ["Hoy", "Ayer", "Últimos 7 días", "Anteriores"];
    const map = new Map<string, SessionSummary[]>();
    for (const s of visibleSessions) {
      const g = dayGroup(s.last_active);
      map.set(g, [...(map.get(g) ?? []), s]);
    }
    return order.filter((g) => map.has(g)).map((g) => ({ group: g, items: map.get(g)! }));
  }, [visibleSessions]);

  const newConversation = () => {
    if (sending) return;
    openSeq.current++;
    setActiveId(null);
    setMsgs([]);
    setLoadingThread(false);
    setThreadErr(null);
    setSendErr(null);
    setFailedText(null);
  };

  const openSession = (c: PortalConfig, id: string) => {
    if (sending) return;
    const seq = ++openSeq.current;
    setActiveId(id);
    setMsgs([]);
    setThreadErr(null);
    setSendErr(null);
    setFailedText(null);
    setLoadingThread(true);
    getSessionMessages(c, id)
      .then((r: { data?: StoredMessage[] }) => {
        if (openSeq.current !== seq) return;
        setMsgs(
          (r.data ?? [])
            .filter((m) => (m.role === "user" || m.role === "assistant") && m.content?.trim())
            .map((m) => ({ role: m.role as "user" | "assistant", content: m.content as string })),
        );
      })
      .catch((e) => {
        if (openSeq.current !== seq) return;
        setThreadErr(e instanceof Error ? e.message : "error de red");
      })
      .finally(() => { if (openSeq.current === seq) setLoadingThread(false); });
  };

  const doSend = async (raw: string) => {
    const text = raw.trim();
    if (!cfg || !text || sendingRef.current) return;
    sendingRef.current = true;

    const prior = msgs;
    const history: ChatMessage[] = [
      ...prior.map((m): ChatMessage => ({ role: m.role, content: m.content })),
      { role: "user", content: text },
    ];

    setInput("");
    setSendErr(null);
    setFailedText(null);
    setToolNote(null);
    setMsgs([...prior, { role: "user", content: text }, { role: "assistant", content: "" }]);
    setSending(true);

    const ac = new AbortController();
    abortRef.current = ac;
    const paint = (content: string) =>
      setMsgs((ms) => [...ms.slice(0, -1), { role: "assistant", content }]);

    try {
      if (activeId) {
        // Un run puede traer varios mensajes del asistente (rondas de tools).
        const segments: string[] = [""];
        const render = () => paint(segments.filter((s) => s.trim()).join("\n\n"));
        await sessionChatStream(cfg, activeId, text, {
          onMessageStart: () => {
            if (segments[segments.length - 1].trim()) segments.push("");
          },
          onDelta: (d) => { segments[segments.length - 1] += d; render(); },
          onMessageComplete: (content) => { segments[segments.length - 1] = content; render(); },
          onToolProgress: (tool) =>
            setToolNote(tool === "_thinking" ? "Pensando" : `Usando ${tool}`),
          onRunComplete: (messages) => {
            const finals = messages
              .filter((m) => m.role === "assistant" && m.content?.trim())
              .map((m) => m.content as string);
            if (finals.length) paint(finals.join("\n\n"));
          },
        }, ac.signal);
      } else {
        await chatStream(cfg, history, paint, ac.signal);
      }
      setMsgs((ms) => (ms[ms.length - 1]?.content.trim() ? ms : ms.slice(0, -1)));
      refreshSessions(cfg);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        // Detenido por el usuario: queda lo que llegó hasta acá.
        setMsgs((ms) => (ms[ms.length - 1]?.content.trim() ? ms : ms.slice(0, -1)));
        refreshSessions(cfg);
      } else {
        setMsgs(prior);
        setInput(text);
        setFailedText(text);
        setSendErr(e instanceof Error ? e.message : "error de red");
      }
    } finally {
      abortRef.current = null;
      sendingRef.current = false;
      setSending(false);
      setToolNote(null);
    }
  };

  if (!cfg) return <Spinner />;

  const lastMsg = msgs[msgs.length - 1];
  const showThinking = sending && (toolNote !== null || !lastMsg || !lastMsg.content.trim());
  const activeSession = activeId ? sessions?.find((s) => s.id === activeId) : undefined;
  const canSend = !sending && input.trim().length > 0;

  return (
    <div className="flex h-screen">
      {/* ── Sidebar de conversaciones ── */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-black/[0.07] md:flex">
        <div className="p-3">
          <button
            onClick={newConversation}
            disabled={sending}
            className="flex w-full items-center gap-2 rounded-lg border border-black/10 bg-white px-3 py-2 text-sm font-semibold text-ink transition hover:bg-black/[0.03] disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            Nueva conversación
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-3 pb-2">
          {sessions === null && !sessionsErr && <Spinner />}
          {sessionsErr && <ErrorState message={sessionsErr} onRetry={() => refreshSessions(cfg)} />}
          {visibleSessions !== null && !sessionsErr && visibleSessions.length === 0 && (
            <p className="px-2 py-6 text-center text-[13px] text-ink-soft">
              Todavía no hay conversaciones.
            </p>
          )}
          {grouped.map(({ group, items }) => (
            <div key={group} className="mb-2">
              <p className="px-2 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-ink-soft/70">
                {group}
              </p>
              {items.map((s) => {
                const active = s.id === activeId;
                return (
                  <button
                    key={s.id}
                    onClick={() => openSession(cfg, s.id)}
                    disabled={sending}
                    className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition disabled:opacity-60 ${
                      active ? "bg-black/[0.06]" : "hover:bg-black/[0.04]"
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">
                      {sessionTitle(s)}
                    </span>
                    {!HUMAN_SOURCES.has(s.source) && (
                      <span className="shrink-0 text-[10px] text-ink-soft/70">{s.source}</span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        {systemCount > 0 && (
          <div className="border-t border-black/[0.07] p-2">
            <button
              onClick={() => setShowSystem((v) => !v)}
              className="w-full rounded-lg px-2 py-1.5 text-left text-[12px] text-ink-soft transition hover:bg-black/[0.04] hover:text-ink"
            >
              {showSystem ? "Ocultar sesiones de sistema" : `Ver sesiones de sistema (${systemCount})`}
            </button>
          </div>
        )}
      </aside>

      {/* ── Hilo ── */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center border-b border-black/[0.07] px-4">
          <p className="truncate text-sm font-semibold text-ink">
            {activeSession ? sessionTitle(activeSession) : "Nueva conversación"}
          </p>
        </header>

        <div ref={threadRef} className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-6">
            {loadingThread ? (
              <Spinner />
            ) : threadErr ? (
              <ErrorState message={threadErr} onRetry={() => activeId && openSession(cfg, activeId)} />
            ) : msgs.length === 0 && !sending ? (
              <div className="pt-24">
                <EmptyState
                  icon={MessageSquare}
                  title="¿En qué te puede ayudar tu agente?"
                  hint="Preguntale lo que necesites o pedile una tarea. También podés retomar una conversación anterior desde la izquierda."
                />
              </div>
            ) : (
              <div className="flex flex-col gap-5">
                {msgs.map((m, i) =>
                  m.role === "user" ? (
                    <div key={i} className="flex justify-end">
                      <div className="max-w-[80%] whitespace-pre-wrap break-words rounded-2xl bg-black/[0.05] px-4 py-2.5 text-[15px] text-ink">
                        {m.content}
                      </div>
                    </div>
                  ) : (
                    <div key={i} className="group">
                      <Markdown>{m.content}</Markdown>
                      {m.content.trim() && !(sending && i === msgs.length - 1) && (
                        <div className="mt-1 opacity-0 transition group-hover:opacity-100">
                          <CopyBtn text={m.content} />
                        </div>
                      )}
                    </div>
                  ),
                )}
                {showThinking && (
                  <div className="flex items-center gap-2 text-[13px] text-ink-soft">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
                    {toolNote ?? "Pensando"}…
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Compositor ── */}
        <div className="shrink-0 pb-5 pt-2">
          <div className="mx-auto w-full max-w-3xl px-4 md:px-6">
            {sendErr && (
              <div className="mb-2 flex items-center justify-between gap-3 rounded-lg border border-c-coral bg-c-coral/30 px-3 py-2 text-[13px] text-c-coral-ink">
                <span className="min-w-0 truncate font-medium">
                  No pude enviar tu mensaje. {sendErr}
                </span>
                <Btn size="sm" kind="secondary" onClick={() => failedText && doSend(failedText)} disabled={sending}>
                  Reintentar
                </Btn>
              </div>
            )}
            <div className="flex items-end gap-2 rounded-2xl border border-black/10 bg-white p-2 pl-4 transition focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15">
              <textarea
                ref={taRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    doSend(input);
                  }
                }}
                rows={1}
                placeholder="Escribile a tu agente…"
                disabled={sending}
                className="max-h-52 flex-1 resize-none bg-transparent py-1.5 text-[15px] text-ink outline-none placeholder:text-ink-soft/60 disabled:opacity-60"
              />
              {sending ? (
                <button
                  aria-label="Detener"
                  title="Detener"
                  onClick={() => abortRef.current?.abort()}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-ink text-white transition hover:bg-ink/80"
                >
                  <Square className="h-3.5 w-3.5 fill-current" />
                </button>
              ) : (
                <button
                  aria-label="Enviar"
                  title="Enviar"
                  onClick={() => doSend(input)}
                  disabled={!canSend}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-white transition hover:bg-primary-dark disabled:bg-black/10 disabled:text-ink-soft/50"
                >
                  <ArrowUp className="h-4 w-4" />
                </button>
              )}
            </div>
            <p className="mt-1.5 text-center text-[11px] text-ink-soft/60">
              Enter envía · Shift+Enter hace un salto de línea
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
