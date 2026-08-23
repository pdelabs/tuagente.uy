import Image from "next/image";
import {
  ArrowRight,
  Ban,
  Bot,
  Check,
  ChevronDown,
  Clock,
  Eye,
  FolderOpen,
  Hand,
  LayoutDashboard,
  MapPin,
  MessageCircle,
  Pause,
  PhoneCall,
  Plug,
  Puzzle,
  SlidersHorizontal,
  ShieldCheck,
  Sparkles,
  UserPlus,
  Users,
  Zap,
} from "lucide-react";
import Reveal from "./Reveal";
import { AgentitoAvatar, type AgentitoLook } from "./app/lib/agentito";
import CountUp from "./CountUp";

const WHATSAPP = "https://wa.me/59899002835";
const EMAIL = "mailto:hola@tuagente.uy";

/** The price, in a single place: it repeats in the hero, in the numbers, in
 *  the pricing section, the FAQ and the structured data. */
const ROLE_PRICE = "$U 1.500";
const DIAGNOSIS_PRICE = "USD 200";

export default function Page() {
  return (
    <main className="overflow-x-hidden">
      <Header />
      <Hero />
      <Cards />
      <Reveal><Stats /></Reveal>
      <Steps />
      <TeamSection />
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
          ["El equipo", "#equipo"],
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
        Armá tu equipo
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
          Un equipo de IA que trabaja{" "}
          <span className="text-primary">solo</span>, adentro de tu empresa.
        </h1>

        <p
          className="animate-fadeup mx-auto mt-6 max-w-2xl text-lg text-ink-soft sm:text-xl"
          style={{ animationDelay: "180ms" }}
        >
          Contratás los roles que te faltan — marketing, soporte, ventas, contabilidad — y
          trabajan <strong className="text-ink">24/7</strong> adentro de tu empresa.{" "}
          <strong className="text-ink">{ROLE_PRICE} por rol, por mes.</strong> Nada sale para
          afuera sin tu ok.
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
            Armá tu equipo
            <ArrowRight size={19} className="transition group-hover:translate-x-1" />
          </a>
          <a
            href="#equipo"
            className="inline-flex w-full items-center justify-center gap-2 rounded-pill border border-ink/10 bg-white px-7 py-4 text-base font-bold text-ink shadow-soft transition hover:-translate-y-0.5 sm:w-auto"
          >
            Conocé a los roles
          </a>
        </div>

        <p
          className="animate-fadeup mt-6 text-sm font-medium text-ink-soft"
          style={{ animationDelay: "380ms" }}
        >
          Un equipo por empresa, aislado y con su propia clave · vos ves todo lo que hace cada uno
        </p>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────── Big tonal cards */

const CARDS = [
  {
    Icon: Users,
    title: "Contratás roles, no proyectos",
    body: "Cada uno tiene nombre, cara y una ficha con lo que hace. Sumás el que te falta y sacás el que no usás, cuando quieras.",
    bg: "bg-c-violet",
    ink: "text-c-violet-ink",
  },
  {
    Icon: Clock,
    title: "Trabajan 24/7",
    body: "Tu equipo no duerme, no se enferma y no renuncia. Opera en piloto automático mientras vos hacés otra cosa.",
    bg: "bg-c-green",
    ink: "text-c-green-ink",
  },
  {
    Icon: Plug,
    title: "Conectados a lo tuyo",
    body: "Se enchufan a tu correo, tus planillas y tus sistemas internos. Actúan de verdad — no solo chatean.",
    bg: "bg-c-coral",
    ink: "text-c-coral-ink",
  },
  {
    Icon: Eye,
    title: "Nada pasa a tus espaldas",
    body: "Tenés un portal donde ves qué hizo cada uno, qué está haciendo y qué produjo. Y lo que sale para afuera — un mail a un cliente, un posteo — espera tu ok.",
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
const STATS: {
  l: string;
  value?: number;
  prefix?: string;
  suffix?: string;
  static?: string;
  size?: string;
}[] = [
  { static: "24/7", l: "tu equipo no para" },
  { static: ROLE_PRICE, l: "por rol, por mes", size: "text-3xl sm:text-5xl" },
  { static: "1 a 1", l: "un equipo por empresa, aislado" },
  { static: "Tu ok", l: "para todo lo que sale para afuera" },
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
    Icon: PhoneCall,
    title: "Empezás por el diagnóstico",
    body: `Una llamada y un informe: qué roles te sirven, cuánto te ahorra cada uno y qué sale ponerlos a trabajar. Son ${DIAGNOSIS_PRICE} y se descuentan del setup si seguís.`,
  },
  {
    Icon: UserPlus,
    title: "Armamos tu equipo",
    body: "Cada rol se arma a medida: partimos de un ejemplo o lo componemos desde cero. Lo instalamos adentro de tu empresa, conectado a lo que ya usás y con los permisos que vos le des.",
  },
  {
    Icon: Zap,
    title: "Trabajan solos",
    body: "Desde ese día el trabajo pasa sin que nadie lo empuje. Vos entrás al portal, mirás lo que hicieron y aprobás lo que sale para afuera.",
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
          Tu equipo, trabajando en 3 pasos
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

/* ─────────────────────────────────────────── The team (the roles) */

// The five that are in the kit's catalog today (hermes-kit/roles/catalog.json):
// the "does", the "never" and the `look` all come from there, with the same
// words and the same face the client later sees inside the portal. If the
// catalog changes, this changes — no role gets promised here that isn't
// written there.
const ROLES = [
  {
    name: "Vera",
    role: "Marketing",
    does: "Escribe y planifica lo que publicás: posteos de Instagram, historias, textos y el kit de marca.",
    never: "publica nada sin tu aprobación.",
    look: { tone: 0, antenna: 5, accessory: 0, pupil: 1, mouth: 1, skin: 1, suit: 0, brows: 1, hat: 0 } as AgentitoLook,
    bg: "bg-c-violet",
  },
  {
    name: "Beto",
    role: "Soporte",
    does: "Contesta los mensajes de tus clientes: horarios, precios y estado de pedidos.",
    never: "manda un mensaje a un cliente tuyo sin tu aprobación.",
    look: { tone: 1, antenna: 3, accessory: 2, pupil: 0, mouth: 1, skin: 0, suit: 0, brows: 0, hat: 0 } as AgentitoLook,
    bg: "bg-c-green",
  },
  {
    name: "Nina",
    role: "Ventas",
    does: "Arma presupuestos y hace el seguimiento de los que no te contestaron.",
    never: "cierra un precio ni promete una entrega sin tu aprobación.",
    look: { tone: 5, antenna: 4, accessory: 2, pupil: 2, mouth: 3, skin: 1, suit: 0, brows: 2, hat: 0 } as AgentitoLook,
    bg: "bg-c-pink",
  },
  {
    name: "Tino",
    role: "Contabilidad",
    does: "Te arma las planillas de lo que entra y lo que sale, y te avisa lo que vence.",
    never: "factura, paga ni presenta nada. Solo mira, ordena y avisa.",
    look: { tone: 4, antenna: 2, accessory: 1, pupil: 2, mouth: 2, skin: 0, suit: 1, brows: 1, hat: 0 } as AgentitoLook,
    bg: "bg-c-amber",
  },
  {
    name: "Lola",
    role: "Asistente",
    does: "Hace los mandados del negocio: averigua lo que le pedís, lee lo que le mandás, escucha los audios y te deja la planilla o el documento armado.",
    never:
      "promete lo que no puede hacer. Si le falta una herramienta te lo dice y te ofrece la que lo resuelve.",
    look: { tone: 2, antenna: 0, accessory: 3, pupil: 1, mouth: 1, skin: 0, suit: 0, brows: 0, hat: 0 } as AgentitoLook,
    bg: "bg-c-coral",
  },
];

function TeamSection() {
  return (
    <section id="equipo" className="mx-auto max-w-7xl px-5 py-6 sm:px-8 sm:py-10">
      <div className="mx-auto max-w-2xl text-center">
        <span className="inline-flex items-center gap-2 rounded-pill bg-primary/10 px-4 py-1.5 text-sm font-bold text-primary">
          <Users size={15} /> Todos los roles se arman a medida
        </span>
        <h2 className="mt-5 text-4xl font-extrabold tracking-tight text-ink sm:text-5xl">
          Conocé a tu equipo
        </h2>
        <p className="mt-4 text-lg text-ink-soft">
          Acá no hay menú: cada rol se arma para tu empresa, capacidad por capacidad, y estos
          cinco son puntos de partida que ya existen. El tuyo puede ser uno de estos ajustado o
          uno nuevo desde cero. Todos llevan nombre, cara, lo que hacen y — esto es lo
          importante — una línea de lo que <strong className="text-ink">nunca</strong> van a
          hacer, escrita adentro del rol y no de palabra.
        </p>
      </div>

      <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {ROLES.map((r, i) => (
          <Reveal key={r.name} delay={(i % 3) * 90} className="h-full">
            <article className="flex h-full flex-col rounded-card border border-ink/5 bg-white p-7 shadow-soft transition duration-300 hover:-translate-y-1">
              <div className="flex flex-wrap items-center gap-4">
                <span className={`grid h-16 w-16 shrink-0 place-items-center rounded-2xl ${r.bg}`}>
                  <AgentitoAvatar look={r.look} className="h-14 w-14" />
                </span>
                <div className="min-w-0">
                  <h3 className="text-2xl font-extrabold tracking-tight text-ink">{r.name}</h3>
                  <p className="text-xs font-bold uppercase tracking-wider text-primary">{r.role}</p>
                </div>
              </div>

              <p className="mt-5 flex-1 text-ink-soft">{r.does}</p>

              <div className="mt-5 flex items-start gap-2.5 rounded-2xl bg-ink/[0.04] p-4">
                <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-c-coral text-c-coral-ink">
                  <Ban size={12} />
                </span>
                <p className="text-sm text-ink-soft">
                  <strong className="font-extrabold text-ink">Nunca</strong> {r.never}
                </p>
              </div>
            </article>
          </Reveal>
        ))}

        {/* The sixth spot in the grid is the role that doesn't exist yet: yours. */}
        <Reveal delay={180} className="h-full">
          <article className="flex h-full flex-col justify-center rounded-card border-2 border-dashed border-primary/25 bg-primary/[0.04] p-7">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-primary text-white">
              <Puzzle size={23} />
            </span>
            <h3 className="mt-5 text-2xl font-extrabold tracking-tight text-ink">
              El sexto es el tuyo
            </h3>
            <p className="mt-2 text-ink-soft">
              Contanos qué necesitás que haga y lo componemos con vos, capacidad por capacidad:
              leer facturas, buscar en internet, transcribir audios, armar planillas. Sale lo
              mismo que cualquier otro rol: {ROLE_PRICE} por mes.
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

/* ─────────────────────────────────────────── Control (you stay in charge) */

const CONTROL_POINTS = [
  {
    Icon: MessageCircle,
    title: "Le hablás al equipo",
    body: "Escribís en un solo lugar, desde el portal o desde el celular, y contesta el que corresponde. Le pedís tareas, le preguntás qué hizo y te responde al momento.",
  },
  {
    Icon: SlidersHorizontal,
    title: "Los ajustás hablándoles",
    body: "¿Querés que Beto salude distinto o que Vera priorice otra cosa? Se lo decís y cambia. Sin proyecto, sin código, sin esperar a nadie.",
  },
  {
    Icon: Eye,
    title: "Ves todo lo que hace cada uno",
    body: "Cada acción queda registrada, y con el nombre de quién la hizo. Cero cajas negras: siempre sabés qué pasó y por qué.",
  },
  {
    Icon: Pause,
    title: "Los frenás con un botón",
    body: "Pausa inmediata, a uno o a todos. Y lo que sale para afuera — un mail a un cliente, un posteo, un presupuesto — siempre pasa por tu aprobación.",
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
                Autónomo no significa descontrolado. Tu equipo trabaja solo, pero vos lo dirigís
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

            {/* Chat mock: the owner writes to the team, and whoever's in charge answers */}
            <div className="mx-auto w-full max-w-md rounded-card bg-white p-5 shadow-lift sm:p-6">
              <div className="flex items-center gap-3 border-b border-ink/5 pb-4">
                <span className="flex -space-x-3">
                  <span className="grid h-10 w-10 place-items-center rounded-2xl bg-c-green ring-2 ring-white">
                    <AgentitoAvatar look={ROLES[1].look} className="h-8 w-8" />
                  </span>
                  <span className="grid h-10 w-10 place-items-center rounded-2xl bg-c-violet ring-2 ring-white">
                    <AgentitoAvatar look={ROLES[0].look} className="h-8 w-8" />
                  </span>
                </span>
                <div>
                  <p className="text-sm font-extrabold text-ink">Tu equipo</p>
                  <p className="flex items-center gap-1.5 text-xs font-medium text-ink-soft">
                    <span className="h-2 w-2 rounded-full bg-c-green-ink" /> 4 en línea · trabajando
                  </p>
                </div>
              </div>
              <div className="mt-4 space-y-3 text-sm">
                <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 font-medium text-white">
                  ¿Cómo venimos hoy?
                </div>
                <div className="w-fit max-w-[85%] rounded-2xl rounded-bl-md bg-surface px-4 py-2.5 text-ink shadow-soft">
                  <span className="font-extrabold text-c-green-ink">Beto</span> · Contesté 34
                  consultas y quedan 2 esperando tu ok para salir.
                </div>
                <div className="w-fit max-w-[85%] rounded-2xl rounded-bl-md bg-surface px-4 py-2.5 text-ink shadow-soft">
                  <span className="font-extrabold text-primary">Vera</span> · Dejé los tres posteos
                  de la semana listos para que los mires.
                </div>
                <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 font-medium text-white">
                  Aprobá la primera, Beto. Y de ahora en más contestá más formal, ¿puede ser?
                </div>
                <div className="w-fit max-w-[85%] rounded-2xl rounded-bl-md bg-surface px-4 py-2.5 text-ink shadow-soft">
                  <span className="font-extrabold text-c-green-ink">Beto</span> · Hecho: salió la
                  respuesta y ya ajusté mi tono.
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
    title: "Qué hizo cada uno",
    body: "Entrás a la mañana y ves lo del día: qué terminó, quién lo hizo, qué está en curso y qué te está esperando a vos.",
  },
  {
    Icon: Hand,
    title: "Lo que espera tu ok",
    body: "Antes de mandar un mail o publicar algo, el que lo escribió frena y te muestra el texto completo. Aprobás, lo corregís o lo rechazás.",
  },
  {
    Icon: Users,
    title: "La ficha de cada rol",
    body: "Abrís a Vera o a Beto y ahí está: qué hace, qué nunca hace, qué tiene corriendo y todo lo que entregó hasta hoy.",
  },
  {
    Icon: FolderOpen,
    title: "Lo que produjeron",
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
          Un lugar donde ver todo lo que hacen
        </h2>
        <p className="mt-4 text-lg text-ink-soft">
          Tu equipo trabaja solo, pero no a ciegas. Cada empresa tiene su portal: entrás con un
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
        Te lo mostramos funcionando en el diagnóstico, con tu caso adentro.
      </p>
    </section>
  );
}

/* ─────────────────────────────────────────── Integrations */

// What's TODAY in the curated catalog that gets installed on every agent
// (hermes-kit/connections/catalog.json). The previous list promised HubSpot,
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
            Se conectan con lo que ya usás
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
            Estas son las que ya vienen listas. ¿Tu sistema no está? Le escribimos la integración a
            medida — es lo que sabemos hacer. Y te decimos de entrada cuánto lleva: WhatsApp, por
            ejemplo, depende de un trámite ante Meta y son días, no horas.
          </p>
        </div>
      </Reveal>
    </section>
  );
}

/* ─────────────────────────────────────────── Pricing */

// A single price per role. The three plans (Starter / Pro / Fleet) went away
// with the pivot: when what's being hired is people, the client isn't buying
// a "package", they're hiring their second employee. The section id stays
// #planes because a blog post links there.
const INCLUDES = [
  "El rol trabajando 24/7, adentro de tu empresa",
  "Su ficha en el portal: qué hace, qué tiene corriendo y qué entregó",
  "Aprobación tuya para todo lo que sale para afuera",
  "Soporte por WhatsApp, con nosotros",
];

function Pricing() {
  return (
    <section id="planes" className="mx-auto max-w-7xl px-5 py-16 sm:px-8 sm:py-24">
      <div className="mx-auto max-w-2xl text-center">
        <span className="inline-flex items-center gap-2 rounded-pill bg-primary/10 px-4 py-1.5 text-sm font-bold text-primary">
          <Sparkles size={15} /> Un precio, sin letra chica
        </span>
        <h2 className="mt-5 text-4xl font-extrabold tracking-tight text-ink sm:text-5xl">
          Cuánto sale tu equipo
        </h2>
        <p className="mt-4 text-lg text-ink-soft">
          Se paga por rol, como se paga un sueldo — solo que este es el mismo para todos y lo
          decidís vos mes a mes.
        </p>
      </div>

      <div className="mt-12 grid gap-5 lg:grid-cols-5">
        <Reveal className="h-full lg:col-span-3">
          <article className="flex h-full flex-col rounded-card bg-primary p-8 text-white shadow-lift sm:p-10">
            <p className="text-sm font-bold uppercase tracking-wider text-white/70">
              Por cada rol que contratás
            </p>
            <div className="mt-4 flex flex-wrap items-baseline gap-x-3">
              <span className="text-5xl font-extrabold tracking-tight sm:text-6xl">
                {ROLE_PRICE}
              </span>
              <span className="text-lg font-bold text-white/80">por mes</span>
            </div>
            <p className="mt-2 text-sm font-medium text-white/70">
              Pesos uruguayos, por rol. Pagás los que contratás, y nada más.
            </p>

            <ul className="mt-8 flex-1 space-y-3">
              {INCLUDES.map((f) => (
                <li key={f} className="flex items-start gap-2.5">
                  <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-white/20">
                    <Check size={13} className="text-white" />
                  </span>
                  <span className="text-white/90">{f}</span>
                </li>
              ))}
            </ul>

            <p className="mt-8 rounded-2xl bg-white/10 p-4 text-sm font-semibold text-white/90">
              Sumás o sacás roles cuando quieras. Si uno no te está sirviendo, lo das de baja y
              dejás de pagarlo — sin permanencia y sin explicaciones.
            </p>

            <a
              href={WHATSAPP}
              target="_blank"
              rel="noopener noreferrer"
              className="group mt-6 inline-flex items-center justify-center gap-2 rounded-pill bg-white px-6 py-3.5 text-sm font-extrabold text-primary shadow-lift transition hover:-translate-y-0.5"
            >
              Armá tu equipo
              <ArrowRight size={16} className="transition group-hover:translate-x-1" />
            </a>
          </article>
        </Reveal>

        <Reveal delay={110} className="h-full lg:col-span-2">
          <article className="flex h-full flex-col rounded-card border border-ink/5 bg-white p-8 shadow-soft sm:p-10">
            <p className="text-sm font-bold uppercase tracking-wider text-primary">El primer paso</p>
            <h3 className="mt-4 text-2xl font-extrabold tracking-tight text-ink">El diagnóstico</h3>
            <div className="mt-3 flex flex-wrap items-baseline gap-x-3">
              <span className="text-4xl font-extrabold tracking-tight text-ink">
                {DIAGNOSIS_PRICE}
              </span>
              <span className="text-sm font-bold text-ink-soft">una sola vez</span>
            </div>
            <p className="mt-4 flex-1 text-ink-soft">
              Una llamada y un informe escrito: dónde un equipo de agentes te ahorra plata y
              tiempo, qué roles te sirven, en qué orden conviene arrancar y qué sale el setup. Si
              seguís, los {DIAGNOSIS_PRICE} se descuentan del setup.
            </p>
            <p className="mt-4 rounded-2xl bg-ink/[0.04] p-4 text-sm font-medium text-ink-soft">
              El setup se cotiza ahí, con tu caso a la vista: depende de qué haya que conectar.
              Antes de eso no te tiramos un número al aire.
            </p>
            <a
              href={WHATSAPP}
              target="_blank"
              rel="noopener noreferrer"
              className="group mt-6 inline-flex items-center justify-center gap-2 rounded-pill bg-ink px-6 py-3.5 text-sm font-extrabold text-white shadow-soft transition hover:-translate-y-0.5 hover:bg-primary"
            >
              Quiero el diagnóstico
              <ArrowRight size={16} className="transition group-hover:translate-x-1" />
            </a>
          </article>
        </Reveal>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────── FAQ */

const FAQS = [
  {
    q: "¿Qué es un empleado de IA?",
    a: "Es software que usa un modelo de IA (como Claude o GPT) para ejecutar trabajo real: lee tus sistemas, decide qué hacer y lo hace. No es un chat al que hay que hablarle — es un compañero de trabajo digital que corre solo, 24/7, con un nombre, una lista de lo que hace y un límite escrito de lo que nunca va a hacer.",
  },
  {
    q: "¿En qué se diferencia de un chatbot?",
    a: "Un chatbot responde preguntas. Tu equipo actúa: entra a tu correo, arma presupuestos, escribe los posteos, ordena las planillas y ejecuta procesos completos con permisos controlados. El chatbot conversa; el equipo trabaja.",
  },
  {
    q: "¿Por qué no usar ChatGPT o Claude directo?",
    a: "Porque esas herramientas necesitan que una persona las use: vos escribís, ellas responden. Tu equipo corre flujos autónomos en un cronograma, conectado a tus sistemas con herramientas escritas a medida, sin que nadie lo empuje. Es la diferencia entre tener un asistente y tener empleados.",
  },
  {
    q: "¿Cuánto cuesta?",
    a: `${ROLE_PRICE} por rol, por mes, en pesos uruguayos. Contratás los que necesites y pagás solo esos. Antes va el diagnóstico, ${DIAGNOSIS_PRICE}: una llamada y un informe con dónde te ahorra plata cada rol y cuánto sale el setup. Si seguís, esos ${DIAGNOSIS_PRICE} se descuentan del setup.`,
  },
  {
    q: "¿Puedo contratar un solo rol?",
    a: "Sí, y es lo que recomendamos para arrancar. Ponés a trabajar el que más te duele hoy, lo ves andar un mes y recién ahí sumás el segundo. Sumar o sacar roles es una decisión tuya y no lleva un proyecto nuevo.",
  },
  {
    q: "¿Y si ninguno de los cinco es lo que necesito?",
    a: "Ese es el caso normal: todos los roles se arman a medida, y los cinco que mostramos son puntos de partida, no un menú. El tuyo se compone de capacidades — leer facturas y fotos, buscar en internet, transcribir audios, hacer cuentas y planillas — según lo que nos cuentes que necesitás que haga. Sale lo mismo que cualquier otro rol.",
  },
  {
    q: "¿Cuánto demora estar funcionando?",
    a: "El primer rol arranca en semanas, no en meses: la mayor parte del tiempo se va en conectar tus sistemas, no en armar el rol. Los que sumes después son bastante más rápidos, porque tu equipo ya está instalado y conectado.",
  },
  {
    q: "¿A qué sistemas se conectan?",
    a: "Ya vienen listas: Telegram, la casilla de correo de la empresa, y Google Planillas, Drive, Agenda y Documentos. Slack y WhatsApp los conectamos nosotros (WhatsApp lleva días por la verificación de Meta). Para tu CRM, tu ERP o cualquier sistema propio con API escribimos la integración a medida — eso es lo que hacemos. Si te decimos que sí, es porque lo probamos.",
  },
  {
    q: "¿Es seguro? ¿Qué pasa con mis datos?",
    a: "Tu equipo entero vive adentro de un contenedor tuyo, aislado del de cualquier otro cliente y con su propia clave. Cada rol opera con permisos acotados: solo ve y toca lo que le habilitás. Todo lo que sale para afuera pasa por tu aprobación, y hay roles con el límite puesto de fábrica — Contabilidad, por ejemplo, mira y ordena los números pero no factura ni paga nada. Tus datos no se usan para entrenar ningún modelo.",
  },
  {
    q: "¿Puedo hablarles y cambiarles las instrucciones?",
    a: "Sí, y es de lo mejor que tiene. Les hablás desde tu portal y desde el celular por Telegram, que se activa en cinco minutos: preguntás qué hicieron, pedís tareas nuevas y les cambiás las instrucciones hablándoles, como a cualquier empleado. WhatsApp también se puede, pero es el más lento de conectar porque depende de una verificación ante Meta: lo tramitamos nosotros y lleva días. Y si algo no te cierra, los pausás. Autonomía no significa perder el control.",
  },
  {
    q: "¿Dónde trabajan y quién está detrás?",
    a: "Estamos en Montevideo y trabajamos de forma remota. tuagente es un producto de pdelabs, un estudio de ingeniería de software con años construyendo sistemas en producción — no somos una agencia de marketing que descubrió la IA el mes pasado. Estamos arrancando con tuagente, y lo decimos de frente: el primer equipo que pusimos a trabajar fue el nuestro.",
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
        "Equipos de IA para empresas uruguayas: contratás roles — marketing, soporte, ventas, contabilidad o uno a medida — que trabajan 24/7 adentro de tu empresa, con un portal donde ves todo lo que hacen y aprobás lo que sale para afuera.",
      slogan: "Un equipo de IA que trabaja adentro de tu empresa",
      email: "hola@tuagente.uy",
      telephone: "+59899002835",
      priceRange: "UYU 1.500 por rol, por mes",
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
        "Equipos de agentes de IA",
        "Automatización de procesos",
        "Inteligencia artificial para empresas",
        "Integraciones a medida",
      ],
      makesOffer: [
        {
          "@type": "Offer",
          name: "Un rol del equipo, por mes",
          description:
            "Un rol de IA trabajando 24/7 adentro de tu empresa, con su ficha en el portal y aprobación tuya para todo lo que sale para afuera.",
          price: "1500",
          priceCurrency: "UYU",
        },
        {
          "@type": "Offer",
          name: "Diagnóstico",
          description:
            "Una llamada y un informe: qué roles te sirven, cuánto te ahorran y qué sale el setup. Se descuenta del setup si seguís.",
          price: "200",
          priceCurrency: "USD",
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

function Proof() {
  return (
    <section className="mx-auto max-w-7xl px-5 sm:px-8">
      <div className="rounded-card bg-c-violet px-6 py-14 sm:px-12">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-bold uppercase tracking-wider text-c-violet-ink/60">
            Somos nuestro propio cliente
          </p>
          <h2 className="mt-4 text-3xl font-extrabold leading-snug tracking-tight text-c-violet-ink sm:text-4xl">
            El primer equipo que pusimos a trabajar fue el nuestro.
          </h2>
          <p className="mt-5 text-lg leading-relaxed text-c-violet-ink/80">
            Investiga empresas, arma informes, prepara los mails que salen a nombre nuestro y nos
            los deja esperando aprobación. Todo lo que ves en este sitio lo probamos primero
            adentro de pdelabs, y el portal que usás vos es el mismo que usamos nosotros todos los
            días.
          </p>
          <p className="mt-6 text-sm font-semibold text-c-violet-ink/70">
            Estamos arrancando: si buscás una lista larga de logos, todavía no la tenemos. Lo que
            sí tenemos es un producto andando y la puerta abierta para que lo veas.
          </p>
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
          ¿Listo para tener tu equipo trabajando?
        </h2>
        <p className="relative mx-auto mt-5 max-w-xl text-lg text-white/80">
          Arrancá por el diagnóstico: {DIAGNOSIS_PRICE}, una llamada y un informe con lo que te
          ahorra cada rol. Si seguís, se descuentan del setup. Escribinos y lo agendamos.
        </p>
        <a
          href={WHATSAPP}
          target="_blank"
          rel="noopener noreferrer"
          className="group relative mt-9 inline-flex items-center justify-center gap-2 rounded-pill bg-white px-8 py-4 text-base font-extrabold text-primary shadow-lift transition hover:-translate-y-0.5"
        >
          Quiero mi equipo
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
