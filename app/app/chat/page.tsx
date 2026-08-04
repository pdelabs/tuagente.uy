"use client";

// Módulo Chat — hilo centrado estilo Open WebUI con streaming, markdown rico,
// bloque de herramientas colapsable, regenerar/editar, exportar y scroll vivo.
// Conversación nueva → /v1/chat/completions; retomar sesión → SSE nativo de
// Hermes (assistant.delta / tool.progress / run.completed).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown, ArrowUp, Brain, Check, ChevronRight, Copy, Download, Loader2, Menu,
  MessageSquare, Paperclip, Pencil, RefreshCw, Square, Wrench,
} from "lucide-react";
import {
  loadConfig, chatStream, sessionChatStream, getSessions, getSessionMessages,
  uploadFile, type PortalConfig, type ChatMessage,
} from "../lib/agent";
import { Btn, EmptyState, ErrorState, IconBtn, Spinner } from "../lib/ui";
import { EntityProvider } from "../lib/EntityViewer";
import Markdown from "../lib/Markdown";
import Sessions, { sessionTitle, type SessionSummary } from "./Sessions";
import {
  MentionList, mentionAt, useMentionItems,
  type MentionItem, type MentionKind,
} from "./Mentions";

type StoredMessage = {
  id: number;
  role: string;
  content: string | null;
  tool_calls: unknown[] | null;
};

type Msg = {
  role: "user" | "assistant";
  content: string;
  tools?: string[]; // herramientas usadas en el run (solo en vivo)
};

const THINKING = "_thinking";

function toolLabel(tool: string): string {
  if (tool === THINKING) return "Pensando";
  return tool.replace(/_/g, " ");
}

