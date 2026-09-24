import { NextRequest, NextResponse } from "next/server";
import { CONNECTIONS, catalogPromptBlock } from "./catalog";

export const maxDuration = 25;

/* The free "workflow teardown": the visitor types the task that eats their day
 * and gets an instant, grounded read on what we would build for it — the agent
 * and plugin, the real capabilities and integrations it needs, the hard limit,
 * and the smallest useful pilot. Cheap model, hard caps, structured output.
 *
 * Same model and OPENROUTER_API_KEY usage as app/api/agent/route.ts: Claude
 * Haiku over OpenRouter's OpenAI-compatible Chat Completions API. */

const MODEL = "anthropic/claude-haiku-4.5";
const MAX_WORKFLOW_CHARS = 1500;
const MAX_OUTPUT_TOKENS = 900;

/* Best-effort per-IP throttle. Serverless memory is per-instance and short-lived,
 * so this only smooths abuse from a single warm instance — the real cost guard is
 * the cheap model plus the low token cap. */
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 6;
const hits = new Map<string, number[]>();

function throttled(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear(); // crude cap so the map can't grow unbounded
  return recent.length > RATE_MAX;
}

// Deliberately permissive: reject the obviously-broken, not the merely-unusual.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* Map a free-typed integration name back to a catalog connection, so the model
 * can never surface an integration we don't actually offer. */
const CONNECTION_KEYWORDS: [RegExp, string][] = [
  [/telegram/i, "Telegram"],
  [/whats\s?app/i, "WhatsApp"],
  [/correo|mail|gmail|casilla/i, "Correo de la empresa"],
  [/google|drive|planilla|sheets|agenda|calendar|docs|documento/i, "Google: Planillas, Drive, Agenda y Documentos"],
  [/slack/i, "Slack"],
  [/mercado\s?pago/i, "Mercado Pago"],
  [/instagram|\big\b/i, "Instagram"],
];
const CONNECTION_LABELS = new Set(CONNECTIONS.map((c) => c.label));

function canonicalConnection(raw: string): string | null {
  if (CONNECTION_LABELS.has(raw)) return raw;
  for (const [re, label] of CONNECTION_KEYWORDS) if (re.test(raw)) return label;
  return null;
}

const FIT_VALUES = ["buena", "parcial", "todavia-no"] as const;
type Fit = (typeof FIT_VALUES)[number];

type Teardown = {
  headline: string;
  automation_fit: Fit;
  recommended: string;
  capabilities: { name: string; why: string }[];
  integrations: string[];
  nunca: string;
  pilot: string;
  kpi: string;
  honesty: string;
};

/* The prompt carries the SHAPE of the offer and the closed catalog; it never
 * carries a price. The teardown is the FREE top of the funnel and doesn't
 * quote: what the visitor's case costs comes out of the free cotización that
 * follows it, and the one published number is on the page (app/pricing.ts). */
const SYSTEM = `Sos el motor de "teardown de workflow" de tuagente.uy, una empresa uruguaya que instala UN agente de IA adentro de cada empresa de LATAM. Un visitante te va a contar una tarea que le come el día y vos le devolvés, al toque, qué le armaríamos.

Cómo trabajamos, y no te salgas de esto:
- UN agente por empresa. El cliente lo bautiza, le elige la cara y le habla a él. Está aislado adentro de la empresa, con su propia clave.
- Lo que el agente sabe hacer son plugins, cada uno escrito con el proceso de esa empresa adentro. Se empieza con uno y se suman después.
- Contesta solo los mensajes de WhatsApp e Instagram, con las reglas del cliente; lo que no sabe o no le toca se lo deja al dueño con una nota. Lo que lo compromete (un mail, un posteo, un presupuesto) espera su ok. Los plugins que no existen los escribimos nosotros a medida.

${catalogPromptBlock()}

Reglas para armar el teardown:
- Recomendá SOLO capacidades de la lista, por su nombre exacto. Si lo que necesita el visitante no está, decilo derecho: es un plugin a medida que le escribimos (eso es parte de lo que hacemos, no una capacidad inventada).
- Las integraciones tienen que salir de la lista cerrada. Si hace falta conectar algo que no está, va como conexión a medida.
- Rioplatense neutral (vos, tenés, mirá). Claro y sin humo: nada de "potenciá", "revolucioná", "solución integral". Frases cortas.
- NUNCA digas un número de precio, ni "desde", ni un rango. La plata se ve en la cotización, que es gratis.
- Sé honesto: si automatizar esto todavía no conviene (poco volumen, el proceso no está definido, hay que decidir con criterio humano), poné automation_fit en "todavia-no" y explicá por qué en 'honesty'. Un teardown honesto vale más que uno que promete de más.
- El 'nunca' es una línea concreta del límite duro para ESTE workflow, sacada de los límites que valen siempre.
- El piloto es lo más chico que ya sirve, con un número (kpi) con el que se mide si valió la pena.
- Devolvés el resultado ÚNICAMENTE llamando a la herramienta render_teardown. No escribas texto suelto.`;

