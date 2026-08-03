import Image from "next/image";
import {
  ArrowRight,
  Bot,
  Clock,
  MessageCircle,
  Plug,
  Rocket,
  ShieldCheck,
  Sparkles,
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
      <Reveal><Proof /></Reveal>
      <Reveal><FinalCta /></Reveal>
      <Footer />
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
    <section className="mx-auto max-w-7xl px-5 py-16 sm:px-8 sm:py-24">
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

        <div className="flex items-center gap-6 text-sm font-semibold text-ink-soft">
          <a href={WHATSAPP} target="_blank" rel="noopener noreferrer" className="hover:text-primary">
            WhatsApp
          </a>
          <a href={EMAIL} className="hover:text-primary">
            Email
          </a>
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
