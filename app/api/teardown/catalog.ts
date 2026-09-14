/**
 * Compact grounding snapshot for the workflow-teardown model.
 *
 * WHY THIS FILE EXISTS AS A COPY. The source of truth is
 * `kit/capabilities/catalog.json` and `kit/connections/catalog.json`,
 * but the kit is kept out of the Vercel deploy (`.vercelignore`) and out of the
 * TypeScript build (`tsconfig.json` excludes `kit`), so the serverless
 * function can neither read those files at runtime nor import them at build time.
 * This is a hand-trimmed snapshot of the CLIENT-FACING fields only (label,
 * group, and a one-line `does` derived from `purpose`) plus the closed
 * connections list. When the kit's catalogs change, re-sync this file.
 *
 * The values are the catalog's own Spanish labels/descriptions on purpose: per
 * the repo's language rule, catalog VALUES that are labels or descriptions stay
 * Spanish (they are copy the client reads). Everything around them is code.
 *
 * These are the ONLY capabilities and integrations the product sells. The model
 * is told to recommend by these names and never to invent a feature. Anything a
 * client needs that is not here is an honest "custom plugin we write" — which is
 * true and is part of the offer, not an invented capability.
 */

export type Capability = { label: string; group: string; does: string };
export type Connection = { label: string; does: string };

/** Human labels for the catalog's group keys (used to organize the prompt). */
export const GROUP_LABELS: Record<string, string> = {
  administration: "Administración y plata",
  audio: "Audio",
  content: "Contenido y redes",
  "customer-service": "Atención al cliente",
  "documents-and-data": "Documentos y datos",
  information: "Información y búsqueda",
};

/**
 * The closed capability catalog (menu + base), snapshot of
 * kit/capabilities/catalog.json. `does` is a trimmed one-liner.
 */
export const CAPABILITIES: Capability[] = [
  { label: "Cálculos, planillas y documentos", group: "documents-and-data", does: "hace las cuentas y arma la planilla, el Word o el PDF con tus datos" },
  { label: "Ver lo que le mandás", group: "documents-and-data", does: "lee la foto de una factura, una captura o un PDF escaneado" },
  { label: "Buscar en internet", group: "information", does: "busca y lee páginas para responder con datos de hoy" },
  { label: "Audios a texto", group: "audio", does: "pasa a texto un audio de WhatsApp o la grabación de una reunión" },
  { label: "Presupuestos y cotizaciones al toque", group: "administration", does: "arma el presupuesto con tu formato y tus precios, listo para mandar" },
  { label: "Cargar facturas", group: "administration", does: "la foto o el PDF de la factura entra solo a tu planilla; vos confirmás antes de que quede escrito" },
  { label: "Cobranzas al día", group: "administration", does: "sabe quién te debe, desde cuándo y por cuánto, y deja escrito el mensaje para cobrar" },
  { label: "Tus redes con tu identidad", group: "content", does: "posteos con tu voz e imágenes con tu marca, en la medida de cada red; se vende como paquete con el kit de marca" },
  { label: "Tus entrevistas, listas para el aire", group: "content", does: "de cada entrevista saca los zócalos o el titular y el copy, listos para publicar" },
  { label: "Tus carpetas de Drive como bandeja", group: "information", does: "levanta solo el material nuevo que dejás en una carpeta de Drive" },
  { label: "Minutas de reuniones", group: "audio", does: "de la grabación saca qué se acordó, qué quedó pendiente y de quién" },
  { label: "Respuestas de tu negocio", group: "customer-service", does: "contesta siempre igual las preguntas de siempre (precios, horarios, envíos, garantía) con lo que vos decís" },
  { label: "Vigilar páginas", group: "information", does: "mira todos los días las páginas que te importan y avisa cuando algo cambia" },
  { label: "Licitaciones y compras estatales", group: "information", does: "avisa cuando sale un llamado del Estado que te sirve, con qué piden y cuándo cierra" },
  { label: "Tu catálogo en tus canales", group: "content", does: "arma y mantiene al día el catálogo donde vendés, sin contradicciones entre canales" },
  { label: "Ficha de cada cliente", group: "customer-service", does: "se acuerda de qué compró cada cliente, qué le prometiste y de qué hablaron" },
  { label: "Qué dicen tus números", group: "documents-and-data", does: "de tu planilla de ventas o gastos dice qué subió, qué bajó y qué mirar, con el gráfico" },
  { label: "Stock con alertas", group: "administration", does: "lleva el stock en una planilla y avisa antes de que te quedes sin lo que más vendés" },
  { label: "Documentos desde tus modelos", group: "documents-and-data", does: "completa tu modelo de contrato, remito o nota con los datos de cada caso" },
  { label: "Informes con tu identidad", group: "documents-and-data", does: "entrega los informes con tus colores, tu logo y tu tipografía" },
  { label: "Fotos de producto listas", group: "content", does: "deja tus fotos de producto con recorte parejo y la medida de cada canal; son tus fotos, no inventadas" },
  { label: "Dossier de una empresa", group: "information", does: "antes de la reunión arma la ficha de la empresa: a qué se dedica, quién la maneja y qué se dijo" },
  { label: "Contenido para LinkedIn", group: "content", does: "escribe para LinkedIn con su forma: más texto, otro tono, sin los hashtags de Instagram" },
  { label: "Extracto contra planilla", group: "administration", does: "cruza el extracto del banco con tu planilla y marca lo que no coincide" },
  { label: "Aguinaldo, licencia y aportes", group: "administration", does: "calcula aguinaldo, licencia, salario vacacional o aportes con los números que rigen hoy, y muestra de dónde sale cada cifra" },
  { label: "Presentaciones", group: "documents-and-data", does: "arma la presentación con tus datos y tu identidad, lista para proyectar" },
  { label: "Agenda de turnos", group: "administration", does: "toma los turnos, los pone en tu agenda y le recuerda a cada uno el día antes" },
];