/* OpenAI/OpenRouter tool shape: {type:"function", function:{name, description, parameters}}.
 * `parameters` is the JSON Schema the model fills in (Anthropic called this `input_schema`). */
const TOOL = {
  type: "function",
  function: {
    name: "render_teardown",
    description: "Devolvé el teardown del workflow del visitante, estructurado, para que se muestre en la página.",
    parameters: {
      type: "object",
      properties: {
        headline: {
          type: "string",
          description: "Una línea que le devuelve su workflow en tus palabras, en rioplatense. Sin saludos.",
        },
        automation_fit: {
          type: "string",
          enum: ["buena", "parcial", "todavia-no"],
          description: "Qué tan claro es que conviene automatizar esto: buena, parcial o todavia-no.",
        },
        recommended: {
          type: "string",
          description: "1 a 2 oraciones: el agente y el plugin que le escribiríamos primero para este workflow.",
        },
        capabilities: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "El nombre EXACTO de una capacidad de la lista." },
              why: { type: "string", description: "En una línea, por qué sirve para ESTE workflow." },
            },
            required: ["name", "why"],
          },
          description: "De 2 a 4 capacidades de la lista que cubren el workflow.",
        },
        integrations: {
          type: "array",
          items: { type: "string" },
          description: "Integraciones de la lista cerrada que hay que conectar. Vacío si no hace falta ninguna.",
        },
        nunca: { type: "string", description: "Una línea: el límite duro para este workflow (qué NO va a hacer)." },
        pilot: { type: "string", description: "El piloto más chico y útil para arrancar." },
        kpi: { type: "string", description: "El número con el que se mide si el piloto sirvió." },
        honesty: {
          type: "string",
          description: "Una línea honesta: si todavía no conviene automatizar, por qué; si conviene, la salvedad más importante.",
        },
      },
      required: ["headline", "automation_fit", "recommended", "capabilities", "integrations", "nunca", "pilot", "kpi", "honesty"],
    },
  },
};

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

/* A whole-field value the model drops into a required slot it considers N/A.
 * Collapse it to "" so the modal can omit the row instead of showing it. */
const PLACEHOLDER_RE = /^(unknown|n\/?a\.?|-{1,3}|–|—)$/i;

/* Cleanup for a model-filled string field. On unfit/nonsense inputs the model
 * sometimes appends tag debris (a stray "</invoke>", a garbled "</anesty>") or
 * fills a required field with a placeholder ("<UNKNOWN>", "N/A", "-"). Measured
 * on a live OpenRouter run. Strip any XML/HTML-ish tag run (which also covers
 * the trailing /<\/?[a-z][^>]*>\s*$/i case) and collapse a placeholder to "".
 * Pure string cleanup: no shape change, no invented content. */
function clean(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  const stripped = v.replace(/<\/?[a-z][^>]*>/gi, "").trim();
  if (PLACEHOLDER_RE.test(stripped)) return "";
  return stripped.slice(0, max);
}

function normalize(input: any): Teardown | null {
  const headline = clean(input?.headline, 240);
  const recommended = clean(input?.recommended, 500);
  const nunca = clean(input?.nunca, 300);
  const pilot = clean(input?.pilot, 400);
  const kpi = clean(input?.kpi, 200);
  const honesty = clean(input?.honesty, 400);

  const fit: Fit = FIT_VALUES.includes(input?.automation_fit) ? input.automation_fit : "parcial";

  /* A usable teardown needs its path's core field: the honest read when it's
   * not worth automating yet, otherwise the recommendation. The rest can come
   * back empty — placeholders collapse to "" above and the modal omits empty
   * rows — so requiring pilot/nunca here would reject a clean unfit result. */
  if (fit === "todavia-no" ? !honesty : !recommended) return null;

  const capabilities = Array.isArray(input?.capabilities)
    ? input.capabilities
        .map((c: any) => ({ name: str(c?.name, 120), why: clean(c?.why, 240) }))
        .filter((c: { name: string; why: string }) => c.name)
        .slice(0, 4)
    : [];

  const rawInts: unknown[] = Array.isArray(input?.integrations) ? input.integrations : [];
  const integrations = Array.from(
    new Set(
      rawInts
        .map((x) => canonicalConnection(str(x, 120)))
        .filter((x): x is string => !!x)
    )
  ).slice(0, 5);

  return { headline, automation_fit: fit, recommended, capabilities, integrations, nunca, pilot, kpi, honesty };
}

