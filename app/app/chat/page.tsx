"use client";

// Chat module — thread centered like Open WebUI, with streaming, rich markdown,
// a collapsible tool block, regenerate/edit, export and live scroll.
// New conversation → /v1/chat/completions; resuming a session → Hermes'
// native SSE (assistant.delta / tool.progress / run.completed).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown, ArrowUp, Brain, Check, ChevronRight, Copy, Download, Loader2, Menu,
  MessageSquareOff, Paperclip, Pencil, RefreshCw, Square, Wrench, X,
} from "lucide-react";
import {
  loadConfig, chatStream, sessionChatStream, getSessions, getSessionMessages,
  getRooms, getRoom, uploadFile,
  type PortalConfig, type ChatMessage, type RoomTurn,
} from "../lib/agent";
import { Btn, EmptyState, ErrorState, IconBtn, Spinner } from "../lib/ui";
import {
  CopyLink, PARAM, PARAM_CHAT_REQUEST, openInRoute, replaceInRoute, useRouteParam,
} from "../lib/routes";
import { EntityProvider } from "../lib/EntityViewer";
import Markdown from "../lib/Markdown";
import ArtifactPreview, { artifactIdsIn } from "../lib/ArtifactPreview";
import { loadAgentName } from "../lib/onboarding";
import {
  AgentitoAnimated, AgentitoAvatar, LOOK_DEFAULT, loadAgentLook, type AgentitoLook,
} from "../lib/agentito";
import { roleName, useRoles } from "../lib/roles";
import type { AgentitoState } from "../lib/AgentitoRive";
import { actionFor, summarizeActions } from "../lib/labels";
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
  tools?: string[]; // tools used in the run (live only)
  /** Which member of the team answered. `assistant` messages only, and only
   *  when the client addressed someone: absent means the agent they named, and
   *  that one is never signed -- badging it would turn their agent into an
   *  employee of a team they never hired. */
  by?: string;
};

const THINKING = "_thinking";

// What the agent is doing, in the client's words. The tool's raw name is
// NEVER shown: "Using skill view…" and "Using kanban show…" were two of the
// phrases QA flagged as "I don't know what those words mean, and they're what
// I see while I wait." The technical name still travels in the `title` for us.

/** Which face the agentito wears based on what it's doing RIGHT NOW.
 *
 *  The gesture tells the truth: it comes from the tool name Hermes reports
 *  via `tool.progress`, not a random rotation. Whatever doesn't fall into any
 *  family goes to "doing", the generic gesture for being at work
 *  (terminal, execute_code, process, cronjob, send_message, delegate_task…). */
function gestureFor(tool: string | undefined): AgentitoState {
  if (!tool || tool === THINKING) return "thinking";
  if (/^(clarify|todo|memory)$/.test(tool)) return "thinking";
  if (/^(read_file|search_files|session_search|read_terminal|skill_view|skills_list|feishu_doc_read|kanban_(show|list)|project_list)$/.test(tool)) {
    return "reading";
  }
  if (/^(write_file|patch|image_generate|video_generate|kanban_(create|comment|complete|block|unblock|link)|project_create)$/.test(tool)) {
    return "writing";
  }
  if (/^(web_search|web_extract|x_search|browser_|vision_analyze|video_analyze)/.test(tool)) {
    return "searching";
  }
  return "doing";
}

