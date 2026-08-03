"use client";

// Único punto de red del portal. Config del magic link:
//   /app#endpoint=https://...&adapter=https://...&key=...
// Defaults locales para desarrollo contra el agente fixture.

export type PortalConfig = {
  endpoint: string; // api server del agente (:8642)
  adapter: string;  // adapter sidecar (:8643)
  key: string;
};

export type Manifest = {
  agent: string;
  portal_plugin: string;
  modules: Record<string, boolean>;
};

export type Ticket = {
  id: string;
  title: string;
  body: string | null;
  status: string;
  tenant: string | null;
  created_at: string | number; // Hermes lo emite como epoch en segundos
};

const DEFAULTS = { endpoint: "http://localhost:8642", adapter: "http://localhost:8643" };
const KEY = "tuagente_portal_config";

export function loadConfig(): PortalConfig | null {
  if (typeof window === "undefined") return null;
  const h = window.location.hash;
  const get = (k: string) => h.match(new RegExp(`${k}=([^&]+)`))?.[1];
  const fromHash = {
    endpoint: get("endpoint") ? decodeURIComponent(get("endpoint")!) : undefined,
    adapter: get("adapter") ? decodeURIComponent(get("adapter")!) : undefined,
    key: get("key"),
  };
  const stored = JSON.parse(localStorage.getItem(KEY) || "null");
  const cfg = {
    endpoint: fromHash.endpoint || stored?.endpoint || DEFAULTS.endpoint,
    adapter: fromHash.adapter || stored?.adapter || DEFAULTS.adapter,
    key: fromHash.key || stored?.key,
  };
  if (!cfg.key) return null;
  localStorage.setItem(KEY, JSON.stringify(cfg));
  return cfg as PortalConfig;
}

export function clearConfig() {
  localStorage.removeItem(KEY);
}

function headers(cfg: PortalConfig): HeadersInit {
  return { Authorization: `Bearer ${cfg.key}` };
}

async function get<T>(base: string, path: string, cfg: PortalConfig): Promise<T> {
  const res = await fetch(base + path, { headers: headers(cfg) });
  if (!res.ok) throw new Error(`${res.status} en ${path}`);
  return res.json();
}

