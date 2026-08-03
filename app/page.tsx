import Image from "next/image";
import {
  ArrowRight,
  Bot,
  Check,
  ChevronDown,
  Clock,
  Eye,
  FileText,
  Headphones,
  Megaphone,
  MessageCircle,
  Package,
  Pause,
  Plug,
  Receipt,
  SlidersHorizontal,
  Rocket,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Trophy,
  Zap,
} from "lucide-react";
import Reveal from "./Reveal";
import CountUp from "./CountUp";

const WHATSAPP = "https://wa.me/59899002835";
const EMAIL = "mailto:hola@tuagente.uy";

export default function Page() {
  return (
    <main className="overflow-x-hidden">
      <Header />
      <Hero />
      <Cards />
      <Reveal><Stats /></Reveal>
      <Steps />
      <UseCases />
      <Control />
      <Integrations />
      <Pricing />
      <Reveal><Proof /></Reveal>
      <Faq />
      <Reveal><FinalCta /></Reveal>
      <Footer />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
      />
    </main>
  );
}

/* ─────────────────────────────────────────── Header */

function Header() {
  return (
    <header className="sticky top-0 z-50 mx-auto flex max-w-7xl items-center justify-between px-5 py-4 sm:px-8">
      <div className="flex items-center gap-2 rounded-pill bg-white/70 px-4 py-2 backdrop-blur">
        <span className="grid h-7 w-7 place-items-center rounded-xl bg-primary text-white">
          <Bot size={17} />
        </span>
        <span className="text-lg font-extrabold tracking-tight text-ink">
          tuagente<span className="text-primary">.uy</span>
        </span>
      </div>
      <nav className="hidden items-center gap-1 rounded-pill bg-white/70 px-2 py-1 text-sm font-bold text-ink-soft backdrop-blur md:flex">
        {[
          ["Cómo funciona", "#como-funciona"],
          ["Casos", "#casos"],
          ["Planes", "#planes"],
          ["FAQ", "#faq"],
          ["Blog", "/blog"],
        ].map(([label, href]) => (
          <a
            key={href}
            href={href}
            className="rounded-pill px-4 py-1.5 transition hover:bg-primary/10 hover:text-primary"
          >
            {label}
          </a>
        ))}
      </nav>
      <a
        href={WHATSAPP}
        target="_blank"
        rel="noopener noreferrer"
        className="rounded-pill bg-ink px-5 py-2.5 text-sm font-bold text-white shadow-soft transition hover:-translate-y-0.5 hover:bg-primary"
      >
        Agendá una demo
      </a>
    </header>
  );
}

/* ─────────────────────────────────────────── Hero */

