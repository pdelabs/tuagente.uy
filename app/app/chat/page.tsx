"use client";

// Módulo Chat — hilo centrado estilo Open WebUI con streaming, markdown rico,
// bloque de herramientas colapsable, regenerar/editar, exportar y scroll vivo.
// Conversación nueva → /v1/chat/completions; retomar sesión → SSE nativo de
// Hermes (assistant.delta / tool.progress / run.completed).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown, ArrowUp, Brain, Check, ChevronRight, Copy, Download, Loader2, Menu,
  MessageSquareOff, Paperclip, Pencil, RefreshCw, Square, Wrench, X,
} from "lucide-react";
import {
  loadConfig, chatStream, sessionChatStream, getSessions, getSessionMessages,
  uploadFile, type PortalConfig, type ChatMessage,
} from "../lib/agent";
import { Btn, EmptyState, ErrorState, IconBtn, Spinner } from "../lib/ui";
import {
  CopiarLink, PARAM, PARAM_PEDIDO_CHAT, abrirEnRuta, reemplazarEnRuta, useParamRuta,
} from "../lib/rutas";
import { EntityProvider } from "../lib/EntityViewer";
import Markdown from "../lib/Markdown";
import ArtifactPreview, { artifactIdsIn } from "../lib/ArtifactPreview";
import dynamic from "next/dynamic";
import { loadAgentName } from "../lib/onboarding";
import { AgentitoAvatar, AgentitoCargando, LOOK_DEFAULT, loadAgentLook, type AgentitoLook } from "../lib/agentito";
import { roleName, useRoles } from "../lib/roles";
import type { EstadoAgentito } from "../lib/AgentitoRive";

// El personaje animado se trae solo cuando el chat se muestra; mientras, la
// cara estática. Mismo patrón que el onboarding.
const AgentitoRive = dynamic(() => import("../lib/AgentitoRive"), {
  ssr: false,
  loading: () => <AgentitoCargando />,
});
import { accionDe, resumenDeAcciones } from "../lib/palabras";
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
  /** Which member of the team answered. `assistant` messages only, and only
   *  when the client addressed someone: absent means the agent they named, and
   *  that one is never signed -- badging it would turn their agent into an
   *  employee of a team they never hired. */
  by?: string;
};

const THINKING = "_thinking";

// Lo que el agente está haciendo, en palabras del cliente. El nombre crudo de
// la herramienta NO se muestra nunca: "Usando skill view…" y "Usando kanban
// show…" fueron dos de las frases que el QA anotó como "no sé qué son esas
// palabras, y son las que me muestra mientras espero". El nombre técnico sigue
// viajando en el `title` para nosotros.

/** Qué cara pone el agentito según lo que está haciendo AHORA.
 *
 *  El gesto dice la verdad: sale del nombre de herramienta que reporta Hermes
 *  por `tool.progress`, no de una rotación al azar. Lo que no cae en ninguna
 *  familia va a "haciendo", que es el gesto genérico de estar trabajando
 *  (terminal, execute_code, process, cronjob, send_message, delegate_task…). */
function gestoDe(tool: string | undefined): EstadoAgentito {
  if (!tool || tool === THINKING) return "pensando";
  if (/^(clarify|todo|memory)$/.test(tool)) return "pensando";
  if (/^(read_file|search_files|session_search|read_terminal|skill_view|skills_list|feishu_doc_read|kanban_(show|list)|project_list)$/.test(tool)) {
    return "leyendo";
  }
  if (/^(write_file|patch|image_generate|video_generate|kanban_(create|comment|complete|block|unblock|link)|project_create)$/.test(tool)) {
    return "escribiendo";
  }
  if (/^(web_search|web_extract|x_search|browser_|vision_analyze|video_analyze)/.test(tool)) {
    return "buscando";
  }
  return "haciendo";
}