/** Collapsible block with what the agent did before answering. */
function ToolTrace({ tools, live }: { tools: string[]; live?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!tools.length) return null;
  const last = tools[tools.length - 1];
  const used = tools.filter((t) => t !== THINKING);
  const summary = summarizeActions(tools);
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
            {actionFor(last).inProgress}…
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
              {actionFor(t).done}
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
  // The agent has a name and a face: the chat uses them instead of "your agent".
  // The look is loaded lazily (no effect) so the default violet doesn't flash
  // for a frame.
  const [agentLook] = useState(loadAgentLook);
  // The team, if this agent has one. Empty on every agent running today, so the
  // chat keeps drawing exactly one face: the one the client named.
  const roles = useRoles();
  /** The face for a message: the role that answered, or the client's own agent. */
  const lookFor = (by?: string): AgentitoLook =>
    by && roles[by]?.look
      ? ({ ...LOOK_DEFAULT, ...roles[by].look } as AgentitoLook)
      : agentLook;
  /** Who the next message goes to. null = the agent the client named. */
  const [talkingTo, setTalkingTo] = useState<string | null>(null);
  // WITH A TEAM THE CHAT IS A ROOM, stored by the adapter. Without one it is an
  // engine session, exactly as it has always been -- so no agent running today
  // changes. Both live under the same `?conversation=` param and are told apart
  // by the prefix the portal itself mints.
  const roomMode = Object.keys(roles).length > 0;
  const [agentName, setAgentName] = useState<string | null>(null);
  useEffect(() => { setAgentName(loadAgentName()); }, []);

  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [sessionsErr, setSessionsErr] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false);

  // Which conversation is open is decided by the URL (`?conversation=<id>`):
  // that way it can be shared, a refresh keeps its place, and "back" returns
  // to the previous one.
  const activeId = useRouteParam(PARAM.conversation);
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
  // Mentions: `#` references tickets, `@` workspace files.
  const [mention, setMention] = useState<{ kind: MentionKind; term: string; start: number } | null>(null);
  const [mentionIdx, setMentionIdx] = useState(0);

  const [uploading, setUploading] = useState(false);
  // Attachments do NOT get pasted as text into the compose box: that's where
  // the client used to see "workspace/entrada/clientes.csv" show up mixed in
  // with their own words ("ugly, but it worked"). They live here instead and
  // get appended to the message only when it's sent, which is what the agent
  // needs to read.
  const [attachments, setAttachments] = useState<{ name: string; path: string }[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const sendingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const openSeq = useRef(0);
  const threadRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setCfg(loadConfig()); }, []);

  // OPEN THE CHAT WITH THE REQUEST ALREADY WRITTEN: /app/chat?p=<text>.
  // This is what turns an example card into something that ACTUALLY HAPPENS.
  // Without it, the client who taps "set up the first one" lands on an empty
  // text box — exactly the problem this screen was meant to solve.
  //
  // Sent ONCE: `started` keeps a re-render from repeating it, and the URL
  // gets cleaned up so a refresh doesn't send it again.
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !cfg) return;
    const request = new URLSearchParams(window.location.search).get("p");
    if (!request?.trim()) return;
    started.current = true;
    replaceInRoute({ [PARAM_CHAT_REQUEST]: null });
    run(request.trim(), []);
  }, [cfg]);

  const refreshSessions = useCallback((c: PortalConfig, rooms: boolean) => {
    if (rooms) {
      // The adapter already returns them newest first.
      getRooms(c)
        .then((r) => {
          setSessionsErr(null);
          // WITH THE CHANNEL THE SIDEBAR READS. The list only shows what it
          // recognizes as somebody's conversation (`isHumanConversation`, by
          // `source`): that is what keeps the engine's crons and workers out
          // of it. A room carries no channel -- the portal mints it itself --
          // so every one of them got dropped, and a client with a team read
          // "todavía no hay conversaciones" with the room open right next to
          // the list. The channel is `portal` because that is literally where
          // it was written.
          setSessions((r.rooms ?? []).map((s): SessionSummary => ({
            id: s.id,
            source: "portal",
            title: s.title,
            preview: null,
            message_count: s.turns,
            started_at: s.updated_at,
            last_active: s.updated_at,
          })));
        })
        .catch((e) => setSessionsErr(e instanceof Error ? e.message : "error de red"));
      return;
    }
    getSessions(c)
      .then((r: { data?: SessionSummary[] }) => {
        setSessionsErr(null);
        setSessions([...(r.data ?? [])].sort((a, b) => b.last_active - a.last_active));
      })
      .catch((e) => setSessionsErr(e instanceof Error ? e.message : "error de red"));
  }, []);
  useEffect(() => { if (cfg) refreshSessions(cfg, roomMode); }, [cfg, roomMode, refreshSessions]);

  // Scroll: we follow the stream only if the user is looking at the bottom.
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

  const mentionItems = useMentionItems(cfg, mention?.kind ?? null, mention?.term ?? "", roles);

  // `/…` and `#…` insert a reference into the message. `@…` does NOT: it hands
  // the turn to someone on the team, which is what an @ means in a room.
  // Leaving the id in the text would send the client's own words plus a token
  // they never wrote.
  const pickMention = (item: MentionItem) => {
    if (!mention) return;
    const el = taRef.current;
    const caret = el?.selectionStart ?? input.length;
    if (mention.kind === "role") {
      setTalkingTo(item.insert);
      setInput(`${input.slice(0, mention.start)}${input.slice(caret)}`);
      setMention(null);
      setMentionIdx(0);
      requestAnimationFrame(() => {
        el?.focus();
        el?.setSelectionRange(mention.start, mention.start);
      });
      return;
    }
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

  // Attach: the file goes to the agent's mailbox and its path stays in the
  // message, which the chat shows as a chip and the agent knows how to open.
  const attach = async (file: File) => {
    if (!cfg || uploading) return;
    setUploading(true);
    setSendErr(null);
    try {
      const r = await uploadFile(cfg, file);
      setAttachments((prev) => (prev.some((a) => a.path === r.path)
        ? prev
        : [...prev, { name: file.name, path: r.path }]));
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

  // Opening a conversation (or starting a new one) is NAVIGATING. The thread
  // is loaded by the effect below, watching the URL, so it doesn't matter
  // whether you got here from the list, a pasted link, or hitting "back".
  const newConversation = useCallback(() => {
    if (sendingRef.current) return;
    openInRoute({ [PARAM.conversation]: null });
  }, []);

  const goToSession = useCallback((id: string) => {
    if (sendingRef.current) return;
    openInRoute({ [PARAM.conversation]: id });
  }, []);

  const loadThread = useCallback((c: PortalConfig, id: string) => {
    const seq = ++openSeq.current;
    setMsgs([]);
    setThreadErr(null);
    setSendErr(null);
    setFailedText(null);
    setEditingIdx(null);
    setLoadingThread(true);
    setAtBottom(true);
    const load = id.startsWith("sala_")
      // A room keeps who answered each turn, which is what lets the thread be
      // redrawn with the right faces after a reload instead of one voice.
      ? getRoom(c, id).then((r) => (r.turns ?? []).map((t: RoomTurn) => ({
          role: t.role, content: t.content, by: t.by,
        })))
      : getSessionMessages(c, id).then((r: { data?: StoredMessage[] }) => (r.data ?? [])
          .filter((m) => (m.role === "user" || m.role === "assistant") && m.content?.trim())
          .map((m) => ({ role: m.role as "user" | "assistant", content: m.content as string })));
    load
      .then((turns: Msg[]) => {
        if (openSeq.current !== seq) return;
        setMsgs(turns);
      })
      .catch((e) => {
        if (openSeq.current !== seq) return;
        // A 404 here isn't an outage: it's an old link to a conversation that
        // isn't there anymore (deleted, or from another agent). "Couldn't talk
        // to your agent — 404 on /api/sessions" was a lie, and jargon on top.
        const msg = e instanceof Error ? e.message : "error de red";
        setThreadErr(/\b404\b/.test(msg) ? "__vieja__" : msg);
      })
      .finally(() => { if (openSeq.current === seq) setLoadingThread(false); });
  }, []);

  // Which conversation is on screen. Without this, the "a send is in flight"
  // guard swallowed conversation CHANGES: hitting back while the agent was
  // answering left the URL and header on A, the thread on screen on B, and
  // the next message got written into A. Verified via the API. The guard has
  // to protect the send, not hide the navigation.
  const activeIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (!cfg) return;
    const previous = activeIdRef.current;
    activeIdRef.current = activeId;
    // `undefined` = first pass: not a conversation change.
    const threadChanged = previous !== undefined && previous !== activeId;

    if (sendingRef.current) {
      // Same thread and a send in flight: don't touch anything. This is the
      // `?p=` case, which starts the conversation in the same commit as this
      // effect.
      if (!threadChanged) return;
      // You navigated to another conversation: the send that was in flight
      // belongs to the previous one. It gets aborted and the one you asked
      // for gets loaded. Anything else ends up writing into the wrong
      // conversation.
      abortRef.current?.abort();
      sendingRef.current = false;
      setSending(false);
      setLiveTools([]);
    }
    if (!activeId) {
      // New conversation: clean slate. Don't touch what's being typed in the
      // composer.
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
    loadThread(cfg, activeId);
  }, [cfg, activeId, loadThread]);

  // Sends `text`, starting from `base` as the prior history.
  const run = async (text: string, base: Msg[]) => {
    if (!cfg || !text.trim() || sendingRef.current) return;
    sendingRef.current = true;
    // Which thread THIS send belongs to. If the client navigates to another
    // conversation while it's running, `openSeq` changes and anything that
    // arrives late gets discarded instead of painted over what they're
    // looking at now.
    const sendSeq = openSeq.current;
    const isCurrent = () => openSeq.current === sendSeq;

    // THE ROOM, SEEN FROM WHOEVER IS ANSWERING.
    //
    // In the OpenAI format `assistant` means "you said this", so handing a
    // teammate's reply through untouched makes the next one read it as its own
    // words. Measured on the lab: Vera got Beto's line as `assistant`, quoted
    // it back as hers -- "Te dije: 'Soy Beto…'" -- and then apologised for
    // having said something she never said.
    //
    // So a teammate's turn arrives as what it is: something SOMEONE ELSE said
    // in the room, attributed by name. Only the answerer's own turns stay
    // `assistant`. That is what makes the transcript a room instead of one
    // confused monologue.
    const speaker = (by?: string) => (by ? roleName(by, roles) : agentName || "Tu agente");
    const history: ChatMessage[] = [
      ...base.map((m): ChatMessage => {
        if (m.role !== "assistant" || (m.by ?? null) === talkingTo) {
          return { role: m.role, content: m.content };
        }
        return { role: "user", content: `[${speaker(m.by)} dijo] ${m.content}` };
      }),
      { role: "user", content: text },
    ];

    setInput("");
    setSendErr(null);
    setFailedText(null);
    // Starts "Pensando…" [Thinking…] right away, without waiting for the
    // agent's first event. Goes only into liveTools (what's shown while it
    // runs) and NOT into `tools`, which is what gets saved: otherwise every
    // message would end up with a "thought for a moment" trace even when it
    // used nothing.
    setLiveTools([THINKING]);
    setEditingIdx(null);
    setMsgs([...base, { role: "user", content: text },
             { role: "assistant", content: "", by: talkingTo ?? undefined }]);
    setSending(true);
    setAtBottom(true);

    const ac = new AbortController();
    abortRef.current = ac;
    // THE ROOM THIS TURN BELONGS TO. An open conversation keeps its id; a new
    // one gets minted here and goes into the URL, so a reload -- or the link --
    // comes back to the same room.
    const room = roomMode
      ? (activeId?.startsWith("sala_") ? activeId
        : `sala_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`)
      : null;
    if (room && room !== activeId) replaceInRoute({ [PARAM.conversation]: room });

    const tools: string[] = [];
    // Who takes this turn. Starts as whoever the client named -- null when
    // nobody was -- and the room may fill it in before the first token.
    let answeredBy: string | null = talkingTo;
    const apply = (content: string) => {
      if (!isCurrent()) return;
      setMsgs((ms) => [
        ...ms.slice(0, -1),
        {
          role: "assistant",
          content,
          tools: tools.length ? [...tools] : undefined,
          // Stamped on the message, not read from a live selector: the client
          // can address someone else on the next turn and this reply has to
          // keep saying who actually wrote it.
          by: answeredBy ?? undefined,
        },
      ]);
    };

    // The markdown gets re-parsed whole on every repaint (syntax highlight,
    // formulas, diagrams): we batch deltas per frame instead of per token.
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
      // THE ROOM IS THE MESSAGE LIST, and that is the whole trick: `chatStream`
      // already sends the full history, so whoever takes this turn reads
      // everything said before it -- including what a teammate answered three
      // messages ago -- without needing a memory of its own.
      //
      // A turn aimed at someone always goes this way, even inside an open
      // conversation. `sessionChatStream` sends only the new message and leans
      // on a session stored INSIDE one profile: down that path a teammate would
      // answer having read nothing, which is exactly the bubble we are leaving.
      if (activeId && !talkingTo && !roomMode) {
        // A run can bring several assistant messages (rounds of tools).
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
          // NOTE: run.completed brings the WHOLE session history, not just
          // this turn's messages. We only use it as a safety net when nothing
          // arrived via the deltas, and then only the assistant's last one
          // counts.
          onRunComplete: (messages) => {
            if (segments.some((s) => s.trim())) return;
            const last = [...messages]
              .reverse()
              .find((m) => m.role === "assistant" && m.content?.trim());
            if (last?.content) paint(last.content);
          },
        }, ac.signal, talkingTo);
      } else {
        // New conversation: the gateway also reports tools, but through a
        // different event. Without this the trace and the gesture would
        // stay on "Pensando" [Thinking] for the whole answer.
        await chatStream(cfg, history, paint, (tool) => {
          if (tools[tools.length - 1] !== tool) tools.push(tool);
          setLiveTools([...tools]);
        }, ac.signal, talkingTo, roomMode, (who) => {
          answeredBy = who;
          // Repaint the placeholder message so the face and the name are right
          // from the first token, not after the answer lands.
          setMsgs((ms) => [...ms.slice(0, -1), { ...ms[ms.length - 1], by: who }]);
        }, room);
      }
      flush();
      if (isCurrent()) {
        setMsgs((ms) => (ms[ms.length - 1]?.content.trim() ? ms : ms.slice(0, -1)));
      }
      refreshSessions(cfg, roomMode);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        flush();
        if (isCurrent()) {
          setMsgs((ms) => (ms[ms.length - 1]?.content.trim() ? ms : ms.slice(0, -1)));
        }
        refreshSessions(cfg, roomMode);
      } else if (isCurrent()) {
        setMsgs(base);
        setInput(text);
        setFailedText(text);
        // OPENING an old thread already translated the 404 ("Esa conversación
        // ya no está" [That conversation isn't there anymore]); SENDING left
        // it raw: "Couldn't send your message. 404 on session chat." It's
        // exactly the same thing happening -- the conversation no longer
        // exists -- and on top of that Retry here can never work: it just
        // hits the same session that isn't there.
        const msg = e instanceof Error ? e.message : "error de red";
        setSendErr(/\b404\b/.test(msg) ? "__vieja__" : msg);
      }
    } finally {
      abortRef.current = null;
      // If the client already changed conversation, the `activeId` effect
      // already cleaned this up: we don't stomp on it again.
      if (isCurrent()) {
        sendingRef.current = false;
        setSending(false);
        setLiveTools([]);
      }
    }
  };

  const send = (raw: string) => {
    const paths = attachments.map((a) => a.path).join("\n");
    const text = [raw.trim(), paths].filter(Boolean).join("\n");
    if (!text) return;
    setAttachments([]);
    run(text, msgs);
  };

  // Regenerate: repeats the user's last request. In a new conversation it
  // replaces the answer; in a saved agent session history can't be rewritten,
  // so it goes in as a new turn.
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

  // Shortcuts: ⌘K searches, ⌘⇧O starts a new conversation.
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
      onOpen={goToSession}
      onNew={newConversation}
      onRefresh={() => refreshSessions(cfg, roomMode)}
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
          {/* Only saved conversations have a link. One just started doesn't
              exist yet on the agent's side: promising a link that leads
              nowhere would be worse than not offering it. */}
          {activeId && <CopyLink label="Copiar el link de esta conversación" />}
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
              <ErrorState message={threadErr} onRetry={() => activeId && loadThread(cfg, activeId)} />
            ) : msgs.length === 0 && !sending ? (
              <div className="flex flex-col items-center pt-24 text-center">
                {/* The agentito greets you — the ANIMATED one: while you're
                    not asking for anything, it sips some mate (calm state). */}
                <div className="mb-5 h-36 w-36">
                  <AgentitoAnimated celebrations={0} look={agentLook} state="calm" className="h-full w-full" />
                </div>
                {/* NOBODY SAYS "yo" WHEN THERE IS A TEAM. The face stays the
                    agent's -- it is the room, not a person -- but a room that
                    offers itself in the first person promises one single
                    interlocutor the client does not have: they hired people,
                    and whoever the message is for takes it. */}
                <p className="text-base font-bold text-ink">
                  {roomMode
                    ? "¿En qué te puede ayudar tu equipo?"
                    : agentName ? `¿En qué te puede ayudar ${agentName}?` : "¿En qué te puedo ayudar?"}
                </p>
                <p className="mt-1 max-w-sm text-sm leading-relaxed text-ink-soft">
                  {roomMode
                    ? "Escribí lo que necesitás y lo toma quien corresponda; con @ le hablás a alguien en particular. Las conversaciones anteriores están a la izquierda."
                    : "Preguntale lo que necesites o encargale una tarea. Las conversaciones anteriores están a la izquierda."}
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
                      {/* One agentito per message: the animated one while
                          it's working, the still one once it's done.
                          When a member of the team answered, it is THEIR face:
                          the same identity the board and the roster draw, so
                          "who did this" reads the same everywhere. */}
                      <div className="mt-0.5 h-7 w-7 shrink-0">
                        {sending && i === lastIdx ? (
                          <AgentitoAnimated
                            celebrations={0}
                            look={lookFor(m.by)}
                            state={gestureFor(liveTools[liveTools.length - 1])}
                            className="h-full w-full"
                          />
                        ) : (
                          <AgentitoAvatar look={lookFor(m.by)} className="h-full w-full" />
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
                      {/* The visualization is viewed HERE. The chip stays in
                          the prose so it can be cited; this is so you don't
                          have to switch tabs when the agent asks "does this
                          look right?". */}
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
            {attachments.length > 0 && (
              <div className="mb-1.5 flex flex-wrap gap-1.5">
                {attachments.map((a) => (
                  <span
                    key={a.path}
                    className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-black/[0.07] bg-white px-2 py-1 text-[12px] text-ink"
                  >
                    <Paperclip className="h-3 w-3 shrink-0 text-ink-soft" />
                    <span className="truncate">{a.name}</span>
                    <button
                      aria-label={`Quitar ${a.name}`}
                      onClick={() => setAttachments((prev) => prev.filter((x) => x.path !== a.path))}
                      className="shrink-0 rounded p-0.5 text-ink-soft transition hover:text-c-coral-ink"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            {/* WHO THIS TURN GOES TO. Only when it is aimed at someone: the
                room's default is the agent the client named, and a standing row
                of every teammate would say that picking is a step before every
                message. `@` aims it; this shows it, and takes it back. */}
            {talkingTo && (
              <div className="mb-2 flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-c-violet/40 px-2 py-1 text-[12px] font-medium text-ink">
                  <AgentitoAvatar look={lookFor(talkingTo)} className="h-4 w-4 shrink-0" />
                  Para {roleName(talkingTo, roles)}
                  <button
                    aria-label="Escribirle a todo el equipo"
                    onClick={() => setTalkingTo(null)}
                    className="ml-0.5 text-ink-soft transition hover:text-ink"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
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
                  talkingTo
                    ? `Escribile a ${roleName(talkingTo, roles)}…`
                    : roomMode ? "Escribile a tu equipo…"
                    : agentName ? `Escribile a ${agentName}…` : "Escribile a tu agente…"
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
