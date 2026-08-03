"use client";

// Módulo Chat — hablar con el agente: conversación nueva (streaming por
// /v1/chat/completions vía chatStream de la lib) o retomar una sesión vieja
// (GET /api/sessions/{id}/messages + POST /api/sessions/{id}/chat/stream,
// SSE nativo de Hermes — ver stream.ts). Shapes verificados con curl :8642.

import { useEffect, useRef, useState } from "react";
import {
  loadConfig,
  chatStream,
  getSessions,
  getSessionMessages,
  type PortalConfig,
  type ChatMessage,
} from "../lib/agent";
import { Btn, Card, EmptyState, ErrorState, Spinner } from "../lib/ui";
import Markdown from "./Markdown";
import { sessionChatStream } from "./stream";

// ── Shapes VERIFICADOS contra :8642 (2026-08-03) ──
// GET /api/sessions → {object:"list", data:[...], limit, offset, has_more}
type SessionSummary = {
  id: string;
  source: string; // "api_server" | "telegram" | ...
  title: string | null;
  preview: string | null;
  message_count: number;
  started_at: number; // epoch en segundos (float)
  last_active: number; // epoch en segundos (float)
};

// GET /api/sessions/{id}/messages → {object:"list", session_id, data:[...]}
type StoredMessage = {
  id: number;
  role: string; // "user" | "assistant" | "tool" | ...
  content: string | null;
  tool_calls: unknown[] | null;
  timestamp: number;
};

type Msg = { role: "user" | "assistant"; content: string };

function sessionTitle(s: SessionSummary): string {
  return s.title?.trim() || s.preview?.trim() || "Conversación";
}