/** Bloque colapsable con lo que el agente hizo antes de responder. */
function ToolTrace({ tools, live }: { tools: string[]; live?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!tools.length) return null;
  const last = tools[tools.length - 1];
  const used = tools.filter((t) => t !== THINKING);
  const summary =
    used.length === 0
      ? "Pensó un momento"
      : used.length === 1
        ? `Usó ${toolLabel(used[0])}`
        : `Trabajó con ${used.length} herramientas`;
  return (
    <div className="mb-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-[12px] text-ink-soft transition hover:bg-black/[0.04] hover:text-ink"
      >
        <ChevronRight className={`h-3 w-3 transition-transform ${open ? "rotate-90" : ""}`} />
        {live ? (
          <>
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
            {last === THINKING ? "Pensando" : `Usando ${toolLabel(last)}`}…
          </>
        ) : (
          <>
            {used.length > 0 ? <Wrench className="h-3 w-3" /> : <Brain className="h-3 w-3" />}
            {summary}
          </>
        )}
      </button>
      {open && (
        <ol className="ml-4 mt-1 flex flex-col gap-1 border-l border-black/[0.08] pl-3">
          {tools.map((t, i) => (
            <li key={`${t}-${i}`} className="text-[12px] text-ink-soft">
              {toolLabel(t)}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
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
  const [drawer, setDrawer] = useState(false);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [loadingThread, setLoadingThread] = useState(false);
  const [threadErr, setThreadErr] = useState<string | null>(null);

  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [liveTools, setLiveTools] = useState<string[]>([]);
  const [sendErr, setSendErr] = useState<string | null>(null);
  const [failedText, setFailedText] = useState<string | null>(null);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const [atBottom, setAtBottom] = useState(true);
  // Menciones: `#` referencia tickets, `@` archivos del workspace.
  const [mention, setMention] = useState<{ kind: MentionKind; term: string; start: number } | null>(null);
  const [mentionIdx, setMentionIdx] = useState(0);

  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const sendingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const openSeq = useRef(0);
  const threadRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setCfg(loadConfig()); }, []);

  const refreshSessions = useCallback((c: PortalConfig) => {
    getSessions(c)
      .then((r: { data?: SessionSummary[] }) => {
        setSessionsErr(null);
        setSessions([...(r.data ?? [])].sort((a, b) => b.last_active - a.last_active));
      })
      .catch((e) => setSessionsErr(e instanceof Error ? e.message : "error de red"));
  }, []);
  useEffect(() => { if (cfg) refreshSessions(cfg); }, [cfg, refreshSessions]);

  // Scroll: seguimos el stream solo si el usuario está mirando el final.
  const onScroll = () => {
    const el = threadRef.current;
    if (!el) return;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 90);
  };
  const scrollToBottom = (smooth = false) => {
    const el = threadRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  };
  useEffect(() => {
    if (atBottom) scrollToBottom();
  }, [msgs, liveTools, loadingThread, atBottom]);

  useEffect(() => {
    const el = taRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    }
  }, [input]);

  const activeSession = useMemo(
    () => (activeId ? sessions?.find((s) => s.id === activeId) : undefined),
    [activeId, sessions],
  );

  const mentionItems = useMentionItems(cfg, mention?.kind ?? null, mention?.term ?? "");

  // Reemplaza el token `#…`/`@…` por la referencia elegida.
  const pickMention = (item: MentionItem) => {
    if (!mention) return;
    const el = taRef.current;
    const caret = el?.selectionStart ?? input.length;
    const next = `${input.slice(0, mention.start)}${item.insert} ${input.slice(caret)}`;
    setInput(next);
    setMention(null);
    setMentionIdx(0);
    requestAnimationFrame(() => {
      const pos = mention.start + item.insert.length + 1;
      el?.focus();
      el?.setSelectionRange(pos, pos);
    });
  };

  // Adjuntar: el archivo va al buzón del agente y en el mensaje queda su ruta,
  // que el chat muestra como chip y el agente sabe abrir.
  const attach = async (file: File) => {
    if (!cfg || uploading) return;
    setUploading(true);
    setSendErr(null);
    try {
      const r = await uploadFile(cfg, file);
      setInput((prev) => (prev ? `${prev.trimEnd()} ${r.path} ` : `${r.path} `));
      taRef.current?.focus();
    } catch (e) {
      setSendErr(e instanceof Error ? e.message : "no pude subir el archivo");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const syncMention = (text: string, caret: number) => {
    const found = mentionAt(text, caret);
    setMention(found);
    if (!found) setMentionIdx(0);
  };

  const newConversation = useCallback(() => {
    if (sendingRef.current) return;
    openSeq.current++;
    setActiveId(null);
    setMsgs([]);
    setLoadingThread(false);
    setThreadErr(null);
    setSendErr(null);
    setFailedText(null);
    setEditingIdx(null);
    setAtBottom(true);
  }, []);

  const openSession = useCallback((c: PortalConfig, id: string) => {
    if (sendingRef.current) return;
    const seq = ++openSeq.current;
    setActiveId(id);
    setMsgs([]);
    setThreadErr(null);
    setSendErr(null);
    setFailedText(null);
    setEditingIdx(null);
    setLoadingThread(true);
    setAtBottom(true);
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
  }, []);

  // Envía `text` partiendo de `base` como historia previa.
  const run = async (text: string, base: Msg[]) => {
    if (!cfg || !text.trim() || sendingRef.current) return;
    sendingRef.current = true;

    const history: ChatMessage[] = [
      ...base.map((m): ChatMessage => ({ role: m.role, content: m.content })),
      { role: "user", content: text },
    ];

    setInput("");
    setSendErr(null);
    setFailedText(null);
    setLiveTools([]);
    setEditingIdx(null);
    setMsgs([...base, { role: "user", content: text }, { role: "assistant", content: "" }]);
    setSending(true);
    setAtBottom(true);

    const ac = new AbortController();
    abortRef.current = ac;
    const tools: string[] = [];
    const apply = (content: string) =>
      setMsgs((ms) => [
        ...ms.slice(0, -1),
        { role: "assistant", content, tools: tools.length ? [...tools] : undefined },
      ]);

    // El markdown se re-parsea entero en cada repintado (código resaltado,
    // fórmulas, diagramas): agrupamos deltas por frame en vez de por token.
    let pendingText: string | null = null;
    let frame = 0;
    const paint = (content: string) => {
      pendingText = content;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (pendingText !== null) apply(pendingText);
      });
    };
    const flush = () => {
      if (frame) { cancelAnimationFrame(frame); frame = 0; }
      if (pendingText !== null) apply(pendingText);
    };

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
          onMessageComplete: (c) => { segments[segments.length - 1] = c; render(); },
          onToolProgress: (tool) => {
            if (tools[tools.length - 1] !== tool) tools.push(tool);
            setLiveTools([...tools]);
          },
          // OJO: run.completed trae TODA la historia de la sesión, no los
          // mensajes de este turno. Solo lo usamos de red de seguridad si no
          // llegó nada por los deltas, y ahí vale el último del asistente.
          onRunComplete: (messages) => {
            if (segments.some((s) => s.trim())) return;
            const last = [...messages]
              .reverse()
              .find((m) => m.role === "assistant" && m.content?.trim());
            if (last?.content) paint(last.content);
          },
        }, ac.signal);
      } else {
        await chatStream(cfg, history, paint, ac.signal);
      }
      flush();
      setMsgs((ms) => (ms[ms.length - 1]?.content.trim() ? ms : ms.slice(0, -1)));
      refreshSessions(cfg);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        flush();
        setMsgs((ms) => (ms[ms.length - 1]?.content.trim() ? ms : ms.slice(0, -1)));
        refreshSessions(cfg);
      } else {
        setMsgs(base);
        setInput(text);
        setFailedText(text);
        setSendErr(e instanceof Error ? e.message : "error de red");
      }
    } finally {
      abortRef.current = null;
      sendingRef.current = false;
      setSending(false);
      setLiveTools([]);
    }
  };

  const send = (raw: string) => run(raw.trim(), msgs);

  // Regenerar: repite el último pedido del usuario. En conversación nueva
  // reemplaza la respuesta; en una sesión guardada del agente no se puede
  // reescribir la historia, así que queda como un turno nuevo.
  const regenerate = () => {
    const lastUser = [...msgs].reverse().find((m) => m.role === "user");
    if (!lastUser || sending) return;
    if (activeId) {
      run(lastUser.content, msgs);
    } else {
      const idx = msgs.lastIndexOf(lastUser);
      run(lastUser.content, msgs.slice(0, idx));
    }
  };

  const submitEdit = (idx: number) => {
    const text = editText.trim();
    if (!text || sending) return;
    run(text, msgs.slice(0, idx));
  };

  const exportMd = () => {
    const title = activeSession ? sessionTitle(activeSession) : "Conversación";
    const body = msgs
      .map((m) => `## ${m.role === "user" ? "Vos" : "Tu agente"}\n\n${m.content}`)
      .join("\n\n---\n\n");
    const blob = new Blob([`# ${title}\n\n${body}\n`], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.replace(/[^\w\sáéíóúñü-]/gi, "").trim().slice(0, 60) || "conversacion"}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Atajos: ⌘K busca, ⌘⇧O nueva conversación.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setDrawer(true);
        setTimeout(() => searchRef.current?.focus(), 30);
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === "o") {
        e.preventDefault();
        newConversation();
      }
      if (e.key === "Escape") setDrawer(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [newConversation]);

  if (!cfg) return <Spinner />;

  const lastIdx = msgs.length - 1;
  const showThinking = sending && !msgs[lastIdx]?.content.trim();
  const canSend = !sending && input.trim().length > 0;

  const sidebar = (
    <Sessions
      cfg={cfg}
      sessions={sessions}
      sessionsErr={sessionsErr}
      activeId={activeId}
      sending={sending}
      onOpen={(id) => openSession(cfg, id)}
      onNew={newConversation}
      onRefresh={() => refreshSessions(cfg)}
      onDeletedActive={newConversation}
      searchRef={searchRef}
      onNavigate={() => setDrawer(false)}
    />
  );

  return (
    <EntityProvider cfg={cfg}>
    <div className="flex h-screen">
      {/* ── Sidebar (fija en desktop, drawer en mobile) ── */}
      <aside className="hidden w-64 shrink-0 border-r border-black/[0.07] md:block">
        {sidebar}
      </aside>
      {drawer && (
        <div className="fixed inset-0 z-40 flex md:hidden">
          <div className="w-72 max-w-[85vw] bg-surface" onClick={(e) => e.stopPropagation()}>
            {sidebar}
          </div>
          <div className="flex-1 bg-ink/25" onClick={() => setDrawer(false)} />
        </div>
      )}

      {/* ── Hilo ── */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-black/[0.07] px-3 md:px-4">
          <button
            aria-label="Conversaciones"
            onClick={() => setDrawer(true)}
            className="rounded-lg p-1.5 text-ink-soft transition hover:bg-black/[0.05] hover:text-ink md:hidden"
          >
            <Menu className="h-4 w-4" />
          </button>
          <p className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
            {activeSession ? sessionTitle(activeSession) : "Nueva conversación"}
          </p>
          {msgs.length > 0 && (
            <IconBtn label="Exportar a Markdown" onClick={exportMd}>
              <Download className="h-3.5 w-3.5" />
            </IconBtn>
          )}
        </header>

        <div ref={threadRef} onScroll={onScroll} className="relative min-h-0 flex-1 overflow-y-auto">
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
                  hint="Preguntale lo que necesites o encargale una tarea. Las conversaciones anteriores están a la izquierda."
                />
              </div>
            ) : (
              <div className="flex flex-col gap-5">
                {msgs.map((m, i) =>
                  m.role === "user" ? (
                    <div key={i} className="group flex flex-col items-end gap-1">
                      {editingIdx === i ? (
                        <div className="w-full rounded-2xl border border-black/10 bg-white p-3">
                          <textarea
                            autoFocus
                            value={editText}
                            onChange={(e) => setEditText(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitEdit(i); }
                              if (e.key === "Escape") setEditingIdx(null);
                            }}
                            rows={2}
                            className="w-full resize-none bg-transparent text-[15px] text-ink outline-none"
                          />
                          <div className="mt-2 flex justify-end gap-2">
                            <Btn kind="ghost" size="sm" onClick={() => setEditingIdx(null)}>Cancelar</Btn>
                            <Btn size="sm" onClick={() => submitEdit(i)} disabled={!editText.trim()}>
                              Enviar de nuevo
                            </Btn>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="max-w-[80%] whitespace-pre-wrap break-words rounded-2xl bg-black/[0.05] px-4 py-2.5 text-[15px] text-ink">
                            {m.content}
                          </div>
                          {!sending && (
                            <div className="flex opacity-0 transition group-hover:opacity-100">
                              <CopyBtn text={m.content} />
                              <IconBtn
                                label="Editar y volver a enviar"
                                onClick={() => { setEditText(m.content); setEditingIdx(i); }}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </IconBtn>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  ) : (
                    <div key={i} className="group">
                      {(m.tools?.length || (sending && i === lastIdx && liveTools.length > 0)) && (
                        <ToolTrace
                          tools={sending && i === lastIdx ? liveTools : m.tools ?? []}
                          live={sending && i === lastIdx}
                        />
                      )}
                      {m.content.trim() && <Markdown>{m.content}</Markdown>}
                      {m.content.trim() && !(sending && i === lastIdx) && (
                        <div className="mt-1 flex opacity-0 transition group-hover:opacity-100">
                          <CopyBtn text={m.content} />
                          {i === lastIdx && (
                            <IconBtn label="Volver a generar" onClick={regenerate}>
                              <RefreshCw className="h-3.5 w-3.5" />
                            </IconBtn>
                          )}
                        </div>
                      )}
                    </div>
                  ),
                )}
                {showThinking && liveTools.length === 0 && (
                  <div className="flex items-center gap-2 text-[13px] text-ink-soft">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
                    Pensando…
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Compositor ── */}
        <div className="relative shrink-0 pb-5 pt-2">
          {!atBottom && msgs.length > 0 && (
            <button
              aria-label="Bajar al final"
              onClick={() => scrollToBottom(true)}
              className="absolute -top-11 left-1/2 z-10 -translate-x-1/2 rounded-full border border-black/10 bg-white p-2 text-ink-soft transition hover:text-ink"
            >
              <ArrowDown className="h-4 w-4" />
            </button>
          )}
          <div className="mx-auto w-full max-w-3xl px-4 md:px-6">
            {sendErr && (
              <div className="mb-2 flex items-center justify-between gap-3 rounded-lg border border-c-coral bg-c-coral/30 px-3 py-2 text-[13px] text-c-coral-ink">
                <span className="min-w-0 truncate font-medium">No pude enviar tu mensaje. {sendErr}</span>
                <Btn size="sm" kind="secondary" onClick={() => failedText && send(failedText)} disabled={sending}>
                  Reintentar
                </Btn>
              </div>
            )}
            {mention && (
              <MentionList
                kind={mention.kind}
                items={mentionItems}
                activeIdx={mentionIdx}
                onPick={pickMention}
              />
            )}
            <div className="flex items-end gap-2 rounded-2xl border border-black/10 bg-white p-2 pl-2 transition focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15">
              <input
                ref={fileRef}
                type="file"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) attach(f);
                }}
              />
              <button
                aria-label="Adjuntar un archivo"
                title="Adjuntar un archivo"
                onClick={() => fileRef.current?.click()}
                disabled={sending || uploading}
                className="mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-ink-soft transition hover:bg-black/[0.05] hover:text-ink disabled:opacity-40"
              >
                {uploading
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <Paperclip className="h-4 w-4" />}
              </button>
              <textarea
                ref={taRef}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  syncMention(e.target.value, e.target.selectionStart ?? e.target.value.length);
                }}
                onClick={(e) => syncMention(input, e.currentTarget.selectionStart ?? 0)}
                onBlur={() => setMention(null)}
                onKeyDown={(e) => {
                  const open = mention && mentionItems && mentionItems.length > 0;
                  if (open) {
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      setMentionIdx((i) => (i + 1) % mentionItems!.length);
                      return;
                    }
                    if (e.key === "ArrowUp") {
                      e.preventDefault();
                      setMentionIdx((i) => (i - 1 + mentionItems!.length) % mentionItems!.length);
                      return;
                    }
                    if (e.key === "Enter" || e.key === "Tab") {
                      e.preventDefault();
                      pickMention(mentionItems![mentionIdx]);
                      return;
                    }
                    if (e.key === "Escape") { e.preventDefault(); setMention(null); return; }
                  }
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); }
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
                  onClick={() => send(input)}
                  disabled={!canSend}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-white transition hover:bg-primary-dark disabled:bg-black/10 disabled:text-ink-soft/50"
                >
                  <ArrowUp className="h-4 w-4" />
                </button>
              )}
            </div>
            <p className="mt-1.5 text-center text-[11px] text-ink-soft/60">
              Enter envía · Shift+Enter salto de línea · <b className="font-semibold">#</b> ticket ·{" "}
              <b className="font-semibold">@</b> archivo · ⌘K buscar
            </p>
          </div>
        </div>
      </div>
    </div>
    </EntityProvider>
  );
}
