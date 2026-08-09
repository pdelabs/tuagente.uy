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
  /** Conexiones que el flujo del cliente necesita y faltan (adapter ≥0.24).
   *  Alimenta el aviso del inicio y el puntito del sidebar. */
  conexiones_pendientes?: number;
  /** Pinta que el cliente le eligió, guardada en el agente (adapter 0.26+).
   *  Ausente con adapters viejos: el portal cae a lo que tenga el browser. */
  look?: Record<string, number> | null;
  /** true si el cliente ya lo bautizó desde el portal alguna vez. */
  bautizado?: boolean;
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

// Marca que el portal le pone al ticket que crea el propio cliente al pedir
// una conexión. Sin ella, ese pedido vuelve por Aprobaciones y el portal lo
// manda a aprobar su propia solicitud — un cliente de prueba lo describió como
// "pedir un presupuesto y que te manden a vos mismo a firmarlo". Va como
// comentario HTML: el sanitizador del markdown no lo muestra.
export const MARCA_PEDIDO = "<!-- portal:pedido -->";
/** Los pedidos anteriores a la marca se reconocen por cómo arranca el cuerpo. */
export const PREFIJO_PEDIDO = "Pedido desde el portal.";

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
/** Bautizo y pinta, guardados EN EL AGENTE para que lo sigan a cualquier
 *  máquina. Con un adapter viejo tira 404 y el portal sigue con el browser. */
export const guardarIdentidad = (
  c: PortalConfig,
  identidad: {
    nombre?: string;
    look?: Record<string, number>;
    /** Quién es el CLIENTE (adapter 0.32+). El nombre del negocio se usa para
     *  hablarle de lo suyo por su nombre; la url dispara el brief (el agente
     *  investiga su propia empresa y entrega un borrador). */
    empresa?: string;
    url?: string;
    /** Por dónde le avisa el agente. El aviso lo manda ÉL, no nosotros. */
    contacto?: { canal: "telegram" | "correo" | "ninguno"; valor?: string };
    /** Captura PNG (base64 pelado) del agentito al bautizarlo: el agente la
     *  guarda y un tool nuestro la sube como foto del bot de Telegram. */
    avatar_png?: string;
  },
) => post<{ ok: boolean }>(c.adapter, "/portal/identity", c, identidad);
/** Cambiar qué puede hacer el agente con una conexión. Solo el cliente. */
export const guardarPermisos = (
  c: PortalConfig, id: string, permisos: { leer?: boolean; actuar?: boolean },
) => post<{ ok: boolean; permisos: { leer: boolean; actuar: boolean } }>(
  c.adapter, `/portal/connections/${encodeURIComponent(id)}/permisos`, c, permisos);
export const getActivity = (c: PortalConfig) => get<{ events: any[] }>(c.adapter, "/portal/activity", c);
export const getFiles = (c: PortalConfig) => get<{ files: any[] }>(c.adapter, "/portal/files", c);
export const getFileText = async (c: PortalConfig, path: string) => {
  const res = await fetch(`${c.adapter}/portal/files/${encodeURIComponent(path)}`, { headers: headers(c) });
  if (!res.ok) throw httpError(res.status, path);
  return res.text();
};
/** Los bytes crudos, sin pasarlos por texto.
 *
 *  Para descargar hay que usar SIEMPRE esto. `res.text()` decodifica como
 *  UTF-8, y sobre un binario (.xlsx, .pdf, una imagen) cada byte inválido se
 *  reemplaza por U+FFFD: el archivo que baja queda roto aunque el adapter lo
 *  haya mandado intacto. Verificado con un .xlsx de 9316 bytes que viajaba
 *  perfecto y se corrompía recién en el browser. */