/* Fire-and-forget lead email to Luis. Degrades to a console log if Resend isn't
 * configured yet — a missing key must never cost the visitor their teardown. */
async function sendLead(email: string, workflow: string, teardown: Teardown) {
  const key = process.env.RESEND_API_KEY;
  const to = process.env.LEAD_TO || "luisgurmendez@gmail.com";
  const from = process.env.LEAD_FROM || "tuagente.uy <onboarding@resend.dev>";
  const at = new Date().toISOString();

  const lead = { email, workflow, teardown, at };

  if (!key) {
    console.log("[teardown lead] (no RESEND_API_KEY — logging instead)", JSON.stringify(lead));
    return;
  }

  const caps = teardown.capabilities.map((c) => `- ${c.name}: ${c.why}`).join("\n");
  const text = [
    `Nuevo teardown de workflow — ${at}`,
    ``,
    `Email: ${email}`,
    ``,
    `Workflow que contó:`,
    workflow,
    ``,
    `— Teardown generado —`,
    `Encabezado: ${teardown.headline}`,
    `Encaje: ${teardown.automation_fit}`,
    `Recomendado: ${teardown.recommended}`,
    ``,
    `Capacidades:`,
    caps || "(ninguna)",
    ``,
    `Integraciones: ${teardown.integrations.join(", ") || "(ninguna)"}`,
    `Nunca: ${teardown.nunca}`,
    `Piloto: ${teardown.pilot}`,
    `KPI: ${teardown.kpi}`,
    `Honestidad: ${teardown.honesty}`,
  ].join("\n");

  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        from,
        to: [to],
        reply_to: email,
        subject: `Teardown: ${email}`,
        text,
      }),
    });
    if (!r.ok) console.error(`[teardown lead] resend ${r.status}`, await r.text().catch(() => ""));
  } catch (e) {
    console.error("[teardown lead] resend failed", e);
  }
}

export async function POST(req: NextRequest) {
  // Validate the request first: a malformed request is a 400 regardless of how
  // the server is configured.
  let body: { email?: string; workflow?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  const workflow = typeof body.workflow === "string" ? body.workflow.trim() : "";

  if (!EMAIL_RE.test(email) || email.length > 254) {
    return NextResponse.json({ error: "invalid email" }, { status: 400 });
  }
  if (!workflow) {
    return NextResponse.json({ error: "empty workflow" }, { status: 400 });
  }
  if (workflow.length > MAX_WORKFLOW_CHARS) {
    return NextResponse.json({ error: "workflow too long" }, { status: 400 });
  }

  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    // Local dev without a key: tell the modal to show the WhatsApp fallback.
    return NextResponse.json(
      { error: "unavailable", message: "El teardown en vivo no está disponible ahora mismo." },
      { status: 503 }
    );
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (throttled(ip)) {
    return NextResponse.json({ error: "rate limited" }, { status: 429 });
  }

  let teardown: Teardown | null = null;
  try {
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
        "HTTP-Referer": "https://tuagente.uy",
        "X-Title": "tuagente",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_OUTPUT_TOKENS,
        tools: [TOOL],
        tool_choice: { type: "function", function: { name: "render_teardown" } },
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: `Este es el workflow que quiero mejorar:\n\n${workflow}` },
        ],
      }),
    });
    if (!r.ok) throw new Error(`openrouter ${r.status}`);
    const data = await r.json();
    // Forced tool call: the structured teardown comes back as a JSON string in
    // tool_calls[].function.arguments — parse it before normalizing.
    for (const call of data.choices?.[0]?.message?.tool_calls ?? []) {
      if (call.function?.name === "render_teardown") {
        let input: any = {};
        try {
          input = JSON.parse(call.function?.arguments || "{}");
        } catch {
          input = {};
        }
        teardown = normalize(input);
        break;
      }
    }
  } catch (e) {
    console.error("[teardown]", e);
    return NextResponse.json(
      { error: "generation failed", message: "No pude armar el teardown ahora mismo." },
      { status: 502 }
    );
  }

  if (!teardown) {
    return NextResponse.json(
      { error: "generation failed", message: "No pude armar el teardown ahora mismo." },
      { status: 502 }
    );
  }

  // Best-effort lead capture; never blocks or fails the visitor's result.
  await sendLead(email, workflow, teardown);

  return NextResponse.json({ teardown });
}