function Hero() {
  return (
    <section className="aurora relative">
      <div className="mx-auto max-w-5xl px-5 pb-16 pt-14 text-center sm:px-8 sm:pb-24 sm:pt-20">
        <span className="animate-fadeup inline-flex items-center gap-2 rounded-pill border border-primary/20 bg-white/70 px-4 py-1.5 text-sm font-bold text-primary backdrop-blur">
          <Trophy size={15} /> La #1 en agentes de IA de LATAM
        </span>

        <h1
          className="animate-fadeup mx-auto mt-7 max-w-4xl text-5xl font-extrabold leading-[1.05] tracking-tight text-ink sm:text-7xl"
          style={{ animationDelay: "80ms" }}
        >
          Agentes de IA que trabajan{" "}
          <span className="text-primary">solos</span>, adentro de tu empresa.
        </h1>

        <p
          className="animate-fadeup mx-auto mt-6 max-w-2xl text-lg text-ink-soft sm:text-xl"
          style={{ animationDelay: "180ms" }}
        >
          Los configuramos, los conectamos a tus sistemas y los dejamos corriendo{" "}
          <strong className="text-ink">24/7</strong>. Sin equipo técnico, sin dolores de cabeza.
          Vos mirás los resultados.
        </p>

        <div
          className="animate-fadeup mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row"
          style={{ animationDelay: "280ms" }}
        >
          <a
            href={WHATSAPP}
            target="_blank"
            rel="noopener noreferrer"
            className="group inline-flex w-full items-center justify-center gap-2 rounded-pill bg-primary px-7 py-4 text-base font-bold text-white shadow-lift transition hover:-translate-y-0.5 hover:bg-primary-dark sm:w-auto"
          >
            Agendá una demo gratis
            <ArrowRight size={19} className="transition group-hover:translate-x-1" />
          </a>
          <a
            href="#como-funciona"
            className="inline-flex w-full items-center justify-center gap-2 rounded-pill border border-ink/10 bg-white px-7 py-4 text-base font-bold text-ink shadow-soft transition hover:-translate-y-0.5 sm:w-auto"
          >
            Ver cómo funciona
          </a>
        </div>

        <p
          className="animate-fadeup mt-6 text-sm font-medium text-ink-soft"
          style={{ animationDelay: "380ms" }}
        >
          +150 agentes desplegados · empresas líderes de toda la región
        </p>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────── Big tonal cards */

const CARDS = [
  {
    Icon: Clock,
    title: "Trabajan 24/7",
    body: "Tu agente no duerme, no se enferma y no renuncia. Opera en piloto automático mientras vos hacés otra cosa.",
    bg: "bg-c-violet",
    ink: "text-c-violet-ink",
  },
  {
    Icon: Plug,
    title: "Conectados a lo tuyo",
    body: "Se enchufan a tu CRM, tu base de datos y tus sistemas internos. Actúan de verdad — no solo chatean.",
    bg: "bg-c-green",
    ink: "text-c-green-ink",
  },
  {
    Icon: Rocket,
    title: "Listos en semanas",
    body: "De la idea a producción en semanas, no en meses. Nos ocupamos de todo, vos no tocás una línea de código.",
    bg: "bg-c-coral",
    ink: "text-c-coral-ink",
  },
  {
    Icon: Trophy,
    title: "El equipo #1 de LATAM",
    body: "Somos los que más agentes pusieron a trabajar en la región. Estás en las mejores manos de Latinoamérica.",
    bg: "bg-c-amber",
    ink: "text-c-amber-ink",
  },
];

function Cards() {
  return (
    <section className="mx-auto max-w-7xl px-5 py-10 sm:px-8 sm:py-16">
      <div className="grid gap-5 sm:grid-cols-2">
        {CARDS.map(({ Icon, title, body, bg, ink }, i) => (
          <Reveal key={title} delay={i * 90} className="h-full">
            <article
              className={`${bg} ${ink} group h-full rounded-card p-8 transition duration-300 hover:-translate-y-1.5 sm:p-10`}
            >
              <span className="grid h-14 w-14 place-items-center rounded-2xl bg-white/60">
                <Icon size={28} />
              </span>
              <h3 className="mt-6 text-3xl font-extrabold tracking-tight">{title}</h3>
              <p className="mt-3 max-w-md text-lg opacity-80">{body}</p>
            </article>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────── Hype stats */

const STATS: {
  l: string;
  value?: number;
  prefix?: string;
  suffix?: string;
  static?: string;
}[] = [
  { prefix: "+", value: 150, l: "agentes desplegados" },
  { value: 40, suffix: "+", l: "empresas en LATAM" },
  { static: "24/7", l: "operando sin parar" },
  { value: 3, suffix: "×", l: "más productividad" },
];

function Stats() {
  return (
    <section className="mx-auto max-w-7xl px-5 sm:px-8">
      <div className="rounded-card bg-c-ink px-6 py-12 text-white sm:px-12">
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
          {STATS.map((s) => (
            <div key={s.l} className="text-center">
              <div className="text-4xl font-extrabold tracking-tight sm:text-6xl">
                {s.static ? (
                  s.static
                ) : (
                  <CountUp value={s.value!} prefix={s.prefix} suffix={s.suffix} />
                )}
              </div>
              <div className="mt-2 text-sm font-medium text-white/60 sm:text-base">{s.l}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────── How it works */

const STEPS = [
  {
    Icon: MessageCircle,
    title: "Nos contás tu proceso",
    body: "Una sola llamada. Detectamos exactamente dónde un agente te ahorra plata y tiempo.",
  },
  {
    Icon: ShieldCheck,
    title: "Lo construimos y conectamos",
    body: "Armamos el agente sobre tus sistemas, con controles, permisos y seguridad de verdad.",
  },
  {
    Icon: Zap,
    title: "Corre solo",
    body: "Lo dejamos operando 24/7. Desde ese día, el trabajo pasa sin que nadie lo empuje.",
  },
];

function Steps() {
  return (
    <section id="como-funciona" className="mx-auto max-w-7xl px-5 py-16 sm:px-8 sm:py-24">
      <div className="mx-auto max-w-2xl text-center">
        <span className="inline-flex items-center gap-2 rounded-pill bg-primary/10 px-4 py-1.5 text-sm font-bold text-primary">
          <Sparkles size={15} /> Simple de verdad
        </span>
        <h2 className="mt-5 text-4xl font-extrabold tracking-tight text-ink sm:text-5xl">
          Tu agente, funcionando en 3 pasos
        </h2>
      </div>

      <div className="mt-12 grid gap-5 md:grid-cols-3">
        {STEPS.map(({ Icon, title, body }, i) => (
          <Reveal key={title} delay={i * 120} className="h-full">
            <article className="h-full rounded-card border border-ink/5 bg-white p-8 shadow-soft">
              <div className="flex items-center gap-3">
                <span className="grid h-11 w-11 place-items-center rounded-2xl bg-primary text-white">
                  <Icon size={20} />
                </span>
                <span className="text-sm font-extrabold text-primary">PASO {i + 1}</span>
              </div>
              <h3 className="mt-5 text-2xl font-extrabold tracking-tight text-ink">{title}</h3>
              <p className="mt-2 text-lg text-ink-soft">{body}</p>
            </article>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────── Use cases */

const USE_CASES = [
  {
    Icon: TrendingUp,
    title: "Agente de ventas",
    body: "Califica leads, responde consultas, agenda reuniones y deja tu CRM al día. Solo.",
  },
  {
    Icon: Headphones,
    title: "Agente de soporte",
    body: "Atiende WhatsApp y mail las 24 hs. Resuelve lo repetitivo y escala a un humano solo cuando hace falta.",
  },
  {
    Icon: Receipt,
    title: "Agente de cobranzas",
    body: "Persigue facturas vencidas, manda recordatorios con buena onda y concilia pagos contra tu contabilidad.",
  },
  {
    Icon: Package,
    title: "Agente de operaciones",
    body: "Controla stock, genera órdenes de compra y te avisa antes de que algo se rompa en la logística.",
  },
  {
    Icon: FileText,
    title: "Agente de back-office",
    body: "Lee PDFs, facturas y mails, extrae los datos y los carga prolijos en tus sistemas. Cero tipeo manual.",
  },
  {
    Icon: Megaphone,
    title: "Agente de contenido",
    body: "Redacta publicaciones, responde comentarios y mantiene tus redes y tu blog vivos todos los días.",
  },
];

function UseCases() {
  return (
    <section id="casos" className="mx-auto max-w-7xl px-5 py-6 sm:px-8 sm:py-10">
      <div className="mx-auto max-w-2xl text-center">
        <span className="inline-flex items-center gap-2 rounded-pill bg-primary/10 px-4 py-1.5 text-sm font-bold text-primary">
          <Bot size={15} /> Agentes reales, trabajo real
        </span>
        <h2 className="mt-5 text-4xl font-extrabold tracking-tight text-ink sm:text-5xl">
          ¿Qué puede hacer tu agente?
        </h2>
        <p className="mt-4 text-lg text-ink-soft">
          Cualquier proceso repetitivo que hoy hace una persona con una computadora, lo puede hacer
          un agente. Estos son los que más pedidos tienen:
        </p>
      </div>

      <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {USE_CASES.map(({ Icon, title, body }, i) => (
          <Reveal key={title} delay={(i % 3) * 90} className="h-full">
            <article className="group h-full rounded-card border border-ink/5 bg-white p-7 shadow-soft transition duration-300 hover:-translate-y-1">
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-primary/10 text-primary transition group-hover:bg-primary group-hover:text-white">
                <Icon size={23} />
              </span>
              <h3 className="mt-5 text-xl font-extrabold tracking-tight text-ink">{title}</h3>
              <p className="mt-2 text-ink-soft">{body}</p>
            </article>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────── Control (you stay in charge) */

const CONTROL_POINTS = [
  {
    Icon: MessageCircle,
    title: "Chateá con tu agente",
    body: "Le hablás por WhatsApp o Slack como a un empleado más: le pedís tareas, le preguntás qué hizo y te responde al momento.",
  },
  {
    Icon: SlidersHorizontal,
    title: "Lo ajustás hablándole",
    body: "¿Querés que salude distinto o priorice otra cosa? Se lo decís y cambia. Sin proyecto, sin código, sin esperar a nadie.",
  },
  {
    Icon: Eye,
    title: "Ves todo lo que hace",
    body: "Cada acción queda registrada y te llega un reporte claro. Cero cajas negras: siempre sabés qué hizo y por qué.",
  },
  {
    Icon: Pause,
    title: "Lo frenás con un botón",
    body: "Pausa inmediata cuando quieras. Y las acciones sensibles — pagos, mails a clientes — siempre pasan por tu aprobación.",
  },
];

function Control() {
  return (
    <section id="control" className="mx-auto max-w-7xl px-5 py-10 sm:px-8 sm:py-16">
      <Reveal>
        <div className="rounded-card bg-c-amber px-6 py-12 sm:px-12 sm:py-16">
          <div className="grid items-center gap-10 lg:grid-cols-2">
            <div>
              <span className="inline-flex items-center gap-2 rounded-pill bg-white/60 px-4 py-1.5 text-sm font-bold text-c-amber-ink">
                <ShieldCheck size={15} /> Cero cajas negras
              </span>
              <h2 className="mt-5 text-4xl font-extrabold tracking-tight text-c-amber-ink sm:text-5xl">
                ¿Y quién controla al agente? <span className="underline decoration-4 underline-offset-4">Vos.</span>
              </h2>
              <p className="mt-4 max-w-lg text-lg text-c-amber-ink/80">
                Autónomo no significa descontrolado. Tu agente trabaja solo, pero vos lo dirigís
                como a cualquier persona de tu equipo — hablándole.
              </p>
              <div className="mt-8 grid gap-5 sm:grid-cols-2">
                {CONTROL_POINTS.map(({ Icon, title, body }) => (
                  <div key={title}>
                    <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/60 text-c-amber-ink">
                      <Icon size={19} />
                    </span>
                    <h3 className="mt-3 text-lg font-extrabold tracking-tight text-c-amber-ink">
                      {title}
                    </h3>
                    <p className="mt-1 text-sm text-c-amber-ink/75">{body}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Chat mock: the owner directing their agent */}
            <div className="mx-auto w-full max-w-md rounded-card bg-white p-5 shadow-lift sm:p-6">
              <div className="flex items-center gap-3 border-b border-ink/5 pb-4">
                <span className="grid h-10 w-10 place-items-center rounded-2xl bg-primary text-white">
                  <Bot size={20} />
                </span>
                <div>
                  <p className="text-sm font-extrabold text-ink">Tu agente</p>
                  <p className="flex items-center gap-1.5 text-xs font-medium text-ink-soft">
                    <span className="h-2 w-2 rounded-full bg-c-green-ink" /> en línea · trabajando
                  </p>
                </div>
              </div>
              <div className="mt-4 space-y-3 text-sm">
                <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 font-medium text-white">
                  ¿Qué hiciste hoy?
                </div>
                <div className="w-fit max-w-[85%] rounded-2xl rounded-bl-md bg-surface px-4 py-2.5 text-ink shadow-soft">
                  Respondí 34 consultas, agendé 5 reuniones y dejé el CRM al día ✅ Tenés 2
                  facturas esperando tu aprobación.
                </div>
                <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 font-medium text-white">
                  Aprobá la primera. Y de ahora en más contestá más formal, ¿puede ser?
                </div>
                <div className="w-fit max-w-[85%] rounded-2xl rounded-bl-md bg-surface px-4 py-2.5 text-ink shadow-soft">
                  Hecho: factura aprobada y ya ajusté mi tono. ¿Algo más? 🫡
                </div>
              </div>
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

/* ─────────────────────────────────────────── Integrations */

const INTEGRATIONS = [
  "WhatsApp Business",
  "Gmail",
  "Google Sheets",
  "HubSpot",
  "Odoo",
  "Mercado Libre",
  "Slack",
  "Notion",
  "PostgreSQL",
  "APIs propias",
  "+ 50 más",
];

function Integrations() {
  return (
    <section className="mx-auto max-w-7xl px-5 py-6 sm:px-8">
      <Reveal>
        <div className="rounded-card bg-c-green px-6 py-10 text-center sm:px-12">
          <p className="text-sm font-bold uppercase tracking-wider text-c-green-ink/60">
            Se conecta con lo que ya usás
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
            {INTEGRATIONS.map((x) => (
              <span
                key={x}
                className="rounded-pill bg-white/70 px-5 py-2 text-sm font-extrabold text-c-green-ink/80"
              >
                {x}
              </span>
            ))}
          </div>
          <p className="mx-auto mt-6 max-w-xl text-sm font-medium text-c-green-ink/70">
            ¿Tu sistema no está en la lista? Escribimos la integración a medida. Esa es literalmente
            nuestra especialidad.
          </p>
        </div>
      </Reveal>
    </section>
  );
}

/* ─────────────────────────────────────────── Pricing */

const PLANS = [
  {
    name: "Starter",
    tag: "Tu primer agente",
    price: "USD 990",
    period: "setup · desde USD 190/mes",
    features: [
      "1 agente con 1 flujo automatizado",
      "Conectado a WhatsApp o mail",
      "Reporte semanal de lo que hizo",
      "Soporte directo por WhatsApp",
    ],
    cta: "Empezar con Starter",
    featured: false,
  },
  {
    name: "Pro",
    tag: "El más elegido",
    price: "USD 2.900",
    period: "setup · desde USD 490/mes",
    features: [
      "Agente conectado a tus sistemas (CRM, ERP, base de datos)",
      "Chat directo con tu agente por WhatsApp o Slack",
      "Flujos autónomos corriendo 24/7 en cronograma",
      "Aprobación humana para acciones sensibles",
      "Monitoreo, ajustes y mejoras todos los meses",
    ],
    cta: "Quiero el Pro",
    featured: true,
  },
  {
    name: "Flota",
    tag: "Para escalar en serio",
    price: "A medida",
    period: "varios agentes orquestados",
    features: [
      "Equipo de agentes trabajando en conjunto",
      "Integraciones ilimitadas",
      "SLA y soporte prioritario",
      "Roadmap de automatización trimestral",
    ],
    cta: "Hablemos de tu flota",
    featured: false,
  },
];

function Pricing() {
  return (
    <section id="planes" className="mx-auto max-w-7xl px-5 py-16 sm:px-8 sm:py-24">
      <div className="mx-auto max-w-2xl text-center">
        <span className="inline-flex items-center gap-2 rounded-pill bg-primary/10 px-4 py-1.5 text-sm font-bold text-primary">
          <Sparkles size={15} /> Sin sorpresas
        </span>
        <h2 className="mt-5 text-4xl font-extrabold tracking-tight text-ink sm:text-5xl">
          Cuánto cuesta tu agente
        </h2>
        <p className="mt-4 text-lg text-ink-soft">
          Mucho menos que un sueldo — y trabaja las 24 horas. Precios desde, según integraciones.
        </p>
      </div>

      <div className="mt-12 grid gap-5 md:grid-cols-3">
        {PLANS.map((p, i) => (
          <Reveal key={p.name} delay={i * 110} className="h-full">
            <article
              className={
                p.featured
                  ? "relative flex h-full flex-col rounded-card bg-primary p-8 text-white shadow-lift"
                  : "flex h-full flex-col rounded-card border border-ink/5 bg-white p-8 shadow-soft"
              }
            >
              {p.featured && (
                <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 rounded-pill bg-ink px-4 py-1.5 text-xs font-extrabold uppercase tracking-wider text-white">
                  {p.tag}
                </span>
              )}
              <p
                className={`text-sm font-bold uppercase tracking-wider ${
                  p.featured ? "text-white/70" : "text-primary"
                }`}
              >
                {p.name}
              </p>
              <div className="mt-4 text-4xl font-extrabold tracking-tight">{p.price}</div>
              <p className={`mt-1 text-sm font-medium ${p.featured ? "text-white/70" : "text-ink-soft"}`}>
                {p.period}
              </p>
              <ul className="mt-6 flex-1 space-y-3">
                {p.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5">
                    <span
                      className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full ${
                        p.featured ? "bg-white/20" : "bg-c-green"
                      }`}
                    >
                      <Check size={13} className={p.featured ? "text-white" : "text-c-green-ink"} />
                    </span>
                    <span className={p.featured ? "text-white/90" : "text-ink-soft"}>{f}</span>
                  </li>
                ))}
              </ul>
              <a
                href={WHATSAPP}
                target="_blank"
                rel="noopener noreferrer"
                className={`mt-8 inline-flex items-center justify-center gap-2 rounded-pill px-6 py-3.5 text-sm font-extrabold transition hover:-translate-y-0.5 ${
                  p.featured
                    ? "bg-white text-primary shadow-lift"
                    : "bg-ink text-white shadow-soft hover:bg-primary"
                }`}
              >
                {p.cta}
                <ArrowRight size={16} />
              </a>
            </article>
          </Reveal>
        ))}
      </div>

      <p className="mt-8 text-center text-sm font-medium text-ink-soft">
        La demo es gratis siempre: te mostramos con tu caso cuánto ahorra un agente antes de que
        pongas un peso.
      </p>
    </section>
  );
}

/* ─────────────────────────────────────────── FAQ */

const FAQS = [
  {
    q: "¿Qué es un agente de IA?",
    a: "Es software que usa un modelo de IA (como Claude o GPT) para ejecutar trabajo real: lee tus sistemas, decide qué hacer y lo hace. No es un chat al que hay que hablarle — es un empleado digital que corre solo, 24/7.",
  },
  {
    q: "¿En qué se diferencia de un chatbot?",
    a: "Un chatbot responde preguntas. Un agente actúa: entra a tu CRM, manda mails, genera facturas, actualiza planillas y ejecuta procesos completos con permisos controlados. El chatbot conversa; el agente trabaja.",
  },
  {
    q: "¿Por qué no usar ChatGPT o Claude directo?",
    a: "Porque esas herramientas necesitan que una persona las use: vos escribís, ellas responden. Un agente de tuagente corre flujos autónomos en un cronograma, conectado a tus sistemas con herramientas escritas a medida, sin que nadie lo empuje. Es la diferencia entre tener un asistente y tener un empleado.",
  },
  {
    q: "¿Cuánto cuesta?",
    a: "El plan Starter arranca en USD 990 de setup más una mensualidad desde USD 190. El Pro, conectado a tus sistemas, desde USD 2.900. Bastante menos que un sueldo — y la demo es gratis: ahí te damos el número exacto para tu caso.",
  },
  {
    q: "¿Cuánto demora estar funcionando?",
    a: "Entre 2 y 4 semanas para el primer agente, según cuántos sistemas haya que conectar. De la primera llamada a un agente en producción, semanas — no meses.",
  },
  {
    q: "¿A qué sistemas se conecta?",
    a: "CRM (HubSpot, Odoo), WhatsApp Business, Gmail, Google Sheets, Mercado Libre, bases de datos (PostgreSQL, MySQL) y cualquier sistema propio con API. Si no existe la integración, la escribimos nosotros a medida.",
  },
  {
    q: "¿Es seguro? ¿Qué pasa con mis datos?",
    a: "Cada agente opera con permisos acotados: solo ve y toca lo que le habilitás. Las acciones sensibles (pagos, borrados, mails a clientes) pasan por aprobación humana. Tus datos no se usan para entrenar ningún modelo.",
  },
  {
    q: "¿Puedo hablar con mi agente y modificarlo?",
    a: "Sí, y es de lo mejor que tiene. Cada agente viene con un canal de chat directo (WhatsApp o Slack): le preguntás qué hizo, le pedís tareas nuevas y le cambiás las instrucciones hablándole, como a un empleado. Y si algo no te cierra, lo pausás con un botón. Autonomía no significa perder el control.",
  },
  {
    q: "¿Dónde trabajan y quién está detrás?",
    a: "Atendemos toda Latinoamérica de forma remota, con base en Uruguay. tuagente es un producto de pdelabs, un estudio de ingeniería de software con años construyendo sistemas en producción — no somos una agencia de marketing que descubrió la IA el mes pasado.",
  },
];

function Faq() {
  return (
    <section id="faq" className="mx-auto max-w-4xl px-5 py-16 sm:px-8 sm:py-24">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="text-4xl font-extrabold tracking-tight text-ink sm:text-5xl">
          Preguntas frecuentes
        </h2>
        <p className="mt-4 text-lg text-ink-soft">
          Las dudas que nos llegan todos los días, respondidas sin vueltas.
        </p>
      </div>

      <div className="mt-12 space-y-4">
        {FAQS.map(({ q, a }, i) => (
          <Reveal key={q} delay={Math.min(i, 4) * 60}>
            <details className="group rounded-card border border-ink/5 bg-white p-6 shadow-soft open:shadow-lift sm:p-7">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-lg font-extrabold tracking-tight text-ink [&::-webkit-details-marker]:hidden">
                {q}
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/10 text-primary transition group-open:rotate-180">
                  <ChevronDown size={18} />
                </span>
              </summary>
              <p className="mt-4 text-ink-soft">{a}</p>
            </details>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────── Structured data (SEO / AEO) */

const JSON_LD = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "ProfessionalService",
      "@id": "https://tuagente.uy/#org",
      name: "tuagente.uy",
      url: "https://tuagente.uy",
      description:
        "Configuramos agentes de IA autónomos para empresas de Latinoamérica: conectados a tus sistemas, operando 24/7, listos en semanas.",
      slogan: "Agentes de IA que trabajan por vos",
      email: "hola@tuagente.uy",
      telephone: "+59899002835",
      priceRange: "USD 990 – USD 10.000+",
      address: {
        "@type": "PostalAddress",
        addressLocality: "Montevideo",
        addressCountry: "UY",
      },
      areaServed: ["Uruguay", "Argentina", "Chile", "México", "Latinoamérica"],
      parentOrganization: {
        "@type": "Organization",
        name: "pdelabs",
        url: "https://www.pdelabs.com",
      },
      knowsAbout: [
        "Agentes de IA",
        "Automatización de procesos",
        "Inteligencia artificial para empresas",
        "Integraciones a medida",
      ],
      makesOffer: PLANS.filter((p) => p.price.startsWith("USD")).map((p) => ({
        "@type": "Offer",
        name: `Plan ${p.name} — ${p.tag}`,
        price: p.price.replace("USD ", "").replace(".", ""),
        priceCurrency: "USD",
      })),
    },
    {
      "@type": "FAQPage",
      "@id": "https://tuagente.uy/#faq",
      mainEntity: FAQS.map(({ q, a }) => ({
        "@type": "Question",
        name: q,
        acceptedAnswer: { "@type": "Answer", text: a },
      })),
    },
  ],
};

/* ─────────────────────────────────────────── Social proof (placeholder) */

function Proof() {
  return (
    <section className="mx-auto max-w-7xl px-5 sm:px-8">
      <div className="rounded-card bg-c-violet px-6 py-14 text-center sm:px-12">
        <p className="text-sm font-bold uppercase tracking-wider text-c-violet-ink/60">
          Empresas líderes de LATAM ya confían en tuagente
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          {["Retail", "Fintech", "Salud", "Logística", "SaaS", "Agro"].map((x) => (
            <span
              key={x}
              className="rounded-pill bg-white/70 px-6 py-3 text-lg font-extrabold text-c-violet-ink/70"
            >
              {x}
            </span>
          ))}
        </div>
        <blockquote className="mx-auto mt-10 max-w-2xl text-2xl font-bold leading-snug tracking-tight text-c-violet-ink sm:text-3xl">
          &ldquo;En dos semanas teníamos un agente respondiendo y cerrando tareas que antes nos
          comían el día. No volvemos atrás.&rdquo;
        </blockquote>
        <p className="mt-4 text-sm font-semibold text-c-violet-ink/60">
          — Dirección de Operaciones, empresa de logística *
        </p>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────── Final CTA */

function FinalCta() {
  return (
    <section id="contacto" className="mx-auto max-w-7xl px-5 py-16 sm:px-8 sm:py-24">
      <div className="relative overflow-hidden rounded-card bg-primary px-6 py-16 text-center text-white sm:px-12 sm:py-24">
        <div className="animate-floaty pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-white/10 blur-2xl" />
        <div className="animate-floaty pointer-events-none absolute -bottom-20 -left-10 h-64 w-64 rounded-full bg-white/10 blur-2xl" style={{ animationDelay: "-3s" }} />
        <h2 className="relative mx-auto max-w-3xl text-4xl font-extrabold leading-tight tracking-tight sm:text-6xl">
          ¿Listo para tener tu primer agente trabajando?
        </h2>
        <p className="relative mx-auto mt-5 max-w-xl text-lg text-white/80">
          Agendá una demo gratis. Te mostramos, con tu caso, cuánto te ahorra un agente — antes de
          que pongas un peso.
        </p>
        <a
          href={WHATSAPP}
          target="_blank"
          rel="noopener noreferrer"
          className="group relative mt-9 inline-flex items-center justify-center gap-2 rounded-pill bg-white px-8 py-4 text-base font-extrabold text-primary shadow-lift transition hover:-translate-y-0.5"
        >
          Quiero mi agente
          <ArrowRight size={19} className="transition group-hover:translate-x-1" />
        </a>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────── Footer */

function Footer() {
  return (
    <footer className="border-t border-ink/5 bg-white">
      <div className="mx-auto flex max-w-7xl flex-col items-center gap-8 px-5 py-12 sm:flex-row sm:justify-between sm:px-8">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-xl bg-primary text-white">
            <Bot size={16} />
          </span>
          <span className="text-lg font-extrabold tracking-tight text-ink">
            tuagente<span className="text-primary">.uy</span>
          </span>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm font-semibold text-ink-soft">
          <a href="/blog" className="hover:text-primary">
            Blog
          </a>
          <a href={WHATSAPP} target="_blank" rel="noopener noreferrer" className="hover:text-primary">
            WhatsApp +598 99 002 835
          </a>
          <a href={EMAIL} className="hover:text-primary">
            hola@tuagente.uy
          </a>
          <span>Montevideo, Uruguay</span>
        </div>

        <a
          href="https://www.pdelabs.com"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2.5 rounded-pill border border-ink/10 px-4 py-2 transition hover:-translate-y-0.5"
        >
          <span className="text-xs font-medium text-ink-soft">Powered by</span>
          <Image src="/pdelabs-mark.svg" alt="pdelabs" width={22} height={22} />
          <span className="text-sm font-extrabold text-ink">pdelabs</span>
        </a>
      </div>
      <div className="mx-auto max-w-7xl px-5 pb-10 text-center text-xs text-ink-soft/70 sm:px-8">
        © {new Date().getFullYear()} tuagente.uy · Un producto de pdelabs. Hecho en Uruguay 🇺🇾
        <br />
        <span className="opacity-70">* Testimonios ilustrativos — reemplazar por casos reales.</span>
      </div>
    </footer>
  );
}