export const getFileBytes = async (c: PortalConfig, path: string) => {
  const res = await fetch(`${c.adapter}/portal/files/${encodeURIComponent(path)}`, { headers: headers(c) });
  if (!res.ok) throw httpError(res.status, path);
  return res.arrayBuffer();
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
  /** true solo en las nuestras (adapter ≥0.21): las del motor no se editan. */
  editable?: boolean;
  /** Nombre para humanos con tildes (frontmatter `titulo`, adapter ≥0.23);
   *  sin él, el portal humaniza el slug — que no puede inventar tildes. */
  label?: string;
};
export type Capabilities = {
  skills: Capability[];
  plugins: { name: string; summary: string }[];
  mcp: { name: string; detalle: string }[];
};
export const getCapabilities = (c: PortalConfig) =>
  get<Capabilities>(c.adapter, "/portal/capabilities", c);

/** Un flujo: el trabajo del cliente con nombre, gatillo y resultados
 *  (adapter ≥0.29). El estado "incompleto" lo deriva el adapter de las
 *  conexiones que faltan — nunca viene guardado. */
export type Flujo = {
  slug: string;
  nombre: string;
  para_cliente: string;
  gatillo_tipo: "drive" | "horario" | "webhook" | "pedido" | string;
  gatillo: string;
  estado: "activo" | "pausado" | "incompleto" | string;
  conexiones_faltan: string[];
  ultima_corrida?: { cuando?: string | null; status?: string } | null;
  resultados: { path: string; mtime: number }[];
  resultados_total: number;
};
export const getFlujos = (c: PortalConfig) =>
  get<{ disponible: boolean; flujos: Flujo[] }>(c.adapter, "/portal/flujos", c);
/** Detalle: resultados completos + el "cómo trabajo" del FLUJO.md (≥0.30). */
export type FlujoDetalle = Flujo & { como: string };
export const getFlujoDetalle = (c: PortalConfig, slug: string) =>
  get<FlujoDetalle>(c.adapter, `/portal/flujos/${encodeURIComponent(slug)}`, c);

/** El SKILL.md completo de una habilidad nuestra (adapter ≥0.21). */
export const getSkillContent = (c: PortalConfig, name: string) =>
  get<{ name: string; content: string }>(c.adapter, `/portal/skills/${encodeURIComponent(name)}`, c);
/** Editar la habilidad ES editar cómo trabaja el agente: el motor la reindexa
 *  solo en unos minutos, no hay que reiniciar nada. */
export const saveSkill = (c: PortalConfig, name: string, content: string) =>
  post<{ ok: boolean }>(c.adapter, `/portal/skills/${encodeURIComponent(name)}`, c, { content });

/** A qué sistemas del cliente está enchufado el agente.
 *  El adapter reporta PRESENCIA, nunca valores: acá no viaja ninguna credencial. */