async function post<T>(base: string, path: string, cfg: PortalConfig, body?: unknown): Promise<T> {
  const res = await fetch(base + path, {
    method: "POST",
    headers: { ...headers(cfg), "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${res.status} en ${path}`);
  return res.json();
}

export type TicketComment = { author: string; body: string; created_at: number };
export type TicketEvent = { kind: string; created_at: number };
export type TicketDetail = { ticket: Ticket; comments: TicketComment[]; events: TicketEvent[] };

// ── Adapter (:8643) ──
export const getManifest = (c: PortalConfig) => get<Manifest>(c.adapter, "/portal/manifest", c);
export const getTickets = (c: PortalConfig) => get<{ tickets: Ticket[] }>(c.adapter, "/portal/tickets", c);
export const getTicketDetail = (c: PortalConfig, id: string) =>
  get<TicketDetail>(c.adapter, `/portal/tickets/${encodeURIComponent(id)}`, c);
export const getApprovals = (c: PortalConfig) => get<{ approvals: any[] }>(c.adapter, "/portal/approvals", c);
export const approve = (c: PortalConfig, id: string) => post<{ ok: boolean }>(c.adapter, `/portal/approvals/${id}/approve`, c);
export const reject = (c: PortalConfig, id: string, reason: string) =>
  post<{ ok: boolean }>(c.adapter, `/portal/approvals/${id}/reject`, c, { reason });
export const getActivity = (c: PortalConfig) => get<{ events: any[] }>(c.adapter, "/portal/activity", c);
export const getFiles = (c: PortalConfig) => get<{ files: any[] }>(c.adapter, "/portal/files", c);
export const getFileText = async (c: PortalConfig, path: string) => {
  const res = await fetch(`${c.adapter}/portal/files/${encodeURIComponent(path)}`, { headers: headers(c) });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.text();
};
export const getUsage = (c: PortalConfig) => get<any>(c.adapter, "/portal/usage", c);

// ── Agente (:8642) ──
// include_disabled: el listado pelado excluye los jobs pausados.
export const getJobs = (c: PortalConfig) => get<any>(c.endpoint, "/api/jobs?include_disabled=true", c);
export const jobAction = (c: PortalConfig, id: string, action: "pause" | "resume" | "run") =>
  post<any>(c.endpoint, `/api/jobs/${id}/${action}`, c);
export const getSessions = (c: PortalConfig) => get<any>(c.endpoint, "/api/sessions", c);
export const getSessionMessages = (c: PortalConfig, id: string) =>
  get<any>(c.endpoint, `/api/sessions/${id}/messages`, c);
export const deleteSession = async (c: PortalConfig, id: string) => {
  const res = await fetch(`${c.endpoint}/api/sessions/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: headers(c),
  });
  if (!res.ok) throw new Error(`${res.status} al borrar la sesión`);
};
export const renameSession = async (c: PortalConfig, id: string, title: string) => {
  const res = await fetch(`${c.endpoint}/api/sessions/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { ...headers(c), "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error(`${res.status} al renombrar la sesión`);
};

export type ChatMessage = { role: "user" | "assistant" | "system"; content: string };

export type RunMessage = { role: string; content: string | null };

export type SessionStreamHandlers = {
  onMessageStart?: () => void;
  /** Delta crudo (NO acumulado, a diferencia de chatStream). */
  onDelta?: (delta: string) => void;
  /** Contenido completo y autoritativo del mensaje que acaba de cerrar. */
  onMessageComplete?: (content: string) => void;
  onToolProgress?: (toolName: string) => void;
  /** Mensajes finales del run (puede haber varios si hubo tools). */
  onRunComplete?: (messages: RunMessage[]) => void;
};

// Streaming SSE NATIVO de Hermes para continuar una sesión existente:
//   POST /api/sessions/{id}/chat/stream   body {"message": "<texto>"}
// Eventos: run.started / message.started / assistant.delta {delta} /
// tool.progress {tool_name} / assistant.completed {content} /
// run.completed {messages} / done. Incompatible con el formato OpenAI de
// chatStream() en request y respuesta (mandar {messages} da 400).
export async function sessionChatStream(
  cfg: PortalConfig,
  sessionId: string,
  message: string,
  h: SessionStreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(
    `${cfg.endpoint}/api/sessions/${encodeURIComponent(sessionId)}/chat/stream`,
    {
      method: "POST",
      headers: { ...headers(cfg), "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
      signal,
    },
  );
  if (!res.ok || !res.body) {
    let detail = `${res.status} en chat de sesión`;
    try {
      const err = await res.json();
      if (err?.error?.message) detail = err.error.message;
    } catch { /* sin cuerpo JSON */ }
    throw new Error(detail);
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let event = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (line.startsWith("event: ")) {
        event = line.slice(7).trim();
        continue;
      }
      if (!line.startsWith("data: ")) continue;
      let data: any;
      try {
        data = JSON.parse(line.slice(6));
      } catch {
        continue; // chunk parcial
      }
      switch (event) {
        case "message.started":
          h.onMessageStart?.();
          break;
        case "assistant.delta":
          if (typeof data.delta === "string" && data.delta) h.onDelta?.(data.delta);
          break;
        case "tool.progress":
          if (typeof data.tool_name === "string") h.onToolProgress?.(data.tool_name);
          break;
        case "assistant.completed":
          if (typeof data.content === "string") h.onMessageComplete?.(data.content);
          break;
        case "run.completed":
          if (Array.isArray(data.messages)) h.onRunComplete?.(data.messages);
          break;
        case "done":
          return;
      }
    }
  }
}

// Streaming SSE OpenAI-compatible. onDelta recibe texto incremental.
export async function chatStream(
  cfg: PortalConfig,
  messages: ChatMessage[],
  onDelta: (text: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch(cfg.endpoint + "/v1/chat/completions", {
    method: "POST",
    headers: { ...headers(cfg), "Content-Type": "application/json" },
    body: JSON.stringify({ messages, stream: true }),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`${res.status} en chat`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let acc = "", buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ") || line.includes("[DONE]")) continue;
      try {
        const delta = JSON.parse(line.slice(6)).choices?.[0]?.delta?.content;
        if (delta) { acc += delta; onDelta(acc); }
      } catch { /* chunk parcial */ }
    }
  }
  return acc;
}