/**
 * The closed connections catalog, snapshot of
 * kit/connections/catalog.json. These are the integrations a workflow
 * can rely on today; anything else is a custom connection we write.
 */
export const CONNECTIONS: Connection[] = [
  { label: "Telegram", does: "hablarle al agente desde el celular, como a cualquier contacto" },
  { label: "Correo de la empresa", does: "recibir y contestar mails desde la casilla de la empresa" },
  { label: "WhatsApp", does: "que tus clientes le escriban al número de la empresa y conteste (requiere verificación de Meta, lleva días)" },
  { label: "Google: Planillas, Drive, Agenda y Documentos", does: "leer y actualizar planillas, guardar archivos en Drive, mirar la agenda" },
  { label: "Slack", does: "que el equipo le hable desde los canales donde ya trabaja" },
  { label: "Mercado Pago", does: "ver tus cobros: cuánto entró, quién no pagó y qué quedó pendiente" },
  { label: "Instagram", does: "leer lo que ya publicaste y, si lo habilitás, publicar" },
];

/**
 * Global guardrails that hold across every workflow, snapshot of the
 * NON-NEGOTIABLE notes in the catalog. The model turns these into ONE concrete
 * "nunca" line for the recommended workflow.
 */
export const GUARDRAILS: string[] = [
  "Nada sale para afuera (un mail, un posteo, un presupuesto) sin la aprobación del cliente.",
  "Nunca inventa un precio, una fecha ni un dato: si no lo tiene escrito, lo deja marcado para que lo confirme el cliente.",
  "Lo que toca plata o algo legal es de solo lectura o pasa por una persona: mira, ordena y avisa, pero no factura, no paga y no presenta ante DGI.",
  "La carga de facturas y datos sensibles la confirma una persona antes de que quede escrita.",
  "Vive aislado adentro de la empresa del cliente, con su propia clave; sus datos no entrenan ningún modelo.",
];

/** Build the compact catalog block for the system prompt. */
export function catalogPromptBlock(): string {
  const byGroup: Record<string, Capability[]> = {};
  for (const c of CAPABILITIES) (byGroup[c.group] ??= []).push(c);

  const caps = Object.entries(byGroup)
    .map(([group, list]) => {
      const heading = GROUP_LABELS[group] ?? group;
      const rows = list.map((c) => `  - ${c.label}: ${c.does}`).join("\n");
      return `${heading}:\n${rows}`;
    })
    .join("\n");

  const conns = CONNECTIONS.map((c) => `  - ${c.label}: ${c.does}`).join("\n");
  const rules = GUARDRAILS.map((g) => `  - ${g}`).join("\n");

  return [
    "CAPACIDADES QUE VENDEMOS (elegí de acá por su nombre exacto; no inventes otras):",
    caps,
    "",
    "INTEGRACIONES QUE YA VIENEN LISTAS (para lo demás escribimos la conexión a medida):",
    conns,
    "",
    "LÍMITES QUE VALEN SIEMPRE (de acá sale el 'nunca'):",
    rules,
  ].join("\n");
}
