import Image from "next/image";
import {
  ArrowRight,
  Ban,
  Bot,
  Check,
  ChevronDown,
  Clock,
  Dices,
  Eye,
  FileText,
  FolderOpen,
  Hand,
  Instagram,
  LayoutDashboard,
  MapPin,
  MessageCircle,
  Mic,
  Moon,
  Pause,
  PhoneCall,
  Puzzle,
  Receipt,
  SlidersHorizontal,
  ShieldCheck,
  Sparkles,
  Wrench,
  Zap,
} from "lucide-react";
import Reveal from "./Reveal";
import TeardownButton from "./teardown/TeardownButton";
import { AgentitoAvatar, AgentitoAnimated, type AgentitoLook } from "./app/lib/agentito";

const WHATSAPP = "https://wa.me/59899002835";
const EMAIL = "mailto:hola@tuagente.uy";

/* ─────────────────────────────────────────── Pricing
 *
 * The model decided by Luis on 2026-09-24, and the ONLY number the site
 * publishes: the monthly, with no setup fee, that already carries the agent
 * and its WhatsApp and Instagram replies. Every job added on top joins the
 * monthly at a price that is quoted (free) and never published; custom work
 * is paid once and half of it comes back as a discount on the monthly. It
 * repeats in the numbers, the pricing section, the FAQ, the final CTA and the
 * structured data — change it here and every place picks it up. */
const MONTHLY_USD = "90";
const MONTHLY = `USD ${MONTHLY_USD}`;

/** The guarantee, word for word wherever it shows. */
const GUARANTEE = "Si el primer mes no hizo lo que te dijimos, ese mes no lo pagás.";

export default function Page() {
  return (
    <main className="overflow-x-hidden">
      <Header />
      <Hero />
      <Cards />
      <Reveal><Stats /></Reveal>
      <Steps />
      <Jobs />
      <Baptism />
      <Control />
      <Portal />
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
          // #casos is the section id the widget and /api/agent already know.
          ["Qué le pedís", "#casos"],
          ["Tu portal", "#portal"],
          // The pricing section id stays #planes: a blog post links to
          // /#planes and we don't want to break it by renaming the anchor.
          ["Precio", "#planes"],
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
        Quiero mi agente
      </a>
    </header>
  );
}

/* ─────────────────────────────────────────── Hero */