export type Connection = {
  id: string;
  label: string;
  grupo: "canal" | "sistema" | string;
  para_que: string;
  como: string;
  esfuerzo?: "minutos" | "horas" | "dias" | string;
  quien?: "cliente_solo" | "asistido" | "nosotros" | string;
  advertencia?: string | null;
  recomendado?: boolean;
  estado: "conectado" | "sin_conectar" | "bloqueado" | string;
  falta: { tipo: string; nombre: string }[];
  falta_previo: { tipo: string; nombre: string }[];
  /** true si el flujo de ESTE cliente la necesita (adapter ≥0.24). */
  requerida?: boolean;
  /** Qué puede hacer el agente con esta conexión (adapter ≥0.33). Lo decide el
   *  cliente y se aplica en el guardia, no en el prompt: el agente no puede
   *  cambiarlo (el archivo está montado de solo lectura de su lado). */
  permisos?: { leer: boolean; actuar: boolean };
  /** "google-oauth" = el portal la conecta solo con su diálogo (adapter ≥0.25);
   *  sin flujo, el botón cae a "Pedir que la conecten". */
  flujo?: string | null;
  /** Estado "lista" (adapter ≥0.27): nuestra mitad está (el bot existe) pero
   *  el cliente nunca chateó. `link` es el t.me/… para su primer mensaje. */
  link?: string | null;
};
export const getConnections = (c: PortalConfig) =>
  get<{ disponible: boolean; conexiones: Connection[] }>(c.adapter, "/portal/connections", c);

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
      // Igual que en chatStream: la línea en blanco cierra el evento. Acá el
      // gateway nombra todos, pero dejarlo colgado es la misma trampa.
      if (line.trim() === "") { event = ""; continue; }
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
        // OJO: en el stream de sesión `tool.progress` NO es el aviso de que
        // arranca una herramienta — es el canal del pensamiento
        // (`tool_name: "_thinking"`). El nombre real viene en `tool.started`.
        // Escuchando solo progress, una conversación RETOMADA se quedaba en
        // "Pensando" de punta a punta aunque el agente estuviera navegando y
        // corriendo comandos: 38 herramientas y el cliente viendo un puntito.
        // (En conversación nueva no pasaba: ese camino es el OpenAI, que sí
        // manda `hermes.tool.progress` con el nombre.)
        case "tool.started":
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
  /** Herramienta que arranca. OJO: acá el evento NO se llama igual que en el
   *  stream de sesión. El gateway manda `event: hermes.tool.progress` con
   *  `{tool, label, status}` (verificado en gateway/platforms/api_server.py),
   *  mientras que el de sesión manda `tool.progress` con `{tool_name}`. Sin
   *  esto, una conversación NUEVA no reporta ninguna herramienta: el rastro
   *  se queda en "Pensando" para siempre y el agentito nunca cambia de gesto.
   *  Los `_internos` (como `_thinking`) el gateway ni los manda por acá. */
  onTool?: (tool: string) => void,
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
  let acc = "", buf = "", evento = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      // La línea en blanco CIERRA el evento SSE y vuelve el tipo al default.
      // Sin esto, el `event: hermes.tool.progress` de la primera herramienta
      // quedaba pegado para siempre y TODOS los chunks de texto que venían
      // después (que son eventos sin nombre) se descartaban en el `continue`
      // de abajo: en una conversación NUEVA, apenas el agente usaba una
      // herramienta, la respuesta entera desaparecía y el cliente veía
      // silencio. Verificado el 8/8 contra el stream crudo del gateway.
      if (line.trim() === "") { evento = ""; continue; }
      if (line.startsWith("event: ")) { evento = line.slice(7).trim(); continue; }
      if (!line.startsWith("data: ") || line.includes("[DONE]")) continue;
      let payload: any;
      try {
        payload = JSON.parse(line.slice(6));
      } catch { continue; /* chunk parcial */ }
      if (evento === "hermes.tool.progress") {
        // Solo el arranque: el `completed` que viene después duplicaría.
        if (payload?.status !== "completed" && typeof payload?.tool === "string") {
          onTool?.(payload.tool);
        }
        continue;
      }
      const delta = payload?.choices?.[0]?.delta?.content;
      if (delta) { acc += delta; onDelta(acc); }
    }
  }
  return acc;
}

/** Rótulo de una conexión por su id, para nombrarla donde el cliente la
 *  necesita. Los ids del catálogo (`correo`, `google-workspace`) son nuestros;
 *  el cliente nunca los tiene que leer. Si el catálogo no está a mano, cae a
 *  algo legible en vez de escupir el id. */
export function etiquetaConexion(id: string, conexiones?: Connection[] | null): string {
  const c = conexiones?.find((x) => x.id === id);
  if (c?.label) return c.label;
  const CONOCIDAS: Record<string, string> = {
    correo: "el correo de la empresa",
    telegram: "Telegram",
    whatsapp: "WhatsApp",
    slack: "Slack",
    "google-workspace": "Google Planillas y Drive",
    "gmail-lectura": "Gmail",
    "modelos-auxiliares": "los modelos de IA auxiliares",
  };
  return CONOCIDAS[id] ?? id.replace(/-/g, " ");
}