function fmtWhen(epochSeconds: number): string {
  const d = new Date(epochSeconds * 1000);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString("es-UY", {
    day: "numeric",
    month: "short",
    year: d.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

export default function ChatPage() {
  const [cfg, setCfg] = useState<PortalConfig | null>(null);

  // Sidebar de sesiones
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [sessionsErr, setSessionsErr] = useState<string | null>(null);

  // Hilo activo (null = conversación nueva, todavía sin sesión del server)
  const [activeId, setActiveId] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [loadingThread, setLoadingThread] = useState(false);
  const [threadErr, setThreadErr] = useState<string | null>(null);

  // Envío
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [toolNote, setToolNote] = useState<string | null>(null);
  const [sendErr, setSendErr] = useState<string | null>(null);
  const [failedText, setFailedText] = useState<string | null>(null);

  const sendingRef = useRef(false); // candado sincrónico anti doble-envío
  const openSeq = useRef(0); // invalida cargas de mensajes viejas
  const threadRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setCfg(loadConfig());
  }, []);

  const refreshSessions = (c: PortalConfig) => {
    getSessions(c)
      .then((r: { data?: SessionSummary[] }) => {
        setSessionsErr(null);
        setSessions([...(r.data ?? [])].sort((a, b) => b.last_active - a.last_active));
      })
      .catch((e) => setSessionsErr(e instanceof Error ? e.message : "error de red"));
  };

  useEffect(() => {
    if (cfg) refreshSessions(cfg);
  }, [cfg]);

  // Auto-scroll al fondo del hilo
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs, sending, toolNote, loadingThread]);

  // Autosize del textarea
  useEffect(() => {
    const el = taRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
    }
  }, [input]);

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
            .filter(
              (m) => (m.role === "user" || m.role === "assistant") && m.content?.trim(),
            )
            .map((m) => ({
              role: m.role as "user" | "assistant",
              content: m.content as string,
            })),
        );
      })
      .catch((e) => {
        if (openSeq.current !== seq) return;
        setThreadErr(e instanceof Error ? e.message : "error de red");
      })
      .finally(() => {
        if (openSeq.current === seq) setLoadingThread(false);
      });
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

    // Reemplaza la burbuja del asistente (la última) con el texto acumulado.
    const paint = (content: string) =>
      setMsgs((ms) => [...ms.slice(0, -1), { role: "assistant", content }]);

    try {
      if (activeId) {
        // Sesión existente → SSE nativo de Hermes. Un run puede tener varios
        // mensajes del asistente (rondas de tools): los juntamos en una burbuja.
        const segments: string[] = [""];
        const render = () => paint(segments.filter((s) => s.trim()).join("\n\n"));
        await sessionChatStream(cfg, activeId, text, {
          onMessageStart: () => {
            if (segments[segments.length - 1].trim()) segments.push("");
          },
          onDelta: (d) => {
            segments[segments.length - 1] += d;
            render();
          },
          onMessageComplete: (content) => {
            segments[segments.length - 1] = content;
            render();
          },
          onToolProgress: (tool) =>
            setToolNote(tool === "_thinking" ? "Pensando…" : `Usando ${tool}…`),
          onRunComplete: (messages) => {
            const finals = messages
              .filter((m) => m.role === "assistant" && m.content?.trim())
              .map((m) => m.content as string);
            if (finals.length) paint(finals.join("\n\n"));
          },
        });
      } else {
        // Conversación nueva → /v1/chat/completions con historial completo
        // (flujo del PoC). onDelta de la lib ya entrega el texto acumulado.
        await chatStream(cfg, history, paint);
      }
      // Si el agente no devolvió texto, sacamos la burbuja vacía.
      setMsgs((ms) => (ms[ms.length - 1]?.content.trim() ? ms : ms.slice(0, -1)));
      refreshSessions(cfg);
    } catch (e) {
      setMsgs(prior); // deshacer: queda claro que no se envió
      setInput(text); // devolvemos el texto al compositor
      setFailedText(text);
      setSendErr(e instanceof Error ? e.message : "error de red");
    } finally {
      sendingRef.current = false;
      setSending(false);
      setToolNote(null);
    }
  };

  if (!cfg) {
    return <Spinner />;
  }

  const lastMsg = msgs[msgs.length - 1];
  const showThinking =
    sending && (toolNote !== null || !lastMsg || !lastMsg.content.trim());
  const activeSession = activeId ? sessions?.find((s) => s.id === activeId) : undefined;

  return (
    <div className="flex h-[calc(100vh-3rem)] gap-6">
      {/* ── Sidebar: sesiones recientes ── */}
      <Card className="hidden w-72 shrink-0 flex-col overflow-hidden md:flex">
        <p className="font-extrabold tracking-tight text-ink">Conversaciones</p>
        <div className="mt-3">
          <Btn kind="ghost" onClick={newConversation} disabled={sending}>
            + Nueva conversación
          </Btn>
        </div>
        <div className="-mr-2 mt-3 flex-1 space-y-1 overflow-y-auto pr-2">
          {sessions === null && !sessionsErr && <Spinner />}
          {sessionsErr && (
            <ErrorState message={sessionsErr} onRetry={() => refreshSessions(cfg)} />
          )}
          {sessions !== null && !sessionsErr && sessions.length === 0 && (
            <EmptyState
              emoji="💬"
              title="Todavía no hay conversaciones"
              hint="Cuando hables con tu agente, van a aparecer acá."
            />
          )}
          {sessions?.map((s) => {
            const active = s.id === activeId;
            return (
              <button
                key={s.id}
                onClick={() => openSession(cfg, s.id)}
                disabled={sending}
                className={`w-full rounded-2xl px-3 py-2.5 text-left transition disabled:opacity-60 ${
                  active ? "bg-primary text-white" : "hover:bg-c-violet"
                }`}
              >
                <p className={`truncate text-sm font-bold ${active ? "" : "text-ink"}`}>
                  {sessionTitle(s)}
                </p>
                <p
                  className={`mt-0.5 truncate text-xs ${
                    active ? "text-white/70" : "text-ink-soft"
                  }`}
                >
                  {fmtWhen(s.last_active)} · {s.message_count} mensajes
                </p>
              </button>
            );
          })}
        </div>
      </Card>

      {/* ── Hilo + compositor ── */}
      <Card className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {activeSession && (
          <p className="mb-3 truncate text-xs font-bold uppercase tracking-wide text-ink-soft">
            {sessionTitle(activeSession)}
          </p>
        )}

        <div ref={threadRef} className="flex flex-1 flex-col gap-4 overflow-y-auto pr-1">
          {loadingThread ? (
            <Spinner />
          ) : threadErr ? (
            <ErrorState
              message={threadErr}
              onRetry={() => activeId && openSession(cfg, activeId)}
            />
          ) : msgs.length === 0 && !sending ? (
            <EmptyState
              emoji="💬"
              title="Arrancá una conversación"
              hint="Preguntale lo que necesites a tu agente, o pedile una tarea."
            />
          ) : (
            msgs.map((m, i) =>
              m.role === "user" ? (
                <div
                  key={i}
                  className="max-w-[85%] self-end whitespace-pre-wrap break-words rounded-card rounded-br-lg bg-primary px-4 py-3 text-[15px] text-white"
                >
                  {m.content}
                </div>
              ) : (
                <div key={i} className="max-w-[95%] self-start">
                  <Markdown>{m.content}</Markdown>
                </div>
              ),
            )
          )}
          {showThinking && (
            <div className="flex items-center gap-2 self-start rounded-pill bg-c-violet px-4 py-2 text-sm font-semibold text-c-violet-ink">
              <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
              {toolNote ?? "Pensando…"}
            </div>
          )}
        </div>

        {sendErr && (
          <div className="mt-3 flex items-center justify-between gap-3 rounded-card bg-c-coral px-4 py-3 text-sm text-c-coral-ink">
            <span className="min-w-0 truncate font-semibold">
              No pude enviar tu mensaje. {sendErr}
            </span>
            <Btn onClick={() => failedText && doSend(failedText)} disabled={sending}>
              Reintentar
            </Btn>
          </div>
        )}

        <div className="mt-4 flex items-end gap-3">
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
            className="max-h-40 flex-1 resize-none rounded-card border border-c-violet bg-surface px-5 py-3 text-sm text-ink outline-none transition focus:border-primary disabled:opacity-60"
          />
          <Btn onClick={() => doSend(input)} disabled={sending || !input.trim()}>
            {sending ? "Enviando…" : "Enviar"}
          </Btn>
        </div>
      </Card>
    </div>
  );
}