/** Bloque colapsable con lo que el agente hizo antes de responder. */
function ToolTrace({ tools, live }: { tools: string[]; live?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!tools.length) return null;
  const last = tools[tools.length - 1];
  const used = tools.filter((t) => t !== THINKING);
  const summary = resumenDeAcciones(tools);
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
            {accionDe(last).curso}…
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
            <li key={`${t}-${i}`} title={t} className="text-[12px] text-ink-soft">
              {accionDe(t).hecho}
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
  // El agente tiene nombre y cara: el chat los usa en vez de "tu agente".
  // El look va lazy (sin efecto) para no pintar el violeta default un frame.
  const [lookAgente] = useState(loadAgentLook);
  // The team, if this agent has one. Empty on every agent running today, so the
  // chat keeps drawing exactly one face: the one the client named.
  const roles = useRoles();
  /** The face for a message: the role that answered, or the client's own agent. */
  const lookDe = (by?: string): AgentitoLook =>
    by && roles[by]?.look
      ? ({ ...LOOK_DEFAULT, ...roles[by].look } as AgentitoLook)
      : lookAgente;
  /** Who the next message goes to. null = the agent the client named. */
  const [hablarCon, setHablarCon] = useState<string | null>(null);
  const [nombreAgente, setNombreAgente] = useState<string | null>(null);
  useEffect(() => { setNombreAgente(loadAgentName()); }, []);

  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [sessionsErr, setSessionsErr] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false);

  // Qué conversación está abierta lo dice la URL (`?conversacion=<id>`): así se
  // comparte, refrescar la deja donde estaba y "atrás" vuelve a la anterior.
  const activeId = useParamRuta(PARAM.conversacion);
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
  // Los adjuntos NO se pegan como texto en el cuadro de escribir: ahí el
  // cliente veía aparecer "workspace/entrada/clientes.csv" mezclado con sus
  // palabras ("feo, pero funcionó"). Viven acá y se suman al mensaje recién
  // al enviarlo, que es lo que el agente necesita leer.
  const [adjuntos, setAdjuntos] = useState<{ nombre: string; path: string }[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const sendingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const openSeq = useRef(0);
  const threadRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setCfg(loadConfig()); }, []);

  // ABRIR EL CHAT CON EL PEDIDO YA ESCRITO: /app/chat?p=<texto>.
  // Es lo que convierte una tarjeta de ejemplo en algo que PASA. Sin esto, el
  // cliente que toca "armar el primero" cae en una caja de texto vacía — que
  // es exactamente el problema que la pantalla venía a resolver.
  //
  // Se manda UNA sola vez: `arrancado` evita que un re-render lo repita, y se
  // limpia la URL para que refrescar no vuelva a mandarlo.
  const arrancado = useRef(false);
  useEffect(() => {
    if (arrancado.current || !cfg) return;
    const pedido = new URLSearchParams(window.location.search).get("p");
    if (!pedido?.trim()) return;
    arrancado.current = true;
    reemplazarEnRuta({ [PARAM_PEDIDO_CHAT]: null });
    run(pedido.trim(), []);
  }, [cfg]);

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
      setAdjuntos((prev) => (prev.some((a) => a.path === r.path)
        ? prev
        : [...prev, { nombre: file.name, path: r.path }]));
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

  // Abrir una conversación (o empezar una nueva) es NAVEGAR. El hilo lo carga
  // el efecto de abajo mirando la URL, así da igual si llegaste por la lista,
  // por un link pegado o apretando "atrás".
  const newConversation = useCallback(() => {
    if (sendingRef.current) return;
    abrirEnRuta({ [PARAM.conversacion]: null });
  }, []);

  const irASesion = useCallback((id: string) => {
    if (sendingRef.current) return;
    abrirEnRuta({ [PARAM.conversacion]: id });
  }, []);

  const cargarHilo = useCallback((c: PortalConfig, id: string) => {
    const seq = ++openSeq.current;
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
        // Un 404 acá no es una caída: es un link viejo a una conversación que
        // ya no está (se borró, o es de otro agente). "No pude hablar con tu
        // agente — 404 en /api/sessions" era mentira y encima en jerga.
        const msg = e instanceof Error ? e.message : "error de red";
        setThreadErr(/\b404\b/.test(msg) ? "__vieja__" : msg);
      })
      .finally(() => { if (openSeq.current === seq) setLoadingThread(false); });
  }, []);

  // De qué conversación es lo que hay en pantalla. Sin esto, la guarda de
  // "hay un envío en curso" se tragaba los CAMBIOS de conversación: apretar
  // atrás mientras el agente contestaba dejaba la URL y el encabezado en A, el
  // hilo en pantalla en B, y el mensaje siguiente se escribía en A. Verificado
  // por API. La guarda tiene que proteger el envío, no esconder la navegación.
  const activeIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (!cfg) return;
    const previo = activeIdRef.current;
    activeIdRef.current = activeId;
    // `undefined` = primera vuelta: no es un cambio de conversación.
    const cambioDeHilo = previo !== undefined && previo !== activeId;

    if (sendingRef.current) {
      // Mismo hilo y envío en curso: no tocar nada. Es el caso de `?p=`, que
      // arranca la conversación en el mismo commit que este efecto.
      if (!cambioDeHilo) return;
      // Te fuiste a otra conversación: el envío que estaba en vuelo pertenece
      // a la anterior. Se corta y se carga la que pediste. Cualquier otra cosa
      // termina escribiendo en la conversación equivocada.
      abortRef.current?.abort();
      sendingRef.current = false;
      setSending(false);
      setLiveTools([]);
    }
    if (!activeId) {
      // Conversación nueva: pizarra limpia. No se toca lo que se está
      // escribiendo en el compositor.
      openSeq.current++;
      setMsgs([]);
      setLoadingThread(false);
      setThreadErr(null);
      setSendErr(null);
      setFailedText(null);
      setEditingIdx(null);
      setAtBottom(true);
      return;
    }
    cargarHilo(cfg, activeId);
  }, [cfg, activeId, cargarHilo]);

  // Envía `text` partiendo de `base` como historia previa.
  const run = async (text: string, base: Msg[]) => {
    if (!cfg || !text.trim() || sendingRef.current) return;
    sendingRef.current = true;
    // A qué hilo pertenece ESTE envío. Si mientras corre el cliente se va a
    // otra conversación, `openSeq` cambia y todo lo que llegue tarde se
    // descarta en vez de pintarse encima de lo que está mirando ahora.
    const seqEnvio = openSeq.current;
    const vigente = () => openSeq.current === seqEnvio;

    const history: ChatMessage[] = [
      ...base.map((m): ChatMessage => ({ role: m.role, content: m.content })),
      { role: "user", content: text },
    ];

    setInput("");
    setSendErr(null);
    setFailedText(null);
    // Arranca "Pensando…" de una, sin esperar al primer evento del agente. Va
    // solo en liveTools (lo que se ve mientras corre) y NO en `tools`, que es
    // lo que queda guardado: si no, cada mensaje terminaría con un rastro
    // "Pensó un momento" aunque no haya usado nada.
    setLiveTools([THINKING]);
    setEditingIdx(null);
    setMsgs([...base, { role: "user", content: text },
             { role: "assistant", content: "", by: hablarCon ?? undefined }]);
    setSending(true);
    setAtBottom(true);

    const ac = new AbortController();
    abortRef.current = ac;
    const tools: string[] = [];
    const apply = (content: string) => {
      if (!vigente()) return;
      setMsgs((ms) => [
        ...ms.slice(0, -1),
        {
          role: "assistant",
          content,
          tools: tools.length ? [...tools] : undefined,
          // Stamped on the message, not read from a live selector: the client
          // can address someone else on the next turn and this reply has to
          // keep saying who actually wrote it.
          by: hablarCon ?? undefined,
        },
      ]);
    };

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
        }, ac.signal, hablarCon);
      } else {
        // Conversación nueva: el gateway también reporta herramientas, pero
        // por otro evento. Sin esto el rastro y el gesto se quedan en
        // "Pensando" toda la respuesta.
        await chatStream(cfg, history, paint, (tool) => {
          if (tools[tools.length - 1] !== tool) tools.push(tool);
          setLiveTools([...tools]);
        }, ac.signal, hablarCon);
      }
      flush();
      if (vigente()) {
        setMsgs((ms) => (ms[ms.length - 1]?.content.trim() ? ms : ms.slice(0, -1)));
      }
      refreshSessions(cfg);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        flush();
        if (vigente()) {
          setMsgs((ms) => (ms[ms.length - 1]?.content.trim() ? ms : ms.slice(0, -1)));
        }
        refreshSessions(cfg);
      } else if (vigente()) {
        setMsgs(base);
        setInput(text);
        setFailedText(text);
        // Al ABRIR un hilo viejo el 404 ya se traducía ("Esa conversación ya no
        // está"); al MANDAR salía crudo: "No pude enviar tu mensaje. 404 en
        // chat de sesión". Es exactamente lo mismo pasando —la conversación no
        // existe más— y encima acá Reintentar no puede funcionar nunca: vuelve
        // a pegarle a la misma sesión que no está.
        const msg = e instanceof Error ? e.message : "error de red";
        setSendErr(/\b404\b/.test(msg) ? "__vieja__" : msg);
      }
    } finally {
      abortRef.current = null;
      // Si el cliente ya cambió de conversación, el efecto de `activeId` limpió
      // esto antes: no lo pisamos de nuevo.
      if (vigente()) {
        sendingRef.current = false;
        setSending(false);
        setLiveTools([]);
      }
    }
  };

  const send = (raw: string) => {
    const rutas = adjuntos.map((a) => a.path).join("\n");
    const texto = [raw.trim(), rutas].filter(Boolean).join("\n");
    if (!texto) return;
    setAdjuntos([]);
    run(texto, msgs);
  };

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
  const canSend = !sending && input.trim().length > 0;

  const sidebar = (
    <Sessions
      cfg={cfg}
      sessions={sessions}
      sessionsErr={sessionsErr}
      activeId={activeId}
      sending={sending}
      onOpen={irASesion}
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
          {/* Solo las conversaciones guardadas tienen link. Una recién
              empezada todavía no existe del lado del agente: prometerle un
              link que no lleva a nada sería peor que no ofrecerlo. */}
          {activeId && <CopiarLink titulo="Copiar el link de esta conversación" />}
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
            ) : threadErr === "__vieja__" ? (
              <div className="pt-16">
                <EmptyState
                  icon={MessageSquareOff}
                  title="Esa conversación ya no está"
                  hint="Puede que la hayas borrado o que el link sea viejo. Empezá una nueva o abrí otra de la lista de la izquierda."
                />
              </div>
            ) : threadErr ? (
              <ErrorState message={threadErr} onRetry={() => activeId && cargarHilo(cfg, activeId)} />
            ) : msgs.length === 0 && !sending ? (
              <div className="flex flex-col items-center pt-24 text-center">
                {/* El agentito recibe — el ANIMADO: mientras no le pedís nada,
                    se ceba unos mates (estado tranquilo). */}
                <div className="mb-5 h-36 w-36">
                  <AgentitoRive festejos={0} look={lookAgente} estado="tranquilo" className="h-full w-full" />
                </div>
                <p className="text-base font-bold text-ink">
                  {nombreAgente ? `¿En qué te puede ayudar ${nombreAgente}?` : "¿En qué te puedo ayudar?"}
                </p>
                <p className="mt-1 max-w-sm text-sm leading-relaxed text-ink-soft">
                  Preguntale lo que necesites o encargale una tarea. Las conversaciones
                  anteriores están a la izquierda.
                </p>
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
                    <div key={i} className="group flex gap-2.5">
                      {/* Un solo agentito por mensaje: el animado mientras
                          está trabajando, el quieto cuando terminó.
                          When a member of the team answered, it is THEIR face:
                          the same identity the board and the roster draw, so
                          "who did this" reads the same everywhere. */}
                      <div className="mt-0.5 h-7 w-7 shrink-0">
                        {sending && i === lastIdx ? (
                          <AgentitoRive
                            festejos={0}
                            look={lookDe(m.by)}
                            estado={gestoDe(liveTools[liveTools.length - 1])}
                            className="h-full w-full"
                          />
                        ) : (
                          <AgentitoAvatar look={lookDe(m.by)} className="h-full w-full" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                      {m.by && (
                        <p className="mb-0.5 text-[12px] font-semibold text-ink">
                          {roleName(m.by, roles)}
                        </p>
                      )}
                      {(m.tools?.length || (sending && i === lastIdx && liveTools.length > 0)) && (
                        <ToolTrace
                          tools={sending && i === lastIdx ? liveTools : m.tools ?? []}
                          live={sending && i === lastIdx}
                        />
                      )}
                      {m.content.trim() && <Markdown>{m.content}</Markdown>}
                      {/* La visualización se mira ACÁ. El chip sigue estando en
                          la prosa para citarla; esto es para no tener que irse a
                          otra pestaña cuando el agente pregunta "¿está bien?". */}
                      {cfg && !(sending && i === lastIdx) &&
                        artifactIdsIn(m.content).map((id) => (
                          <ArtifactPreview key={id} cfg={cfg} id={id} />
                        ))}
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
                    </div>
                  ),
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
            {sendErr === "__vieja__" ? (
              <div className="mb-2 flex items-center justify-between gap-3 rounded-lg border border-c-amber bg-c-amber/30 px-3 py-2 text-[13px] text-c-amber-ink">
                <span className="min-w-0 font-medium">
                  Esa conversación ya no está, así que no pude mandar tu mensaje. Lo dejé
                  escrito abajo: empezá una nueva y mandalo ahí.
                </span>
                <Btn size="sm" kind="secondary" onClick={newConversation} disabled={sending}>
                  Empezar una nueva
                </Btn>
              </div>
            ) : sendErr ? (
              <div className="mb-2 flex items-center justify-between gap-3 rounded-lg border border-c-coral bg-c-coral/30 px-3 py-2 text-[13px] text-c-coral-ink">
                <span className="min-w-0 truncate font-medium">No pude enviar tu mensaje. {sendErr}</span>
                <Btn size="sm" kind="secondary" onClick={() => failedText && send(failedText)} disabled={sending}>
                  Reintentar
                </Btn>
              </div>
            ) : null}
            {mention && (
              <MentionList
                kind={mention.kind}
                items={mentionItems}
                activeIdx={mentionIdx}
                onPick={pickMention}
              />
            )}
            {adjuntos.length > 0 && (
              <div className="mb-1.5 flex flex-wrap gap-1.5">
                {adjuntos.map((a) => (
                  <span
                    key={a.path}
                    className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-black/[0.07] bg-white px-2 py-1 text-[12px] text-ink"
                  >
                    <Paperclip className="h-3 w-3 shrink-0 text-ink-soft" />
                    <span className="truncate">{a.nombre}</span>
                    <button
                      aria-label={`Quitar ${a.nombre}`}
                      onClick={() => setAdjuntos((prev) => prev.filter((x) => x.path !== a.path))}
                      className="shrink-0 rounded p-0.5 text-ink-soft transition hover:text-c-coral-ink"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            {/* WHO ANSWERS. Above the composer, never in front of it: the
                default is the agent the client named, and having to pick a
                recipient before typing is a tax on every message. Nothing
                renders when the agent has no team. */}
            {Object.keys(roles).length > 0 && (
              <div className="mb-2 flex w-full flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-ink-soft">Le escribís a</span>
                <button
                  onClick={() => setHablarCon(null)}
                  className={`rounded-lg border px-2 py-0.5 text-[11px] font-medium transition ${
                    hablarCon === null
                      ? "border-primary bg-primary text-white"
                      : "border-black/[0.07] bg-white text-ink-soft hover:border-primary/40"
                  }`}
                >
                  {nombreAgente || "tu agente"}
                </button>
                {Object.values(roles).map((role) => (
                  <button
                    key={role.id}
                    onClick={() => setHablarCon(role.id)}
                    title={role.does}
                    className={`rounded-lg border px-2 py-0.5 text-[11px] font-medium transition ${
                      hablarCon === role.id
                        ? "border-primary bg-primary text-white"
                        : "border-black/[0.07] bg-white text-ink-soft hover:border-primary/40"
                    }`}
                  >
                    {roleName(role.id, roles)}
                  </button>
                ))}
              </div>
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
                placeholder={
                  // The field says who is actually going to read it. With a
                  // member selected it said the agent's name anyway, which
                  // quietly contradicted the row right above.
                  hablarCon
                    ? `Escribile a ${roleName(hablarCon, roles)}…`
                    : nombreAgente ? `Escribile a ${nombreAgente}…` : "Escribile a tu agente…"
                }
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
              {/* Cuatro atajos apretados en letra chica: de eso el cliente
                  entiende el primero y el resto es ruido. Queda lo que sirve
                  sin saber nada, en palabras. */}
              Enter envía · escribí <b className="font-semibold">#</b> para nombrar una tarea
              o <b className="font-semibold">@</b> para un archivo
            </p>
          </div>
        </div>
      </div>
    </div>
    </EntityProvider>
  );
}
