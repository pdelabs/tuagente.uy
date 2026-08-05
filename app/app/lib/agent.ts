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

/** Error de red con el status a mano: los módulos distinguen 404 de caída. */
export type HttpError = Error & { status?: number };
function httpError(status: number, path: string, detail?: string): HttpError {
  const e: HttpError = new Error(detail || `${status} en ${path}`);
  e.status = status;
  return e;
}

/** El adapter explica sus 400/409 en `{error}`: ese texto vale más que el número. */
async function failure(res: Response, path: string): Promise<HttpError> {
  let detail = "";
  try {
    const body = await res.json();
    if (typeof body?.error === "string") detail = body.error;
  } catch { /* sin cuerpo JSON */ }
  return httpError(res.status, path, detail);
}

async function get<T>(base: string, path: string, cfg: PortalConfig): Promise<T> {
  const res = await fetch(base + path, { headers: headers(cfg) });
  if (!res.ok) throw await failure(res, path);
  return res.json();
}

async function post<T>(base: string, path: string, cfg: PortalConfig, body?: unknown): Promise<T> {
  const res = await fetch(base + path, {
    method: "POST",
    headers: { ...headers(cfg), "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw await failure(res, path);
  return res.json();
}

async function del<T>(base: string, path: string, cfg: PortalConfig): Promise<T> {
  const res = await fetch(base + path, { method: "DELETE", headers: headers(cfg) });
  if (!res.ok) throw await failure(res, path);
  return res.json();
}

export type TicketComment = { author: string; body: string; created_at: number };
export type TicketEvent = {
  kind: string;
  created_at: number;
  summary?: string;
  files?: string[];
  blocked_kind?: string;
};
/** Por qué el ticket quedó como quedó. Lo arma el adapter desde el evento de
 *  cierre (o de bloqueo), no depende de que el agente se acuerde de comentar. */
export type TicketOutcome = {
  kind: string;
  summary?: string;
  files?: string[];
  created_at: number;
};
export type TicketDetail = {
  ticket: Ticket;
  outcome?: TicketOutcome | null;
  comments: TicketComment[];
  events: TicketEvent[];
};

// ── Adapter (:8643) ──
export const getManifest = (c: PortalConfig) => get<Manifest>(c.adapter, "/portal/manifest", c);
export const getTickets = (c: PortalConfig) => get<{ tickets: Ticket[] }>(c.adapter, "/portal/tickets", c);
export const getTicketDetail = (c: PortalConfig, id: string) =>
  get<TicketDetail>(c.adapter, `/portal/tickets/${encodeURIComponent(id)}`, c);
export const getApprovals = (c: PortalConfig) => get<{ approvals: any[] }>(c.adapter, "/portal/approvals", c);
/** `correction` (opcional): tu versión corregida queda asentada como comentario
 *  tuyo antes de desbloquear — el ticket original no se modifica. */
export const approve = (c: PortalConfig, id: string, correction?: string) =>
  post<{ ok: boolean }>(c.adapter, `/portal/approvals/${id}/approve`, c,
    correction ? { correction } : undefined);
export const reject = (c: PortalConfig, id: string, reason: string) =>
  post<{ ok: boolean }>(c.adapter, `/portal/approvals/${id}/reject`, c, { reason });
export const getActivity = (c: PortalConfig) => get<{ events: any[] }>(c.adapter, "/portal/activity", c);
export const getFiles = (c: PortalConfig) => get<{ files: any[] }>(c.adapter, "/portal/files", c);
export const getFileText = async (c: PortalConfig, path: string) => {
  const res = await fetch(`${c.adapter}/portal/files/${encodeURIComponent(path)}`, { headers: headers(c) });
  if (!res.ok) throw httpError(res.status, path);
  return res.text();
};
export const getUsage = (c: PortalConfig) => get<any>(c.adapter, "/portal/usage", c);

/** Sube un archivo al buzón del agente (workspace/entrada) y devuelve su ruta. */
export async function uploadFile(c: PortalConfig, file: File) {
  const buf = new Uint8Array(await file.arrayBuffer());
  // De a pedazos: con archivos grandes, un solo apply revienta la pila.
  let bin = "";
  for (let i = 0; i < buf.length; i += 8192) {
    bin += String.fromCharCode.apply(null, Array.from(buf.subarray(i, i + 8192)));
  }
  return post<{ ok: boolean; path: string; bytes: number }>(
    c.adapter, "/portal/upload", c, { name: file.name, content_b64: btoa(bin) },
  );
}

export type Capability = {
  name: string; summary: string; origen: string; categoria?: string;
};
export type Capabilities = {
  skills: Capability[];
  plugins: { name: string; summary: string }[];
  mcp: { name: string; detalle: string }[];
};
export const getCapabilities = (c: PortalConfig) =>
  get<Capabilities>(c.adapter, "/portal/capabilities", c);

export type ArtifactMeta = {
  id: string; title: string; kind: string; summary: string;
  created_at: number; bytes: number;
};
export const getArtifacts = (c: PortalConfig) =>
  get<{ artifacts: ArtifactMeta[] }>(c.adapter, "/portal/artifacts", c);
export const getArtifact = (c: PortalConfig, id: string) =>
  get<ArtifactMeta & { html: string }>(c.adapter, `/portal/artifacts/${encodeURIComponent(id)}`, c);
export const deleteArtifact = (c: PortalConfig, id: string) =>
  del<{ ok: boolean }>(c.adapter, `/portal/artifacts/${encodeURIComponent(id)}`, c);

// ── Escritura en el tablero (el adapter la hace por CLI, nunca por SQL) ──
export const createTicket = (c: PortalConfig, t: { title: string; body?: string; tenant?: string }) =>
  post<{ ok: boolean; id: string | null }>(c.adapter, "/portal/tickets", c, t);
export const commentTicket = (c: PortalConfig, id: string, body: string, author?: string) =>
  post<{ ok: boolean }>(c.adapter, `/portal/tickets/${encodeURIComponent(id)}/comment`, c,
    author ? { body, author } : { body });
export type TicketStatus = "done" | "blocked" | "ready" | "archived";
export const setTicketStatus = (c: PortalConfig, id: string, status: TicketStatus) =>
  post<{ ok: boolean }>(c.adapter, `/portal/tickets/${encodeURIComponent(id)}/status`, c, { status });

export type CronRun = {
  id: string; status: string; claimed_at: string;
  started_at: string | null; finished_at: string | null; error: string | null;
};
export type CronDetail = {
  job: {
    id: string; name: string; prompt: string; script: string;
    schedule_display: string; enabled: boolean; state: string; model: string;
    deliver: string; last_status: string | null; last_error: string | null;
    next_run_at: string | null;
  };
  runs: CronRun[];
};
export const getCronDetail = (c: PortalConfig, id: string) =>
  get<CronDetail>(c.adapter, `/portal/crons/${encodeURIComponent(id)}`, c);

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
  if (!res.ok) throw httpError(res.status, "borrar la sesión");
};
export const renameSession = async (c: PortalConfig, id: string, title: string) => {
  const res = await fetch(`${c.endpoint}/api/sessions/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { ...headers(c), "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw httpError(res.status, "renombrar la sesión");
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
  /** OJO: viene la sesión ENTERA (verificado: 327 mensajes), no este turno. */
  onRunComplete?: (messages: RunMessage[]) => void;
};

// Streaming SSE NATIVO de Hermes para continuar una sesión existente.
// Eventos: run.started / message.started / assistant.delta {delta} /
// tool.progress {tool_name} / assistant.completed {content} /
// run.completed {messages} / done. Incompatible con el formato OpenAI de
// chatStream() en request y respuesta (mandar {messages} da 400).
//
// Va por el adapter, NO por el gateway: el gateway responde
// /api/sessions/{id}/chat/stream sin Access-Control-Allow-Origin (solo la
// manda en el preflight), así que el browser descarta la respuesta con
// "Failed to fetch". El sidecar lo proxea agregando CORS.
export async function sessionChatStream(
  cfg: PortalConfig,
  sessionId: string,
  message: string,
  h: SessionStreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(
    `${cfg.adapter}/portal/sessions/${encodeURIComponent(sessionId)}/chat/stream`,
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