function Hero() {
  return (
    <section className="aurora relative">
      <div className="mx-auto max-w-5xl px-5 pb-16 pt-14 text-center sm:px-8 sm:pb-24 sm:pt-20">
        {/* A "#1 in LATAM" claim from a brand the client doesn't know does not
            build trust — it discounts it. What's verifiable and what actually
            matters to whoever buys this in Uruguay is where we are and who's
            behind it. */}
        <span className="animate-fadeup inline-flex items-center gap-2 rounded-pill border border-primary/20 bg-white/70 px-4 py-1.5 text-sm font-bold text-primary backdrop-blur">
          <MapPin size={15} /> Hecho en Uruguay, para las empresas de acá
        </span>

        <h1
          className="animate-fadeup mx-auto mt-7 max-w-4xl text-5xl font-extrabold leading-[1.05] tracking-tight text-ink sm:text-7xl"
          style={{ animationDelay: "80ms" }}
        >
          Un agente de IA que trabaja{" "}
          <span className="text-primary">solo</span>, adentro de tu empresa.
        </h1>

        <p
          className="animate-fadeup mx-auto mt-6 max-w-2xl text-lg text-ink-soft sm:text-xl"
          style={{ animationDelay: "180ms" }}
        >
          Uno solo, con el nombre y la cara que vos le pongas. Le sumás{" "}
          <strong className="text-ink">lo que tu empresa necesita</strong> — hecho a medida — y
          trabaja <strong className="text-ink">24/7</strong>: contesta el WhatsApp de las once de
          la noche, arma el presupuesto, ordena las facturas. Lo que te compromete no sale sin tu ok.
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
            Quiero mi agente
            <ArrowRight size={19} className="transition group-hover:translate-x-1" />
          </a>
          {/* The free top of the funnel: type your workflow, get an instant
              teardown. Sits before the free cotización. */}
          <TeardownButton className="group inline-flex w-full items-center justify-center gap-2 rounded-pill border border-primary/30 bg-white px-7 py-4 text-base font-bold text-primary shadow-soft transition hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 sm:w-auto">
            <Sparkles size={18} />
            Probá gratis: contanos tu workflow
          </TeardownButton>
        </div>

        <p
          className="animate-fadeup mt-4 text-sm font-medium text-ink-soft"
          style={{ animationDelay: "340ms" }}
        >
          ¿Preferís mirar primero?{" "}
          <a href="#casos" className="font-bold text-primary underline underline-offset-4">
            Mirá qué le podés pedir
          </a>
        </p>

        <p
          className="animate-fadeup mt-4 text-sm font-medium text-ink-soft"
          style={{ animationDelay: "380ms" }}
        >
          Un agente por empresa, aislado y con su propia clave · vos ves todo lo que hace
        </p>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────── Big tonal cards */

const CARDS = [
  {
    Icon: Bot,
    title: "Uno solo, y es tuyo",
    body: "Le ponés nombre, le elegís la cara y le hablás a él. No hay organigrama que aprender ni herramienta nueva que usar: le escribís como le escribís a cualquiera que trabaja con vos.",
    bg: "bg-c-violet",
    ink: "text-c-violet-ink",
  },
  {
    Icon: Clock,
    title: "Trabaja 24/7",
    body: "No duerme, no se enferma y no renuncia. Lo que entra un domingo a la noche se contesta un domingo a la noche — que es cuando se pierden los turnos que nunca supiste que tenías.",
    bg: "bg-c-green",
    ink: "text-c-green-ink",
  },
  {
    Icon: Puzzle,
    title: "Con lo que TU empresa necesita",
    body: "Cada trabajo concreto es un plugin, escrito con tu proceso adentro. Algunos ya los tenemos y se adaptan; los que no existen los escribimos nosotros. Empezás con uno y sumás cuando lo pidas.",
    bg: "bg-c-coral",
    ink: "text-c-coral-ink",
  },
  {
    Icon: Eye,
    title: "Nada pasa a tus espaldas",
    body: "Tenés un portal donde ves qué hizo, qué está haciendo y qué produjo. Y lo que te compromete — un mail a un cliente, un posteo, un presupuesto — espera tu ok.",
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
              data-agent-card
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

// This used to be four numbers we couldn't back up (+150 agents, 40+
// companies, 3x productivity). A made-up number can't be defended in the
// first meeting, and the client buying this asks. What follows are four
// product facts, all verifiable against what actually gets delivered.
const STATS: { value: string; l: string; size?: string }[] = [
  { value: "24/7", l: "tu agente no para" },
  { value: MONTHLY, l: "por mes, sin costo de alta", size: "text-3xl sm:text-5xl" },
  { value: "1 a 1", l: "un agente por empresa, aislado" },
  { value: "Tu ok", l: "para todo lo que te compromete" },
];

function Stats() {
  return (
    <section className="mx-auto max-w-7xl px-5 sm:px-8">
      <div className="rounded-card bg-c-ink px-6 py-12 text-white sm:px-12">
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
          {STATS.map((s) => (
            <div key={s.l} className="text-center">
              <div
                className={`font-extrabold tracking-tight ${s.size ?? "text-4xl sm:text-6xl"}`}
              >
                {s.value}
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
    Icon: PhoneCall,
    title: "Nos contás qué te come las horas",
    body: "Por WhatsApp, o con el teardown gratis de acá arriba. Te decimos qué trabajo conviene sacarte de encima primero, si ya lo tenemos o hay que escribirlo, y cuánto queda el mensual. La cotización es gratis.",
  },
  {
    Icon: Wrench,
    title: "Armamos tu agente",
    body: `Lo instalamos adentro de tu empresa, con el nombre y la cara que elegiste, contestando tu WhatsApp y tu Instagram con tus reglas. Son ${MONTHLY} por mes, sin costo de alta. Cada trabajo que le sumes lleva tu proceso adentro: tus precios, tu tono, tu manera.`,
  },
  {
    Icon: Zap,
    title: "Trabaja solo",
    body: "Desde ese día el trabajo pasa sin que nadie lo empuje. Vos entrás al portal, mirás lo que hizo y aprobás lo que te compromete. Cuando querés otro trabajo resuelto, se lo sumás.",
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
          Tu agente, trabajando en 3 pasos
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

/* ─────────────────────────────────────────── What you ask it for (plugins) */

// Concrete jobs, not capabilities: the client recognizes "los turnos que
// perdés de noche", not "integración con WhatsApp Business API". Each one is
// a plugin — one we already have and adapt, or one we write from scratch —
// and each one carries its "never", because the limit written inside the
// plugin is the part that makes the rest believable.
const JOBS = [
  {
    Icon: Moon,
    title: "Los turnos que perdés de noche",
    body: "Contesta el WhatsApp fuera de hora con tus precios, tus horarios y lo que tenés disponible. El que escribe a las once de la noche recibe respuesta a las once de la noche, no mañana a las diez — cuando ya compró en otro lado.",
    never: "inventa un precio ni una fecha. Si no lo tiene escrito, avisa que se lo confirmás vos y te lo deja marcado.",
  },
  {
    Icon: FileText,
    title: "Presupuestos y seguimiento",
    body: "Arma el presupuesto con tu lista de precios y te lo deja listo. Y a los días le vuelve a escribir al que no contestó — que es la plata que se pierde por olvido, no por precio.",
    never: "manda un presupuesto sin tu ok, ni cierra un precio ni promete una entrega.",
  },
  {
    Icon: Receipt,
    title: "Facturas de proveedores",
    body: "La factura que llega por mail o de la que te sacaron una foto: la lee, la pasa a tu planilla y te avisa lo que vence esta semana antes de que venza.",
    never: "factura, paga ni presenta nada. Mira, ordena y avisa.",
  },
  {
    Icon: Instagram,
    title: "Instagram sin escribir los domingos",
    body: "Escribe los posteos de la semana con tu tono, los deja armados en el portal y los publica cuando vos les diste el visto bueno.",
    never: "publica nada sin tu aprobación.",
  },
  {
    Icon: Mic,
    title: "Audios y reuniones, en texto",
    body: "El audio de WhatsApp, la reunión grabada, la nota de voz del depósito: te los deja transcriptos y resumidos, con lo que hay que hacer separado de lo que solo se dijo.",
    never: "manda para afuera nada de lo que escuchó. La transcripción queda adentro de tu empresa.",
  },
];

function Jobs() {
  return (
    <section id="casos" className="mx-auto max-w-7xl px-5 py-6 sm:px-8 sm:py-10">
      <div className="mx-auto max-w-2xl text-center">
        <span className="inline-flex items-center gap-2 rounded-pill bg-primary/10 px-4 py-1.5 text-sm font-bold text-primary">
          <Puzzle size={15} /> Cada trabajo es un plugin
        </span>
        <h2 className="mt-5 text-4xl font-extrabold tracking-tight text-ink sm:text-5xl">
          Qué le pedís
        </h2>
        <p className="mt-4 text-lg text-ink-soft">
          Un plugin es un trabajo concreto de tu empresa escrito adentro del agente: tu proceso,
          tus precios, tu manera de decir las cosas. Estos son ejemplos de lo que más nos piden —
          algunos ya los tenemos y se adaptan a lo tuyo, y los que no existen los escribimos
          nosotros. Cada uno viene con una línea de lo que{" "}
          <strong className="text-ink">nunca</strong> va a hacer, escrita adentro del plugin y no
          de palabra.
        </p>
      </div>

      <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {JOBS.map(({ Icon, title, body, never }, i) => (
          <Reveal key={title} delay={(i % 3) * 90} className="h-full">
            <article className="flex h-full flex-col rounded-card border border-ink/5 bg-white p-7 shadow-soft transition duration-300 hover:-translate-y-1">
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-primary/10 text-primary">
                <Icon size={23} />
              </span>
              <h3 className="mt-5 text-xl font-extrabold tracking-tight text-ink">{title}</h3>
              <p className="mt-2 flex-1 text-ink-soft">{body}</p>

              <div className="mt-5 flex items-start gap-2.5 rounded-2xl bg-ink/[0.04] p-4">
                <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-c-coral text-c-coral-ink">
                  <Ban size={12} />
                </span>
                <p className="text-sm text-ink-soft">
                  <strong className="font-extrabold text-ink">Nunca</strong> {never}
                </p>
              </div>
            </article>
          </Reveal>
        ))}

        {/* The sixth card is the plugin that doesn't exist yet: the client's. */}
        <Reveal delay={180} className="h-full">
          <article className="flex h-full flex-col justify-center rounded-card border-2 border-dashed border-primary/25 bg-primary/[0.04] p-7">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-primary text-white">
              <Wrench size={23} />
            </span>
            <h3 className="mt-5 text-2xl font-extrabold tracking-tight text-ink">
              ¿Y lo tuyo?
            </h3>
            <p className="mt-2 text-ink-soft">
              Contanos el trabajo que te come las horas todas las semanas y te decimos tres cosas:
              si ya lo tenemos escrito, cuánto lleva escribirlo si no, y qué sale. Todo eso antes
              de que pongas un peso.
            </p>
            <a
              href={WHATSAPP}
              target="_blank"
              rel="noopener noreferrer"
              className="group mt-6 inline-flex w-fit items-center gap-2 rounded-pill bg-ink px-5 py-3 text-sm font-extrabold text-white shadow-soft transition hover:-translate-y-0.5 hover:bg-primary"
            >
              Contanos qué necesitás
              <ArrowRight size={16} className="transition group-hover:translate-x-1" />
            </a>
          </article>
        </Reveal>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────── The baptism */

// The face isn't decoration: it's the moment the client stops saying "el
// sistema" and starts saying a name. These are four looks of the SAME
// character — the dice the client rolls on day one — not four agents.
const LOOK: AgentitoLook = {
  tone: 0, antenna: 5, accessory: 0, pupil: 1, mouth: 1, skin: 1, suit: 0, brows: 1, hat: 0,
};
const LOOK_ROLLS: AgentitoLook[] = [
  { tone: 1, antenna: 3, accessory: 2, pupil: 0, mouth: 1, skin: 0, suit: 0, brows: 0, hat: 0 },
  { tone: 3, antenna: 2, accessory: 1, pupil: 2, mouth: 2, skin: 0, suit: 1, brows: 1, hat: 0 },
  { tone: 5, antenna: 4, accessory: 3, pupil: 2, mouth: 3, skin: 1, suit: 0, brows: 2, hat: 0 },
];

function Baptism() {
  return (
    <section className="mx-auto max-w-7xl px-5 py-10 sm:px-8 sm:py-16">
      <Reveal>
        <div className="rounded-card bg-c-violet px-6 py-12 sm:px-12 sm:py-16">
          <div className="grid items-center gap-10 lg:grid-cols-2">
            <div>
              <span className="inline-flex items-center gap-2 rounded-pill bg-white/60 px-4 py-1.5 text-sm font-bold text-c-violet-ink">
                <Dices size={15} /> Lo bautizás vos
              </span>
              <h2 className="mt-5 text-4xl font-extrabold tracking-tight text-c-violet-ink sm:text-5xl">
                Tiene el nombre y la cara que vos le pongas.
              </h2>
              <p className="mt-4 max-w-lg text-lg text-c-violet-ink/80">
                El día uno le ponés un nombre y le tirás el dado a la cara hasta que salga la que
                te gusta. Desde ahí es él: el que te contesta en el portal, el que te escribe por
                Telegram, el que firma lo que entrega. En tu empresa nadie va a decir “el
                sistema” — lo van a llamar por el nombre, y le van a pedir cosas como se las
                pedirían a cualquiera.
              </p>
            </div>

            <div className="flex flex-col items-center gap-6">
              <span className="grid h-40 w-40 place-items-center rounded-card bg-white/70 sm:h-48 sm:w-48">
                <AgentitoAvatar look={LOOK} className="h-32 w-32 sm:h-40 sm:w-40" />
              </span>
              <div className="flex items-center gap-3">
                {LOOK_ROLLS.map((look, i) => (
                  <span
                    key={i}
                    className="grid h-16 w-16 place-items-center rounded-2xl bg-white/40 opacity-70"
                  >
                    <AgentitoAvatar look={look} className="h-12 w-12" />
                  </span>
                ))}
              </div>
              <p className="text-sm font-semibold text-c-violet-ink/70">
                El mismo agente, otras caras. Elegís una y esa queda.
              </p>
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

/* ─────────────────────────────────────────── Control (you stay in charge) */

const CONTROL_POINTS = [
  {
    Icon: MessageCircle,
    title: "Le hablás",
    body: "Escribís en un solo lugar, desde el portal o desde el celular, y te contesta. Le pedís tareas, le preguntás qué hizo y responde al momento.",
  },
  {
    Icon: SlidersHorizontal,
    title: "Lo ajustás hablándole",
    body: "¿Querés que salude distinto o que priorice otra cosa? Se lo decís y cambia. Sin proyecto, sin código, sin esperar a nadie.",
  },
  {
    Icon: Eye,
    title: "Ves todo lo que hace",
    body: "Cada acción queda registrada, con la hora y con lo que produjo. Cero cajas negras: siempre sabés qué pasó y por qué.",
  },
  {
    Icon: Pause,
    title: "Lo frenás con un botón",
    body: "Pausa inmediata, cuando quieras. Y lo que te compromete — un mail a un cliente, un posteo, un presupuesto — siempre pasa por tu aprobación.",
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
                ¿Y quién manda acá?{" "}
                <span className="underline decoration-4 underline-offset-4">Vos.</span>
              </h2>
              <p className="mt-4 max-w-lg text-lg text-c-amber-ink/80">
                Autónomo no significa descontrolado. Tu agente trabaja solo, pero vos lo dirigís
                como a cualquier persona que trabaja con vos — hablándole.
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

            {/* Chat mock: the owner writes, the agent answers. One agent. */}
            <div className="mx-auto w-full max-w-md rounded-card bg-white p-5 shadow-lift sm:p-6">
              <div className="flex items-center gap-3 border-b border-ink/5 pb-4">
                <span className="grid h-11 w-11 place-items-center rounded-2xl bg-c-violet">
                  <AgentitoAvatar look={LOOK} className="h-9 w-9" />
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
                  ¿Cómo venimos hoy?
                </div>
                <div className="w-fit max-w-[85%] rounded-2xl rounded-bl-md bg-surface px-4 py-2.5 text-ink shadow-soft">
                  Anoche entraron 7 consultas por WhatsApp. Contesté las 6 de precios y horarios;
                  la otra pedía una fecha que no tengo y te la dejé marcada.
                </div>
                <div className="w-fit max-w-[85%] rounded-2xl rounded-bl-md bg-surface px-4 py-2.5 text-ink shadow-soft">
                  Y quedaron 2 presupuestos esperando tu ok para salir.
                </div>
                <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 font-medium text-white">
                  Aprobá el primero. Y de ahora en más contestá más formal, ¿puede ser?
                </div>
                <div className="w-fit max-w-[85%] rounded-2xl rounded-bl-md bg-surface px-4 py-2.5 text-ink shadow-soft">
                  Hecho: salió el presupuesto y ya ajusté el tono.
                </div>
              </div>
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

/* ─────────────────────────────────────────── The portal */

// The portal didn't appear anywhere on the site, and it's what makes
// everything else credible: "zero black boxes" said in prose is a promise;
// shown, it's proof. It's also the only thing the client is going to touch
// every day.
const PORTAL_SCREENS = [
  {
    Icon: Eye,
    title: "Qué hizo",
    body: "Entrás a la mañana y ves lo del día: qué terminó, qué está en curso y qué te está esperando a vos.",
  },
  {
    Icon: Hand,
    title: "Lo que espera tu ok",
    body: "Antes de mandar un mail o publicar algo, frena y te muestra el texto completo. Aprobás, lo corregís o lo rechazás.",
  },
  {
    Icon: Puzzle,
    title: "Su ficha y sus plugins",
    body: "Abrís a tu agente y ahí está: qué hace, qué nunca hace, qué plugins tiene puestos y qué tiene corriendo ahora mismo.",
  },
  {
    Icon: FolderOpen,
    title: "Lo que produjo",
    body: "Informes, listados y planillas, ordenados por trabajo y con fecha. Se abren ahí mismo, sin bajar nada.",
  },
];

function Portal() {
  return (
    <section id="portal" className="mx-auto max-w-7xl px-5 py-16 sm:px-8 sm:py-24">
      <div className="mx-auto max-w-2xl text-center">
        <span className="inline-flex items-center gap-2 rounded-pill bg-primary/10 px-4 py-1.5 text-sm font-bold text-primary">
          <LayoutDashboard size={15} /> Tu portal
        </span>
        <h2 className="mt-5 text-4xl font-extrabold tracking-tight text-ink sm:text-5xl">
          Un lugar donde ver todo lo que hace
        </h2>
        <p className="mt-4 text-lg text-ink-soft">
          Tu agente trabaja solo, pero no a ciegas. Cada empresa tiene su portal: entrás con un
          link, y ahí está todo lo que pasó — sin instalar nada y sin saber de computación.
        </p>
      </div>

      <div className="mt-12 grid gap-5 sm:grid-cols-2">
        {PORTAL_SCREENS.map(({ Icon, title, body }, i) => (
          <Reveal key={title} delay={(i % 2) * 90} className="h-full">
            <article className="h-full rounded-card border border-ink/5 bg-white p-7 shadow-soft">
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-primary/10 text-primary">
                <Icon size={22} />
              </span>
              <h3 className="mt-5 text-xl font-extrabold tracking-tight text-ink">{title}</h3>
              <p className="mt-2 text-ink-soft">{body}</p>
            </article>
          </Reveal>
        ))}
      </div>

      <p className="mx-auto mt-8 max-w-2xl text-center text-sm font-medium text-ink-soft">
        Escribinos y te lo mostramos funcionando antes de que pongas un peso.
      </p>
    </section>
  );
}

/* ─────────────────────────────────────────── Integrations */

// What's TODAY in the curated catalog that gets installed on every agent
// (kit/connections/catalog.json). The previous list promised HubSpot,
// Odoo, Mercado Libre, Notion, PostgreSQL and "+50 more" without the
// connector existing: that gets found out in the first meeting and burns
// trust right when it's needed most. What isn't there gets built — and
// that's said separately.
const INTEGRATIONS = [
  "Telegram",
  "Correo de la empresa",
  "Google Planillas",
  "Google Drive",
  "Google Agenda",
  "Google Docs",
  "Slack",
  "WhatsApp",
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
            Estas son las que ya vienen listas. ¿Tu sistema no está? Le escribimos la conexión a
            medida — es lo que sabemos hacer. Y te decimos de entrada cuánto lleva: WhatsApp, por
            ejemplo, depende de un trámite ante Meta y son días, no horas.
          </p>
        </div>
      </Reveal>
    </section>
  );
}

/* ─────────────────────────────────────────── Pricing */

// One published number and what goes on top of it: the monthly that already
// brings the agent answering WhatsApp and Instagram, and the jobs and custom
// work the client adds, quoted for free. The section id stays #planes because
// a blog post links there.
const MONTHLY_INCLUDES = [
  "Tu agente, con el nombre y la cara que elegís, y tu portal para ver todo lo que hace",
  "Los mensajes de WhatsApp e Instagram: contesta solo, con tus reglas",
  "Lo que no sabe o no le toca —un precio que no publicaste, un reclamo— te lo deja a vos con una nota",
  "Los modelos, el hosting y los ajustes: no pagás nada aparte",
  "Soporte por WhatsApp, con nosotros. No con un ticket.",
];

const ADD_ONS = [
  {
    title: "Cada trabajo que le sumes",
    body: "Posteos, facturas a la planilla, presupuestos y seguimiento, transcribir reuniones: cada trabajo que le sumes se agrega al mensual. Qué sale cada uno te lo cotizamos gratis, con tu caso a la vista.",
  },
  {
    title: "Lo que hay que escribir a medida",
    body: "Si tu empresa necesita algo que no existe —una conexión con tu sistema, un proceso que es solo tuyo— se cotiza y se paga una vez. Y la mitad de lo que pagás por ese armado te vuelve como descuento en el mensual, en los primeros meses.",
  },
];

function Pricing() {
  return (
    <section id="planes" className="mx-auto max-w-7xl px-5 py-16 sm:px-8 sm:py-24">
      <div className="mx-auto max-w-2xl text-center">
        <span className="inline-flex items-center gap-2 rounded-pill bg-primary/10 px-4 py-1.5 text-sm font-bold text-primary">
          <Sparkles size={15} /> Un precio, sin letra chica
        </span>
        <h2 className="mt-5 text-4xl font-extrabold tracking-tight text-ink sm:text-5xl">
          Cuánto sale
        </h2>
        <p className="mt-4 text-lg text-ink-soft">
          Un mensual que ya trae lo que más se usa, y lo que le sumes cuando lo necesites. No hay
          costo de alta, no hay escalones y no hay cargo por mensaje.
        </p>
      </div>

      <div className="mx-auto mt-12 grid max-w-5xl gap-5 lg:grid-cols-2">
        <Reveal className="h-full">
          <article className="flex h-full flex-col rounded-card bg-primary p-8 text-white shadow-lift sm:p-9">
            <p className="text-sm font-bold uppercase tracking-wider text-white/70">Todos los meses</p>
            <h3 className="mt-4 text-2xl font-extrabold tracking-tight">Tu agente</h3>
            <div className="mt-3 flex flex-wrap items-baseline gap-x-3">
              <span className="text-5xl font-extrabold tracking-tight">{MONTHLY}</span>
              <span className="text-sm font-bold text-white/80">por mes</span>
            </div>
            <p className="mt-2 text-sm font-semibold text-white/80">Sin costo de alta.</p>

            <ul className="mt-7 flex-1 space-y-3">
              {MONTHLY_INCLUDES.map((f) => (
                <li key={f} className="flex items-start gap-2.5">
                  <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-white/20">
                    <Check size={13} className="text-white" />
                  </span>
                  <span className="text-white/90">{f}</span>
                </li>
              ))}
            </ul>

            <a
              href={WHATSAPP}
              target="_blank"
              rel="noopener noreferrer"
              className="group mt-8 inline-flex items-center justify-center gap-2 rounded-pill bg-white px-6 py-3.5 text-sm font-extrabold text-primary shadow-lift transition hover:-translate-y-0.5"
            >
              Quiero mi agente
              <ArrowRight size={16} className="transition group-hover:translate-x-1" />
            </a>
          </article>
        </Reveal>

        <Reveal delay={110} className="h-full">
          <article className="flex h-full flex-col rounded-card border border-ink/5 bg-white p-8 shadow-soft sm:p-9">
            <p className="text-sm font-bold uppercase tracking-wider text-primary">Cuando lo necesites</p>
            <h3 className="mt-4 text-2xl font-extrabold tracking-tight text-ink">Lo que le sumás</h3>
            <p className="mt-3 text-2xl font-extrabold leading-snug tracking-tight text-ink">
              Se cotiza gratis
            </p>

            <div className="mt-6 flex-1 space-y-5">
              {ADD_ONS.map(({ title, body }) => (
                <div key={title}>
                  <p className="font-extrabold text-ink">{title}</p>
                  <p className="mt-1 text-ink-soft">{body}</p>
                </div>
              ))}
            </div>

            {/* The free step: type your workflow, get an instant teardown of
                what we would add first. */}
            <div className="mt-6 border-t border-ink/5 pt-5">
              <p className="text-sm text-ink-soft">
                ¿Querés saber qué le sumaríamos primero? Contanos tu workflow y te armamos un
                teardown gratis, al toque.
              </p>
              <TeardownButton className="group mt-3 inline-flex w-full items-center justify-center gap-2 rounded-pill border border-primary/30 bg-white px-5 py-3 text-sm font-extrabold text-primary transition hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                <Sparkles size={16} />
                Probá gratis el teardown
              </TeardownButton>
            </div>
          </article>
        </Reveal>
      </div>

      <Reveal>
        <div className="mx-auto mt-5 flex max-w-5xl items-start gap-4 rounded-card bg-c-green p-6 text-c-green-ink sm:items-center sm:p-7">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-white/60">
            <ShieldCheck size={22} />
          </span>
          <p className="text-base sm:text-lg">
            <strong className="font-extrabold">{GUARANTEE}</strong> Y sin permanencia: si un mes
            no te devolvió tiempo real, lo das de baja y dejás de pagarlo.
          </p>
        </div>
      </Reveal>
    </section>
  );
}

/* ─────────────────────────────────────────── FAQ */

const FAQS = [
  {
    q: "¿Qué es un agente de IA?",
    a: "Es software que usa un modelo de IA (como Claude o GPT) para ejecutar trabajo real: lee tus sistemas, decide qué hacer y lo hace. No es un chat al que hay que hablarle — es un compañero de trabajo digital que corre solo, 24/7, con un nombre que le ponés vos, una lista de lo que hace y un límite escrito de lo que nunca va a hacer.",
  },
  {
    q: "¿Qué es un plugin?",
    a: "Es un trabajo concreto de tu empresa escrito adentro del agente. “Contestar el WhatsApp fuera de hora con mis precios” es un plugin. “Leer las facturas que me llegan y pasarlas a la planilla” es otro. Adentro va tu proceso: qué mira, qué decide, qué te pregunta antes de actuar y qué no hace nunca. Sin plugins, el agente conversa; con un plugin, trabaja.",
  },
  {
    q: "¿Puedo pedir uno a medida?",
    a: "Es lo normal, no la excepción: casi todos los plugins que escribimos nacen de un pedido concreto de una empresa. Nos contás el trabajo que te come las horas, lo miramos, te decimos si algo parecido ya existe (y entonces se adapta, que es más rápido y más barato) o cuánto lleva escribirlo de cero. Recién después de eso hay un número, y el número se cotiza gratis antes de escribir una línea. Lo que se escribe a medida se paga una vez, y la mitad de lo que pagás por ese armado te vuelve como descuento en el mensual.",
  },
  {
    q: "¿Puedo probar antes de pagar?",
    a: `Sí, y es gratis. Contanos en una o dos líneas el trabajo que te come el día y te armamos al toque un teardown de tu workflow: qué agente y qué plugin te escribiríamos primero, qué capacidades nuestras lo cubren, qué hay que conectar de lo que ya usás y cuál es el piloto más chico que ya sirve, con el número para medirlo. Si automatizarlo todavía no te conviene, también te lo decimos. Si querés avanzar, la cotización de tu caso también es gratis. Y si arrancás y el primer mes no hizo lo que te dijimos, ese mes no lo pagás.`,
  },
  {
    q: "¿Cuánto cuesta?",
    a: `${MONTHLY} por mes, sin costo de alta. Eso trae tu agente con su portal y los mensajes de WhatsApp e Instagram: contesta solo, con tus reglas, y lo que no sabe o no le toca —un precio que no publicaste, un reclamo— te lo deja a vos con una nota. Los modelos, el hosting, los ajustes y el soporte van adentro. Cada trabajo que le sumes (posteos, facturas a la planilla, presupuestos y seguimiento, transcribir reuniones) se agrega al mensual, y te lo cotizamos gratis. Lo que haya que escribir a medida para tu empresa se paga una vez, y la mitad te vuelve como descuento en el mensual. ${GUARANTEE}`,
  },
  {
    q: "¿Puedo empezar con poco?",
    a: "Es lo que recomendamos. Arrancás con el agente contestando tu WhatsApp y tu Instagram y, si hace falta, un solo trabajo más: el que más te duele hoy. Lo ves andar un mes, medís si te devolvió horas de verdad y recién ahí le sumás el que sigue. Sumar un trabajo después no es un proyecto nuevo: el agente ya está instalado, conectado y sabiendo cómo trabajás.",
  },
  {
    q: "¿En qué se diferencia de un chatbot?",
    a: "Un chatbot responde preguntas. Tu agente actúa: entra a tu correo, arma presupuestos, escribe los posteos, ordena las planillas y ejecuta procesos completos con permisos controlados. El chatbot conversa; el agente trabaja.",
  },
  {
    q: "¿Por qué no usar ChatGPT o Claude directo?",
    a: "Porque esas herramientas necesitan que una persona las use: vos escribís, ellas responden. Tu agente corre solo, en un cronograma, conectado a tus sistemas con herramientas escritas a medida, sin que nadie lo empuje. Es la diferencia entre tener un asistente al que hay que dictarle y tener el trabajo hecho cuando llegás a la mañana.",
  },
  {
    q: "¿Cuánto demora estar funcionando?",
    a: "El agente con su primer plugin arranca en semanas, no en meses: la mayor parte del tiempo se va en conectar tus sistemas y en entender tu proceso, no en armar el agente. Los plugins que sumes después son bastante más rápidos, porque lo pesado ya está hecho.",
  },
  {
    q: "¿A qué sistemas se conecta?",
    a: "Ya vienen listas: Telegram, la casilla de correo de la empresa, y Google Planillas, Drive, Agenda y Documentos. Slack y WhatsApp los conectamos nosotros (WhatsApp lleva días por la verificación de Meta). Para tu CRM, tu sistema de gestión o cualquier sistema propio con API escribimos la conexión a medida — eso es lo que hacemos. Si te decimos que sí, es porque lo probamos.",
  },
  {
    q: "¿Es seguro? ¿Qué pasa con mis datos?",
    a: "Tu agente vive adentro de un contenedor tuyo, aislado del de cualquier otro cliente y con su propia clave. Opera con permisos acotados: solo ve y toca lo que le habilitás. Lo que te compromete —un mail, un posteo, un presupuesto— pasa por tu aprobación, y cada plugin trae su límite escrito de fábrica — el de facturas, por ejemplo, mira y ordena los números pero no factura ni paga nada. Tus datos no se usan para entrenar ningún modelo.",
  },
  {
    q: "¿Puedo hablarle y cambiarle las instrucciones?",
    a: "Sí, y es de lo mejor que tiene. Le hablás desde tu portal y desde el celular por Telegram, que se activa en cinco minutos: le preguntás qué hizo, le pedís tareas nuevas y le cambiás las instrucciones hablándole, como a cualquier empleado. WhatsApp también se puede, pero es el más lento de conectar porque depende de una verificación ante Meta: lo tramitamos nosotros y lleva días. Y si algo no te cierra, lo pausás. Autonomía no significa perder el control.",
  },
  {
    q: "¿Dónde trabajan y quién está detrás?",
    a: "Estamos en Montevideo y trabajamos de forma remota. tuagente es un producto de pdelabs, un estudio de ingeniería de software con años construyendo sistemas en producción — no somos una agencia de marketing que descubrió la IA el mes pasado. Detrás de tu agente hay personas: los plugins los escribimos nosotros y damos la cara por lo que hace.",
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

// Only the monthly carries a price: the jobs and the custom work are quoted,
// and an Offer with a made-up number is a lie a crawler repeats.
const JSON_LD = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "ProfessionalService",
      "@id": "https://tuagente.uy/#org",
      name: "tuagente.uy",
      url: "https://tuagente.uy",
      description:
        "Un agente de IA por empresa, instalado adentro de tu empresa y bautizado por vos, con plugins escritos a medida para el trabajo que te come las horas: WhatsApp fuera de hora, presupuestos, facturas, redes y transcripciones. Contesta solo el WhatsApp y el Instagram, con tus reglas, y tenés un portal para ver todo lo que hace y aprobar lo que te compromete.",
      slogan: "Un agente de IA que trabaja adentro de tu empresa",
      email: "hola@tuagente.uy",
      telephone: "+59899002835",
      priceRange: `${MONTHLY} por mes, sin costo de alta`,
      address: {
        "@type": "PostalAddress",
        addressLocality: "Montevideo",
        addressCountry: "UY",
      },
      areaServed: ["Uruguay"],
      parentOrganization: {
        "@type": "Organization",
        name: "pdelabs",
        url: "https://www.pdelabs.com",
      },
      knowsAbout: [
        "Agentes de IA",
        "Plugins a medida para agentes de IA",
        "Automatización de procesos",
        "Inteligencia artificial para empresas",
        "Integraciones a medida",
      ],
      makesOffer: [
        {
          "@type": "Offer",
          name: "Plan mensual",
          description: `Tu agente de IA con el nombre y la cara que elegís, su portal y los mensajes de WhatsApp e Instagram: contesta solo, con tus reglas. Modelos, hosting, ajustes y soporte incluidos. Sin costo de alta y sin permanencia. ${GUARANTEE}`,
          price: MONTHLY_USD,
          priceCurrency: "USD",
          priceSpecification: {
            "@type": "UnitPriceSpecification",
            price: MONTHLY_USD,
            priceCurrency: "USD",
            unitCode: "MON",
            unitText: "por mes",
          },
        },
        {
          "@type": "Offer",
          name: "Trabajos que le sumás",
          description:
            "Posteos, facturas a la planilla, presupuestos y seguimiento, transcribir reuniones: cada trabajo que le sumás se agrega al mensual. Se cotiza gratis.",
        },
        {
          "@type": "Offer",
          name: "Desarrollo a medida",
          description:
            "Lo que hay que escribir a medida para tu empresa se cotiza gratis y se paga una vez. La mitad de lo que pagás te vuelve como descuento en el mensual.",
        },
      ],
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

// Mr.Wobbles' face, verbatim from ../mrwobbles/voice/wobbles_voice/web/cara.html —
// the yellow look he ended up keeping: amber, classic antenna, glasses, bow tie.
const WOBBLES_LOOK: AgentitoLook = {
  tone: 3, antenna: 0, accessory: 1, pupil: 0, mouth: 0, skin: 0, suit: 1, brows: 1, hat: 0,
};

function Proof() {
  return (
    <section className="mx-auto max-w-7xl px-5 sm:px-8">
      <div className="rounded-card bg-c-violet px-6 py-14 sm:px-12">
        <div className="mx-auto flex max-w-4xl flex-col items-center gap-10 sm:flex-row sm:items-center sm:gap-14">
          {/* Mr.Wobbles floating, no card behind him: the Rive character in the
              "calm" state — nothing pending, so he sips mate every so often
              (first at ~20-35s, then every 45s-2min) while his eyes still
              follow the cursor (gaze-tracking runs in calm too; only working
              gestures park it). His yellow look is verbatim from the mrwobbles
              voice UI — tone 3, glasses, bow tie. Falls back to the identical
              static face until Rive loads and under prefers-reduced-motion. */}
          <div className="shrink-0">
            <AgentitoAnimated
              look={WOBBLES_LOOK}
              celebrations={0}
              state="calm"
              className="h-40 w-40 sm:h-52 sm:w-52"
            />
            <p className="mt-2 text-center text-base font-extrabold text-c-violet-ink">
              Mr.Wobbles
            </p>
          </div>
          <div className="text-center sm:text-left">
            <p className="text-sm font-bold uppercase tracking-wider text-c-violet-ink/60">
              Somos nuestro propio cliente
            </p>
            <h2 className="mt-4 text-3xl font-extrabold leading-snug tracking-tight text-c-violet-ink sm:text-4xl">
              El primer agente que pusimos a trabajar fue el nuestro.
            </h2>
            <p className="mt-5 text-lg leading-relaxed text-c-violet-ink/80">
              Investiga empresas, arma informes, prepara los mails que salen a nombre nuestro y nos
              los deja esperando aprobación. Todo lo que ves en este sitio lo probamos primero
              adentro de tuagente, y el portal que usás vos es el mismo que usamos nosotros todos los
              días.
            </p>
            <p className="mt-6 text-sm font-semibold text-c-violet-ink/70">
              Estamos arrancando: si buscás una lista larga de logos, todavía no la tenemos. Lo que
              sí tenemos es un producto andando y la puerta abierta para que lo veas.
            </p>
          </div>
        </div>
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
        <div
          className="animate-floaty pointer-events-none absolute -bottom-20 -left-10 h-64 w-64 rounded-full bg-white/10 blur-2xl"
          style={{ animationDelay: "-3s" }}
        />
        <h2 className="relative mx-auto max-w-3xl text-4xl font-extrabold leading-tight tracking-tight sm:text-6xl">
          ¿Listo para tener tu agente trabajando?
        </h2>
        <p className="relative mx-auto mt-5 max-w-xl text-lg text-white/80">
          Contanos qué te come las horas y te cotizamos gratis. Son {MONTHLY} por mes, sin costo
          de alta, con WhatsApp e Instagram adentro. {GUARANTEE}
        </p>
        <a
          href={WHATSAPP}
          target="_blank"
          rel="noopener noreferrer"
          className="group relative mt-9 inline-flex items-center justify-center gap-2 rounded-pill bg-white px-8 py-4 text-base font-extrabold text-primary shadow-lift transition hover:-translate-y-0.5"
        >
          Pedí tu cotización gratis
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

      </div>
    </footer>
  );
}
